/**
 * Cálculo da identidade visual no cliente (prévia do editor de Aparência, docs/14).
 * Na versão real o mesmo algoritmo roda no servidor e grava os tokens em `client_branding.tokens`.
 *
 * - Contraste: fórmula de luminância relativa da WCAG 2.x.
 * - Ajuste da primária: OKLCH, mudando só a luminosidade (mantém o matiz) até ≥ 4,5:1.
 * - Proximidade das cores de estado: heurística por matiz (OKLCH), com tolerância por estado.
 */
import { STATE_META } from "@/lib/states"
import type { MachineState } from "@/lib/mock/types"
import type { BrandTokens, SidebarMode } from "@/components/settings/types"

export const ENGEMASE_BRAND = "#257bb4"
export const AA = 4.5

/** Fundos do tema (app/globals.css): cartão e fundo da página. */
export const LIGHT_SURFACES = ["#ffffff", "#f3f6f9"] as const
export const DARK_SURFACES = ["#132131", "#0d1723"] as const
const DARK_TEXT = "#0a1622"

/** Tokens oficiais Engemase (globals.css): o azul da marca levemente escurecido no claro. */
export const ENGEMASE_TOKENS: BrandTokens = {
  light: { primary: "#2272ab", ring: "#2272ab", sidebar: "#2c4e73" },
  dark: { primary: "#4a9fd6", ring: "#4a9fd6", sidebar: "#172b42" },
}

// ---------------------------------------------------------------------------
// Conversões
// ---------------------------------------------------------------------------
export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, "").toLowerCase()
  if (/^[0-9a-f]{3}$/.test(s)) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`
  return null
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]: [number, number, number]) {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

/** Luminância relativa (WCAG 2.x). */
export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => toLinear(v / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Razão de contraste WCAG entre duas cores (1 a 21). */
export function contrast(a: string, b: string) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const minContrast = (fg: string, surfaces: readonly string[]) => Math.min(...surfaces.map((s) => contrast(fg, s)))

export interface Oklch {
  l: number
  c: number
  h: number
}

export function toOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map((v) => toLinear(v / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const h = (Math.atan2(B, A) * 180) / Math.PI
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h }
}

function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180)
  const B = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005)

/** OKLCH → hex, reduzindo o croma (sem mudar matiz nem luminosidade) até caber no sRGB. */
export function fromOklch(color: Oklch): string {
  let { c } = color
  let rgb = oklchToLinear({ ...color, c })
  if (!inGamut(rgb)) {
    let lo = 0
    let hi = c
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear({ ...color, c: mid }))) lo = mid
      else hi = mid
    }
    c = lo
    rgb = oklchToLinear({ ...color, c })
  }
  return rgbToHex(rgb.map((v) => toGamma(Math.min(1, Math.max(0, v))) * 255) as [number, number, number])
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
export interface ModeTokens {
  primary: string
  ring: string
  onPrimary: string
  onPrimaryRatio: number
  /** Contraste da primária contra o pior fundo (cartão ou página). */
  ratio: number
  sidebar: string
  sidebarFg: string
  sidebarActiveBg: string
  sidebarActiveFg: string
}

export interface BrandAnalysis {
  light: ModeTokens & { originalRatio: number; adjusted: boolean }
  dark: ModeTokens
  proximity: StateProximity
  neutral: boolean
}

export interface StateProximity {
  level: "ok" | "warn" | "block"
  state: MachineState | null
  stateLabel: string | null
  distance: number | null
}

const PROXIMITY_RULES: { state: MachineState; label: string; warn: number; block: number }[] = [
  { state: "RUNNING", label: "verde de “Produzindo”", warn: 22, block: 12 },
  { state: "STOPPED", label: "âmbar de “Parada”", warn: 24, block: 12 },
  { state: "FAULT", label: "vermelho de “Falha”", warn: 22, block: 12 },
  // violeta e índigo de marca são comuns: tolerância menor para o setup
  { state: "SETUP", label: "violeta de “Setup”", warn: 10, block: 6 },
]

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Heurística por matiz: cores com pouco croma (cinzas, grafite) nunca conflitam. */
export function stateProximity(hex: string): StateProximity {
  const o = toOklch(hex)
  if (o.c < 0.06) return { level: "ok", state: null, stateLabel: null, distance: null }
  let best: StateProximity = { level: "ok", state: null, stateLabel: null, distance: null }
  for (const rule of PROXIMITY_RULES) {
    const d = hueDistance(o.h, toOklch(STATE_META[rule.state].hex).h)
    const level = d <= rule.block ? "block" : d <= rule.warn ? "warn" : "ok"
    const rank = { ok: 0, warn: 1, block: 2 }
    if (rank[level] > rank[best.level] || (level !== "ok" && rank[level] === rank[best.level] && d < (best.distance ?? 999))) {
      best = { level, state: rule.state, stateLabel: rule.label, distance: d }
    }
  }
  return best
}

const onColor = (bg: string) => {
  const white = contrast("#ffffff", bg)
  const dark = contrast(DARK_TEXT, bg)
  return white >= AA || white >= dark ? { fg: "#ffffff", ratio: white } : { fg: DARK_TEXT, ratio: dark }
}

function lightPrimary(brand: string) {
  const originalRatio = minContrast(brand, LIGHT_SURFACES)
  if (originalRatio >= AA) return { primary: brand, originalRatio, adjusted: false }
  const o = toOklch(brand)
  let hex = brand
  for (let l = o.l; l > 0.15; l -= 0.005) {
    hex = fromOklch({ ...o, l })
    if (minContrast(hex, LIGHT_SURFACES) >= AA) break
  }
  return { primary: hex, originalRatio, adjusted: true }
}

function darkPrimary(brand: string) {
  const o = toOklch(brand)
  // mais claro que no tema claro, mas sem virar pastel (cores já claras, como amarelo, ficam como estão)
  const start = Math.min(Math.max(o.l + 0.1, 0.68), Math.max(o.l, 0.82))
  let hex = fromOklch({ ...o, l: start })
  for (let l = start; l < 0.97; l += 0.005) {
    hex = fromOklch({ ...o, l })
    if (minContrast(hex, DARK_SURFACES) >= AA) break
  }
  return hex
}

function sidebarFor(mode: SidebarMode, brand: string, theme: "light" | "dark", primary: string, stored?: string) {
  if (mode === "light") {
    return theme === "light"
      ? { sidebar: "#ffffff", sidebarFg: "#13253a", sidebarActiveBg: `color-mix(in oklab, ${primary} 12%, white)`, sidebarActiveFg: primary }
      : { sidebar: "#132131", sidebarFg: "#d3dfeb", sidebarActiveBg: `color-mix(in oklab, ${primary} 18%, #132131)`, sidebarActiveFg: primary }
  }
  let bg: string
  if (mode === "neutral") bg = ENGEMASE_TOKENS[theme].sidebar
  else {
    const o = toOklch(brand)
    bg = stored ?? fromOklch({ l: theme === "light" ? 0.32 : 0.25, c: Math.min(o.c * 0.55, theme === "light" ? 0.07 : 0.05), h: o.h })
  }
  return { sidebar: bg, sidebarFg: "#dbe6f1", sidebarActiveBg: `color-mix(in oklab, ${bg} 78%, white)`, sidebarActiveFg: "#ffffff" }
}

/**
 * Calcula os tokens de claro e escuro para uma cor de marca.
 * `stored` = tokens já gravados (identidade salva do cliente) para a mesma cor e modo de menu.
 */
export function analyzeBrand(brand: string, mode: SidebarMode, stored?: BrandTokens | null): BrandAnalysis {
  const isEngemase = brand.toLowerCase() === ENGEMASE_BRAND
  const base = stored ?? (isEngemase ? ENGEMASE_TOKENS : null)

  const lp = lightPrimary(brand)
  const lightPri = base?.light.primary ?? lp.primary
  const darkPri = base?.dark.primary ?? darkPrimary(brand)
  const lightOn = onColor(lightPri)
  const darkOn = onColor(darkPri)
  const storedSidebar = stored && mode === "brand-dark"

  return {
    light: {
      primary: lightPri,
      ring: lightPri,
      onPrimary: lightOn.fg,
      onPrimaryRatio: lightOn.ratio,
      ratio: minContrast(lightPri, LIGHT_SURFACES),
      originalRatio: lp.originalRatio,
      adjusted: lightPri.toLowerCase() !== brand.toLowerCase(),
      ...sidebarFor(mode, brand, "light", lightPri, storedSidebar ? stored.light.sidebar : undefined),
    },
    dark: {
      primary: darkPri,
      ring: darkPri,
      onPrimary: darkOn.fg,
      onPrimaryRatio: darkOn.ratio,
      ratio: minContrast(darkPri, DARK_SURFACES),
      ...sidebarFor(mode, brand, "dark", darkPri, storedSidebar ? stored.dark.sidebar : undefined),
    },
    proximity: stateProximity(brand),
    neutral: toOklch(brand).c < 0.06,
  }
}

export const ratioLabel = (r: number) => `${r.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}:1`
