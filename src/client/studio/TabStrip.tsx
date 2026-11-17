/**
 * The editor's tab strip.
 *
 * One tab per open file, directly under the typography row: the row is the
 * panel's own controls, the tabs are the documents, and a document's name is what
 * the strip is for. Each tab carries the same type artwork the directory tree drew
 * for that file ({@link TreeIcon}), so the two lists name the same thing the same
 * way — a `.md` chapter looks like a `.md` chapter wherever it is listed.
 *
 * Kept apart from `NotebookTab` because it owns nothing: it renders a list and
 * reports the two gestures a strip has, and the page decides what they mean (a
 * choose activates a tab, a close may write it first).
 *
 * Two details are less obvious than the drawing:
 *
 * - **A repeated file name says which one it is.** Chapters live in folders, so
 *   `第一章/笔记.md` and `第二章/笔记.md` are both `笔记.md`; a strip that showed only
 *   the last segment would offer two identical-looking tabs. When two open files
 *   share a name, each of them names its folder too.
 * - **The keyboard runs the strip.** One Tab stop (the drawn tab), arrows to move,
 *   `Delete` to close — which is what lets the close control be out of the tab
 *   order for every tab but the drawn one without hiding the action.
 */
import * as React from 'react'
import { useEffect, useRef } from 'react'
import { TreeIcon } from '../icons/material'
import { fileNameOf, nextActive, PAGE_ID, tabElementId } from '../state/tabs'
import type { OpenFile } from '../state/tabs'
import type { T } from '../strings'

export interface TabStripProps {
  /** The open files, in the order the tabs are drawn. */
  files: readonly OpenFile[]
  /** The path whose tab is drawn; the only one with a full-opacity face. */
  active: string | undefined
  /** The panel's translator. */
  t: T
  /** A tab was clicked, or reached with the arrow keys. */
  onChoose: (path: string) => void
  /** The close control was used, or `Delete` was pressed on a focused tab. */
  onClose: (path: string) => void
  /**
   * The count and save state of the drawn file.
   *
   * They sit at the right end of this row rather than in the wrapping toolbar
   * above: the toolbar re-flows as the column narrows, and a number that gains a
   * digit while the author types must not push the page down. This row never wraps.
   */
  meta?: React.ReactNode
}

/** A tab is 30px tall, so its type artwork is drawn a size down from the tree's. */
const TAB_ICON_SIZE = 14

/**
 * A tab's displayed name.
 *
 * The last segment, unless another open tab has the same one — then the folder it
 * sits in is appended, because two identical labels would make the strip useless
 * for exactly the workspace this plugin is built for (a folder per chapter).
 * @param files - every open file, so the collision can be seen.
 * @param file - the tab being named.
 * @returns the label, and the full path for its tooltip.
 */
export function tabLabel(files: readonly OpenFile[], file: OpenFile): string {
  const name = fileNameOf(file.path)
  const repeated = files.some(other => other.path !== file.path && fileNameOf(other.path) === name)
  if (!repeated) return name
  const parent = file.path.split('/').slice(-2, -1)[0]
  return parent === undefined ? name : `${name} · ${parent}`
}

/**
 * The strip under the toolbar.
 * @param props - see {@link TabStripProps}.
 * @returns the tab list, or `null` with every tab closed.
 */
export function TabStrip({ files, active, t, onChoose, onClose, meta }: TabStripProps): React.ReactElement | null {
  /**
   * The rendered tab elements, by path.
   *
   * The strip is one control for the keyboard: the arrows move the selection, so
   * focus has to move with it. A map of nodes is what lets that happen without
   * each tab knowing about its neighbours.
   */
  const nodes = useRef(new Map<string, HTMLElement>())
  /**
   * Where focus should go after the next render.
   *
   * Set by a keypress and claimed by the effect below, rather than focused inline:
   * a keystroke that moves the selection changes which tab is the strip's tab stop,
   * and the node that must be focused is the one React is about to draw.
   */
  const wanted = useRef<string | undefined>(undefined)

  // The drawn tab is kept in view as the strip fills up: a tab that scrolled off
  // the edge is a file the author cannot see they have open. The same pass claims a
  // pending focus request.
  useEffect(() => {
    const path = wanted.current
    if (path !== undefined) {
      wanted.current = undefined
      nodes.current.get(path)?.focus()
    } else if (active !== undefined) {
      nodes.current.get(active)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [active, files.length])

  if (files.length === 0) return null

  /**
   * Move or close from the keyboard.
   *
   * `ArrowLeft` / `ArrowRight` activate the neighbouring tab and take the focus
   * with them, wrapping at the ends; `Delete` / `Backspace` close the focused tab
   * and hand the focus on; `Enter` / `Space` activate, which is what a tab that is
   * reached with Tab expects.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, file: OpenFile): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onChoose(file.path)
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      if (files.length < 2) return
      const index = files.findIndex(entry => entry.path === file.path)
      const step = event.key === 'ArrowRight' ? 1 : -1
      const next = files[(index + step + files.length) % files.length]
      if (next === undefined) return
      wanted.current = next.path
      onChoose(next.path)
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      // Worked out before the close lands, because after it the list no longer
      // knows where the closed tab was.
      const after = nextActive(files, file.path, active)
      wanted.current = after
      onClose(file.path)
    }
  }

  // The row is two boxes: the strip, which scrolls sideways, and the drawn file's
  // count at its right end, which must not be carried off when the tabs overflow.
  return React.createElement('div', {
    className: 'dsh-notebook-tabs',
  },
  React.createElement('div', {
    className: 'dsh-notebook-tabList',
    role: 'tablist',
    'aria-label': t('openFiles'),
    'aria-orientation': 'horizontal',
  }, ...files.map((file) => {
    const name = tabLabel(files, file)
    const isActive = file.path === active
    return React.createElement('div', {
      key: file.path,
      id: tabElementId(file.path),
      className: 'dsh-notebook-tab',
      role: 'tab',
      title: file.path,
      // Said explicitly rather than left to the children: `role=tab` treats its
      // contents as presentational, so the close button inside would otherwise be
      // the only thing a name is computed from — and the unsaved state would be
      // silent, because the dot is decorative.
      'aria-label': file.dirty ? `${name}${t('unsavedSuffix')}` : name,
      'aria-selected': isActive ? 'true' : 'false',
      'aria-controls': PAGE_ID,
      'data-active': isActive ? 'true' : 'false',
      'data-dirty': file.dirty ? 'true' : 'false',
      'data-tab-path': file.path,
      // Roving tab index: one stop for the whole strip, on the tab that is drawn.
      tabIndex: isActive ? 0 : -1,
      ref: (node: HTMLElement | null) => {
        if (node === null) nodes.current.delete(file.path)
        else nodes.current.set(file.path, node)
      },
      onClick: () => { onChoose(file.path) },
      // Middle-click closes, the gesture every editor's tab strip has. The press is
      // stopped as well as the click: Windows would otherwise start autoscroll on
      // the button-down and never let the tab strip see the `auxclick`.
      onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.button === 1) event.preventDefault()
      },
      onAuxClick: (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.button !== 1) return
        event.preventDefault()
        onClose(file.path)
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => { onKeyDown(event, file) },
    },
    // The tree's own drawing for this name, one step smaller.
    React.createElement(TreeIcon, { name: fileNameOf(file.path), size: TAB_ICON_SIZE }),
    React.createElement('span', { className: 'dsh-notebook-tabName' }, name),
    // The dot marks an unsaved tab *other than the drawn one*: the toolbar's 未保存
    // already says the file on screen has pending changes, and two marks for the
    // same fact in the same band read as two problems.
    file.dirty && !isActive ? React.createElement('span', { className: 'dsh-notebook-tabDot', 'aria-hidden': true }) : null,
    React.createElement('button', {
      type: 'button',
      className: 'dsh-notebook-tabClose',
      title: t('closeFile'),
      'aria-label': `${t('closeFile')} ${name}`,
      // Reachable from the tab that is drawn, and out of the way for the rest: the
      // keyboard's way to close any tab is `Delete` on it.
      tabIndex: isActive ? 0 : -1,
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        // Without this the tab underneath would also be activated, and a close
        // followed by an immediate re-open reads as "the button did nothing".
        event.stopPropagation()
        onClose(file.path)
      },
    }, '×'))
  })),
  meta === undefined || meta === null ? null : React.createElement('div', { className: 'dsh-notebook-tabMeta' }, meta))
}
