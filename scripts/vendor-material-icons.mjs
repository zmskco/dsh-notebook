#!/usr/bin/env node
/**
 * Vendor the directory tree's type artwork from Material Icon Theme.
 *
 * The panel does not draw its own file and folder pictures: it shows the icons
 * the VS Code extension [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)
 * assigns to a name, an extension and a folder. Those assignments are the
 * extension's data (`dist/material-icons.json`), so the only faithful way to use
 * them is to copy them: this script reads the extension installed on this
 * machine, copies the selected SVGs into `assets/material-icons/icons/`, and
 * writes `src/client/icons/material.generated.ts` — one import per drawing, the
 * raw SVG text in the Client bundle, plus the four association tables the lookup
 * in `icons/material.ts` uses.
 *
 * **The artwork is vendored, not referenced.** The extension resolves from an
 * absolute path on one developer's machine; a published plugin cannot. The
 * generated module and the SVGs it imports are therefore committed, and the
 * build needs no `.vscode` directory. Re-run this script only when the theme is
 * upgraded (and commit its result).
 *
 * The selection is deliberately not the whole theme: 1,251 drawings (about
 * 840 KiB of SVG) answer languages and tools this notebook never shows, and the
 * Client bundle is paid for on every page load. The lists below cover what a
 * workspace of notes, code and assets actually contains; every other name falls
 * back to the theme's own generic `file`, `folder` and `folder-open` pictures —
 * the same fallback the theme uses. Associations whose icon was not selected are
 * dropped with it, so an unvendored type degrades to the generic drawing rather
 * than to a missing icon.
 *
 * Usage:
 *
 * ```powershell
 * pnpm run vendor:icons
 * ```
 *
 * `MATERIAL_ICON_THEME_DIR` overrides discovery when the extension lives in an
 * unusual place (or when a specific version should be pinned).
 *
 * The Material Icon Theme is MIT licensed; its licence is copied beside the
 * artwork and shipped in the package's `files` list.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The known-text extensions the Host lists in the tree, without the leading dot.
 *
 * **This list must mirror `TEXT_EXTENSIONS` in `src/host/story/manuscript.ts`.**
 * The Host no longer runs an allowlist — a file with an extension outside this
 * list is still opened when its bytes are text — but a *known* text type is what
 * decides which drawings are worth vendoring: an association this list cannot
 * reach would be an SVG paid for on every page load that no row ever draws. A file
 * whose type is unknown falls back to the theme's generic `file` drawing, exactly
 * as it does in VS Code.
 *
 * `scripts/check-client.mjs` reads both lists and fails if they drift apart, so
 * teaching the panel a new file type means editing the Host's list and re-running
 * this script.
 */
const HOST_TEXT_EXTENSIONS = [
  // Prose and documents.
  'md', 'markdown', 'mdx', 'txt', 'text', 'rst', 'adoc', 'asciidoc', 'tex', 'org',
  // Data and configuration.
  'json', 'jsonl', 'jsonc', 'ndjson', 'json5', 'yml', 'yaml', 'toml', 'ini', 'cfg',
  'conf', 'properties', 'csv', 'tsv', 'xml', 'env', 'diff', 'patch', 'log', 'map',
  // Markup and style.
  'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'styl', 'svg',
  // Source code.
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte', 'astro',
  'py', 'rb', 'php', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'scala', 'groovy',
  'gradle', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'fs', 'fsx', 'lua',
  'r', 'dart', 'ex', 'exs', 'erl', 'hrl', 'hs', 'clj', 'cljs', 'pl', 'pm', 'zig',
  'nim', 'jl', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd', 'sql',
  'graphql', 'gql', 'tf', 'hcl', 'nix', 'cmake', 'mk', 'asm', 's', 'vim', 'sol',
  'elm', 'v',
]

/**
 * The generic drawing every unmatched name falls back to.
 *
 * The theme's own `file` definition, so an unknown type looks as it does in VS
 * Code. It has no association of its own, so it is not derived below.
 */
const FALLBACK_FILE_ICON = 'file'

/**
 * Folder artwork this panel carries.
 *
 * Each base name also vendors its `-open` sibling: the theme draws the open
 * folder as a separate file, and the tree toggles between the pair. Folders are
 * curated rather than derived: the Host lists any directory name, and the theme
 * has 4,659 of them, so this is the set a workspace of notes actually grows.
 */
const FOLDER_BASES = [
  'folder',
  'src', 'lib', 'dist', 'node', 'git', 'github', 'gitlab', 'vscode', 'docs',
  'images', 'resource', 'test', 'public', 'scripts', 'css', 'components', 'views',
  'api', 'config', 'i18n', 'database', 'include', 'jupyter', 'content', 'video',
  'audio', 'font', 'hook', 'store', 'typescript', 'utils', 'markdown', 'android',
  'ios', 'mobile', 'server', 'client', 'core', 'shared', 'app', 'backup', 'temp',
  'coverage', 'examples', 'theme', 'tools', 'layout', 'linux', 'windows', 'macos',
  'packages', 'template', 'plugin', 'routes',
]

/** The artwork directory; `icons/` below it is owned by this script. */
const ART_DIR = fileURLToPath(new URL('../assets/material-icons/', import.meta.url))

/** The generated association/art module. */
const GENERATED_FILE = fileURLToPath(new URL('../src/client/icons/material.generated.ts', import.meta.url))

/**
 * Where VS Code (and its forks) keep extensions.
 * @returns the candidate extension roots, most common first.
 */
function extensionRoots() {
  return [
    process.env.MATERIAL_ICON_THEME_DIR,
    join(homedir(), '.vscode', 'extensions'),
    join(homedir(), '.vscode-insiders', 'extensions'),
    join(homedir(), '.vscode-server', 'extensions'),
    join(homedir(), '.cursor', 'extensions'),
    join(homedir(), '.windsurf', 'extensions'),
  ].filter((root) => typeof root === 'string' && root.length > 0)
}

/**
 * Locate the installed Material Icon Theme extension.
 *
 * When several versions are installed the newest one wins, which is the one
 * VS Code itself would activate.
 * @returns `{ directory, version }`.
 */
function findExtension() {
  const explicit = process.env.MATERIAL_ICON_THEME_DIR
  if (explicit !== undefined) {
    if (!existsSync(join(explicit, 'dist', 'material-icons.json'))) {
      throw new Error(`MATERIAL_ICON_THEME_DIR does not hold a Material Icon Theme build: ${explicit}`)
    }
    return { directory: explicit, version: versionOf(explicit) }
  }
  let best
  for (const root of extensionRoots()) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('pkief.material-icon-theme-')) continue
      const directory = join(root, entry)
      if (!existsSync(join(directory, 'dist', 'material-icons.json'))) continue
      const version = versionOf(directory)
      if (best === undefined || compareVersions(version, best.version) > 0) best = { directory, version }
    }
  }
  if (best === undefined) {
    throw new Error(
      'Material Icon Theme (pkief.material-icon-theme) was not found in any VS Code extensions directory.\n'
      + 'Install it in VS Code, or point MATERIAL_ICON_THEME_DIR at the unpacked extension directory.',
    )
  }
  return best
}

/**
 * The version an extension directory's name ends with.
 * @param directory - the extension directory.
 * @returns a dotted version, or `'0.0.0'` when the name carries none.
 */
function versionOf(directory) {
  return /-(\d+\.\d+\.\d+)$/.exec(basename(directory))?.[1] ?? '0.0.0'
}

/**
 * Compare two dotted versions numerically.
 * @param left - one version.
 * @param right - another version.
 * @returns a negative, zero or positive comparator result.
 */
function compareVersions(left, right) {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * Lower-case every key and keep a deterministic last-wins merge.
 * @param table - one association table from the theme manifest.
 * @param label - its name, for conflict messages.
 * @returns the normalized table.
 */
function normalizeKeys(table, label) {
  const result = new Map()
  for (const [key, value] of Object.entries(table)) {
    const lower = key.toLowerCase()
    if (result.has(lower) && result.get(lower) !== value) {
      console.warn(`  ! ${label}: "${lower}" is claimed by ${String(result.get(lower))} and ${value}; keeping the latter`)
    }
    result.set(lower, value)
  }
  return result
}

/**
 * Keep only the associations whose drawing was vendored.
 * @param table - a normalized association table.
 * @param icons - the vendored icon ids.
 * @returns the surviving entries, sorted by key.
 */
function filterTable(table, icons) {
  return [...table.entries()]
    // A name starting with a dot never reaches the tree: the Host skips those
    // entries outright, so `.git/`'s drawing would be kept for a row that cannot
    // exist. Names *containing* a slash are paths inside a project the theme also
    // indexes, which no single entry name ever equals.
    .filter(([key, icon]) => icons.has(icon) && !key.includes('/') && !key.startsWith('.'))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
}

/** Render one association table as a TypeScript object literal. */
function renderTable(name, entries, describe) {
  const lines = [`/** ${describe} */`, `export const ${name}: Record<string, string> = {`]
  for (const [key, value] of entries) lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
  lines.push('}', '')
  return lines.join('\n')
}

/**
 * Refuse to vendor a drawing that could execute something.
 *
 * The Client inlines these strings as markup, so a theme upgrade that ever
 * shipped a script, an event handler or a `javascript:` target would put it in
 * the page. The theme is a build dependency here, not user data, but the check
 * is what keeps that property true of future versions.
 * @param id - the icon id, for the message.
 * @param art - the SVG source.
 * @returns the source unchanged.
 */
function assertInert(id, art) {
  const forbidden = [
    [/<script\b/iu, 'a <script> element'],
    [/<foreignObject\b/iu, 'a <foreignObject> element'],
    [/\son[a-z]+\s*=/iu, 'an event handler attribute'],
    [/javascript:/iu, 'a javascript: URL'],
  ]
  for (const [pattern, label] of forbidden) {
    if (pattern.test(art)) throw new Error(`the drawing for "${id}" carries ${label}; refusing to vendor it`)
  }
  return art
}

/**
 * Rewrite a drawing's element ids to be scoped to its icon.
 *
 * The tree inlines these SVGs into one document, and the theme's own files reuse
 * short ids (`id="a"` in several of them) and reference them with `url(#a)` or
 * `href="#a"`. Duplicate ids are invalid HTML and resolve first-in-document, so
 * two drawings on one page can bind each other's paint server. Prefixing every id
 * with the icon name makes each inlined instance self-contained.
 * @param id - the icon id, used as the prefix.
 * @param art - the SVG source.
 * @returns the source with its ids and references namespaced.
 */
function namespaceIds(id, art) {
  const ids = [...art.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1])
  if (ids.length === 0) return art
  const prefix = `${id}-`
  let out = art
  for (const local of ids) {
    out = out
      .replaceAll(`id="${local}"`, `id="${prefix}${local}"`)
      .replaceAll(`url(#${local})`, `url(#${prefix}${local})`)
      .replaceAll(`href="#${local}"`, `href="#${prefix}${local}"`)
  }
  return out
}

/** Read an icon's SVG bytes from the extension. */
function readArtwork(extension, id, definition) {
  const file = join(extension, 'icons', basename(definition.iconPath))
  if (!existsSync(file)) throw new Error(`icon "${id}" points at a missing file: ${definition.iconPath}`)
  return namespaceIds(id, assertInert(id, readFileSync(file, 'utf8')))
}

/**
 * Drawings an extensionless name may pick, when the theme has a rule for it.
 *
 * A file with no extension is a *document* in this panel — the editor opens it as
 * markdown — and it is how this notebook's prose is named (`第一章`). So the
 * theme's extensionless name rules are kept only for the document-ish and
 * project-meta ones: a `LICENSE` or a `CHANGELOG` keeps its own mark, while
 * `Jenkinsfile`, `Snakefile`, `fastlane` and the other build-tool names (about
 * 33 KiB of drawings for files a notes workspace does not contain) fall through
 * to the markdown mark, which is what they open as anyway.
 */
const EXTENSIONLESS_NAME_ICONS = new Set([
  'readme', 'license', 'changelog', 'contributing', 'conduct', 'credits',
  'todo', 'roadmap', 'architecture', 'prompt', 'skill', 'instructions',
  'claude', 'gemini-ai', 'copilot', 'agent',
])

/**
 * The icons reachable from the names the Host can list.
 *
 * A file row exists only for a text file, so the drawings worth carrying are
 * exactly the ones the theme's own name and extension tables point at for those
 * names — `package.json` → the Node mark, `README.md` → the README mark, `.csv`
 * → the table mark — plus the generic fallback and the markdown mark (which the
 * panel also uses for an extensionless document).
 * @param manifest - the theme's manifest.
 * @returns the icon ids to vendor, and the associations that reference them.
 */
function deriveFileIcons(manifest) {
  const names = normalizeKeys(manifest.fileNames ?? {}, 'fileNames')
  const extensions = normalizeKeys(manifest.fileExtensions ?? {}, 'fileExtensions')
  const reachable = new Set([FALLBACK_FILE_ICON, 'markdown'])
  const keptNames = new Map()
  const keptExtensions = new Map()

  for (const [name, icon] of names) {
    // `.gitignore`, `.travis.yml` and friends never reach the tree at all: the
    // Host skips every entry whose name starts with a dot. Checking the *leading*
    // dot matters — `.travis.yml` has a normal `.yml` tail and would otherwise be
    // kept, and that one drawing alone is 21 KiB.
    if (name.startsWith('.')) continue
    const dot = name.lastIndexOf('.')
    if (dot < 0) {
      // Extensionless: only the document-ish marks, so a build tool's name does
      // not cost its drawing. See {@link EXTENSIONLESS_NAME_ICONS}.
      if (!EXTENSIONLESS_NAME_ICONS.has(icon)) continue
    } else if (!HOST_TEXT_EXTENSIONS.includes(name.slice(dot + 1))) {
      continue
    }
    keptNames.set(name, icon)
    reachable.add(icon)
  }
  for (const [extension, icon] of extensions) {
    // The Host reads only the last extension, so a compound entry (`spec.ts`)
    // can never match a listed file.
    if (!HOST_TEXT_EXTENSIONS.includes(extension)) continue
    keptExtensions.set(extension, icon)
    reachable.add(icon)
  }
  return { icons: reachable, fileNames: keptNames, fileExtensions: keptExtensions }
}

function main() {
  // `--dry-run` resolves and validates the whole selection without writing, so a
  // theme upgrade can be checked against this script before anything changes.
  const dryRun = process.argv.includes('--dry-run')
  const { directory, version } = findExtension()
  const manifest = JSON.parse(readFileSync(join(directory, 'dist', 'material-icons.json'), 'utf8'))
  console.log(`material-icon-theme ${version} (${directory})${dryRun ? ' — dry run, nothing is written' : ''}`)

  const idSet = new Set(manifest.iconDefinitions === undefined ? [] : Object.keys(manifest.iconDefinitions))
  const derived = deriveFileIcons(manifest)
  const fileIcons = derived.icons
  const folderIcons = new Set()
  for (const base of FOLDER_BASES) {
    // The theme draws a folder as `<name>` and its open state as `<name>-open`;
    // the default pair is the bare `folder` / `folder-open` rather than a suffix
    // of a name, which is the one special case here.
    folderIcons.add(base === 'folder' ? 'folder' : `folder-${base}`)
    folderIcons.add(base === 'folder' ? 'folder-open' : `folder-${base}-open`)
  }
  const selected = [...new Set([...fileIcons, ...folderIcons])].sort()
  const missing = selected.filter((id) => !idSet.has(id))
  if (missing.length > 0) {
    throw new Error(`these icons are not in ${version}: ${missing.join(', ')} — update the selection in this script`)
  }

  if (!dryRun) {
    rmSync(join(ART_DIR, 'icons'), { recursive: true, force: true })
    mkdirSync(join(ART_DIR, 'icons'), { recursive: true })
  }

  let bytes = 0
  for (const id of selected) {
    const art = readArtwork(join(directory), id, manifest.iconDefinitions[id])
    bytes += Buffer.byteLength(art)
    if (!dryRun) writeFileSync(join(ART_DIR, 'icons', `${id}.svg`), art)
  }

  if (!dryRun) {
    copyFileSync(join(directory, 'LICENSE.txt'), join(ART_DIR, 'LICENSE.txt'))
    writeFileSync(join(ART_DIR, 'NOTICE.md'), [
      '# Material Icon Theme artwork',
      '',
      `The SVGs in \`icons/\` are the drawings of [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) ${version}`,
      'by Material Extensions, MIT licensed. The full licence text is in `LICENSE.txt`,',
      'and vendored artwork is covered by the package licence notice.',
      '',
      'Files are copied from the installed extension by `scripts/vendor-material-icons.mjs`',
      'with one mechanical edit and no redrawing: each drawing\'s element ids are prefixed',
      'with its icon name (the SVG is inlined into one page, where duplicate ids would',
      'resolve across drawings). Everything else is byte-for-byte the theme\'s file. Both',
      'the artwork and `src/client/icons/material.generated.ts` are committed so a build',
      'needs no VS Code installation. Regenerate with `pnpm run vendor:icons` after',
      'upgrading the extension, then commit the result.',
      '',
    ].join('\n'))
  }

  const fileNames = [...derived.fileNames.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  const fileExtensions = [...derived.fileExtensions.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  const folderNames = filterTable(normalizeKeys(manifest.folderNames ?? {}, 'folderNames'), folderIcons)
  const folderNamesExpanded = filterTable(normalizeKeys(manifest.folderNamesExpanded ?? {}, 'folderNamesExpanded'), folderIcons)

  const lines = [
    '/**',
    ' * Generated by `scripts/vendor-material-icons.mjs` — do not edit.',
    ' *',
    ` * Material Icon Theme ${version} (MIT, Copyright (c) 2025 Material Extensions):`,
    ' * the SVGs are vendored under `assets/material-icons/`, and the tables are the',
    " * theme's own associations, filtered to the drawings this panel ships.",
    ' */',
    '',
  ]
  selected.forEach((id, index) => {
    lines.push(`import icon${String(index)} from '../../../assets/material-icons/icons/${id}.svg'`)
  })
  lines.push('', '/** The SVG source of one drawing, by Material Icon Theme icon id. */', 'export const ICON_ART: Record<string, string> = {')
  selected.forEach((id, index) => { lines.push(`  ${JSON.stringify(id)}: icon${String(index)},`) })
  lines.push('}', '')

  lines.push(renderTable(
    'FILE_NAMES',
    fileNames,
    'File-name associations (already lower-cased): the theme\'s most specific rule.',
  ))
  lines.push(renderTable(
    'FILE_EXTENSIONS',
    fileExtensions,
    'Extension associations (already lower-cased), matched on the longest dotted suffix.',
  ))
  lines.push(renderTable(
    'FOLDER_NAMES',
    folderNames,
    'Folder-name associations for a closed folder.',
  ))
  lines.push(renderTable(
    'FOLDER_NAMES_EXPANDED',
    folderNamesExpanded,
    'Folder-name associations for an open folder.',
  ))
  if (!dryRun) writeFileSync(GENERATED_FILE, lines.join('\n'))

  console.log(`vendored ${String(selected.length)} drawings (${(bytes / 1024).toFixed(1)} KiB) into ${ART_DIR}`)
  console.log(`associations: ${String(fileNames.length)} names, ${String(fileExtensions.length)} extensions, `
    + `${String(folderNames.length)} folders (+${String(folderNamesExpanded.length)} expanded)`)
  console.log(dryRun ? `would write ${GENERATED_FILE}` : `wrote ${GENERATED_FILE}`)
}

main()
