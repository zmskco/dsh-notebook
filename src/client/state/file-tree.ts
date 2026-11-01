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
 * Name ordering that reads the way a manuscript does.
 *
 * `numeric` is what puts 第2章 before 第10章; without it a hundred-chapter
 * project reads in dictionary order and looks shuffled.
 * @param left - one name.
 * @param right - another name.
 * @returns the comparator result.
 */
function compareNames(left: string, right: string): number {
  return left.localeCompare(right, 'zh-Hans-CN', { numeric: true })
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
            next = { name: segment, path: prefix, directory: true, bytes: 0, children: [] }
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
    const node: TreeNode = { name: entry.name, path: entry.path, directory: true, bytes: 0, children: [] }
    directories.set(entry.path, node)
    attach(node)
  }
  for (const entry of files) {
    if (entry.kind === 'directory') continue
    attach({ name: entry.name, path: entry.path, directory: false, bytes: entry.bytes, children: [] })
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
