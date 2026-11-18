/**
 * Type artwork for the directory tree, from Material Icon Theme.
 *
 * A row in the tree says what a file *is* before its name is read: `笔记.md` is a
 * markdown mark, `package.json` the Node hexagon, `素材/` a folder drawn as a
 * folder. The drawings and the name / extension / folder associations are the VS
 * Code extension
 * [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme)
 * (`pkief.material-icon-theme`), vendored by `scripts/vendor-material-icons.mjs`
 * into `assets/material-icons/` and compiled into this bundle from
 * `material.generated.ts`. The theme is MIT licensed; its licence text ships
 * beside the artwork and in the package's `files` list.
 *
 * The selection is not the whole theme. This tree lists **every text file** — the
 * Host refuses only binary types — and every folder, so the generator keeps the
 * drawings those names and the known text extensions actually reach: prose, data,
 * markup and the common programming languages (`.js`, `.ts`, `.py`, `.go`, …), and
 * nothing else. A file whose type the panel does not know still draws the theme's
 * generic `file` sheet, exactly as VS Code does; what is *not* carried is a
 * drawing for a type the tree can never list (an image, a font, an archive).
 * Folders are curated to the names a workspace of notes grows.
 *
 * Three points differ deliberately from the extension:
 *
 * - **Nothing is fetched.** A published plugin cannot read the extension's
 *   installation directory, so every drawing is inlined here and a build needs no
 *   VS Code at all. Regenerate only when the theme is upgraded.
 * - **The mapping is total.** The theme leaves unknown files with its generic
 *   `file` drawing and unknown folders with `folder` / `folder-open`; this module
 *   does the same, so a row can never be iconless or broken.
 * - **An extensionless name is a document unless it is a build file.** The editor
 *   opens such a name as markdown (`isMarkdownPath`) and it is how this notebook's
 *   prose is named — `第一章`, not `第一章.md` — so it gets the markdown drawing
 *   instead of the grey sheet. `Dockerfile` and `Makefile` are the exceptions the
 *   editor itself makes, and the icon follows it because the rule is delegated to
 *   `isMarkdownPath` rather than restated: the icon and the editor cannot disagree
 *   about what a document is. A name whose type the panel knows (`.js`, `.py`)
 *   keeps its own mark, because the lookup table is consulted first.
 *
 * Lookup order matches the theme: an exact (case-insensitive) file name first —
 * that is how `package.json` becomes a Node mark and `README.md` a README — then
 * the longest suffix of the name that the extension table knows, then the panel's
 * document rule, then the generic fallback.
 */
import * as React from 'react'
import { isMarkdownPath } from '../state/markdown'
import {
  FILE_EXTENSIONS,
  FILE_NAMES,
  FOLDER_NAMES,
  FOLDER_NAMES_EXPANDED,
  ICON_ART,
} from './material.generated'

/**
 * The drawing a file or folder gets when nothing more specific matches.
 *
 * These are the theme's own defaults (`file`, `folder`, `folderExpanded` in its
 * manifest), so an unknown type looks exactly as it does in VS Code.
 */
export const FALLBACK_FILE = 'file'
export const FALLBACK_FOLDER = 'folder'
export const FALLBACK_FOLDER_OPEN = 'folder-open'

/** The edge length every tree drawing is asked for, in px. */
export const TREE_ICON_SIZE = 16

/**
 * File name to drawing, memoized per name.
 *
 * The tree re-renders the whole list on every selection and every listing
 * refresh, so the same few dozen names are asked for over and over; a cache
 * turns that into one lookup per distinct name. Names are short and a workspace
 * has finitely many, so it is not evicted.
 */
const fileIcons = new Map<string, string>()

/**
 * One association's value, for the name itself rather than its prototype.
 *
 * The tables are plain object literals, so `FILE_NAMES['constructor']` would
 * answer the inherited constructor and a file named `constructor` would take it
 * as an icon id. `Object.hasOwn` is what keeps a prototype key from being read as
 * an association.
 * @param table - one generated association table, already lower-cased.
 * @param key - the lower-cased name or extension being looked up.
 * @returns the icon id, or undefined when the table has no such row.
 */
function association(table: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

/**
 * The drawing for a file name.
 * @param name - the last path segment, as the listing spells it.
 * @returns a Material Icon Theme icon id, never undefined.
 */
export function iconIdForFile(name: string): string {
  const key = name.toLowerCase()
  const cached = fileIcons.get(key)
  if (cached !== undefined) return cached

  let id = association(FILE_NAMES, key)
  if (id === undefined) {
    // Longest suffix first: `x.d.ts` tries `d.ts` before `ts`, which is what the
    // theme's compound-extension entries are for. A name with no dot at all has
    // exactly one candidate — itself.
    let dot = key.indexOf('.')
    while (dot >= 0 && id === undefined) {
      id = association(FILE_EXTENSIONS, key.slice(dot + 1))
      dot = key.indexOf('.', dot + 1)
    }
  }
  // The editor's own rule, asked rather than copied: if this name opens as a
  // rendered markdown document, it is drawn as one.
  if (id === undefined && isMarkdownPath(name)) id = 'markdown'
  const resolved = id ?? FALLBACK_FILE
  fileIcons.set(key, resolved)
  return resolved
}

/**
 * The drawing for a folder.
 * @param name - the folder's own name, not its path.
 * @param open - whether the tree is showing its children.
 * @returns a Material Icon Theme icon id, never undefined.
 */
export function iconIdForFolder(name: string, open = false): string {
  const key = name.toLowerCase()
  if (open) {
    return association(FOLDER_NAMES_EXPANDED, key) ?? association(FOLDER_NAMES, key) ?? FALLBACK_FOLDER_OPEN
  }
  return association(FOLDER_NAMES, key) ?? FALLBACK_FOLDER
}

/**
 * The SVG source of one drawing.
 * @param id - a Material Icon Theme icon id; an unknown id reads as the generic file.
 * @returns SVG markup, or an empty string when even the fallback is absent.
 */
export function iconArtwork(id: string): string {
  return association(ICON_ART, id) ?? association(ICON_ART, FALLBACK_FILE) ?? ''
}

/** Every icon id this bundle carries, in name order. */
export function materialIconIds(): string[] {
  return Object.keys(ICON_ART).sort()
}

export interface TreeIconProps {
  /** The file or, for a directory, its own name — not a path. Empty for a row being named. */
  name: string
  /** A folder row draws a folder; anything else draws a file. */
  directory?: boolean
  /** For a folder: whether its children are showing, which swaps the drawing. */
  open?: boolean
  /** Edge length in px. */
  size?: number
}

/**
 * One row's type artwork.
 *
 * An empty `name` is the row the author is still naming, so it draws the generic
 * file or folder rather than whatever the fallback happens to look up as — the
 * empty string is not a file name and must not be treated as one.
 *
 * Drawn by inlining the vendored SVG rather than by an `<img>`: the drawings are
 * shipped as strings inside this bundle either way, and inline markup scales
 * crisply at 16px and needs no extra request. The markup is a build-time constant
 * compiled from `assets/material-icons/` (the generator rejects a drawing that
 * carries a script or an event handler, and scopes its element ids to the icon),
 * never text from the workspace — a file named `<img onerror=…>` still gets the
 * generic file mark.
 */
export function TreeIcon({ name, directory = false, open = false, size = TREE_ICON_SIZE }: TreeIconProps): React.ReactElement {
  const empty = name.trim().length === 0
  const id = empty
    ? (directory ? FALLBACK_FOLDER : FALLBACK_FILE)
    : (directory ? iconIdForFolder(name, open) : iconIdForFile(name))
  return React.createElement('span', {
    className: 'dsh-notebook-treeIcon',
    'data-icon': id,
    'aria-hidden': true,
    style: { width: size, height: size },
    dangerouslySetInnerHTML: { __html: iconArtwork(id) },
  })
}
