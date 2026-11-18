/**
 * The editor's open files, as pure data.
 *
 * The panel used to hold one file at a time: `selected`, `draft`, `dirty`, `mode`
 * and a document token, all singletons. Opening a second file therefore threw the
 * first one away. This module is that state reshaped as one record per open file,
 * so the tab strip can show several and each keeps its own buffer — switching tabs
 * swaps which record is drawn instead of re-reading from disk, which is what makes
 * an unsaved sentence in one file survive a visit to another.
 *
 * Everything here is pure and string-in/data-out, so the artifact check drives it
 * directly instead of through a render it cannot reach.
 *
 * @module notebook/client/state/tabs
 */
import { initialEditorMode, type EditorMode } from './markdown'

/** One file open in the tab strip. */
export interface OpenFile {
  /** Project-relative path; the identity of the tab and the key of every write. */
  path: string
  /** The buffer as last read or edited. */
  draft: string
  /** Whether `draft` differs from what was last written. */
  dirty: boolean
  /** Which surface draws it: the rendered page or the markdown behind it. */
  mode: EditorMode
  /**
   * Bumped to re-create the rendered editor for this file.
   *
   * The rendered editor is uncontrolled while mounted — the DOM is the source of
   * truth, so the caret never moves under a re-render — so a fresh parse is asked
   * for with a new key, not by handing it different text.
   */
  docToken: number
  /** True while the first read is still in flight; the tab exists before it lands. */
  loading: boolean
}

/**
 * The id of the page a tab controls.
 *
 * One page is shared by every tab — that is what a tab strip over a single editor
 * *is* — so the panel's `aria-labelledby` names the drawn tab and each tab's
 * `aria-controls` names this one id.
 */
export const PAGE_ID = 'dsh-notebook-page'

/**
 * The id of one tab's element.
 *
 * Declared here rather than beside the component so the strip and the page can
 * both use it without importing each other; it is data, and it belongs with the
 * rest of the tab model.
 * @param path - the tab's file path.
 * @returns an id safe for a DOM attribute: the path is URI-encoded and its `%`
 *   escapes turned into `_`, so a Chinese chapter folder and a `/` both survive.
 */
export function tabElementId(path: string): string {
  return `dsh-notebook-tab-${encodeURIComponent(path).replaceAll('%', '_')}`
}

/**
 * The name a tab and a tree row show for a path.
 *
 * Both lists name the same file the same way — the last segment — so the tab's
 * type artwork and the row's cannot disagree about which file is meant.
 * @param path - a project-relative POSIX path.
 * @returns its last segment, or the path itself for the workspace root.
 */
export function fileNameOf(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.length > 0 ? name : path
}

/**
 * The open record for a path.
 * @param files - the open files.
 * @param path - the path to find.
 * @returns the record, or undefined when that file is not open.
 */
export function findFile(files: readonly OpenFile[], path: string): OpenFile | undefined {
  return files.find(file => file.path === path)
}

/**
 * Add a tab for a path that is not open yet.
 *
 * A tab appears **before** its file is read, with `loading: true`, so the strip
 * answers a click immediately on a slow disk; `seed` is the shortcut a just-created
 * file takes, because its text is already known and there is nothing to wait for.
 * Opening a path that is already open changes nothing and returns the same array,
 * so the caller's `setState` bails out.
 * @param files - the open files.
 * @param path - the file to open.
 * @param seed - the text and mode, when they are already known.
 * @returns the new list, or `files` when the path was already open.
 */
export function openFile(files: OpenFile[], path: string, seed?: { draft: string; mode: EditorMode }): OpenFile[] {
  if (findFile(files, path) !== undefined) return files
  return [...files, {
    path,
    draft: seed?.draft ?? '',
    dirty: false,
    mode: seed?.mode ?? initialEditorMode(path),
    docToken: 0,
    loading: seed === undefined,
  }]
}

/**
 * Change one open file.
 * @param files - the open files.
 * @param path - which file to change.
 * @param patch - the fields to replace; `path` itself is not one of them.
 * @returns the new list, or `files` when that path is not open.
 */
export function patchFile(files: OpenFile[], path: string, patch: Partial<Omit<OpenFile, 'path'>>): OpenFile[] {
  let found = false
  const next = files.map((file) => {
    if (file.path !== path) return file
    found = true
    return { ...file, ...patch }
  })
  return found ? next : files
}

/**
 * Drop one tab.
 * @param files - the open files.
 * @param path - the file to close.
 * @returns the new list, or `files` when that path is not open.
 */
export function closeFile(files: OpenFile[], path: string): OpenFile[] {
  const index = files.findIndex(file => file.path === path)
  if (index < 0) return files
  return [...files.slice(0, index), ...files.slice(index + 1)]
}

/**
 * Move one open tab to a new path, keeping its buffer.
 *
 * A rename changes the tab's identity — its path is the key of every write — but not
 * its contents, so the record moves rather than being closed and re-opened (which
 * would discard unsaved text and re-read from disk). The `mode` is kept too: a file
 * renamed from `笔记` to `笔记.md` is the same document, and flipping it to the
 * rendered surface because its name gained a suffix would be a surprise.
 * @param file - the record to move.
 * @param from - its current path.
 * @param to - the path it now has.
 * @returns the record, moved when it was the one at `from`.
 */
export function rekeyFile(file: OpenFile, from: string, to: string): OpenFile {
  return file.path === from ? { ...file, path: to } : file
}

/**
 * Rewrite one tree entry after a rename, and every entry beneath it.
 *
 * A renamed folder moves its whole subtree, so patching only the folder's own row
 * would leave its children pointing at a path that no longer exists — and the tree
 * would draw them under a folder that is still there but no longer contains them.
 * @param entry - one listing entry, of any shape that carries `path` and `name`.
 * @param from - the old project-relative path.
 * @param to - the new one.
 * @param name - the new basename, for the entry itself.
 * @returns the entry, rewritten when it is inside `from`.
 */
export function renameEntry<T extends { path: string, name: string }>(
  entry: T,
  from: string,
  to: string,
  name: string,
): T {
  if (entry.path === from) return { ...entry, path: to, name }
  if (!entry.path.startsWith(`${from}/`)) return entry
  return { ...entry, path: `${to}${entry.path.slice(from.length)}` }
}

/**
 * Which tabs a "close all" gesture closes, and which one stays drawn.
 *
 * The gesture is the whole strip at once, but not unconditionally: closing writes
 * every dirty tab first, and a write that was refused keeps its tab open — closing
 * it would leave the author's sentence nowhere but the error banner. So the plan
 * can be "all but the one that could not be written".
 *
 * The page after it follows the same reading as a single close: a drawn tab that
 * closes hands the editor to a tab that stayed; a drawn tab that stays (because its
 * write was refused, or it was opened while the writes were in flight) keeps the
 * page. With nothing kept, the editor is empty.
 * @param files - the open files, **before** the close, in tab order.
 * @param refused - the paths whose write was refused; those tabs stay.
 * @param active - the tab that is drawn now.
 * @returns the paths to close, and the path to draw afterwards.
 */
export function planCloseAll(
  files: readonly OpenFile[],
  refused: ReadonlySet<string>,
  active: string | undefined,
): { close: string[], active: string | undefined } {
  const close = files.filter(file => !refused.has(file.path)).map(file => file.path)
  // `active` may name a tab opened after the gesture started: that one is not in
  // `close`, so the page simply keeps it.
  if (active !== undefined && !close.includes(active)) return { close, active }
  const kept = files.filter(file => refused.has(file.path)).map(file => file.path)
  return { close, active: kept[0] }
}

/**
 * Which tab should be drawn after one closes.
 *
 * Closing a tab the author is not looking at leaves the selection alone. Closing
 * the drawn one moves to the neighbour on its right — the tab that took its place —
 * or, when the last tab closed, to the new last one. Only closing the only tab
 * leaves the editor empty.
 * @param files - the open files, **before** the close.
 * @param closedPath - the tab being closed.
 * @param active - the tab that is drawn now.
 * @returns the path to draw next, or undefined when nothing is left.
 */
export function nextActive(files: readonly OpenFile[], closedPath: string, active: string | undefined): string | undefined {
  if (active !== closedPath) return active
  const index = files.findIndex(file => file.path === closedPath)
  if (index < 0) return active
  const remaining = [...files.slice(0, index), ...files.slice(index + 1)]
  if (remaining.length === 0) return undefined
  return remaining[Math.min(index, remaining.length - 1)]?.path
}
