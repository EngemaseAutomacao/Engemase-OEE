import { isIP } from "node:net"

/**
 * IP de quem fez o pedido, para os limites de tentativa. Na Vercel o `x-forwarded-for` é escrito pela
 * plataforma (o primeiro endereço é o do cliente). Só vale se for um IP; sem IP, `null`.
 */
export function requestIp(headers: Headers): string | null {
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? ""
  return isIP(ip) !== 0 ? ip : null
}
