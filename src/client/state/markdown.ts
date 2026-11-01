/**
 * A small markdown reader for the text region's preview.
 *
 * The files this panel opens are the target — the notes, outlines and READMEs an
 * author writes in the workspace — so this is a deliberate subset rather than a
 * CommonMark implementation. Headings,
 * paragraphs, emphasis, inline code, links, quotes, lists, fenced code, tables
 * and rules cover what those files use; everything else (nested lists, HTML
 * blocks, reference links, footnotes) is drawn as the text it is instead of
 * being guessed at.
 *
 * Two properties carry more weight than the rest, and both are asserted:
 *
 * - **Nothing is interpreted as HTML.** {@link parseMarkdown} returns spans, and
 *   the view turns those into React elements, so `<img onerror=…>` in a file is
 *   *shown* rather than obeyed. A preview that injected HTML would execute
 *   whatever a model or a paste put into a manuscript.
 * - **Only openable destinations become links.** Anything with a scheme other
 *   than `http(s)`/`mailto` — `javascript:` included — stays text.
 *
 * Pure, string-in/data-out, so the artifact check drives it directly instead of
 * through a render it cannot reach.
 *
 * @module notebook/client/state/markdown
 */

/** One styled run inside a block. */
export type Span =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; spans: Span[] }
  | { kind: 'em'; spans: Span[] }
  | { kind: 'link'; text: string; href: string }

/** A table column's alignment, as the delimiter row asked for it. */
export type ColumnAlign = 'left' | 'center' | 'right' | undefined

/**
 * One block-level unit of a document.
 *
 * Every variant carries `raw`: the exact source lines it was read from, blank
 * lines after it excluded. That is what lets the desktop editor keep a file's
 * own spelling — `*` bullets, `_emphasis_`, an unusual table padding — for every
 * block the author did not touch, and re-emit only the block that was edited.
 */
export type Block =
  | { kind: 'meta'; text: string; raw: string }
  | { kind: 'heading'; level: number; spans: Span[]; raw: string }
  | { kind: 'paragraph'; spans: Span[]; raw: string }
  | { kind: 'list'; ordered: boolean; items: Span[][]; raw: string }
  | { kind: 'quote'; spans: Span[]; raw: string }
  | { kind: 'code'; language: string; text: string; raw: string }
  | { kind: 'rule'; raw: string }
  | { kind: 'table'; align: ColumnAlign[]; head: Span[][]; rows: Span[][][]; raw: string }

/**
 * How the text region shows the file that is open.
 *
 * `wysiwyg` is the rendered document itself, editable in place; `source` is the
 * markdown. There is no read-only mode: a rendered page you can type into is the
 * reading mode.
 */
export type EditorMode = 'wysiwyg' | 'source'

/**
 * Whether a path is markdown, which is what the rendered mode reads.
 *
 * Two cases count: `.md` / `.markdown` in any case, and **a name with no
 * extension at all**. The panel names a new file by its title — `第一章`, not
 * `第一章.md` — and a title is a document; opening it as raw source because it
 * lacks a suffix would hide the editor the author asked for. `.json` and the
 * like still open as source: the exception is the *absence* of a suffix, not the
 * presence of an unfamiliar one.
 * @param path - project-relative path, as the file tree spells it.
 * @returns true when the file should open in the rendered editor.
 */
export function isMarkdownPath(path: string): boolean {
  const name = path.trim().split('/').pop() ?? ''
  if (/\.(?:md|markdown)$/i.test(name)) return true
  return !/\.[A-Za-z0-9]+$/.test(name)
}

/**
 * The mode a file opens in.
 *
 * Markdown opens as the rendered document, editable in place — that is the
 * default the author asked for, and it is also the reading mode. Any other file
 * opens in the source editor, because a rendered `data.json` would be a worse
 * editor than the text itself.
 * @param path - the file being opened, absent when none is.
 * @returns the mode to start in.
 */
export function initialEditorMode(path: string | undefined): EditorMode {
  return path !== undefined && isMarkdownPath(path) ? 'wysiwyg' : 'source'
}

/**
 * The other mode.
 * @param mode - the current mode.
 * @returns `source` for `wysiwyg`, and the reverse.
 */
export function nextEditorMode(mode: EditorMode): EditorMode {
  return mode === 'wysiwyg' ? 'source' : 'wysiwyg'
}

/** Which controls the row above the file offers. */
export interface EditorControls {
  /** The 写作 / 源码 pair — only a file with something to render has both modes. */
  toggle: boolean
}

/**
 * The row's controls, as one decision.
 *
 * There is no save button any more: the page autosaves, and `Ctrl/Cmd+S` still
 * forces a write. A button whose only remaining job was to say "I already did
 * this" was one more thing between the author and the page.
 *
 * Pure, so the artifact check asserts the row's shape without a render it cannot
 * reach (the stub render has no file open, and this branch needs one).
 * @param previewable - whether the open file has a rendered form at all.
 * @returns which controls to draw.
 */
export function editorControls(previewable: boolean): EditorControls {
  return { toggle: previewable }
}

/** A fence line: the marker run and whatever the info string says after it. */
const FENCE = /^\s*(`{3,}|~{3,})\s*(.*)$/
/** A fence that closes a block (no info string). */
const CLOSING_FENCE = /^\s*(?:`{3,}|~{3,})\s*$/
/** An ATX heading. */
const HEADING = /^(#{1,6})\s+(.*)$/
/** A thematic break: three or more of one marker, spaces allowed between. */
const RULE = /^\s*(?:[-*_]\s*){3,}$/
/** A quoted line, with the space after `>` optional. */
const QUOTE = /^\s*>\s?(.*)$/
/** An unordered list item. */
const BULLET = /^\s*[-*+]\s+(.*)$/
/** An ordered list item, `1.` or `1)`. */
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
/** The `---` line a document may open with, and the one that closes it. */
const FRONT_MATTER = /^-{3,}\s*$/
/** A character that glues `_` to its word, so `snake_case` is not emphasis. */
const WORD_CHAR = /[\p{L}\p{N}]/u
/** Where an inline run may start. */
const MARKER = /[`*_[]/
/** A link, in inline form only. */
const LINK = /^\[([^\]\n]*)\]\(([^)\n]*)\)/
/** Destinations the panel may open. */
const OPENABLE = /^(?:https?:|mailto:)/i
/** Any scheme at all, so `javascript:` and `data:` are recognised as one. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
/** How deep emphasis may nest before the rest is drawn as text. */
const MAX_DEPTH = 3

/**
 * Read a document into blocks.
 * @param text - the file's contents.
 * @returns the blocks, in order.
 */
export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0

  // Front matter is what the author wrote at the top of the file, not a
  // horizontal rule plus prose: it is shown, quoted, as the block it is — and only
  // at the very top, because a `---` further down is a scene break.
  if (FRONT_MATTER.test(lines[0] ?? '')) {
    const end = lines.findIndex((line, at) => at > 0 && FRONT_MATTER.test(line))
    if (end > 0) {
      blocks.push({ kind: 'meta', text: lines.slice(1, end).join('\n'), raw: lines.slice(0, end + 1).join('\n') })
      index = end + 1
    }
  }

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim().length === 0) {
      index += 1
      continue
    }

    // Where this block starts, so its own spelling can travel with it: an
    // edited block is re-emitted from the document, an untouched one from here.
    const start = index

    const fence = FENCE.exec(line)
    if (fence !== null) {
      const body: string[] = []
      let cursor = index + 1
      while (cursor < lines.length && !CLOSING_FENCE.test(lines[cursor] ?? '')) {
        body.push(lines[cursor] ?? '')
        cursor += 1
      }
      index = cursor < lines.length ? cursor + 1 : cursor
      blocks.push({
        kind: 'code',
        language: (fence[2] ?? '').trim().split(/\s+/)[0] ?? '',
        text: body.join('\n'),
        raw: lines.slice(start, index).join('\n'),
      })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      index += 1
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        // A closing run of `#`s is punctuation, not part of the title.
        spans: inline((heading[2] ?? '').replace(/\s+#+\s*$/, '').trim()),
        raw: lines.slice(start, index).join('\n'),
      })
      continue
    }

    // Before the list rule: `- - -` is a break, and it also looks like an item.
    if (RULE.test(line)) {
      index += 1
      blocks.push({ kind: 'rule', raw: lines.slice(start, index).join('\n') })
      continue
    }

    const table = tableAt(lines, index)
    if (table !== undefined) {
      index = table.next
      const parsed = table.block
      parsed.raw = lines.slice(start, index).join('\n')
      blocks.push(parsed)
      continue
    }

    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)
    if (bullet !== null || numbered !== null) {
      const ordered = bullet === null
      const raw: string[] = []
      while (index < lines.length) {
        const item = ordered ? NUMBERED.exec(lines[index] ?? '') : BULLET.exec(lines[index] ?? '')
        if (item !== null) {
          raw.push(item[1] ?? '')
          index += 1
          continue
        }
        // An indented line continues the item above it, which is how a long item
        // is written in a file rather than on one endless line. The line break is
        // kept as a break, like every other one (see `PARAGRAPH NOTE`).
        if (raw.length > 0 && /^\s{2,}\S/.test(lines[index] ?? '')) {
          const above = raw[raw.length - 1] ?? ''
          raw[raw.length - 1] = `${above}\n${(lines[index] ?? '').trim()}`
          index += 1
          continue
        }
        break
      }
      blocks.push({ kind: 'list', ordered, items: raw.map(item => inline(item)), raw: lines.slice(start, index).join('\n') })
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote !== null) {
      const parts: string[] = []
      while (index < lines.length) {
        const part = QUOTE.exec(lines[index] ?? '')
        if (part === null) break
        parts.push(part[1] ?? '')
        index += 1
      }
      blocks.push({ kind: 'quote', spans: inline(parts.join('\n')), raw: lines.slice(start, index).join('\n') })
      continue
    }

    // A paragraph runs until a blank line or the start of another block, which is
    // what keeps a heading or a list from being swallowed into the prose above it.
    const parts: string[] = []
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (next.trim().length === 0 || startsBlock(next)) break
      parts.push(next.trim())
      index += 1
    }
    // PARAGRAPH NOTE: one newline in the file is one line break on the page.
    // Markdown's own rule — a single newline joins the lines into one paragraph —
    // is the one thing about markdown every author trips over, and this editor is
    // for writing prose, not for writing markdown. So the lines are joined with a
    // break marker, which the document model turns into a hard break.
    blocks.push({ kind: 'paragraph', spans: inline(parts.join('\n')), raw: lines.slice(start, index).join('\n') })
  }

  return blocks
}

/** Whether a line begins a block of its own rather than continuing a paragraph. */
function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line)
    || BULLET.test(line) || NUMBERED.test(line) || QUOTE.test(line)
}

/** A table's cells: the row split on `|`, with the outer pipes dropped. */
function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

/**
 * The delimiter row of a table, if that is what a line is.
 *
 * A pipe is required, so a bare `---` stays the thematic break it looks like.
 * @param line - the line under the header row.
 * @returns the delimiter cells, or undefined when the line is not one.
 */
function delimiterRow(line: string): string[] | undefined {
  if (!line.includes('|')) return undefined
  const cells = splitRow(line)
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell)) ? cells : undefined
}

/**
 * A table starting at a line, when the line below it is a delimiter row.
 * @param lines - every line.
 * @param index - the candidate header row.
 * @returns the block and the line after the last row it consumed, or undefined.
 */
function tableAt(lines: string[], index: number): { block: Block; next: number } | undefined {
  const header = lines[index] ?? ''
  if (!header.includes('|')) return undefined
  const delimiters = delimiterRow(lines[index + 1] ?? '')
  if (delimiters === undefined) return undefined

  const align: ColumnAlign[] = delimiters.map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    return left ? 'left' : right ? 'right' : undefined
  })
  const head = splitRow(header).map(cell => inline(cell))
  const rows: Span[][][] = []
  let cursor = index + 2
  while (cursor < lines.length) {
    const row = lines[cursor] ?? ''
    if (row.trim().length === 0 || !row.includes('|')) break
    const cells = splitRow(row).map(cell => inline(cell))
    // Padded to the header's width, so a short row renders as the gaps it left.
    rows.push(align.map((_, column) => cells[column] ?? []))
    cursor += 1
  }
  return { block: { kind: 'table', align, head, rows, raw: '' }, next: cursor }
}

/**
 * Read inline markdown into spans.
 * @param text - the line, without its block marker.
 * @param depth - nesting level, which stops a pathological document from recursing.
 * @returns the spans, in order.
 */
function inline(text: string, depth = 0): Span[] {
  const spans: Span[] = []
  let index = 0

  const add = (span: Span): void => {
    const last = spans[spans.length - 1]
    if (span.kind === 'text' && last !== undefined && last.kind === 'text') {
      spans[spans.length - 1] = { kind: 'text', text: last.text + span.text }
      return
    }
    spans.push(span)
  }

  while (index < text.length) {
    const rest = text.slice(index)
    const char = rest.slice(0, 1)

    if (char === '`') {
      const run = /^`+/.exec(rest)?.[0] ?? '`'
      const end = rest.indexOf(run, run.length)
      if (end > 0) {
        add({ kind: 'code', text: rest.slice(run.length, end).trim() })
        index += end + run.length
        continue
      }
    }

    if (char === '*' || char === '_') {
      const doubled = rest.startsWith(char + char)
      const marker = doubled ? char + char : char
      // `_` inside a word is part of the word: `_tracking-连续` is an identifier,
      // not emphasis, and a file naming its own ledgers must survive the preview.
      const glued = char === '_' && WORD_CHAR.test(text.slice(index - 1, index))
      const inner = glued ? undefined : emphasisBody(rest, marker)
      if (inner !== undefined) {
        add(depth >= MAX_DEPTH
          ? { kind: 'text', text: inner }
          : { kind: doubled ? 'strong' : 'em', spans: inline(inner, depth + 1) })
        index += marker.length * 2 + inner.length
        continue
      }
    }

    if (char === '[') {
      const link = LINK.exec(rest)
      const href = link === null ? undefined : openableHref(link[2] ?? '')
      if (link !== null && href !== undefined) {
        add({ kind: 'link', text: link[1] ?? '', href })
        index += link[0].length
        continue
      }
      // A destination the panel cannot open is left as the markdown it is, so the
      // author sees what the file says instead of a link that goes nowhere.
    }

    // Plain text up to the next marker, so the scan never advances by zero.
    const at = rest.slice(1).search(MARKER)
    const take = at < 0 ? rest.length : at + 1
    add({ kind: 'text', text: rest.slice(0, take) })
    index += take
  }

  return spans
}

/**
 * The text between a pair of emphasis markers.
 * @param rest - the text from the opening marker on.
 * @param marker - the marker, one or two characters.
 * @returns the inner text, or undefined when the marker never closes.
 */
function emphasisBody(rest: string, marker: string): string | undefined {
  const body = rest.slice(marker.length)
  if (body.length === 0 || /^\s/.test(body)) return undefined
  for (let at = body.indexOf(marker); at > 0; at = body.indexOf(marker, at + 1)) {
    const inner = body.slice(0, at)
    if (inner.includes('\n')) return undefined
    if (!/\s$/.test(inner)) return inner
  }
  return undefined
}

/**
 * A link destination the panel may open.
 * @param href - whatever the document put in the parentheses.
 * @returns the destination, or undefined when it has to stay text.
 */
function openableHref(href: string): string | undefined {
  const trimmed = href.trim()
  if (trimmed.length === 0) return undefined
  // `//host` borrows the page's scheme and leaves the panel entirely; relative
  // paths and `#anchors` are the author pointing at their own files.
  if (trimmed.startsWith('//')) return undefined
  if (SCHEME.test(trimmed)) return OPENABLE.test(trimmed) ? trimmed : undefined
  return trimmed
}
