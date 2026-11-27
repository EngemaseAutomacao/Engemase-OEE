/**
 * Certificados SSH de curta duração do acesso remoto (docs/12). A plataforma é a autoridade (CA): assina a
 * chave pública Ed25519 do técnico com validade até o fim da sessão aprovada. O gateway (pacote
 * oee-gateway-remote-access) só aceita certificados desta CA, para o principal do próprio gateway
 * (`oee-gw-<id>`), vindos pelo encaminhamento local (`source-address` 127.0.0.1) e dentro do prazo.
 *
 * Formato: `ssh-ed25519-cert-v01@openssh.com` (PROTOCOL.certkeys do OpenSSH), montado aqui sem biblioteca.
 * Chave privada da CA em `SSH_CA_SIGNING_KEY` (semente Ed25519 de 32 bytes em base64 ou PEM PKCS#8,
 * Sensitive, só produção) e no cofre; nunca no código nem em log.
 */
import { createHash, createPrivateKey, createPublicKey, type KeyObject, randomBytes, sign } from "node:crypto"

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex")
const KEY_TYPE = "ssh-ed25519"
const CERT_TYPE = "ssh-ed25519-cert-v01@openssh.com"
const SSH2_CERT_TYPE_USER = 1

/** Validade máxima de um certificado (o teto da sessão é 8 h). */
export const MAX_CERT_VALIDITY_S = 8 * 3600

// --- codificação do formato SSH (RFC 4251) ---------------------------------------------------------------

const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(n)
  return b
}
const str = (v: Buffer | string) => {
  const b = typeof v === "string" ? Buffer.from(v, "utf8") : v
  return Buffer.concat([u32(b.length), b])
}

/** Blob da chave pública Ed25519 no formato SSH. */
const pubBlob = (raw: Buffer) => Buffer.concat([str(KEY_TYPE), str(raw)])

function lerString(buf: Buffer, off: number): [Buffer, number] {
  if (off + 4 > buf.length) throw new Error("chave truncada")
  const n = buf.readUInt32BE(off)
  if (off + 4 + n > buf.length) throw new Error("chave truncada")
  return [buf.subarray(off + 4, off + 4 + n), off + 4 + n]
}

// --- chave do técnico ------------------------------------------------------------------------------------

export interface ChaveDoTecnico {
  /** 32 bytes da chave pública Ed25519. */
  readonly raw: Buffer
  /** Impressão digital no formato do OpenSSH (`SHA256:...`). */
  readonly fingerprint: string
}

/**
 * Lê uma linha `ssh-ed25519 AAAA... comentário` (o conteúdo do `~/.ssh/id_ed25519.pub`). Só Ed25519: chave
 * curta, rápida e a única aceita pelo gateway. Chave privada colada por engano é recusada sem ecoar nada.
 */
export function lerChaveDoTecnico(linha: string): ChaveDoTecnico {
  const v = linha.trim()
  if (v.includes("PRIVATE KEY")) throw new Error("Isso é uma chave PRIVADA. Cole só a pública (o arquivo que termina em .pub).")
  const partes = v.split(/\s+/)
  if (partes.length < 2 || partes[0] !== KEY_TYPE) throw new Error("Use uma chave Ed25519: a linha começa com ssh-ed25519 (gere com ssh-keygen -t ed25519).")
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(partes[1]!)) throw new Error("Chave pública ilegível.")
  const blob = Buffer.from(partes[1]!, "base64")
  const [tipo, o1] = lerString(blob, 0)
  const [raw, o2] = lerString(blob, o1)
  if (tipo.toString() !== KEY_TYPE || raw.length !== 32 || o2 !== blob.length) throw new Error("Chave pública Ed25519 inválida.")
  return { raw: Buffer.from(raw), fingerprint: impressaoDigital(raw) }
}

/** `SHA256:<base64 sem =>` do blob da chave, como o `ssh-keygen -l`. */
export function impressaoDigital(raw: Buffer): string {
  return "SHA256:" + createHash("sha256").update(pubBlob(raw)).digest("base64").replace(/=+$/, "")
}

// --- CA ----------------------------------------------------------------------------------------------------

export interface CertificadoPedido {
  readonly chave: ChaveDoTecnico
  /** Identificação que aparece no log do sshd do gateway (sem dado pessoal: ids). */
  readonly keyId: string
  readonly principals: readonly string[]
  readonly validoDe: Date
  readonly validoAte: Date
  /** Endereços de origem aceitos (padrão: só o encaminhamento local do oee-remote-access). */
  readonly origem?: readonly string[]
  readonly serial?: bigint
}

export interface CertificadoEmitido {
  /** Linha do arquivo `<chave>-cert.pub`. */
  readonly linha: string
  readonly serial: bigint
}

export interface SshCa {
  /** Linha da chave pública da CA (`ssh-ed25519 AAAA... comentário`), para o pacote do gateway. */
  readonly publicKeyLine: string
  readonly fingerprint: string
  emitir(p: CertificadoPedido): CertificadoEmitido
}

function chavePrivada(raw: string): KeyObject {
  const v = raw.trim()
  if (v.includes("BEGIN")) return createPrivateKey(v)
  const seed = Buffer.from(v, "base64")
  if (seed.length !== 32) throw new Error("SSH_CA_SIGNING_KEY: esperada a semente Ed25519 de 32 bytes em base64 ou um PEM PKCS#8")
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" })
}

/** Lista de strings SSH (principals) ou de opções `nome → dado` (opções críticas e extensões, em ordem). */
const lista = (itens: readonly string[]) => str(Buffer.concat(itens.map((s) => str(s))))
const opcoes = (o: ReadonlyArray<readonly [string, string | null]>) =>
  str(Buffer.concat([...o].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([nome, dado]) => Buffer.concat([str(nome), str(dado === null ? Buffer.alloc(0) : str(dado))]))))

/** CA a partir da chave; `null` sem chave configurada (a emissão responde "CA não configurada"). */
export function sshCa(raw: string | undefined = process.env.SSH_CA_SIGNING_KEY, comentario = "engemase-oee-ssh-ca"): SshCa | null {
  if (!raw || raw.trim() === "") return null
  const key = chavePrivada(raw)
  if (key.asymmetricKeyType !== "ed25519") throw new Error("SSH_CA_SIGNING_KEY precisa ser Ed25519")
  const caRaw = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32)
  const caBlob = pubBlob(caRaw)
  return {
    publicKeyLine: `${KEY_TYPE} ${caBlob.toString("base64")} ${comentario}`,
    fingerprint: impressaoDigital(caRaw),
    emitir(p) {
      const de = BigInt(Math.floor(p.validoDe.getTime() / 1000))
      const ate = BigInt(Math.floor(p.validoAte.getTime() / 1000))
      if (ate <= de) throw new Error("validade vazia")
      if (ate - de > BigInt(MAX_CERT_VALIDITY_S + 120)) throw new Error("validade acima de 8 h")
      if (p.principals.length === 0) throw new Error("certificado sem principal")
      const serial = p.serial ?? randomBytes(8).readBigUInt64BE() & BigInt("0x7fffffffffffffff")
      const origem = (p.origem ?? ["127.0.0.1/32", "::1/128"]).join(",")
      const corpo = Buffer.concat([
        str(CERT_TYPE),
        str(randomBytes(32)), // nonce
        str(p.chave.raw),
        u64(serial),
        u32(SSH2_CERT_TYPE_USER),
        str(p.keyId),
        lista(p.principals),
        u64(de),
        u64(ate),
        opcoes([["source-address", origem]]),
        // Só terminal: sem encaminhar portas, agente ou X11 e sem ~/.ssh/rc.
        opcoes([["permit-pty", null]]),
        str(Buffer.alloc(0)), // reservado
        str(caBlob),
      ])
      const assinatura = Buffer.concat([str(KEY_TYPE), str(sign(null, corpo, key))])
      const cert = Buffer.concat([corpo, str(assinatura)])
      return { linha: `${CERT_TYPE} ${cert.toString("base64")} ${p.keyId}`, serial }
    },
  }
}

/** CA das variáveis de ambiente; chave mal formada vai para o log e a emissão fica desligada. */
export function sshCaFromEnv(): SshCa | null {
  try {
    return sshCa()
  } catch (error) {
    console.error("[ssh] SSH_CA_SIGNING_KEY inválida: a emissão de certificados fica desligada até corrigir", error)
    return null
  }
}

/** Principal do gateway nos certificados (o gateway só aceita o próprio). */
export const principalDoGateway = (gatewayId: string) => `oee-gw-${gatewayId}`
