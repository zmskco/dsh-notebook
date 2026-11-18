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
    /**
     * The byte window the tree sniffs.
     *
     * The store asks for the first few kilobytes of an unknown-extension file to
     * decide whether it is text, so the stand-in has to serve a window rather than
     * the whole file: `readBytes` and `readByteRange` differ in exactly that, and a
     * fake that only implements the former would make the listing take a path the
     * real provider does not have.
     */
    async readByteRange(target, range) {
      const info = await stat(key(target)).catch(() => undefined)
      if (info === undefined) throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' })
      if (!info.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'FS_NOT_REGULAR_FILE' })
      const raw = await readFile(key(target))
      return raw.subarray(range.offset, range.offset + range.length)
    },
    async writeText(target, content) {
      await mkdir(dirname(key(target)), { recursive: true })
      await writeFile(key(target), content, 'utf8')
      return { operation: 'update', version: 'written', before: null, after: 'written' }
    },
    /**
     * Remove one regular file, as the real provider does.
     *
     * The contract is the reason this is a stub of its own rather than a `rm` in the
     * store: a directory is `FS_NOT_REGULAR_FILE` here, so a test that "deletes" a
     * folder through this seam would be testing a path the provider never takes.
     */
    async deleteFile(target) {
      const info = await stat(key(target)).catch(() => undefined)
      if (info === undefined) throw Object.assign(new Error('missing'), { code: 'FS_STALE_VERSION' })
      if (!info.isFile()) throw Object.assign(new Error('not a regular file'), { code: 'FS_NOT_REGULAR_FILE' })
      const before = await readFile(key(target), 'utf8')
      await rm(key(target))
      return { before }
    },
    /**
     * Publish the source text at the destination, then remove the source — the same
     * two effects, in the same order, as the real `moveFile`.
     */
    async moveFile(source, destination) {
      const before = await readFile(key(source), 'utf8')
      await mkdir(dirname(key(destination)), { recursive: true })
      await writeFile(key(destination), before, 'utf8')
      await rm(key(source))
      return {
        sourceBefore: before,
        destination: { operation: 'create', version: 'moved', before: null, after: before },
        sourceDeleted: true,
      }
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
/**
 * A second workspace, to prove the root follows the calling Session rather than
 * anything configured: `s-other` opened this one, and the tree it sees is this one.
 */
const otherRoot = await mkdtemp(join(tmpdir(), 'notebook-smoke-other-'))
await writeFile(join(otherRoot, '别的会话.md'), '# 别的会话\n', 'utf8')
const fetchRoutes = new Map()
const logs = []
/** Every `[session id, directory]` the working-directory service was asked to commit. */
const focused = []
/** The live Sessions this profile's agent registry knows, by id. */
const sessions = new Map([
  ['s-main', { header: { cwd: root } }],
  ['s-other', { header: { cwd: otherRoot } }],
])

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
        resolve: (options) => ({
          mode: 'workspace-write',
          workspaceRoot: options?.session?.header?.cwd ?? root,
        }),
      }
    }
    if (name === 'agents') {
      return {
        get: (id) => (sessions.has(id) ? { id, session: sessions.get(id) } : undefined),
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
  apply(ctx, {})

  check('the api route is registered', fetchRoutes.has('/api/notebook'))
  check('activation logged the root',
    logs.some(([level, args]) => level === 'info' && String(args[0]).includes(`root=${root}`)),
    JSON.stringify(logs.slice(0, 2)))
  check('the plugin takes no configuration, so activation warns about none',
    !logs.some(([level, args]) => level === 'warn' && String(args[0]).includes('unknown configuration')),
    JSON.stringify(logs.filter(([level]) => level === 'warn')))

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
  check('op=state reports the deployment fallback root', state.body.rootDir === root, JSON.stringify(state.body.rootDir))
  check('op=state reports no rule, because there is no pinned root to name',
    !('rootSource' in state.body), JSON.stringify(Object.keys(state.body)))
  check('op=state reports a writable workspace',
    state.body.sandbox?.writable === true && state.body.sandbox?.guidance === null,
    JSON.stringify(state.body.sandbox))
  check('op=state no longer carries story machinery',
    !('projects' in state.body) && !('backend' in state.body) && !('jobs' in state.body),
    JSON.stringify(Object.keys(state.body)))

  // --- the root follows the caller -------------------------------------------------
  const otherSession = await call('state', { params: { session: 's-other' } })
  check('a Session that opened another workspace is served that workspace',
    otherSession.body.rootDir === otherRoot, JSON.stringify(otherSession.body.rootDir))
  const otherFiles = await call('files', { params: { session: 's-other', project: '' } })
  check('and its tree lists that workspace, not the deployment fallback',
    otherFiles.body.files.some((entry) => entry.path === '别的会话.md'),
    otherFiles.body.files.map((entry) => entry.path).join(','))
  const mainSession = await call('state', { params: { session: 's-main' } })
  check('one plugin instance serves both workspaces',
    mainSession.body.rootDir === root && otherSession.body.rootDir === otherRoot,
    `${mainSession.body.rootDir} / ${otherSession.body.rootDir}`)

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
  check('the listing comes back in a stable numeric order',
    // The panel sorts again by name (that rule is `compareNames` in the Client, and
    // `check:client` drives it directly); this is only that the wire order is not
    // random, so two reads of an unchanged tree agree.
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
  check('a binary type cannot be written', binary.status === 400, String(binary.status))

  // --- what the tree lists ---------------------------------------------------------
  // The tree used to be a short extension allowlist, then a "text only" filter. Both
  // hid files the filesystem has, and "my file is not there" is the report that
  // produces. Now **everything** is listed; a file the editor cannot open arrives as
  // `kind: 'binary'` so the panel can explain instead of hiding it.
  await writeFile(join(root, '工具.js'), 'export const add = (a, b) => a + b\n', 'utf8')
  await writeFile(join(root, '脚本.py'), 'print("hi")\n', 'utf8')
  await writeFile(join(root, '说明.unknownext'), '这只是一段普通文字。\n', 'utf8')
  await writeFile(join(root, '二进制.unknownext'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a]), 'binary')
  await writeFile(join(root, '照片.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'binary')
  await writeFile(join(root, '.gitignore'), 'node_modules\n', 'utf8')
  const wide = await call('files', { params: { project: '' } })
  const paths = wide.body.files.map((entry) => entry.path)
  const entryOf = (path) => wide.body.files.find((entry) => entry.path === path)
  check('a source file is listed as text',
    entryOf('工具.js')?.kind === 'text' && entryOf('脚本.py')?.kind === 'text',
    JSON.stringify([entryOf('工具.js'), entryOf('脚本.py')]))
  check('a file whose type the panel does not know is listed when its bytes are text',
    entryOf('说明.unknownext')?.kind === 'text', JSON.stringify(entryOf('说明.unknownext')))
  check('a file that cannot be previewed is listed, marked as binary, not hidden',
    // The reported bug: a folder holding an image looked like a folder holding
    // nothing. The row exists and says what it is.
    entryOf('照片.png')?.kind === 'binary' && entryOf('二进制.unknownext')?.kind === 'binary',
    JSON.stringify([entryOf('照片.png'), entryOf('二进制.unknownext')]))
  check('a dotfile is listed like any other file',
    entryOf('.gitignore')?.kind === 'text', JSON.stringify(entryOf('.gitignore')))
  check('the listing reports whether it was cut off',
    wide.body.truncated === false, JSON.stringify(wide.body.truncated))
  // A deep tree is the other way a listing comes back partial: files exist past the
  // depth cap, and a listing that stops there without saying so looks complete.
  let deep = root
  for (let level = 0; level < 14; level += 1) {
    deep = join(deep, `层${String(level)}`)
    await mkdir(deep, { recursive: true })
  }
  await writeFile(join(deep, '太深.md'), '# 太深\n', 'utf8')
  const deepListing = await call('files', { params: { project: '' } })
  check('a tree deeper than the walk reaches is reported as partial',
    deepListing.body.truncated === true
    && !deepListing.body.files.some((entry) => entry.path.endsWith('太深.md')),
    JSON.stringify(deepListing.body.truncated))
  const opened = await call('file', { params: { project: '', path: '工具.js' } })
  check('a listed source file opens as text',
    opened.status === 200 && opened.body.content.includes('export const add'), JSON.stringify(opened.status))
  const sniffed = await call('file', { params: { project: '', path: '说明.unknownext' } })
  check('an unknown type opens because its bytes are text',
    sniffed.status === 200 && sniffed.body.content.includes('普通文字'), JSON.stringify(sniffed.status))
  const refused = await call('file', { params: { project: '', path: '二进制.unknownext' } })
  check('a binary opens as a 400, not as mojibake',
    refused.status === 400, `${String(refused.status)} ${JSON.stringify(refused.body)}`)

  // The rule the user asked for, on the wire: a digit run in a name is a number.
  await writeFile(join(root, '9.md'), '# 9\n', 'utf8')
  await writeFile(join(root, '10.md'), '# 10\n', 'utf8')
  const numbered = await call('files', { params: { project: '' } })
  const order = numbered.body.files.map((entry) => entry.path).filter((path) => /^\d+\.md$/.test(path))
  check('9.md is listed before 10.md', order.join(',') === '9.md,10.md', order.join(','))

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
  // A path is accepted now, but only a workspace-relative one: the Host resolves it and
  // proves it is inside the tree before opening anything, so an absolute path is still
  // refused rather than followed.
  const sneaky = await call('reveal', { body: { dryRun: true, path: 'C:\\Windows' } })
  check('op=reveal refuses an absolute path',
    sneaky.status === 400, `${String(sneaky.status)} ${JSON.stringify(sneaky.body)}`)
  const traverse = await call('reveal', { body: { dryRun: true, path: '../../etc' } })
  check('op=reveal refuses a climbing path', traverse.status === 400, String(traverse.status))
  await call('create-dir', { body: { project: '', dir: '', name: '可打开' } })
  const folderReveal = await call('reveal', { body: { dryRun: true, path: '可打开' } })
  check('op=reveal opens the folder that was named',
    folderReveal.status === 200 && folderReveal.body.dir.endsWith('可打开'), JSON.stringify(folderReveal.body))
  const fileReveal = await call('reveal', { body: { dryRun: true, path: '手稿' } })
  check('op=reveal on a file opens the folder holding it',
    fileReveal.status === 200 && fileReveal.body.dir === root, JSON.stringify(fileReveal.body))

  // --- rename and delete ----------------------------------------------------------------
  const renamed = await call('rename', { body: { project: '', path: '手稿', name: '手稿-改名' } })
  check('op=rename answers with the new path',
    renamed.status === 200 && renamed.body.path === '手稿-改名' && renamed.body.from === '手稿',
    JSON.stringify(renamed.body))
  const afterRename = await call('files', { params: { project: '' } })
  check('the renamed file is listed under its new name',
    afterRename.body.files.some(entry => entry.path === '手稿-改名')
    && !afterRename.body.files.some(entry => entry.path === '手稿'),
    afterRename.body.files.map(entry => entry.path).join(' '))
  const keptText = await call('file', { params: { project: '', path: '手稿-改名' } })
  // The file was created earlier with a seeded heading; a rename must keep whatever is
  // in it, not re-seed it and not re-encode it.
  check('a rename keeps the file content',
    keptText.status === 200 && keptText.body.content.startsWith('# 手稿') && keptText.body.content.includes('雨落在窗上'),
    JSON.stringify(keptText.body))
  const clash = await call('rename', { body: { project: '', path: '手稿-改名', name: 'README.md' } })
  check('a rename onto an existing name is a 409', clash.status === 409, String(clash.status))
  const slash = await call('rename', { body: { project: '', path: '手稿-改名', name: 'a/b' } })
  check('a rename is one segment, never a move', slash.status === 400, String(slash.status))
  const absent = await call('rename', { body: { project: '', path: '没有这个', name: 'x' } })
  check('renaming something absent is a 404', absent.status === 404, String(absent.status))
  const noop = await call('rename', { body: { project: '', path: '手稿-改名', name: '手稿-改名' } })
  check('renaming to the name it already has is a no-op, not a conflict',
    noop.status === 200 && noop.body.path === '手稿-改名', JSON.stringify(noop.body))

  await call('create-file', { body: { project: '', dir: '可打开', title: '内部' } })
  const counted = await call('count', { params: { project: '', path: '可打开' } })
  check('op=count reports how many files a folder holds',
    counted.status === 200 && counted.body.files === 1, JSON.stringify(counted.body))
  const removedFile = await call('delete', { body: { project: '', path: '内部不存在' } })
  check('deleting something absent is a 404', removedFile.status === 404, String(removedFile.status))
  const removed = await call('delete', { body: { project: '', path: '可打开' } })
  check('op=delete removes a folder and reports what it was',
    removed.status === 200 && removed.body.directory === true, JSON.stringify(removed.body))
  const afterDelete = await call('files', { params: { project: '' } })
  check('the deleted folder and its file are both gone from the listing',
    !afterDelete.body.files.some(entry => entry.path === '可打开' || entry.path.startsWith('可打开/')),
    afterDelete.body.files.map(entry => entry.path).join(' '))
  const deleteEscape = await call('delete', { body: { project: '', path: '../外面' } })
  check('deleting outside the workspace is refused', deleteEscape.status === 400, String(deleteEscape.status))

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

  // --- a profile still carrying the retired rootDir --------------------------------------
  // It must not silently appear to work: the field is warned about, and the tree is still
  // the workspace. A second context because activation wiring is per-context.
  const staleRoutes = new Map()
  const staleLogs = []
  const staleCtx = {
    ...ctx,
    connection: {
      fetch: { register: (entry) => { staleRoutes.set(entry.path, entry); return async () => {} } },
      requestRejection: () => undefined,
    },
    logger: {
      info: (...args) => staleLogs.push(['info', args]),
      warn: (...args) => staleLogs.push(['warn', args]),
      error: (...args) => staleLogs.push(['error', args]),
    },
  }
  apply(staleCtx, { rootDir: otherRoot })
  check('a retired rootDir is reported instead of silently ignored',
    staleLogs.some(([level, args]) => level === 'warn' && String(args[0]).includes('rootDir is no longer')),
    JSON.stringify(staleLogs.filter(([level]) => level === 'warn')))
  const staleRoute = staleRoutes.get('/api/notebook')
  const staleState = await (async () => {
    const url = new URL('http://dsh.invalid/api/notebook?op=state')
    url.searchParams.set('session', 's-main')
    const response = await staleRoute.fetch(new Request(url))
    return JSON.parse(await response.text())
  })()
  check('and the tree still follows the Session, not the stale pin',
    staleState.rootDir === root, JSON.stringify(staleState.rootDir))
} finally {
  await rm(root, { recursive: true, force: true })
  await rm(otherRoot, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} check(s) failed`)
  process.exit(1)
}
console.log(`\nHost smoke test passed (${String(checks)} checks)`)
