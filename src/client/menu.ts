/**
 * The directory tree's right-click menu.
 *
 * DSH has a shared context menu (`ui-context-menu`): a plugin registers a *target
 * family* and the actions it contributes to it, and the shell owns the popup —
 * positioning, keyboard movement, focus return, dismissal, and capturing the target
 * at the moment of the gesture. This module is the whole of this plugin's side of
 * that.
 *
 * Three decisions are worth stating:
 *
 * - **A target family of its own.** The obvious move is to contribute to the
 *   shipped `file` / `directory` families, which already carry DSH's own actions.
 *   That would be wrong: those families are opened by the shell's file sidebar and
 *   by file references in the transcript, so the notebook's "new folder right here"
 *   would appear on a file the user right-clicked somewhere else entirely. A
 *   `notebookEntry` family is opened only by this panel's tree.
 * - **`ctx.get`, not `inject`.** The menu is an optional convenience: a shell
 *   without `ui-context-menu` should still draw the panel and its toolbar, just
 *   without a right-click menu. Injecting the service would make the whole plugin
 *   inactive in such a shell.
 * - **Actions call through the command bridge.** The contributions outlive any one
 *   panel render, so they cannot close over component state; they reach the mounted
 *   panel through `state/commands`.
 */
import type { ContextMenusService, MenuAction, MenuContribution } from './dsh'
import { panelCommands } from './state/commands'
import type { StringKey, T } from './strings'

/** The target family this plugin owns. Only the notebook tree opens it. */
export const ENTRY_TARGET = 'notebookEntry'

/** What one right-clicked row carries. Captured when the gesture begins. */
export interface EntryTarget {
  /** Project-relative path, or `''` for the workspace root itself. */
  path: string
  /** The last segment, for the labels. */
  name: string
  /** True for a folder, which decides what "new here" means. */
  directory: boolean
}

/** The glyph keys this plugin registers in the `contextMenu.icon` slot. */
export const ICON_KEYS = {
  newFile: 'notebook.newFile',
  newFolder: 'notebook.newFolder',
  rename: 'notebook.rename',
  remove: 'notebook.remove',
  refresh: 'notebook.refresh',
  reveal: 'notebook.reveal',
} as const

/**
 * The folder a "new file / new folder" lands in, given the right-clicked row.
 *
 * Right-clicking a folder means "inside this one"; right-clicking a file means
 * "beside this one", because a file cannot contain anything. The root row has an
 * empty path, which is already the workspace root.
 * @param entry - the captured row.
 * @returns the folder path to create in.
 */
export function createTargetDir(entry: EntryTarget): string {
  if (entry.path === '' || entry.directory) return entry.path
  const cut = entry.path.lastIndexOf('/')
  return cut < 0 ? '' : entry.path.slice(0, cut)
}

/**
 * The six actions for one captured row.
 *
 * Order is the order a file manager shows them, and the destructive one is last,
 * separated, and marked `danger` so the popup renders it differently rather than
 * making it the fourth identical line.
 *
 * A tool that is unavailable is **disabled with a reason**, never removed: a menu
 * that changes shape depending on shell state is a menu the user has to re-read
 * every time. The one exception is the workspace root, which cannot be renamed or
 * deleted — those two are simply absent there, because the root is not an entry in
 * its own tree and there is nothing to point at.
 * @param entry - the captured row.
 * @param t - the panel's translator.
 * @returns the actions.
 */
export function entryActions(entry: EntryTarget, t: T): MenuAction[] {
  const at = createTargetDir(entry)
  const root = entry.path === ''
  return [
    {
      id: 'newFile',
      label: t('newFile'),
      icon: { key: ICON_KEYS.newFile },
      run: () => { panelCommands()?.create(at, 'file') },
    },
    {
      id: 'newFolder',
      label: t('newDir'),
      icon: { key: ICON_KEYS.newFolder },
      run: () => { panelCommands()?.create(at, 'dir') },
    },
    ...root ? [] : [
      {
        id: 'rename',
        label: t('rename'),
        icon: { key: ICON_KEYS.rename },
        separatorBefore: true,
        run: () => { panelCommands()?.rename(entry.path) },
      } satisfies MenuAction,
      {
        id: 'delete',
        label: t('delete'),
        icon: { key: ICON_KEYS.remove },
        danger: true,
        run: () => { panelCommands()?.remove(entry.path) },
      } satisfies MenuAction,
    ],
    {
      id: 'refresh',
      label: t('refresh'),
      icon: { key: ICON_KEYS.refresh },
      separatorBefore: true,
      run: () => { panelCommands()?.refresh() },
    },
    {
      id: 'reveal',
      label: t('reveal'),
      icon: { key: ICON_KEYS.reveal },
      run: () => { panelCommands()?.reveal(entry.path) },
    },
  ]
}

/**
 * Register the tree's menu contributions.
 *
 * Two families would be neater than one with a `directory` flag, but the shell
 * already keys the target by family and the row knows its own kind at gesture time;
 * one family with the flag is what lets the menu say "新建文件" on a file and
 * "新建文件夹" inside a folder without a second registration.
 * @param menus - the shell's menu service.
 * @param t - the panel's translator, read per opening so a locale switch follows.
 * @returns the disposer for every registration.
 */
export function registerEntryMenu(menus: ContextMenusService, t: T): () => void {
  const contribution: MenuContribution = {
    id: 'notebook.entry',
    target: ENTRY_TARGET,
    // Late enough that any shell-provided action for the same family would sort
    // above this plugin's own; there is none today, so the number only states the
    // intent.
    order: 100,
    resolve: (value) => entryActions(value as EntryTarget, t),
  }
  return menus.register(contribution)
}

/** The label keys the menu reads, so a dictionary that loses one fails a check. */
export const MENU_LABEL_KEYS: readonly StringKey[] = ['newFile', 'newDir', 'rename', 'delete', 'refresh', 'reveal']
