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
const React = { createElement, useCallback: fn => fn, useEffect: fn => { fn() }, useMemo: fn => fn(), useRef: v => ({ current: v }), useState: v => [v, () => {}] }

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
const ctx = {
  locale: {
    register: (ns, lang, dict) => { registrations.push({ kind: 'locale', ns, lang, dict }); return () => {} },
    bind: () => (key) => key,
  },
  slots: {
    inject: (name, callback) => { callback(); return () => {} },
    register: (options) => {
      const entry = { kind: 'slot', options }
      registrations.push(entry)
      return () => {}
    },
    children: {},
  },
  effect: (callback) => { callback(); return () => {} },
}
try {
  exports.apply(ctx)
} catch (error) {
  check('applying the client half does not throw', false, String(error))
}
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
  rootDirs.find(d => d.name === '笔记').fileCount === 2 && rootDirs.find(d => d.name === '素材').fileCount === 1,
  JSON.stringify(rootDirs))
check('files inside a folder are listed without the directories',
  childFiles(listing, '笔记').map(file => file.name).join(',') === '第二则,第一则',
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
check('countFiles counts a folder recursively',
  countFiles(noteNode) === 2, String(countFiles(noteNode)))

// --- layout and typography ------------------------------------------------------
const { DEFAULT_LAYOUT, clampPane, loadLayout, readLayout, resizePane, toggleTalking } = exports
check('the directory column opens at 300px', DEFAULT_LAYOUT.side === 300, String(DEFAULT_LAYOUT.side))
check('the conversation column opens at 400px', DEFAULT_LAYOUT.chat === 400, String(DEFAULT_LAYOUT.chat))
check('the document keeps its minimum width', resizePane({ side: 200, chat: 400 }, 'side', 900, 1000).side <= 1000 - 360 - 400,
  JSON.stringify(resizePane({ side: 200, chat: 400 }, 'side', 900, 1000)))
check('a pane is clamped to its bounds', clampPane(50, 200, 520) === 200 && clampPane(9000, 200, 520) === 520, '')
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
check('the heading carries create, refresh, reveal and chat controls',
  ['new-dir', 'new-file', 'refresh', 'reveal', 'toggle-chat'].every(action => actions.includes(action)),
  actions.join(','))
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
check('the heading reads title … creates, refresh, reveal, then the chat switch',
  order.join(',') === 'title,spacer,new-dir,new-file,refresh,reveal,toggle-chat', order.join(','))
check('a new file is named in an empty row inside the tree',
  source.includes('dsh-notebook-ghost') && source.includes('dsh-notebook-ghostInput'), '')
check('the empty row commits on Enter and cancels on Escape',
  source.includes('Escape') && source.includes('isComposing'), '')

// --- styles ------------------------------------------------------------------------
const css = /const CSS = `([\s\S]*?)`;/.exec(source)?.[1] ?? ''
check('the panel ships its stylesheet', css.includes('.dsh-notebook-root{'), `${css.length} chars`)
check('every dsh-notebook-* class the bundle uses has a rule',
  [...new Set([...source.matchAll(/(?<![.\w-])dsh-notebook-[A-Za-z0-9]+/g)].map(match => match[0]))]
    .filter(name => !css.includes(`.${name}`) && !css.includes(`@keyframes ${name}`)).length === 0,
  '')
check('the paper covers the whole panel',
  /\.dsh-notebook-root\[data-paper\]\{[^}]*--dsw-alias-bg-base:var\(--dsh-notebook-paper-bg\)/.test(source), '')
check('four paper palettes exist',
  ['plain', 'elegant', 'night', 'green'].every(id => source.includes(`[data-paper="${id}"]`)), '')
check('the selected option is styled', /button\.dsh-notebook-btn\[data-selected="true"\]/.test(source), '')
check('the reveal icon turns while it works', source.includes('@keyframes dsh-notebook-spin'), '')

// --- one icon set --------------------------------------------------------------------
check('every glyph is drawn on the Lucide grid at one weight',
  source.includes('strokeWidth: 2') && !source.includes('strokeWidth: 1.6')
  && (source.match(/viewBox: "0 0 24 24"/g) ?? []).length === 1, '')
const pluginIcon = await readFile(new URL('../icon.svg', import.meta.url), 'utf8')
check('the plugin icon is the same notebook the sidebar mark draws',
  pluginIcon.includes('viewBox="0 0 24 24"') && pluginIcon.includes('stroke-width="2"')
  && pluginIcon.includes('M2 6h4') && pluginIcon.includes('width="16" height="20"'), pluginIcon.slice(0, 80))

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
  ['newDir', 'newFile', 'refresh', 'reveal', 'writing', 'source'].every(key => typeof zhDict[key] === 'string'), '')
check('the old product name is gone from the artifact',
  !source.includes('写作助手') && !source.includes('微光') && !source.includes('novel-studio'), 'a retired name is still shipped')
check('the story machinery is gone from the artifact',
  !source.includes('novel_projects') && !source.includes('comic_') && !source.includes('bible')
  && !source.includes('storyboard') && !source.includes('/api/glimmer'), 'a removed feature still ships')
check('api calls name the notebook route',
  source.includes('"/api/notebook"') && !source.includes('/notebook/media'), '')

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nclient artifact satisfies the module-system contract')
