/**
 * Certificados SSH do acesso remoto (lib/server/remote/ssh-cert.ts): só chave Ed25519 do técnico, formato
 * ssh-ed25519-cert-v01@openssh.com assinado pela CA, principal do gateway, prazo, source-address e só
 * permit-pty. O teste de login de verdade (sshd com a config do pacote) foi feito à parte; aqui o ssh-keygen,
 * quando instalado, lê o certificado.
 */
import { execFileSync } from "node:child_process"
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { impressaoDigital, lerChaveDoTecnico, principalDoGateway, sshCa } from "@/lib/server/remote/ssh-cert"

function sshStr(v: Buffer | string): Buffer {
  const b = typeof v === "string" ? Buffer.from(v) : v
  const n = Buffer.alloc(4)
  n.writeUInt32BE(b.length)
  return Buffer.concat([n, b])
}
function chaveEd25519(): { linha: string; raw: Buffer } {
  const { publicKey } = generateKeyPairSync("ed25519")
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32)
  return { linha: `ssh-ed25519 ${Buffer.concat([sshStr("ssh-ed25519"), sshStr(raw)]).toString("base64")} tecnico@notebook`, raw }
}
function semente(): string {
  const { privateKey } = generateKeyPairSync("ed25519")
  return Buffer.from(privateKey.export({ format: "jwk" }).d!, "base64url").toString("base64")
}

class Leitor {
  constructor(
    readonly b: Buffer,
    private o = 0,
  ) {}
  str(): Buffer {
    const n = this.b.readUInt32BE(this.o)
    const v = this.b.subarray(this.o + 4, this.o + 4 + n)
    this.o += 4 + n
    return v
  }
  u32(): number {
    const v = this.b.readUInt32BE(this.o)
    this.o += 4
    return v
  }
  u64(): bigint {
    const v = this.b.readBigUInt64BE(this.o)
    this.o += 8
    return v
  }
  get pos() {
    return this.o
  }
  lista(): string[] {
    const r = new Leitor(this.str())
    const out: string[] = []
    while (r.pos < r.b.length) out.push(r.str().toString())
    return out
  }
}

describe("certificado SSH da sessão", () => {
  it("lê só a chave pública Ed25519 do técnico", () => {
    const k = chaveEd25519()
    expect(lerChaveDoTecnico(k.linha + "\n").raw.equals(k.raw)).toBe(true)
    expect(lerChaveDoTecnico(k.linha).fingerprint).toBe(impressaoDigital(k.raw))
    expect(() => lerChaveDoTecnico("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ== x")).toThrow(/Ed25519/)
    expect(() => lerChaveDoTecnico("-----BEGIN OPENSSH PRIVATE KEY-----\nabc")).toThrow(/PRIVADA/)
    expect(() => lerChaveDoTecnico("ssh-ed25519 não-é-base64")).toThrow()
    expect(() => lerChaveDoTecnico(`ssh-ed25519 ${Buffer.concat([sshStr("ssh-ed25519"), sshStr(Buffer.alloc(31))]).toString("base64")}`)).toThrow()
  })

  it("monta o certificado do usuário assinado pela CA, para o gateway, no prazo, só pelo encaminhamento local", () => {
    const ca = sshCa(semente(), "ca-teste")!
    const k = chaveEd25519()
    const de = new Date("2026-11-27T12:00:00Z")
    const ate = new Date("2026-11-27T13:00:00Z")
    const c = ca.emitir({ chave: lerChaveDoTecnico(k.linha), keyId: "engemase:u1:sessao:s1", principals: [principalDoGateway("gw1")], validoDe: de, validoAte: ate, serial: BigInt(42) })
    const [tipo, b64, comentario] = c.linha.split(" ")
    expect(tipo).toBe("ssh-ed25519-cert-v01@openssh.com")
    expect(comentario).toBe("engemase:u1:sessao:s1")
    const blob = Buffer.from(b64!, "base64")
    const r = new Leitor(blob)
    expect(r.str().toString()).toBe("ssh-ed25519-cert-v01@openssh.com")
    expect(r.str().length).toBe(32) // nonce
    expect(r.str().equals(k.raw)).toBe(true)
    expect(r.u64()).toBe(BigInt(42))
    expect(r.u32()).toBe(1) // certificado de usuário
    expect(r.str().toString()).toBe("engemase:u1:sessao:s1")
    expect(r.lista()).toEqual(["oee-gw-gw1"])
    expect(Number(r.u64())).toBe(de.getTime() / 1000)
    expect(Number(r.u64())).toBe(ate.getTime() / 1000)
    const criticas = new Leitor(r.str())
    expect(criticas.str().toString()).toBe("source-address")
    expect(new Leitor(criticas.str()).str().toString()).toBe("127.0.0.1/32,::1/128")
    const ext = new Leitor(r.str())
    expect(ext.str().toString()).toBe("permit-pty")
    expect(ext.str().length).toBe(0)
    expect(ext.pos).toBe(ext.b.length) // só permit-pty
    expect(r.str().length).toBe(0) // reservado
    const caBlob = r.str()
    const fimDoCorpo = r.pos
    const ass = new Leitor(r.str())
    expect(ass.str().toString()).toBe("ssh-ed25519")
    const caRaw = new Leitor(caBlob, 0)
    caRaw.str()
    const pub = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), caRaw.str()]), format: "der", type: "spki" })
    expect(verify(null, blob.subarray(0, fimDoCorpo), pub, ass.str())).toBe(true)
    expect(ca.publicKeyLine.startsWith("ssh-ed25519 ")).toBe(true)
  })

  it("recusa prazo vazio, acima de 8 h ou sem principal; sem chave = desligado", () => {
    const ca = sshCa(semente())!
    const chave = lerChaveDoTecnico(chaveEd25519().linha)
    const t = Date.parse("2026-11-27T12:00:00Z")
    expect(() => ca.emitir({ chave, keyId: "x", principals: ["p"], validoDe: new Date(t), validoAte: new Date(t) })).toThrow()
    expect(() => ca.emitir({ chave, keyId: "x", principals: ["p"], validoDe: new Date(t), validoAte: new Date(t + 9 * 3600e3) })).toThrow(/8 h/)
    expect(() => ca.emitir({ chave, keyId: "x", principals: [], validoDe: new Date(t), validoAte: new Date(t + 3600e3) })).toThrow()
    expect(sshCa(undefined)).toBeNull()
    expect(sshCa("")).toBeNull()
    expect(() => sshCa("curta")).toThrow()
  })

  it("o ssh-keygen do OpenSSH lê o certificado (quando instalado)", () => {
    let temSsh = true
    try {
      execFileSync("ssh-keygen", ["-?"], { stdio: "ignore" })
    } catch (e) {
      temSsh = (e as { status?: number }).status !== undefined && (e as { code?: string }).code !== "ENOENT"
    }
    if (!temSsh) return
    const ca = sshCa(semente())!
    const dir = mkdtempSync(join(tmpdir(), "ssh-cert-"))
    const c = ca.emitir({ chave: lerChaveDoTecnico(chaveEd25519().linha), keyId: "engemase:u1:sessao:s1", principals: ["oee-gw-gw1"], validoDe: new Date(), validoAte: new Date(Date.now() + 3600e3) })
    writeFileSync(join(dir, "k-cert.pub"), c.linha + "\n")
    const out = execFileSync("ssh-keygen", ["-L", "-f", join(dir, "k-cert.pub")]).toString()
    expect(out).toContain("user certificate")
    expect(out).toContain("oee-gw-gw1")
    expect(out).toContain("source-address 127.0.0.1/32,::1/128")
    expect(out).toContain(`Signing CA: ED25519 ${ca.fingerprint}`)
  })
})
