/**
 * Write-boundary checks.
 *
 * Three things are covered, and they are the three that made a working install
 * look broken: the plugin must derive its write boundary from the story root of
 * each call — so the shelf is writable with no profile edit — the *mode* must be
 * the one the calling Session is actually running under, and a shelf pinned
 * outside the open workspace must be reported as the half-working arrangement it
 * is rather than as a healthy one.
 *
 * The write itself happens through `ctx.fs`, which is stubbed in the Host smoke
 * test, so the decision logic and the policy it stamps are exercised directly
 * here.
 */
import { join, resolve, sep } from 'node:path'
import { assessWriteAccess, profilePatchPath, storyWritePolicy, writeAccessGuidance } from '../lib/story/sandbox.js'
import { resolveConfig } from '../lib/config.js'

let failures = 0
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok   ${label}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

const win = process.platform === 'win32'
/** The deployment boundary: where dsh was launched, and what `sandbox-policy` names. */
const boundary = win ? 'D:\\Learn\\dshplugin' : '/work/dshplugin'
/** A story library somewhere else entirely — the case that used to be unwritable. */
const storyRoot = win ? 'D:\\Learn\\zmsk' : '/work/zmsk'
/** One Session's workspace, and the shelf the plugin derives from it. */
const workspace = win ? 'D:\\Learn\\dshplugin' : '/work/dshplugin'
const sessionShelf = join(workspace, 'novels')

/**
 * A `sandboxPolicy` as the real service behaves.
 *
 * `resolve({ session })` folds the Session's own `sandbox/mode` override over the
 * deployment default and takes the Session's cwd as the boundary; a call with no
 * Session gets the deployment pair. `modes` maps a Session's cwd to its override,
 * which is how a session switched to `danger-full-access` inside a `read-only`
 * deployment is expressed.
 */
function policy(defaultMode, workspaceRoot, modes = {}) {
  return {
    defaultMode,
    workspaceRoot,
    resolve(request = {}) {
      const cwd = request.session?.header?.cwd
      return {
        mode: request.mode ?? (cwd === undefined ? undefined : modes[cwd]) ?? defaultMode,
        workspaceRoot: cwd ?? workspaceRoot,
      }
    },
  }
}

const session = (cwd) => ({ header: { cwd } })
const confined = policy('workspace-write', boundary)

console.log('\nwrite access');

check('no sandbox service means writes are unconfined', assessWriteAccess(storyRoot, undefined).writable)
check('no sandbox service means no policy is stamped', storyWritePolicy(storyRoot, undefined) === undefined)
check('a story root outside the deployment boundary is writable',
  assessWriteAccess(storyRoot, confined).writable,
  'the plugin stamps the story root as the boundary of its own writes')
check('the report names the mode the deployment runs',
  assessWriteAccess(storyRoot, confined).mode === 'workspace-write')
check('the report names the story root, not the deployment boundary',
  assessWriteAccess(storyRoot, confined).workspaceRoot === storyRoot)
check('danger-full-access allows any story root',
  assessWriteAccess(storyRoot, policy('danger-full-access', boundary)).writable)
check('a session-less read of a writable root has no remedy to show',
  writeAccessGuidance(storyRoot, assessWriteAccess(storyRoot, confined)) === null)

const readOnly = assessWriteAccess(storyRoot, policy('read-only', boundary))
check('read-only denies every story root', !readOnly.writable)
check('read-only names its reason', readOnly.reason === 'read-only', readOnly.reason)
check('a refused root still reports the boundary it was checked against',
  readOnly.workspaceRoot === storyRoot && readOnly.mode === 'read-only')

console.log('\nthe mode follows the Session, not the deployment');

const switched = policy('read-only', boundary, { [workspace]: 'danger-full-access' })
check('a session switched to danger-full-access is not judged read-only',
  assessWriteAccess(sessionShelf, switched, session(workspace)).writable,
  'the panel must not disagree with the tools the operator is actually running')
check('and its writes carry that mode',
  storyWritePolicy(sessionShelf, switched, session(workspace))?.mode === 'danger-full-access')
const downgraded = policy('danger-full-access', boundary, { [workspace]: 'read-only' })
check('a session pinned to read-only is refused even under a permissive deployment',
  assessWriteAccess(sessionShelf, downgraded, session(workspace)).reason === 'read-only')
check('a session-less call keeps the deployment default',
  storyWritePolicy(sessionShelf, switched)?.mode === 'read-only')

console.log('\na shelf outside the open workspace');

const outside = policy('workspace-write', boundary, { [workspace]: 'workspace-write' })
const pinned = assessWriteAccess(storyRoot, outside, session(workspace))
check('the plugin itself can still write there', pinned.writable)
check('but the assessment says why that is not the whole story',
  pinned.reason === 'outside-workspace', String(pinned.reason))
check('and names the workspace it was compared against',
  pinned.sessionWorkspace === workspace, String(pinned.sessionWorkspace))
const shelfInside = assessWriteAccess(sessionShelf, outside, session(workspace))
check('a shelf inside the workspace is the ordinary case, with nothing to say',
  shelfInside.writable && shelfInside.reason === undefined
  && writeAccessGuidance(sessionShelf, shelfInside) === null,
  JSON.stringify(shelfInside))
check('a sibling directory is not inside the workspace',
  assessWriteAccess(join(workspace, '..', 'elsewhere'), outside, session(workspace)).reason === 'outside-workspace')

console.log('\nthe policy each write carries');

const stamped = storyWritePolicy(storyRoot, confined)
check('the story root becomes the boundary of the write',
  stamped !== undefined && stamped.workspaceRoot === storyRoot, JSON.stringify(stamped))
check('the deployment mode is kept verbatim',
  stamped !== undefined && stamped.mode === 'workspace-write', JSON.stringify(stamped))
check('a read-only deployment is not widened by the plugin',
  storyWritePolicy(storyRoot, policy('read-only', boundary))?.mode === 'read-only')
check('danger-full-access is not narrowed to a boundary it never had',
  storyWritePolicy(storyRoot, policy('danger-full-access', boundary))?.workspaceRoot === storyRoot)

console.log('\nguidance');

const text = writeAccessGuidance(storyRoot, readOnly)
check('guidance names the root it refused', text.includes('zmsk'), text)
check('guidance names the mode that refused it', text.includes('read-only'))
check('guidance restates mode, because config is replaced wholesale',
  text.includes('mode:') && text.includes('workspaceRoot:'),
  'an entry setting only one of the two would reset the other')
check('guidance is spelled out over several lines', text.split('\n').length > 5)

const outsideText = writeAccessGuidance(storyRoot, pinned)
check('the outside-workspace remedy names both directories',
  outsideText.includes('zmsk') && outsideText.includes(workspace), outsideText)
check('it says what still works, so the warning is actionable',
  outsideText.includes('面板照常读写'), outsideText)
check('it says which writers are refused', outsideText.includes('write/edit'))
check('it offers the workspace itself as the way back',
  outsideText.includes(workspace), outsideText)

const previousHome = process.env.DSH_HOME
const previousProfile = process.env.DSH_PROFILE
process.env.DSH_HOME = win ? 'C:\\Users\\holdlg\\.dsh' : '/home/u/.dsh'
process.env.DSH_PROFILE = 'web'
check('the guidance points at the profile patch file the user actually edits',
  profilePatchPath() === join(process.env.DSH_HOME, 'profiles', 'web', 'cordis.patch.yml'),
  profilePatchPath())
process.env.DSH_HOME = previousHome
process.env.DSH_PROFILE = previousProfile

console.log('\nroot resolution');

const warn = () => {}
const fallback = join(boundary, 'novels')
const unset = resolveConfig({}, fallback, warn, boundary)
check('an unset rootDir takes the sandbox-aware fallback', unset.rootDir === fallback)
check('an unset rootDir is not an override, so the workspace decides', unset.rootDirOverride === false)
const relative = resolveConfig({ rootDir: 'novels' }, fallback, warn, boundary)
check('a relative rootDir resolves against the sandbox boundary', relative.rootDir === join(boundary, 'novels'), relative.rootDir)
check('a configured rootDir is an override', relative.rootDirOverride === true)
check('an absolute rootDir is honoured verbatim',
  resolveConfig({ rootDir: storyRoot }, fallback, warn, boundary).rootDir === storyRoot)
const noBoundary = resolveConfig({ rootDir: 'novels' }, fallback, warn, undefined).rootDir
check('a relative rootDir without a boundary still becomes absolute',
  noBoundary === resolve('novels') && noBoundary.includes(`${sep}novels`), noBoundary)

console.log(failures === 0
  ? '\nwrite boundary verified\n'
  : `\n${failures} check(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
