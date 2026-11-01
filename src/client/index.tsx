/**
 * Client entry: register the sidebar entry and the studio panel.
 *
 * `factory(require)` returns this module's exports, and the module system hands
 * that object to the plugin loader — so the named `apply` and `inject` exports
 * below are the plugin, exactly as the shipped dynamic-bundle examples return
 * their plugin object from the factory.
 *
 * Both registrations go through `ctx.slots.inject`, whose callback re-runs when
 * the owning declaration appears: the sidebar and the layout may declare their
 * slots before or after this bundle materializes, and injection is what makes
 * that ordering irrelevant.
 */
import { ConversationPane, CHAT_SLOT } from './studio/ConversationPane'
import { PanelIcon } from './glyphs'
import { NotebookPage } from './studio/NotebookPage'
import { DICTS, NS, zh } from './strings'
import type { ClientContext } from './dsh'

// Re-exported for the artifact check. Directory navigation, the pane arithmetic
// and the editor model are all pure where it matters, so the bundle check calls
// them directly instead of reaching them through a render it cannot drive: the
// fake React renders one branch, and these live behind a click or behind `state`.
export { ancestorsOf, breadcrumb, buildTree, childDirectories, childFiles, countFiles, formatBytes, isDirectoryPath, parentOf, pathSegments, PROJECT_ROOT } from './state/file-tree'
export { AUTOSAVE_MS, NotebookTab } from './studio/NotebookTab'
// The markdown reader, which decides what the text is (and what may never become
// a link or markup), plus the mode helpers the source/rendered toggle is built from.
export { editorControls, initialEditorMode, isMarkdownPath, nextEditorMode, parseMarkdown } from './state/markdown'
// The document model: markdown in, markdown out, with ProseMirror in between.
export { documentFromMarkdown, markdownFromDocument, schema } from './state/pm-document'
export { editorKeyBindings, Wysiwyg } from './studio/Wysiwyg'
export {
  clampSize,
  DEFAULT_PREFS,
  FONT_IDS,
  FONT_STACKS,
  loadPrefs,
  PAPER_IDS,
  readPrefs,
  savePrefs,
  SIZE_STEPS,
} from './state/editor-prefs'
// The dictionaries, so the artifact check can compare the name the panel draws
// with the name the locale metadata hands to DSH's plugin inventory.
export { DICTS, en, zh } from './strings'
export { conversationShell, ConversationPane, CHAT_SLOT } from './studio/ConversationPane'
// The pane arithmetic, for the same reason: a drag cannot be driven by the stub
// render, and "the manuscript keeps its minimum width" is not a visual detail.
export {
  clampPane,
  DEFAULT_LAYOUT,
  loadLayout,
  paneCeiling,
  readLayout,
  resizePane,
  saveLayout,
  toggleTalking,
} from './state/layout'

/** Must match the `main` key and the `sidebar.panellist` id, which address each other. */
const PANEL_ID = 'notebook'

/** Sidebar position: after the shipped Plugins (0) and Tasks (10) entries. */
const PANEL_ORDER = 12

/** Cordis services this half needs before it activates. */
export const inject = ['slots', 'locale']

/**
 * Translate a sidebar label.
 *
 * The label is read at render time, so binding on each call is what keeps it in
 * step with a locale switch. A seat that throws or does not know the key falls
 * back to the bundled Chinese table rather than showing a raw key.
 */
function label(ctx: ClientContext, key: keyof typeof zh): string {
  try {
    const value = ctx.locale.bind(NS)(key)
    if (typeof value === 'string' && value.length > 0 && value !== key) return value
  } catch {
    // Fall through to the bundled table.
  }
  return zh[key]
}

/**
 * Register the Client half.
 * @param ctx - the Client context; registrations are effects of it.
 */
export function apply(ctx: ClientContext): void {
  for (const [locale, dict] of Object.entries(DICTS)) {
    ctx.effect(() => ctx.locale.register(NS, locale, dict), `notebook: locale ${locale}`)
  }

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: PANEL_ORDER,
    locale: NS,
    label: () => label(ctx, 'panel'),
  }, PanelIcon))

  // The studio page declares one child slot of its own, `scope: session-maybe`,
  // and renders it beside the manuscript. That declaration is what gives the
  // child a live Session context — the renderer supplies it for a non-root child
  // — and therefore what lets the embedded Conversation resolve the current
  // Session. Without it, `conversation.content` would render an empty shell.
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    children: { [CHAT_SLOT]: { kind: 'single', scope: 'session-maybe' } },
  }, NotebookPage))

  // Injected rather than registered inline: `inject` re-runs when the child
  // declaration appears, so the two registrations cannot race regardless of which
  // order this plugin and the shell materialize in.
  ctx.slots.inject(CHAT_SLOT, () => ctx.slots.register({ name: CHAT_SLOT, locale: NS }, ConversationPane))
}
