/**
 * Plugin configuration: validation and defaults.
 *
 * The plugin exports no `Config` schema, because the schema DSL lives in a DSH
 * package this out-of-checkout bundle does not depend on. Configuration that a
 * profile patch supplies therefore arrives unvalidated, and this module is the
 * replacement: every field is checked once at activation and either accepted or
 * replaced with a default, with a warning naming the field.
 */
import { isAbsolute, join, resolve } from 'node:path'
import type { NotebookConfig } from './types.js'

/** The shape `cordis.patch.yml` documents, before validation. */
interface RawConfig {
  rootDir?: unknown
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * Resolve the effective configuration.
 * @param raw - the row's `config`, or `undefined` when the row declared none.
 * @param fallbackRoot - default root, already derived from the sandbox boundary.
 * @param warn - sink for rejected fields; the caller supplies the plugin logger.
 * @param workspaceRoot - the sandbox's `workspace-write` boundary, when known.
 *   A **relative** `rootDir` resolves against it, so `rootDir: notes` lands
 *   inside the one directory the sandbox is guaranteed to permit. Without a
 *   boundary a relative path falls back to resolving against `process.cwd()`.
 * @returns the validated configuration.
 */
export function resolveConfig(
  raw: unknown,
  fallbackRoot: string,
  warn: (message: string) => void,
  workspaceRoot?: string,
): NotebookConfig {
  const input: RawConfig = typeof raw === 'object' && raw !== null ? raw as RawConfig : {}

  const configured = optionalString(input.rootDir)
  let rootDir = fallbackRoot
  let rootDirOverride = false
  if (configured !== null) {
    rootDirOverride = true
    if (isAbsolute(configured)) rootDir = configured
    else if (workspaceRoot !== undefined && workspaceRoot.length > 0) rootDir = join(workspaceRoot, configured)
    else rootDir = resolve(configured)
  } else if (input.rootDir !== undefined) {
    warn(`rootDir must be a non-empty string; received ${JSON.stringify(input.rootDir)}, using the workspace`)
  }

  return { rootDir, rootDirOverride }
}
