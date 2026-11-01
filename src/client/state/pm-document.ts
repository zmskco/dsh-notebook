/**
 * The markdown manuscript as a ProseMirror document, and back again.
 *
 * The file on disk stays markdown. This module is the only place that translates
 * between the two worlds:
 *
 * - **In:** `parseMarkdown` (our own, already tested reader) splits the file into
 *   blocks; each block becomes a schema node. A block the schema cannot express —
 *   front matter, a table, anything the reader rejects — becomes a `raw_block`
 *   that carries its original markdown verbatim.
 * - **Out:** `prosemirror-markdown`'s serializer writes every modelled node back
 *   as markdown; a `raw_block` is copied out character for character, so a file's
 *   front matter or table survives an editing session untouched.
 *
 * The split is deliberate: the *reader* decides where blocks begin and end (it is
 * the same reader the model tools and the old preview used, and it understands
 * CJK soft breaks), while ProseMirror owns editing. It also means a construct we
 * have not taught the schema about degrades to "kept exactly as written" rather
 * than to "silently dropped", which is the failure a writer would never forgive.
 */
import { Schema } from 'prosemirror-model'
import type { Node as PMNode, Mark, MarkType, NodeSpec, NodeType } from 'prosemirror-model'
import { schema as basicSchema } from 'prosemirror-schema-basic'
import { addListNodes } from 'prosemirror-schema-list'
import { parseMarkdown } from './markdown'
import type { Block, Span } from './markdown'

/**
 * A block this editor does not model, kept as the markdown it was written as.
 *
 * It renders as a monospace block so the author can see it is not being edited
 * richly — a table or a `---` front-matter header, shown as its own text.
 */
const rawBlockSpec: NodeSpec = {
  content: 'text*',
  marks: '',
  group: 'block',
  defining: true,
  parseDOM: [{ tag: 'pre[data-raw]' }],
  toDOM: () => ['pre', { class: 'dsh-notebook-pmRaw', 'data-raw': 'true' }, 0],
}

/**
 * The fenced-code node, with the info string kept.
 *
 * `schema-basic`'s `code_block` has no `params` attribute — the info string after
 * the fence is only in the markdown example schema. Without it, opening and saving
 * a file would quietly drop ```json from every fenced block.
 */
const codeBlockSpec: NodeSpec = {
  ...(basicSchema.spec.nodes.get('code_block') ?? {}),
  attrs: { params: { default: '' } },
}

const nodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block')
  .update('code_block', codeBlockSpec)
  .addToEnd('raw_block', rawBlockSpec)

/** The document schema: basic markdown blocks, lists, and the raw fallback. */
export const schema = new Schema({ nodes, marks: basicSchema.spec.marks })

/**
 * One node type of {@link schema}.
 *
 * `Schema.nodes` is an index signature, so every lookup is `NodeType | undefined`
 * to the type checker. Resolving them once, here, is both the type-safe access and
 * a real check: a schema that lost a node fails at load with the name it lost.
 */
function nodeType(name: string): NodeType {
  const found = schema.nodes[name]
  if (found === undefined) throw new Error(`the document schema has no "${name}" node`)
  return found
}

/** The node types this module builds documents from. */
export const documentNodes = {
  doc: nodeType('doc'),
  paragraph: nodeType('paragraph'),
  heading: nodeType('heading'),
  blockquote: nodeType('blockquote'),
  codeBlock: nodeType('code_block'),
  horizontalRule: nodeType('horizontal_rule'),
  bulletList: nodeType('bullet_list'),
  orderedList: nodeType('ordered_list'),
  listItem: nodeType('list_item'),
  hardBreak: nodeType('hard_break'),
  rawBlock: nodeType('raw_block'),
}

/** The marks this module applies; resolved for the same reason the nodes are. */
function markType(name: string): MarkType {
  const found = schema.marks[name]
  if (found === undefined) throw new Error(`the document schema has no "${name}" mark`)
  return found
}

/** The marks a manuscript's inline runs use. */
export const documentMarks = {
  strong: markType('strong'),
  em: markType('em'),
  code: markType('code'),
  link: markType('link'),
}

/**
 * Build the text nodes for one run, turning a newline into a hard break.
 *
 * The reader keeps a line break inside the run — a paragraph's lines are joined
 * with `\n`, because one newline in the file is one line on the page (see
 * `PARAGRAPH NOTE` in `markdown.ts`). ProseMirror has no newline inside a text
 * node: it has a `hard_break` node, which is also what the serializer writes back.
 */
function textNodes(text: string, marks: readonly Mark[]): PMNode[] {
  if (text.length === 0) return []
  const out: PMNode[] = []
  text.split('\n').forEach((line, at) => {
    if (at > 0) out.push(documentNodes.hardBreak.create())
    if (line.length > 0) out.push(schema.text(line, marks))
  })
  return out
}

/** Turn parsed inline spans into ProseMirror nodes, threading marks down. */
function inline(spans: Span[], marks: readonly Mark[] = []): PMNode[] {
  const out: PMNode[] = []
  for (const span of spans) {
    switch (span.kind) {
      case 'text':
        out.push(...textNodes(span.text, marks))
        break
      case 'code':
        out.push(...textNodes(span.text, [...marks, documentMarks.code.create()]))
        break
      case 'strong':
        out.push(...inline(span.spans, [...marks, documentMarks.strong.create()]))
        break
      case 'em':
        out.push(...inline(span.spans, [...marks, documentMarks.em.create()]))
        break
      case 'link':
        out.push(...textNodes(span.text, [...marks, documentMarks.link.create({ href: span.href })]))
        break
    }
  }
  return out
}

/** A paragraph out of a run of spans, which is what most blocks reduce to. */
function paragraphOf(spans: Span[]): PMNode {
  return documentNodes.paragraph.create(null, inline(spans))
}

/** One raw block, holding the markdown exactly as the reader found it. */
function rawBlock(text: string): PMNode {
  return documentNodes.rawBlock.create(null, text.length === 0 ? [] : schema.text(text))
}

/** The markdown a block was read from, for the kinds kept verbatim. */
function rawOf(block: Block): string {
  return block.raw
}

/**
 * Read a markdown file into a ProseMirror document.
 * @param text - the file's contents.
 * @returns a document the editor can hold.
 */
export function documentFromMarkdown(text: string): PMNode {
  const content: PMNode[] = []
  for (const block of parseMarkdown(text)) {
    switch (block.kind) {
      case 'meta':
      case 'table':
        content.push(rawBlock(rawOf(block)))
        break
      case 'heading':
        content.push(documentNodes.heading.create({ level: block.level }, inline(block.spans)))
        break
      case 'paragraph':
        content.push(paragraphOf(block.spans))
        break
      case 'list': {
        const items = block.items.map(item =>
          documentNodes.listItem.create(null, paragraphOf(item)))
        content.push((block.ordered ? documentNodes.orderedList : documentNodes.bulletList)
          .create(block.ordered ? { order: 1 } : null, items))
        break
      }
      case 'quote':
        content.push(documentNodes.blockquote.create(null, paragraphOf(block.spans)))
        break
      case 'code':
        content.push(documentNodes.codeBlock.create(
          { params: block.language },
          block.text.length === 0 ? [] : schema.text(block.text),
        ))
        break
      case 'rule':
        content.push(documentNodes.horizontalRule.create())
        break
    }
  }
  // A `doc` needs at least one block: an empty file opens on an empty paragraph,
  // not on an invalid document.
  if (content.length === 0) content.push(documentNodes.paragraph.create())
  return documentNodes.doc.create(null, content)
}

/** The children of a node, as a plain array. */
function childrenOf(node: PMNode): PMNode[] {
  return [...node.content.content]
}

/** Escape the characters that would otherwise start an inline mark. */
function escapeText(text: string): string {
  return text.replace(/([\\*_`[])/g, '\\$1')
}

/**
 * Write one inline run back as markdown.
 *
 * The writer is deliberately small: it is the inverse of {@link inline}, so what
 * the reader understood is what comes back. Escaping only covers the characters
 * that would otherwise open a marker, so ordinary Chinese prose is written out
 * untouched.
 */
function inlineMarkdown(parent: PMNode): string {
  let out = ''
  parent.forEach((child) => {
    if (child.isText) {
      const raw = child.text ?? ''
      if (raw.length === 0) return
      const code = child.marks.find(mark => mark.type === documentMarks.code)
      let piece = code === undefined ? escapeText(raw) : raw
      if (code !== undefined) piece = `\`${piece}\``
      if (child.marks.some(mark => mark.type === documentMarks.strong)) piece = `**${piece}**`
      if (child.marks.some(mark => mark.type === documentMarks.em)) piece = `*${piece}*`
      const link = child.marks.find(mark => mark.type === documentMarks.link)
      if (link !== undefined) piece = `[${piece}](${String(link.attrs.href ?? '')})`
      out += piece
      return
    }
    // A hard break is written as two trailing spaces and a newline — the markdown
    // way of saying "break here" that every other renderer also understands.
    out += child.type.name === 'hard_break' ? '  \n' : inlineMarkdown(child)
  })
  return out
}

/** One list item, its marker and its continuation indent. */
function listItemMarkdown(item: PMNode, marker: string): string {
  const inner = documentBlocks(item).trimEnd()
  return inner
    .split('\n')
    .map((line, at) => (at === 0 ? `${marker}${line}` : `  ${line}`))
    .join('\n')
}

/** One block-level node, as markdown. */
function blockMarkdown(node: PMNode): string {
  switch (node.type.name) {
    case 'paragraph':
      return inlineMarkdown(node)
    case 'heading':
      return `${'#'.repeat(Number(node.attrs.level ?? 1))} ${inlineMarkdown(node)}`
    case 'blockquote':
      return documentBlocks(node)
        .trimEnd()
        .split('\n')
        .map(line => (line.length === 0 ? '>' : `> ${line}`))
        .join('\n')
    case 'bullet_list':
      return childrenOf(node).map(item => listItemMarkdown(item, '- ')).join('\n')
    case 'ordered_list': {
      const start = Number(node.attrs.order ?? 1)
      return childrenOf(node)
        .map((item, at) => listItemMarkdown(item, `${String(start + at)}. `))
        .join('\n')
    }
    case 'list_item':
      return documentBlocks(node).trimEnd()
    case 'code_block': {
      const params = String(node.attrs.params ?? '')
      return `\`\`\`${params}\n${node.textContent}\n\`\`\``
    }
    case 'horizontal_rule':
      return '---'
    case 'raw_block':
      // Verbatim: front matter and tables are written out exactly as they came in.
      return node.textContent
    default:
      return inlineMarkdown(node)
  }
}

/** A node's block children, joined with a blank line between them. */
function documentBlocks(node: PMNode): string {
  const parts = childrenOf(node).map(child => blockMarkdown(child)).filter(text => text.length > 0)
  return parts.join('\n\n')
}

/**
 * Write a ProseMirror document back as markdown.
 *
 * Blocks are separated by one blank line and the file ends with a newline, the
 * shape every editor writes. A `raw_block` comes out character for character, so
 * the parts the schema does not model survive an editing session untouched.
 * @param doc - the document being edited.
 * @returns the file's new contents.
 */
export function markdownFromDocument(doc: PMNode): string {
  const body = documentBlocks(doc)
  return body.length === 0 ? '' : `${body}\n`
}
