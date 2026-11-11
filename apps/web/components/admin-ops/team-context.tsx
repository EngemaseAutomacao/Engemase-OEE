"use client"

import { createContext, useContext, useMemo, useState } from "react"
import { HardHatIcon, HeadsetIcon, ShieldCheckIcon, type LucideIcon } from "lucide-react"

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
  support: {
    label: "Suporte",
    tone: "teal",
    icon: HeadsetIcon,
    who: "Suporte técnico",
    summary: "Só entra num cliente com concessão de suporte ativa (motivo, chamado, até 4 h).",
    can: ["Ler cadastros, configurações, saúde e dashboards", "Comandos de diagnóstico nos gateways", "Pedir acesso remoto (VPN)"],
    cannot: ["Mexer em usuários e papéis", "Acessar cliente sem concessão"],
  },
  field_engineer: {
    label: "Engenheiro de campo",
    tone: "orange",
    icon: HardHatIcon,
    who: "Comissionamento e implantação",
    summary: "Só nos clientes atribuídos pelo super admin, com validade.",
    can: ["Configurar unidades, linhas e máquinas", "Provisionar gateways, conexões Modbus e tags", "Pedir acesso remoto (VPN)"],
    cannot: ["Mexer em usuários", "Acessar cliente sem atribuição vigente"],
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

/** Estado local da equipe (protótipo): convites, atribuições e concessões alteradas na sessão. */
export function TeamProvider({ data, children }: { data: TeamData; children: React.ReactNode }) {
  const [members, setMembers] = useState(data.members)
  const [assignments, setAssignments] = useState(data.assignments)
  const [grants, setGrants] = useState(data.grants)

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
