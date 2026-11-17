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
check('a new file is named in an empty row inside the tree',
  source.includes('dsh-notebook-ghost') && source.includes('dsh-notebook-ghostInput'), '')
check('the empty row commits on Enter and cancels on Escape',
  source.includes('Escape') && source.includes('isComposing'), '')

// --- the editor's tabs ---------------------------------------------------------------
// The tab model is pure, so the rules that matter are asserted as data: one buffer
// per open file, a second click activating rather than re-reading, and a close that
// lands on the neighbouring tab rather than on no tab at all.
const { closeFile, fileNameOf, findFile, nextActive, openFile, patchFile, TabStrip } = exports
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
check('the conversation switch ends the editor header, at its right edge',
  (() => {
    const toolbar = findIn(column, element => String(element.props?.className ?? '') === 'dsh-notebook-toolbar')
    if (toolbar === undefined) return false
    const children = [toolbar.props?.children].flat().filter(child => child !== null && child !== undefined)
    const last = children.at(-1)
    // Last child, and after the pickers: the switch is the panel-wide control at the
    // right end of the band, not another document control.
    return last?.props?.attrs?.['data-action'] === 'toggle-chat'
      && children.length === 2
      && String(children[0]?.props?.className ?? '').includes('typebar')
  })(), 'the switch is not the last thing in the editor toolbar')

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
    return orphans.length === 0 && !ids.includes('typescript') && !ids.includes('image')
  })(),
  'a file drawing no association reaches is being shipped')

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
