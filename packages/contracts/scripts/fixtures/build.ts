/**
 * Monta o conteúdo de fixtures/*.json (válidas, inválidas, manifest e chave de teste).
 * Usado por `build:fixtures` (grava) e pelos testes (confere se os arquivos estão em dia).
 */
import type { ContractSchemaName, RuleId } from "../../src/index"
import { INVALID_CASES, type Patch } from "./invalid"
import { TEST_KEY_ID, testPublicKeyJwk } from "./jws"
import { VALID_FIXTURES } from "./valid"

export interface FixtureManifestEntry {
  readonly file: string
  readonly schema: ContractSchemaName
  readonly valid: boolean
  readonly description: string
  readonly layer?: "schema" | "semantic"
  readonly expect?: { readonly path: string; readonly rule?: RuleId }
  readonly derived_from?: string
  readonly patch?: readonly Patch[]
}

export interface FixtureManifest {
  readonly $comment: string
  readonly fixtures: readonly FixtureManifestEntry[]
}

export const MANIFEST_FILE = "manifest.json"
export const TEST_KEYS_FILE = "test-keys.json"

type JsonContainer = Record<string, unknown> | unknown[]

function isContainer(value: unknown): value is JsonContainer {
  return typeof value === "object" && value !== null
}

function child(container: JsonContainer, key: string): unknown {
  return Array.isArray(container) ? container[Number(key)] : container[key]
}

/** Aplica um patch (caminho com pontos; índices numéricos em arrays) numa cópia já clonada. */
export function applyPatch(root: unknown, patch: Patch): void {
  const keys = patch.path.split(".")
  const last = keys.pop()
  if (last === undefined) throw new Error("patch sem caminho")
  let node: unknown = root
  for (const key of keys) {
    if (!isContainer(node)) throw new Error(`caminho inexistente: ${patch.path}`)
    node = child(node, key)
  }
  if (!isContainer(node)) throw new Error(`caminho inexistente: ${patch.path}`)
  if (patch.op === "remove") {
    if (child(node, last) === undefined) throw new Error(`nada a remover em ${patch.path}`)
    if (Array.isArray(node)) node.splice(Number(last), 1)
    else delete node[last]
    return
  }
  if (Array.isArray(node)) node[Number(last)] = structuredClone(patch.value)
  else node[last] = structuredClone(patch.value)
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** Todos os arquivos de fixtures: nome do arquivo → conteúdo. */
export function buildFixtureFiles(): Map<string, string> {
  const files = new Map<string, string>()
  const entries: FixtureManifestEntry[] = []

  for (const [name, fixture] of Object.entries(VALID_FIXTURES)) {
    const file = `${name}.json`
    files.set(file, serialize(fixture.data))
    entries.push({ file, schema: fixture.schema, valid: true, description: fixture.description })
  }

  for (const [name, testCase] of Object.entries(INVALID_CASES)) {
    const base = VALID_FIXTURES[testCase.base]
    if (base === undefined) throw new Error(`${name}: fixture base inexistente (${testCase.base})`)
    if (base.schema !== testCase.schema) throw new Error(`${name}: schema diferente da base`)
    if (testCase.layer === "semantic" && testCase.rule === undefined) throw new Error(`${name}: falta rule`)
    const data: unknown = structuredClone(base.data)
    for (const patch of testCase.patch) applyPatch(data, patch)
    const file = `${name}.json`
    files.set(file, serialize(data))
    entries.push({
      file,
      schema: testCase.schema,
      valid: false,
      description: testCase.description,
      layer: testCase.layer,
      expect: testCase.rule !== undefined ? { path: testCase.path, rule: testCase.rule } : { path: testCase.path },
      derived_from: `${testCase.base}.json`,
      patch: testCase.patch,
    })
  }

  const manifest: FixtureManifest = {
    $comment:
      "Gerado por `pnpm --filter @engemase/contracts build:fixtures`; não edite à mão. " +
      "valid=false + layer=schema: o JSON Schema (schema/<schema>.json) já rejeita. " +
      "valid=false + layer=semantic: o JSON Schema aceita; só as regras semânticas (expect.rule) rejeitam. " +
      "expect.path usa pontos e índices base 0. As aprovações JWS são assinadas com a chave de test-keys.json.",
    fixtures: entries,
  }
  files.set(MANIFEST_FILE, serialize(manifest))
  files.set(
    TEST_KEYS_FILE,
    serialize({
      $comment: "Chave pública de TESTE (Ed25519) que assina as aprovações das fixtures. Nunca usar em produção.",
      keys: [testPublicKeyJwk()],
      approval_kid: TEST_KEY_ID,
    }),
  )
  return files
}
