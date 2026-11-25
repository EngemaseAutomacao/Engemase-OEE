/**
 * Seeds: o sintético (dados de demonstração; só desenvolvimento local e branch-semente da Neon) e o de
 * plataforma (Engemase Lab + primeiro super admin; também em produção, com confirmação). Ficam num ponto de
 * entrada próprio (`@engemase/db/seed`) para não entrar no app por acidente.
 */
export * from "./synthetic"
export * from "./platform"
