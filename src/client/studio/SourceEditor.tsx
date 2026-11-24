/**
 * The source editor: the file's own text, with syntax colour behind it.
 *
 * The textarea stays the editor, and that is the whole design. A highlighted
 * editor built on CodeMirror or ProseMirror would own the buffer, and every
 * keystroke would have to round-trip through a document model; this panel
 * autosaves the bytes the author typed, and the one surface where a rich editor
 * is *wrong* is a file whose format is significant — a `Dockerfile` or a
 * `data.json` comes back out of a markdown serializer as a different file. So
 * the colour is a second layer **behind** a transparent textarea: same box, same
 * font, same wrapping, no scrollbar of its own, its scroll and width copied from
 * the textarea. If the layer were ever out of step the file on disk would still
 * be exactly what the author typed.
 *
 * Four details make the illusion hold:
 *
 * - **The layer is never bold or italic.** A real bold face has different
 *   advances, and the caret comes from the normal-weight textarea: from the first
 *   bold run to the end of that line the two layers would disagree about which
 *   character is under the pointer. The page may draw those two scopes by shape
 *   (`ui.ts` scopes them to `.dsh-notebook-pm`); this layer may not.
 * - **Composition is drawn plainly.** An input method draws its pre-edit text in
 *   the textarea's own colour; transparent text would make a composed character
 *   invisible while it is being typed. `compositionstart` hands the colour back
 *   to the textarea and hides the layer, and `compositionend` returns both.
 * - **Nothing is trimmed, and line endings are normalised for the layer.** The
 *   layer draws the file verbatim, with one extra newline when the file ends in
 *   one (a single trailing break is not rendered in a `pre`). A textarea's value
 *   setter turns CRLF into LF while the buffer keeps what the Host returned, so
 *   the layer is built from the normalised text and the buffer is untouched.
 * - **Width is measured, not assumed.** The textarea reserves a scrollbar gutter,
 *   so its content box is narrower than the wrapper: the layer takes its width
 *   from `clientWidth`, in a layout effect, before the first paint.
 *
 * A file this panel has no grammar for — or one too large to colour between two
 * keystrokes — is drawn as plain text with a quiet label saying so: correct is
 * indistinguishable from broken unless it is said.
 */
import * as React from 'react'
import { highlightCode, languageForPath } from '../state/highlight'
import { TextArea } from '../ui'

export interface SourceEditorProps {
  /** The file being edited, whose name decides the grammar. */
  path: string
  /** The tab's draft: the text is the editor's own, and is handed back whole. */
  value: string
  /** Called with the whole text after every change. */
  onChange: (value: string) => void
  /** What the label says for a file whose type has no grammar, e.g. 纯文本. */
  plainLabel: string
  /**
   * What the label says for a file of a known type that is not coloured — too
   * large to colour between two keystrokes, e.g. 未着色（文件过大）. It is never
   * silent: an uncoloured code file would otherwise be read as a fault.
   */
  uncolouredLabel: string
}

/** The layer's box, the colour layer's own class, and the textarea's. */
const LAYER = 'dsh-notebook-srcCode dsh-notebook-srcText'
const INPUT = 'dsh-notebook-srcInput dsh-notebook-textarea'

/**
 * The layer's copy of the draft.
 * @param value - the tab's draft, as the Host returned it.
 * @returns the same text with CRLF and lone CR turned into LF, and a second
 * trailing newline so the last empty line is drawn like the textarea draws it.
 */
export function layerText(value: string): string {
  const normalised = value.replace(/\r\n?/g, '\n')
  return normalised.endsWith('\n') ? `${normalised}\n` : normalised
}

export function SourceEditor({ path, value, onChange, plainLabel, uncolouredLabel }: SourceEditorProps): React.ReactElement {
  const language = languageForPath(path)
  const layer = React.useRef<HTMLPreElement | null>(null)
  const box = React.useRef<HTMLTextAreaElement | null>(null)
  // Whether an input method is mid-word; see the module note.
  const [composing, setComposing] = React.useState(false)

  // The text the layer draws: line endings as the textarea shows them, and the
  // trailing empty line `pre` would otherwise drop. One function, so the two
  // surfaces cannot disagree about it.
  const drawnText = layerText(value)
  const drawn = React.useMemo(
    () => (language === undefined ? [] : highlightCode(drawnText, language)),
    [drawnText, language],
  )
  // Nothing coloured: a file whose grammar produced no classes at all — the size
  // cap, or a grammar that refused its input. Either way the text is there.
  const uncoloured = language !== undefined && drawn.every(span => span.className.length === 0)

  /** Copy the textarea's content width onto the layer, so both wrap alike. */
  const syncWidth = React.useCallback((): void => {
    const behind = layer.current
    const front = box.current
    if (behind === null || front === null) return
    behind.style.width = `${front.clientWidth}px`
  }, [])

  /** Copy the textarea's scroll offset onto the layer. */
  const syncScroll = React.useCallback((): void => {
    const behind = layer.current
    const front = box.current
    if (behind === null || front === null) return
    behind.scrollTop = front.scrollTop
    behind.scrollLeft = front.scrollLeft
  }, [])

  // Width before the first paint of a file, and on every draft change: a restored
  // draft is a new layer, and a layer narrower or wider than the textarea wraps in
  // the wrong place. A layout effect is what makes the first painted frame right.
  React.useLayoutEffect(() => {
    syncWidth()
    syncScroll()
  }, [value, language, syncWidth, syncScroll])

  // The column's width changes when a grip is dragged, and the layer has to wrap
  // where the textarea now wraps. Absent in the artifact check's render, which has
  // no browser to observe with.
  React.useEffect(() => {
    const front = box.current
    if (front === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { syncWidth() })
    observer.observe(front)
    return () => { observer.disconnect() }
  }, [syncWidth])

  if (language === undefined) {
    // No grammar: the plain editor this view has always been, with a label that
    // says why the colours are absent.
    return React.createElement('div', {
      className: 'dsh-notebook-src',
      'data-mode': 'source',
      'data-language': '',
      'data-coloured': 'false',
    },
    React.createElement('span', { className: 'dsh-notebook-srcLabel' }, plainLabel),
    React.createElement(TextArea, {
      value,
      onChange,
      placeholder: path,
      ariaLabel: path,
      className: 'dsh-notebook-grow',
    }))
  }

  const pieces: React.ReactNode[] = drawn.map((span, at) => (
    span.className.length === 0
      ? span.text
      : React.createElement('span', { key: `${String(at)}:${span.className}`, className: span.className }, span.text)
  ))

  return React.createElement('div', {
    className: 'dsh-notebook-src',
    'data-mode': 'source',
    'data-language': language,
    'data-coloured': uncoloured ? 'false' : 'true',
    'data-composing': composing ? 'true' : 'false',
  },
  // A file of a known type that came back uncoloured keeps the layer — it is the
  // same text — and says so, because nothing below it would show the difference
  // between "this format is plain" and "the colouring failed".
  uncoloured
    ? React.createElement('span', { className: 'dsh-notebook-srcLabel' }, uncolouredLabel)
    : null,
  React.createElement('pre', {
    className: LAYER,
    'aria-hidden': 'true',
    ref: layer,
  }, React.createElement('code', null, ...pieces)),
  React.createElement('textarea', {
    className: INPUT,
    ref: box,
    value,
    placeholder: path,
    'aria-label': path,
    // A code file is not a sentence being proof-read; the markdown source of a
    // chapter is prose, and keeps the spell checker the rendered page would use.
    spellCheck: language === 'markdown',
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => { onChange(event.currentTarget.value) },
    onScroll: syncScroll,
    onCompositionStart: () => { setComposing(true) },
    onCompositionEnd: () => { setComposing(false); syncWidth(); syncScroll() },
  }))
}
