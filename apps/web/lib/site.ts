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

/** Contato e dados públicos da Engemase, mostrados na página inicial (apresentação do produto). */
export const COMPANY = {
  name: "Engemase Engenharia",
  email: "engemase@engemase.com.br",
  phone: "(49) 3565-2016",
  phoneHref: "tel:+554935652016",
  whatsapp: "(49) 99816-4377",
  whatsappNumber: "5549998164377",
  address: ["Rua Leonardo Granemann, 443", "Alto Bonito, Caçador/SC", "CEP 89.510-537"],
  site: "https://engemase.com.br/",
  social: {
    facebook: "https://www.facebook.com/engemase",
    instagram: "https://www.instagram.com/engemaseengenharia/",
    linkedin: "https://www.linkedin.com/company/76475350/",
  },
} as const

/** Link do WhatsApp com mensagem pronta. */
export const whatsappHref = (text: string) =>
  `https://api.whatsapp.com/send?phone=${COMPANY.whatsappNumber}&text=${encodeURIComponent(text)}`

/** E-mail comercial (o mesmo e-mail geral da Engemase). */
export const SALES_EMAIL = COMPANY.email
