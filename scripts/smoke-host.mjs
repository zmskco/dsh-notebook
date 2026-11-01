/**
 * End-to-end smoke test for the Host half, run without a Harness.
 *
 * `apply()` takes its services by injection and the control plane is a plain
 * fetch-shaped handler, so the whole Host side can be driven here: a `node:fs`
 * backed `FsService` stands in for the sandbox, and the store, root resolver and
 * sandbox assessment are the real shipped modules. That makes this a regression
 * net for `api.ts` and `project.ts` that runs with no DSH process, no browser and
 * no credentials.
 *
 * The one honest gap: this does not exercise Connection's own trust fence, so it
 * proves the plugin's logic, not that the route is authenticated in DSH.
 *
 * Usage: node scripts/smoke-host.mjs
 */
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve as resolveAbs, sep } from 'node:path'

import { apply } from '../lib/index.js'
import { revealCommand } from '../lib/http/reveal.js'

const failures = []
let checks = 0
const check = (label, condition, detail) => {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  failures.push(label)
}

/** A `FsService` over the real filesystem, rooted at one directory. */
function createFs(rootDir) {
  const root = resolveAbs(rootDir)
  const key = (target) => target.targetKey
  return {
    async resolve(path, opts) {
      return { targetKey: resolveAbs(opts?.cwd ?? root, path), displayPath: path }
    },
    processPath(target) {
      return key(target)
    },
    contains(parent, child) {
      const outer = key(parent)
      const inner = key(child)
      return inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep)
    },
    async stat(target) {
      try {
        const info = await stat(key(target))
        return {
          version: `${String(info.mtimeMs)}-${String(info.size)}`,
          type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
          size: info.size,
        }
      } catch {
        return undefined
      }
    },
    async readText(target) {
      return await readFile(key(target), 'utf8')
    },
    async writeText(target, content) {
      await mkdir(dirname(key(target)), { recursive: true })
      await writeFile(key(target), content, 'utf8')
      return { operation: 'update', version: 'written', before: null, after: 'written' }
    },
    async listDir(target) {
      const entries = await readdir(key(target), { withFileTypes: true })
      return entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
        target: { targetKey: join(key(target), entry.name), displayPath: entry.name },
        version: 'listed',
      }))
    },
  }
}

const root = await mkdtemp(join(tmpdir(), 'notebook-smoke-'))
const fetchRoutes = new Map()
const logs = []
/** Every `[session id, directory]` the working-directory service was asked to commit. */
const focused = []

const ctx = {
  fs: createFs(root),
  webServer: { register: () => () => {} },
  connection: {
    fetch: {
      register(route) {
        fetchRoutes.set(route.path, route)
        return async () => {}
      },
    },
    requestRejection: () => undefined,
  },
  logger: {
    info: (...args) => logs.push(['info', args]),
    warn: (...args) => logs.push(['warn', args]),
    error: (...args) => logs.push(['error', args]),
  },
  get(name) {
    if (name === 'sandboxPolicy') {
      return {
        workspaceRoot: root,
        resolve: (options) => ({ mode: options?.session === undefined ? 'workspace-write' : 'workspace-write' }),
      }
    }
    if (name === 'agents') {
      return {
        get: (id) => (id === 's-main' ? { id, session: { header: { cwd: root } } } : undefined),
        currentInitiator: () => undefined,
      }
    }
    if (name === 'workingDirectory') {
      return {
        defaultDirectory: root,
        get: () => root,
        set: (agent, dir) => { focused.push([agent.id, dir]); return Promise.resolve(dir) },
      }
    }
    return undefined
  },
  effect(callback) {
    const dispose = callback()
    return () => { void dispose }
  },
}

try {
  apply(ctx, { rootDir: root })

  check('the api route is registered', fetchRoutes.has('/api/notebook'))
  check('activation logged the root',
    logs.some(([level, args]) => level === 'info' && String(args[0]).includes(`root=${root}`)),
    JSON.stringify(logs.slice(0, 2)))

  const route = fetchRoutes.get('/api/notebook')
  const call = async (op, { params = {}, body } = {}) => {
    const url = new URL(`http://dsh.invalid/api/notebook?op=${op}`)
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value))
    const response = await route.fetch(new Request(url, body === undefined
      ? {}
      : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
    const text = await response.text()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
    return { status: response.status, body: parsed }
  }

  const state = await call('state')
  check('op=state reports the configured root', state.body.rootDir === root, JSON.stringify(state.body.rootDir))
  check('op=state names the rule that chose it',
    state.body.rootSource === 'override', JSON.stringify(state.body.rootSource))
  check('op=state reports a writable workspace',
    state.body.sandbox?.writable === true && state.body.sandbox?.guidance === null,
    JSON.stringify(state.body.sandbox))
  check('op=state no longer carries story machinery',
    !('projects' in state.body) && !('backend' in state.body) && !('jobs' in state.body),
    JSON.stringify(Object.keys(state.body)))

  // --- files and folders ---------------------------------------------------------
  const firstFile = await call('create-file', { body: { project: '', title: '手稿' } })
  check('create-file answers 201', firstFile.status === 201, String(firstFile.status))
  check('the file keeps the typed name, with no suffix',
    firstFile.body.path === '手稿', JSON.stringify(firstFile.body.path))
  check('a prose file is seeded with its heading',
    firstFile.body.content === '# 手稿\n\n', JSON.stringify(firstFile.body.content))

  const dotted = await call('create-file', { body: { project: '', title: '素材.md' } })
  check('a name that already has an extension is not given a second one',
    dotted.status === 201 && dotted.body.path === '素材.md', JSON.stringify(dotted.body.path))
  check('a dotted name keeps its heading without the suffix',
    dotted.body.content === '# 素材\n\n', JSON.stringify(dotted.body.content))

  const machine = await call('create-file', { body: { project: '', title: '数据.json' } })
  check('a non-prose name is created empty',
    machine.status === 201 && machine.body.content === '', JSON.stringify(machine.body.content))

  const again = await call('create-file', { body: { project: '', title: '手稿' } })
  check('a taken name gets a number before any extension',
    again.status === 201 && again.body.path === '手稿-2', JSON.stringify(again.body.path))

  const dir = await call('create-dir', { body: { project: '', name: '笔记' } })
  check('create-dir answers 201', dir.status === 201 && dir.body.path === '笔记', JSON.stringify(dir.body))
  check('the directory exists on disk', (await readdir(root)).includes('笔记'), (await readdir(root)).join(','))
  const duplicate = await call('create-dir', { body: { project: '', name: '笔记' } })
  check('a duplicate directory is a 409 conflict', duplicate.status === 409, String(duplicate.status))
  const separator = await call('create-dir', { body: { project: '', name: 'a/b' } })
  check('a name carrying a separator is refused', separator.status === 400, String(separator.status))

  const inSub = await call('create-file', { body: { project: '', title: '第一则', dir: '笔记' } })
  check('a file can be created inside a folder', inSub.body.path === '笔记/第一则', JSON.stringify(inSub.body.path))

  const listing = await call('files', { params: { project: '' } })
  check('the listing names the files and folders',
    ['手稿', '素材.md', '数据.json', '手稿-2', '笔记', '笔记/第一则'].every((path) => listing.body.files.some((entry) => entry.path === path)),
    listing.body.files.map((entry) => entry.path).join(','))
  check('the listing is sorted as the panel expects',
    listing.body.files.map((entry) => entry.path).join(',')
      === [...listing.body.files].map((entry) => entry.path).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true })).join(','),
    listing.body.files.map((entry) => entry.path).join(','))

  // --- reading and writing ---------------------------------------------------------
  const saved = await call('save-file', { body: { project: '', path: '手稿', content: '# 手稿\n\n雨落在窗上。' } })
  check('save-file answers with the stored document', saved.status === 200 && saved.body.content.endsWith('雨落在窗上。'), String(saved.status))
  check('a character count comes back', saved.body.chars === 12, String(saved.body.chars))
  const read = await call('file', { params: { project: '', path: '手稿' } })
  check('file round-trips through the store', read.body.content === '# 手稿\n\n雨落在窗上。', JSON.stringify(read.body.content))
  const missing = await call('file', { params: { project: '', path: '不存在' } })
  check('a missing file is a 404', missing.status === 404, String(missing.status))
  const binary = await call('save-file', { body: { project: '', path: '图.png', content: 'x' } })
  check('an extension the editor cannot write is a 400', binary.status === 400, String(binary.status))

  // --- paths that must never leave the workspace -----------------------------------
  const escape = await call('save-file', { body: { project: '', path: '../escape.txt', content: 'x' } })
  check('a path climbing out with .. is refused', escape.status === 400, String(escape.status))
  const absolute = await call('save-file', { body: { project: '', path: '/etc/passwd', content: 'x' } })
  check('an absolute path is refused', absolute.status === 400, String(absolute.status))
  const badProject = await call('files', { params: { project: 'demo' } })
  check('a project id other than the workspace is refused', badProject.status === 400, String(badProject.status))

  // --- the README a new workspace gets ---------------------------------------------
  const readme = await call('ensure-readme', { body: {} })
  check('the first open writes the workspace README',
    readme.status === 201 && readme.body.created === true, JSON.stringify(readme.body))
  const text = await readFile(join(root, 'README.md'), 'utf8')
  check('the README names the plugin and what it does',
    text.includes('# dsh-notepad') && text.includes('自动保存') && text.includes('重命名，删除'),
    text.slice(0, 80))
  const second = await call('ensure-readme', { body: {} })
  check('a second open finds it and leaves it alone',
    second.status === 200 && second.body.created === false, JSON.stringify(second.body))
  await writeFile(join(root, 'README.md'), 'CUSTOM README')
  await call('ensure-readme', { body: {} })
  check('a workspace that already had a README keeps it',
    (await readFile(join(root, 'README.md'), 'utf8')) === 'CUSTOM README', 'README was overwritten')

  // --- the OS file manager -----------------------------------------------------------
  const winLaunch = revealCommand('win32', 'D:\\x')
  check('the file-manager command is per platform',
    winLaunch.command.toLowerCase().endsWith('cmd.exe')
    && winLaunch.args[1].includes('start "" "D:\\x"') && winLaunch.verbatim === true
    && revealCommand('darwin', '/x').command === 'open'
    && revealCommand('linux', '/x').command === 'xdg-open',
    ['win32', 'darwin', 'linux'].map((platform) => `${platform}:${revealCommand(platform, '/w').command}`).join(' '))
  const reveal = await call('reveal', { body: { dryRun: true } })
  check('op=reveal targets the workspace directory',
    reveal.status === 200 && reveal.body.dir === root && reveal.body.args.join(' ').includes(root),
    JSON.stringify(reveal.body))
  const sneaky = await call('reveal', { params: { path: 'C:\\Windows' }, body: { dryRun: true } })
  check('op=reveal ignores any path the caller sends',
    sneaky.status === 200 && !sneaky.body.args.join(' ').includes('C:\\Windows'),
    JSON.stringify(sneaky.body))

  // --- the Session's working directory ------------------------------------------------
  const focus = await call('focus', { params: { session: 's-main' }, body: { project: '' } })
  check('op=focus moves the Session onto the workspace',
    focus.status === 200 && focus.body.dir === root && focus.body.focused === true, JSON.stringify(focus.body))
  check('op=focus asked the working-directory service for that directory',
    focused.length === 1 && focused[0][0] === 's-main' && focused[0][1] === root, JSON.stringify(focused))

  // --- write boundary ------------------------------------------------------------------
  const stamped = []
  const realWrite = ctx.fs.writeText.bind(ctx.fs)
  ctx.fs.writeText = async (target, content, expected, signal, policy) => {
    stamped.push(policy)
    return await realWrite(target, content)
  }
  await call('save-file', { body: { project: '', path: '手稿', content: '# 手稿\n\n再写一句。' } })
  check('every write is stamped with the mode and this workspace as the boundary',
    stamped.length === 1
    && stamped[0]?.mode === 'workspace-write'
    && String(stamped[0]?.workspaceRoot).startsWith(sep === '\\' ? root : root),
    JSON.stringify(stamped))
  ctx.fs.writeText = realWrite

  // --- failures -------------------------------------------------------------------------
  const unknown = await call('nope')
  check('an unknown op is a 400', unknown.status === 400, String(unknown.status))
  const notJson = await route.fetch(new Request(`http://dsh.invalid/api/notebook?op=save-file`, {
    method: 'POST',
    body: '{not json',
    headers: { 'content-type': 'application/json' },
  }))
  check('a malformed body is a 400', notJson.status === 400, String(notJson.status))
} finally {
  await rm(root, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} check(s) failed`)
  process.exit(1)
}
console.log(`\nHost smoke test passed (${String(checks)} checks)`)
