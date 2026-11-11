import { createHash } from "node:crypto"

/**
 * Ids fixos (UUIDv7 determinísticos) usados nas fixtures.
 * Os nomes espelham os apelidos ilustrativos da documentação (mch_inj03, dev_inj03...).
 */
export const ID = {
  gateway: "01a1599c-a300-7f51-9864-1073dc9781ca",
  bus1: "01a1599d-9148-75c2-9673-d03229272dbb",
  devInj03: "01a1599e-7f90-7b47-976d-2b40a6cb24c1",
  devSop01: "01a1599f-6dd8-7db6-9a8a-791a5e7de581",
  devSop02: "01a159a0-5c20-7fb9-ad36-a2297f2a5938",
  mchInj03: "01a159a1-4a68-72de-9057-14e72d836a47",
  mchSop01: "01a159a2-38b0-7555-be5d-085243562821",
  mchSop02: "01a159a3-26f8-7054-97ed-cbbedbcc67da",
  tagInjHeartbeat: "01a159a4-1540-74dd-a3e5-239a6a4ca4df",
  tagInjState: "01a159a5-0388-7c92-8248-4dd1953e51e0",
  tagInjFault: "01a159a5-f1d0-76fa-a2bb-a449aa22b3e3",
  tagInjTotal: "01a159a6-e018-779c-9647-cae69dd0eeb2",
  tagInjReject: "01a159a7-ce60-7646-890e-0d4462a5fa79",
  tagInjProduct: "01a159a8-bca8-76bf-9ec7-ea2e7cc0597a",
  tagInjSpeed: "01a159a9-aaf0-72ed-8156-c9e95d16bd41",
  tagInjTemp: "01a159aa-9938-7379-92bb-ea1d43c0b4ad",
  tagSop01Running: "01a159ab-8780-75bf-a95b-c279438d3082",
  tagSop01Total: "01a159ac-75c8-7302-ac5e-eea971e7d771",
  tagSop01Fault: "01a159ad-6410-788a-a1b2-917c7dd87fd8",
  tagSop02Total: "01a159ae-5258-7f45-aa37-28b47afdb40d",
  devIoLinha2: "01a159af-40a0-7396-b13d-85d8997cfd99",
  mchPrensa07: "01a159b0-2ee8-7c06-9e35-43ec7154c7bf",
  tagPrensaRunning: "01a159b1-1d30-7223-994f-433a46876c8f",
  tagPrensaTotal: "01a159b2-0b78-7bd0-9d7a-6fa70b7e9436",
  // Comandos e sessões
  cmdTagReadDone: "01a1cab3-4a30-7ebd-8d23-3e773df04d25",
  cmdDeviceTestDone: "01a1cab3-4e18-7c1c-abb8-748cc06b2bb7",
  cmdUnknownDone: "01a1cab3-5200-7abc-893a-62f99640b0df",
  cmdTagRead: "01a1cab3-55e8-7cf0-a52e-692c5f1aac62",
  cmdDeviceTest: "01a1cab3-59d0-74e2-aa70-5ede7ef9053c",
  cmdConfigReload: "01a1cab3-5db8-7495-9ef3-d1edb6c3051b",
  cmdAgentRestart: "01a1cab3-61a0-7cba-9290-43975497e9b6",
  cmdModbusScan: "01a1cab3-6588-7732-8c1b-c364878a0e1f",
  cmdVpnEnable: "01a1cab3-6970-7364-b760-3a437894d006",
  cmdVpnDisable: "01a1cab3-6d58-7d30-ae21-4f8c243d297d",
  cmdVpnStatus: "01a1cab3-7140-71b7-bb90-dd1057d31fe9",
  cmdOtForwardOpen: "01a1cab3-7528-73c9-b692-6e56b454d05d",
  cmdOtForwardClose: "01a1cab3-7910-7e62-8c88-888f9222f5d9",
  vpnSession: "01a1cab3-7cf8-7f23-8fdf-c01d84c79403",
  otForward: "01a1cab3-5db8-7cc1-b976-af6c144eba3d",
  newDevice: "01a1cab3-6074-7dc2-ad6e-d8225a5aee79",
  // Eventos (UUIDv7 com o timestamp do próprio evento)
  evtSop01Running: "01a1cab1-cc5a-7af4-9800-bf5c8c603e5f",
  evtInjProduct: "01a1cab2-06f2-7a82-ad95-74bafabec1c8",
  evtSop02Reset: "01a1cab2-418a-77af-a200-8aa6ff00d3eb",
  evtInjFault: "01a1cab3-2bea-7244-bb03-702b326efb32",
  bootId: "41ff610f-e874-4dc0-bc5a-eb253706854f",
} as const

/**
 * UUIDv7 determinístico: timestamp de `iso` + bits "aleatórios" derivados de `seed`.
 * Usado para ids de eventos e comandos extras das fixtures.
 */
export function uuidv7At(iso: string, seed: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`timestamp inválido: ${iso}`)
  const bytes = new Uint8Array(16)
  let t = BigInt(ms)
  for (let k = 5; k >= 0; k--) {
    bytes[k] = Number(t & 0xffn)
    t >>= 8n
  }
  const rnd = createHash("sha256").update(seed).digest()
  for (let k = 6; k < 16; k++) bytes[k] = rnd[k] ?? 0
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Buffer.from(bytes).toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
