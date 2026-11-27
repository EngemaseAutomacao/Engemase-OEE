# Chaves públicas confiáveis do gateway

| Arquivo | Para quê | Onde está a privada |
|---|---|---|
| `vpn-approval-<kid>.pub` | Conferir a **aprovação assinada** do acesso remoto (JWS EdDSA, `kid` no cabeçalho) antes de ligar a VPN (docs/12) | Vercel, variável `VPN_APPROVAL_SIGNING_KEY` (Sensitive, só produção) |

Formato: os 32 bytes da chave pública Ed25519 em base64, uma por arquivo. O `kid` é o começo (16 hex) do
SHA-256 desses 32 bytes; a plataforma publica a chave atual em `GET /api/gateway/v1/vpn-approval-key`.

Troca da chave: gere a nova privada na Vercel, copie a nova pública para cá **sem apagar a anterior**,
publique o pacote do gateway e só depois troque a variável na Vercel. A anterior sai no pacote seguinte.
Estes arquivos vão no pacote do gateway; só a parte pública fica no repositório.
