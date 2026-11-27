/**
 * GET /api/gateway/v1/vpn-approval-key — chave PÚBLICA da aprovação assinada do acesso remoto (docs/12):
 * `kid` e os 32 bytes Ed25519 em base64. É pública por natureza (só confere assinaturas); serve para
 * conferir e embutir no pacote do gateway. Sem chave configurada: 404.
 */
import { connection } from "next/server"
import { approvalSignerFromEnv } from "@/lib/server/remote/approval"

export async function GET(): Promise<Response> {
  await connection()
  const signer = approvalSignerFromEnv()
  if (signer === null) return Response.json({ error: "sem chave de aprovação configurada" }, { status: 404, headers: { "Cache-Control": "no-store" } })
  return Response.json({ alg: "EdDSA", kid: signer.kid, public_key: signer.publicKeyBase64 }, { headers: { "Cache-Control": "no-store" } })
}
