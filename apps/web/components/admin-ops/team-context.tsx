"use client"

import { createContext, useContext, useMemo, useState } from "react"
import { HardHatIcon, ShieldCheckIcon, type LucideIcon } from "lucide-react"

import type { PlatformRole } from "@/lib/mock/types"
import type { Tone } from "./bits"
import type { AssignmentRow, GrantRow, MemberRow, TeamData } from "./team-data"

/** Papéis da equipe Engemase (docs/15 §3), com explicação curta. */
export const ROLE_META: Record<PlatformRole, { label: string; tone: Tone; icon: LucideIcon; who: string; summary: string; can: string[]; cannot: string[] }> = {
  super_admin: {
    label: "Super admin",
    tone: "blue",
    icon: ShieldCheckIcon,
    who: "2 a 3 pessoas da direção técnica",
    summary: "Acesso a todos os clientes, sempre auditado.",
    can: ["Criar, suspender e encerrar clientes", "Gerenciar a equipe e as atribuições", "Ações destrutivas com reautenticação e motivo"],
    cannot: ["Alterar o próprio papel", "Remover o último super admin"],
  },
  technician: {
    label: "Técnico",
    tone: "teal",
    icon: HardHatIcon,
    who: "Implantação e suporte técnico",
    summary: "Entra num cliente por atribuição do super admin (implantação) ou por concessão de suporte que ele mesmo abre (motivo, chamado, até 4 h).",
    can: [
      "Configurar unidades, linhas, máquinas, turnos e produtos",
      "Provisionar gateways, conexões Modbus e tags",
      "Comandos de diagnóstico e acesso remoto (VPN)",
    ],
    cannot: ["Mexer em usuários e papéis", "Acessar cliente sem atribuição ou concessão vigente"],
  },
}

interface TeamState extends TeamData {
  addMember: (m: MemberRow) => void
  patchMember: (id: string, patch: Partial<MemberRow>) => void
  addAssignment: (a: AssignmentRow) => void
  patchAssignment: (id: string, patch: Partial<AssignmentRow>) => void
  removeAssignment: (id: string) => void
  patchGrant: (id: string, patch: Partial<GrantRow>) => void
}

const TeamContext = createContext<TeamState | null>(null)

/**
 * Estado da equipe na tela: no demo, guarda o que foi alterado na sessão; com banco, recomeça a cada dado novo
 * do servidor (as gravações reais chamam `router.refresh()`).
 */
export function TeamProvider({ data, children }: { data: TeamData; children: React.ReactNode }) {
  const [members, setMembers] = useState(data.members)
  const [assignments, setAssignments] = useState(data.assignments)
  const [grants, setGrants] = useState(data.grants)
  // Dados novos do servidor (ex.: router.refresh() depois de gravar no banco) substituem o estado local.
  const [source, setSource] = useState(data)
  if (source !== data) {
    setSource(data)
    setMembers(data.members)
    setAssignments(data.assignments)
    setGrants(data.grants)
  }

  const value = useMemo<TeamState>(
    () => ({
      ...data,
      members,
      assignments,
      grants,
      addMember: (m) => setMembers((list) => [...list, m]),
      patchMember: (id, patch) => setMembers((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m))),
      addAssignment: (a) => setAssignments((list) => [a, ...list]),
      patchAssignment: (id, patch) => setAssignments((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a))),
      removeAssignment: (id) => setAssignments((list) => list.filter((a) => a.id !== id)),
      patchGrant: (id, patch) => setGrants((list) => list.map((g) => (g.id === id ? { ...g, ...patch } : g))),
    }),
    [data, members, assignments, grants],
  )
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>
}

export function useTeam(): TeamState {
  const ctx = useContext(TeamContext)
  if (!ctx) throw new Error("useTeam precisa de <TeamProvider>")
  return ctx
}
