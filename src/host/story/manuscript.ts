/**
 * What the notebook's tree shows, and how a file is read back.
 *
 * The format layer, kept apart from the IO that serves it: everything here is
 * pure — which names the browser may open, how a text is counted — and the store
 * in `project.ts` owns the filesystem, the sandbox policy and the listing.
 *
 * @module notebook/story/manuscript
 */
import { basename } from 'node:path'

/** Deepest nesting the tree descends into. */
export const MAX_TREE_DEPTH = 8
/** Ceiling on files listed for one root, so a huge tree cannot stall the page. */
export const MAX_TREE_ENTRIES = 2_000

/** Extensions the browser opens as editable text. */
export const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.jsonl', '.yml', '.yaml', '.csv'])

/**
 * Whether a file is text the editor may open.
 *
 * An allowlist rather than a denylist: a working directory accumulates images,
 * archives and OS droppings, and showing all of it would bury the notes. A bare
 * name has no extension at all — the panel names files by title (`第一章`) — and
 * a title is a text file; only an *unknown* extension is refused.
 * @param path - project-relative path; only its basename is considered.
 * @returns true when the file is editable text.
 */
export function isTextFile(path: string): boolean {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return true
  return TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase())
}

/** Whether an error means "the file is not there". */
export function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'ENOENT' || code === 'FS_NOT_FOUND'
}

/**
 * Count characters the way a writer counts them: code points, front-matter aside.
 * @param content - the full file text.
 * @returns the code-point count of the body.
 */
export function countChars(content: string): number {
  const withoutFrontMatter = content.startsWith('---')
    ? content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    : content
  return [...withoutFrontMatter].length
}
