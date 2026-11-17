/**
 * The workspace store: everything that touches the notebook's files.
 *
 * There is one root and no project layer any more: the panel's tree is the
 * workspace itself, so the store is built over that directory and every path it
 * returns is relative to it.
 *
 * Text goes through `ctx.fs`, so reads and writes inherit the Harness filesystem
 * provider, its sandbox policy, and its canonicalization. Two operations have no
 * provider equivalent and reach `node:fs` instead — creating a directory, and
 * moving or removing one — always at a path the provider already resolved and
 * proved is inside the root, exactly as {@link ProjectStore.createDirectory} does.
 *
 * Files are different, and deliberately so: deleting and renaming one goes through
 * `ctx.fs.deleteFile` / `moveFile`, which stamp the same sandbox policy a write
 * does. A workspace pinned outside the deployment boundary is therefore writable
 * here and still stamped correctly, and a read-only deployment refuses it at the
 * seam rather than trusting this file to remember the rule.
 */
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { FsDirEntry, FsService, FsTarget, SandboxExecutionPolicy } from '../dsh.js'
import { NotebookError, asNotebookError } from '../errors.js'
import { assertPathName, assertRelativePath } from './paths.js'
import type { FileDocument, ProjectFileEntry } from '../types.js'
import { countChars, isMissing, isTextFile, MAX_TREE_DEPTH, MAX_TREE_ENTRIES } from './manuscript.js'

/**
 * Directories the tree never descends into.
 *
 * `node_modules` is not writing, and a workspace-sized tree that walked it would
 * spend seconds per listing and push the author's own files past the entry cap.
 */
const SKIP_DIRS = new Set(['node_modules'])

/** A root that has been resolved and proven to be a directory. */
export interface OpenRoot {
  id: string
  dir: FsTarget
  /** Process-world absolute path; the base for every relative resolution. */
  abs: string
}

/**
 * The project id the panel uses for the workspace itself.
 *
 * The empty string is the id — it cannot collide with a directory name, whose
 * name is non-empty by construction.
 */
export const WORKSPACE_PROJECT = ''

export class ProjectStore {
  private rootCache: FsTarget | undefined

  constructor(
    private readonly fs: FsService,
    private readonly rootDir: string,
    private readonly log: { warn(...args: unknown[]): void },
    /**
     * The policy stamped on every content write.
     *
     * A write through `ctx.fs` with no explicit policy resolves against the
     * *deployment* fallback (`defaultMode` + `workspaceRoot`), which is not
     * necessarily the directory the notebook lives in. Stamping the root as the
     * boundary is what lets a fresh install serve a workspace outside the
     * deployment workspace with no profile edit at all; see
     * {@link module:notebook/story/sandbox}. `undefined` means this profile
     * mounted no confining filesystem, so there is nothing to stamp.
     */
    private readonly writePolicy?: SandboxExecutionPolicy,
  ) {}

  /** Resolve (and create on first use) the root directory. */
  async root(): Promise<FsTarget> {
    if (this.rootCache !== undefined) return this.rootCache
    let target = await this.fs.resolve(this.rootDir)
    if (await this.fs.stat(target) === undefined) {
      await mkdir(this.fs.processPath(target), { recursive: true })
      target = await this.fs.resolve(this.rootDir)
    }
    this.rootCache = target
    return target
  }

  /**
   * Open the store's own root as the project.
   *
   * The operator's folder is not a project id, so this skips the name check and
   * hands back the root the store already owns. Paths stay relative and stay
   * containment-checked against it.
   * @returns the root, opened as a project whose id is {@link WORKSPACE_PROJECT}.
   * @throws {NotebookError} `not-found` when the root is not a directory.
   */
  async openRoot(): Promise<OpenRoot> {
    const dir = await this.root()
    const info = await this.fs.stat(dir)
    if (info === undefined || info.type !== 'directory') {
      throw new NotebookError('not-found', `workspace ${this.rootDir} is not a directory`)
    }
    return { id: WORKSPACE_PROJECT, dir, abs: this.fs.processPath(dir) }
  }

  /**
   * Resolve a project-relative path and re-check containment on the canonical target.
   * @param project - an opened root.
   * @param rel - a project-relative POSIX path.
   * @returns the resolved target.
   * @throws {NotebookError} `forbidden` when the canonical target escapes the root.
   */
  async resolveInside(project: OpenRoot, rel: string): Promise<FsTarget> {
    const safe = assertRelativePath(rel)
    const target = await this.fs.resolve(safe, { cwd: project.abs })
    if (!this.fs.contains(project.dir, target)) {
      throw new NotebookError('forbidden', `${safe} resolves outside the workspace`)
    }
    return target
  }

  /**
   * Create the parent directories of a project-relative path.
   *
   * Every segment is already validated by {@link assertRelativePath}, and the base
   * is the provider-resolved root, so this cannot create anything outside it.
   */
  private async ensureParent(project: OpenRoot, rel: string): Promise<void> {
    const segments = assertRelativePath(rel).split('/').slice(0, -1)
    if (segments.length === 0) return
    try {
      await mkdir(join(project.abs, ...segments), { recursive: true })
    } catch (error: unknown) {
      throw asNotebookError(error, `cannot create the directory for ${rel}`)
    }
  }

  /**
   * The names directly inside one folder of the workspace.
   *
   * Used when naming a new file: the question is "is this name taken *here*", so
   * listing the whole tree would walk every subdirectory — seconds on a workspace
   * that holds a `node_modules` — to answer something one `listDir` answers.
   * @param project - an opened root.
   * @param folder - project-relative folder, `''` for the root.
   * @returns the entry names in that folder; empty when it cannot be read.
   */
  private async namesIn(project: OpenRoot, folder: string): Promise<Set<string>> {
    const target = folder === '' ? project.dir : await this.resolveInside(project, folder)
    const entries = await this.fs.listDir(target).catch(() => [] as FsDirEntry[])
    return new Set(entries.map(entry => entry.name))
  }

  /**
   * List every file and directory under the root.
   *
   * Dot entries are tooling rather than notes (`.git`), `node_modules` is not
   * writing, and unknown extensions are hidden: a file the tree cannot open is
   * noise in a list whose purpose is to be clicked.
   * @param project - an opened root.
   * @returns the entries, sorted by path.
   */
  async listFiles(project: OpenRoot): Promise<ProjectFileEntry[]> {
    const out: ProjectFileEntry[] = []
    const walk = async (dir: FsTarget, relDir: string, depth: number): Promise<void> => {
      if (depth > MAX_TREE_DEPTH || out.length >= MAX_TREE_ENTRIES) return
      let entries: FsDirEntry[]
      try {
        entries = await this.fs.listDir(dir)
      } catch {
        // One unreadable subdirectory must not cost the user the whole tree.
        return
      }
      for (const entry of entries) {
        if (out.length >= MAX_TREE_ENTRIES) return
        if (entry.name.startsWith('.')) continue
        if (entry.type === 'directory' && SKIP_DIRS.has(entry.name)) continue
        // Re-checked per child rather than trusting the walk, so a symlink
        // pointing out of the root cannot smuggle an outside file in.
        if (!this.fs.contains(project.dir, entry.target)) continue
        const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
        if (entry.type === 'directory') {
          out.push({ path: rel, name: entry.name, bytes: 0, kind: 'directory' })
          await walk(entry.target, rel, depth + 1)
          continue
        }
        if (entry.type !== 'file') continue
        if (!isTextFile(entry.name)) continue
        const size = entry.size ?? (await this.fs.stat(entry.target).catch(() => undefined))?.size ?? 0
        out.push({ path: rel, name: entry.name, bytes: size, kind: 'text' })
      }
    }
    await walk(project.dir, '', 0)
    // `numeric` so 第2章 sorts before 第10章 rather than after it, and Chinese
    // collation so the folder names group the way a reader expects.
    out.sort((left, right) => left.path.localeCompare(right.path, 'zh-Hans-CN', { numeric: true }))
    return out
  }

  /**
   * Read one text file.
   * @param project - an opened root.
   * @param rel - project-relative POSIX path.
   * @returns the document.
   * @throws {NotebookError} `bad-request` when the extension is not editable text,
   *   `not-found` when the file is absent.
   */
  async readTextFile(project: OpenRoot, rel: string): Promise<FileDocument> {
    const safe = assertRelativePath(rel)
    if (!isTextFile(safe)) throw new NotebookError('bad-request', `${safe} is not a text file this editor opens`)
    const target = await this.resolveInside(project, safe)
    let content: string
    try {
      content = await this.fs.readText(target)
    } catch (error: unknown) {
      if (isMissing(error)) throw new NotebookError('not-found', `${safe} does not exist`)
      throw asNotebookError(error, `cannot read ${safe}`)
    }
    return { path: safe, content, chars: countChars(content), bytes: Buffer.byteLength(content, 'utf8') }
  }

  /**
   * Write one text file, creating parent directories as needed.
   * @param project - an opened root.
   * @param rel - project-relative POSIX path.
   * @param content - the full new contents.
   * @returns the stored document.
   * @throws {NotebookError} `bad-request` when the extension is not editable text.
   */
  async writeTextFile(project: OpenRoot, rel: string, content: string): Promise<FileDocument> {
    const safe = assertRelativePath(rel)
    if (!isTextFile(safe)) throw new NotebookError('bad-request', `${safe} is not a text file this editor writes`)
    await this.ensureParent(project, safe)
    const target = await this.resolveInside(project, safe)
    try {
      await this.fs.writeText(target, content, undefined, undefined, this.writePolicy)
    } catch (error: unknown) {
      throw asNotebookError(error, `cannot write ${safe}`)
    }
    return { path: safe, content, chars: countChars(content), bytes: Buffer.byteLength(content, 'utf8') }
  }

  /**
   * Create one directory inside the workspace.
   *
   * `ctx.fs` writes files but cannot make a directory, so this reaches `node:fs`
   * at a path the provider resolved and proved is inside the root. The path is
   * validated by {@link assertRelativePath} before it is resolved, so it cannot
   * name an absolute path or climb out with `..`.
   * @param project - an opened root.
   * @param rel - project-relative POSIX path of the new directory.
   * @returns the path that was created.
   * @throws {NotebookError} `conflict` when something already holds that path.
   */
  async createDirectory(project: OpenRoot, rel: string): Promise<{ path: string }> {
    const safe = assertRelativePath(rel)
    const target = await this.resolveInside(project, safe)
    if (await this.fs.stat(target) !== undefined) {
      throw new NotebookError('conflict', `${safe} already exists`)
    }
    try {
      await mkdir(this.fs.processPath(target), { recursive: true })
    } catch (error: unknown) {
      throw asNotebookError(error, `cannot create ${safe}`)
    }
    return { path: safe }
  }

  /**
   * The path for a new file whose name is exactly what the author typed.
   *
   * A title is the file name: appending `.md` would give the same document a
   * second name, and a title that already carries an extension would get two
   * (`.md.md`). Uniqueness is the only thing enforced here — a number goes before
   * the extension, so `名.md` becomes `名-2.md` rather than `名.md-2`.
   * @param project - an opened root.
   * @param dir - the folder to create it in, project-relative; `''` is the root.
   * @param name - the file name, already validated as one path segment.
   * @returns the project-relative path, free of collisions.
   */
  async newNamedPath(project: OpenRoot, dir: string, name: string): Promise<string> {
    const folder = dir.length === 0 ? '' : assertRelativePath(dir)
    const at = (file: string): string => (folder === '' ? file : `${folder}/${file}`)
    const used = await this.namesIn(project, folder)
    if (!used.has(name)) return at(name)
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const extension = dot > 0 ? name.slice(dot) : ''
    for (let index = 2; index < 10_000; index += 1) {
      const candidate = `${stem}-${String(index)}${extension}`
      if (!used.has(candidate)) return at(candidate)
    }
    throw new NotebookError('conflict', 'no free file name remains')
  }

  /** Validate one user-supplied name as a single path segment. */
  assertName(value: unknown): string {
    return assertPathName(value)
  }

  /**
   * Whether a project-relative path names a directory.
   *
   * Asked before a rename or a delete decides *how* to do it: a file goes through
   * the filesystem provider (which stamps the sandbox policy), a directory through
   * `node:fs` (which has no provider equivalent). Guessing from a trailing slash
   * would be guessing about the caller's intent rather than about the disk.
   * @param project - an opened root.
   * @param rel - a project-relative POSIX path.
   * @returns true for a directory; false for a file or anything absent.
   */
  async isDirectory(project: OpenRoot, rel: string): Promise<boolean> {
    const target = await this.resolveInside(project, rel)
    const info = await this.fs.stat(target).catch(() => undefined)
    return info?.type === 'directory'
  }

  /**
   * Rename one file or directory, in place in its own folder.
   *
   * The new name is one path segment, validated exactly as a create name is, so a
   * rename can never turn into a move: the folder stays where it was and only the
   * last segment changes. That restriction is deliberate — "rename" in a file tree
   * means the thing stays put, and a control that could silently relocate a chapter
   * folder is not the gesture the author made.
   *
   * A file keeps its content byte for byte: `moveFile` publishes the source text at
   * the destination and removes the source, both guarded by the write policy. A
   * directory is moved with `rename(2)`, which is atomic and cheap even for a
   * thousand chapters.
   * @param project - an opened root.
   * @param rel - the existing project-relative path.
   * @param name - the new name for it, one segment.
   * @returns the new project-relative path.
   * @throws {NotebookError} `not-found` when the source is absent, `conflict` when
   *   the destination is taken.
   */
  async renameEntry(project: OpenRoot, rel: string, name: string): Promise<{ path: string }> {
    const safe = assertRelativePath(rel)
    const newName = assertPathName(name)
    const parent = safe.includes('/') ? safe.slice(0, safe.lastIndexOf('/')) : ''
    const next = parent === '' ? newName : `${parent}/${newName}`
    // A rename to the name it already has is a no-op, not a conflict: the user may
    // simply have confirmed an unchanged field, and both branches below would
    // otherwise refuse a state that is already what was asked for.
    if (next === safe) return { path: safe }

    const source = await this.resolveInside(project, safe)
    if (await this.fs.stat(source) === undefined) {
      throw new NotebookError('not-found', `${safe} does not exist`)
    }
    const destination = await this.resolveInside(project, next)
    if (await this.fs.stat(destination) !== undefined) {
      throw new NotebookError('conflict', `${next} already exists`)
    }

    if (await this.isDirectory(project, safe)) {
      try {
        await rename(this.fs.processPath(source), this.fs.processPath(destination))
      } catch (error: unknown) {
        throw asNotebookError(error, `cannot rename ${safe}`)
      }
      return { path: next }
    }

    try {
      await this.fs.moveFile(source, destination, {}, undefined, this.writePolicy)
    } catch (error: unknown) {
      throw asNotebookError(error, `cannot rename ${safe}`)
    }
    return { path: next }
  }

  /**
   * Delete one file or directory.
   *
   * A directory goes with everything under it, which is what a file manager does
   * and what "delete this folder" means. The panel asks first and says how much is
   * inside (see `api.delete`), because this is the one operation in the plugin that
   * cannot be undone by typing.
   *
   * Containment is checked before anything is removed, so a symlink pointing out of
   * the workspace is refused rather than followed.
   * @param project - an opened root.
   * @param rel - the project-relative path to remove.
   * @returns the path that was removed, and whether it was a directory.
   * @throws {NotebookError} `not-found` when the path is absent.
   */
  async deleteEntry(project: OpenRoot, rel: string): Promise<{ path: string; directory: boolean }> {
    const safe = assertRelativePath(rel)
    const target = await this.resolveInside(project, safe)
    if (await this.fs.stat(target) === undefined) {
      throw new NotebookError('not-found', `${safe} does not exist`)
    }
    if (await this.isDirectory(project, safe)) {
      try {
        await rm(this.fs.processPath(target), { recursive: true, force: false })
      } catch (error: unknown) {
        throw asNotebookError(error, `cannot delete ${safe}`)
      }
      return { path: safe, directory: true }
    }
    try {
      await this.fs.deleteFile(target, undefined, undefined, this.writePolicy)
    } catch (error: unknown) {
      throw asNotebookError(error, `cannot delete ${safe}`)
    }
    return { path: safe, directory: false }
  }

  /**
   * The absolute directory a path should be revealed in.
   *
   * "Show this in the file manager" means: the folder itself for a folder, and the
   * folder containing it for a file — the file manager's own selection gesture is
   * platform-specific and unreliable (`explorer /select,` starts a second shell that
   * does not always surface), while opening a directory is the one launch this
   * plugin has already measured on every platform.
   * @param project - an opened root.
   * @param rel - a project-relative path, or `''` for the workspace itself.
   * @returns an absolute directory path, proven to be inside the root.
   */
  async revealDirectoryFor(project: OpenRoot, rel: string): Promise<string> {
    if (rel === '') return project.abs
    const target = await this.resolveInside(project, rel)
    if (await this.isDirectory(project, rel)) return this.fs.processPath(target)
    return dirname(this.fs.processPath(target))
  }

  /**
   * How many files a directory holds, for a delete confirmation.
   *
   * Read through the same provider and the same skips as the tree, so the number
   * the dialog shows is the number the author can see. A directory that cannot be
   * read counts as unknown (`null`) rather than as empty.
   * @param project - an opened root.
   * @param rel - a project-relative directory path.
   * @returns the recursive file count, or null when it could not be read.
   */
  async countFilesUnder(project: OpenRoot, rel: string): Promise<number | null> {
    try {
      let total = 0
      const walk = async (dir: FsTarget, depth: number): Promise<void> => {
        if (depth > MAX_TREE_DEPTH || total >= MAX_TREE_ENTRIES) return
        for (const entry of await this.fs.listDir(dir)) {
          if (entry.type === 'directory') {
            if (SKIP_DIRS.has(entry.name)) continue
            await walk(entry.target, depth + 1)
          } else if (entry.type === 'file') {
            total += 1
          }
        }
      }
      await walk(await this.resolveInside(project, rel), 0)
      return total
    } catch {
      return null
    }
  }
}
