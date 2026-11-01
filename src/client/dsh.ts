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

export interface ClientContext {
  readonly slots: SlotsService
  readonly locale: LocaleService
  effect(callback: () => (() => void) | void, label?: string): () => void
  /**
   * A Client service by name, when this shell provides it.
   *
   * The optional form rather than a property access or an `inject` entry: this
   * plugin must activate and draw its panel in a shell that has no Workspace
   * domain, and only the control that needs the service should disappear with it.
   * Resolved per call, so a service registered after this bundle still counts.
   */
  get(name: 'uiWorkspace'): UiWorkspaceService | undefined
  get(name: 'layout'): LayoutService | undefined
  get(name: string): unknown
}
