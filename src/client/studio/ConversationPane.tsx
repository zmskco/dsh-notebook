/**
 * The conversation pane: DSH's own chat, embedded beside the manuscript.
 *
 * This is deliberately **not** a second chat implementation. The pane renders
 * the same `conversation.content` factory the main Conversation panel renders,
 * with the `variant: 'embedded'` it publishes for exactly this purpose — the
 * same call the shipped subagent sidebar chat makes. Everything that makes the
 * harness chat worth having comes along with it: the Session, its history, its
 * composer, attachments, stop, queueing — and above all its **tools**, which in
 * this profile include this plugin's own `novel_*` tools. So the model reads and
 * writes the manuscript through the same path the agent does.
 *
 * That last point is the whole reason to embed rather than build: an
 * assistant written here would have to grow its own tool loop to touch a file,
 * and a side panel that writes files on its own say-so is exactly what an author
 * does not want. Here, "一边聊一边改文件" is just the agent using its tools, with
 * the author watching the same transcript they would see in the main panel.
 *
 * ## Why a pane component instead of calling the factory from the studio page
 *
 * `conversation.content` is session-scoped: it reads the current Session from
 * React context, not from its input props. A root-scoped registration — which is
 * what a `main` occupant like the studio page is — has no such context, so the
 * factory would render an empty shell. The renderer supplies a Session context
 * for a slot whose declared `scope` is `session`/`session-maybe`, so the studio
 * page declares one child slot of its own and renders it; *this* component is
 * what gets registered into that child, and it therefore receives the session
 * seats. The shipped `ConversationPanel` declares `main.conversation` with
 * `scope: 'session-maybe'` for the same reason.
 */
import * as React from 'react'
import { useEffect } from 'react'
import { api, bindSession } from '../api'
import type { T } from '../strings'

/** The parts of a Session snapshot this pane reads to describe the shell. */
export interface SessionSnapshotLike {
  blank?: boolean
  awaitingFirstTurn?: boolean
  running?: boolean
  promptAttempted?: boolean
  openState?: string
  subagent?: { address?: { mode?: string }; parentAvailable?: boolean }
}

/** The parts of the Conversation snapshot this pane reads. */
export interface ConversationSnapshotLike {
  activeTargets?: { size: number }
}

/** The parts of the Sessions snapshot this pane reads. */
export interface SessionsSnapshotLike {
  byId: Record<string, { blank?: boolean } | undefined>
}

/**
 * The seats a session-scoped registration receives.
 *
 * Every one is optional: a shell that hands out fewer seats should leave this
 * pane shallow, not crash the studio page that hosts it.
 */
export interface ConversationPaneProps {
  t?: T
  /** Renders a registered component factory; the seat that makes embedding possible. */
  renderFactorySlot?: (
    name: string,
    props: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => React.ReactNode
  /** The Session this scope resolves to, absent while the shell has none. */
  sessionId?: string | undefined
  useSession?: <S>(selector: (value: SessionSnapshotLike | undefined) => S) => S
  useConversation?: <S>(selector: (value: ConversationSnapshotLike | undefined) => S) => S
  useSessions?: <S>(selector: (value: SessionsSnapshotLike) => S) => S
  /**
   * The story the studio page has open, handed down by the page that renders this
   * child slot (owner props).
   *
   * Only the page knows the story, and only this pane knows which Session the page
   * is serving — so the focus call below needs the two together, here.
   */
  projectId?: string | undefined
}

/** The phase the factory expects, and whether the centered hero shows. */
export interface ConversationShell {
  phase: 'settling' | 'hero' | 'active'
  hero: boolean
}

/**
 * Describe the session to the factory.
 *
 * Copied from `ui-subagent`'s sidebar chat, which faces the same problem: the
 * shared content decides layout from a phase the *caller* has to compute. The
 * distinctions that matter are — a session still replaying must not flash the
 * centered hero and then snap to a docked composer, and a session with no
 * history at all is a hero rather than an empty transcript.
 *
 * Pure, and exported, because it is the only real decision in this file and the
 * artifact check can reach it without a render.
 * @param input - the session, its conversation and the list summary.
 * @returns the phase and hero flag for `conversation.content`.
 */
export function conversationShell(input: {
  sessionId?: string | undefined
  session?: SessionSnapshotLike | undefined
  conversation?: ConversationSnapshotLike | undefined
  summaryBlank?: boolean | undefined
}): ConversationShell {
  const { sessionId, session, conversation, summaryBlank } = input
  // Nothing selected is the plain hero: there is no transcript to show.
  if (sessionId === undefined || session === undefined) return { phase: 'hero', hero: true }

  const active = (conversation?.activeTargets?.size ?? 0) > 0
    || (session.blank !== true && session.awaitingFirstTurn !== true)
    || session.running === true
  const shellPhase = active ? 'active' : session.promptAttempted === true ? 'engaging' : 'blank'

  // A restored continuable subagent waits for a Host summary before its parent's
  // availability is known; the composer stays hidden rather than briefly showing
  // the parent-offline takeover.
  const parentPending = session.subagent?.address?.mode === 'continuable'
    && session.subagent.parentAvailable === undefined
  const settling = (shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true)
    || parentPending
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)

  return settling ? { phase: 'settling', hero: false } : { phase: hero ? 'hero' : 'active', hero }
}

/** The slot key the studio page declares and this component is registered into. */
export const CHAT_SLOT = 'notebook.chat'

/**
 * Render the harness Conversation for the current Session.
 * @param props - the seats this registration was handed.
 * @returns the embedded conversation, or a short note when the shell cannot host it.
 */
export function ConversationPane(props: ConversationPaneProps): React.ReactElement {
  const { renderFactorySlot, sessionId, useSession, useConversation, useSessions, t, projectId } = props
  const session = useSession?.(value => value)
  const conversation = useConversation?.(value => value)
  const summaryBlank = useSessions?.(
    state => sessionId === undefined ? undefined : state.byId[sessionId]?.blank,
  )
  const shell = conversationShell({ sessionId, session, conversation, summaryBlank })

  // Tell the panel's HTTP layer which Session it is serving. The Host resolves
  // the story root from that Session's workspace, so every request without it
  // would be answered from the deployment fallback instead of the workspace the
  // operator opened. Bound during render rather than in an effect: this pane is
  // rendered inside the studio page, and rendering the tree completes before any
  // effect runs, so the page's first `state` read already carries the Session.
  //
  // This is also why the page keeps the pane mounted while the column is hidden
  // (`[data-talking="off"]` hides it with CSS): unmounting it would unbind the
  // Session and re-point every request at the fallback root.
  bindSession(sessionId)

  /**
   * Put the Session this page serves to work **in the story the page shows**.
   *
   * The Host moves that Session's working directory into the story, which is what
   * makes the model's relative paths land in the book instead of beside the shelf
   * (see `story/focus.ts`). It is fired here, and keyed on the Session, for the case the
   * page cannot see: pressing the row's new-session button selects a Session this
   * page never renders again — the pane simply receives the new id — and a Session
   * starts in the workspace, not in the story. A story change is covered by the
   * same effect, so the page only has to focus when this shell gave it no chat seat
   * to host (see `NotebookPage`).
   *
   * The call is idempotent (`workingDirectory.set` returns early when the
   * directory is already right), so repeating it costs one request the Host
   * ignores. Failures are swallowed: the panel's own reads are unaffected, and the
   * next change retries.
   */
  useEffect(() => {
    if (projectId === undefined) return
    void api.focus(projectId).catch(() => undefined)
  }, [projectId, sessionId])

  // No header. The embedded content brings its own transcript, composer and
  // session title, so a title bar here would only repeat what the conversation
  // already says while spending the vertical room the transcript wants — and the
  // region's name is on its toggle in the tab row.
  const body = renderFactorySlot === undefined
    ? React.createElement('div', { className: 'dsh-notebook-empty' }, t?.('chatNoHost') ?? 'chatNoHost')
    : React.createElement('div', { className: 'dsh-notebook-chatBody', 'data-chat': 'conversation' },
      renderFactorySlot('conversation.content', {
        variant: 'embedded',
        phase: shell.phase,
        hero: shell.hero,
      }))

  return React.createElement('div', { className: 'dsh-notebook-chat', 'data-session': sessionId ?? '' }, body)
}
