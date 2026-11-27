"use client"

/**
 * "Quem está operando?" (D18): lista dos operadores do chão da unidade, em botões grandes para o tablet.
 * A escolha fica no próprio aparelho (`useFloorOperator`) e vai junto de cada apontamento; o servidor confere
 * se o operador está ativo e é da unidade da máquina.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from "react"
import { SearchIcon, UserRoundIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { initials } from "@/lib/format"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import type { FloorOperator } from "@/components/kiosk/operator-types"

const KEY = (scope: string) => `oee-operador:${scope}`
const EVENT = "oee-operador"

function read(scope: string): { id: string; shift: string } | null {
  try {
    const raw = window.localStorage.getItem(KEY(scope))
    if (raw === null) return null
    const v = JSON.parse(raw) as { id?: unknown; shift?: unknown }
    return typeof v.id === "string" && typeof v.shift === "string" ? { id: v.id, shift: v.shift } : null
  } catch {
    return null
  }
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb)
  window.addEventListener(EVENT, cb)
  return () => {
    window.removeEventListener("storage", cb)
    window.removeEventListener(EVENT, cb)
  }
}

/**
 * Operador escolhido neste aparelho. Vale só no mesmo turno (na troca de turno o tablet pergunta de novo) e só
 * se ainda está na lista (desativado ou de outra unidade → pergunta de novo).
 */
export function useFloorOperator(scope: string, operators: FloorOperator[], shiftName: string) {
  const storedId = useSyncExternalStore(
    subscribe,
    () => {
      const v = read(scope)
      return v !== null && v.shift === shiftName ? v.id : null
    },
    () => null,
  )
  const current = useMemo(() => operators.find((o) => o.id === storedId) ?? null, [operators, storedId])
  const choose = useCallback(
    (op: FloorOperator) => {
      try {
        window.localStorage.setItem(KEY(scope), JSON.stringify({ id: op.id, shift: shiftName }))
      } catch {
        // Sem armazenamento (modo privado): a escolha vale só até recarregar a tela.
      }
      window.dispatchEvent(new Event(EVENT))
    },
    [scope, shiftName],
  )
  return { current, choose, required: operators.length > 0 }
}

export function FloorOperatorPicker({
  open,
  onOpenChange,
  operators,
  currentId,
  machineName,
  onChoose,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  operators: FloorOperator[]
  currentId: string | null
  machineName: string
  onChoose: (op: FloorOperator) => void
}) {
  const [query, setQuery] = useState("")
  const q = query.trim().toLocaleLowerCase("pt-BR")
  const list = q === "" ? operators : operators.filter((o) => o.name.toLocaleLowerCase("pt-BR").includes(q) || (o.employeeCode ?? "").toLocaleLowerCase("pt-BR").includes(q))

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Sem operador escolhido, a lista não fecha: os apontamentos precisam de quem fez.
        if (!v && currentId === null) return
        if (!v) setQuery("")
        onOpenChange(v)
      }}
    >
      <DialogContent
        showCloseButton={currentId !== null}
        className="flex max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogHeader className="border-b p-5 text-left">
          <DialogTitle className="text-2xl">Quem está operando?</DialogTitle>
          <DialogDescription>
            Toque no seu nome. Os apontamentos em {machineName} ficam registrados com ele até a troca de turno.
          </DialogDescription>
          {operators.length > 8 && (
            <InputGroup className="mt-3 h-12">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar pelo nome ou matrícula"
                aria-label="Buscar operador"
                className="text-base"
              />
            </InputGroup>
          )}
        </DialogHeader>
        <ul className="grid gap-3 overflow-y-auto p-5 sm:grid-cols-2">
          {list.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => {
                  setQuery("")
                  onChoose(o)
                }}
                className={cn(
                  "flex min-h-16 w-full touch-manipulation items-center gap-3 rounded-2xl border-2 bg-card p-3 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:scale-[0.99]",
                  o.id === currentId && "border-primary bg-primary/5",
                )}
              >
                <Avatar className="size-11">
                  <AvatarFallback className="bg-primary/10 font-semibold text-primary">{initials(o.name)}</AvatarFallback>
                </Avatar>
                <span className="grid min-w-0">
                  <span className="truncate text-lg font-semibold">{o.name}</span>
                  {o.employeeCode && <span className="truncate text-sm text-muted-foreground">Matrícula {o.employeeCode}</span>}
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && (
            <li className="col-span-full flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
              <UserRoundIcon className="size-8" />
              Ninguém com esse nome. Se você não está na lista, avise o supervisor.
            </li>
          )}
        </ul>
        {currentId !== null && (
          <div className="border-t p-4 text-right">
            <Button variant="outline" size="lg" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
