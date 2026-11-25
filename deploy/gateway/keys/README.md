# Chaves públicas do OTA (pacote oee-gateway-updater)

O `oee-updater` só instala um pacote do agente cujo manifesto (`*.manifest.json`) tenha a
assinatura Ed25519 (`*.manifest.json.sig`) de uma das chaves `*.pub` deste diretório. Sem
nenhuma chave aqui, ele recusa tudo (falha fechada).

- Formato: uma linha com a chave pública em base64 (32 bytes); linhas com `#` são comentário.
- Nomes: `ota-AAAA.pub` (a atual) e `ota-AAAA+1.pub` (a próxima, para a troca anual).
- Gerar um par: `oee-updater keygen --out ota-2026`. A privada (`ota-2026.key`) vai para o cofre
  de senhas da empresa e para o segredo do CI; **nunca** para o repositório. A pública vem para cá.
- Assinar: `oee-updater sign --deb oee-gateway_<versão>_<arq>.deb --version <versão> --arch <arq>
  --url <nome ou URL do .deb> --key ota-2026.key --out <dir>` (o `buffer_schema` vai sozinho).
