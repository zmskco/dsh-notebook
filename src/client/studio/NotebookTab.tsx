/**
 * Two of the three columns: the directory column on the left and the notebook
 * on the right of it.
 *
 * The directory column is the workspace's file browser, headed by the controls
 * that act on it — new folder, new file, refresh, and "open in the file manager".
 * They live here because this is the column they act on.
 *
 * The notebook column reads or edits any text file and saves it.
 *
 * The sidebar browses the *workspace*, not one folder: notes, outlines and
 * READMEs live in whatever structure the author grows, so a chapter-only list
 * would hide most of what there is to write. The editor still loads exactly one
 * file at a time, which is what keeps the Host's short-lived listing useful
 * instead of being invalidated by every keystroke.
 *
 * Markdown opens as a *document* and everything else opens in the source editor:
 * reading is what an author does most, a rendered page answers "does this read
 * well?" in a way the source cannot, and a file like `data.json` has nothing to
 * render. The row's two buttons switch between the two, so the mode is one click
 * away from wherever the author is — and the draft is never discarded by
 * switching, only by closing the file.
 */
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, messageOf, WORKSPACE_PROJECT } from '../api'
import {
  ancestorsOf,
  buildTree,
  countFiles,
  formatBytes,
  isDirectoryPath,
  parentOf,
  PROJECT_ROOT,
} from '../state/file-tree'
import type { TreeNode } from '../state/file-tree'
import { editorControls, isMarkdownPath, nextEditorMode } from '../state/markdown'
import { setPanelCommands } from '../state/commands'
import { ENTRY_TARGET } from '../menu'
import type { EntryTarget } from '../menu'
import type { ContextMenuTarget, UseContextMenu } from '../dsh'
import {
  closeFile,
  findFile,
  nextActive,
  openFile,
  PAGE_ID,
  patchFile,
  rekeyFile,
  renameEntry,
  tabElementId,
} from '../state/tabs'
import type { OpenFile } from '../state/tabs'
import { TabStrip } from './TabStrip'
import { Wysiwyg } from './Wysiwyg'
import {
  FONT_IDS,
  FONT_STACKS,
  PAPER_IDS,
  SIZE_STEPS,
} from '../state/editor-prefs'
import type { EditorPrefs, FontId, PaperId } from '../state/editor-prefs'
import { ChatIcon, DeleteIcon, FilePlusIcon, FolderPlusIcon, RefreshIcon, RevealIcon } from '../glyphs'
import { TreeIcon } from '../icons/material'
import type { ProjectFileEntry } from '../../host/types'
import type { StringKey, T } from '../strings'
import { Button, ErrorNote, Grip, TextArea, TextInput } from '../ui'

export interface NotebookTabProps {
  t: T
  /**
   * The directory column's current width, and how to change it.
   *
   * The width itself is applied by CSS, not here: the page sets it as a variable
   * on the row so the conversation column — which this component cannot see —
   * shares the same source of truth. What this component needs the number for is
   * the drag handle it places between its two columns, since that handle works
   * out the new width from the current one.
   */
  side: number
  onSideResize: (next: number, total: number) => void
  /** Whether this shell gave the page a conversation seat at all. */
  canChat: boolean
  /** Whether the conversation column is currently shown. */
  chatVisible: boolean
  /** Show or hide the conversation column. */
  onToggleChat: () => void
  /** The paper, typeface and text size, owned by the page. */
  prefs: EditorPrefs
  /** Change one of them; the page remembers the result. */
  onPrefsChange: (patch: Partial<EditorPrefs>) => void
  /**
   * The shell's context-menu hook, when it provides one.
   *
   * Delivered as a prop rather than read from services so the tree can be rendered
   * — and checked — without the menu plugin: absent means no right-click menu, and
   * every row still works.
   */
  useContextMenu?: UseContextMenu
}

/** The dictionary key for each typeface, in the order the picker offers them. */
const FONT_LABELS: Record<FontId, StringKey> = {
  system: 'fontSystem',
  song: 'fontSong',
  kai: 'fontKai',
  puhuiti: 'fontPuhuiti',
}

/** The full family name behind each one-character font button. */
const FONT_TITLES: Record<FontId, StringKey> = {
  system: 'fontSystemName',
  song: 'fontSongName',
  kai: 'fontKaiName',
  puhuiti: 'fontPuhuitiName',
}

/** The dictionary key for each paper, in the order the picker offers them. */
const PAPER_LABELS: Record<PaperId, StringKey> = {
  plain: 'paperPlain',
  elegant: 'paperElegant',
  night: 'paperNight',
  green: 'paperGreen',
}

/** Count characters the way the Host does, so the two never disagree. */
function countChars(content: string): number {
  const body = content.startsWith('---') ? content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') : content
  return [...body].length
}

/**
 * How long a pause has to be before the open file is written.
 *
 * The author asked for autosave; this is the delay that makes it feel like
 * nothing at all happens while they write, and still keeps the copy on disk at
 * most a second behind.
 */
export const AUTOSAVE_MS = 900

// Re-exported for the artifact check, which addresses the page by the same two
// ids the strip uses.
export { PAGE_ID, tabElementId }

export function NotebookTab({ t, side, onSideResize, canChat, chatVisible, onToggleChat, prefs, onPrefsChange, useContextMenu }: NotebookTabProps): React.ReactElement {
  const [files, setFiles] = useState<ProjectFileEntry[]>([])
  /**
   * Directories the tree has open.
   *
   * The root is the tree itself rather than a row, so it is never in here: an
   * empty set means "everything collapsed to the top level", which is the state a
   * project opens in.
   */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>())
  /**
   * Where the next file or directory lands.
   *
   * Set by clicking a directory row, so the author aims the create controls by
   * opening the folder they want it in rather than by typing a path. The root is
   * the default, which is where a story's first files belong.
   */
  const [targetDir, setTargetDir] = useState<string>(PROJECT_ROOT)
  /**
   * The folder new files and folders actually land in.
   *
   * Kept separate from the stored aim so a folder that disappeared under the panel
   * falls back to the project root instead of recreating itself on the next write.
   */
  const target = isDirectoryPath(files, targetDir) ? targetDir : PROJECT_ROOT
  /**
   * The files open in the editor's tab strip, in the order they were opened.
   *
   * Every open file keeps its own buffer, dirty flag and mode, so switching tabs
   * swaps which record is drawn rather than re-reading from disk — an unsaved
   * sentence in one file survives a visit to another. The record itself and the
   * four operations on it live in `state/tabs.ts`, where they are pure and the
   * artifact check can drive them.
   */
  const [open, setOpen] = useState<OpenFile[]>([])
  /**
   * The tab that is drawn.
   *
   * A path, never an index: the tree marks the row whose path equals it, and a
   * save names the same path, so closing a tab to its left cannot silently move
   * the selection to another file.
   */
  const [active, setActive] = useState<string | undefined>(undefined)
  /** The open record behind the drawn tab, or undefined with every tab closed. */
  const current = active === undefined ? undefined : findFile(open, active)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  /** Which create form is open, if any: a file or a directory. */
  const [creating, setCreating] = useState<'file' | 'dir' | undefined>(undefined)
  const [newName, setNewName] = useState('')
  /**
   * The entry being renamed in place, and the name typed so far.
   *
   * One entry at a time, like the create row: the tree shows one text field, and a
   * second rename would have to answer what happens to the first one's half-typed
   * name. The field is the row itself (see `inlineRow`), not a dialog — renaming is
   * a correction to a label, and moving the eye to a modal for it is the wrong
   * gesture for a file tree.
   */
  const [renaming, setRenaming] = useState<{ path: string, name: string } | undefined>(undefined)
  /**
   * The deletion awaiting confirmation.
   *
   * Deleting is the one operation in this panel that typing cannot undo, so it asks
   * — and the question names what it is about to remove, including how many files a
   * folder holds, because "删除文件夹" and "删除这个装着 40 章的文件夹" are not the
   * same decision.
   */
  const [confirming, setConfirming] = useState<{ path: string, name: string, directory: boolean, files: number | null } | undefined>(undefined)
  /**
   * The unsaved text a save already refused, per path.
   *
   * Without it a refusal — a read-only deployment, a folder outside the workspace
   * — would be retried on every pause, forever. Keyed by path because one file's
   * refusal says nothing about another's.
   */
  const failedDrafts = useRef(new Map<string, string>())
  /** The live tab list, so a save in flight can tell whether its text is stale. */
  const openRef = useRef(open)
  openRef.current = open
  // Guards against a slow read for one tab landing after that tab was closed.
  const loadTokens = useRef(new Map<string, number>())
  /**
   * The write in flight per path.
   *
   * Two things read it: a tab being closed waits for its own save before it
   * disappears, and a tab being re-opened waits for any pending write before it
   * reads — without that, a close-then-reopen could read the file *before* the
   * close's write landed and hand the new tab the pre-edit bytes.
   */
  const pendingSaves = useRef(new Map<string, Promise<boolean>>())

  const loadFiles = useCallback(async () => {
    try {
      setFiles((await api.files(WORKSPACE_PROJECT)).files)
      setError(undefined)
    } catch (cause: unknown) {
      setError(messageOf(cause))
    }
  }, [])

  // Read the workspace once, and again after every mutation. The first read also
  // asks for the workspace's README: the panel's only write that is not the
  // author's edit, and it happens before the listing so the row is there when the
  // tree first draws.
  useEffect(() => {
    void (async () => {
      try {
        await api.ensureReadme()
      } catch {
        // A workspace that refused the README is still a workspace: the tree below
        // lists whatever is there, and the refusal is not worth a banner.
      }
      await loadFiles()
    })()
  }, [loadFiles])

  /**
   * Open or close one directory.
   *
   * Opening a folder aims the create controls at it — the folder just opened is the
   * folder the author is working in. **Closing** the folder that is being aimed at
   * moves the aim out to its parent: a target you cannot see is a target you forget,
   * and leaving it inside a collapsed folder is how "new file" lands somewhere the
   * author did not mean.
   */
  const toggleDir = useCallback((path: string): void => {
    const open = expanded.has(path)
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    setTargetDir(open ? parentOf(path) : path)
  }, [expanded])

  /** Open every directory a path needs in order to be visible. */
  const reveal = useCallback((path: string, directory = false): void => {
    setExpanded(current => {
      const next = new Set(current)
      for (const segment of ancestorsOf(path, directory)) next.add(segment)
      return next
    })
  }, [])

  /**
   * Start (or cancel) an inline create.
   *
   * A new folder or file is not a form above the tree: it is an empty row inside
   * the folder it will be created in, with the caret already in it — the same
   * gesture as renaming, and no second place to look for what is happening.
   */
  const startCreating = useCallback((kind: 'file' | 'dir'): void => {
    if (creating === kind) {
      setCreating(undefined)
      setNewName('')
      return
    }
    setCreating(kind)
    setNewName('')
    // The row has to be visible: open the folder it is being created in.
    if (target !== PROJECT_ROOT) reveal(target, true)
  }, [creating, reveal, target])

  /** Drop the empty row without creating anything. */
  const cancelCreating = useCallback((): void => {
    setCreating(undefined)
    setNewName('')
  }, [])

  /** Whether a re-read of the tree is in flight; the icon turns while it is. */
  const [refreshing, setRefreshing] = useState(false)

  /**
   * Read the workspace again.
   *
   * The tree is the outside world's view of the workspace: the model and another
   * editor may both write into it while the panel is open, and a tree that only
   * ever refreshed after its own edits would quietly show a stale folder.
   */
  const refreshTree = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      await loadFiles()
    } finally {
      setRefreshing(false)
    }
  }, [loadFiles])

  /**
   * Hand a workspace directory to the operating system's file manager.
   *
   * A browser cannot open a local folder, so this is the one action that has to ask
   * the Host. The path is a *workspace-relative* one and the Host does the deciding:
   * it resolves it, proves it is inside the tree, and opens that folder — or the
   * folder holding that file. Revealing a file therefore lands you beside it, which
   * is the gesture every file manager has, without this page learning a single
   * absolute path. A refusal is reported, not swallowed.
   * @param path - a project-relative path; `''` is the workspace itself.
   */
  const revealInManager = useCallback(async (path: string): Promise<void> => {
    setError(undefined)
    try {
      const result = await api.reveal(path)
      if (!result.opened) setError(t('revealFailed'))
    } catch (cause: unknown) {
      setError(messageOf(cause))
    }
  }, [t])

  /** The heading's own control: the workspace itself, as before. */
  const revealFolder = useCallback((): Promise<void> => revealInManager(''), [revealInManager])

  /**
   * Read one file into the tab that is already showing it.
   *
   * The tab exists before the read starts — so the strip answers the click at once
   * — and is filled when the answer arrives. A tab closed while its read was in
   * flight is not resurrected, and a second read of the same path supersedes the
   * first; both are what the per-path token below is for.
   *
   * **A read never overwrites a buffer the author has typed into.** The read takes
   * a network round trip, and the tab is editable the whole time: someone who
   * starts writing in the first 50ms of a slow read would otherwise watch their
   * first sentence be replaced by the file's old text, with nothing to undo it
   * (`autosave` is deliberately idle while a tab is loading). So the fill is
   * refused for a dirty tab — its own text stays, and the tab simply stops
   * reporting that it is loading.
   */
  const loadInto = useCallback(async (path: string) => {
    const token = (loadTokens.current.get(path) ?? 0) + 1
    loadTokens.current.set(path, token)
    setError(undefined)
    try {
      // A write already in flight for this path is part of what "the file" means:
      // reading first would hand the tab the pre-write bytes.
      await pendingSaves.current.get(path)
      const document = await api.file(WORKSPACE_PROJECT, path)
      if (loadTokens.current.get(path) !== token) return
      setOpen((files) => {
        const file = findFile(files, path)
        if (file === undefined) return files
        if (file.dirty) return patchFile(files, path, { loading: false })
        return patchFile(files, path, {
          draft: document.content,
          dirty: false,
          loading: false,
          // A fresh read is a fresh parse: a new document token re-creates the
          // rendered editor, so no caret or scroll offset survives from a previous
          // buffer of the same path.
          docToken: file.docToken + 1,
        })
      })
    } catch (cause: unknown) {
      if (loadTokens.current.get(path) !== token) return
      setError(messageOf(cause))
      setOpen((files) => {
        const file = findFile(files, path)
        // A tab the author has already written in is kept: the read failing says
        // the file is unreadable, not that the sentence is worthless.
        if (file !== undefined && file.dirty) return patchFile(files, path, { loading: false })
        return files
      })
    }
  }, [])

  /**
   * Write one tab's buffer.
   *
   * The path is passed rather than read from the selection: a save outlives the
   * click that started it, and the tab it belongs to may already have been switched
   * away from or closed. The text is captured first — if the author keeps typing
   * while the write is in flight, the file on disk is that snapshot and the tab
   * stays dirty.
   * @returns true when the write landed, false when it was refused or failed.
   */
  const save = useCallback(async (path: string | undefined): Promise<boolean> => {
    if (path === undefined) return false
    const file = findFile(openRef.current, path)
    // Nothing to write: a file that was only read must not be normalised on disk
    // because the author happened to press Ctrl/Cmd+S.
    if (file === undefined || !file.dirty) return true
    const saved = file.draft
    setBusy(true)
    setError(undefined)
    const write = (async (): Promise<boolean> => {
      try {
        await api.saveFile(WORKSPACE_PROJECT, path, saved)
        failedDrafts.current.delete(path)
        setOpen((files) => {
          const now = findFile(files, path)
          if (now === undefined) return files
          // Still dirty only when more was typed while this snapshot was in
          // flight: the text on disk is exactly `saved`.
          return patchFile(files, path, { dirty: now.draft !== saved })
        })
        // The size in the tree is the only thing a save changes, so it is patched
        // here. Re-listing the workspace on every autosave walked the whole tree
        // once per keystroke batch — the largest avoidable cost in this page.
        const bytes = new TextEncoder().encode(saved).length
        setFiles(list => list.map(entry => (entry.path === path ? { ...entry, bytes } : entry)))
        return true
      } catch (cause: unknown) {
        // Remembered so autosave does not retry the same refusal on every pause.
        failedDrafts.current.set(path, saved)
        setError(messageOf(cause))
        return false
      } finally {
        pendingSaves.current.delete(path)
        setBusy(false)
      }
    })()
    pendingSaves.current.set(path, write)
    return write
  }, [])

  /**
   * Close one tab, writing it first when it has unsaved changes.
   *
   * Autosave means the author never opted into deciding what happens to a
   * keystroke they typed a moment ago, so closing is not the place to ask them.
   * **A refused write keeps the tab open**: closing it would leave that sentence
   * nowhere but the error banner, and a read-only deployment or a momentary
   * network failure is exactly when that would happen. Which tab is drawn
   * afterwards is decided by the strip's own rule ({@link nextActive}), worked out
   * from the list as it is now — after the close it no longer knows where the
   * closed tab was.
   */
  const closeTab = useCallback(async (path: string): Promise<void> => {
    const files = openRef.current
    const file = findFile(files, path)
    if (file === undefined) return
    if (file.dirty && !(await save(path))) return
    // Functional, because the strip may have changed while the write was in flight
    // and `files` is then a frame old.
    setOpen(current => closeFile(current, path))
    setActive(previous => nextActive(files, path, previous))
  }, [save])

  /**
   * Change one tab's buffer.
   *
   * Every keystroke goes through here. The tab keeps its own text, and nothing
   * about the file on disk is decided until the autosave pause elapses.
   */
  const edit = useCallback((path: string, value: string): void => {
    setOpen(files => patchFile(files, path, { draft: value, dirty: true }))
  }, [])

  // Autosave: a pause this long after the last keystroke writes the file. The
  // effect's own cleanup *is* the debounce — a fast typist writes once, not once
  // per key — and a refusal is not retried until the text changes, because the
  // same refusal would land on every pause otherwise. Every open tab is watched,
  // not just the drawn one: a tab left dirty by anything (a failed switch-save, a
  // create that seeded a new tab) still needs its pause, and the whole point of
  // several tabs is that the author does not have to remember which one is unsaved.
  useEffect(() => {
    if (busy) return
    const timers = open.flatMap((file) => {
      if (!file.dirty || file.loading) return []
      if (failedDrafts.current.get(file.path) === file.draft) return []
      const { path } = file
      return [setTimeout(() => { void save(path) }, AUTOSAVE_MS)]
    })
    return () => { for (const timer of timers) clearTimeout(timer) }
  }, [busy, open, save])

  /**
   * Open a file, or bring its tab forward.
   *
   * A file that is already open is **activated**, never re-read: its buffer may
   * hold sentences that exist nowhere else yet. A new one gets a tab immediately
   * and the read fills it in, so the strip answers the click before the disk does.
   *
   * Whichever it is, the tab being left is written first when it has unsaved
   * changes. Autosave means the author never opted into deciding what happens to a
   * keystroke they typed a moment ago, so switching files is not the place to ask
   * them.
   *
   * Opening a file also moves the create target to the folder it lives in. The
   * highlighted folder is therefore always the one the open file belongs to —
   * before this, clicking a file elsewhere left the last folder they had opened
   * still marked, which read as "that folder is selected".
   */
  const choose = useCallback((path: string): void => {
    // Aim first, and even for the file that is already open: the target is a
    // property of where the author is working, and re-selecting the open file is
    // exactly how they come back to it after aiming somewhere else.
    setTargetDir(parentOf(path))
    const leaving = active === undefined ? undefined : findFile(openRef.current, active)
    if (leaving !== undefined && leaving.dirty && leaving.path !== path) void save(leaving.path)
    if (findFile(openRef.current, path) === undefined) {
      setOpen(files => openFile(files, path))
      // `loadInto` reads the file, and a close may have a write for the same path
      // in flight; that is why the read waits for it (see `pendingSaves`).
      void loadInto(path)
    }
    setActive(path)
  }, [active, loadInto, save])

  // Whatever is drawn must be visible: a highlighted row inside a collapsed folder
  // is a selection the author cannot see, which reads as "nothing is open". The
  // strip scrolls its own drawn tab into view (`TabStrip`).
  useEffect(() => {
    if (active !== undefined) reveal(active)
  }, [active, reveal])

  /**
   * Create whatever the open form asks for, in the directory the column is aimed
   * at.
   *
   * A file is a chapter (markdown, seeded with its heading) and opens straight
   * into the editor, because a file you just made exists to be written. A
   * directory is just a directory: it is revealed and becomes the new target, so
   * the next file lands inside it without a second click.
   */
  const create = useCallback(async () => {
    if (creating === undefined) return
    const name = newName.trim().length > 0 ? newName.trim() : t('untitled')
    setBusy(true)
    setError(undefined)
    try {
      if (creating === 'dir') {
        const made = await api.createDir(WORKSPACE_PROJECT, target, name)
        // Shown from the answer, not from a re-listing: the tree is rooted at the
        // workspace, and walking it again just to draw one new row is what made
        // "new folder" take seconds. The listing follows in the background.
        setFiles(current => [...current, { path: made.path, name, bytes: 0, kind: 'directory' }])
        setTargetDir(made.path)
        reveal(made.path, true)
        void loadFiles()
      } else {
        const chapter = await api.createFile(WORKSPACE_PROJECT, name, target)
        setFiles(current => [...current, {
          path: chapter.path,
          name: chapter.path.split('/').pop() ?? name,
          bytes: new TextEncoder().encode(chapter.content).length,
          kind: 'text',
        }])
        // Reveal the new chapter where it was written, which is the only way the
        // tree can show it without the user hunting for the directory. Its text is
        // already known, so the tab is seeded rather than read back: there is
        // nothing to wait for.
        reveal(chapter.path)
        setOpen(files => openFile(files, chapter.path, { draft: chapter.content, mode: 'wysiwyg' }))
        // Through `choose`, not `setActive`: the tab being left is then flushed the
        // way every other switch flushes it. Setting the active path directly would
        // leave its keystrokes unsaved with no timer watching it.
        choose(chapter.path)
        void loadFiles()
      }
      setNewName('')
      setCreating(undefined)
    } catch (cause: unknown) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [choose, creating, loadFiles, newName, reveal, t, target])

  /**
   * `Ctrl/Cmd+S` on the whole editor column.
   *
   * Bound to the column rather than to the page below the head, because the key can
   * be pressed while focus is anywhere in it — the caret in the page, the size
   * picker in the head, a tab in the strip.
   *
   * It writes **every** dirty tab, not just the drawn one: a tab can be left dirty
   * by a refused save, and a force-save that quietly skipped it would be the one
   * gesture the author uses to be sure. Each path's remembered refusal is cleared
   * first, because this is an explicit ask rather than the autosave pause.
   */
  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
    event.preventDefault()
    const dirty = openRef.current.filter(file => file.dirty && !file.loading)
    for (const file of dirty) failedDrafts.current.delete(file.path)
    for (const file of dirty) void save(file.path)
  }, [save])

  const tree = useMemo(() => buildTree(files), [files])

  /**
   * What one row hands the context menu.
   *
   * The tree row's own path and name, not the path of the file that happens to be
   * open: the menu acts on what was right-clicked, and the shell captures this
   * object at the moment of the gesture so a later selection cannot redirect it.
   * The value is wrapped in `{ kind, value }` here rather than deeper in, because the
   * target family is this plugin's own and the row is the only place that knows it.
   * @param node - the row's tree node.
   * @returns the captured menu target.
   */
  const entryTarget = (node: TreeNode): ContextMenuTarget => ({
    kind: ENTRY_TARGET,
    value: { path: node.path, name: node.name, directory: node.directory } satisfies EntryTarget,
  })

  /**
   * The row's menu trigger bindings, when the shell provides the menu.
   *
   * `useContextMenu()` is injected into every Slot scope by `ui-context-menu`; a
   * shell without that plugin hands this component no `useContextMenu` prop at all,
   * and the tree then simply has no right-click menu — it still works.
   */
  const menu = useContextMenu === undefined ? undefined : useContextMenu()
  const rootMenu = menu?.getTriggerProps({ kind: ENTRY_TARGET, value: { path: '', name: t('library'), directory: true } })

  /**
   * Begin renaming one entry.
   *
   * The field starts with the name selected down to the extension, which is how
   * every file manager does it: the author usually keeps `.md` and replaces the
   * title. A name with no extension selects all of it.
   */
  const startRenaming = useCallback((path: string): void => {
    setCreating(undefined)
    setNewName('')
    const name = path.split('/').pop() ?? path
    setRenaming({ path, name })
  }, [])

  /**
   * Commit the inline rename.
   *
   * The new name is one segment: the Host refuses a separator, so a rename cannot
   * turn into a move. A name that did not change closes the field without a
   * request — confirming an unchanged field is not an edit.
   */
  const commitRename = useCallback(async (): Promise<void> => {
    if (renaming === undefined) return
    const name = renaming.name.trim()
    if (name.length === 0) {
      setRenaming(undefined)
      return
    }
    const parent = parentOf(renaming.path)
    const next = parent === '' ? name : `${parent}/${name}`
    if (next === renaming.path) {
      setRenaming(undefined)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const renamed = await api.rename(WORKSPACE_PROJECT, renaming.path, name)
      setFiles(list => list.map(entry => renameEntry(entry, renaming.path, renamed.path, name)))
      // The open tab follows the file: its path is the write target and the tab's
      // identity, so a tab left on the old path would save over a file that no
      // longer exists and the new one would look closed.
      setOpen(list => list.map(file => rekeyFile(file, renaming.path, renamed.path)))
      setActive(previous => previous === renaming.path ? renamed.path : previous)
      if (targetDir === renaming.path) setTargetDir(renamed.path)
      setRenaming(undefined)
      void loadFiles()
    } catch (cause: unknown) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [loadFiles, renaming, targetDir])

  /**
   * Ask before deleting one entry.
   *
   * A folder's count is read first: the confirmation is only worth interrupting for
   * if it says what goes with it. A count that cannot be read still asks — the
   * question is about the folder either way, and refusing to delete because the
   * count failed would be a worse answer than an unspecific one.
   */
  const askDelete = useCallback(async (path: string): Promise<void> => {
    const entry = files.find(item => item.path === path)
    if (entry === undefined) return
    const directory = entry.kind === 'directory'
    let count: number | null = null
    if (directory) {
      try {
        count = (await api.count(WORKSPACE_PROJECT, path)).files
      } catch {
        count = null
      }
    }
    setConfirming({ path, name: entry.name, directory, files: count })
  }, [files])

  /**
   * Delete the entry the confirmation was about.
   *
   * Every tab under the path closes, and the active one moves to whatever was beside
   * it — a tab pointing into a folder that no longer exists is a write into nothing.
   */
  const confirmDelete = useCallback(async (): Promise<void> => {
    if (confirming === undefined) return
    const { path } = confirming
    setBusy(true)
    setError(undefined)
    try {
      await api.remove(WORKSPACE_PROJECT, path)
      const gone = (at: string): boolean => at === path || at.startsWith(`${path}/`)
      // Every tab under the path closes — a tab pointing into a folder that no
      // longer exists is a write into nothing — and the drawn one moves to its
      // neighbour, the same rule closing a tab by hand uses.
      const before = openRef.current
      const removed = before.filter(file => gone(file.path))
      const remaining = before.filter(file => !gone(file.path))
      setOpen(remaining)
      setActive((previous) => {
        if (previous === undefined || !gone(previous)) return previous
        const after = nextActive(removed, path, previous)
        return remaining.some(file => file.path === after) ? after : remaining[0]?.path
      })
      setFiles(list => list.filter(entry => !gone(entry.path)))
      if (gone(targetDir)) setTargetDir(PROJECT_ROOT)
      if (renaming !== undefined && gone(renaming.path)) setRenaming(undefined)
      setConfirming(undefined)
      void loadFiles()
    } catch (cause: unknown) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [confirming, loadFiles, renaming, targetDir])

  /**
   * Publish this panel's operations for the context menu.
   *
   * The menu's contributions live as long as the plugin, while the tree lives as long
   * as this render — so the menu reaches the panel through `state/commands` instead
   * of closing over state it cannot see. Republished whenever a handler changes
   * identity, which is every time the state a handler reads changes.
   */
  useEffect(() => setPanelCommands({
    create: (dir, kind) => {
      setTargetDir(dir)
      reveal(dir, true)
      setCreating(kind)
      setNewName('')
    },
    rename: (path) => {
      // A folder's row has to be visible before its name can be a field in it.
      reveal(path)
      startRenaming(path)
    },
    remove: (path) => { void askDelete(path) },
    refresh: () => { void refreshTree() },
    reveal: (path) => { void revealInManager(path) },
  }), [askDelete, refreshTree, reveal, revealInManager, startRenaming])

  /**
   * The empty row a new folder or file is named in.
   *
   * It sits where the thing will appear, with the folder's own icon, so there is no
   * second place (a form above the tree) to look at. `Enter` creates, `Enter` on an
   * empty name cancels, `Escape` cancels — and while an input method is composing,
   * Enter belongs to the input method, not to the row.
   */
  const ghostRow = (depth: number, kind: 'file' | 'dir'): React.ReactElement => {
    const label = kind === 'dir' ? t('dirName') : t('fileName')
    return React.createElement('li', { key: `ghost:${kind}` },
      React.createElement('div', { className: 'dsh-notebook-item dsh-notebook-ghost', style: { paddingLeft: 8 + depth * 14 } },
        // The row carries the drawing the finished row will have, worked out from
        // the name being typed — so `笔记.md` becomes a markdown mark as it is
        // entered. An empty name is not a file name: `TreeIcon` draws the generic
        // file or folder for it rather than looking the empty string up.
        React.createElement(TreeIcon, { name: newName.trim(), directory: kind === 'dir' }),
        React.createElement('input', {
          className: 'dsh-notebook-ghostInput',
          value: newName,
          autoFocus: true,
          spellCheck: false,
          placeholder: label,
          'aria-label': label,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => { setNewName(event.target.value) },
          onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelCreating()
              return
            }
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            if (newName.trim().length === 0) cancelCreating()
            else void create()
          },
        }),
      ))
  }

  /**
   * The tree's rows, flattened in display order.
   *
   * Built by walking the tree rather than by a recursive component: the collapse
   * rule — a closed directory contributes its own row and none of its children —
   * is then one branch in one function, and the rows stay siblings, which is what
   * keeps the indentation honest.
   */
  const rows: React.ReactNode[] = []
  const pushRows = (nodes: TreeNode[], depth: number): void => {
    for (const node of nodes) {
      // 8px of padding plus 14px per level: the indent *is* the tree.
      const indent = 8 + depth * 14
      // The row a rename is being typed into: the name becomes a field in place, so
      // the gesture keeps the row it is about under the eye instead of opening a
      // dialog somewhere else on the page.
      if (renaming !== undefined && renaming.path === node.path) {
        rows.push(React.createElement('li', { key: `rename:${node.path}` },
          React.createElement('div', {
            className: 'dsh-notebook-item dsh-notebook-ghost',
            style: { paddingLeft: indent },
          },
          React.createElement(TreeIcon, { name: renaming.name, directory: node.directory, open: true }),
          React.createElement('input', {
            className: 'dsh-notebook-ghostInput',
            value: renaming.name,
            autoFocus: true,
            spellCheck: false,
            'aria-label': t('renameHint'),
            title: t('renameHint'),
            // Select the stem and leave the extension: renaming a chapter usually
            // means replacing its title, not its `.md`.
            onFocus: (event: React.FocusEvent<HTMLInputElement>) => {
              const dot = renaming.name.lastIndexOf('.')
              event.target.setSelectionRange(0, dot > 0 ? dot : renaming.name.length)
            },
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              const name = event.target.value
              setRenaming(current => current === undefined ? undefined : { ...current, name })
            },
            onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setRenaming(undefined)
                return
              }
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              void commitRename()
            },
            onBlur: () => { void commitRename() },
          }))))
        if (node.directory && expanded.has(node.path)) pushRows(node.children, depth + 1)
        continue
      }
      if (node.directory) {
        const open = expanded.has(node.path)
        rows.push(React.createElement('li', { key: `dir:${node.path}` },
          React.createElement('button', {
            type: 'button',
            className: 'dsh-notebook-item',
            // A folder is the *target* new files land in, not the thing that is
            // open: marking it as active made it read as "selected" even while a
            // file in another folder was open.
            'data-target': target === node.path,
            // The folder's artwork opens and closes with it, so the state has to
            // reach assistive technology some other way than the drawing.
            'aria-expanded': open,
            title: node.path,
            style: { paddingLeft: indent },
            ...menu?.getTriggerProps(entryTarget(node)),
            onClick: () => { toggleDir(node.path) },
          },
          // The folder *is* the disclosure control: an open folder means the
          // children below it are shown. No leading triangle — a caret beside a
          // folder icon is two marks for one control. The drawing itself opens
          // with the folder, so `aria-expanded` carries the state to assistive
          // technology instead.
          React.createElement(TreeIcon, { name: node.name, directory: true, open }),
          React.createElement('span', { className: 'dsh-notebook-itemName' }, node.name),
          React.createElement('span', { className: 'dsh-notebook-count' }, String(countFiles(node))))))
        if (open) pushRows(node.children, depth + 1)
        // The empty row belongs inside the folder it is being created in.
        if (creating !== undefined && node.path === target) rows.push(ghostRow(depth + 1, creating))
        continue
      }
      rows.push(React.createElement('li', { key: `file:${node.path}` },
        React.createElement('button', {
          type: 'button',
          className: 'dsh-notebook-item',
          // The row of the file the editor is drawing. An open-but-not-drawn tab is
          // a different state, and is marked as one: a tree with two highlighted
          // rows would read as "two files are open in the same place".
          'data-active': node.path === active,
          'data-open': findFile(open, node.path) === undefined ? 'false' : 'true',
          title: node.path,
          style: { paddingLeft: indent },
          ...menu?.getTriggerProps(entryTarget(node)),
          onClick: () => { choose(node.path) },
        },
        React.createElement(TreeIcon, { name: node.name }),
        React.createElement('span', { className: 'dsh-notebook-itemName' }, node.name),
        React.createElement('span', { className: 'dsh-notebook-count' }, formatBytes(node.bytes)))))
    }
  }
  pushRows(tree, 0)
  // The project root has no row of its own, so its empty row ends the list.
  if (creating !== undefined && target === PROJECT_ROOT) rows.push(ghostRow(0, creating))

  /**
   * The column's heading: the name on the left, the actions on the right.
   *
   * The creates are icons rather than a row of buttons under the heading: the tree
   * below is what they act on, so an icon pair at the top edge costs one line
   * instead of one row. Both sit at the far right, immediately before the
   * conversation switch — the heading's right-hand end is where the things that
   * change what is on screen belong, and the switch is the last of them.
   */
  const header = React.createElement('div', { className: 'dsh-notebook-section' },
    React.createElement('div', { className: 'dsh-notebook-row' },
      // Right-clicking the heading means "the workspace itself": the menu opened
      // here offers the two creates and the reveals, but not rename or delete — the
      // root is not an entry in its own tree and there is nothing to point at.
      React.createElement('div', {
        className: 'dsh-notebook-sectionTitle',
        style: { margin: 0, cursor: 'default' },
        title: t('library'),
        ...rootMenu,
      }, t('library')),
      React.createElement('div', { className: 'dsh-notebook-spacer' }),
      React.createElement(Button, {
        variant: 'icon',
        title: t('newDir'),
        attrs: {
          'data-action': 'new-dir',
          'aria-label': t('newDir'),
          'data-selected': creating === 'dir' ? 'true' : 'false',
        },
        onClick: () => { startCreating('dir') },
      }, React.createElement(FolderPlusIcon, {})),
      React.createElement(Button, {
        variant: 'icon',
        title: t('newFile'),
        attrs: {
          'data-action': 'new-file',
          'aria-label': t('newFile'),
          'data-selected': creating === 'file' ? 'true' : 'false',
        },
        onClick: () => { startCreating('file') },
      }, React.createElement(FilePlusIcon, {})),
      React.createElement(Button, {
        variant: 'icon',
        title: t('refresh'),
        attrs: {
          'data-action': 'refresh',
          'aria-label': t('refresh'),
          // The icon turns while the re-read is in flight; the click is answered
          // at once even when the walk takes a moment.
          'data-busy': refreshing ? 'true' : 'false',
        },
        onClick: () => { void refreshTree() },
      }, React.createElement(RefreshIcon, {})),
      React.createElement(Button, {
        variant: 'icon',
        title: t('reveal'),
        attrs: {
          'data-action': 'reveal',
          'aria-label': t('reveal'),
        },
        onClick: () => { void revealFolder() },
      }, React.createElement(RevealIcon, {})),
      canChat
        ? React.createElement(Button, {
          variant: 'icon',
          title: chatVisible ? t('hideChat') : t('showChat'),
          attrs: {
            'data-action': 'toggle-chat',
            'aria-pressed': chatVisible ? 'true' : 'false',
            'aria-label': chatVisible ? t('hideChat') : t('showChat'),
          },
          onClick: onToggleChat,
        }, React.createElement(ChatIcon, {}))
        : null,
    ),
  )

  // One column, stacked: the heading, then the tree of the workspace. The widths
  // travel on the row, so nothing here moves when a column is dragged.
  const directory = React.createElement('div', { className: 'dsh-notebook-pane dsh-notebook-side' },
    header,
    // No "this directory is empty" line: an empty workspace renders as an empty
    // list, and the two icons above are the answer.
    React.createElement('ul', { className: 'dsh-notebook-list dsh-notebook-scroll' }, rows),
  )

  // The editor column is always here — it is what the page lays out beside the
  // directory and the conversation — but it only holds a file once one is opened.
  // With nothing selected it is an empty column rather than a sentence telling the
  // author to pick something.
  //
  // Only markdown gets the toggle: other files have nothing to render, so they
  // open in the editor and stay there rather than offering a mode that would show
  // the same characters in a different font. The preview also drops the save
  // button — see `editorControls` — while `Ctrl/Cmd+S` keeps working in both.
  // Everything below describes the *drawn* tab. With no tab open each of these is
  // the empty/absent value, which is what lets the same markup render the empty
  // column without a second code path.
  const previewable = current !== undefined && isMarkdownPath(current.path)
  const rendered = previewable && current.mode === 'wysiwyg'
  const controls = editorControls(previewable)

  /**
   * Switch the drawn tab between the rendered page and the markdown behind it.
   *
   * The counter bump is what makes the switch safe: the rendered editor is
   * re-created from the current draft, so leaving and returning to it cannot show
   * a stale parse of what the source view just changed. The mode belongs to the
   * tab, so another file keeps the surface it was left in.
   */
  const switchMode = useCallback((): void => {
    if (current === undefined) return
    const { path } = current
    setOpen(files => patchFile(files, path, {
      mode: nextEditorMode(current.mode),
      // The other surface draws from the same draft, and neither keeps a caret or a
      // scroll offset across the change.
      docToken: current.docToken + 1,
    }))
  }, [current])

  /**
   * The typography row.
   *
   * Three groups — typeface, size, paper — then the mode pair, each drawn as a
   * segmented control: one soft tray per group, the chosen option a raised chip
   * inside it. A tray is what makes "which of these four is in force" visible
   * without giving every option a hard border; four bordered boxes side by side read
   * as four buttons that all claim to be pressed.
   *
   * Groups are separated by rules rather than by the words 字体 / 字号 / 背景: the
   * buttons say what they are (a one-character face name, a number, a paper name),
   * and a label above each group only cost width.
   */
  const divider = (key: string): React.ReactElement =>
    React.createElement('span', { key, className: 'dsh-notebook-divider', role: 'presentation' })

  /**
   * One row of mutually exclusive choices.
   * @param key - the React key for the tray.
   * @param children - the chips.
   * @returns the tray.
   */
  const seg = (key: string, children: React.ReactNode[]): React.ReactElement =>
    React.createElement('div', { key, className: 'dsh-notebook-seg' }, ...children)

  const typebar = React.createElement('div', { className: 'dsh-notebook-typebar' },
    // One-character buttons rather than a select: family names in a narrow column
    // wrap, and the full name is on each button's title.
    seg('fonts', FONT_IDS.map(id => React.createElement(Button, {
      key: id,
      variant: 'ghost',
      title: t(FONT_TITLES[id]),
      attrs: {
        'data-font-choice': id,
        'data-selected': prefs.font === id ? 'true' : 'false',
        'aria-pressed': prefs.font === id ? 'true' : 'false',
        'aria-label': t(FONT_TITLES[id]),
      },
      onClick: () => { onPrefsChange({ font: id }) },
    }, t(FONT_LABELS[id])))),
    divider('d-size'),
    // A native select is kept for the size — ten numbers are a list, not a choice of
    // five — but it is styled as a tray so it lines up with the trays beside it.
    React.createElement('select', {
      className: 'dsh-notebook-select',
      'data-role': 'font-size',
      value: String(prefs.size),
      title: t('fontSize'),
      'aria-label': t('fontSize'),
      onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
        onPrefsChange({ size: Number(event.target.value) })
      },
    }, SIZE_STEPS.map(size => React.createElement('option', { key: String(size), value: String(size) }, String(size)))),
    divider('d-paper'),
    seg('papers', PAPER_IDS.map(id => React.createElement(Button, {
      key: id,
      variant: 'ghost',
      title: t(PAPER_LABELS[id]),
      attrs: {
        'data-paper-choice': id,
        'data-selected': prefs.paper === id ? 'true' : 'false',
        'aria-pressed': prefs.paper === id ? 'true' : 'false',
        'aria-label': t(PAPER_LABELS[id]),
      },
      onClick: () => { onPrefsChange({ paper: id }) },
    }, t(PAPER_LABELS[id])))),
    // Both modes are buttons of their own — 写作 and 源码 — rather than one toggle
    // whose label names the *other* mode: a control that says 源码 while you are
    // already looking at source is a riddle, and the two modes are the two things
    // this page can be. They only exist for markdown, so the whole tray is absent
    // for a data file rather than half-drawn.
    controls.toggle
      ? React.createElement(React.Fragment, null,
        divider('d-actions'),
        seg('mode', [
          React.createElement(Button, {
            key: 'mode-write',
            variant: 'ghost',
            title: t('writing'),
            attrs: {
              'data-action': 'editor-mode',
              'data-mode': 'wysiwyg',
              'data-selected': rendered ? 'true' : 'false',
              'aria-pressed': rendered ? 'true' : 'false',
            },
            onClick: () => { if (!rendered) switchMode() },
          }, t('writing')),
          React.createElement(Button, {
            key: 'mode-source',
            variant: 'ghost',
            title: t('source'),
            attrs: {
              'data-action': 'editor-mode',
              'data-mode': 'source',
              'data-selected': rendered ? 'false' : 'true',
              'aria-pressed': rendered ? 'false' : 'true',
            },
            onClick: () => { if (rendered) switchMode() },
          }, t('source')),
        ]))
      : null,
    // The count and the saved/unsaved state do **not** live here: this row wraps as
    // the column narrows, and a number that gains a digit mid-sentence must not
    // re-flow the band. They ride at the right end of the tab strip instead, which
    // never wraps (`TabStrip`'s `meta`).
  )

  /**
   * The drawn file's count and save state.
   *
   * Two facts about *this* file, not controls: hence text at the end of the strip
   * rather than buttons beside the pickers.
   */
  const fileMeta = [
    React.createElement('span', { key: 'chars', className: 'dsh-notebook-count' },
      `${String(countChars(current?.draft ?? ''))} ${t('chars')}`),
    React.createElement('span', {
      key: 'state',
      className: 'dsh-notebook-count',
      'data-role': 'save-state',
      style: current !== undefined && current.dirty ? { color: 'var(--dsw-alias-state-warn-primary)' } : undefined,
    }, current !== undefined && current.dirty ? t('unsaved') : t('saved')),
  ]

  // The page: paper colour, typeface and size travel as CSS variables, so the
  // rendered document and the source textarea share one setting.
  const docStyle: React.CSSProperties & Record<string, string> = {
    '--dsh-notebook-font': FONT_STACKS[prefs.font],
    '--dsh-notebook-size': `${String(prefs.size)}px`,
  }

  /**
   * The editor column.
   *
   * The head — the typography row and the tab strip — is **pinned**: it is a fixed
   * band at the top of the column and never scrolls, because a control you have to
   * scroll back to is a control you stop using. Only the page below it moves. That
   * is also what makes several files work: the strip stays where the eye left it
   * while a long chapter scrolls underneath.
   *
   * With no tab open the band still draws — the face, size and paper buttons and
   * the mode pair set how the *next* file will look, and hiding them would make the
   * empty column a dead end — and the body shows what to do instead.
   */
  const editor = React.createElement('div', { className: 'dsh-notebook-pane dsh-notebook-main', onKeyDown },
    error === undefined ? null : React.createElement('div', { className: 'dsh-notebook-mainError' }, React.createElement(ErrorNote, null, error)),
    React.createElement('div', { className: 'dsh-notebook-editorHead' },
      // `Ctrl/Cmd+S` is caught on the whole column (`onKeyDown` above), not on this
      // row: the caret lives in the page underneath the pinned head, so a handler
      // bound to the head alone would never see the key.
      React.createElement('div', { className: 'dsh-notebook-toolbar' }, typebar),
      React.createElement(TabStrip, {
        files: open,
        active,
        t,
        onChoose: choose,
        onClose: (path: string) => { void closeTab(path) },
        meta: fileMeta,
      }),
    ),
    current === undefined
      ? React.createElement('div', { className: 'dsh-notebook-empty' }, t('openHint'))
      : React.createElement('div', {
        className: 'dsh-notebook-editor',
        style: docStyle,
        // The region the tabs control, for assistive technology: `role=tab` means
        // nothing without a panel it owns and is labelled by.
        id: PAGE_ID,
        role: 'tabpanel',
        'aria-labelledby': tabElementId(current.path),
        tabIndex: -1,
      },
      // A tab whose read has not landed yet is not an empty file: showing an empty
      // editable page would invite the author to type into a buffer that is about
      // to be replaced. It says what it is instead, and becomes the page when the
      // text arrives.
      current.loading
        ? React.createElement('div', { className: 'dsh-notebook-empty' }, t('loadingFile'))
        : React.createElement('div', { className: 'dsh-notebook-doc', style: docStyle },
          React.createElement('div', { className: 'dsh-notebook-editorBody' },
            // The rendered page edits the tab's draft directly: `Wysiwyg` hands back
            // rebuilt markdown on every keystroke, so the count, the dirty flag and
            // the save all mean the same thing in both modes.
            rendered
              ? React.createElement(Wysiwyg, {
                // The key names the *file* as well as the parse: switching tabs must
                // build a new editor rather than hand the previous file's DOM a
                // different chapter.
                key: `${current.path}:${String(current.docToken)}`,
                text: current.draft,
                onChange: (markdown: string) => { edit(current.path, markdown) },
              })
              : React.createElement(TextArea, {
                value: current.draft,
                onChange: (value) => { edit(current.path, value) },
                placeholder: current.path,
                ariaLabel: current.path,
                className: 'dsh-notebook-grow',
              }),
          ),
        ),
      ),
  )

  /**
   * The delete confirmation.
   *
   * A modal is the right weight here and nowhere else in this panel: the one
   * operation that typing cannot undo gets a question that stops the hand, says
   * exactly what is about to go (including how many files a folder holds), and puts
   * the destructive button behind `danger`. `Escape` cancels, and the cancel button
   * has focus, so a stray Enter does nothing.
   */
  const confirmDialog = confirming === undefined ? null : React.createElement('div', {
    className: 'dsh-notebook-scrim',
    role: 'presentation',
    onClick: (event: React.MouseEvent<HTMLDivElement>) => {
      // Only the backdrop itself dismisses; a click that started inside the card and
      // ended on it (a drag selecting the file count) must not cancel the question.
      if (event.target === event.currentTarget) setConfirming(undefined)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setConfirming(undefined)
      }
    },
  }, React.createElement('div', {
    className: 'dsh-notebook-dialog',
    role: 'alertdialog',
    'aria-modal': 'true',
    'aria-label': t('deleteTitle'),
    'aria-describedby': 'dsh-notebook-delete-question',
  },
    React.createElement('div', { className: 'dsh-notebook-dialogTitle' },
      React.createElement(DeleteIcon, { size: 15 }),
      t('deleteTitle')),
    React.createElement('p', { className: 'dsh-notebook-dialogBody', id: 'dsh-notebook-delete-question' },
      confirming.directory
        ? t('deleteFolderQuestion').replace('{name}', confirming.name)
        : t('deleteFileQuestion').replace('{name}', confirming.name)),
    confirming.directory
      ? React.createElement('p', { className: 'dsh-notebook-dialogNote' },
        confirming.files === null
          ? t('deleteUnknownSize')
          : t('deleteFolderCount').replace('{count}', String(confirming.files)))
      : null,
    React.createElement('div', { className: 'dsh-notebook-dialogActions' },
      React.createElement(Button, {
        title: t('cancel'),
        attrs: { 'data-action': 'delete-cancel' },
        onClick: () => { setConfirming(undefined) },
      }, t('cancel')),
      React.createElement(Button, {
        variant: 'danger',
        title: t('deleteConfirm'),
        disabled: busy,
        attrs: { 'data-action': 'delete-confirm' },
        onClick: () => { void confirmDelete() },
      }, t('deleteConfirm')))))

  // Returned as a fragment rather than wrapped in a row of its own, so the page's
  // one flex row holds all three regions as siblings. Nesting a second row here
  // would work visually but would put the boundary between this column and the
  // conversation column in a different element from the boundary beside it — and
  // the drag handles would then be measuring two different containers.
  return React.createElement(React.Fragment, null, directory,
    React.createElement(Grip, { value: side, label: t('resizeSide'), onResize: onSideResize }),
    editor,
    confirmDialog)
}
