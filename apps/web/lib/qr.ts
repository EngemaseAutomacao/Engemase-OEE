/**
 * QR code de verdade (biblioteca `qrcode`): devolve o desenho pronto para um `<path>` de SVG, sem
 * imagem nem HTML cru. Usado no cadastro da verificação em duas etapas (o aplicativo autenticador lê
 * o endereço `otpauth://`). Roda no servidor: a biblioteca não vai para o navegador.
 */
import QRCode from "qrcode"

export interface QrDrawing {
  /** Lado do QR, em módulos (sem a margem). */
  readonly size: number
  /** Módulos escuros como caminho SVG (1 unidade = 1 módulo). */
  readonly path: string
}

export function qrDrawing(text: string): QrDrawing {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" })
  const { size, data } = modules
  let path = ""
  for (let y = 0; y < size; y++) {
    let x = 0
    while (x < size) {
      if (!data[y * size + x]) {
        x++
        continue
      }
      const start = x
      while (x < size && data[y * size + x]) x++
      path += `M${start} ${y}h${x - start}v1h-${x - start}z`
    }
  }
  return { size, path }
}
