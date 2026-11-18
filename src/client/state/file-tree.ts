/**
 * Project-directory navigation, as pure functions.
 *
 * The Host returns one flat listing of the whole project and everything else is
 * derived here — which directory you are in, what is inside it, how many files a
 * folder holds. Keeping that out of React is what makes it testable without a
 * DOM, and the browser is the only reason this module exists.
 */
import type { ProjectFileEntry } from '../../host/types'

/** The project root, as a directory path. */
export const PROJECT_ROOT = ''

/** A subdirectory of the directory being browsed. */
export interface DirectoryChild {
  name: string
  /** Full project-relative path, which is what navigating into it takes. */
  path: string
  /** Files at or beneath this directory, so the sidebar can hint at its size. */
  fileCount: number
}

/**
 * Split a project-relative path into its segments.
 * @param path - a project-relative POSIX path.
 * @returns its non-empty segments.
 */
export function pathSegments(path: string): string[] {
  return path.split('/').filter(segment => segment !== '')
}

/**
 * The directory a file lives in.
 * @param path - a project-relative POSIX path.
 * @returns the containing directory, or {@link PROJECT_ROOT}.
 */
export function parentOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? PROJECT_ROOT : path.slice(0, cut)
}

/**
 * Natural name ordering: runs of digits compare as numbers, not characters.
 *
 * `笔记10.md` belongs after `笔记9.md`, and so does `10.md` after `9.md`; sorted as
 * plain strings the second one lands between `1` and `2`. `localeCompare`'s
 * `numeric` option answers most of this, but it is delegated to the platform's ICU
 * data, and it also decides that `9.md` and `09.md` are *equal* — an unstable
 * comparator, so two rows whose names differ only in zero padding can swap on any
 * re-render. This comparator is written out instead:
 *
 * - a run of ASCII digits compares by value (leading zeros ignored, then the
 *   shorter run first, so `09.md` and `9.md` have one fixed order);
 * - a run of anything else compares with the Chinese locale, so 第/一/二 group the
 *   way a reader expects and Latin names keep case-insensitive grouping;
 * - a digit run sorts before a non-digit run at the same position, which is what
 *   makes `9.md` precede `笔记.md` deterministically;
 * - full-width digits (０-９) are folded to ASCII first, because a name typed with
 *   an input method is the same name.
 * @param left - one name.
 * @param right - another name.
 * @returns the comparator result: negative, zero, or positive.
 */
export function compareNames(left: string, right: string): number {
  const a = foldDigits(left)
  const b = foldDigits(right)
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const aDigit = isAsciiDigit(a.charCodeAt(i))
    const bDigit = isAsciiDigit(b.charCodeAt(j))
    if (aDigit !== bDigit) return aDigit ? -1 : 1
    const aEnd = runEnd(a, i, aDigit)
    const bEnd = runEnd(b, j, bDigit)
    const order = aDigit
      ? compareDigitRuns(a.slice(i, aEnd), b.slice(j, bEnd))
      : compareTextRuns(a.slice(i, aEnd), b.slice(j, bEnd))
    if (order !== 0) return order
    i = aEnd
    j = bEnd
  }
  // A name that ran out first sorts first: `笔记` before `笔记2`.
  if (i < a.length) return 1
  if (j < b.length) return -1
  // Folding can make two distinct names compare equal — `１０.md` against `10.md`
  // is the case that matters here, because both are real files on a case-sensitive
  // disk. The raw names settle it, so the sort never leaves a pair to the engine.
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** Whether one UTF-16 code unit is an ASCII digit. */
function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39
}

/**
 * Where a run of the same kind ends.
 * @param text - the name.
 * @param from - the run's first index.
 * @param digit - whether the run is digits.
 * @returns the first index after the run.
 */
function runEnd(text: string, from: number, digit: boolean): number {
  let index = from
  while (index < text.length && isAsciiDigit(text.charCodeAt(index)) === digit) index += 1
  return index
}

/**
 * Compare two runs of non-digits.
 *
 * The locale decides the reading order — 第/一/二 group the way a reader expects —
 * and a raw code-unit comparison settles the case the locale calls *equal*: two
 * names that are canonically equivalent (`e` + combining accent vs `é`) are
 * distinct files on this side of the comparison, so the sort still has one order
 * for them rather than leaving it to the engine.
 * @param left - a run.
 * @param right - another run.
 * @returns the comparator result.
 */
function compareTextRuns(left: string, right: string): number {
  const order = left.localeCompare(right, 'zh-Hans-CN')
  if (order !== 0 || left === right) return order
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  return left < right ? -1 : 1
}

/**
 * Compare two runs of digits by value.
 *
 * Length after the leading zeros decides the value first, which avoids converting
 * an arbitrarily long run to a number; equal values fall back to the shorter run,
 * so `09` and `9` have a fixed order instead of being "equal".
 * @param left - a digit run.
 * @param right - another digit run.
 * @returns the comparator result.
 */
function compareDigitRuns(left: string, right: string): number {
  const a = left.replace(/^0+/, '')
  const b = right.replace(/^0+/, '')
  if (a.length !== b.length) return a.length < b.length ? -1 : 1
  if (a !== b) return a < b ? -1 : 1
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  return 0
}

/**
 * Map full-width digits to ASCII.
 * @param text - a file name.
 * @returns the name with ０-９ folded.
 */
function foldDigits(text: string): string {
  let out = ''
  for (const character of text) {
    const code = character.charCodeAt(0)
    out += code >= 0xff10 && code <= 0xff19 ? String.fromCharCode(code - 0xff10 + 0x30) : character
  }
  return out
}

/**
 * The subdirectories directly inside one directory.
 *
 * Counted by crediting every ancestor folder of every file, so a count is the
 * recursive one a reader expects from a folder rather than the number of entries
 * sitting immediately inside it.
 * @param files - the Host's flat listing.
 * @param dir - the directory being browsed, or {@link PROJECT_ROOT}.
 * @returns its immediate subdirectories, name-sorted.
 */
export function childDirectories(files: readonly ProjectFileEntry[], dir: string): DirectoryChild[] {
  const counts = new Map<string, number>()
  for (const file of files) {
    // Directories are entries in their own right and must not count as content.
    if (file.kind === 'directory') continue
    const rest = dir === PROJECT_ROOT
      ? file.path
      : (file.path.startsWith(`${dir}/`) ? file.path.slice(dir.length + 1) : undefined)
    if (rest === undefined) continue
    const segments = pathSegments(rest)
    // A path with no slash sits directly here, so it credits no subdirectory.
    let prefix = dir
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]
      if (segment === undefined) break
      prefix = prefix === PROJECT_ROOT ? segment : `${prefix}/${segment}`
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
    }
  }
  // The listing comes from the directory entries themselves rather than from the
  // paths above: those only exist where a file does, so an empty directory —
  // which is exactly what a brand-new story is made of — would be invisible.
  return files
    .filter(entry => entry.kind === 'directory' && parentOf(entry.path) === dir)
    .map(entry => ({ name: entry.name, path: entry.path, fileCount: counts.get(entry.path) ?? 0 }))
    .sort((left, right) => compareNames(left.name, right.name))
}

/**
 * The files directly inside one directory.
 * @param files - the Host's flat listing.
 * @param dir - the directory being browsed, or {@link PROJECT_ROOT}.
 * @returns its files, name-sorted, with any directories left out.
 */
export function childFiles(files: readonly ProjectFileEntry[], dir: string): ProjectFileEntry[] {
  return files
    .filter(file => file.kind !== 'directory' && parentOf(file.path) === dir)
    .sort((left, right) => compareNames(left.name, right.name))
}

/**
 * The trail of directories from the root down to `dir`.
 *
 * Returned as data rather than markup so the sidebar can render it and the
 * checks can assert on it without a DOM.
 * @param dir - the directory being browsed.
 * @returns `[path, name]` pairs, the root first with an empty name.
 */
export function breadcrumb(dir: string): [string, string][] {
  const trail: [string, string][] = [[PROJECT_ROOT, '']]
  let accumulated = ''
  for (const segment of pathSegments(dir)) {
    accumulated = accumulated === '' ? segment : `${accumulated}/${segment}`
    trail.push([accumulated, segment])
  }
  return trail
}

/**
 * One node of the directory tree the sidebar draws.
 *
 * Built from the Host's flat listing rather than fetched separately: the listing
 * already holds every directory (including empty ones) and every file, so the
 * shape is derivable and there is no second answer to "what is in this project".
 */
export interface TreeNode {
  name: string
  /** Full project-relative path; also the expand/collapse key. */
  path: string
  /** True for a directory, false for a file. */
  directory: boolean
  /**
   * True for a file the editor cannot open.
   *
   * The tree lists it anyway — a hidden file is indistinguishable from a lost one —
   * and the row says so (`不可预览`) instead of pretending the click will work.
   */
  binary: boolean
  /** File size in bytes; `0` for a directory. */
  bytes: number
  children: TreeNode[]
}

/**
 * Turn the flat listing into a tree.
 *
 * Directories sort before files at every level, each level name-sorted with the
 * numeric collation a manuscript needs. A file whose parent directory the listing
 * skipped — possible for a truncated tree (`MAX_TREE_ENTRIES`) — still gets a
 * synthesized chain, because a file you cannot see is worse than a folder that
 * was not listed.
 * @param files - the Host's flat listing.
 * @returns the root level's nodes.
 */
export function buildTree(files: readonly ProjectFileEntry[]): TreeNode[] {
  const roots: TreeNode[] = []
  const directories = new Map<string, TreeNode>()

  /** Put one node under its parent, synthesizing missing ancestors. */
  const attach = (node: TreeNode): void => {
    const parent = parentOf(node.path)
    let siblings = roots
    if (parent !== PROJECT_ROOT) {
      let found = directories.get(parent)
      if (found === undefined) {
        // Rebuild the whole chain, so an unlisted middle directory does not
        // swallow its children.
        let prefix = ''
        for (const segment of pathSegments(parent)) {
          prefix = prefix === '' ? segment : `${prefix}/${segment}`
          let next = directories.get(prefix)
          if (next === undefined) {
            next = { name: segment, path: prefix, directory: true, binary: false, bytes: 0, children: [] }
            directories.set(prefix, next)
            siblings.push(next)
          }
          siblings = next.children
        }
        siblings.push(node)
        return
      }
      found.children.push(node)
      return
    }
    siblings.push(node)
  }

  for (const entry of files) {
    if (entry.kind !== 'directory') continue
    const node: TreeNode = { name: entry.name, path: entry.path, directory: true, binary: false, bytes: 0, children: [] }
    directories.set(entry.path, node)
    attach(node)
  }
  for (const entry of files) {
    if (entry.kind === 'directory') continue
    attach({
      name: entry.name,
      path: entry.path,
      directory: false,
      binary: entry.kind === 'binary',
      bytes: entry.bytes,
      children: [],
    })
  }

  const sortLevel = (nodes: TreeNode[]): void => {
    nodes.sort((left, right) => {
      if (left.directory !== right.directory) return left.directory ? -1 : 1
      return compareNames(left.name, right.name)
    })
    for (const node of nodes) sortLevel(node.children)
  }
  sortLevel(roots)
  return roots
}

/**
 * Whether a path is one new files may be aimed at.
 *
 * The root always is; anything else has to still be a directory in the listing —
 * a folder can disappear under the panel (renamed in another editor, removed by
 * the model), and an aim at a folder that no longer exists would quietly recreate
 * it on the next write.
 * @param files - the Host's flat listing.
 * @param path - a project-relative POSIX path.
 * @returns true when it is the root or a listed directory.
 */
export function isDirectoryPath(files: readonly ProjectFileEntry[], path: string): boolean {
  if (path === PROJECT_ROOT) return true
  return files.some(entry => entry.kind === 'directory' && entry.path === path)
}

/**
 * How many files a node holds, recursively.
 * @param node - a tree node.
 * @returns 1 for a file, the descendant file count for a directory.
 */
export function countFiles(node: TreeNode): number {
  if (!node.directory) return 1
  let total = 0
  for (const child of node.children) total += countFiles(child)
  return total
}

/**
 * The directories that must be open for a path to be visible.
 *
 * Every ancestor, plus the path itself when it is a directory; the root is
 * implicit (it is the tree, not a row).
 * @param path - a project-relative POSIX path.
 * @param directory - whether `path` is itself a directory.
 * @returns the paths to expand, outermost first.
 */
export function ancestorsOf(path: string, directory = false): string[] {
  const trail: string[] = directory ? [path] : []
  let current = parentOf(path)
  while (current !== PROJECT_ROOT) {
    trail.unshift(current)
    current = parentOf(current)
  }
  return trail
}

/**
 * Render a byte count for display.
 * @param bytes - the size.
 * @returns a short human-readable size.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The padding before a top-level row's icon, in px. */
export const TREE_INDENT_BASE = 8

/** How much one level of nesting adds, in px. The indent *is* the tree. */
export const TREE_INDENT = 14

/**
 * The deepest indent the tree draws, in px.
 *
 * A cap rather than an unbounded `depth * 14`: a row has one icon (16px), one gap
 * (8px) and a name, all inside the column's narrowest width (`SIDE_MIN` in
 * `state/layout`, 240px). Past roughly this much padding there is no room left for
 * the icon itself, so a deeply nested row would draw its icon outside its own box
 * and the name would be unreadable anyway. Past the cap every level shares the
 * deepest indent — the same choice VS Code's explorer makes, and the name still
 * says which file it is.
 *
 * The number is derived, not picked: 240 (SIDE_MIN) − 12 (list padding) − 2 (row
 * border) − 16 (icon) − 8 (gap) leaves 202 for the icon's offset; 160 keeps a
 * readable name on top of that.
 */
export const TREE_INDENT_MAX = 160

/**
 * The left padding that draws one row's depth.
 *
 * Held here rather than in the row markup because **three** places need it and
 * they must agree: the rows, the empty row a name is typed into, and the row an
 * inline rename edits. A level that one of them forgot was a row that jumped
 * sideways when the author started typing.
 * @param depth - nesting level; 0 is a top-level entry.
 * @returns left padding in px, never above {@link TREE_INDENT_MAX}.
 */
export function rowIndent(depth: number): number {
  if (!Number.isFinite(depth) || depth <= 0) return TREE_INDENT_BASE
  return Math.min(TREE_INDENT_BASE + Math.floor(depth) * TREE_INDENT, TREE_INDENT_MAX)
}
