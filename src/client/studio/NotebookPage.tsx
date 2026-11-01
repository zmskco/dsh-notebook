/**
 * The studio page: three columns, and nothing above them.
 *
 * Left is the directory column — the story switcher over the project's file
 * tree — middle is the manuscript, right is the harness Conversation. The page
 * used to open with a header row (product name, story picker, create) and a row
 * of 小说/漫画 tabs. Both are gone: the panel is those three regions, and the
 * two controls that used to ride in the header — switching story, making one —
 * live at the top of the directory column, which is the column they act on.
 *
 * This component owns the project snapshot, and the directory column and the
 * editor read it. That keeps one refresh path: a save anywhere calls `reload`,
 * and the columns re-derive from the new snapshot.
 */
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { api, messageOf } from '../api'
import { CHAT_SLOT } from './ConversationPane'
import type { PaneLayout } from '../state/layout'
import { loadLayout, resizePane, saveLayout, toggleTalking } from '../state/layout'
import { NotebookTab } from './NotebookTab'
import { fallbackT, type StringKey, type T } from '../strings'
import { loadPrefs, savePrefs } from '../state/editor-prefs'
import type { EditorPrefs } from '../state/editor-prefs'
import { WORKSPACE_PROJECT } from '../api'
import type { NotebookState } from '../../host/types'
import { ErrorNote, Grip, StyleSheet } from '../ui'

export interface NotebookPageProps {
  /** The framework's locale seat, present because the entry declares `locale:`. */
  t?: (key: string) => string
  /**
   * Renders the child slot this entry declared.
   *
   * Injected by the slot renderer because `children` names {@link CHAT_SLOT}; it
   * is the seat that makes the panel a *host* for the harness Conversation rather
   * than a copy of it. Optional so a shell that changed shape degrades to a
   * studio page without the chat column instead of failing to render.
   */
  renderSlot?: (key: string, owner?: Record<string, unknown>) => React.ReactNode
}

export function NotebookPage(props: NotebookPageProps): React.ReactElement {
  const seat = props.t
  const renderSlot = props.renderSlot
  const t: T = useCallback((key: StringKey) => {
    if (seat !== undefined) {
      try {
        const value = seat(key)
        if (typeof value === 'string' && value.length > 0 && value !== key) return value
      } catch {
        // A locale seat that throws must not blank the page.
      }
    }
    return fallbackT(key)
  }, [seat])

  const [state, setState] = useState<NotebookState | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  /** The two column widths. See `layout.ts` for the drag rules. */
  const [layout, setLayout] = useState<PaneLayout>(loadLayout)
  /**
   * The paper, typeface and text size.
   *
   * Owned by the page rather than by the editor column: the paper is the look of
   * the whole panel now — directory column, editor and conversation — so the
   * element that carries `data-paper` is the page's root.
   */
  const [prefs, setPrefs] = useState<EditorPrefs>(loadPrefs)

  /** Remember one typography change, and write it through. */
  const updatePrefs = useCallback((patch: Partial<EditorPrefs>): void => {
    setPrefs((current) => {
      const next = { ...current, ...patch }
      savePrefs(next)
      return next
    })
  }, [])

  // Persisted once the gesture settles, not on every move: this write is
  // synchronous and a pointermove fires dozens of times a second, which would put
  // storage I/O in the middle of the drag. A pending write is simply replaced,
  // and the 400ms window is short enough that closing the tab inside it is not a
  // realistic way to lose a width.
  useEffect(() => {
    const timer = setTimeout(() => { saveLayout(layout) }, 400)
    return () => { clearTimeout(timer) }
  }, [layout])

  /**
   * Apply a drag.
   *
   * The functional update is what keeps a fast drag honest: the handler holds the
   * width the drag started from, and only the current layout knows what the rest
   * of the row needs.
   */
  const resize = useCallback((which: 'side' | 'chat', next: number, total: number): void => {
    setLayout(current => resizePane(current, which, next, total))
  }, [])

  /**
   * Show or hide the conversation column.
   *
   * A paint decision, never a mount decision: the conversation is what binds the
   * Session for every request this page makes, so it stays mounted and the
   * visibility flag only reaches a CSS rule (see `ui.ts`).
   */
  const toggleChat = useCallback((): void => {
    setLayout(current => toggleTalking(current))
  }, [])

  const loadState = useCallback(async (): Promise<NotebookState | undefined> => {
    setError(undefined)
    try {
      const next = await api.state()
      setState(next)
      return next
    } catch (cause: unknown) {
      setError(messageOf(cause))
      return undefined
    }
  }, [])

  useEffect(() => { void loadState() }, [loadState])

  /**
   * Put the Session's working directory on the workspace the tree shows.
   *
   * The panel no longer opens one story out of a library, so there is no
   * selection to follow: the directory the model works in is the workspace this
   * page is rooted at. Fired once, because it cannot change while the page lives.
   *
   * With a chat seat the pane does it instead: it is the half that knows which
   * Session the page serves, so it also follows a Session change. This effect
   * remains for the shell that gave the page no chat seat to host, and it is
   * guarded on exactly that so the two never both fire.
   */
  useEffect(() => {
    if (renderSlot !== undefined) return
    void api.focus(WORKSPACE_PROJECT).catch(() => undefined)
  }, [renderSlot])

  /** Whether this shell handed the panel a conversation seat at all. */
  const canChat = renderSlot !== undefined

  // The third region: the harness Conversation, embedded through the child slot
  // this entry declared. It is a *host* for the real chat, so the model here has
  // the same tools it has in the main panel — including this plugin's own, which
  // is how it reads and edits the file the column beside it is showing.
  //
  // Present from the first render, like the other two: the conversation is where
  // a story gets started ("写一个关于…的故事" is the model calling the same tools
  // the panel would), so gating it on anything existing would hide the column at
  // exactly the moment it is most useful.
  //
  // The owner props the pane needs to focus the Session it serves on the same
  // directory this page is rooted at (see `ConversationPane`).
  const chat = renderSlot === undefined ? null : renderSlot(CHAT_SLOT, { projectId: WORKSPACE_PROJECT })

  // The widths travel as CSS variables rather than as props, because the
  // conversation column is rendered by a component this one does not own — it
  // comes out of a slot — so a variable on the row is the only channel all three
  // regions can read from.
  const bodyStyle: React.CSSProperties & Record<string, string> = {
    '--ns-side': `${String(layout.side)}px`,
    '--ns-chat': `${String(layout.chat)}px`,
  }

  const sandbox = state?.sandbox
  // Warn before the first save rather than after it. The guidance arrives from
  // the Host already spelled out with absolute paths and a paste-ready patch
  // block, so the page only has to place it — and it distinguishes the two
  // arrangements by whether this plugin itself can write: a read-only deployment
  // refuses everything, while a library pinned outside the open workspace is
  // writable here and refused for the model's own tools.
  const sandboxWarning = sandbox !== undefined && sandbox.guidance !== null
    ? React.createElement('div', { className: 'dsh-notebook-warn' },
      React.createElement('div', { className: 'dsh-notebook-warnTitle' },
        sandbox.writable ? t('outsideWorkspaceTitle') : t('unwritableTitle')),
      React.createElement('pre', { className: 'dsh-notebook-warnBody' }, sandbox.guidance),
    )
    : null

  // The stylesheet is rendered, not fetched, so it lives exactly as long as the
  // panel and disappears with it. It has to be here — the outermost element the
  // page always renders — rather than inside a branch, or the loading and
  // empty-project states would flash unstyled.
  return React.createElement('div', {
    className: 'dsh-notebook-root',
    // The paper covers the whole panel: the directory column, the editor and the
    // conversation all sit on it (the stylesheet remaps the theme tokens under
    // this attribute, so nothing inside keeps the shell's own surface colour).
    'data-paper': prefs.paper,
  },
    React.createElement(StyleSheet),
    sandboxWarning === null
      ? null
      : React.createElement('div', { style: { padding: '10px 16px 0', flex: 'none' } }, sandboxWarning),
    error === undefined ? null : React.createElement('div', { style: { padding: '10px 16px 0', flex: 'none' } }, React.createElement(ErrorNote, null, error)),
    // One flex row holds all three regions as siblings: the directory column and
    // the manuscript come from `NotebookTab` as a fragment, so the two drag handles
    // below measure the same container and the three columns read as one
    // sentence instead of a row inside a row.
    React.createElement('div', {
      className: 'dsh-notebook-body',
      style: bodyStyle,
      // The conversation column's visibility, as a paint attribute: the column
      // itself is rendered either way (it holds the Session binding).
      'data-talking': canChat && layout.talking ? 'on' : 'off',
    },
      React.createElement(NotebookTab, {
        t,
        side: layout.side,
        onSideResize: (next: number, total: number) => { resize('side', next, total) },
        canChat,
        chatVisible: canChat && layout.talking,
        onToggleChat: toggleChat,
        prefs,
        onPrefsChange: updatePrefs,
      }),
      // Only between two regions that are both there: a handle with nothing on one
      // side of it would resize a column the author cannot see.
      canChat && layout.talking
        ? React.createElement(Grip, {
          value: layout.chat,
          grow: 'end',
          label: t('resizeChat'),
          onResize: (next: number, total: number) => { resize('chat', next, total) },
        })
        : null,
      chat,
    ),
  )
}
