/**
 * The panel's icons.
 *
 * **One set: [Lucide](https://lucide.dev) (ISC licence).** Every glyph is a
 * 24×24 stroke drawing — `fill: none`, `stroke: currentColor`, 2px stroke, round
 * caps and joins — so the tree, the heading and the sidebar all read as one
 * family, and an icon can be swapped for another Lucide name without a redraw.
 *
 * They are inlined as path data rather than imported from the package: the client
 * bundle has no runtime dependency outside React (see `check:client`), and Lucide
 * ships hundreds of kilobytes of components for the six shapes this panel needs.
 *
 * Sizes are one number, not six: {@link GLYPH_SIZE} for everything inside the
 * panel (so a folder row and the buttons above it are the same height), and one
 * slightly larger size for the sidebar entry, which the shell draws on its own
 * scale. Stroke width is never adjusted per size — scaling the whole 24-grid is
 * what keeps the weight consistent.
 */
import * as React from 'react'

/** The edge length every in-panel glyph uses. */
export const GLYPH_SIZE = 16

/**
 * The attributes every glyph shares.
 *
 * `strokeWidth: 2` is Lucide's own default, which is what makes these shapes look
 * like the rest of the interface; a thinner stroke at a small size reads as
 * broken, not delicate.
 */
const GLYPH_BASE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
  style: { display: 'block' },
}

/** One glyph, drawn on the shared grid. */
function Glyph({ size = GLYPH_SIZE, children }: {
  size?: number
  children?: React.ReactNode
}): React.ReactElement {
  return React.createElement('svg', { ...GLYPH_BASE, width: size, height: size }, children)
}

export interface PanelIconProps {
  /** Edge length in px. The sidebar draws it at its own scale. */
  size?: number
}

/**
 * The plugin's own mark: Lucide's `notebook`.
 *
 * A bound notebook is what the product is called and what it does — the same
 * drawing the package ships as `icon.svg`, so the sidebar entry and the inventory
 * card cannot drift apart.
 */
export function PanelIcon({ size = 18 }: PanelIconProps): React.ReactElement {
  return React.createElement(Glyph, { size },
    React.createElement('path', { d: 'M2 6h4' }),
    React.createElement('path', { d: 'M2 10h4' }),
    React.createElement('path', { d: 'M2 14h4' }),
    React.createElement('path', { d: 'M2 18h4' }),
    React.createElement('rect', { width: 16, height: 20, x: 4, y: 2, rx: 2 }),
    React.createElement('path', { d: 'M16 2v20' }))
}

export interface FolderIconProps {
  /** Whether the directory is showing its children; the artwork opens with it. */
  open?: boolean
  /** Edge length in px. */
  size?: number
}

/**
 * A directory, open or closed: Lucide's `folder` / `folder-open`.
 *
 * The open state is what replaced the leading disclosure triangle. A caret is a
 * second mark saying the same thing the folder beside it already says, and on a
 * narrow row the two read as two controls; here the folder itself is the control
 * and its opening is the state — the children underneath say the rest.
 */
export function FolderIcon({ open = false, size = GLYPH_SIZE }: FolderIconProps): React.ReactElement {
  // Open: the flap folded out in front of the folder's back.
  const openArt = React.createElement('path', {
    d: 'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',
  })
  // Closed: one panel with a tab.
  const closedArt = React.createElement('path', {
    d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  })
  return React.createElement(Glyph, { size }, open ? openArt : closedArt)
}

export interface FileIconProps {
  /** Edge length in px. */
  size?: number
}

/**
 * One file in the tree: Lucide's `file`.
 *
 * Paired with {@link FolderIcon} so a row says what it is before its name is
 * read — a tree where only one kind of row carried artwork would read as if the
 * other kind were something else.
 */
export function FileIcon({ size = GLYPH_SIZE }: FileIconProps): React.ReactElement {
  return React.createElement(Glyph, { size },
    React.createElement('path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }),
    React.createElement('path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }))
}

export interface PlusIconProps {
  /** Edge length in px. */
  size?: number
}

/**
 * The two create actions in the directory column's heading: Lucide's
 * `folder-plus` and `file-plus`.
 *
 * They sit at the right end of the heading, immediately before the conversation
 * switch, so everything that changes what is on screen is in one place.
 */
export function FolderPlusIcon({ size = GLYPH_SIZE }: PlusIconProps): React.ReactElement {
  return React.createElement(Glyph, { size },
    React.createElement('path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }),
    React.createElement('path', { d: 'M12 10v6' }),
    React.createElement('path', { d: 'M9 13h6' }))
}

/** A file with a plus; see {@link FolderPlusIcon}. */
export function FilePlusIcon({ size = GLYPH_SIZE }: PlusIconProps): React.ReactElement {
  return React.createElement(Glyph, { size },
    React.createElement('path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }),
    React.createElement('path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }),
    React.createElement('path', { d: 'M9 15h6' }),
    React.createElement('path', { d: 'M12 18v-6' }))
}

/**
 * Re-read the tree: Lucide's `refresh-cw`.
 *
 * The directory is the outside world's view of the workspace — the model or
 * another editor can write into it while the panel is open — so a plain way
 * to ask "what is there now" belongs beside the two creates.
 */
export function RefreshIcon({ size = GLYPH_SIZE }: PlusIconProps): React.ReactElement {
  return React.createElement(Glyph, { size },
    React.createElement('path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }),
    React.createElement('path', { d: 'M21 3v5h-5' }),
    React.createElement('path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }),
    React.createElement('path', { d: 'M8 16H3v5' }))
}

/**
 * Show the workspace in the operating system's file manager: Lucide's
 * `external-link`.
 *
 * The arrow leaving a frame is what says "this opens outside the app" — the
 * folder glyphs in the tree already mean "a folder in here", so reusing one would
 * promise the wrong thing.
 */
export function RevealIcon({ size = GLYPH_SIZE }: PlusIconProps): React.ReactElement {
  return React.createElement(Glyph, { size },
    React.createElement('path', { d: 'M15 3h6v6' }),
    React.createElement('path', { d: 'M10 14 21 3' }),
    React.createElement('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }))
}

export interface ChatIconProps {
  /** Edge length in px. */
  size?: number
}

/**
 * The conversation column's toggle: Lucide's `message-square`.
 *
 * A conversation, not a pane: the glyph is what the column holds, which is why it
 * is the same picture a chat bubble would use everywhere else.
 */
export function ChatIcon({ size = GLYPH_SIZE }: ChatIconProps): React.ReactElement {
  return React.createElement(Glyph, { size },
    React.createElement('path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }))
}
