/**
 * The writing surface's typography and paper, and the rules for reading them back.
 *
 * Three independent choices: the typeface, the text size, and the paper the
 * manuscript is drawn on. They are the author's, not the profile's, so they live
 * in `localStorage` next to the pane widths and the remembered story.
 *
 * **The four typefaces are font stacks, not bundled files.** Shipping 宋体 /
 * 思源黑体 / 霞鹜文楷 / 阿里巴巴普惠体 as web fonts would mean megabytes of binary
 * in a plugin bundle — and redistribution terms that differ per family (霞鹜文楷 is
 * OFL, 阿里巴巴普惠体 is free for commercial use under Alibaba's own terms, 宋体 is
 * not redistributable at all). So each choice names the family and its common
 * installations, longest-name first, and falls back to a system face of the same
 * class: an author who has the font installed gets it, and one who does not gets a
 * serif or sans face rather than a broken layout.
 *
 * Pure and free of React, so the artifact check calls it directly.
 */

/** A typeface the author can pick. */
export type FontId = 'system' | 'song' | 'kai' | 'puhuiti'

/**
 * The paper the whole panel is drawn on.
 *
 * Four names the author chose: 简白 (plain white), 雅致 (warm off-white),
 * 黑夜 (night), 绿荫 (green shade). There is no "follow the interface theme"
 * entry any more — the paper is the panel's own look, and it runs from the
 * directory column to the conversation column.
 */
export type PaperId = 'plain' | 'elegant' | 'night' | 'green'

/** What the writing surface remembers. */
export interface EditorPrefs {
  font: FontId
  /** Text size in px. */
  size: number
  paper: PaperId
}

/** Text-size bounds: small enough to fit a short window, large enough to read. */
export const SIZE_MIN = 13
export const SIZE_MAX = 24

/** Size offered by the picker, so the control and the clamp agree. */
export const SIZE_STEPS: number[] = [13, 14, 15, 16, 17, 18, 19, 20, 22, 24]

/** Opening state: a sans face at the interface's own size, on 简白. */
export const DEFAULT_PREFS: EditorPrefs = { font: 'system', size: 15, paper: 'plain' }

/**
 * The families behind each choice, as a CSS `font-family` value.
 *
 * The order is the order a browser will try them: the localised family names
 * (which is how the CJK faces register on Windows) before the Latin ones, and a
 * generic family last so the text is never drawn in the wrong script's default.
 *
 * `system` is the 黑体 class on both platforms — Microsoft YaHei on Windows,
 * PingFang SC on macOS — which is why the picker calls it 黑.
 */
export const FONT_STACKS: Record<FontId, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
  song: '"SimSun", "宋体", "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif',
  kai: '"LXGW WenKai", "LXGW WenKai Screen", "霞鹜文楷", "Kaiti SC", "KaiTi", "STKaiti", serif',
  puhuiti: '"Alibaba PuHuiTi 3.0", "Alibaba PuHuiTi", "AlibabaPuHuiTi-3-55-Regular", "阿里巴巴普惠体", "Microsoft YaHei", "PingFang SC", sans-serif',
}

/**
 * The font picker's entries, in the order they are offered.
 *
 * Source Han Sans used to be its own entry; it is the same class of face as the
 * system default (and half the machines running this have neither installed), so
 * the author asked for it to go and for the default to be named for what it is.
 */
export const FONT_IDS: FontId[] = ['system', 'song', 'kai', 'puhuiti']

/** The paper picker's entries, in the order they are offered. */
export const PAPER_IDS: PaperId[] = ['plain', 'elegant', 'night', 'green']

/**
 * Paper names this build used to store, and what they are now.
 *
 * `auto` meant "follow the interface theme"; the author asked for four concrete
 * papers instead, so it lands on the plain white one. The rest are renames with
 * the same intent.
 */
const LEGACY_PAPERS: Record<string, PaperId> = {
  auto: 'plain',
  light: 'elegant',
  dark: 'night',
}

/** Storage key, namespaced like the pane layout. */
const KEY = 'dsh-notebook:editor'

/**
 * Fit a size into its bounds.
 * @param value - the wanted size; anything non-finite falls back to the default.
 * @returns a whole number of px inside the bounds.
 */
export function clampSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PREFS.size
  return Math.min(Math.max(Math.round(value), SIZE_MIN), SIZE_MAX)
}

/**
 * Read stored preferences.
 *
 * Tolerant for the same reason the pane layout is: this value can come from an
 * older build, a hand-edited console, or another tab mid-upgrade, and none of
 * those may stop the editor from opening. Anything unusable falls back per field.
 * @param raw - the stored JSON, if any.
 * @returns the preferences to start from.
 */
export function readPrefs(raw: string | null | undefined): EditorPrefs {
  if (typeof raw !== 'string' || raw.length === 0) return DEFAULT_PREFS
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_PREFS
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return DEFAULT_PREFS
  const value = parsed as Partial<Record<keyof EditorPrefs, unknown>>
  const storedPaper = typeof value.paper === 'string' ? value.paper : ''
  return {
    font: typeof value.font === 'string' && (FONT_IDS as string[]).includes(value.font) ? value.font as FontId : DEFAULT_PREFS.font,
    size: typeof value.size === 'number' ? clampSize(value.size) : DEFAULT_PREFS.size,
    paper: (PAPER_IDS as string[]).includes(storedPaper)
      ? storedPaper as PaperId
      // A paper stored by an older build keeps its meaning under the new name.
      : LEGACY_PAPERS[storedPaper] ?? DEFAULT_PREFS.paper,
  }
}

/**
 * The stored preferences, if storage is usable at all.
 * @returns the preferences to start from.
 */
export function loadPrefs(): EditorPrefs {
  try {
    return readPrefs(globalThis.localStorage?.getItem(KEY))
  } catch {
    return DEFAULT_PREFS
  }
}

/**
 * Store preferences.
 *
 * Called per change rather than per keystroke: these controls are clicked, not
 * dragged, so the write is rare and there is nothing to coalesce.
 * @param prefs - what to remember.
 */
export function savePrefs(prefs: EditorPrefs): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Storage can be unavailable — disabled, full, or an opaque origin. Losing
    // the typeface is a nuisance; a page that will not render because of it is a
    // bug.
  }
}
