import { describe, expect, it } from "vitest"
import { qrDrawing } from "@/lib/qr"

describe("qrDrawing", () => {
  it("desenha um QR com os três quadrados de posição e sem nada fora da área", () => {
    const { size, path } = qrDrawing("otpauth://totp/Engemase%20OEE:pessoa@exemplo.test?secret=JBSWY3DPEHPK3PXP&issuer=Engemase%20OEE")
    expect(size).toBeGreaterThanOrEqual(21)
    // Primeira linha dos localizadores: 7 módulos escuros nos cantos de cima.
    expect(path.startsWith("M0 0h7v1h-7z")).toBe(true)
    expect(path).toContain(`M${size - 7} 0h7v1h-7z`)
    for (const [, x, y, w] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      expect(Number(x) + Number(w)).toBeLessThanOrEqual(size)
      expect(Number(y)).toBeLessThan(size)
    }
    expect(path.replace(/M\d+ \d+h\d+v1h-\d+z/g, "")).toBe("")
  })

  it("textos diferentes dão desenhos diferentes", () => {
    expect(qrDrawing("otpauth://totp/a?secret=AAAA").path).not.toBe(qrDrawing("otpauth://totp/a?secret=BBBB").path)
  })
})
