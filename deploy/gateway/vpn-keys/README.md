# Chave pública da aprovação assinada do acesso remoto (VPN)

**Pasta separada de propósito:** `../keys/` é a lista de chaves em que o atualizador (OTA) confia. Uma
chave da VPN lá dentro permitiria que quem tem a chave privada da VPN assinasse "atualizações" para os
gateways. Nunca misture as duas.

| Arquivo | Para quê | Onde está a privada |
|---|---|---|
| `vpn-approval-<kid>.pub` | Conferir a **aprovação assinada** (JWS EdDSA, `kid` no cabeçalho) antes de ligar a VPN (docs/12) | Vercel, `VPN_APPROVAL_SIGNING_KEY` (Sensitive, só produção) |

Formato: os 32 bytes da chave pública Ed25519 em base64. O `kid` é o começo (16 hex) do SHA-256 desses
32 bytes; a plataforma publica a chave atual em `GET /api/gateway/v1/vpn-approval-key`.

Troca da chave: gere a nova privada, copie a nova pública para cá **sem apagar a anterior**, publique o
pacote do gateway e só depois troque a variável na Vercel. A anterior sai no pacote seguinte.
