# Chaves públicas do OTA (pacote oee-gateway-updater)

O `oee-updater` só instala um pacote do agente cujo manifesto (`*.manifest.json`) tenha a
assinatura Ed25519 (`*.manifest.json.sig`) de uma das chaves `*.pub` deste diretório. Sem
nenhuma chave aqui, ele recusa tudo (falha fechada).

- Formato: uma linha com a chave pública em base64 (32 bytes); linhas com `#` são comentário.
- Nomes: `ota-AAAA.pub` (a atual) e `ota-AAAA+1.pub` (a próxima, para a troca anual).
- Gerar um par: `oee-updater keygen --out ota-2026`. A privada (`ota-2026.key`) vai para o cofre
  de senhas da empresa e para o segredo `OTA_SIGNING_KEY` do GitHub Actions (Settings → Secrets and
  variables → Actions; o conteúdo do arquivo, uma linha base64); **nunca** para o repositório. A pública vem para cá.
- O workflow `gateway-release.yml` assina com o segredo e confere com as `*.pub` daqui antes de publicar:
  chave privada e pública que não formam par falham no CI, não no gateway.
- **Só chaves do OTA aqui.** As da aprovação da VPN ficam em `../vpn-keys/` (o updater confia em todo `*.pub` desta pasta).
- Assinar: `oee-updater sign --deb oee-gateway_<versão>_<arq>.deb --version <versão> --arch <arq>
  --url <nome ou URL do .deb> --key ota-2026.key --out <dir>` (o `buffer_schema` vai sozinho).
