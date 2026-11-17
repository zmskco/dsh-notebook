/**
 * Local declarations of the DSH Client surface this plugin consumes.
 *
 * Same rationale as the Host half's `dsh.ts`: the plugin is authored outside
 * the DSH checkout, so it declares the handful of members it calls instead of
 * importing internal packages. Read from the live Client services in this
 * profile (`cordis_inspect_query` -> client `Service`, `Slots`), not inferred.
 */

/** What a slot registration may declare. Only the fields this plugin sets are typed. */
export interface SlotRegistration {
  /** Slot key being contributed to. */
  name: string
  /** List-slot entry id, which for `sidebar.panellist` also addresses the `main` key. */
  id?: string
  /** Keyed-slot entry key, used by `main`. */
  key?: string
  /** Ascending position within the slot. */
  order?: number
  /** Row title, accessible name and collapsed tooltip. */
  label?: string | (() => string)
  /** Locale namespace bound to the component's `t` seat. */
  locale?: string
  /**
   * Child slots this registration declares, and therefore owns the right to
   * render. A child whose `scope` is not `root` also earns the registration the
   * `SessionProvider` seat, and the renderer supplies the session context for
   * that child — which is the only supported way to give a plugin's own subtree
   * a live Session.
   */
  children?: Record<string, { kind: string; scope: string }>
}

export interface SlotsService {
  /**
   * Register into a slot, re-running the callback whenever the owning
   * declaration appears or collapses. The callback may return one disposer or
   * yield several (a generator).
   */
  inject(key: string, callback: () => unknown): () => void
  register(options: SlotRegistration, component: unknown): () => void
}

export interface LocaleService {
  register(ns: string, locale: string, dict: Record<string, string>): () => void
  bind(ns: string): (key: string) => string
  getLocale(): { id: string }
}

/**
 * The slice of the shell's `uiWorkspace` service this plugin calls.
 *
 * Declared rather than imported, for the same reason as the Host half's services:
 * this plugin is authored outside the DSH checkout. Read from the live Client
 * service (`cordis_inspect_query` -> client `Service`, `uiWorkspace`).
 */
export interface UiWorkspaceService {
  /**
   * Create a fresh Session — or reuse a blank one — in the current or most recent
   * Workspace and reveal its Conversation.
   *
   * The whole new-session flow lives behind this call: which Workspace the
   * Session belongs to, the Agent preset, the session list entry, and the notice
   * when the Host refuses the creation. A refused creation leaves the selection
   * as it was.
   * @param workspaceId - explicit target; absent inherits the current Workspace.
   * @param options - initial content and the reused blank's preset.
   */
  startSession(workspaceId?: string, options?: {
    readonly prompt?: string
    readonly clearPreviousDraft?: boolean
    readonly agentPreset?: string
  }): void
}

/**
 * The slice of the shell's `layout` service this plugin calls.
 *
 * Declared rather than imported, like {@link UiWorkspaceService}. Read from the
 * live Client service (`cordis_inspect_query` -> client `Service`, `layout`).
 */
export interface LayoutService {
  /** Show one registered panel; the shell throws for an id it does not know. */
  selectPanel(panelId: string): void
  /** The observable the main region reads its occupant from. */
  readonly panelInfo: {
    getSnapshot(): { readonly activePanelId: string | null }
    subscribe(listener: () => void): () => void
  }
}

/**
 * The slice of the shell's `contextMenus` service this plugin calls.
 *
 * Declared rather than imported, like the rest of this file. Read from
 * `packages/client/ui-context-menu`'s public types and confirmed as mounted in this
 * profile: `ui-context-menu` is a row of the `web-app` bundle, and it publishes
 * `ctx.contextMenus` plus the `useContextMenu` hook it injects into every Slot scope.
 *
 * A plugin registers a *target family* and the actions it contributes to it. The
 * shared overlay owns positioning, keyboard movement, focus return, dismissal and
 * the per-gesture target capture — none of which this plugin reimplements.
 */
export interface ContextMenuBindings {
  /**
   * Bind a target to one element.
   *
   * The returned props carry `onContextMenu`, the keyboard equivalents (Shift+F10
   * and the ContextMenu key) and the focus stop. An existing handler runs first and
   * can keep ownership with `preventDefault()`.
   */
  getTriggerProps(
    target: ContextMenuTarget | (() => ContextMenuTarget) | undefined,
    handlers?: { onContextMenu?: unknown, onKeyDown?: unknown, tabIndex?: number },
  ): { onContextMenu?: unknown, onKeyDown?: unknown, tabIndex?: number }
}

/** Read the gesture bindings owned by the current menu-plugin lifetime. */
export type UseContextMenu = () => ContextMenuBindings

/** One capturable object. The value is captured when the gesture begins. */
export interface ContextMenuTarget {
  kind: string
  value: unknown
}

/** One action in a resolved menu. */
export interface MenuAction {
  /** Stable within its contribution; selection is by id. */
  id: string
  /** Already localized. */
  label: string
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  /** A glyph registered in the `contextMenu.icon` slot by this key. */
  icon?: { key: string, src?: string }
  /** Localized recovery guidance shown when `run` rejects. */
  failureLabel?: string
  children?: readonly MenuAction[]
  /** Reject to report a visible failure; cancellation resolves normally. */
  run?: () => void | Promise<void>
}

/** A contribution to one target family; `resolve` runs per opening. */
export interface MenuContribution {
  /** Namespaced and stable; a duplicate id within one target family fails. */
  id: string
  target: string
  order: number
  resolve(target: unknown, signal: AbortSignal): readonly MenuAction[] | Promise<readonly MenuAction[]>
}

export interface ContextMenusService {
  register(contribution: MenuContribution): () => void
  open(target: ContextMenuTarget, point: { x: number, y: number }): void
  notify(text: string, success?: boolean): void
}

export interface ClientContext {
  readonly slots: SlotsService
  readonly locale: LocaleService
  effect(callback: () => (() => void) | void, label?: string): () => void
  /**
   * Run a callback once the named services all exist.
   *
   * This is what makes an optional enhancement reliable: `ctx.get(name)` at
   * activation time answers only whether the service was registered *by then*, and
   * after a restart this plugin activates before `ui-context-menu` has provided its
   * service — the panel then quietly kept the browser's own menu. `inject` waits
   * instead: the callback runs when the last service appears, and work registered
   * inside it (through `child.effect`) is disposed with it.
   *
   * The callback's receipts are additional properties on the child context, so the
   * caller names them in the array and reads them by name.
   * @param names - service names that must all be present.
   * @param callback - runs when they are; its registrations follow their lifetime.
   * @returns the disposer, which cancels the wait or the registration.
   */
  inject(names: readonly ['contextMenus'], callback: (child: ClientContext & {
    readonly contextMenus: ContextMenusService
  }) => void): () => void
  /**
   * A Client service by name, when this shell provides it.
   *
   * Fine for a service this plugin can live without and whose absence is decided at
   * activation (a shell that has no Workspace domain, say). For anything that may
   * appear later, use {@link inject}.
   */
  get(name: 'uiWorkspace'): UiWorkspaceService | undefined
  get(name: 'layout'): LayoutService | undefined
  get(name: 'contextMenus'): ContextMenusService | undefined
  get(name: string): unknown
}
