/**
 * Verify the built Client artifact against the module-system contract.
 *
 * `lib/client.js` is not a normal module: it registers a factory with
 * `window.__ModuleLoader__`, and the loader hands that factory's return value to
 * the plugin system. Nothing in `tsc` or esbuild checks that shape, and a wrong
 * shape fails silently as a plugin that never activates — so this script
 * materializes the artifact the way the browser does and asserts the contract,
 * then the notebook's own pure contracts: tree navigation, the editor model, the
 * typography settings, and the stylesheet every class must have.
 *
 * Run with: node scripts/check-client.mjs
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInThisContext } from 'node:vm'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
// The name DSH shows in its plugin inventory lives in the locale metadata, not in
// the bundle, so it is read here and compared with the bundle's own title below.
const localeMeta = {}
for (const lang of ['zh', 'en']) {
  localeMeta[lang] = JSON.parse(await readFile(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8')).meta
}
const artifact = process.argv[2] ?? fileURLToPath(new URL('../lib/client.js', import.meta.url))
const source = await readFile(artifact, 'utf8')

const failures = []
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures.push(label)
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/** Minimal React stand-in: enough to call a component and read its tree. */
function createElement(type, props, ...children) {
  return { type, props: { ...props, children: children.length > 1 ? children : children[0] } }
}
const React = {
  createElement,
  useCallback: fn => fn,
  useEffect: fn => { fn() },
  // The source editor measures its colour layer in a layout effect, which runs
  // framed the same way here: there is no browser, and the refs are empty.
  useLayoutEffect: fn => { fn() },
  useMemo: fn => fn(),
  useRef: v => ({ current: v }),
  useState: v => [v, () => {}],
}

const registrations = []
let registeredId
/** Every request the panel made, as a URL string. */
const requests = []

globalThis.window = {
  __ModuleLoader__: {
    load(options) {
      registeredId = options.id
      globalThis.__factory = options.factory
    },
  },
  location: { origin: 'http://client.test' },
}
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body })
  return { ok: true, status: 200, text: async () => '' }
}

runInThisContext(source, { filename: artifact })

console.log(`client artifact: ${pkg.name}`)
check('registers with window.__ModuleLoader__.load', typeof globalThis.__factory === 'function')
check('registers under the package name', registeredId === pkg.name, `got ${String(registeredId)}`)

const exports = globalThis.__factory(specifier => {
  if (specifier === 'react') return React
  throw new Error(`unexpected require(${JSON.stringify(specifier)}) — everything but react must be inlined`)
})

check('factory returns exports with apply()', typeof exports?.apply === 'function', `got ${typeof exports?.apply}`)
check('exports declare inject as an array', Array.isArray(exports?.inject), `got ${JSON.stringify(exports?.inject)}`)
check('inject lists slots and locale', exports?.inject?.includes('slots') === true && exports?.inject?.includes('locale') === true)

// --- registration --------------------------------------------------------------
/** The menu service the shell provides; recorded so the menu can be asserted. */
const menuServiceStub = {
  register: (contribution) => {
    registrations.push({ kind: 'menu', contribution })
    return () => {}
  },
  open: () => {},
  notify: () => {},
}
/**
 * The services a shell has provided *at the moment `apply` runs*.
 *
 * Deliberately empty for `contextMenus`: after a real restart this bundle activates
 * before `ui-context-menu` provides its service, and `ctx.get` answered undefined —
 * which is exactly why the menu fell back to the browser's own. The plugin must go
 * through `ctx.inject`, so the stub models that ordering rather than hiding it.
 */
const availableAtActivation = new Map()
const ctx = {
  locale: {
    register: (ns, lang, dict) => { registrations.push({ kind: 'locale', ns, lang, dict }); return () => {} },
    bind: () => (key) => key,
  },
  slots: {
    inject: (name, callback) => { callback(); return () => {} },
    register: (options, component) => {
      const entry = { kind: 'slot', options, component }
      registrations.push(entry)
      return () => {}
    },
    children: {},
  },
  effect: (callback) => { callback(); return () => {} },
  // Mirrors the real contract: the callback runs only once every named service
  // exists, and `child` carries them as properties.
  inject: (names, callback) => {
    if (menuInjected) return () => {}
    const child = { ...ctx }
    for (const name of names) {
      if (name === 'contextMenus') child.contextMenus = menuServiceStub
      else child[name] = availableAtActivation.get(name)
    }
    menuInjected = true
    callback(child)
    return () => {}
  },
  get: (name) => availableAtActivation.get(name),
}
let menuInjected = false
try {
  exports.apply(ctx)
} catch (error) {
  check('applying the client half does not throw', false, String(error))
}
const sidebarEntry = registrations.find(entry => entry.kind === 'slot' && entry.options.name === 'sidebar.panellist')
const slots = registrations.filter(entry => entry.kind === 'slot').map(entry => entry.options)
const sidebar = slots.find(entry => entry.name === 'sidebar.panellist')
const main = slots.find(entry => entry.name === 'main')
const chat = slots.find(entry => String(entry.name).endsWith('.chat'))
check('registers one sidebar entry', sidebar !== undefined && sidebar.id === 'notebook', JSON.stringify(sidebar))
check('the sidebar entry sits at order 12', sidebar?.order === 12, String(sidebar?.order))
check('registers the panel under the same id', main?.key === 'notebook', JSON.stringify(main))
check('declares the conversation child slot', chat !== undefined && chat.name === 'notebook.chat', JSON.stringify(chat))
check('registers both dictionaries', registrations.filter(entry => entry.kind === 'locale').length === 2)

const {
  ancestorsOf,
  breadcrumb,
  buildTree,
  childDirectories,
  childFiles,
  countFiles,
  formatBytes,
  isDirectoryPath,
  parentOf,
  pathSegments,
  PROJECT_ROOT,
} = exports
check('exports the tree helpers',
  [ancestorsOf, breadcrumb, buildTree, childDirectories, childFiles, countFiles, formatBytes, isDirectoryPath, parentOf, pathSegments].every(fn => typeof fn === 'function'),
  'a tree helper is missing')
check('the workspace root is the empty path', PROJECT_ROOT === '')

// Shaped like a real listing: directories are entries of their own, interleaved
// with the files, and an empty directory is reported too.
const listing = [
  { path: '笔记', name: '笔记', bytes: 0, kind: 'directory' },
  { path: '笔记/第一则', name: '第一则', bytes: 12, kind: 'text' },
  { path: '笔记/第二则', name: '第二则', bytes: 34, kind: 'text' },
  { path: '笔记/封面.png', name: '封面.png', bytes: 4096, kind: 'binary' },
  { path: '素材', name: '素材', bytes: 0, kind: 'directory' },
  { path: '素材/图片说明.md', name: '图片说明.md', bytes: 5, kind: 'text' },
  { path: 'README', name: 'README', bytes: 7, kind: 'text' },
  { path: '第2章', name: '第2章', bytes: 1, kind: 'text' },
  { path: '第10章', name: '第10章', bytes: 1, kind: 'text' },
]

check('pathSegments drops the separators',
  pathSegments('笔记/第一则/附注').join('|') === '笔记|第一则|附注' && pathSegments('').length === 0,
  pathSegments('笔记/第一则/附注').join('|'))
check('parentOf walks up one level',
  parentOf('笔记/第一则') === '笔记' && parentOf('README') === PROJECT_ROOT,
  `${parentOf('笔记/第一则')}/${parentOf('README')}`)
check('ancestorsOf collects every folder above a file',
  ancestorsOf('笔记/第一则').join('|') === '笔记', ancestorsOf('笔记/第一则').join('|'))
check('isDirectoryPath knows the root and the listed folders',
  isDirectoryPath(listing, PROJECT_ROOT) === true && isDirectoryPath(listing, '笔记') === true
  && isDirectoryPath(listing, '笔记/第一则') === false && isDirectoryPath(listing, '没有') === false,
  '')

const rootDirs = childDirectories(listing, PROJECT_ROOT)
check('the root lists every top-level directory',
  rootDirs.map(d => d.name).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')).join(',') === '笔记,素材',
  rootDirs.map(d => d.name).join(','))
check('a folder count is recursive, not immediate',
  // A file the editor cannot open is still one of the folder's files; leaving it
  // out would make the count disagree with the rows drawn under the folder.
  rootDirs.find(d => d.name === '笔记').fileCount === 3 && rootDirs.find(d => d.name === '素材').fileCount === 1,
  JSON.stringify(rootDirs))
check('files inside a folder are listed without the directories',
  childFiles(listing, '笔记').map(file => file.name).join(',') === '第二则,第一则,封面.png',
  childFiles(listing, '笔记').map(file => file.name).join(','))
check('ordering is numeric, so 第2章 precedes 第10章',
  childFiles(listing, PROJECT_ROOT).map(file => file.name).join(',') === '第2章,第10章,README',
  childFiles(listing, PROJECT_ROOT).map(file => file.name).join(','))
check('the breadcrumb starts at the root',
  breadcrumb('笔记/子目录').map(([path, name]) => `${path}=${name}`).join('|') === '=|笔记=笔记|笔记/子目录=子目录',
  breadcrumb('笔记/子目录').map(([path, name]) => `${path}=${name}`).join('|'))
check('a byte size formats for the tree', formatBytes(1536) === '1.5 KB', String(formatBytes(1536)))
const tree = buildTree(listing)
const noteNode = tree.find(node => node.path === '笔记')
check('buildTree nests children under their folder',
  noteNode?.children?.some(child => child.path === '笔记/第一则') === true,
  JSON.stringify(noteNode?.children?.map(child => child.path)))
check('a file that cannot be previewed is a row, not a hole',
  // The reported bug: the tree hid binaries, so a folder holding an image looked
  // empty. The node exists and carries the flag the row draws.
  noteNode?.children?.some(child => child.path === '笔记/封面.png' && child.binary === true) === true,
  JSON.stringify(noteNode?.children?.map(child => [child.path, child.binary])))
check('a text file is not marked as binary',
  noteNode?.children?.every(child => child.path !== '笔记/第一则' || child.binary === false) === true, '')
check('a folder is never marked as binary',
  tree.every(node => node.directory === false || node.binary === false), '')
check('a binary still counts as a file in its folder',
  countFiles(noteNode) === 3, String(countFiles(noteNode)))
check('countFiles counts a folder recursively',
  countFiles(noteNode) === 3, String(countFiles(noteNode)))// --- natural ordering ---------------------------------------------------------------
// The asked-for case, driven as data: a run of digits is a number, not characters.
const { compareNames } = exports
check('a number sorts by value: 9.md before 10.md',
  compareNames('9.md', '10.md') < 0 && ['10.md', '9.md'].sort(compareNames).join('|') === '9.md|10.md',
  ['10.md', '9.md'].sort(compareNames).join('|'))
check('the exact case asked for: 文件名10.md comes after 9.md',
  compareNames('文件名10.md', '9.md') > 0 && compareNames('9.md', '文件名10.md') < 0,
  String(compareNames('文件名10.md', '9.md')))
check('a number inside a Chinese name sorts numerically too',
  ['笔记10.md', '笔记9.md', '笔记1.md'].sort(compareNames).join('|') === '笔记1.md|笔记9.md|笔记10.md',
  ['笔记10.md', '笔记9.md', '笔记1.md'].sort(compareNames).join('|'))
check('chapters read in the order a reader expects',
  ['第10章', '第2章', '第9章'].sort(compareNames).join('|') === '第2章|第9章|第10章',
  ['第10章', '第2章', '第9章'].sort(compareNames).join('|'))
check('zero padding has one fixed order, not "equal"',
  // `localeCompare`'s numeric option calls 9.md and 09.md equal, which leaves the
  // two rows free to swap on any re-render.
  compareNames('9.md', '09.md') < 0 && compareNames('09.md', '9.md') > 0, '')
check('full-width digits sort as digits',
  ['１０.md', '9.md'].sort(compareNames).join('|') === '9.md|１０.md',
  ['１０.md', '9.md'].sort(compareNames).join('|'))
check('a full-width and a half-width name are still two names',
  // １０.md and 10.md are two files; folding them for comparison must not make the
  // sort call them equal and leave their order to the engine.
  (() => {
    const wide = '１０.md'
    const narrow = '10.md'
    const order = compareNames(wide, narrow)
    return order !== 0 && Math.sign(order) === -Math.sign(compareNames(narrow, wide))
  })(), '')
check('a shorter name sorts before the one that extends it',
  compareNames('笔记', '笔记2') < 0 && compareNames('脚本.js', '脚本.jsx') < 0, '')
check('the sort is a total order, so rows cannot swap',
  // Every pair is decided one way and the reverse the other way.
  ['10.md', '9.md', '09.md', '笔记10.md', '笔记9.md', '第10章', '第9章', 'b', 'B', 'a1', 'a01']
    .every((left, index, all) => all.every(right => left === right
      || (Math.sign(compareNames(left, right)) === -Math.sign(compareNames(right, left))))), '')
check('two names the locale calls equal still have one order',
  // A canonically equivalent pair is two files on this side of the comparison, so
  // the comparator must not answer 0 and leave their order to the engine.
  (() => {
    const composed = 'caf\u00e9.md'
    const decomposed = 'cafe\u0301.md'
    return compareNames(composed, decomposed) !== 0
      && Math.sign(compareNames(composed, decomposed)) === -Math.sign(compareNames(decomposed, composed))
  })(), 'the comparator called two distinct names equal')
// Depth is drawn as left padding on the row. The row is `width:100%` of its <li>, so
// the padding must be *inside* that width — otherwise every level made the row wider
// than the list, the list became horizontally scrollable, and focusing the autofocused
// input of a new/renamed row scrolled the tree sideways, pushing its icon out of view.
const { rowIndent, TREE_INDENT_MAX, TREE_INDENT_BASE } = exports
check('a top-level row is indented by the base amount',
  rowIndent(0) === TREE_INDENT_BASE, String(rowIndent(0)))
check('each level adds one step', rowIndent(1) - rowIndent(0) === 14, String(rowIndent(1)))
check('the indent is capped, so a deep row keeps room for its icon',
  rowIndent(40) === TREE_INDENT_MAX && rowIndent(1000) === TREE_INDENT_MAX, String(rowIndent(40)))
check('a broken depth still draws a row',
  rowIndent(Number.NaN) === TREE_INDENT_BASE && rowIndent(-3) === TREE_INDENT_BASE,
  `${String(rowIndent(Number.NaN))} ${String(rowIndent(-3))}`)

// --- layout and typography ------------------------------------------------------
const { DEFAULT_LAYOUT, SIDE_MIN, clampPane, loadLayout, readLayout, resizePane, toggleTalking } = exports
check('the directory column opens at 300px', DEFAULT_LAYOUT.side === 300, String(DEFAULT_LAYOUT.side))
check('the conversation column opens at 400px', DEFAULT_LAYOUT.chat === 400, String(DEFAULT_LAYOUT.chat))
check('the directory column cannot be dragged narrower than its heading',
  // Six 24px heading icons, the column's name, 2px gaps and 26px of padding is what
  // this number is measured from; below it the name would have to truncate to make
  // room for the controls.
  SIDE_MIN >= 220, String(SIDE_MIN))
check('the document keeps its minimum width', resizePane({ side: SIDE_MIN, chat: 400 }, 'side', 900, 1000).side <= 1000 - 360 - 400,
  JSON.stringify(resizePane({ side: SIDE_MIN, chat: 400 }, 'side', 900, 1000)))
check('a pane is clamped to its bounds', clampPane(50, SIDE_MIN, 520) === SIDE_MIN && clampPane(9000, SIDE_MIN, 520) === 520, '')
check('a broken stored layout still opens',
  readLayout('{not json').side === DEFAULT_LAYOUT.side, JSON.stringify(readLayout('{not json')))
check('hiding the conversation keeps the directory width',
  toggleTalking(DEFAULT_LAYOUT).talking === false && toggleTalking(DEFAULT_LAYOUT).side === DEFAULT_LAYOUT.side)
check('the layout is read back from storage', loadLayout !== undefined)

const { clampSize, DEFAULT_PREFS, FONT_IDS, FONT_STACKS, PAPER_IDS, readPrefs } = exports
check('four typefaces are offered', FONT_IDS.join(',') === 'system,song,kai,puhuiti', FONT_IDS.join(','))
check('the system default is a sans stack',
  /Microsoft YaHei/.test(FONT_STACKS.system) && /sans-serif/.test(FONT_STACKS.system), FONT_STACKS.system)
check('four papers are offered', PAPER_IDS.join(',') === 'plain,elegant,night,green', PAPER_IDS.join(','))
check('the default paper is 简白', DEFAULT_PREFS.paper === 'plain', DEFAULT_PREFS.paper)
check('a size outside the bounds is clamped', clampSize(4) === 13 && clampSize(999) === 24, String(clampSize(4)))
check('junk in storage falls back to the opening state',
  readPrefs('{not json').paper === DEFAULT_PREFS.paper, JSON.stringify(readPrefs('{not json')))
check('a paper stored under an old name is migrated',
  readPrefs('{"paper":"dark"}').paper === 'night' && readPrefs('{"paper":"light"}').paper === 'elegant',
  'migration missing')

// --- the editor ------------------------------------------------------------------
const { editorControls, initialEditorMode, isMarkdownPath, nextEditorMode, parseMarkdown } = exports
const { documentFromMarkdown, markdownFromDocument } = exports
check('markdown and extensionless names open as a document',
  isMarkdownPath('笔记/第一则.md') && isMarkdownPath('第一则') && !isMarkdownPath('bible.json'),
  '')
check('a markdown file starts in the rendered mode', initialEditorMode('第一则.md') === 'wysiwyg', initialEditorMode('第一则.md'))
check('a data file starts in source', initialEditorMode('数据.json') === 'source', initialEditorMode('数据.json'))
check('a source file starts in source, not in the rendered page',
  // The tree lists code now, so this is where a `.js` file would otherwise land in
  // ProseMirror and be rewritten as markdown on the first keystroke.
  initialEditorMode('工具.js') === 'source' && initialEditorMode('app.tsx') === 'source'
  && initialEditorMode('script.py') === 'source' && !isMarkdownPath('工具.js'),
  initialEditorMode('工具.js'))
check('an extensionless build file is source, an extensionless chapter is not',
  // `第一章` is how this notebook names prose; `Dockerfile` is a format whose bytes
  // matter, and the rendered page would rewrite them.
  initialEditorMode('第一章') === 'wysiwyg' && initialEditorMode('Dockerfile') === 'source'
  && initialEditorMode('Makefile') === 'source' && initialEditorMode('Gemfile') === 'source'
  && initialEditorMode('dockerfile') === 'source',
  `${initialEditorMode('第一章')}/${initialEditorMode('Dockerfile')}`)
check('the mode pair exists for markdown only',
  editorControls(true).toggle === true && editorControls(false).toggle === false, '')
check('flipping the mode toggles it', nextEditorMode('wysiwyg') === 'source' && nextEditorMode('source') === 'wysiwyg')
check('a single newline is a line break, not a space',
  parseMarkdown('第一行\n第二行\n')[2] === undefined
  && parseMarkdown('第一行\n第二行\n')[0].spans[0].text === '第一行\n第二行',
  JSON.stringify(parseMarkdown('第一行\n第二行\n')[0]))
check('the break survives a trip through the document model',
  markdownFromDocument(documentFromMarkdown('第一行\n第二行\n')) === '第一行  \n第二行\n',
  JSON.stringify(markdownFromDocument(documentFromMarkdown('第一行\n第二行\n'))))
check('the rendered document keeps front matter verbatim',
  markdownFromDocument(documentFromMarkdown('---\ntitle: x\n---\n\n正文\n')).startsWith('---\ntitle: x\n---'),
  '')
check('the panel never turns a destination into a link',
  !markdownFromDocument(documentFromMarkdown('[x](javascript:alert(1))\n')).includes('<a'),
  '')

// --- syntax colour --------------------------------------------------------------------
// The colouring is the feature and it is pure, so it is driven as data: coverage of the
// input, the vocabulary, the alias rule, and the file-name rule. A colour at the wrong
// offset would be read as fact, so coverage is checked character by character.
const {
  HIGHLIGHT_CLASSES,
  HIGHLIGHTED_LANGUAGES,
  codeColourRanges,
  codeHighlightPlugin,
  editorPlugins,
  highlightCode,
  highlightLanguages,
  languageForPath,
  normalizeLanguage,
} = exports
const tsSnippet = 'const answer: number = 42\n// 注释\nfunction greet(name: string): string {\n  return `hi ${name}`\n}\n'
const spans = highlightCode(tsSnippet, 'typescript')
check('the colouring reproduces its input exactly',
  spans.map(span => span.text).join('') === tsSnippet, JSON.stringify(spans.map(span => span.className)))
check('a coloured run carries a class from the vocabulary',
  spans.some(span => span.className.length > 0)
  && spans.every(span => span.className === '' || HIGHLIGHT_CLASSES.includes(span.className)),
  JSON.stringify([...new Set(spans.map(span => span.className))]))
check('the classes are the ones the stylesheet names',
  HIGHLIGHT_CLASSES.length >= 12 && HIGHLIGHT_CLASSES.every(name => name.startsWith('dsh-notebook-hl-')),
  `${HIGHLIGHT_CLASSES.length} classes`)
check('keywords, strings and comments are told apart',
  // The three distinctions a reader actually uses when skimming code.
  ['keyword', 'string', 'comment'].every((token) => {
    const expected = `dsh-notebook-hl-${token}`
    return spans.some(span => span.className === expected && span.text.length > 0)
  }), JSON.stringify([...new Set(spans.map(span => span.className))]))
check('a language the panel does not carry is drawn plainly, not guessed',
  normalizeLanguage('cobol') === undefined && normalizeLanguage('zzz') === undefined
  && highlightCode(tsSnippet, 'cobol').length === 1
  && highlightCode(tsSnippet, 'cobol')[0].className === '',
  JSON.stringify(highlightCode(tsSnippet, 'cobol')))
check('a fence with no language is plain text',
  highlightCode('x = 1\n', '').length === 1 && highlightCode('x = 1\n', undefined).length === 1, '')
check('an empty block is no spans, not one empty one',
  highlightCode('', 'typescript').length === 0, JSON.stringify(highlightCode('', 'typescript')))
check('the names a fence uses reach the grammar behind them',
  normalizeLanguage('ts') === 'typescript' && normalizeLanguage('TSX') === 'typescript'
  && normalizeLanguage('js') === 'javascript' && normalizeLanguage('py') === 'python'
  && normalizeLanguage('yml') === 'yaml' && normalizeLanguage('sh') === 'bash'
  && normalizeLanguage('c') === 'cpp' && normalizeLanguage('yml') === 'yaml',
  [normalizeLanguage('ts'), normalizeLanguage('py'), normalizeLanguage('c')].join('/'))
check('an info string may carry more than its language name',
  normalizeLanguage('ts title="a.ts"') === 'typescript' && normalizeLanguage('  .py  ') === 'python',
  `${normalizeLanguage('ts title="a.ts"')}/${normalizeLanguage('  .py  ')}`)
check('every alias names a grammar that is registered',
  HIGHLIGHTED_LANGUAGES.length > 0
  && HIGHLIGHTED_LANGUAGES.every(id => normalizeLanguage(id) === id),
  HIGHLIGHTED_LANGUAGES.filter(id => normalizeLanguage(id) !== id).join(','))
check('the grammar table and the instance agree',
  // A table naming a grammar that was never registered colours nothing, silently.
  highlightLanguages().join(',') === HIGHLIGHTED_LANGUAGES.join(','),
  `instance=${highlightLanguages().join(',')} table=${HIGHLIGHTED_LANGUAGES.join(',')}`)
check('a file is coloured by its own name',
  languageForPath('src/app.tsx') === 'typescript' && languageForPath('脚本.py') === 'python'
  && languageForPath('data.yml') === 'yaml' && languageForPath('README.md') === 'markdown'
  && languageForPath('第一章') === 'markdown',
  [languageForPath('src/app.tsx'), languageForPath('第一章')].join('/'))
check('a build file is coloured by its name, not by prose',
  languageForPath('Dockerfile') === 'dockerfile' && languageForPath('Makefile') === 'makefile'
  && languageForPath('.env') === 'ini' && languageForPath('.npmrc') === 'ini',
  [languageForPath('Dockerfile'), languageForPath('.env')].join('/'))
check('a file whose type is unknown opens uncoloured',
  languageForPath('notes.zzz') === undefined && languageForPath('') === undefined
  && languageForPath('.gitignore') === undefined,
  [languageForPath('notes.zzz'), languageForPath('.gitignore')].join('/'))
check('a markdown file is coloured as markdown, the mode it opens in',
  // The page and the editor must agree: a `.md` opens rendered *and* is source-coloured
  // when the author flips it, and the two use the same predicate.
  isMarkdownPath('笔记.md') === (languageForPath('笔记.md') === 'markdown'), '')

// The offsets are what a decoration takes, so they are read back out of a real document
// produced by the ordinary reader: the text a range claims must be the text it colours.
const colouredDoc = documentFromMarkdown('前言\n\n```ts\nconst x: number = 1\n```\n\n后记\n')
const ranges = codeColourRanges(colouredDoc)
check('a fenced block is coloured, and its prose is not',
  ranges.length > 0
  && ranges.every(range => range.from > 0 && range.to > range.from)
  // Nothing outside the code block: the first paragraph ends before it.
  && ranges.every(range => colouredDoc.textBetween(range.from, range.to, '') !== '前言'),
  `${ranges.length} ranges`)
check('every range lands on the text it claims to colour',
  ranges.every((range) => {
    const text = colouredDoc.textBetween(range.from, range.to, '')
    return text.length > 0 && text.length === range.to - range.from
  }), JSON.stringify(ranges.slice(0, 3)))
check('the ranges put the keyword on the keyword',
  ranges.some(range => range.className === 'dsh-notebook-hl-keyword'
    && colouredDoc.textBetween(range.from, range.to, '') === 'const'), JSON.stringify(ranges))
check('a block with no language is left uncoloured',
  codeColourRanges(documentFromMarkdown('```\nplain text\n```\n')).length === 0, '')
check('colouring adds nothing to the file',
  // The decorations are view state: the same markdown comes back out, fence included.
  markdownFromDocument(colouredDoc) === '前言\n\n```ts\nconst x: number = 1\n```\n\n后记\n',
  JSON.stringify(markdownFromDocument(colouredDoc)))
check('the rendered editor installs the colour plugin',
  editorPlugins().some(plugin => plugin === codeHighlightPlugin() || plugin.key === codeHighlightPlugin().key),
  '')
// The plugin's own state: the set has to be buildable for a real document (a range
// outside it throws in ProseMirror) and a selection change must not rebuild it.
const colourPlug = codeHighlightPlugin()
const colourState = colourPlug.spec.state
check('the decoration set is built for a real document',
  (() => {
    const set = colourState.init({}, { doc: colouredDoc })
    const found = set.find()
    return found.length === ranges.length
      && found.every(decoration => typeof decoration.from === 'number' && decoration.to > decoration.from)
  })(), '')
check('moving the caret does not recolour the document',
  // The document object is the cache key, so an untouched document is the same set.
  (() => {
    const set = colourState.init({}, { doc: colouredDoc })
    return colourState.apply({ docChanged: false }, set) === set
  })(), '')
// The label the stylesheet draws comes from the DOM the schema writes, so the two
// halves — "what is this block written in" and "can we colour it" — are asserted on
// that DOM rather than on the CSS alone.
const fencedDom = (markdown) => {
  const block = documentFromMarkdown(markdown).firstChild
  return block.type.spec.toDOM(block)
}
check('a fence carries its language, and whether the panel can colour it',
  fencedDom('```ts\nconst x = 1\n```\n')[1]['data-language'] === 'ts'
  && fencedDom('```ts\nconst x = 1\n```\n')[1]['data-language-known'] === 'true'
  // A word the panel carries but cannot colour: the label stays, dimmed.
  && fencedDom('```zig\nx\n```\n')[1]['data-language-known'] === 'false',
  JSON.stringify(fencedDom('```zig\nx\n```\n')?.[1]))
check('a fence with no info string gets no strip and no label',
  fencedDom('```\nx\n```\n')[1]['data-language'] === '', '')

// The source editor is a textarea with a colour layer behind it, and the two must be the
// same text: one is what the author sees, the other is what gets saved.
const sourceLabels = { plainLabel: 'plainText', uncolouredLabel: 'uncoloured' }
const sourceEditor = exports.SourceEditor({
  path: 'src/app.ts', value: 'const x = 1\n', onChange: () => {}, ...sourceLabels,
})
const [sourceLayer, sourceInput] = (() => {
  const children = [sourceEditor.props?.children].flat().filter(child => child !== null)
  return [children.find(child => String(child?.props?.className ?? '').includes('dsh-notebook-srcCode')), children.find(child => child?.type === 'textarea')]
})()
check('a source file is drawn as a colour layer under its textarea',
  String(sourceEditor.props?.className ?? '').includes('dsh-notebook-src')
  && sourceEditor.props?.['data-mode'] === 'source'
  && sourceEditor.props?.['data-language'] === 'typescript'
  && sourceEditor.props?.['data-coloured'] === 'true'
  && String(sourceLayer?.props?.className ?? '').includes('dsh-notebook-srcCode')
  && sourceLayer?.props?.['aria-hidden'] === 'true'
  && sourceInput?.type === 'textarea'
  && String(sourceInput?.props?.className ?? '').includes('dsh-notebook-srcInput'),
  JSON.stringify([sourceEditor.props?.['data-language'], sourceInput?.type]))
check('the layer draws the same characters the textarea holds',
  // The file's own text, plus one newline: a single trailing break is not rendered in a
  // `pre`, and the textarea does show that empty last line.
  (() => {
    /** Every string in an element subtree, in order. */
    const textOf = node => (typeof node === 'string' ? node
      : Array.isArray(node) ? node.map(textOf).join('')
      : node === null || node === undefined || typeof node !== 'object' ? ''
      : textOf(node.props?.children))
    return textOf(sourceLayer?.props?.children) === 'const x = 1\n\n'
  })(), JSON.stringify(sourceLayer?.props?.children))
check('the layer is brought back in step on scroll, edit and resize',
  // Three ways the two layers can part: the textarea scrolls, the draft changes, or the
  // column is dragged narrower. Each one is a real event, not a repaint.
  typeof sourceInput?.props?.onScroll === 'function'
  && typeof sourceInput?.props?.onCompositionStart === 'function'
  && typeof sourceInput?.props?.onCompositionEnd === 'function'
  && source.includes('new ResizeObserver'), '')
check('a code file keeps the spell checker off, a chapter keeps it on',
  // The same component serves `.ts` and the markdown source of a chapter.
  sourceInput?.props?.spellCheck === false
  && exports.SourceEditor({
    path: '笔记.md', value: '正文\n', onChange: () => {}, ...sourceLabels,
  }).props?.children?.find?.(child => child?.type === 'textarea')?.props?.spellCheck === true,
  '')
check('a file with no grammar is the plain textarea it was before',
  (() => {
    const plain = exports.SourceEditor({ path: 'notes.zzz', value: 'anything', onChange: () => {}, ...sourceLabels })
    // The colours are absent, and the page says why rather than leaving it to be guessed:
    // the wrapper carries its own label, and the editor inside is the shared TextArea.
    const label = [plain.props?.children].flat().find(child => String(child?.props?.className ?? '').includes('dsh-notebook-srcLabel'))
    const rendered = [plain.props?.children].flat()
      .filter(child => typeof child?.type === 'function')
      .map(child => child.type(child.props))[0]
    return plain.props?.['data-language'] === '' && plain.props?.['data-coloured'] === 'false'
      && label?.props?.children === 'plainText'
      && rendered?.type === 'textarea' && rendered.props.value === 'anything'
      && String(rendered.props.className).includes('dsh-notebook-textarea')
  })(), '')
check('a line break from the Host is drawn as the textarea draws it',
  // A textarea's value setter turns CRLF into LF while the buffer keeps what the Host
  // returned, so the layer is built from the normalised text and the buffer is not.
  exports.layerText('a\r\nb\r\n') === 'a\nb\n\n' && exports.layerText('a\nb') === 'a\nb',
  JSON.stringify(exports.layerText('a\r\nb\r\n')))

// --- the directory column's heading -----------------------------------------------
const { AUTOSAVE_MS, NotebookTab } = exports
check('autosave is under two seconds', AUTOSAVE_MS > 0 && AUTOSAVE_MS <= 2000, String(AUTOSAVE_MS))

let column
try {
  column = NotebookTab({
    t: key => key,
    side: DEFAULT_LAYOUT.side,
    onSideResize: () => {},
    canChat: true,
    chatVisible: true,
    onToggleChat: () => {},
    prefs: { font: 'system', size: 15, paper: 'plain' },
    onPrefsChange: () => {},
  })
} catch (error) {
  check('the directory column renders', false, String(error))
}
/** Depth-first element list, function components included. */
function walk(element, visit) {
  if (element === null || element === undefined || typeof element === 'boolean') return
  if (Array.isArray(element)) { for (const child of element) walk(child, visit); return }
  if (typeof element !== 'object') return
  visit(element)
  walk(element.props?.children, visit)
}
function findIn(element, match) {
  let found
  walk(element, (node) => { if (found === undefined && match(node)) found = node })
  return found
}
const headings = []
const labels = []
walk(column, (element) => {
  if (element.type === 'button') {
    const children = [element.props?.children].flat()
    for (const child of children) if (typeof child === 'string') labels.push(child)
  }
})
walk(column, (element) => {
  const children = [element.props?.children].flat()
  for (const child of children) if (typeof child === 'string' && element.props?.className?.includes?.('sectionTitle')) headings.push(child)
})
check('the column is headed 笔记本', headings.includes('library'), headings.join('|'))

const actions = []
walk(column, (element) => {
  const action = element.props?.['data-action'] ?? element.props?.attrs?.['data-action']
  if (typeof action === 'string' && !actions.includes(action)) actions.push(action)
})
check('the heading carries both creates, rename, delete, refresh and reveal',
  ['new-dir', 'new-file', 'rename', 'delete', 'refresh', 'reveal'].every(action => actions.includes(action)),
  actions.join(','))
check('the conversation switch is not in the directory column any more',
  (() => {
    // The column walk above covers both of `NotebookTab`'s panes, so the claim is
    // made against the directory pane alone: the switch has to have left this one.
    const pane = findIn(column, element => String(element.props?.className ?? '').includes('dsh-notebook-side'))
    if (pane === undefined) return false
    const inPane = []
    walk(pane, (element) => {
      const action = element.props?.['data-action'] ?? element.props?.attrs?.['data-action']
      if (typeof action === 'string') inPane.push(action)
    })
    return !inPane.includes('toggle-chat') && inPane.includes('rename') && inPane.includes('delete')
  })(), 'the switch is still in the directory column')
check('the story picker and its create button are gone',
  !labels.includes('newStory') && !source.includes('data-picker') && !source.includes('create-project'),
  labels.join('|'))

const headingRow = findIn(column, element => String(element.props?.className ?? '') === 'dsh-notebook-row')
const order = (headingRow?.props?.children ?? []).map((child) => {
  const className = String(child?.props?.className ?? '')
  if (className.includes('sectionTitle')) return 'title'
  if (className.includes('dsh-notebook-spacer')) return 'spacer'
  return child?.props?.['data-action'] ?? child?.props?.attrs?.['data-action'] ?? ''
}).filter(token => token !== '')
check('the heading reads title, creates, the two edits, then the workspace actions',
  order.join(',') === 'title,spacer,new-dir,new-file,rename,delete,refresh,reveal', order.join(','))
// The two edit actions name their target and say when they have none: the tree
// marks the drawn file and the folder new files land in, neither of which is
// labelled "the rename target", so a bare 重命名 would be a guess.
const headingButtons = headingRow?.props?.children ?? []
const byAction = (name) => headingButtons.find(child => (child?.props?.['data-action'] ?? child?.props?.attrs?.['data-action']) === name)
check('rename and delete are disabled while nothing has been taken hold of',
  byAction('rename')?.props?.disabled === true && byAction('delete')?.props?.disabled === true,
  JSON.stringify([byAction('rename')?.props?.disabled, byAction('delete')?.props?.disabled]))
check('and they name the entry they would act on when there is one',
  /t\("renameEntry"\)\.replace\("\{name\}", cursorEntry\.name\)/.test(source)
  && /t\("deleteEntry"\)\.replace\("\{name\}", cursorEntry\.name\)/.test(source), '')
check('the heading acts on the last entry taken hold of, not on a separate selection',
  // Three gestures mean "this one": opening a file, opening or closing a folder,
  // and creating something. Each records it; nothing else does.
  (source.match(/setCursor\(path\)/g) ?? []).length === 2
  && source.includes('setCursor(made.path)'), '')
check('a rename carries the cursor with the entry',
  /setCursor\(\(previous\) => previous === renaming\.path \? renamed\.path : previous\)/.test(source), '')
check('deleting the cursor entry leaves the heading with nothing to act on',
  /setCursor\(\(previous\) => previous !== void 0 && gone\(previous\) \? void 0 : previous\)/.test(source), '')
check('a binary row is drawn as one: marked, and named in the row',
  // The row exists; the *label* is what stops the click from being a surprise.
  // Matched on the emitted form, where the bundler has switched the quotes.
  source.includes('"data-binary": node.binary ? "true" : "false"')
  && /node\.binary \? `\$\{formatBytes\(node\.bytes\)\} · \$\{t\("notPreviewable"\)\}`/.test(source),
  'the binary row carries no marker')
check('the click on a binary answers instead of opening a tab',
  // No tab is opened for a file the editor cannot hold; the notice names it.
  /setUnsupported\(\{\s*path,\s*name: entry\.name,\s*bytes: entry\.bytes\s*\}\)/.test(source),
  'a binary click would open an empty tab')
check('the notice is dismissible and says which file it is about',
  source.includes('"data-role": "unpreviewable"') && source.includes('"data-action": "dismiss-notice"')
  && /t\("notPreviewableDetail"\)\.replace\("\{name\}", unsupported\.name\)/.test(source), '')
check('a truncated listing says so above the tree',
  source.includes('t("truncatedTitle")') && source.includes('t("truncatedDetail")')
  && source.includes('setTruncated(listing.truncated === true)'), '')
check('a new file is named in an empty row inside the tree',
  source.includes('dsh-notebook-ghost') && source.includes('dsh-notebook-ghostInput'), '')
check('the empty row commits on Enter and cancels on Escape',
  source.includes('Escape') && source.includes('isComposing'), '')


// --- the editor's tabs ---------------------------------------------------------------
// The tab model is pure, so the rules that matter are asserted as data: one buffer
// per open file, a second click activating rather than re-reading, and a close that
// lands on the neighbouring tab rather than on no tab at all.
const { closeFile, fileNameOf, findFile, nextActive, openFile, patchFile, planCloseAll, TabStrip } = exports
/** The tree's icon component, by another name: the artwork section below binds `TreeIcon`. */
const TreeRowIcon = exports.TreeIcon
/** The label rule, checked as data: two chapters can hold a file with one name. */
const tabLabel = exports.tabLabel
check('a tab model exists', [closeFile, fileNameOf, findFile, nextActive, openFile, patchFile, TabStrip].every(fn => typeof fn === 'function'), '')
check('a tab is named the way the tree names the row',
  fileNameOf('笔记/第一章') === '第一章' && fileNameOf('第一章') === '第一章', fileNameOf('笔记/第一章'))
const opened = openFile(openFile(openFile([], '第一章'), '笔记/素材.md'), 'README.md')
check('opening files fills the strip in order',
  opened.map(file => file.path).join('|') === '第一章|笔记/素材.md|README.md', opened.map(file => file.path).join('|'))
check('a new tab starts empty and waits for its read',
  opened.every(file => file.loading && !file.dirty && file.draft === ''), JSON.stringify(opened[0]))
check('the surface a file opens in is the one its name asks for',
  opened[0]?.mode === 'wysiwyg' && opened[1]?.mode === 'wysiwyg' && opened[2]?.mode === 'wysiwyg',
  opened.map(file => file.mode).join(','))
check('re-opening an open file changes nothing, so its buffer survives',
  openFile(opened, '第一章') === opened, 'the array was rebuilt')
check('a seeded tab needs no read',
  openFile([], '新章', { draft: '# 新章\n\n', mode: 'wysiwyg' })[0]?.loading === false, '')
const typed = patchFile(opened, '笔记/素材.md', { draft: '改了', dirty: true })
check('a keystroke is recorded on that tab alone',
  typed[1]?.draft === '改了' && typed[1]?.dirty === true && typed[0]?.draft === '' && typed[0]?.dirty === false,
  JSON.stringify({ first: typed[0], second: typed[1], count: typed.length }))
check('patching another tab does not touch the ones beside it',
  typed[2] === opened[2] && typed[1] !== opened[1], '')
check('patching a path that is not open is a no-op',
  patchFile(opened, '没有', { dirty: true }) === opened && closeFile(opened, '没有') === opened, '')
check('closing the drawn tab moves to the one on its right',
  nextActive(opened, '笔记/素材.md', '笔记/素材.md') === 'README.md',
  String(nextActive(opened, '笔记/素材.md', '笔记/素材.md')))
check('closing the last tab falls back to the left',
  nextActive(opened, 'README.md', 'README.md') === '笔记/素材.md', '')
check('closing a tab that is not drawn keeps the drawn one',
  nextActive(opened, '第一章', 'README.md') === 'README.md', '')
check('closing the only tab empties the editor', nextActive(opened, '第一章', '第一章') === '笔记/素材.md'
  && nextActive([opened[0]], '第一章', '第一章') === undefined, '')
check('closing removes exactly one tab',
  closeFile(opened, '笔记/素材.md').map(file => file.path).join('|') === '第一章|README.md',
  closeFile(opened, '笔记/素材.md').map(file => file.path).join('|'))
// "Close all" is a flush followed by one close. The refusal is the whole reason the
// plan is a decision rather than `files.map`: a page whose write failed must stay, or
// its sentence would exist only in the error banner.
check('closing all closes every tab the flush could write',
  (() => {
    const plan = planCloseAll(opened, new Set(), '笔记/素材.md')
    return plan.close.join('|') === '第一章|笔记/素材.md|README.md' && plan.active === undefined
  })(), JSON.stringify(planCloseAll(opened, new Set(), '笔记/素材.md')))
check('a refused write keeps its page open',
  (() => {
    const plan = planCloseAll(opened, new Set(['笔记/素材.md']), '笔记/素材.md')
    return plan.close.join('|') === '第一章|README.md' && plan.active === '笔记/素材.md'
  })(), JSON.stringify(planCloseAll(opened, new Set(['笔记/素材.md']), '笔记/素材.md')))
check('closing all lands on the drawn page when it is the one that stayed',
  planCloseAll(opened, new Set(['README.md']), 'README.md').active === 'README.md', '')
check('closing all lands on the page that could not be written',
  // The drawn tab went; the only survivor is the refused one, and that is where the
  // error banner's file should be on screen.
  (() => {
    const plan = planCloseAll(opened, new Set(['README.md']), '第一章')
    return plan.close.join('|') === '第一章|笔记/素材.md' && plan.active === 'README.md'
  })(), JSON.stringify(planCloseAll(opened, new Set(['README.md']), '第一章')))
check('a tab opened while the writes were in flight is not closed, and keeps the page',
  // `active` may name a tab that was not in the snapshot; the plan leaves it alone.
  (() => {
    const plan = planCloseAll(opened, new Set(), '新章')
    return plan.close.join('|') === '第一章|笔记/素材.md|README.md' && plan.active === '新章'
  })(), JSON.stringify(planCloseAll(opened, new Set(), '新章')))

// The strip draws each tab from the file name it stands for, through the same
// `TreeIcon` the tree uses — so a `.md` chapter looks the same in both lists.
const strip = TabStrip({
  files: [opened[0], { ...opened[1], dirty: true }],
  active: '第一章',
  t: key => key,
  onChoose: () => {},
  onClose: () => {},
  meta: [React.createElement('span', { key: 'state', 'data-role': 'save-state' }, 'saved')],
})
const tabs = []
walk(strip, (element) => { if (element.props?.role === 'tab') tabs.push(element) })
check('the strip draws one tab per open file', tabs.length === 2, String(tabs.length))
check('a tab carries the file name and its own path',
  tabs[0]?.props?.title === '第一章' && tabs[1]?.props?.['data-tab-path'] === '笔记/素材.md',
  JSON.stringify(tabs.map(tab => tab.props?.title)))
check('only the drawn tab is selected, and it is the strip\'s one tab stop',
  tabs[0]?.props?.['aria-selected'] === 'true' && tabs[0]?.props?.tabIndex === 0
  && tabs[1]?.props?.['aria-selected'] === 'false' && tabs[1]?.props?.tabIndex === -1, '')
check('an unsaved tab is marked as one',
  tabs[1]?.props?.['data-dirty'] === 'true' && tabs[0]?.props?.['data-dirty'] === 'false', '')
const tabIconName = findIn(tabs[1], element => element.type === TreeRowIcon)
check('a tab reuses the directory tree\'s artwork',
  // The strip and the tree render the same component, which is the only way "the
  // tab icon is the row's icon" can stay true as the theme selection changes.
  tabIconName !== undefined && typeof TreeRowIcon === 'function'
  && findIn(strip, element => element.type === TreeRowIcon) !== undefined,
  String(tabIconName?.type))
check('a tab is drawn from the file name it stands for',
  tabIconName?.props?.name === '素材.md', String(tabIconName?.props?.name))
check('a tab asks for a smaller edge than a tree row',
  tabIconName?.props?.size === 14 && exports.TREE_ICON_SIZE === 16,
  `${String(tabIconName?.props?.size)}/${String(exports.TREE_ICON_SIZE)}`)
check('every tab has a close control',
  tabs.every(tab => findIn(tab, element => element.type === 'button') !== undefined), '')
const tabList = findIn(strip, element => element.props?.role === 'tablist')
check('the strip is a tablist with a name',
  tabList !== undefined && tabList.props['aria-label'] === 'openFiles'
  && tabList.props['aria-orientation'] === 'horizontal', String(tabList?.props?.role))
check('the keyboard reaches the strip and can close a tab',
  /ArrowRight/.test(source) && /ArrowLeft/.test(source) && /=== ["']Delete["']/.test(source)
  && source.includes('onAuxClick'), '')

// The tab/page wiring a screen reader needs: a named tablist, tabs that point at
// the page, and a panel that is labelled by the drawn tab.
const page = findIn(column, element => element.props?.role === 'tabpanel')
check('a tab names the page it controls',
  tabs.every(tab => tab.props?.['aria-controls'] === exports.PAGE_ID)
  && typeof exports.PAGE_ID === 'string', String(exports.PAGE_ID))
check('the tab labels are unique DOM ids',
  tabs.map(tab => tab.props?.id).every(id => typeof id === 'string' && id.length > 0)
  && new Set(tabs.map(tab => tab.props?.id)).size === tabs.length,
  JSON.stringify(tabs.map(tab => tab.props?.id)))
check('a tab announces its unsaved state',
  tabs[1]?.props?.['aria-label'] !== undefined && tabs[1].props['aria-label'].endsWith('unsavedSuffix')
  && tabs[0]?.props?.['aria-label'] === '第一章', String(tabs[1]?.props?.['aria-label']))
// Two chapters can hold a file with the same name; the labels have to differ then.
check('a repeated file name says which folder it is in',
  (() => {
    const same = openFile(openFile([], '第一章/笔记.md'), '第二章/笔记.md')
    const named = same.map(file => tabLabel(same, file))
    return named[0] === '笔记.md · 第一章' && named[1] === '笔记.md · 第二章'
  })(), 'two identical tab labels are possible')
check('a unique file name stays short',
  tabLabel(opened, opened[0]) === '第一章', tabLabel(opened, opened[0]))
check('an unsaved tab shows its dot only when it is not the drawn one',
  // The dot is a second mark for a fact the toolbar already states about the file
  // on screen; two of them in one band read as two problems. Tab 1 is dirty and not
  // drawn (dot drawn); a dirty drawn tab must not also get one.
  findIn(tabs[1], element => String(element.props?.className ?? '') === 'dsh-notebook-tabDot') !== undefined
  && findIn(TabStrip({
    files: [{ ...opened[0], dirty: true }],
    active: '第一章',
    t: key => key,
    onChoose: () => {},
    onClose: () => {},
  }), element => String(element.props?.className ?? '') === 'dsh-notebook-tabDot') === undefined,
  'the dot is not limited to the tabs that are not drawn')
check('the drawn file\'s count rides at the end of the strip, not in the wrapping toolbar',
  (() => {
    const head = findIn(column, element => String(element.props?.className ?? '').includes('editorHead'))
    const children = [head?.props?.children].flat()
    const toolbar = children.find(child => String(child?.props?.className ?? '') === 'dsh-notebook-toolbar')
    // The strip is a component, so `walk` cannot descend into it: the check renders
    // it itself (above) with the same `meta` prop the panel passes.
    const inToolbar = findIn(toolbar, element => element.props?.['data-role'] === 'save-state')
    const inStrip = findIn(strip, element => element.props?.['data-role'] === 'save-state')
    return inToolbar === undefined && inStrip !== undefined
  })(), 'the save state still lives in the row that re-flows')
check('the editor head holds the toolbar above the tabs',
  (() => {
    const head = findIn(column, element => String(element.props?.className ?? '').includes('editorHead'))
    if (head === undefined) return false
    const children = [head.props?.children].flat()
    const typebar = children.findIndex(child => String(child?.props?.className ?? '') === 'dsh-notebook-toolbar')
    const strip = children.findIndex(child => child?.type === TabStrip)
    return typebar >= 0 && strip === typebar + 1
  })(), 'the tab strip is not under the toolbar')
check('the conversation switch ends the editor header, just after close-all',
  (() => {
    const toolbar = findIn(column, element => String(element.props?.className ?? '') === 'dsh-notebook-toolbar')
    if (toolbar === undefined) return false
    const children = [toolbar.props?.children].flat().filter(child => child !== null && child !== undefined)
    // Last two children, after the pickers: the two panel-wide controls, with the
    // switch at the very edge — closing the files is not a document control either,
    // but it is nearer the documents than the column switch is.
    return children.at(-2)?.props?.attrs?.['data-action'] === 'close-all'
      && children.at(-1)?.props?.attrs?.['data-action'] === 'toggle-chat'
      && children.length === 3
      && String(children[0]?.props?.className ?? '').includes('typebar')
  })(), 'the two switches are not the end of the editor toolbar')
check('close-all is disabled with no file open, rather than hidden',
  (() => {
    const toolbar = findIn(column, element => String(element.props?.className ?? '') === 'dsh-notebook-toolbar')
    const buttons = toolbar?.props?.children?.flat?.() ?? []
    const button = buttons.find(child => child?.props?.attrs?.['data-action'] === 'close-all')
    return button?.props?.disabled === true
      && button?.props?.attrs?.['aria-label'] === 'closeAll'
      && button?.props?.title === 'closeAll'
  })(), 'the close-all control is missing its no-file state or its name')
check('close-all is in the toolbar even when the shell has no conversation seat',
  (() => {
    const bare = NotebookTab({
      t: key => key,
      side: DEFAULT_LAYOUT.side,
      onSideResize: () => {},
      canChat: false,
      chatVisible: false,
      onToggleChat: () => {},
      prefs: { font: 'system', size: 15, paper: 'plain' },
      onPrefsChange: () => {},
    })
    const button = findIn(bare, element => element.props?.attrs?.['data-action'] === 'close-all')
    // Closing the files is not a feature of the conversation column: it stays when
    // the shell hands the page no chat seat at all.
    return button !== undefined && findIn(bare, element => element.props?.attrs?.['data-action'] === 'toggle-chat') === undefined
  })(), 'the close-all control depends on the chat seat')
check('close-all is not in the directory column',
  (() => {
    const pane = findIn(column, element => String(element.props?.className ?? '').includes('dsh-notebook-side'))
    if (pane === undefined) return false
    const inPane = []
    walk(pane, (element) => {
      const action = element.props?.['data-action'] ?? element.props?.attrs?.['data-action']
      if (typeof action === 'string') inPane.push(action)
    })
    return !inPane.includes('close-all')
  })(), 'the close-all control is in the directory column')
check('close-all writes every dirty tab before it closes any',
  // The order is the rule: the strip empties once, after every write has been tried,
  // and only a refused path is left in `refused` for the pure plan to keep. Asserted
  // on the emitted code, so a formatter collapsing the loop body cannot hide it.
  (() => {
    const flush = source.indexOf('refused.add(file.path)')
    const close = source.indexOf('leaving.has(file.path)')
    return flush >= 0 && close > flush
      && source.includes('new Set(planCloseAll(files, refused, active).close)')
  })(), 'the flush and the close are not in that order')

// --- the tree's right-click menu -------------------------------------------------------
// DSH provides one shared context menu (`ui-context-menu`), which this plugin extends
// through `ctx.contextMenus`: the shell owns the popup, this plugin declares a target
// family and the actions. The stub above records the contribution, so the rules can be
// driven as data rather than through a rendered popup.
const menuEntry = registrations.find(entry => entry.kind === 'menu')
check('the panel contributes to the shell\'s context menu',
  menuEntry?.contribution !== undefined, JSON.stringify(registrations.filter(e => e.kind === 'menu').length))
// The service was **not** available when `apply` ran (see `availableAtActivation`), so
// this only passes if the plugin waits for it with `ctx.inject` instead of probing
// with `ctx.get`. That is the bug a restart exposed: the menu quietly disappeared.
check('the menu is registered by waiting for the service, not by probing at activation',
  availableAtActivation.has('contextMenus') === false && menuEntry !== undefined,
  `available at activation: ${String(availableAtActivation.has('contextMenus'))}`)
check('the contribution is a target family of its own',
  // Contributing to the shipped `file` / `directory` families would put the
  // notebook's "new folder right here" on files the user right-clicked elsewhere.
  menuEntry?.contribution?.target === 'notebookEntry'
  && menuEntry?.contribution?.id === 'notebook.entry', String(menuEntry?.contribution?.target))
const menuActions = (entry) => menuEntry.contribution.resolve(entry, new AbortController().signal)
const fileEntryActions = menuActions({ path: '笔记/第一章', name: '第一章', directory: false })
check('a right-clicked file offers the six operations',
  fileEntryActions.map(action => action.id).join(',') === 'newFile,newFolder,rename,delete,refresh,reveal',
  fileEntryActions.map(action => action.id).join(','))
check('the destructive action is last among the entries and marked as one',
  (() => {
    const at = fileEntryActions.findIndex(action => action.id === 'delete')
    return fileEntryActions[at]?.danger === true
      && fileEntryActions[at]?.separatorBefore !== true
      && fileEntryActions[at + 1]?.id === 'refresh'
      && fileEntryActions[at + 1]?.separatorBefore === true
  })(), JSON.stringify(fileEntryActions.map(action => [action.id, action.danger ?? false])))
check('every action is localized and carries its own glyph',
  fileEntryActions.every(action => typeof action.label === 'string' && action.label.length > 0
    && typeof action.icon?.key === 'string'), '')
check('the root row can create and reveal, but cannot be renamed or deleted',
  // The root is not an entry in its own tree; there is nothing to point at.
  (() => {
    const root = menuActions({ path: '', name: '笔记本', directory: true }).map(action => action.id)
    return root.join(',') === 'newFile,newFolder,refresh,reveal'
  })(), menuActions({ path: '', name: 'root', directory: true }).map(a => a.id).join(','))
// Where "new" lands: inside the folder that was clicked, beside the file that was.
check('a new entry lands inside the folder that was right-clicked',
  exports.createTargetDir({ path: '素材', name: '素材', directory: true }) === '素材', '')
check('a new entry lands beside the file that was right-clicked',
  exports.createTargetDir({ path: '笔记/第一章', name: '第一章', directory: false }) === '笔记', '')
check('a root row creates at the workspace root',
  exports.createTargetDir({ path: '', name: 'root', directory: true }) === '', '')
// An action must not throw when no panel is mounted (a menu opened after the panel
// went away, or in a shell that never rendered it).
check('a menu action with no panel mounted is a no-op',
  (() => {
    try {
      for (const action of fileEntryActions) action.run?.()
      return true
    } catch { return false }
  })(), 'an action threw without a panel')
check('every menu glyph is registered in the icon slot',
  (() => {
    const keys = new Set(registrations.filter(entry => entry.kind === 'slot' && entry.options.name === 'contextMenu.icon')
      .map(entry => entry.options.key))
    return fileEntryActions.every(action => keys.has(action.icon.key)) && keys.size === 6
  })(), JSON.stringify([...new Set(registrations.filter(e => e.kind === 'slot' && e.options.name === 'contextMenu.icon').map(e => e.options.key))]))
check('the menu labels are all in both dictionaries',
  exports.MENU_LABEL_KEYS.every(key => typeof exports.DICTS.zh?.[key] === 'string' && typeof exports.DICTS.en[key] === 'string'),
  exports.MENU_LABEL_KEYS.filter(key => typeof exports.DICTS.zh?.[key] !== 'string').join(','))
// The rows must actually take the gesture. The panel binds it from the service the
// plugin published (`ctx.contextMenus.open()`), not from the `useContextMenu` prop —
// that hook never reached this component and the rows kept showing the browser menu.
const menuOpens = []
/** The service the rows talk to during the gesture checks; records every opening. */
const recordingMenuService = {
  register: () => () => {},
  notify: () => {},
  open: (target, point) => { menuOpens.push({ target, point }) },
}
exports.setMenuService(recordingMenuService)
/** The panel as the shell renders it, for the gesture checks below. */
const gestureColumn = (canChat) => NotebookTab({
  t: key => key,
  side: DEFAULT_LAYOUT.side,
  onSideResize: () => {},
  canChat,
  chatVisible: false,
  onToggleChat: () => {},
  prefs: { font: 'system', size: 15, paper: 'plain' },
  onPrefsChange: () => {},
})
const liveRows = []
walk(gestureColumn(false), (element) => {
  if (typeof element.props?.onContextMenu === 'function') liveRows.push(element)
})
// The stub render has no listing (state starts empty), so the element with a gesture
// is the directory column itself — which is the point: the whole column takes it, so
// right-clicking the blank space below the rows still opens the root menu.
check('the whole directory column takes the right-click gesture', liveRows.length === 1, String(liveRows.length))
check('the column\'s target is the workspace root',
  liveRows[0]?.props?.['data-root'] === undefined
  && liveRows[0]?.type === 'div'
  && String(liveRows[0]?.props?.className ?? '').includes('dsh-notebook-side'),
  String(liveRows[0]?.props?.className))
check('file and folder rows bind the same gesture and stop it',
  // They are built from the same helper as the column; without a listing the stub
  // cannot render one, so the binding is asserted at the source. `stop: true` is what
  // keeps a row's menu from being replaced by the column's.
  (source.match(/\.\.\.triggerProps\(entryTarget\(node\), \{ stop: true \}\)/g) ?? []).length === 2,
  String((source.match(/\.\.\.triggerProps\(entryTarget\(node\)/g) ?? []).length))
check('the heading does not bind its own menu (the column already does)',
  // Two bindings for one target at one point would open, then close, the popup.
  !/sectionTitle[\s\S]{0,200}rootMenu/.test(source), 'the heading still binds a second menu')
check('the column suppresses the browser menu and opens the shared one',
  (() => {
    const column = liveRows[0]
    let prevented = false
    let stopped = false
    column.props.onContextMenu({
      preventDefault: () => { prevented = true },
      stopPropagation: () => { stopped = true },
      clientX: 40, clientY: 90,
    })
    const first = menuOpens[0]
    return prevented && !stopped && menuOpens.length === 1
      && first?.point?.x === 40 && first?.point?.y === 90
      && first?.target?.kind === 'notebookEntry'
      // The column is the outermost handler: its target is the workspace root.
      && first?.target?.value?.path === '' && first?.target?.value?.directory === true
  })(), JSON.stringify(menuOpens[0] ?? null))
check('a nested trigger stops the event so its own target wins',
  (() => {
    const before = menuOpens.length
    let stopped = false
    const nested = exports.triggerProps(
      { kind: 'notebookEntry', value: { path: '笔记/第一章', name: '第一章', directory: false } },
      { stop: true },
    )
    nested.onContextMenu({
      preventDefault: () => {},
      stopPropagation: () => { stopped = true },
      clientX: 5, clientY: 7,
    })
    const last = menuOpens.at(-1)
    return stopped && menuOpens.length === before + 1 && last?.target?.value?.path === '笔记/第一章'
  })(), 'a row would have been overridden by the column')
check('the captured target carries the row it was opened on',
  typeof menuOpens[0]?.target?.value?.path === 'string'
  && typeof menuOpens[0]?.target?.value?.directory === 'boolean', JSON.stringify(menuOpens[0]?.target?.value))
check('the keyboard opens the menu too',
  (() => {
    const before = menuOpens.length
    let prevented = false
    liveRows[0].props.onKeyDown({
      key: 'F10', shiftKey: true, preventDefault: () => { prevented = true },
      currentTarget: { getBoundingClientRect: () => ({ left: 10, bottom: 30 }) },
    })
    return prevented && menuOpens.length === before + 1 && menuOpens.at(-1)?.point?.y === 30
  })(), JSON.stringify(menuOpens.at(-1) ?? null))
check('an unrelated key is left alone',
  (() => {
    const before = menuOpens.length
    liveRows[0].props.onKeyDown({
      key: 'a', shiftKey: false, preventDefault: () => {},
      currentTarget: { getBoundingClientRect: () => ({ left: 0, bottom: 0 }) },
    })
    return menuOpens.length === before
  })(), '')
// Without the service the row must still carry the handlers (they are bound at render
// time, before `ctx.inject` may have run) but must leave the gesture completely alone,
// so the browser's own menu appears instead of nothing.
exports.setMenuService(undefined)
const bareRows = []
walk(gestureColumn(false), (element) => {
  if (typeof element.props?.onContextMenu === 'function') bareRows.push(element)
})
check('with no menu service the handlers exist but do not swallow the gesture',
  (() => {
    if (bareRows.length === 0) return false
    let prevented = false
    let stopped = false
    bareRows[0].props.onContextMenu({
      preventDefault: () => { prevented = true },
      stopPropagation: () => { stopped = true },
      clientX: 1, clientY: 2,
    })
    // No `preventDefault` means the browser's own menu still opens.
    return !prevented && !stopped
  })(), `${String(bareRows.length)} row(s) carried no handler`)
// A gesture that arrives after the service shows up must work without a re-render:
// this is the ordering a restart exposed.
check('a gesture after the service arrives opens the menu without a re-render',
  (() => {
    exports.setMenuService(recordingMenuService)
    const before = menuOpens.length
    let prevented = false
    bareRows[0].props.onContextMenu({
      preventDefault: () => { prevented = true },
      stopPropagation: () => {},
      clientX: 3, clientY: 4,
    })
    return prevented && menuOpens.length === before + 1 && menuOpens.at(-1)?.point?.x === 3
  })(), 'the handler kept its activation-time decision')

// --- styles ------------------------------------------------------------------------
const css = /const CSS = `([\s\S]*?)`;/.exec(source)?.[1] ?? ''
check('the panel ships its stylesheet', css.includes('.dsh-notebook-root{'), `${css.length} chars`)
check('every dsh-notebook-* class the bundle uses has a rule',
  // `dsh-notebook-page` and `dsh-notebook-delete-question` are element **ids** (the
  // page a tab controls, and the dialog's question), not classes: they are named for
  // accessibility wiring and need no stylesheet entry.
  [...new Set([...source.matchAll(/(?<![.\w-])dsh-notebook-[A-Za-z0-9]+/g)].map(match => match[0]))]
    .filter(name => name !== 'dsh-notebook-page' && name !== 'dsh-notebook-delete')
    .filter(name => !css.includes(`.${name}`) && !css.includes(`@keyframes ${name}`)).length === 0,
  '')
check('the paper covers the whole panel',
  /\.dsh-notebook-root\[data-paper\]\{[^}]*--dsw-alias-bg-base:var\(--dsh-notebook-paper-bg\)/.test(source), '')
check('four paper palettes exist',
  ['plain', 'elegant', 'night', 'green'].every(id => source.includes(`[data-paper="${id}"]`)), '')
check('the selected option is styled', /button\.dsh-notebook-btn\[data-selected="true"\]/.test(source), '')
check('the reveal icon turns while it works', source.includes('@keyframes dsh-notebook-spin'), '')
// "Fixed" is a layout claim, so it is asserted on the stylesheet: the head does not
// shrink, the tabs keep their own text and scroll sideways, and the page below the
// head is the only region that scrolls.
check('the toolbar and tabs are pinned above a scrolling page',
  /\.dsh-notebook-editorHead\{[^}]*flex:none/.test(css)
  && /\.dsh-notebook-editor\{[^}]*flex:1[^}]*overflow:hidden/.test(css)
  && /\.dsh-notebook-tabs\{[^}]*min-height:33px/.test(css)
  && /\.dsh-notebook-tab\{[^}]*flex:none/.test(css), '')
check('the drawn tab is the raised one',
  // The drawn tab is the *paper* colour — the only place in the tinted band that is —
  // with a brand bar along its top, so it opens straight into the page below it.
  /\.dsh-notebook-tab\[data-active="true"\]\{[^}]*background:var\(--dsw-alias-bg-base\)/.test(css)
  && /\.dsh-notebook-tab\[data-active="true"\]\{[^}]*inset 0 2px 0 0 var\(--dsw-alias-brand-primary\)/.test(css), '')
check('the tab band is tinted and the drawn tab is a hole in it',
  // The band is the only tinted strip; the drawn tab paints the paper back over it.
  // Both halves are needed for the "joined to the page" reading to work.
  /\.dsh-notebook-tabs\{[^}]*background:var\(--dsw-alias-bg-layer-1\)/.test(css)
  && !/\.dsh-notebook-tab\[data-active="true"\]\{[^}]*border-bottom/.test(css), '')
// The header band: both columns draw the same-height row, and the grip — which sits
// *between* them and is 6px of empty space — carries its own 1px of the rule. Without
// that, the line across the panel would visibly break at every drag handle.
check('the two columns open with one header band, unbroken across the grips',
  /\.dsh-notebook-section\{[^}]*height:44px/.test(css)
  && /\.dsh-notebook-toolbar\{[^}]*height:44px/.test(css)
  && /\.dsh-notebook-toolbar\{[^}]*border-bottom:1px solid/.test(css)
  && /\.dsh-notebook-grip::after\{[^}]*top:43px/.test(css)
  && !/\.dsh-notebook-editorHead\{[^}]*border-bottom/.test(css), '')
check('the toolbar has a fixed height, so a narrow column cannot move the header line',
  // A `min-height` band grows when its contents wrap, which would push the rule down
  // relative to the directory column's; a fixed height scrolls instead.
  /\.dsh-notebook-toolbar\{[^}]*height:44px/.test(css)
  && !/\.dsh-notebook-toolbar\{[^}]*min-height/.test(css), '')
check('the toolbar pins the conversation switch and scrolls only the pickers',
  // The band itself must not scroll: the one control on it that is not about the
  // document would otherwise be the thing that scrolls out of sight in a narrow
  // column. The pickers get their own scrolling strip between the two edges.
  /\.dsh-notebook-toolbar\{[^}]*overflow:hidden/.test(css)
  && /\.dsh-notebook-toolbar > \.dsh-notebook-typebar\{[^}]*overflow-x:auto/.test(css)
  && /\.dsh-notebook-toolbar > button\.dsh-notebook-btn\{[^}]*flex:none/.test(css), '')
check('a narrow toolbar scrolls its pickers instead of wrapping onto a clipped line',
  // The band is a fixed 44px with `overflow:hidden`, so a wrapped second line of
  // pickers would simply be cut off — silently, and only in narrow columns.
  /\.dsh-notebook-toolbar > \.dsh-notebook-typebar\{[^}]*flex-wrap:nowrap/.test(css), '')
check('the page carries no frame of its own',
  // The manuscript used to be a bordered, rounded card inside the panel — three
  // nested rectangles where the writing surface should be one.
  /\.dsh-notebook-doc\{[^}]*border:0/.test(css)
  && /\.dsh-notebook-doc\{[^}]*border-radius:0/.test(css)
  && /\.dsh-notebook-editor\{[^}]*padding:0/.test(css), '')
// The reported bug: a two-line markdown file that starts with `# 标题` scrolled.
// The cause was margin collapse — the heading's 1.4em top margin left the page
// element and pushed it down inside the scroll container, which then overflowed by
// exactly that margin (33px at the default size 15). Asserted at its two causes:
// the page establishes a formatting context, and its first/last blocks carry no
// outer margin. Measured in headless Chrome against this same stylesheet: 33px of
// overflow before, 0 after, with the page still filling the column.
check('the page contains its blocks margins, so a short file cannot scroll',
  /\.dsh-notebook-pm\{[^}]*display:flow-root/.test(css)
  && /\.dsh-notebook-pm > :first-child\{margin-top:0\}/.test(css)
  && /\.dsh-notebook-pm > :last-child\{margin-bottom:0\}/.test(css), '')
check('the page still fills the column, and only the page scrolls',
  // The fix must not have come from a shorter page: with no `min-height:100%` the
  // page would end at the last line, and a click below it would miss the editor.
  /\.dsh-notebook-pm\{[^}]*min-height:100%/.test(css)
  && /\.dsh-notebook-pmHost\{[^}]*overflow:auto/.test(css)
  && /\.dsh-notebook-pmHost\{[^}]*min-height:0/.test(css), '')
check('the directory column does not scroll, so its heading stays put',
  // Same shape as the editor: a fixed head over its own scrolling list. Both columns'
  // headings must stay where the shared 44px line is drawn.
  /\.dsh-notebook-side\{[^}]*overflow:hidden/.test(css)
  && /\.dsh-notebook-scroll\{[^}]*overflow:auto/.test(css), '')
check('the heading gives way before its controls do',
  // The band is a fixed 44px, so a wrapped name would be clipped rather than shown:
  // it truncates, and the six icons keep their size.
  /\.dsh-notebook-sectionTitle\{[^}]*white-space:nowrap/.test(css)
  && /\.dsh-notebook-sectionTitle\{[^}]*text-overflow:ellipsis/.test(css)
  && /\.dsh-notebook-section button\.dsh-notebook-btn\[data-variant="icon"\]\{[^}]*flex:none/.test(css), '')
check('the picker groups are trays, not a row of bordered boxes',
  /\.dsh-notebook-seg\{[^}]*border-radius:8px/.test(css)
  && /\.dsh-notebook-seg > button\.dsh-notebook-btn\{[^}]*border:0/.test(css)
  && /\.dsh-notebook-seg > button\.dsh-notebook-btn\[data-selected="true"\]\{[^}]*background:var\(--dsw-alias-bg-base\)/.test(css), '')
check('every picker control is the same height',
  /\.dsh-notebook-seg\{[^}]*height:28px/.test(css)
  && /\.dsh-notebook-typebar \.dsh-notebook-select\{[^}]*height:28px/.test(css)
  && /\.dsh-notebook-seg > button\.dsh-notebook-btn\{[^}]*height:22px/.test(css), '')
check('the toolbar and tab strip share one left edge',
  /\.dsh-notebook-toolbar\{[^}]*padding:0 12px/.test(css)
  && /\.dsh-notebook-tabs\{[^}]*padding:3px 8px 0/.test(css), '')
check('no stylesheet rule is declared twice',
  // An appended duplicate silently wins: a second `.dsh-notebook-tab` block would
  // override the tab design above without any file looking wrong.
  (() => {
    const seen = new Set()
    for (const line of css.split('\n')) {
      const match = /^(\s*\.[^{]+)\{/.exec(line)
      if (match === null) continue
      const selector = match[1].trim()
      if (seen.has(selector)) return false
      seen.add(selector)
    }
    return true
  })(), 'a selector is declared more than once')
check('an open-but-not-drawn tree row is marked differently from the drawn one',
  /\.dsh-notebook-item\[data-open="true"\]:not\(\[data-active="true"\]\)/.test(css), '')

// The colour vocabulary and the stylesheet have to be one list: a class the colouring
// emits with no rule is text drawn in the wrong colour, silently.
check('every colour the highlighting emits has a rule',
  HIGHLIGHT_CLASSES.every(name => css.includes(`.${name}`)),
  HIGHLIGHT_CLASSES.filter(name => !css.includes(`.${name}`)).join(','))
/** WCAG 2.1 relative luminance of an sRGB hex colour. */
const relativeLuminance = (hex) => {
  const channel = (value) => {
    const s = value / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
/** WCAG 2.1 contrast ratio: (lighter + 0.05) / (darker + 0.05). */
const contrastRatio = (a, b) => {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((left, right) => right - left)
  return (light + 0.05) / (dark + 0.05)
}
/** The syntax-colour custom properties one `data-paper` rule declares. */
const paperVars = (paper) => {
  const rule = new RegExp(`\\[data-paper="${paper}"\\]\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
  return new Map([...rule.matchAll(/(--dsh-notebook-hl-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map(match => [match[1], match[2]]))
}
/** The surfaces those colours are drawn on, from the same paper rule. */
const paperSurface = (paper) => {
  const rule = new RegExp(`\\[data-paper="${paper}"\\]\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
  const read = name => new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(rule)?.[1]
  return { paper: read('--dsh-notebook-paper-bg'), fence: read('--dsh-notebook-paper-code') }
}
// The palettes are Dracula's, so they are asserted against Dracula's own values rather
// than against a taste rule. Sources, read from the specification and the theme README:
//   https://draculatheme.com/spec  ·  https://github.com/dracula/dracula-theme
// If the theme revises a hex, this table is the one place to follow it.
const DRACULA_COLOURS = {
  background: '#282a36',
  comment: '#6272a4',
  red: '#ff5555',
  orange: '#ffb86c',
  yellow: '#f1fa8c',
  green: '#50fa7b',
  cyan: '#8be9fd',
  purple: '#bd93f9',
  pink: '#ff79c6',
  foreground: '#f8f8f2',
}
const ALUCARD_COLOURS = {
  background: '#fffbeb',
  comment: '#6c664b',
  red: '#cb3a2a',
  orange: '#a34d14',
  yellow: '#846e15',
  green: '#14710a',
  cyan: '#036a96',
  purple: '#644ac9',
  pink: '#a3144d',
  foreground: '#1f1f1f',
}
// The role → theme-colour mapping, straight from the spec's Token Classification table.
const DRACULA_ROLES = {
  comment: 'comment',
  meta: 'comment',
  keyword: 'pink',
  operator: 'pink',
  title: 'green',
  addition: 'green',
  builtin: 'cyan',
  attr: 'cyan',
  regexp: 'cyan',
  link: 'cyan',
  string: 'yellow',
  number: 'orange',
  literal: 'orange',
  symbol: 'purple',
  variable: 'foreground',
  deletion: 'red',
}
/** The palette a `data-paper` rule declares, keyed by role (not by custom property). */
const paletteOf = (paper) => {
  const vars = paperVars(paper)
  const palette = new Map()
  for (const [name, value] of vars) palette.set(name.replace('--dsh-notebook-hl-', ''), value.toLowerCase())
  return palette
}
/** The light trio's palette: one rule lists all three papers. */
const lightPalette = (() => {
  const rule = /\[data-paper="plain"\],[^{]*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  const palette = new Map()
  for (const match of rule.matchAll(/(--dsh-notebook-hl-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) {
    palette.set(match[1].replace('--dsh-notebook-hl-', ''), match[2].toLowerCase())
  }
  return palette
})()
const nightPalette = paletteOf('night')
/** The roles: everything but the two surface tokens. */
const ROLES = Object.keys(DRACULA_ROLES)
check('every syntax colour is one of the theme\'s own values',
  // The requirement is fidelity: a colour that is not in the palette is not Dracula.
  (() => {
    const official = new Set([...Object.values(DRACULA_COLOURS), ...Object.values(ALUCARD_COLOURS)])
    const strays = []
    for (const [label, palette] of [['light', lightPalette], ['night', nightPalette]]) {
      for (const [role, value] of palette) {
        if (!official.has(value)) strays.push(`${label}.${role}=${value}`)
      }
    }
    if (strays.length > 0) console.log(`  ${strays.join('\n  ')}`)
    // Sixteen roles plus the background and foreground the code is drawn on.
    return strays.length === 0 && lightPalette.size === 18 && nightPalette.size === 18
  })(), 'a syntax colour is not from the Dracula or Alucard palette')
check('each role draws the theme colour the specification gives it',
  // The mapping is the spec's Token Classification table: keywords Pink, functions
  // Green, types and support Cyan, strings Yellow, numbers Orange, comments Comment,
  // variables Foreground, deletions Red.
  (() => {
    const missing = []
    for (const [role, themeColour] of Object.entries(DRACULA_ROLES)) {
      if (lightPalette.get(role) !== ALUCARD_COLOURS[themeColour].toLowerCase()) {
        missing.push(`light.${role} should be Alucard ${themeColour} (${ALUCARD_COLOURS[themeColour]}), got ${lightPalette.get(role)}`)
      }
      if (nightPalette.get(role) !== DRACULA_COLOURS[themeColour].toLowerCase()) {
        missing.push(`night.${role} should be Dracula ${themeColour} (${DRACULA_COLOURS[themeColour]}), got ${nightPalette.get(role)}`)
      }
    }
    if (missing.length > 0) console.log(`  ${missing.join('\n  ')}`)
    return missing.length === 0
  })(), 'a role draws a colour the specification does not assign it')
check('code is drawn on the theme\'s own background, not the paper\'s tint',
  // The measurement that decided this: on 绿荫's old grey tint six Alucard roles fell
  // under AA; on the theme's own #fffbeb none do. A fence, an inline run and the source
  // editor all have to use it, or the palette is being quoted out of context.
  lightPalette.get('bg') === ALUCARD_COLOURS.background.toLowerCase()
  && nightPalette.get('bg') === DRACULA_COLOURS.background.toLowerCase()
  && lightPalette.get('fg') === ALUCARD_COLOURS.foreground.toLowerCase()
  && nightPalette.get('fg') === DRACULA_COLOURS.foreground.toLowerCase()
  // The three code surfaces, each pointing at that token.
  && /\.dsh-notebook-pm pre\{[^}]*background:var\(--dsh-notebook-hl-bg/.test(css)
  && /\.dsh-notebook-pm code\{[^}]*background:var\(--dsh-notebook-hl-bg/.test(css)
  && /\.dsh-notebook-src\[data-coloured="true"\]\{[^}]*background:var\(--dsh-notebook-hl-bg/.test(css)
  // A plain-text file with no grammar keeps the paper: a theme surface with no theme
  // colours on it would be decoration without a reason.
  && !/\.dsh-notebook-src\{[^}]*background:var\(--dsh-notebook-hl-bg/.test(css), '')
// Contrast is measured against the surface the tokens are actually drawn on: the
// theme's own background, since that is what a fence, an inline run and the source
// editor are painted with. The role tokens are checked there; the two surface tokens
// are checked against themselves by construction.
// Dracula's own comment colour is below 4.5:1 on Dracula's own background — that is
// the theme, and the panel does not get to "fix" a name it is trying to reproduce.
// What is enforced is that nothing is illegible (3:1 floor) and that the set of AA
// misses is exactly the documented one, so a palette edit cannot quietly add more.
const AA_EXCEPTIONS = new Set(['night:comment', 'night:meta'])
const contrastPairs = (() => {
  const pairs = []
  for (const [label, palette] of [['light', lightPalette], ['night', nightPalette]]) {
    const background = palette.get('bg')
    if (background === undefined) continue
    for (const role of ROLES) {
      const value = palette.get(role)
      if (value === undefined) continue
      pairs.push({ label, role, value, background, ratio: contrastRatio(value, background) })
    }
  }
  return pairs
})()
check('nothing the highlighting can draw is illegible on the code surface',
  // 3:1 is the floor for large text and UI edges; below it the colour stops being a
  // colour and becomes a smudge. This is the assertion a future palette edit must keep,
  // whatever it does about AA.
  (() => {
    const bad = contrastPairs.filter(pair => pair.ratio < 3)
    if (bad.length > 0) console.log(`  ${bad.map(p => `${p.label}:${p.role} ${p.value} on ${p.background} = ${p.ratio.toFixed(2)}`).join('\n  ')}`)
    return bad.length === 0
  })(), 'a syntax colour drops below 3:1 on the surface it is drawn on')
check('the pairs below WCAG AA are exactly the documented ones',
  // The theme's own values, not a rounded-off palette: what fails AA is named here, so
  // it cannot grow without someone deciding to grow it.
  (() => {
    const misses = contrastPairs.filter(pair => pair.ratio < 4.5)
      .map(pair => `${pair.label}:${pair.role}`).sort()
    const documented = [...AA_EXCEPTIONS].sort()
    const gained = misses.filter(miss => !AA_EXCEPTIONS.has(miss))
    const healed = documented.filter(doc => !misses.includes(doc))
    if (gained.length > 0) console.log(`  newly below AA: ${gained.join(', ')}`)
    if (healed.length > 0) console.log(`  no longer below AA (update the table): ${healed.join(', ')}`)
    return gained.length === 0 && healed.length === 0
  })(), 'the set of sub-AA pairs changed')
check('the darkest and lightest code surfaces stay legible',
  // A direct statement of the two facts the palette choice rests on: Alucard clears AA
  // on its own background, and Dracula clears 3:1 on its own.
  contrastRatio(ALUCARD_COLOURS.yellow, ALUCARD_COLOURS.background) >= 4.5
  && contrastRatio(DRACULA_COLOURS.comment, DRACULA_COLOURS.background) >= 3,
  `alucard yellow ${contrastRatio(ALUCARD_COLOURS.yellow, ALUCARD_COLOURS.background).toFixed(2)}, `
  + `dracula comment ${contrastRatio(DRACULA_COLOURS.comment, DRACULA_COLOURS.background).toFixed(2)}`)
check('the light palette is the same values for all three light papers',
  // It is declared once, on a selector listing the three: one edit cannot leave 绿荫
  // behind, which is the paper whose background is darkest and first to fail contrast.
  (() => {
    const rule = /(\[data-paper="plain"\],[^{]*)\{([^}]*--dsh-notebook-hl-[^}]*)\}/.exec(css)
    const selectors = rule?.[1] ?? ''
    return ['plain', 'elegant', 'green'].every(name => selectors.includes(`[data-paper="${name}"]`))
      // Exactly one rule carries a light palette: a second one would override it.
      && (css.match(/--dsh-notebook-hl-comment:/g) ?? []).length === 2
  })(), 'a light paper declares colours of its own')
check('the roles collapse into theme colours exactly as the specification says',
  // Dracula gives several roles one colour on purpose — numbers, constants and booleans
  // are all Orange; support and built-ins are all Cyan. That is the theme, so this
  // asserts the *collapse*, which is the opposite of the "every token is its own colour"
  // rule an invented palette needs.
  (() => {
    /** role → theme colour name, for one palette. */
    const collapse = (palette, colours) => {
      const byValue = new Map(Object.entries(colours).map(([name, hex]) => [hex, name]))
      const groups = new Map()
      // Only the roles take part: bg and fg are the surface the roles are drawn on.
      for (const role of ROLES) {
        const value = palette.get(role)
        if (value === undefined) return undefined
        const themeColour = byValue.get(value)
        if (themeColour === undefined) return undefined
        if (!groups.has(themeColour)) groups.set(themeColour, [])
        groups.get(themeColour).push(role)
      }
      return groups
    }
    const light = collapse(lightPalette, ALUCARD_COLOURS)
    const night = collapse(nightPalette, DRACULA_COLOURS)
    if (light === undefined || night === undefined) return false
    // The expected grouping, from the role table itself — so this cannot disagree with it.
    const expected = new Map()
    for (const [role, themeColour] of Object.entries(DRACULA_ROLES)) {
      if (!expected.has(themeColour)) expected.set(themeColour, [])
      expected.get(themeColour).push(role)
    }
    const same = (actual, wanted) => [...wanted].every(([themeColour, roles]) => {
      const got = [...(actual.get(themeColour) ?? [])].sort().join(',')
      return got === [...roles].sort().join(',')
    }) && actual.size === wanted.size
    return same(light, expected) && same(night, expected)
  })(), 'a role is drawn in a colour the specification does not group it under')
check('a code block names its language, in the block\'s own top edge',
  // A label, not a tooltip: it is drawn, it sits in padding reserved for it so it never
  // covers the first line, and an info string with no grammar dims instead of claiming
  // a colour the block does not have.
  /\.dsh-notebook-pm pre\[data-language\]:not\(\[data-language=""\]\)\{[^}]*padding-top:1\.9em/.test(css)
  && /pre\[data-language\][^{]*::after\{[^}]*content:attr\(data-language\)/.test(css)
  && /pre\[data-language\][^{]*::after\{[^}]*top:\.35em/.test(css)
  && /pre\[data-language-known="false"\]::after\{[^}]*opacity/.test(css)
  // No `:hover` gate: the language is a fact about the block, not an interaction.
  && !/pre\[data-language\][^{]*:hover::after/.test(css), '')
check('the layer follows the textarea by scrolling, and cannot scroll on its own',
  // `scrollTop` is the only thing that keeps a long file's colour under its text, and a
  // box clipped with `clip` would ignore the assignment.
  /\.dsh-notebook-srcCode\{[^}]*overflow:hidden/.test(css)
  && !/\.dsh-notebook-srcCode\{[^}]*overflow:clip/.test(css)
  && typeof sourceInput?.props?.onScroll === 'function', '')
check('the source view says why it is not coloured',
  /\.dsh-notebook-srcLabel\{[^}]*position:absolute/.test(css)
  && /\.dsh-notebook-srcLabel\{[^}]*top:2px/.test(css), '')
check('the source editor draws its colour behind the text, in one box',
  // Both layers share every metric that decides where a glyph lands; the textarea is the
  // one on top with transparent glyphs and a live caret.
  /\.dsh-notebook-src\{[^}]*position:relative/.test(css)
  && /\.dsh-notebook-srcText\{[^}]*position:absolute/.test(css)
  && /\.dsh-notebook-srcText\{[^}]*white-space:pre-wrap/.test(css)
  && /\.dsh-notebook-srcText\{[^}]*tab-size:4/.test(css)
  && /\.dsh-notebook-srcInput\{[^}]*color:transparent/.test(css)
  // The caret is the theme's foreground: it is the one thing the textarea still
  // draws itself, and it has to be visible on the theme's own background.
  && /\.dsh-notebook-srcInput\{[^}]*caret-color:var\(--dsh-notebook-hl-fg/.test(css)
  && /\.dsh-notebook-srcCode\{[^}]*pointer-events:none/.test(css), '')
check('an input method composing a word is drawn, not hidden',
  // The pre-edit text is drawn by the textarea, whose glyphs are transparent: without
  // this rule a composed character would be invisible until it was committed.
  /\.dsh-notebook-src\[data-composing="true"\] \.dsh-notebook-srcCode\{[^}]*visibility:hidden/.test(css)
  && /\.dsh-notebook-src\[data-composing="true"\] \.dsh-notebook-srcInput\{[^}]*text-fill-color:currentColor/.test(css), '')
check('the layer\'s code inherits the editor\'s face, not the browser\'s monospace',
  // A `code` element is monospace by default, which would put the colour in a different
  // font from the textarea's glyphs and shift it off the characters it belongs to.
  /\.dsh-notebook-srcCode code\{[^}]*font:inherit/.test(css)
  && /\.dsh-notebook-srcCode code\{[^}]*tab-size:inherit/.test(css)
  && /\.dsh-notebook-srcCode code\{[^}]*white-space:inherit/.test(css), '')
check('a selection lets the colour show through instead of covering it',
  // The textarea paints its selection above the layer, so an opaque one would hide the
  // glyphs it just selected.
  /\.dsh-notebook-srcInput::selection\{[^}]*transparent/.test(css), '')

// --- one icon set --------------------------------------------------------------------
// The gem's paths moved out of `glyphs.tsx` when the sidebar row started drawing the
// artwork itself, so the "one stroke family" rule covers the in-panel glyphs only.
check('every in-panel glyph is drawn on the Lucide grid at one weight',
  source.includes('strokeWidth: 2') && !source.includes('strokeWidth: 1.6')
  && (source.match(/viewBox: "0 0 24 24"/g) ?? []).length === 1, '')
// The sidebar row and the inventory card must show the same artwork. DSH reads the
// card's icon from `icon.png` (it refuses other formats, and `.ico` by name), and the
// bundle inlines those exact bytes, so both are compared with the PNG itself.
const pluginIcon = await readFile(new URL('../icon.png', import.meta.url))
const iconWidth = pluginIcon.length >= 24 ? pluginIcon.readUInt32BE(16) : 0
const iconHeight = pluginIcon.length >= 24 ? pluginIcon.readUInt32BE(20) : 0
check('the plugin icon is a PNG inside the metadata size limit',
  pluginIcon.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  && pluginIcon.length <= 256 * 1024, `${pluginIcon.length} bytes`)
check('the plugin icon is a square large enough for the inventory card',
  iconWidth === 256 && iconHeight === 256, `${iconWidth}x${iconHeight}`)
check('the manifest points DSH at that PNG',
  pkg.icon === './icon.png' && pkg.exports['./icon'] === './icon.png'
  && pkg.files.includes('icon.png'), JSON.stringify({ icon: pkg.icon, export: pkg.exports['./icon'] }))
const artwork = `data:image/png;base64,${pluginIcon.toString('base64')}`
const mark = sidebarEntry?.component?.({ size: 18, active: false })
check('the sidebar row draws the plugin artwork, not a monochrome glyph',
  mark?.type === 'img' && mark.props.src === artwork, mark === undefined ? 'no component' : String(mark.type))
check('the artwork follows the edge the sidebar asks for',
  mark?.props.width === 18 && mark.props.height === 18, `${String(mark?.props.width)}x${String(mark?.props.height)}`)
check('the bundle inlines icon.png, so the packet ships one copy',
  source.includes(artwork), 'the bundle does not carry icon.png')

// --- the tree's type artwork ---------------------------------------------------------
// Material Icon Theme's associations are data, so they are checked as data: the exact
// name rule, the extension rule, folders open and closed, and the generic fallbacks.
const {
  FALLBACK_FILE,
  FALLBACK_FOLDER,
  FALLBACK_FOLDER_OPEN,
  TREE_ICON_SIZE,
  iconArtwork,
  iconIdForFile,
  iconIdForFolder,
  materialIconIds,
  TreeIcon,
} = exports
const ids = materialIconIds()
check('the bundle carries the theme\'s drawings', ids.length >= 60 && ids.includes('file')
  && ids.includes('markdown') && ids.includes('folder') && ids.includes('folder-open'), `${ids.length} drawings`)
check('every drawing is inert, self-contained SVG markup',
  ids.every((id) => {
    const art = iconArtwork(id)
    // An id must be scoped to its icon: several theme drawings reuse `id="a"`, and two
    // inlined copies on one page would resolve each other's references.
    if (/<script\b|<foreignObject\b|\son[a-z]+\s*=|\bjavascript:/iu.test(art)) return false
    const local = [...art.matchAll(/\sid="([^"]+)"/gu)].map(match => match[1])
    return art.startsWith('<svg') && local.every(id_ => id_.startsWith(`${id}-`))
  }), 'a drawing is missing, executable, or carries an unscoped element id')
check('a known file name wins over its extension',
  iconIdForFile('package.json') === 'nodejs' && iconIdForFile('README.md') === 'readme'
  && iconIdForFile('LICENSE') === 'license' && iconIdForFile('data.csv') === 'table',
  `${iconIdForFile('package.json')}/${iconIdForFile('README.md')}/${iconIdForFile('LICENSE')}`)
check('the name rule ignores case',
  iconIdForFile('Package.JSON') === 'nodejs' && iconIdForFile('README.MD') === 'readme', '')
check('an extension names the kind of text the Host will list',
  iconIdForFile('笔记.md') === 'markdown' && iconIdForFile('poem.txt') === 'document'
  && iconIdForFile('数据.yaml') === 'yaml' && iconIdForFile('log.jsonl') === 'json',
  `${iconIdForFile('笔记.md')}/${iconIdForFile('poem.txt')}`)
// The tree lists code now, so code gets its own mark instead of the grey sheet: a
// repository's `src/` is rows of `.js` and `.ts`, and one generic drawing for all of
// them says less than the language marks every editor already teaches.
check('a source file is drawn as its language',
  iconIdForFile('main.js') === 'javascript' && iconIdForFile('app.ts') === 'typescript'
  && iconIdForFile('view.tsx') === 'react_ts' && iconIdForFile('script.py') === 'python'
  && iconIdForFile('main.go') === 'go' && iconIdForFile('lib.rs') === 'rust'
  && iconIdForFile('style.css') === 'css' && iconIdForFile('index.html') === 'html',
  [iconIdForFile('main.js'), iconIdForFile('app.ts'), iconIdForFile('script.py')].join('/'))
check('a type with no themed mark keeps the generic sheet',
  // Vendoring a drawing per language is a size decision, not a correctness one: the
  // fallback is the theme's own, exactly as VS Code draws an unmatched type. The Host
  // still lists such a file — the tree's rule is "not binary", not "has an icon".
  iconIdForFile('notes.zzz') === FALLBACK_FILE
  && iconIdForFile('归档.zzz') === FALLBACK_FILE, iconIdForFile('notes.zzz'))
// The one place this panel follows the editor's rule instead of the theme's table: a
// name with no extension opens as a markdown document here, and that is how a chapter
// is named by default, so most rows of a novel depend on it. The predicate is the
// editor's own (`isMarkdownPath`), which is what keeps the two from disagreeing.
check('an extensionless name is drawn as the document the editor opens',
  iconIdForFile('第一章') === 'markdown' && iconIdForFile('说明') === 'markdown'
  && iconIdForFile('第一章') === iconIdForFile('笔记.md'),
  `${iconIdForFile('第一章')}/${iconIdForFile('说明')}`)
check('a name the editor would not render keeps the generic file',
  iconIdForFile('history.jsonl') === 'json' && iconIdForFile('.gitignore') === FALLBACK_FILE
  && iconIdForFile('mystery.zzz') === FALLBACK_FILE && iconIdForFile('<img>.zzz') === FALLBACK_FILE,
  `${iconIdForFile('.gitignore')}/${iconIdForFile('mystery.zzz')}`)
check('a prototype key is not read as an association',
  iconIdForFile('constructor') === 'markdown' && iconIdForFolder('constructor') === FALLBACK_FOLDER
  && iconIdForFolder('__proto__') === FALLBACK_FOLDER,
  `${iconIdForFile('constructor')}/${iconIdForFolder('constructor')}`)
check('a folder is drawn from its own name',
  iconIdForFolder('src') === 'folder-src' && iconIdForFolder('assets') === 'folder-resource'
  && iconIdForFolder('素材') === FALLBACK_FOLDER, `${iconIdForFolder('src')}/${iconIdForFolder('素材')}`)
check('an open folder has its own drawing and a closed fallback',
  iconIdForFolder('src', true) === 'folder-src-open'
  && iconIdForFolder('素材', true) === FALLBACK_FOLDER_OPEN, iconIdForFolder('src', true))
const fileRow = TreeIcon({ name: '笔记.md' })
const folderRow = TreeIcon({ name: '素材', directory: true })
check('a row inlines the drawing, keyed by its icon id',
  fileRow.type === 'span' && fileRow.props['data-icon'] === 'markdown'
  && folderRow.props['data-icon'] === 'folder'
  && String(fileRow.props.dangerouslySetInnerHTML?.__html).startsWith('<svg'),
  JSON.stringify(fileRow.props['data-icon']))
check('an unnamed row draws the generic file or folder, not a looked-up name',
  TreeIcon({ name: '' }).props['data-icon'] === FALLBACK_FILE
  && TreeIcon({ name: '  ', directory: true }).props['data-icon'] === FALLBACK_FOLDER,
  `${TreeIcon({ name: '' }).props['data-icon']}/${TreeIcon({ name: '', directory: true }).props['data-icon']}`)
check('a row is the same edge as the toolbar glyphs',
  fileRow.props.style.width === TREE_ICON_SIZE && TREE_ICON_SIZE === 16, String(TREE_ICON_SIZE))
// The reported bug, asserted at its cause: depth is drawn as left padding on a
// `width:100%` row. With content-box sizing the padding was added outside that width,
// so every level made the row wider than the list; the list then had a horizontal
// scroll position, and focusing the autofocused input of a new or renamed row scrolled
// it — the tree slid left by the row's depth and its icon ended up out of view.
check('an indent never widens a row past its column',
  // `border-box` is what keeps the padding inside `width:100%`.
  /\.dsh-notebook-item\{[^}]*box-sizing:border-box/.test(css) && /\.dsh-notebook-item\{[^}]*width:100%/.test(css), '')
check('the tree cannot scroll sideways, so focus cannot slide it',
  // `clip` rather than `hidden`: hidden still leaves a scroll position that
  // `scrollIntoView` can move, and the row's own autofocus does exactly that.
  /\.dsh-notebook-list\.dsh-notebook-scroll\{[^}]*overflow-x:clip/.test(css), '')
check('every row takes its indent from the one helper',
  // Three rows are drawn per level — the row, the empty row a name is typed into, and
  // the row an inline rename edits. A level only one of them applied is a row that
  // jumps sideways the moment the author starts typing.
  (source.match(/rowIndent\(/g) ?? []).length >= 3 && !source.includes('8 + depth * 14'), '')
check('the deepest indent still leaves room for an icon',
  // Derived from the column's own floor rather than picked: list padding 12, row
  // border 2, icon 16 and gap 8 come off SIDE_MIN first.
  exports.SIDE_MIN - 12 - 2 - TREE_ICON_SIZE - 8 >= TREE_INDENT_MAX,
  `SIDE_MIN ${String(exports.SIDE_MIN)} vs indent cap ${String(TREE_INDENT_MAX)}`)
check('the tree rows draw the artwork, not a Lucide file or folder glyph',
  !source.includes('FileIcon') && !source.includes('FolderIcon'), 'a generic glyph is still in the bundle')
check('the vendored licence ships with the package',
  pkg.files.includes('assets/material-icons/LICENSE.txt') && pkg.files.includes('assets/material-icons/NOTICE.md'),
  JSON.stringify(pkg.files))
check('the syntax colouring\'s licences ship too',
  // highlight.js is BSD-3-Clause and lowlight MIT; both are bundled into the artifact, so
  // the notice has to travel with the package.
  ['assets/highlight/LICENSE.txt', 'assets/highlight/LICENSE-lowlight.txt', 'assets/highlight/NOTICE.md']
    .every(file => pkg.files.includes(file)), JSON.stringify(pkg.files))
check('the highlighter is a build-time dependency, not a runtime one',
  // Everything but react is inlined into the bundle, so a `dependencies` entry would make
  // DSH install a second copy that nothing loads.
  pkg.dependencies === undefined
  && typeof pkg.devDependencies['highlight.js'] === 'string'
  && typeof pkg.devDependencies.lowlight === 'string',
  JSON.stringify(pkg.dependencies ?? null))
// The vendored selection must follow what the Host will list, or the bundle pays for
// drawings no row can ever show. `HOST_TEXT_EXTENSIONS` in the vendor script and
// `TEXT_EXTENSIONS` in the Host are two copies of one rule, so they are compared here.
const hostManuscript = await readFile(new URL('../src/host/story/manuscript.ts', import.meta.url), 'utf8')
const hostExtensions = [...(/TEXT_EXTENSIONS = new Set\(\[([^\]]+)\]\)/.exec(hostManuscript)?.[1] ?? '')
  .matchAll(/'([^']+)'/g)].map(match => match[1].replace(/^\./, '')).sort()
const vendorScript = await readFile(new URL('../scripts/vendor-material-icons.mjs', import.meta.url), 'utf8')
const vendoredExtensions = [...(/HOST_TEXT_EXTENSIONS = \[([^\]]+)\]/.exec(vendorScript)?.[1] ?? '')
  .matchAll(/'([^']+)'/g)].map(match => match[1]).sort()
const generatedSource = await readFile(new URL('../src/client/icons/material.generated.ts', import.meta.url), 'utf8')
check('the vendored file types are the ones the Host lists',
  hostExtensions.length > 0 && hostExtensions.join(',') === vendoredExtensions.join(','),
  `host=${hostExtensions.join(',')} vendor=${vendoredExtensions.join(',')}`)
check('every vendored file drawing is reachable from a real association',
  (() => {
    // A file drawing with no association in the shipped tables can never be shown —
    // it would be bytes paid for on every page load and never drawn. `file` and
    // `markdown` are the two the component reaches directly (fallback and document).
    const referenced = new Set(['file', 'markdown'])
    for (const table of ['FILE_NAMES', 'FILE_EXTENSIONS']) {
      const start = generatedSource.indexOf(`export const ${table}: Record<string, string> = {`)
      const body = generatedSource.slice(start, generatedSource.indexOf('\n}', start))
      for (const match of body.matchAll(/: "([^"]+)",/g)) referenced.add(match[1])
    }
    const orphans = ids.filter(id => !id.startsWith('folder-') && id !== 'folder' && !referenced.has(id))
    return orphans.length === 0
  })(),
  'a file drawing no association reaches is being shipped')
check('the carried drawings are the text types the tree can list',
  // The mirror image of the rule above: a binary type is refused by the Host, so its
  // drawing would be an SVG no row can ever carry.
  ['typescript', 'javascript', 'python', 'rust', 'go'].every(id => ids.includes(id))
  && ['image', 'video', 'pdf', 'zip', 'font', 'excel', 'powerpoint', 'word']
    .every(id => !ids.includes(id)),
  ['image', 'pdf', 'zip'].filter(id => ids.includes(id)).join(','))

// --- names ---------------------------------------------------------------------------
const { DICTS } = exports
const zhDict = DICTS.zh
check('the panel is called 笔记本 in both places it appears',
  zhDict.panel === '笔记本' && zhDict.library === '笔记本', `${zhDict.panel}/${zhDict.library}`)
check('the English name is Notebook', DICTS.en.panel === 'Notebook' && DICTS.en.library === 'Notebook', DICTS.en.panel)
check('the inventory title is the same name', localeMeta.zh.title === zhDict.panel, localeMeta.zh.title)
check('both dictionaries carry the same keys',
  Object.keys(zhDict).sort().join(',') === Object.keys(DICTS.en).sort().join(','), '')
check('the action labels are present',
  ['newDir', 'newFile', 'refresh', 'reveal', 'rename', 'delete', 'renameEntry', 'deleteEntry', 'writing', 'source']
    .every(key => typeof zhDict[key] === 'string'), '')
check('the close-all control is named in both dictionaries',
  zhDict.closeAll === '关闭所有文件' && DICTS.en.closeAll === 'Close all files',
  `${String(zhDict.closeAll)}/${String(DICTS.en.closeAll)}`)
check('the close-all glyph is a circled ×, not the bare cross a tab carries',
  // Lucide's `circle-x`: the ring is what says "all of them", and the plain × is
  // already the mark a single tab's close control carries.
  /createElement\("circle", \{\s*cx: 12,\s*cy: 12,\s*r: 10\s*\}\)/.test(source)
  && source.includes('"m15 9-6 6"') && source.includes('CloseAllIcon'), '')
check('the heading\'s two edit labels name their target',
  zhDict.renameEntry.includes('{name}') && zhDict.deleteEntry.includes('{name}')
  && DICTS.en.renameEntry.includes('{name}') && DICTS.en.deleteEntry.includes('{name}'), '')
check('the old product name is gone from the artifact',
  !source.includes('写作助手') && !source.includes('微光') && !source.includes('novel-studio'), 'a retired name is still shipped')
// The vendored icon tables are third-party data, not product copy: they legitimately
// contain `storyboard` (an XML dialect's file extension) and hundreds of other words.
// The retired features are searched for in the plugin's own code, so the icon data is
// cut out first — from its region marker to the next module the bundle emits.
const ownSource = source.replace(
  /\/\/#region src\/client\/icons\/material\.generated\.ts[\s\S]*?(?=\/\/#region )/,
  '',
)
check('the icon data was cut out before the retired-feature scan',
  ownSource.length < source.length && !ownSource.includes('"storyboard"'),
  `${source.length} -> ${ownSource.length} chars`)
check('the story machinery is gone from the artifact',
  !ownSource.includes('novel_projects') && !ownSource.includes('comic_') && !ownSource.includes('bible')
  && !ownSource.includes('storyboard') && !ownSource.includes('/api/glimmer'), 'a removed feature still ships')
check('api calls name the notebook route',
  source.includes('"/api/notebook"') && !source.includes('/notebook/media'), '')

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nclient artifact satisfies the module-system contract')
