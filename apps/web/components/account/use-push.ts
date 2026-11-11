"use client"

import { useCallback, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"

export type PushPermission = "granted" | "denied" | "default" | "unsupported" | "unknown"

const TEST_TITLE = "Engemase OEE"
const ICON = "/brand/engemase-icone.png"

function readPermission(): PushPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported"
  return Notification.permission
}

/** Acompanha mudanças feitas fora da página (ex.: o usuário libera nas configurações do navegador). */
function subscribePermission(onChange: () => void) {
  let status: PermissionStatus | undefined
  let cancelled = false
  navigator.permissions
    ?.query({ name: "notifications" })
    .then((s) => {
      if (cancelled) return
      status = s
      s.addEventListener("change", onChange)
    })
    .catch(() => {})
  return () => {
    cancelled = true
    status?.removeEventListener("change", onChange)
  }
}

/** iPhone/iPad fora do app instalado: o push só funciona depois de "Adicionar à Tela de Início" (iOS 16.4+). */
function needsIosInstall() {
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  if (!ios) return false
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  return !standalone
}

/**
 * Mostra a notificação de teste. No Android o construtor `new Notification()` não existe
 * (exige service worker), então tenta primeiro pelo service worker registrado.
 */
async function showTestNotification(body: string): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(TEST_TITLE, { body, icon: ICON, tag: "engemase-teste" })
      return true
    }
  } catch {
    // segue para o construtor
  }
  try {
    new Notification(TEST_TITLE, { body, icon: ICON, tag: "engemase-teste" })
    return true
  } catch {
    return false
  }
}

/**
 * Permissão de notificação deste navegador e ações "ativar" e "testar".
 * A permissão só é pedida dentro do clique (exigência dos navegadores; docs/13).
 */
export function usePush({ onIosInstall }: { onIosInstall?: () => void } = {}) {
  const [, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const permission = useSyncExternalStore<PushPermission>(subscribePermission, readPermission, () => "unknown")

  const enable = useCallback(async () => {
    if (typeof window === "undefined") return false
    if (needsIosInstall()) {
      onIosInstall?.()
      toast.info("No iPhone e no iPad, instale o app na Tela de Início para receber notificações.")
      return false
    }
    if (!("Notification" in window)) {
      toast.error("Este navegador não suporta notificações. Use Chrome, Edge, Firefox ou Safari atualizados.")
      return false
    }
    setBusy(true)
    try {
      const result = await Notification.requestPermission()
      setTick((t) => t + 1)
      if (result !== "granted") {
        toast.warning(
          result === "denied"
            ? "As notificações estão bloqueadas. Libere em Configurações do site (ícone de cadeado na barra de endereço)."
            : "Permissão não concedida. Toque em “Ativar” de novo quando quiser.",
        )
        return false
      }
      const shown = await showTestNotification("Notificações ativadas neste dispositivo. Você vai receber aqui os alertas das suas máquinas.")
      toast.success(shown ? "Notificações ativadas neste dispositivo" : "Permissão concedida. A notificação de teste não pôde ser exibida neste navegador.")
      return true
    } finally {
      setBusy(false)
    }
  }, [onIosInstall])

  const test = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") {
      toast.info("Ative as notificações neste dispositivo primeiro.")
      return
    }
    const shown = await showTestNotification("Teste: Injetora 03 parada há 14 min · Linha Injeção A")
    if (shown) toast.success("Notificação de teste enviada")
    else toast.error("Não foi possível exibir a notificação neste navegador.")
  }, [])

  return { permission, busy, enable, test }
}

export const PERMISSION_LABEL: Record<PushPermission, { label: string; hint: string; tone: "ok" | "warn" | "off" | "muted" }> = {
  granted: { label: "Ativadas neste dispositivo", hint: "Você recebe os alertas aqui mesmo com a aba em segundo plano.", tone: "ok" },
  denied: { label: "Bloqueadas no navegador", hint: "Libere em Configurações do site (cadeado na barra de endereço) e recarregue a página.", tone: "warn" },
  default: { label: "Ainda não ativadas", hint: "Toque em “Ativar” e permita quando o navegador perguntar.", tone: "off" },
  unsupported: { label: "Não suportado neste navegador", hint: "No iPhone/iPad, instale o app na Tela de Início. Em computadores, use Chrome, Edge, Firefox ou Safari.", tone: "muted" },
  unknown: { label: "Verificando…", hint: "", tone: "muted" },
}
