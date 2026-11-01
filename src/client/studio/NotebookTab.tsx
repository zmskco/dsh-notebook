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
import { editorControls, initialEditorMode, isMarkdownPath, nextEditorMode } from '../state/markdown'
import type { EditorMode } from '../state/markdown'
import { Wysiwyg } from './Wysiwyg'
import {
  FONT_IDS,
  FONT_STACKS,
  PAPER_IDS,
  SIZE_STEPS,
} from '../state/editor-prefs'
import type { EditorPrefs, FontId, PaperId } from '../state/editor-prefs'
import { ChatIcon, FileIcon, FilePlusIcon, FolderIcon, FolderPlusIcon, RefreshIcon, RevealIcon } from '../glyphs'
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

export function NotebookTab({ t, side, onSideResize, canChat, chatVisible, onToggleChat, prefs, onPrefsChange }: NotebookTabProps): React.ReactElement {
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
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  /** Which create form is open, if any: a file or a directory. */
  const [creating, setCreating] = useState<'file' | 'dir' | undefined>(undefined)
  const [newName, setNewName] = useState('')
  /**
   * Whether the open file is being read (rendered) or written (source).
   *
   * Kept beside `selected` rather than inside it: the mode belongs to the file
   * that is open, and every path that opens one decides it — {@link initialEditorMode}
   * for a file that already exists, writing for one just created.
   */
  const [mode, setMode] = useState<EditorMode>('wysiwyg')
  /**
   * A counter that forces the rendered editor to be re-created.
   *
   * The editor is uncontrolled while it is mounted (see `Wysiwyg`): the DOM is
   * the source of truth so the caret never moves under a re-render. Opening a
   * file, saving one back, or switching to source and back is exactly when a
   * fresh parse is the right answer, so those bump this and the component
   * remounts.
   */
  const [docToken, setDocToken] = useState(0)
  /** Typeface, size and paper, owned by the page and passed down. */
  /**
   * The draft an autosave attempt failed on.
   *
   * Without it a refusal — a read-only deployment, a story pinned outside the
   * workspace — would be retried on every pause, forever.
   */
  const failedDraft = useRef<string | undefined>(undefined)
  /** The live buffer, so a save in flight can tell whether it is already stale. */
  const draftRef = useRef(draft)
  draftRef.current = draft
  // Guards against a slow read for a previously selected file overwriting the
  // editor after the user has already moved on.
  const loadToken = useRef(0)

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
   * Hand the workspace to the operating system's file manager.
   *
   * A browser cannot open a local folder, so this is the one action that has to
   * ask the Host; the Host decides which directory (always the workspace), so the
   * page never names a path. A refusal is reported, not swallowed: the author
   * clicked something that did not happen.
   */
  const revealFolder = useCallback(async (): Promise<void> => {
    setError(undefined)
    try {
      const result = await api.reveal()
      if (!result.opened) setError(t('revealFailed'))
    } catch (cause: unknown) {
      setError(messageOf(cause))
    }
  }, [t])

  const load = useCallback(async (path: string) => {
    const token = loadToken.current + 1
    loadToken.current = token
    setBusy(true)
    setError(undefined)
    try {
      const document = await api.file(WORKSPACE_PROJECT, path)
      if (loadToken.current !== token) return
      setDraft(document.content)
      setDirty(false)
      // A fresh file means a fresh parse of the rendered document, and no caret
      // or scroll offset to put back.
      setDocToken(current => current + 1)
    } catch (cause: unknown) {
      if (loadToken.current !== token) return
      setError(messageOf(cause))
    } finally {
      if (loadToken.current === token) setBusy(false)
    }
  }, [])

  const save = useCallback(async () => {
    if (selected === undefined) return
    // Nothing to write: a file that was only read must not be normalised on disk
    // because the author happened to press Ctrl/Cmd+S.
    if (!dirty) return
    // The text this write is about. If the author keeps typing while it is in
    // flight, the file on disk is this snapshot and the buffer stays dirty.
    const saved = draft
    setBusy(true)
    setError(undefined)
    try {
      await api.saveFile(WORKSPACE_PROJECT, selected, saved)
      failedDraft.current = undefined
      if (draftRef.current === saved) setDirty(false)
      // The size in the tree is the only thing a save changes, so it is patched
      // here. Re-listing the workspace on every autosave walked the whole tree
      // once per keystroke batch — the largest avoidable cost in this page.
      const bytes = new TextEncoder().encode(saved).length
      setFiles(current => current.map(entry => (entry.path === selected ? { ...entry, bytes } : entry)))
    } catch (cause: unknown) {
      // Remembered so autosave does not retry the same refusal on every pause.
      failedDraft.current = saved
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [draft, selected])

  // Autosave: a pause this long after the last keystroke writes the file. The
  // effect's own cleanup *is* the debounce — a fast typist writes once, not once
  // per key — and a refusal is not retried until the text changes, because the
  // same refusal would land on every pause otherwise.
  useEffect(() => {
    if (!dirty || busy || selected === undefined) return
    if (failedDraft.current === draft) return
    const timer = setTimeout(() => { void save() }, AUTOSAVE_MS)
    return () => { clearTimeout(timer) }
  }, [busy, dirty, draft, save, selected])

  /**
   * Open a file.
   *
   * The mode is decided here — the one place every existing file arrives through —
   * so markdown opens as the rendered page and anything else as source; the choice
   * is not inherited from whatever was open before.
   *
   * The buffer being left is written first when it has unsaved changes. Autosave
   * means the author never opted into deciding what happens to a keystroke they
   * typed a moment ago, so clicking another file is not the place to ask them.
   *
   * Opening a file also moves the create target to the folder it lives in. The
   * highlighted folder is therefore always the one the open file belongs to —
   * before this, clicking a file elsewhere left the last folder they had opened
   * still marked, which read as "that folder is selected".
   */
  const choose = useCallback((path: string) => {
    // Aim first, and even for the file that is already open: the target is a
    // property of where the author is working, and re-selecting the open file is
    // exactly how they come back to it after aiming somewhere else.
    setTargetDir(parentOf(path))
    if (path === selected) return
    if (dirty) void save()
    setSelected(path)
    setMode(initialEditorMode(path))
    void load(path)
  }, [dirty, load, save, selected])

  // Whatever is open must be visible: a highlighted row inside a collapsed folder
  // is a selection the author cannot see, which reads as "nothing is open".
  useEffect(() => {
    if (selected !== undefined) reveal(selected)
  }, [reveal, selected])

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
        // tree can show it without the user hunting for the directory.
        reveal(chapter.path)
        setSelected(chapter.path)
        setDraft(chapter.content)
        setDirty(false)
        // A chapter that was just created exists to be written: it opens in the
        // rendered editor, with its heading in place and the caret-free page ready.
        setMode('wysiwyg')
        setDocToken(current => current + 1)
        void loadFiles()
      }
      setNewName('')
      setCreating(undefined)
    } catch (cause: unknown) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [creating, loadFiles, newName, reveal, t, target])

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void save()
    }
  }, [save])

  const tree = useMemo(() => buildTree(files), [files])

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
        React.createElement('span', { className: 'dsh-notebook-treeIcon' },
          kind === 'dir' ? React.createElement(FolderIcon, {}) : React.createElement(FileIcon, {})),
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
            onClick: () => { toggleDir(node.path) },
          },
          // The folder *is* the disclosure control: an open folder means the
          // children below it are shown. No leading triangle — a caret beside a
          // folder icon is two marks for one control.
          React.createElement('span', { className: 'dsh-notebook-treeIcon' },
            React.createElement(FolderIcon, { open })),
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
          'data-active': node.path === selected,
          title: node.path,
          style: { paddingLeft: indent },
          onClick: () => { choose(node.path) },
        },
        React.createElement('span', { className: 'dsh-notebook-treeIcon' },
          React.createElement(FileIcon, {})),
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
      React.createElement('div', { className: 'dsh-notebook-sectionTitle', style: { margin: 0 } }, t('library')),
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
  const previewable = selected !== undefined && isMarkdownPath(selected)
  const rendered = previewable && mode === 'wysiwyg'
  const controls = editorControls(previewable)

  /**
   * Switch between the rendered page and the markdown behind it.
   *
   * The counter bump is what makes the switch safe: the rendered editor is
   * re-created from the current draft, so leaving and returning to it cannot show
   * a stale parse of what the source view just changed.
   */
  const switchMode = useCallback((): void => {
    setMode(nextEditorMode(mode))
    // The other surface draws from the same draft, and neither keeps a caret or a
    // scroll offset across the change.
    setDocToken(current => current + 1)
  }, [mode])

  /**
   * The typography row.
   *
   * Three groups in one line — typeface, size, paper — separated by rules rather
   * than by the words 字体 / 字号 / 背景: the buttons say what they are (a
   * one-character face name, a number, a paper name), and a label above each group
   * only cost width in a 268px column.
   */
  const divider = (key: string): React.ReactElement =>
    React.createElement('span', { key, className: 'dsh-notebook-divider', role: 'presentation' })

  const typebar = React.createElement('div', { className: 'dsh-notebook-typebar' },
    // One-character buttons rather than a select: five family names in a narrow
    // column wrap into three lines, and the full name is on each button's title.
    ...FONT_IDS.map(id => React.createElement(Button, {
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
    }, t(FONT_LABELS[id]))),
    divider('d-size'),
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
    ...PAPER_IDS.map(id => React.createElement(Button, {
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
    }, t(PAPER_LABELS[id]))),
    divider('d-actions'),
    // Both modes are buttons of their own — 写作 and 源码 — rather than one toggle
    // whose label names the *other* mode: a control that says 源码 while you are
    // already looking at source is a riddle, and the two modes are the two things
    // this page can be.
    controls.toggle
      ? React.createElement(Button, {
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
      }, t('writing'))
      : null,
    controls.toggle
      ? React.createElement(Button, {
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
      }, t('source'))
      : null,
    // The count and the saved/unsaved state end the row, pushed right: they
    // describe the file, not the controls on its left. Saving itself is automatic
    // (and `Ctrl/Cmd+S` still forces it), so there is no save button to sit beside.
    React.createElement('span', { className: 'dsh-notebook-spacer' }),
    React.createElement('span', { className: 'dsh-notebook-count' }, `${String(countChars(draft))} ${t('chars')}`),
    React.createElement('span', {
      className: 'dsh-notebook-count',
      'data-role': 'save-state',
      style: dirty ? { color: 'var(--dsw-alias-state-warn-primary)' } : undefined,
    }, dirty ? t('unsaved') : t('saved')),
  )

  // The page: paper colour, typeface and size travel as CSS variables, so the
  // rendered document and the source textarea share one setting.
  const docStyle: React.CSSProperties & Record<string, string> = {
    '--dsh-notebook-font': FONT_STACKS[prefs.font],
    '--dsh-notebook-size': `${String(prefs.size)}px`,
  }

  const editor = React.createElement('div', { className: 'dsh-notebook-pane dsh-notebook-main' },
    error === undefined ? null : React.createElement('div', { style: { padding: '10px 16px 0' } }, React.createElement(ErrorNote, null, error)),
    selected === undefined
      ? null
      : React.createElement('div', { className: 'dsh-notebook-editor', onKeyDown },
        typebar,
        React.createElement('div', { className: 'dsh-notebook-doc', style: docStyle },
          React.createElement('div', { className: 'dsh-notebook-editorBody' },
            // The rendered page edits the draft directly: `Wysiwyg` hands back
            // rebuilt markdown on every keystroke, so the count, the dirty flag
            // and the save button mean the same thing in both modes.
            rendered
              ? React.createElement(Wysiwyg, {
                key: `${selected}:${String(docToken)}`,
                text: draft,
                onChange: (markdown: string) => { setDraft(markdown); setDirty(true) },
              })
              : React.createElement(TextArea, {
                value: draft,
                onChange: (value) => { setDraft(value); setDirty(true) },
                placeholder: selected,
                ariaLabel: selected,
                className: 'dsh-notebook-grow',
              }),
          ),
        ),
      ),
  )

  // Returned as a fragment rather than wrapped in a row of its own, so the page's
  // one flex row holds all three regions as siblings. Nesting a second row here
  // would work visually but would put the boundary between this column and the
  // conversation column in a different element from the boundary beside it — and
  // the drag handles would then be measuring two different containers.
  return React.createElement(React.Fragment, null, directory,
    React.createElement(Grip, { value: side, label: t('resizeSide'), onResize: onSideResize }),
    editor)
}
