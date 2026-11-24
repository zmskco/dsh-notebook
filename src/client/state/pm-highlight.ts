/**
 * Syntax colour for the rendered page, as ProseMirror decorations.
 *
 * Decorations, specifically — not a custom node view, and not marked-up text.
 * Three properties come from that one decision, and they are the ones that
 * matter in a file the author keeps saving:
 *
 * - **The document is still markdown.** Nothing is added to the model, so
 *   `markdownFromDocument` writes back exactly what was written, and the file
 *   gains no colour markers when it is read by anything else.
 * - **Editing is untouched.** A decoration is view state: the caret, the undo
 *   history, the input rules and the IME never learn that colour exists. A node
 *   view that rendered `innerHTML` would have to re-implement all four.
 * - **The work is proportional to the block.** The decoration set is rebuilt
 *   per document version and cached by node identity, so moving the caret costs
 *   nothing and typing re-colours only the document that changed.
 *
 * The document schema is not consulted about any of this: a `code_block` is a
 * code block, and whether it takes colour is decided by its own info string.
 *
 * @module notebook/client/state/pm-highlight
 */
import { Plugin, PluginKey } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { highlightCode } from './highlight'

/**
 * One coloured range of a document, in ProseMirror positions.
 *
 * Positions rather than text, because that is what a decoration takes: `from`
 * is an offset into the document, and a range is only correct if the block's
 * own text was walked in step with it.
 */
export interface ColourRange {
  /** First coloured position. */
  from: number
  /** One past the last coloured position. */
  to: number
  /** The class name the run is drawn with. */
  className: string
}

/**
 * Every coloured range in a document.
 *
 * Pure, so the artifact check can drive it against a real document produced by
 * the ordinary reader: the offsets are the part that can silently be wrong, and
 * they are checked by reading the text back out of the document.
 * @param doc - the document the editor holds.
 * @returns the ranges, in document order.
 */
export function codeColourRanges(doc: PMNode): ColourRange[] {
  const ranges: ColourRange[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return undefined
    // A code block's content is text and nothing else, so a running offset is
    // the exact mapping from a span to a position: `+1` skips the node itself.
    for (const [from, to, className] of blockRanges(node)) {
      ranges.push({ from: pos + 1 + from, to: pos + 1 + to, className })
    }
    // Nothing below a code block can need a colour.
    return false
  })
  return ranges
}

/**
 * One code block's colours, as offsets *within* it and in node order.
 *
 * Cached on the node itself, which is what keeps typing cheap in a document
 * that is mostly prose: ProseMirror shares structure between versions, so an
 * untouched block is the same object, and only the block being edited is
 * coloured again.
 * @param node - a `code_block`.
 * @returns `[from, to, className]` triples, relative to the block's text.
 */
const BLOCK_CACHE = new WeakMap<PMNode, ReadonlyArray<readonly [number, number, string]>>()

function blockRanges(node: PMNode): ReadonlyArray<readonly [number, number, string]> {
  const cached = BLOCK_CACHE.get(node)
  if (cached !== undefined) return cached
  const ranges: (readonly [number, number, string])[] = []
  let offset = 0
  for (const span of highlightCode(node.textContent, String(node.attrs.params ?? ''))) {
    const from = offset
    offset += span.text.length
    if (span.className.length === 0 || span.text.length === 0) continue
    ranges.push([from, offset, span.className])
  }
  BLOCK_CACHE.set(node, ranges)
  return ranges
}

/**
 * Decoration sets by document, so an unchanged document is coloured once.
 *
 * ProseMirror documents are immutable and structurally shared, which makes
 * identity the right key: a keystroke produces a new document for the blocks it
 * touched, and the entry for the old one is collected with it.
 */
const CACHE = new WeakMap<PMNode, DecorationSet>()

/** One document's colour, from the cache when that document was coloured before. */
function decorationsOf(doc: PMNode): DecorationSet {
  const cached = CACHE.get(doc)
  if (cached !== undefined) return cached
  const decorations = codeColourRanges(doc).map(range =>
    Decoration.inline(range.from, range.to, { class: range.className }))
  const set = DecorationSet.create(doc, decorations)
  CACHE.set(doc, set)
  return set
}

/** One key for the plugin, so a second installation would be recognisable. */
const COLOUR_KEY = new PluginKey<DecorationSet>('notebook-code-colour')

/**
 * The plugin the rendered editor installs.
 * @returns a plugin that keeps one document's colours in step with its text.
 */
export function codeHighlightPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: COLOUR_KEY,
    state: {
      init: (_config, state: EditorState) => decorationsOf(state.doc),
      // A selection change is not a reason to re-colour: the document is the
      // same object, so the cached set is the answer.
      apply: (transaction, previous) => (transaction.docChanged ? decorationsOf(transaction.doc) : previous),
    },
    props: {
      decorations: (state: EditorState) => COLOUR_KEY.getState(state) ?? DecorationSet.empty,
    },
  })
}
