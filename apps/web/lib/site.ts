/**
 * Endereço público da plataforma (decisão D28). Por enquanto, só o domínio da Vercel: produto e gateways
 * usam o mesmo endereço. O domínio próprio (oee.engemase.com.br e gw.oee.engemase.com.br) fica para depois.
 *
 * É o ÚNICO lugar do app web com o endereço. Se o projeto na Vercel tiver outro nome, troque aqui e
 * tudo acompanha: ativação de gateway, pareamento de terminais, endereços no console de clientes e ajuda.
 */
export const PLATFORM_HOST = "engemase-oee.vercel.app"

/** URL base da plataforma (com https). */
export const PLATFORM_URL = `https://${PLATFORM_HOST}`

/** Endereço que o gateway usa para falar com a nuvem (o caminho /api/gateway/v1 é fixo no agente). */
export const GATEWAY_URL = PLATFORM_URL

/** Endereço de pareamento mostrado nas TVs e tablets. */
export const PAIRING_HOST = `${PLATFORM_HOST}/terminal`
