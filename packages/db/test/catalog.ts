/**
 * Verificações de catálogo do banco (docs/15, seção 4, item 7.1): rodam contra o Postgres real
 * (PGlite nos testes; podem rodar contra um branch Neon no CI). Cada função devolve a lista de
 * problemas encontrados — vazia quando está tudo certo.
 */
import type { PGlite, Transaction } from "@electric-sql/pglite"

type Queryable = PGlite | Transaction

/** Tabelas (schema public) que têm a coluna `organization_id`. */
export async function tablesWithOrganizationId(db: Queryable): Promise<string[]> {
  const result = await db.query<{ name: string }>(`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY 1`)
  return result.rows.map((r) => r.name)
}

/** Tabelas com `organization_id` sem RLS habilitada E forçada. */
export async function tenantTablesWithoutForcedRls(db: Queryable): Promise<string[]> {
  const result = await db.query<{ name: string }>(`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
    ORDER BY 1`)
  return result.rows.map((r) => r.name)
}

/**
 * Tabelas com `organization_id` sem a política RESTRITIVA de cliente para `app_user`
 * (FOR ALL, com USING e WITH CHECK comparando `organization_id` com `app.current_org_id()`).
 */
export async function tenantTablesWithoutIsolationPolicy(db: Queryable): Promise<string[]> {
  const result = await db.query<{ name: string }>(`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = c.relname
          AND p.permissive = 'RESTRICTIVE'
          AND p.cmd = 'ALL'
          AND 'app_user' = ANY (p.roles)
          AND p.qual ~ 'organization_id = app\\.current_org_id\\(\\)'
          AND p.with_check ~ 'organization_id = app\\.current_org_id\\(\\)'
      )
    ORDER BY 1`)
  return result.rows.map((r) => r.name)
}

export interface PolicyRow {
  readonly table: string
  readonly policy: string
  readonly roles: string
  readonly cmd: string
}

/** Políticas PERMISSIVAS em tabelas de cliente (e em "user"), para conferir contra uma lista fechada. */
export async function permissivePolicies(db: Queryable): Promise<PolicyRow[]> {
  const result = await db.query<PolicyRow>(`
    SELECT p.tablename AS "table", p.policyname AS policy, array_to_string(p.roles, ',') AS roles, p.cmd
    FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.permissive = 'PERMISSIVE'
    ORDER BY 1, 2`)
  return result.rows
}

/**
 * Tabelas (schema public) em que `app_user` tem algum SELECT (na tabela ou em coluna) e que NÃO têm
 * RLS habilitada E forçada. O app só pode ler tabela que filtra por cliente — inclusive as que não têm
 * `organization_id` (ex.: `organization`, `"user"`).
 */
export async function tablesReadableByAppUserWithoutForcedRls(db: Queryable): Promise<string[]> {
  const result = await db.query<{ name: string }>(`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND pg_catalog.has_any_column_privilege('app_user', c.oid, 'SELECT')
      AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
    ORDER BY 1`)
  return result.rows.map((r) => r.name)
}

/** `organization_id` que aceita nulo (só a auditoria pode). */
export async function nullableOrganizationIdColumns(db: Queryable): Promise<string[]> {
  const result = await db.query<{ name: string }>(`
    SELECT table_name AS name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'organization_id' AND is_nullable = 'YES'
    ORDER BY 1`)
  return result.rows.map((r) => r.name)
}

/** Tabelas de cliente sem FK `organization_id → organization(id)`. */
export async function tenantTablesWithoutOrganizationFk(db: Queryable): Promise<string[]> {
  const result = await db.query<{ name: string }>(`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint k
        WHERE k.contype = 'f' AND k.conrelid = c.oid
          AND k.confrelid = 'public.organization'::regclass
          AND k.conkey = ARRAY[a.attnum]
      )
    ORDER BY 1`)
  return result.rows.map((r) => r.name)
}

export interface ForeignKeyRow {
  readonly constraint: string
  readonly from: string
  readonly to: string
}

/**
 * FKs entre DUAS tabelas de cliente que NÃO ligam `organization_id` a `organization_id`.
 * Toda ligação entre tabelas de cliente precisa ser composta com o cliente (docs/15, item 5).
 */
export async function tenantForeignKeysWithoutOrganization(db: Queryable): Promise<ForeignKeyRow[]> {
  const result = await db.query<ForeignKeyRow>(`
    WITH tenant AS (
      SELECT c.oid, a.attnum AS org_attnum
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    )
    SELECT k.conname AS "constraint", k.conrelid::regclass::text AS "from", k.confrelid::regclass::text AS "to"
    FROM pg_constraint k
    JOIN tenant src ON src.oid = k.conrelid
    JOIN tenant dst ON dst.oid = k.confrelid
    WHERE k.contype = 'f'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(k.conkey, k.confkey) AS pair(src_att, dst_att)
        WHERE pair.src_att = src.org_attnum AND pair.dst_att = dst.org_attnum
      )
    ORDER BY 1`)
  return result.rows
}

export interface RoleRow {
  readonly name: string
  readonly superuser: boolean
  readonly bypassRls: boolean
}

/** Atributos dos papéis da aplicação. */
export async function applicationRoles(db: Queryable): Promise<RoleRow[]> {
  const result = await db.query<RoleRow>(`
    SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS "bypassRls"
    FROM pg_roles WHERE rolname IN ('app_user', 'auth_service', 'app_lookup') ORDER BY 1`)
  return result.rows
}

export interface DefinerFunctionRow {
  readonly name: string
  readonly owner: string
  readonly config: string | null
}

/** Funções SECURITY DEFINER do schema `app` (dono e `search_path` fixo). */
export async function securityDefinerFunctions(db: Queryable): Promise<DefinerFunctionRow[]> {
  const result = await db.query<DefinerFunctionRow>(`
    SELECT p.proname AS name, pg_get_userbyid(p.proowner) AS owner, array_to_string(p.proconfig, ',') AS config
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app' AND p.prosecdef
    ORDER BY 1`)
  return result.rows
}

export interface FunctionExecutorsRow {
  readonly name: string
  /** Papéis com EXECUTE, em ordem alfabética ("PUBLIC" se qualquer um puder executar). */
  readonly executors: string
}

/**
 * Quem pode executar cada função SECURITY DEFINER do schema `app`. ACL nula = padrão do Postgres
 * (dono + PUBLIC), o que aparece como "PUBLIC".
 */
export async function securityDefinerFunctionExecutors(db: Queryable): Promise<FunctionExecutorsRow[]> {
  const result = await db.query<FunctionExecutorsRow>(`
    SELECT p.proname AS name,
      CASE WHEN p.proacl IS NULL THEN 'PUBLIC' ELSE (
        SELECT string_agg(g.grantee_name, ',' ORDER BY g.grantee_name)
        FROM (
          SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee_name
          FROM aclexplode(p.proacl) a
          WHERE a.privilege_type = 'EXECUTE'
        ) g
      ) END AS executors
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app' AND p.prosecdef
    ORDER BY 1`)
  return result.rows
}
