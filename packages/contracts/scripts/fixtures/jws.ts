/**
 * Assinatura das aprovações (JWS compacto, EdDSA/Ed25519) usadas nas fixtures.
 *
 * SOMENTE PARA TESTES: a chave privada é derivada de uma semente pública e fixa,
 * para que as fixtures sejam reprodutíveis (Ed25519 é determinístico). A chave
 * pública vai em fixtures/test-keys.json para o agente Go verificar as assinaturas.
 */
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto"

export const TEST_KEY_ID = "test-approval-2026-1"
const TEST_SEED_PHRASE = "engemase-oee/contracts/fixtures/approval-key (somente testes)"

// PKCS#8 DER de uma chave Ed25519: prefixo fixo + semente de 32 bytes.
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex")
const seed = createHash("sha256").update(TEST_SEED_PHRASE).digest()
const privateKey = createPrivateKey({
  key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
  format: "der",
  type: "pkcs8",
})

function base64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url")
}

/** Assina as claims e devolve o JWS compacto (header.payload.assinatura). */
export function signApproval(claims: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "EdDSA", kid: TEST_KEY_ID }))
  const payload = base64url(JSON.stringify(claims))
  const signature = sign(null, Buffer.from(`${header}.${payload}`), privateKey)
  return `${header}.${payload}.${base64url(signature)}`
}

/** Chave pública de teste em JWK (OKP/Ed25519). */
export function testPublicKeyJwk(): Record<string, unknown> {
  const jwk = createPublicKey(privateKey).export({ format: "jwk" })
  return { ...jwk, kid: TEST_KEY_ID, alg: "EdDSA", use: "sig" }
}
