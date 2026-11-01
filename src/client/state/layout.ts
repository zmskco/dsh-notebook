/**
 * Pane layout: how wide the two draggable columns are.
 *
 * The page draws three regions — the directory column, the manuscript and the
 * conversation — and two boundaries between them. Both boundaries are draggable
 * and neither column has a hide switch any more: the panel is those three
 * regions, so this module is the single place that decides what a drag may do
 * and what survives a reload.
 *
 * Kept free of React and of `localStorage` so the arithmetic can be called
 * directly by the artifact check: the interesting failure here is not visual, it
 * is a drag that starves the manuscript down to nothing, and that is exactly the
 * kind of thing a browser test would make hard to see.
 */

/** The two widths this page stores, and whether the conversation column shows. */
export interface PaneLayout {
  /** Directory column width in px. */
  side: number
  /** Conversation column width in px. */
  chat: number
  /**
   * Whether the conversation column is shown.
   *
   * A *toggle*, not a region model: the column is always mounted (it is what
   * binds the Session for every request the page makes), and this only decides
   * whether it is painted. The switch for it is the icon beside the directory
   * column's heading.
   */
  talking: boolean
}

/** Directory column bounds. */
export const SIDE_MIN = 200
export const SIDE_MAX = 520
/** Conversation column bounds. */
export const CHAT_MIN = 280
export const CHAT_MAX = 900
/**
 * What the manuscript column keeps, whatever the drag asks for.
 *
 * This is the number that makes a drag safe: without it, dragging the
 * conversation column to its own maximum on a narrow window would quietly
 * squeeze the prose the author is reading down to zero.
 */
export const PROSE_MIN = 360

/** Opening widths. 300 keeps the three create buttons on one line. */
export const DEFAULT_LAYOUT: PaneLayout = { side: 300, chat: 400, talking: true }

/** Storage key, namespaced like the remembered story so it cannot collide. */
const KEY = 'dsh-notebook:layout'

/**
 * Fit a width into its bounds.
 * @param value - the wanted width; anything non-finite falls back to `min`.
 * @param min - the smallest allowed width.
 * @param max - the largest allowed width, ignored when below `min`.
 * @returns a whole number of px inside the bounds.
 */
export function clampPane(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.round(value), min), Math.max(min, max))
}

/**
 * How wide a region may become without eating the rest of the row.
 * @param total - the measured width of the row, in px.
 * @param reserved - what the row must still hold besides this region.
 * @param min - the floor, returned when `total` is unusable.
 * @returns the ceiling in px, never below `min`.
 */
export function paneCeiling(total: number, reserved: number, min: number): number {
  if (!Number.isFinite(total) || total <= 0) return min
  return Math.max(min, total - reserved)
}

/**
 * Apply a drag.
 *
 * `next` is the width the drag asked for, before any bound: the caller clamps
 * nothing, because only this function knows what the rest of the row needs.
 * Whichever boundary is dragged, the manuscript keeps {@link PROSE_MIN} — that
 * is the whole promise of this function.
 * @param layout - the layout as it stands.
 * @param which - the boundary being dragged: the one before or after the prose.
 * @param next - the wanted width in px, unclamped.
 * @param total - the measured row width; `0` when it could not be measured.
 * @returns the layout to render.
 */
export function resizePane(
  layout: PaneLayout,
  which: 'side' | 'chat',
  next: number,
  total: number,
): PaneLayout {
  // The dragged column competes with the other one; either way the manuscript
  // keeps PROSE_MIN, since it is what both boundaries are protecting.
  const reserved = PROSE_MIN + (which === 'side' ? layout.chat : layout.side)
  if (which === 'side') {
    const bound = Math.min(SIDE_MAX, paneCeiling(total, reserved, SIDE_MIN))
    return { ...layout, side: clampPane(next, SIDE_MIN, bound) }
  }
  const bound = Math.min(CHAT_MAX, paneCeiling(total, reserved, CHAT_MIN))
  return { ...layout, chat: clampPane(next, CHAT_MIN, bound) }
}

/**
 * Read a stored layout.
 *
 * Tolerant on purpose: this value can come from an older build, from a
 * hand-edited console, or from another tab mid-upgrade, and none of those may
 * stop the panel from rendering. Anything unusable falls back per field; the
 * `prose` flag a build from before the redesign stored is ignored, because there
 * is no longer a manuscript column to hide.
 * @param raw - the stored JSON, if any.
 * @returns the layout to start from.
 */
export function readLayout(raw: string | null | undefined): PaneLayout {
  if (typeof raw !== 'string' || raw.length === 0) return DEFAULT_LAYOUT
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_LAYOUT
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return DEFAULT_LAYOUT
  const value = parsed as Partial<Record<keyof PaneLayout, unknown>>
  return {
    side: typeof value.side === 'number' ? clampPane(value.side, SIDE_MIN, SIDE_MAX) : DEFAULT_LAYOUT.side,
    chat: typeof value.chat === 'number' ? clampPane(value.chat, CHAT_MIN, CHAT_MAX) : DEFAULT_LAYOUT.chat,
    talking: typeof value.talking === 'boolean' ? value.talking : DEFAULT_LAYOUT.talking,
  }
}

/**
 * Show or hide the conversation column.
 * @param layout - the layout as it stands.
 * @returns the layout with the column flipped.
 */
export function toggleTalking(layout: PaneLayout): PaneLayout {
  return { ...layout, talking: !layout.talking }
}

/**
 * The stored layout, if storage is usable at all.
 * @returns the layout to start from.
 */
export function loadLayout(): PaneLayout {
  try {
    return readLayout(globalThis.localStorage?.getItem(KEY))
  } catch {
    return DEFAULT_LAYOUT
  }
}

/**
 * Store a layout.
 *
 * Called after a drag settles rather than on every move: this write is
 * synchronous, and a pointermove fires dozens of times a second.
 * @param layout - the layout to remember.
 */
export function saveLayout(layout: PaneLayout): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(layout))
  } catch {
    // Storage can be unavailable — disabled, full, or an opaque origin. Pane
    // widths are a convenience; failing to store them must not break a page that
    // otherwise works.
  }
}
