/**
 * View primitives and the plugin stylesheet.
 *
 * The stylesheet is rendered as a React element rather than fetched, so
 * unmounting the page removes it, and every colour is a `--dsw-alias-*` theme
 * token rather than a literal: a renamed token degrades the appearance but
 * cannot break rendering, and light/dark switching keeps working for free.
 *
 * DSH's own primitives are deliberately not imported. A plain-JS plugin has no
 * type check against them, they change without notice, and a throwing component
 * blanks the whole slot entry — so the few controls this page needs are written
 * here against copied markup and token styling.
 */
import * as React from 'react'

const CSS = `
.dsh-notebook-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.dsh-notebook-spacer{flex:1}
.dsh-notebook-body{flex:1;min-height:0;display:flex}
.dsh-notebook-pane{display:flex;flex-direction:column;min-height:0;min-width:0}
/* The directory column: a fixed heading over its own scrolling list, the same shape
   as the editor beside it. The heading must not scroll away — it carries the create
   and refresh controls — so the column does not scroll; the list does. That is also
   what lets the heading's rule meet the editor toolbar's on one line.
   The right border is the *only* line between the tree and the manuscript; the grip
   beside it fills the header band's own segment so the rule above does not break. */
.dsh-notebook-side{width:var(--ns-side,268px);flex:0 1 auto;min-width:170px;border-right:1px solid var(--dsw-alias-border-l1);overflow:hidden}
/* The editor column does **not** scroll: the head above its page is a fixed band, and
   a scrolling column would carry that band away with the text. What scrolls is the
   page inside it (the ProseMirror host, or the source textarea). */
.dsh-notebook-main{flex:1;min-width:0;overflow:hidden}
/* The drag handle sits between two regions and *is* their separator, so it is
   transparent until touched rather than a second line beside the borders.
   Its other job is the one the eye notices first: the handle's 6px is a *gap* in the
   header rule that runs across the panel, so it carries that one pixel itself. Each
   column draws its own segment (the directory heading's and the toolbar's, both 44px
   tall); this fills the strip between them and the line is unbroken. */
.dsh-notebook-grip{flex:none;width:6px;cursor:col-resize;background:transparent;align-self:stretch;position:relative}
.dsh-notebook-grip::after{content:'';position:absolute;left:0;right:0;top:43px;height:1px;background:var(--dsw-alias-border-l1);pointer-events:none}
.dsh-notebook-grip:hover,.dsh-notebook-grip:focus-visible,.dsh-notebook-grip[data-active="true"]{background:var(--dsw-alias-border-l2);outline:none}
body.dsh-notebook-grabbing{user-select:none;cursor:col-resize}
.dsh-notebook-chat{width:var(--ns-chat,400px);flex:0 1 auto;min-width:220px;min-height:0;display:flex;flex-direction:column;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.dsh-notebook-chatBody{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
/* Hiding the conversation column is a paint decision, never a mount decision: the
   embedded conversation is the only thing on the page holding a Session seat
   (bindSession runs in its render), so unmounting it would make every request
   arrive without session= and be answered from the deployment fallback root
   instead of the workspace the operator opened. */
.dsh-notebook-body[data-talking="off"] .dsh-notebook-chat{display:none}
/* The panel's one title row.
   Both columns open with a band of the same height whose bottom rule is at the same
   offset, so the directory heading and the editor's toolbar read as one line across
   the panel — and the drag handle between them carries its own 1px of that line, so
   there is no gap where the grips are. 44px is the number both the directory heading
   and the editor toolbar use, and the grip puts its rule at top 43px to match;
   changing one means changing all three. */
.dsh-notebook-section{display:flex;align-items:center;flex:none;height:44px;box-sizing:border-box;padding:0 10px 0 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsh-notebook-section .dsh-notebook-row{flex:1;min-width:0;gap:2px}
/* The heading is the panel's name: small caps carry it, not size or colour — the
   column below is what the eye is for. It gives way before the six controls do, and
   it does so by truncating rather than by wrapping: the band is a fixed 44px, so a
   wrapped name would be clipped instead of shown. The column's own floor (SIDE_MIN)
   is set high enough that this never actually bites. */
.dsh-notebook-sectionTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.02em;margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* A heading icon is the glyph and 4px of padding — 24px square, six of them plus
   the name fitting the column's own minimum. */
.dsh-notebook-section button.dsh-notebook-btn[data-variant="icon"]{flex:none}
.dsh-notebook-row{display:flex;align-items:center;gap:8px}
.dsh-notebook-rowWrap{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-notebook-col{display:flex;flex-direction:column;gap:6px}
.dsh-notebook-grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
button.dsh-notebook-btn{font:inherit;padding:4px 12px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
button.dsh-notebook-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}
button.dsh-notebook-btn:disabled{opacity:.45;cursor:default}
button.dsh-notebook-btn[data-variant="primary"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
button.dsh-notebook-btn[data-variant="ghost"]{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}
button.dsh-notebook-btn[data-variant="ghost"]:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border-color:transparent}
/* The option currently in force in a picker row (one typeface, one paper). Marked
   with the brand colour and a border rather than with a filled block: several of
   these sit side by side, and a row of filled buttons would compete with the
   actions beside them. */
button.dsh-notebook-btn[data-selected="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:600}
button.dsh-notebook-btn[data-selected="true"]:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
/* A rule between the picker groups (faces | size | paper | actions). */
.dsh-notebook-divider{width:1px;height:16px;background:var(--dsw-alias-border-l1);flex:none;margin:0 2px}
/* Bright but visibly lighter than the primary variant, so a cancel sitting next
   to a create never competes with it for the eye. Fills in on hover. */
button.dsh-notebook-btn[data-variant="secondary"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:600}
button.dsh-notebook-btn[data-variant="secondary"]:hover:not(:disabled){background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
/* Icon-only buttons: square, no text padding, and the glyph is the button. */
button.dsh-notebook-btn[data-variant="icon"]{padding:4px;line-height:0;color:var(--dsw-alias-label-secondary);background:transparent;border-color:transparent}
button.dsh-notebook-btn[data-variant="icon"]:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
/* The one destructive control in the panel: filled with the error colour, because a
   delete button that looks like every other button is a delete button you press by
   accident. */
button.dsh-notebook-btn[data-variant="danger"]{background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-bg-base);font-weight:600}
button.dsh-notebook-btn[data-variant="danger"]:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary);filter:brightness(1.08)}
.dsh-notebook-input,.dsh-notebook-textarea,.dsh-notebook-select{font:inherit;width:100%;box-sizing:border-box;padding:5px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
/* The width:100% above is for a field stacked under its label. Placed directly in
   a row it claims the whole line, and since the row wraps, the buttons beside it
   land underneath. In a row the control sizes itself instead. */
.dsh-notebook-rowWrap > .dsh-notebook-input,.dsh-notebook-rowWrap > .dsh-notebook-select{width:auto;flex:1 1 160px;min-width:140px}
.dsh-notebook-input:focus,.dsh-notebook-textarea:focus,.dsh-notebook-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
/* One monospace stack for the three places that show machine text: the textarea a
   manuscript is written in, the remedy block, and an inline identifier. */
.dsh-notebook-textarea,.dsh-notebook-warnBody,.dsh-notebook-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dsh-notebook-textarea{resize:vertical;font-size:12.5px;line-height:1.7}
.dsh-notebook-field{display:flex;flex-direction:column;gap:3px;min-width:0}
/* A field's label and a hint line are the same small secondary text; only their
   position differs, so they share one declaration. */
.dsh-notebook-label,.dsh-notebook-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.dsh-notebook-list{list-style:none;margin:0;padding:6px}
/* The list scrolls **vertically only**, and that is a correctness rule rather than
   a look. Depth is drawn as left padding on the row (see rowIndent in
   state/file-tree), and the row is width:100% of its <li>: with content-box sizing
   each extra level made the row that much *wider* than the list, so the list became
   horizontally scrollable. An inline row (new file, new folder, rename) is
   autofocused, and focusing an element wider than its scroller makes the browser
   scroll it into view — which slid the tree left by the depth of the row and pushed
   its icon out under the column's edge. border-box keeps the indent inside the
   row's own width, and clip on the x axis means there is no horizontal scroll
   position for focus to move, whatever a future row does. */
.dsh-notebook-list.dsh-notebook-scroll{overflow-x:clip}
.dsh-notebook-item{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:5px 8px;border-radius:6px;border:1px solid transparent;background:transparent;color:inherit;font:inherit;cursor:pointer}
.dsh-notebook-item:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-notebook-item[data-active="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1);font-weight:600;box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
/* A folder that new files will land in. Quieter than the open file on purpose:
   it is a destination, not a selection, and two rows at the same weight read as
   two selected things. */
.dsh-notebook-item[data-target="true"]{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 2px 0 0 var(--dsw-alias-border-l2)}
.dsh-notebook-item[data-target="true"] .dsh-notebook-itemName{color:var(--dsw-alias-label-primary)}
/* The empty row a new folder or file is named in. It sits exactly where the thing
   will appear, so the gesture has one place on screen instead of two. */
.dsh-notebook-item.dsh-notebook-ghost{cursor:text;background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1)}
.dsh-notebook-ghostInput{flex:1;min-width:0;font:inherit;color:inherit;background:transparent;border:0;outline:none;padding:0}
.dsh-notebook-ghostInput::placeholder{color:var(--dsw-alias-label-secondary)}
.dsh-notebook-itemName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The tree's type artwork: Material Icon Theme's own colorful drawing for the
   file or folder (see icons/material.tsx). It is inline SVG, so the box is sized
   and the drawing fills it; nothing here recolours it — these icons carry their
   own palette, which is exactly what makes a tree read at a glance. */
.dsh-notebook-treeIcon{flex:none;display:block;line-height:0}
.dsh-notebook-treeIcon svg{display:block;width:100%;height:100%}
/* The theme's palette is drawn for a light editor surface, and a few of its marks
   are pale — the json yellow and table green sit at roughly 2:1 against 简白's
   white. They never carry the row on their own (the name is always beside them),
   so this is a hairline shadow on the dark-on-light papers only: it detaches the
   pale shapes from the paper without recolouring the artwork. 黑夜 already has
   5:1 and up, so it keeps the drawings exactly as the theme ships them. */
.dsh-notebook-root[data-paper="plain"] .dsh-notebook-treeIcon svg,
.dsh-notebook-root[data-paper="elegant"] .dsh-notebook-treeIcon svg,
.dsh-notebook-root[data-paper="green"] .dsh-notebook-treeIcon svg{filter:drop-shadow(0 0 .5px var(--dsh-notebook-paper-soft))}
/* The refresh icon turns while a re-read is in flight: the click is answered
   immediately even when the walk takes a moment. */
@keyframes dsh-notebook-spin{to{transform:rotate(360deg)}}
button.dsh-notebook-btn[data-busy="true"] svg{animation:dsh-notebook-spin .9s linear infinite}
@media (prefers-reduced-motion:reduce){button.dsh-notebook-btn[data-busy="true"] svg{animation:none}}
.dsh-notebook-count{font-size:11.5px;color:var(--dsw-alias-label-secondary);flex:none}
/* The sidebar's directory browser: a breadcrumb strip over a scrolling listing.
   Rows reuse the .dsh-notebook-item rules above, so only the trail needs its own. */
.dsh-notebook-scroll{flex:1;min-height:0;overflow:auto}
.dsh-notebook-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:8px}
.dsh-notebook-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.dsh-notebook-shot{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);display:flex;gap:12px;padding:10px 12px}
.dsh-notebook-thumb{width:104px;flex:none;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);aspect-ratio:2/3;object-fit:cover;display:block}
.dsh-notebook-thumbEmpty{display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-state-idle-primary);font-size:11px}
.dsh-notebook-badge{font-size:11px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsh-notebook-badge[data-state="done"]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dsh-notebook-badge[data-state="failed"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dsh-notebook-badge[data-state="running"]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dsh-notebook-error{color:var(--dsw-alias-state-error-primary);font-size:12px;padding:8px 10px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:6px;background:var(--dsw-alias-bg-layer-1)}
.dsh-notebook-warn{border:1px solid var(--dsw-alias-state-warn-primary);border-radius:6px;background:var(--dsw-alias-bg-layer-1);padding:9px 11px;display:flex;flex-direction:column;gap:6px}
.dsh-notebook-warnTitle{color:var(--dsw-alias-state-warn-primary);font-size:12px;font-weight:600}
.dsh-notebook-warnBody{margin:0;white-space:pre-wrap;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dsh-notebook-empty{flex:1;padding:24px 16px;color:var(--dsw-alias-label-secondary);font-size:12.5px}
/* A row whose file the editor cannot open. The row stays — a hidden file reads as a
   lost file — but the name is quieter and its right-hand note says why, so the
   click is explained before it happens. */
.dsh-notebook-item[data-binary="true"] .dsh-notebook-itemName{color:var(--dsw-alias-label-secondary)}
.dsh-notebook-item[data-binary="true"] .dsh-notebook-count{font-variant-numeric:tabular-nums}
/* The page that takes the click's place when the chosen file cannot be previewed.
   It is not an error: nothing failed, the format is simply not one the page draws. */
.dsh-notebook-notice{border:1px solid var(--dsw-alias-state-warn-primary);border-radius:6px;background:var(--dsw-alias-bg-layer-1);padding:9px 11px;display:flex;flex-direction:column;gap:4px}
.dsh-notebook-unsupportedTitle{font-size:12.5px;font-weight:600;color:var(--dsw-alias-state-warn-primary)}
.dsh-notebook-unsupportedBody{font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary);max-width:52ch;overflow-wrap:anywhere}
.dsh-notebook-unsupportedPath{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
/* The tree stopped at the Host's entry cap: a band above the list, not a modal —
   the rows below are still usable. */
.dsh-notebook-truncated{flex:none;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.dsh-notebook-truncated .dsh-notebook-warnTitle{color:var(--dsw-alias-state-warn-primary);margin-bottom:2px}
/* The delete confirmation: the panel's only modal, because it guards the only
   operation typing cannot undo. The scrim is the paper darkened rather than a black
   veil, so the panel does not flash to grey on a dark paper. */
.dsh-notebook-scrim{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,transparent)}
.dsh-notebook-dialog{display:flex;flex-direction:column;gap:10px;box-sizing:border-box;width:min(420px,100%);padding:16px 18px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);box-shadow:0 12px 32px rgba(0,0,0,.18)}
.dsh-notebook-dialogTitle{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--dsw-alias-state-error-primary)}
.dsh-notebook-dialogBody{margin:0;font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.dsh-notebook-dialogNote{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}
/* The destructive button is on the right, past the safe one: reading order leads the
   hand away from it. */
.dsh-notebook-dialogActions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}
.dsh-notebook-progress{height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.dsh-notebook-progress > i{display:block;height:100%;background:var(--dsw-alias-brand-primary)}
.dsh-notebook-chips{display:flex;flex-wrap:wrap;gap:4px}
.dsh-notebook-chip{font-size:11.5px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit}
.dsh-notebook-chip[data-on="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
/* The page region: from the tab band's bottom edge to the column's, with only enough
   padding to keep prose off the edges. No top padding — the tinted band already ends
   there, and a gap would put a strip of paper between the drawn tab and its own text. */
.dsh-notebook-editor{flex:1;min-height:0;box-sizing:border-box;display:flex;flex-direction:column;gap:0;padding:0 0 0;overflow:hidden}
/* The page's own height is the column's, minus the fixed head: a zero minimum here
   is what lets the scrolling host inside it be shorter than its content. */
.dsh-notebook-editorBody{flex:1;min-height:0;display:flex}
.dsh-notebook-grow{flex:1;min-height:0}
/* The editor column is a fixed head over a scrolling page. The head never moves and
   never shrinks: a control that has to be scrolled back to is a control that stops
   being used, and the strip is where the eye goes to change file. Only the page
   below it scrolls, which is also what lets several files stay open without the
   strip drifting away. */
.dsh-notebook-editorHead{flex:none;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}
/* The toolbar is exactly the directory heading's height, on purpose: the two
   columns' rules then land on one unbroken line across the panel (the grips fill
   their own 6px of that line). A fixed height — not a minimum — is what keeps that
   promise when the column is narrow: the pickers scroll sideways inside it instead
   of wrapping onto a second line that the band would clip.
   The row itself does not scroll: the conversation switch is pinned to its right
   edge and must stay visible however narrow the column gets. */
.dsh-notebook-toolbar{display:flex;align-items:center;flex:none;box-sizing:border-box;height:44px;padding:0 12px;gap:10px;border-bottom:1px solid var(--dsw-alias-border-l1);overflow:hidden}
/* The pickers take whatever width is left and scroll inside it; the switch beside
   them keeps its own. Without this split the switch would be the item that scrolls
   out of view — the one control on the band that is not about the document. */
.dsh-notebook-toolbar > .dsh-notebook-typebar{flex:1 1 auto;min-width:0;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;padding:2px 0}
.dsh-notebook-toolbar > .dsh-notebook-typebar::-webkit-scrollbar{height:0}
.dsh-notebook-toolbar > button.dsh-notebook-btn{flex:none}
.dsh-notebook-mainError{padding:8px 14px 0;flex:none}
/* The tab band.
   It is the only tinted strip in the panel, and that tint is the whole trick: the
   drawn tab is painted in the *paper* colour and has no bottom edge, so it opens
   straight into the page below and the two read as one surface. Inactive tabs sit on
   the tint, which is what makes the drawn one look like the top of the editor rather
   than the last thing clicked. Nothing here draws a border — a band whose colour
   simply ends is a quieter boundary than a rule, and the page no longer needs a
   frame of its own (see the .dsh-notebook-doc rule below). */
.dsh-notebook-tabs{display:flex;align-items:flex-end;gap:8px;box-sizing:border-box;min-height:33px;padding:3px 8px 0;background:var(--dsw-alias-bg-layer-1)}
.dsh-notebook-tabList{display:flex;align-items:flex-end;gap:3px;flex:1;min-width:0;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
.dsh-notebook-tabList::-webkit-scrollbar{height:4px}
.dsh-notebook-tabList::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:999px}
/* The drawn file's count and save state: a fixed, non-wrapping group at the right
   end of the strip. It lives here rather than in the toolbar above because the
   toolbar scrolls sideways and a number gaining a digit while the author types must
   never move anything. Centred against the band, since the tabs hang from its
   bottom edge. */
.dsh-notebook-tabMeta{flex:none;display:flex;align-items:center;align-self:center;gap:10px;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
/* A tab is as wide as its name: the strip scrolls, so truncating a long Chinese
   title would hide exactly the characters that tell two tabs apart. The cap is
   generous, only to stop one absurd name from owning the strip.
   Compact on purpose — 28px tall, 6px of horizontal padding — because the band sits
   between two already-dense rows and every pixel here is taken from the writing
   area. */
.dsh-notebook-tab{display:flex;align-items:center;gap:5px;flex:none;max-width:340px;box-sizing:border-box;height:28px;padding:0 4px 0 7px;border:0;border-radius:6px 6px 0 0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;user-select:none}
/* Hover is a hairline ring, not a fill: the band is already a tint, and a second
   tint on top of it is invisible on this sheet (both layer tokens are one colour). */
.dsh-notebook-tab:hover{box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
/* The drawn tab: paper, no bottom edge, and a 2px brand bar along its top. The bar
   is the same mark the file's own row in the tree uses, so "this is the open one" is
   one language across the panel. */
.dsh-notebook-tab[data-active="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:inset 0 2px 0 0 var(--dsw-alias-brand-primary)}
.dsh-notebook-tab[data-active="true"]:hover{box-shadow:inset 0 2px 0 0 var(--dsw-alias-brand-primary),inset 0 0 0 1px var(--dsw-alias-border-l1)}
.dsh-notebook-tabName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* An unsaved tab's dot, shown only on tabs that are *not* drawn: the toolbar's
   未保存 already describes the file on screen, and two marks for one fact in one
   band read as two problems. */
.dsh-notebook-tabDot{flex:none;width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-state-warn-primary)}
/* The close control appears on the drawn tab and on hover: a row of ×'s beside
   every name competes with the names, which is what the strip is for. */
.dsh-notebook-tabClose{flex:none;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;opacity:0;font:inherit;font-size:14px;line-height:1;cursor:pointer}
.dsh-notebook-tab:hover .dsh-notebook-tabClose,.dsh-notebook-tab[data-active="true"] .dsh-notebook-tabClose,.dsh-notebook-tabClose:focus-visible{opacity:.55}
.dsh-notebook-tabClose:hover{opacity:1;background:var(--dsw-alias-bg-layer-2)}
.dsh-notebook-tabClose:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;opacity:1}
/* An open file that is not the drawn tab. Deliberately weaker than the drawn row's
   inset brand bar: "open" is a fact about the tab strip, not a second selection —
   but it does have to be visible, so the name is tinted with the brand colour. */
.dsh-notebook-item[data-open="true"]:not([data-active="true"]) .dsh-notebook-itemName{color:var(--dsw-alias-brand-primary)}
/* The panel's paper. Four palettes the author picks between — 简白, 雅致, 黑夜,
   绿荫 — and the only fixed colours in this sheet: a paper cannot follow the
   interface theme, because it *is* the surface the author wants to look at.
   They are declared as custom properties here and remapped onto the shell's own
   tokens in the rule below, so every surface inside the panel sits on the paper
   without a single component knowing about it.
   The paper also picks the *syntax* palette, and that is what gives the code its
   light and dark halves: 黑夜 is Dracula Classic, the other three are Alucard
   Classic. Choosing 黑夜 is choosing dark; choosing any other paper is light. */
.dsh-notebook-root[data-paper="plain"]{--dsh-notebook-paper-bg:#ffffff;--dsh-notebook-paper-ink:#1b1b1b;--dsh-notebook-paper-soft:#6d6d6d;--dsh-notebook-paper-line:#e6e6e6;--dsh-notebook-paper-layer:#f4f4f4;--dsh-notebook-paper-code:#f5f5f5;--dsh-notebook-paper-brand:#1f1f1f;--dsh-notebook-paper-on:#ffffff;--dsh-notebook-paper-warn:#96560a}
.dsh-notebook-root[data-paper="elegant"]{--dsh-notebook-paper-bg:#faf7f0;--dsh-notebook-paper-ink:#2a2620;--dsh-notebook-paper-soft:#6f675c;--dsh-notebook-paper-line:#e7dfd0;--dsh-notebook-paper-layer:#f3eee3;--dsh-notebook-paper-code:#f2ecdd;--dsh-notebook-paper-brand:#40372a;--dsh-notebook-paper-on:#fdfbf6;--dsh-notebook-paper-warn:#8d5310}
/* 黑夜 carries Dracula Classic. The colours are the theme's own, in the role
   mapping the syntax-colour comment below documents.
   The hl-bg and hl-fg tokens are the scheme's editor background and foreground:
   code is drawn on the surface its author tuned it against, not on the paper. */
.dsh-notebook-root[data-paper="night"]{--dsh-notebook-paper-bg:#14161a;--dsh-notebook-paper-ink:#e8e6e1;--dsh-notebook-paper-soft:#a09d96;--dsh-notebook-paper-line:#2a2d33;--dsh-notebook-paper-layer:#1d2026;--dsh-notebook-paper-code:#1b1e24;--dsh-notebook-paper-brand:#cfcbc2;--dsh-notebook-paper-on:#14161a;--dsh-notebook-paper-warn:#f0b44a;--dsh-notebook-hl-bg:#282a36;--dsh-notebook-hl-fg:#f8f8f2;--dsh-notebook-hl-comment:#6272a4;--dsh-notebook-hl-keyword:#ff79c6;--dsh-notebook-hl-builtin:#8be9fd;--dsh-notebook-hl-literal:#ffb86c;--dsh-notebook-hl-number:#ffb86c;--dsh-notebook-hl-string:#f1fa8c;--dsh-notebook-hl-regexp:#8be9fd;--dsh-notebook-hl-symbol:#bd93f9;--dsh-notebook-hl-title:#50fa7b;--dsh-notebook-hl-attr:#8be9fd;--dsh-notebook-hl-variable:#f8f8f2;--dsh-notebook-hl-meta:#6272a4;--dsh-notebook-hl-operator:#ff79c6;--dsh-notebook-hl-addition:#50fa7b;--dsh-notebook-hl-deletion:#ff5555;--dsh-notebook-hl-link:#8be9fd}
.dsh-notebook-root[data-paper="green"]{--dsh-notebook-paper-bg:#e7f0e2;--dsh-notebook-paper-ink:#1f2a1c;--dsh-notebook-paper-soft:#5f6d59;--dsh-notebook-paper-line:#cfdcc6;--dsh-notebook-paper-layer:#dcebd5;--dsh-notebook-paper-code:#d9e7d0;--dsh-notebook-paper-brand:#2f4326;--dsh-notebook-paper-on:#f3f8ef;--dsh-notebook-paper-warn:#8a5a00}
/* Carrying the paper to everything inside: the shell's surface tokens are
   re-pointed at the paper's shades, so the columns, the tree, the buttons and the
   embedded conversation all sit on it. The brand pairing is re-pointed too — the
   accent and the ink that goes on top of it — because a UI theme's accent is
   chosen against its own surface, and a near-black accent on 黑夜 would vanish. */
.dsh-notebook-root[data-paper]{background:var(--dsh-notebook-paper-bg);color:var(--dsh-notebook-paper-ink);--dsw-alias-bg-base:var(--dsh-notebook-paper-bg);--dsw-alias-label-primary:var(--dsh-notebook-paper-ink);--dsw-alias-label-secondary:var(--dsh-notebook-paper-soft);--dsw-alias-border-l1:var(--dsh-notebook-paper-line);--dsw-alias-border-l2:var(--dsh-notebook-paper-line);--dsw-alias-bg-layer-1:var(--dsh-notebook-paper-layer);--dsw-alias-bg-layer-2:var(--dsh-notebook-paper-layer);--dsw-alias-brand-primary:var(--dsh-notebook-paper-brand);--dsw-alias-label-primary-foreground:var(--dsh-notebook-paper-on);--dsw-alias-state-warn-primary:var(--dsh-notebook-paper-warn)}
/* The page inside the panel.
   **No frame.** There used to be a 1px border and an 8px radius here, which made the
   manuscript a card floating on the paper — three nested rectangles (panel, page,
   text) where the writing surface should be one. The tab band above it is the only
   boundary the page needs, and the drawn tab opens straight into it. */
.dsh-notebook-doc{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;border:0;border-radius:0;background:transparent;color:inherit;font-family:var(--dsh-notebook-font,system-ui);font-size:var(--dsh-notebook-size,15px)}
/* The source view's text metrics, in one place: the textarea a file is typed into
   and the colour layer drawn behind it are two boxes that must agree on every
   number here, or the colour slides off the characters. Both selectors are in this
   one rule so that can only be edited for the pair, never for one of them. */
.dsh-notebook-doc .dsh-notebook-textarea,.dsh-notebook-srcText{background:transparent;border:0;border-radius:0;color:inherit;font-family:inherit;font-size:inherit;line-height:1.9;padding:14px 22px 40px;resize:none}
.dsh-notebook-doc .dsh-notebook-textarea:focus{border-color:transparent}
/* The writing surface's scroll container. ProseMirror owns the editable element
   inside it; this box is the only thing in the column that scrolls, and its padding
   is the frame the removed border used to be — a margin of paper, not a line. */
.dsh-notebook-pmHost{flex:1;min-height:0;overflow:auto;padding:14px 22px 48px}
/* The editor itself. Everything under .dsh-notebook-pm is document text: a writer's
   page, not interface chrome — which is why the bare tag selectors below are safe
   (they are scoped to this one class) and why sizes are in em, so the author's
   size setting scales headings with the body.

   display:flow-root is not decoration. Without a block formatting context here the
   first block's top margin **collapsed out of this element** and pushed the whole
   page down inside the scroll container; together with min-height:100% that made
   the page exactly 100% + 1.4em tall, so a two-line markdown file starting with
   a heading showed a scrollbar for content that fit (33px of overflow at the
   default size 15 — 1.4 x 1.55em). The formatting context contains the margin, so
   the page's height is its content or the viewport, whichever is larger.

   Note for future edits: this stylesheet is a template literal, so a backtick or
   "dollar" + brace inside a comment ends it. Dots and dashes only. */
.dsh-notebook-pm{outline:none;line-height:1.9;min-height:100%;display:flow-root}
/* No leading margin above the first block and none below the last. The page's
   padding is its frame, so a margin there is only empty space at the edge of the
   sheet — and a margin that has nowhere to go is exactly what used to become a
   scrollbar. */
.dsh-notebook-pm > :first-child{margin-top:0}
.dsh-notebook-pm > :last-child{margin-bottom:0}
.dsh-notebook-pm h1,.dsh-notebook-pm h2,.dsh-notebook-pm h3,.dsh-notebook-pm h4,.dsh-notebook-pm h5,.dsh-notebook-pm h6{margin:1.4em 0 .55em;line-height:1.4;font-weight:600}
.dsh-notebook-pm h1{font-size:1.55em}
.dsh-notebook-pm h2{font-size:1.3em}
.dsh-notebook-pm h3{font-size:1.12em}
.dsh-notebook-pm h4,.dsh-notebook-pm h5,.dsh-notebook-pm h6{font-size:1em;color:var(--dsw-alias-label-secondary)}
/* A heading right after a heading is a tighter pair than a heading after prose. */
.dsh-notebook-pm h1 + h2,.dsh-notebook-pm h2 + h3,.dsh-notebook-pm h3 + h4{margin-top:.4em}
.dsh-notebook-pm p{margin:0 0 .7em}
.dsh-notebook-pm ul,.dsh-notebook-pm ol{margin:0 0 .7em;padding-left:1.6em}
.dsh-notebook-pm li{margin:0 0 .25em}
.dsh-notebook-pm li > p{margin:0}
.dsh-notebook-pm blockquote{margin:0 0 .7em;padding:.1em 0 .1em .8em;border-left:3px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
/* A fenced block is drawn on the syntax palette's own background, not the paper's
   grey tint: see the syntax-colour comment for the measurements that decided it.
   The border and radius go with it, because a theme surface that reads as a
   floating rectangle in the middle of a page is not how either variant looks. */
.dsh-notebook-pm pre{margin:0 0 .7em;padding:.6em .75em;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsh-notebook-hl-bg,var(--dsw-alias-bg-layer-1));color:var(--dsh-notebook-hl-fg,var(--dsw-alias-label-primary));overflow:auto;white-space:pre-wrap;overflow-wrap:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85em}
/* An inline run of code wears the same surface, one shade in: it is a word inside
   a sentence, not a block, so it gets the theme's background at reduced opacity
   rather than its full rectangle. */
.dsh-notebook-pm code{padding:1px 5px;border-radius:4px;background:var(--dsh-notebook-hl-bg,var(--dsw-alias-bg-layer-2));color:var(--dsh-notebook-hl-fg,inherit);border:1px solid var(--dsw-alias-border-l1);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85em}
.dsh-notebook-pm pre code{padding:0;border:0;background:transparent;color:inherit;font-size:1em}
.dsh-notebook-pm hr{margin:1.4em 0;border:0;border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-notebook-pm a{color:var(--dsw-alias-brand-primary);text-decoration:underline}
/* The picker row above the page. Three groups — faces, size, paper — then the mode
   pair, each in its own segmented control, with a rule between the groups instead of
   a word for each: the buttons say what they are (a one-character face name, a
   number, a paper name), and a label only cost width.
   A segmented control is what makes one choice visible without giving every option a
   hard border: the group is one soft tray, the chosen option is the raised chip
   inside it. Four boxes with borders side by side read as four buttons that all
   claim to be pressed. */
.dsh-notebook-typebar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:none;min-width:0}
.dsh-notebook-seg{display:flex;align-items:center;gap:2px;flex:none;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);box-sizing:border-box;height:28px}
/* The chips inside a tray are buttons with no border of their own; the data-selected
   attribute keeps working as the state, only its look changes here. */
.dsh-notebook-seg > button.dsh-notebook-btn{height:22px;min-width:24px;padding:0 7px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:400;line-height:1;box-sizing:border-box}
.dsh-notebook-seg > button.dsh-notebook-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);border:0;color:var(--dsw-alias-label-primary)}
.dsh-notebook-seg > button.dsh-notebook-btn[data-selected="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 0 0 1px var(--dsw-alias-border-l1)}
.dsh-notebook-seg > button.dsh-notebook-btn[data-selected="true"]:hover:not(:disabled){background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
/* The size picker is a tray with one number in it, so it lines up with the trays
   beside it instead of standing taller as a native select. */
.dsh-notebook-typebar .dsh-notebook-select{width:auto;flex:none;height:28px;box-sizing:border-box;padding:0 4px 0 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);font-size:12px}
/* A rule between groups, the height of the trays it separates. */
.dsh-notebook-typebar .dsh-notebook-divider{height:20px;margin:0 2px}
/* A block the schema does not model — front matter, a table — kept as the markdown
   it was written as, and visibly not part of the prose being edited. */
.dsh-notebook-pmRaw{border-style:dashed;color:var(--dsw-alias-label-secondary);font-size:.78em;line-height:1.6}
/* ---- syntax colour -------------------------------------------------------------
   Two surfaces show code: a fenced block on the rendered page (coloured by view
   decorations — see src/client/state/pm-highlight.ts) and the layer behind the
   source editor's textarea (src/client/studio/SourceEditor.tsx). Both are
   coloured from one vocabulary, so they name the same sixteen classes below.

   THE COLOURS ARE DRACULA'S, NOT OURS. Dark is Dracula Classic, light is
   Alucard Classic — the two variants of the same official theme, so the light
   half is the palette's own light mode rather than an invented one. Values are
   copied byte for byte from the specification:
     https://draculatheme.com/spec             (token classification, palettes)
     https://github.com/dracula/dracula-theme  (README palette tables)
   The rule below is Alucard (the three light papers); 黑夜 declares Dracula in
   its own paper rule above, beside the tokens it belongs with.

   Which of the theme's nine syntax colours each of our sixteen roles takes is
   the specification's own Token Classification table, not a guess:

     keyword, operator        Pink        keywords and storage, and the
                                          operator/punctuation emphasis the
                                          spec's CSS example shows on a colon
     title, addition          Green       functions, methods, diff additions
     builtin, attr, regexp,   Cyan        support and built-ins (the spec lists
       link                               regexps, HTML/XML tag and attribute
                                          names under support), links
     string                   Yellow      string and text literals
     number, literal          Orange      numbers, constants, booleans
     symbol                   Purple      constants, instance reserved words
     comment, meta            Comment     comments, and the annotations and
                                          decorators the spec files with them
     variable                 Foreground  variables and identifiers
     deletion                 Red         errors, diff deletions

   Deliberately NOT applied: the spec's italic modifiers (comments, instance
   reserved words, generic templates). The source editor draws colour behind a
   textarea whose glyphs are transparent, so any change of face or weight would
   move the characters out from under the textarea's own. Shape is only used on
   the rendered page, where nothing depends on the metrics (see below).

   CONTRAST, MEASURED, AND WHY CODE HAS ITS OWN BACKGROUND.
   A syntax palette is tuned against the surface its author tested it on, so the
   code has to sit on that surface or the values are being quoted out of
   context. Both halves therefore carry their own editor background (hl-bg),
   Dracula's #282a36 and Alucard's #fffbeb — and a fence block, an inline code
   run and the whole source editor are painted with it. Drawing the same tokens
   on the paper's grey tint is measurably worse: on 绿荫's old #d9e7d0 code tint,
   six of Alucard's roles fell under WCAG AA (3.86-4.49); on Alucard's own
   #fffbeb none do, and the tightest token is 4.80:1.

   Two colours miss AA and they are the theme's own: Dracula's comment
   (#6272a4) is 3.03:1 on Dracula's own background, and the official theme ships
   that. Reproducing a named theme by "correcting" it would not be reproducing
   it. Alucard's comment (#6c664b) is 5.56:1, so the light half has no such gap.
   The artifact check asserts the exact sub-AA pairs per surface plus a 3:1
   floor, so this stays a stated fact rather than a forgotten one. */
.dsh-notebook-root[data-paper="plain"],.dsh-notebook-root[data-paper="elegant"],.dsh-notebook-root[data-paper="green"]{--dsh-notebook-hl-bg:#fffbeb;--dsh-notebook-hl-fg:#1f1f1f;--dsh-notebook-hl-comment:#6c664b;--dsh-notebook-hl-keyword:#a3144d;--dsh-notebook-hl-builtin:#036a96;--dsh-notebook-hl-literal:#a34d14;--dsh-notebook-hl-number:#a34d14;--dsh-notebook-hl-string:#846e15;--dsh-notebook-hl-regexp:#036a96;--dsh-notebook-hl-symbol:#644ac9;--dsh-notebook-hl-title:#14710a;--dsh-notebook-hl-attr:#036a96;--dsh-notebook-hl-variable:#1f1f1f;--dsh-notebook-hl-meta:#6c664b;--dsh-notebook-hl-operator:#a3144d;--dsh-notebook-hl-addition:#14710a;--dsh-notebook-hl-deletion:#cb3a2a;--dsh-notebook-hl-link:#036a96}
.dsh-notebook-hl-comment{color:var(--dsh-notebook-hl-comment)}
.dsh-notebook-hl-keyword{color:var(--dsh-notebook-hl-keyword)}
.dsh-notebook-hl-builtin{color:var(--dsh-notebook-hl-builtin)}
.dsh-notebook-hl-literal{color:var(--dsh-notebook-hl-literal)}
.dsh-notebook-hl-number{color:var(--dsh-notebook-hl-number)}
.dsh-notebook-hl-string{color:var(--dsh-notebook-hl-string)}
.dsh-notebook-hl-regexp{color:var(--dsh-notebook-hl-regexp)}
.dsh-notebook-hl-symbol{color:var(--dsh-notebook-hl-symbol)}
.dsh-notebook-hl-title{color:var(--dsh-notebook-hl-title)}
.dsh-notebook-hl-attr{color:var(--dsh-notebook-hl-attr)}
.dsh-notebook-hl-variable{color:var(--dsh-notebook-hl-variable)}
.dsh-notebook-hl-meta{color:var(--dsh-notebook-hl-meta)}
.dsh-notebook-hl-operator{color:var(--dsh-notebook-hl-operator)}
.dsh-notebook-hl-addition{color:var(--dsh-notebook-hl-addition)}
.dsh-notebook-hl-deletion{color:var(--dsh-notebook-hl-deletion)}
.dsh-notebook-hl-link{color:var(--dsh-notebook-hl-link);text-decoration:underline}
/* Emphasis and strength are drawn by shape, not by colour: they are the two
   scopes whose whole meaning *is* the shape, and a third colour would say less.
   Scoped to the rendered page on purpose — in the source editor the colour layer
   must keep every text metric the textarea has (see the layer rules below), and a
   real bold face would change the advances under a normal-weight caret. */
.dsh-notebook-pm .dsh-notebook-hl-emphasis{font-style:italic}
.dsh-notebook-pm .dsh-notebook-hl-strong{font-weight:600}
/* The language of a fenced block, as a quiet label in the block's own top edge.
   A fence that names a language has a top strip wide enough for it, so the label
   never sits over the first line of code; a fence with no info string has no strip
   and no label.
   The label is drawn, not hovered, because the language is a fact about the block
   rather than a tooltip, and because a mouse-only disclosure is not a disclosure.
   An info string this panel has no grammar for keeps the strip and dims: the label
   is still the author's word, and the code below it is plainly uncoloured. */
.dsh-notebook-pm pre[data-language]:not([data-language=""]){position:relative;padding-top:1.9em}
/* The chip sits on the theme's own surface, so its text is the theme's comment
   colour: on Alucard's #fffbeb that is 5.56:1, and on Dracula's #282a36 it is the
   one AA miss the theme itself ships (see the syntax-colour comment). The dimmed
   variant is for an info string this panel cannot colour. */
.dsh-notebook-pm pre[data-language]:not([data-language=""])::after{content:attr(data-language);position:absolute;top:.35em;right:.6em;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 5px;border-radius:4px;background:var(--dsh-notebook-hl-bg,var(--dsw-alias-bg-base));box-shadow:0 0 0 1px var(--dsw-alias-border-l1);color:var(--dsh-notebook-hl-comment,var(--dsw-alias-label-secondary));font-size:.72em;line-height:1.6;pointer-events:none;user-select:none}
.dsh-notebook-pm pre[data-language-known="false"]::after{opacity:.55;box-shadow:none}
/* The source editor's two layers. Both live in one box and share every text metric
   — font, size, line height, padding, wrapping, tab size — so the colour lands
   under the characters the textarea is drawing. The textarea is the one on top,
   with transparent glyphs and a live caret; the layer behind it has no scrollbar,
   and SourceEditor copies the textarea's scroll and width onto it.
   Neither axis is given twice: an inset of all four sides *and* a width would be
   over-constrained, and in a right-to-left context the browser drops the left edge
   — which would anchor the layer to the wrong side and offset every glyph by the
   gutter. */
/* The source editor's box wears the theme's surface, not the paper's: the whole
   panel becomes the editor, so the palette lands exactly where its author put it.
   Only when the theme's colours are actually drawn (data-coloured) — a plain-text
   file with no grammar stays on the paper, because a cream rectangle full of
   uncoloured words would be a surface with nothing on it to justify itself. */
.dsh-notebook-src{position:relative;flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
.dsh-notebook-src[data-coloured="true"]{background:var(--dsh-notebook-hl-bg,transparent);color:var(--dsh-notebook-hl-fg,inherit)}
.dsh-notebook-srcText{position:absolute;top:0;left:0;width:100%;height:100%;box-sizing:border-box;margin:0;letter-spacing:normal;white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;tab-size:4;text-align:left}
/* hidden, not clip: the layer follows the textarea by having its scrollTop set,
   and a box clipped with clip is not a scroll container at all — the assignment
   would be ignored and a long file's colour would stay at the top while the text
   scrolled. Hidden keeps it scrollable by script and invisible to the user, which
   is exactly what a follower needs. */
.dsh-notebook-srcCode{width:100%;overflow:hidden;color:inherit;pointer-events:none}
/* The layer's code element is the browser's own monospace by default, which would draw
   the colour in a different face from the textarea above it and put every glyph a little
   to the left of the character it belongs to. It inherits every text metric instead. */
.dsh-notebook-srcCode code{font:inherit;letter-spacing:inherit;white-space:inherit;overflow-wrap:inherit;word-break:inherit;tab-size:inherit;background:transparent;padding:0;border:0}
/* The textarea keeps the old element's own styling (the dsh-notebook-textarea rules
   above), except for the glyphs, which are the layer's to draw. */
.dsh-notebook-srcInput{flex:1;min-height:0;color:transparent;-webkit-text-fill-color:transparent;caret-color:var(--dsh-notebook-hl-fg,var(--dsw-alias-label-primary));resize:none;scrollbar-gutter:stable}
/* The one thing the source view has to say out loud: why a file is not coloured.
   A file whose type this panel has no grammar for, or one too large to colour in
   the time a keystroke allows, is drawn as plain text — correct, and indistinguishable
   from a broken feature unless it says so. The label rides in the page's top padding,
   above the first line, and is drawn only on the uncoloured path. */
.dsh-notebook-srcLabel{position:absolute;top:2px;right:6px;z-index:1;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 5px;border-radius:4px;box-shadow:0 0 0 1px var(--dsw-alias-border-l1);background:var(--dsh-notebook-hl-bg,var(--dsw-alias-bg-base));color:var(--dsh-notebook-hl-comment,var(--dsw-alias-label-secondary));font-size:10px;line-height:14px;pointer-events:none;user-select:none}
.dsh-notebook-srcInput::placeholder{color:var(--dsw-alias-label-secondary);-webkit-text-fill-color:var(--dsw-alias-label-secondary)}
/* Selecting text: the textarea paints its selection *above* the colour layer, so an opaque
   selection would hide the glyphs it selected. A translucent one lets the colour show
   through, and the selection is still the plain fact it was. The first declaration is the
   fallback for a browser without color-mix; both are translucent.
   Note: this stylesheet is a template literal, so no backtick may appear in a comment. */
.dsh-notebook-srcInput::selection{background:rgba(64,120,242,.3);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}
.dsh-notebook-srcInput::-moz-selection{background:rgba(64,120,242,.3);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,transparent)}
/* While an input method is composing, the browser draws the pre-edit text in the
   textarea's own colour, which is transparent — so the colour comes back to the
   textarea and the layer steps aside until the word is committed. */
.dsh-notebook-src[data-composing="true"] .dsh-notebook-srcCode{visibility:hidden}
.dsh-notebook-src[data-composing="true"] .dsh-notebook-srcInput{color:var(--dsw-alias-label-primary);-webkit-text-fill-color:currentColor}
`


/** Inject the plugin stylesheet for as long as the page is mounted. */
export function StyleSheet(): React.ReactElement {
  return React.createElement('style', { 'data-plugin': 'dsh-notebook' }, CSS)
}

export interface GripProps {
  /** The width this handle resizes, read at the moment a drag starts. */
  value: number
  /**
   * Which way the region grows.
   *
   * `start` is a region on the left of the handle (dragging right widens it);
   * `end` is a region on the right (dragging left widens it).
   */
  grow?: 'start' | 'end'
  /** Accessible name and tooltip, e.g. "调整正文区宽度". */
  label: string
  /**
   * Called with the width the drag asked for and the measured row width.
   *
   * The width is deliberately unclamped: what a region may take depends on what
   * else is on the row, and only the caller knows that. The measured width comes
   * from the handle's own parent, which is the row — measuring anything else
   * would let a drag push the row wider than the panel.
   */
  onResize: (next: number, total: number) => void
}

/** How far one arrow key moves a boundary. */
const GRIP_STEP = 24

/**
 * A draggable boundary between two regions.
 *
 * Pointer events with window-level listeners rather than pointer capture: the
 * pointer regularly leaves a 6px strip, and a captured handle would keep the
 * drag only while the pointer is over it.
 */
export function Grip({ value, grow = 'start', label, onResize }: GripProps): React.ReactElement {
  const [active, setActive] = React.useState(false)

  const totalOf = (node: HTMLElement | null): number => node?.parentElement?.clientWidth ?? 0

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const total = totalOf(event.currentTarget)
    const from = event.clientX
    const sign = grow === 'start' ? 1 : -1
    // `preventDefault` is what stops the press from starting a text selection;
    // the body class keeps one from starting when the pointer moves over text.
    event.preventDefault()
    setActive(true)
    const move = (moved: PointerEvent): void => { onResize(value + sign * (moved.clientX - from), total) }
    const end = (): void => {
      globalThis.removeEventListener('pointermove', move)
      globalThis.removeEventListener('pointerup', end)
      globalThis.removeEventListener('pointercancel', end)
      globalThis.document.body.classList.remove('dsh-notebook-grabbing')
      setActive(false)
    }
    globalThis.addEventListener('pointermove', move)
    globalThis.addEventListener('pointerup', end)
    globalThis.addEventListener('pointercancel', end)
    globalThis.document.body.classList.add('dsh-notebook-grabbing')
  }

  // A boundary that can only be moved with a mouse is not reachable for everyone,
  // and a separator is a standard place to accept arrow keys.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowLeft' ? -GRIP_STEP : event.key === 'ArrowRight' ? GRIP_STEP : 0
    if (step === 0) return
    event.preventDefault()
    onResize(value + step * (grow === 'start' ? 1 : -1), totalOf(event.currentTarget))
  }

  return React.createElement('div', {
    className: 'dsh-notebook-grip',
    role: 'separator',
    'aria-orientation': 'vertical',
    // The name carries the action, so the arrows have an announced effect.
    'aria-label': label,
    'aria-valuenow': value,
    'aria-valuemin': 0,
    'aria-valuemax': 0,
    title: label,
    tabIndex: 0,
    'data-active': active ? 'true' : 'false',
    onPointerDown,
    onKeyDown,
  })
}

export interface ButtonProps {
  children?: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'default' | 'primary' | 'secondary' | 'ghost' | 'icon' | 'danger'
  title?: string
  type?: 'button' | 'submit'
  /**
   * Extra attributes to place on the button.
   *
   * Used for `data-*` hooks the artifact check matches on. It reads the bundle
   * rather than a rendered tree, so a hook has to be an attribute it can find
   * without depending on a localized label.
   */
  attrs?: Record<string, string>
}

export function Button({ children, onClick, disabled, variant = 'default', title, type = 'button', attrs }: ButtonProps): React.ReactElement {
  return React.createElement('button', {
    type,
    className: 'dsh-notebook-btn',
    'data-variant': variant,
    onClick,
    disabled: disabled === true,
    ...attrs ?? {},
    ...title === undefined ? {} : { title },
  }, children)
}

export function Field({ label, hint, children }: { label: string; hint?: string; children?: React.ReactNode }): React.ReactElement {
  return React.createElement('label', { className: 'dsh-notebook-field' },
    React.createElement('span', { className: 'dsh-notebook-label' }, label),
    children,
    hint === undefined ? null : React.createElement('span', { className: 'dsh-notebook-hint' }, hint),
  )
}

export function TextInput(props: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  ariaLabel?: string
  /** Fired on Enter, so a one-line form needs no reach for the button. */
  onEnter?: () => void
}): React.ReactElement {
  return React.createElement('input', {
    className: 'dsh-notebook-input',
    type: props.type ?? 'text',
    value: props.value,
    placeholder: props.placeholder ?? '',
    'aria-label': props.ariaLabel ?? props.placeholder ?? '',
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => { props.onChange(event.target.value) },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter' || props.onEnter === undefined) return
      event.preventDefault()
      props.onEnter()
    },
  })
}

export function TextArea(props: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  ariaLabel?: string
  className?: string
  onBlur?: () => void
}): React.ReactElement {
  return React.createElement('textarea', {
    className: `dsh-notebook-textarea${props.className === undefined ? '' : ` ${props.className}`}`,
    value: props.value,
    rows: props.rows ?? 3,
    placeholder: props.placeholder ?? '',
    'aria-label': props.ariaLabel ?? props.placeholder ?? '',
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => { props.onChange(event.target.value) },
    ...props.onBlur === undefined ? {} : { onBlur: props.onBlur },
  })
}

export function Badge({ state, children }: { state?: string; children?: React.ReactNode }): React.ReactElement {
  return React.createElement('span', { className: 'dsh-notebook-badge', ...state === undefined ? {} : { 'data-state': state } }, children)
}

export function ErrorNote({ children }: { children?: React.ReactNode }): React.ReactElement {
  return React.createElement('div', { className: 'dsh-notebook-error', role: 'alert' }, children)
}
