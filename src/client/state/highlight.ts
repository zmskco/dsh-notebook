/**
 * Syntax colour for the two places this notebook shows code: a fenced block on
 * the rendered page, and the source editor behind a file that is not prose.
 *
 * The engine is highlight.js through lowlight, and the choice is about the
 * *shape* of the answer more than about its colours. lowlight returns a tree
 * (hast), which both surfaces can consume — the rendered page turns it into
 * ProseMirror decorations, the source editor into React spans — while a
 * highlighter that answers with an HTML string would force one of the two to
 * parse markup back. It is also plain JavaScript: no WASM, no worker, no second
 * runtime to load inside a panel bundle, and nothing to fetch at read time.
 *
 * Only a curated set of grammars is registered. lowlight's `common` set is
 * thirty-odd languages, most of which a notebook's fences and files never name,
 * and every grammar is bytes a reader downloads before a page opens.
 * {@link HIGHLIGHTED_LANGUAGES} is the set; anything else is drawn as plain
 * text, which is never an error: a fence naming a language we do not carry is
 * still a fence the author wrote, and a document that guessed at it would be
 * saying something the author did not.
 *
 * Pure: string in, spans out. The artifact check drives this module directly —
 * the colouring is the feature, and it has to be readable as data, not only
 * through a render it cannot reach.
 *
 * @module notebook/client/state/highlight
 */
import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import clojure from 'highlight.js/lib/languages/clojure'
import cmake from 'highlight.js/lib/languages/cmake'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dart from 'highlight.js/lib/languages/dart'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import dos from 'highlight.js/lib/languages/dos'
import elixir from 'highlight.js/lib/languages/elixir'
import go from 'highlight.js/lib/languages/go'
import graphql from 'highlight.js/lib/languages/graphql'
import haskell from 'highlight.js/lib/languages/haskell'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import lua from 'highlight.js/lib/languages/lua'
import makefile from 'highlight.js/lib/languages/makefile'
import markdown from 'highlight.js/lib/languages/markdown'
import nix from 'highlight.js/lib/languages/nix'
import perl from 'highlight.js/lib/languages/perl'
import php from 'highlight.js/lib/languages/php'
import powershell from 'highlight.js/lib/languages/powershell'
import protobuf from 'highlight.js/lib/languages/protobuf'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scala from 'highlight.js/lib/languages/scala'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import type { LanguageFn } from 'highlight.js'
import { isMarkdownPath } from './markdown'

/**
 * The grammars this panel carries, by the name highlight.js knows them by.
 *
 * The list is the notebook's reading list, not a language ranking: the prose
 * languages a manuscript's fences hold (markdown, diff, ini for a config
 * excerpt), the languages a working directory's `src/` is full of, and the build
 * files {@link languageForPath} can meet by name. What is *not* here is the whole
 * of highlight.js: a word this set does not know is drawn plain, and the fence
 * is still the fence the author wrote.
 */
const GRAMMARS: Record<string, LanguageFn> = {
  bash,
  clojure,
  cmake,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  dos,
  elixir,
  go,
  graphql,
  haskell,
  ini,
  java,
  javascript,
  json,
  kotlin,
  lua,
  makefile,
  markdown,
  nix,
  perl,
  php,
  powershell,
  protobuf,
  python,
  r,
  ruby,
  rust,
  scala,
  sql,
  swift,
  typescript,
  xml,
  yaml,
}

const lowlight = createLowlight(GRAMMARS)

/** The canonical language ids this panel can colour, sorted for a stable answer. */
export const HIGHLIGHTED_LANGUAGES: readonly string[] = Object.keys(GRAMMARS).sort()

const REGISTERED = new Set(HIGHLIGHTED_LANGUAGES)

/**
 * The names a fence or a file actually uses, grouped by the grammar that reads
 * them.
 *
 * highlight.js registers its own aliases too, but this table is the one the
 * artifact check can read: it is data, it is here, and every canonical name in
 * it is asserted to be a registered grammar. What is deliberately *not* here is
 * a guess — `c` is C, not C++; `vue` is XML markup, not a framework — and a
 * word this table does not know stays uncoloured.
 */
const ALIASES: readonly (readonly [string, readonly string[]])[] = [
  ['javascript', ['js', 'jsx', 'mjs', 'cjs', 'node']],
  ['typescript', ['ts', 'tsx', 'mts', 'cts']],
  ['xml', ['html', 'htm', 'xhtml', 'svg', 'vue', 'xsl']],
  ['bash', ['sh', 'shell', 'zsh', 'console', 'shell-session']],
  ['yaml', ['yml']],
  ['python', ['py', 'python3']],
  ['markdown', ['md', 'mdown', 'mkd']],
  ['json', ['jsonc', 'json5', 'jsonl', 'ndjson']],
  ['rust', ['rs']],
  ['go', ['golang']],
  ['cpp', ['c', 'h', 'cc', 'c++', 'hpp', 'hxx', 'cxx']],
  ['csharp', ['cs', 'c#']],
  ['ruby', ['rb']],
  ['php', ['php5', 'php7']],
  ['powershell', ['ps1', 'pwsh', 'ps']],
  ['dockerfile', ['docker', 'containerfile']],
  ['makefile', ['make', 'mk']],
  ['sql', ['mysql', 'pgsql', 'postgres', 'plsql']],
  ['ini', ['toml', 'cfg', 'conf', 'properties', 'editorconfig', 'env']],
  ['diff', ['patch']],
  ['css', ['scss', 'sass', 'less', 'styl']],
  ['dos', ['bat', 'cmd', 'batch']],
  ['cmake', ['cmakelists']],
  ['graphql', ['gql']],
  ['haskell', ['hs']],
  ['clojure', ['clj', 'cljs', 'edn']],
  ['elixir', ['ex', 'exs']],
  ['kotlin', ['kt', 'kts']],
  ['scala', []],
  ['dart', []],
  ['swift', []],
  ['r', ['rscript']],
  ['perl', ['pl', 'pm']],
  ['nix', []],
  ['protobuf', ['proto']],
  ['java', []],
  ['lua', []],
]

const ALIAS = new Map<string, string>()
for (const [canonical, names] of ALIASES) {
  for (const name of names) ALIAS.set(name, canonical)
}

/**
 * One run of text and the colour it is drawn in.
 *
 * The spans of one call always cover the input exactly, in order; a plain run
 * carries an empty class. That is the contract both surfaces rely on: the
 * rendered page maps offsets onto ProseMirror positions, and the source editor
 * draws the text back verbatim behind its textarea. If the colouring could ever
 * lose or reorder a character, the editor would show a different file from the
 * one it saves.
 */
export interface HighlightSpan {
  /** The characters of this run. */
  text: string
  /** Its class name, or `''` for uncoloured text. */
  className: string
}

/**
 * The colour vocabulary, as class names.
 *
 * highlight.js names around a hundred scopes; a reader needs about eighteen
 * distinctions, and fewer names is what makes four themes explicable. Each class
 * is a real literal here rather than a name built from the scope, so the
 * stylesheet can be checked against the vocabulary that actually ships.
 */
const TOKEN_CLASS = {
  comment: 'dsh-notebook-hl-comment',
  keyword: 'dsh-notebook-hl-keyword',
  builtin: 'dsh-notebook-hl-builtin',
  literal: 'dsh-notebook-hl-literal',
  number: 'dsh-notebook-hl-number',
  string: 'dsh-notebook-hl-string',
  regexp: 'dsh-notebook-hl-regexp',
  symbol: 'dsh-notebook-hl-symbol',
  title: 'dsh-notebook-hl-title',
  attr: 'dsh-notebook-hl-attr',
  variable: 'dsh-notebook-hl-variable',
  meta: 'dsh-notebook-hl-meta',
  operator: 'dsh-notebook-hl-operator',
  addition: 'dsh-notebook-hl-addition',
  deletion: 'dsh-notebook-hl-deletion',
  link: 'dsh-notebook-hl-link',
  emphasis: 'dsh-notebook-hl-emphasis',
  strong: 'dsh-notebook-hl-strong',
} as const

/** Every class the colouring can put on a run, sorted. */
export const HIGHLIGHT_CLASSES: readonly string[] = Object.values(TOKEN_CLASS).sort()

/**
 * highlight.js scope to this panel's token.
 *
 * A scope missing from the table is not a mistake to report: the run simply
 * inherits the colour of the text around it, which is what an unclassified
 * identifier should look like. Nested scopes work the same way — the walk below
 * hands the nearest mapped colour down, so an unmapped span inside a string is
 * still string-coloured.
 */
const TOKEN_OF_SCOPE = new Map<string, keyof typeof TOKEN_CLASS>([
  ['comment', 'comment'],
  ['quote', 'comment'],
  ['keyword', 'keyword'],
  ['built_in', 'builtin'],
  ['type', 'builtin'],
  ['literal', 'literal'],
  ['boolean', 'literal'],
  ['number', 'number'],
  ['string', 'string'],
  ['char', 'string'],
  ['escape', 'string'],
  ['regexp', 'regexp'],
  ['symbol', 'symbol'],
  ['bullet', 'symbol'],
  ['title', 'title'],
  ['function', 'title'],
  ['class', 'title'],
  ['section', 'title'],
  ['name', 'title'],
  ['tag', 'title'],
  ['selector-tag', 'title'],
  ['selector-id', 'title'],
  ['selector-class', 'title'],
  ['attr', 'attr'],
  ['attribute', 'attr'],
  ['property', 'attr'],
  ['selector-attr', 'attr'],
  ['selector-pseudo', 'attr'],
  ['params', 'variable'],
  ['variable', 'variable'],
  ['template-variable', 'variable'],
  ['subst', 'variable'],
  ['meta', 'meta'],
  ['doctag', 'meta'],
  ['meta-keyword', 'meta'],
  ['meta-string', 'meta'],
  ['operator', 'operator'],
  ['punctuation', 'operator'],
  ['addition', 'addition'],
  ['deletion', 'deletion'],
  ['link', 'link'],
  ['emphasis', 'emphasis'],
  ['strong', 'strong'],
])

/**
 * A node of the hast tree, as much of it as this module reads.
 *
 * Declared structurally rather than imported from `hast`: the tree crosses a
 * package boundary, and a shape this small is cheaper to state than to depend
 * on a type package that lowlight could rename.
 */
interface ColourNode {
  type?: string
  value?: string
  properties?: { className?: unknown }
  children?: ColourNode[]
}

/**
 * The colour one element asks for, or `''`.
 *
 * highlight.js emits `hljs-<scope>`, plus a bare variant word on the same
 * element for a narrowed scope (`hljs-title function_`). Both are read here:
 * the scope is what is left after the prefix, and a trailing underscore is the
 * variant's spelling, not part of the name.
 * @param node - an element of the hast tree.
 * @returns a class from {@link TOKEN_CLASS}, or `''`.
 */
function classOfElement(node: ColourNode): string {
  const raw = node.properties?.className
  const names = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\s+/) : []
  for (const name of names) {
    if (typeof name !== 'string') continue
    const scope = name.replace(/^hljs-/, '').replace(/_+$/, '')
    const token = TOKEN_OF_SCOPE.get(scope)
    if (token !== undefined) return TOKEN_CLASS[token]
  }
  return ''
}

/**
 * The canonical grammar behind a fence's info string or a language name.
 * @param language - what the fence said, e.g. `ts` or `typescript`.
 * @returns the registered id, or undefined when this panel carries no grammar.
 */
export function normalizeLanguage(language: string | undefined): string | undefined {
  if (language === undefined) return undefined
  // A fence's info string can carry more than a name (`ts title="x"`), and a
  // leading dot is how some files spell their own type.
  const word = (language.trim().split(/\s+/)[0] ?? '').toLowerCase().replace(/^\./, '')
  if (word.length === 0) return undefined
  const canonical = ALIAS.get(word) ?? word
  return REGISTERED.has(canonical) ? canonical : undefined
}

/** The extensionless names whose format is a grammar, not prose. */
const BY_NAME = new Map<string, string>([
  ['dockerfile', 'dockerfile'],
  ['containerfile', 'dockerfile'],
  ['makefile', 'makefile'],
  ['gnumakefile', 'makefile'],
  ['rakefile', 'ruby'],
  ['gemfile', 'ruby'],
  ['.npmrc', 'ini'],
  ['.editorconfig', 'ini'],
])

/**
 * The grammar a file is read with, from its own name.
 *
 * The order is deliberate. A name in {@link BY_NAME} wins because it *is* the
 * format (`Dockerfile` has no extension, and its bytes are not prose). Then
 * markdown, by the editor's own predicate — the same one that decides which
 * surface a file opens in, so the two can never disagree about a chapter.
 * Only then the extension, through {@link normalizeLanguage}, so a fence's `ts`
 * and a file's `.ts` can never mean two different grammars. A file whose type
 * this panel does not know opens uncoloured rather than in the nearest guess.
 * @param path - project-relative path, as the file tree spells it.
 * @returns a registered grammar id, or undefined.
 */
export function languageForPath(path: string): string | undefined {
  const name = (path.trim().split('/').pop() ?? '').toLowerCase()
  if (name.length === 0) return undefined
  const named = BY_NAME.get(name)
  if (named !== undefined) return named
  if (isMarkdownPath(name)) return 'markdown'
  const dot = name.lastIndexOf('.')
  if (dot < 0) return undefined
  return normalizeLanguage(name.slice(dot + 1))
}

/**
 * Beyond this many characters the colour is not worth the keystroke.
 *
 * The page is a notebook, not an IDE: a pasted log or a minified bundle is a
 * file to read, and colouring it on every keystroke — inside a render, on the
 * main thread — would make typing in it slow. Such a file is drawn plain, which
 * is still the whole file; the source view says so rather than leaving the
 * absence of colour to be read as a fault.
 */
export const MAX_COLOURED_CHARS = 60_000

/**
 * Colour a piece of code.
 *
 * The spans returned always cover the input exactly: concatenating their text
 * gives back `code`, in order. `code` itself is never trimmed, escaped or
 * re-wrapped — the caller draws the original string, and this function only
 * says which of its runs go in which colour.
 * @param code - the block's text, exactly as it is written.
 * @param language - the fence's info string, or a name from {@link languageForPath}.
 * @returns spans covering the input; one plain span when the language is
 * unknown, too large, or the highlighter refuses it.
 */
export function highlightCode(code: string, language: string | undefined): HighlightSpan[] {
  if (code.length === 0) return []
  const plain: HighlightSpan[] = [{ text: code, className: '' }]
  const id = normalizeLanguage(language)
  if (id === undefined || code.length > MAX_COLOURED_CHARS) return plain

  let tree: unknown
  try {
    tree = lowlight.highlight(id, code)
  } catch {
    // A grammar that throws on this input is a reason to draw text, not to take
    // the editor down with it.
    return plain
  }

  const spans: HighlightSpan[] = []
  let covered = 0
  const add = (text: string, className: string): void => {
    if (text.length === 0) return
    covered += text.length
    const last = spans[spans.length - 1]
    if (last !== undefined && last.className === className) {
      spans[spans.length - 1] = { text: last.text + text, className }
      return
    }
    spans.push({ text, className })
  }
  const visit = (node: ColourNode, inherited: string): void => {
    if (node.type === 'text') {
      add(typeof node.value === 'string' ? node.value : '', inherited)
      return
    }
    const own = classOfElement(node)
    const colour = own.length > 0 ? own : inherited
    for (const child of node.children ?? []) visit(child, colour)
  }
  visit(tree as ColourNode, '')

  // The walk must reproduce the input character for character. Colour at the
  // wrong offset would be read as fact, so a mismatch is drawn plain instead.
  if (covered !== code.length) return plain
  if (spans.map(span => span.text).join('') !== code) return plain
  return spans
}

/**
 * The grammar ids actually registered in the running instance.
 *
 * Read from lowlight rather than from {@link HIGHLIGHTED_LANGUAGES} so the
 * artifact check can prove the two agree: a table naming a grammar that was
 * never registered colours nothing, silently.
 * @returns the registered ids, sorted.
 */
export function highlightLanguages(): string[] {
  return lowlight.listLanguages().sort()
}
