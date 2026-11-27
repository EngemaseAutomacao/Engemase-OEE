/**
 * Aprovação assinada do acesso remoto (docs/12, contrato `VpnApprovalClaimsSchema`): JWS compacto, alg
 * EdDSA (Ed25519), `kid` no cabeçalho. O gateway confere a assinatura com a chave pública que vem no
 * pacote dele: sem aprovação válida, nenhum gateway abre, mesmo que a plataforma seja comprometida.
 *
 * Chave privada em `VPN_APPROVAL_SIGNING_KEY` (PEM PKCS#8 ou a semente de 32 bytes em base64), nunca no
 * código nem em log. `kid` = 16 primeiros hex do SHA-256 da chave pública crua (32 bytes).
 */
import { createHash, createPrivateKey, createPublicKey, type KeyObject, sign } from "node:crypto"
import { type VpnApprovalClaims, VpnApprovalClaimsSchema } from "@engemase/contracts"

/** Prefixo DER PKCS#8 de uma chave Ed25519 (seguido dos 32 bytes da semente). */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex")

export interface ApprovalSigner {
  readonly kid: string
  /** Chave pública crua (32 bytes) em base64, para o pacote do gateway. */
  readonly publicKeyBase64: string
  sign(claims: VpnApprovalClaims): string
}

const b64url = (buf: Buffer) => buf.toString("base64url")

function chavePrivada(raw: string): KeyObject {
  const v = raw.trim()
  if (v.includes("BEGIN")) return createPrivateKey(v)
  const seed = Buffer.from(v, "base64")
  if (seed.length !== 32) throw new Error("VPN_APPROVAL_SIGNING_KEY: esperada a semente Ed25519 de 32 bytes em base64 ou um PEM PKCS#8")
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" })
}

/** Assinador a partir da chave; `null` sem chave configurada (a VPN fica desligada na plataforma). */
export function approvalSigner(raw: string | undefined = process.env.VPN_APPROVAL_SIGNING_KEY): ApprovalSigner | null {
  if (!raw || raw.trim() === "") return null
  const key = chavePrivada(raw)
  if (key.asymmetricKeyType !== "ed25519") throw new Error("VPN_APPROVAL_SIGNING_KEY precisa ser Ed25519")
  const pub = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32)
  const kid = createHash("sha256").update(pub).digest("hex").slice(0, 16)
  return {
    kid,
    publicKeyBase64: pub.toString("base64"),
    sign(claims) {
      const valid = VpnApprovalClaimsSchema.parse(claims)
      const header = b64url(Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid })))
      const payload = b64url(Buffer.from(JSON.stringify(valid)))
      const signature = sign(null, Buffer.from(`${header}.${payload}`), key)
      return `${header}.${payload}.${b64url(signature)}`
    },
  }
}

/** Assinador das variáveis de ambiente; chave mal formada vai para o log e desliga a VPN (falha fechada). */
export function approvalSignerFromEnv(): ApprovalSigner | null {
  try {
    return approvalSigner()
  } catch (error) {
    console.error("[vpn] VPN_APPROVAL_SIGNING_KEY inválida: a VPN fica desligada até corrigir", error)
    return null
  }
}
