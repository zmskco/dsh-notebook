/**
 * Write-boundary checks.
 *
 * Two things are covered, and they are the two that made a working install look
 * broken: the plugin must derive its write boundary from the workspace of each
 * call — so a fresh install is writable with no profile edit — and the *mode*
 * must be the one the calling Session is actually running under.
 *
 * The retired `rootDir` is covered too, as a negative: a profile that still
 * carries it must be told it does nothing, rather than silently believed.
 *
 * The write itself happens through `ctx.fs`, which is stubbed in the Host smoke
 * test, so the decision logic and the policy it stamps are exercised directly
 * here.
 */
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { assessWriteAccess, profilePatchPath, storyWritePolicy, writeAccessGuidance } from '../lib/story/sandbox.js'
import { fallbackRootDir } from '../lib/story/bootstrap.js'
import { storyRootFor } from '../lib/story/root.js'

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
/** One Session's workspace — the only root there is. */
const workspace = win ? 'D:\\Learn\\zmsk' : '/work/zmsk'
/** A second workspace, to prove the root follows the caller rather than a pin. */
const other = win ? 'D:\\Learn\\other' : '/work/other'

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

check('no sandbox service means writes are unconfined', assessWriteAccess(workspace, undefined).writable)
check('no sandbox service means no policy is stamped', storyWritePolicy(workspace, undefined) === undefined)
check('a workspace outside the deployment boundary is writable',
  assessWriteAccess(workspace, confined).writable,
  'the plugin stamps the workspace as the boundary of its own writes')
check('the report names the mode the deployment runs',
  assessWriteAccess(workspace, confined).mode === 'workspace-write')
check('the report names the workspace, not the deployment boundary',
  assessWriteAccess(workspace, confined).workspaceRoot === workspace)
check('danger-full-access allows any workspace',
  assessWriteAccess(workspace, policy('danger-full-access', boundary)).writable)
check('a writable workspace has no remedy to show',
  writeAccessGuidance(workspace, assessWriteAccess(workspace, confined)) === null)
check('a writable workspace reports no reason code',
  assessWriteAccess(workspace, confined).reason === undefined)

const readOnly = assessWriteAccess(workspace, policy('read-only', boundary))
check('read-only denies every workspace', !readOnly.writable)
check('read-only names its reason', readOnly.reason === 'read-only', readOnly.reason)
check('a refused root still reports the boundary it was checked against',
  readOnly.workspaceRoot === workspace && readOnly.mode === 'read-only')

console.log('\nthe mode follows the Session, not the deployment');

const switched = policy('read-only', boundary, { [workspace]: 'danger-full-access' })
check('a session switched to danger-full-access is not judged read-only',
  assessWriteAccess(workspace, switched, session(workspace)).writable,
  'the panel must not disagree with the tools the operator is actually running')
check('and its writes carry that mode',
  storyWritePolicy(workspace, switched, session(workspace))?.mode === 'danger-full-access')
check('a session with no override keeps its own mode',
  assessWriteAccess(workspace, confined, session(workspace)).mode === 'workspace-write')
const downgraded = policy('danger-full-access', boundary, { [workspace]: 'read-only' })
check('a session pinned to read-only is refused even under a permissive deployment',
  assessWriteAccess(workspace, downgraded, session(workspace)).reason === 'read-only')
check('a session-less call keeps the deployment default',
  storyWritePolicy(workspace, switched)?.mode === 'read-only')

console.log('\nthe policy each write carries');

const stamped = storyWritePolicy(workspace, confined)
check('the workspace becomes the boundary of the write',
  stamped !== undefined && stamped.workspaceRoot === workspace, JSON.stringify(stamped))
check('the deployment mode is kept verbatim',
  stamped !== undefined && stamped.mode === 'workspace-write', JSON.stringify(stamped))
check('a read-only deployment is not widened by the plugin',
  storyWritePolicy(workspace, policy('read-only', boundary))?.mode === 'read-only')
check('danger-full-access is not narrowed to a boundary it never had',
  storyWritePolicy(workspace, policy('danger-full-access', boundary))?.workspaceRoot === workspace)

console.log('\nguidance');

const text = writeAccessGuidance(workspace, readOnly)
check('guidance names the root it refused', text.includes('zmsk'), text)
check('guidance names the mode that refused it', text.includes('read-only'))
check('guidance restates mode, because config is replaced wholesale',
  text.includes('mode:') && text.includes('workspaceRoot:'),
  'an entry setting only one of the two would reset the other')
check('guidance is spelled out over several lines', text.split('\n').length > 5)

/**
 * Set or clear one environment variable, restoring it later.
 *
 * `process.env` holds strings only: assigning `undefined` stores the six-character
 * string `"undefined"`, which is truthy and non-empty. A restore written as
 * `process.env.X = previous` therefore *set* the variable when it had been unset,
 * and every later check that read it saw `"undefined"` — which is exactly how this
 * script failed in a clean terminal (`DSH_HOME` unset) while passing in one that
 * inherited it from dsh. Clearing needs `delete`.
 * @param name - the variable.
 * @param value - the value to set, or `undefined` to remove the variable.
 */
function setEnv(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

const previousHome = process.env.DSH_HOME
const previousProfile = process.env.DSH_PROFILE
setEnv('DSH_HOME', win ? 'C:\\Users\\holdlg\\.dsh' : '/home/u/.dsh')
setEnv('DSH_PROFILE', 'web')
check('the guidance points at the profile patch file the user actually edits',
  profilePatchPath() === join(process.env.DSH_HOME, 'profiles', 'web', 'cordis.patch.yml'),
  profilePatchPath())
setEnv('DSH_HOME', previousHome)
setEnv('DSH_PROFILE', previousProfile)
check('the environment was restored, not filled with the string "undefined"',
  process.env.DSH_HOME === previousHome && process.env.DSH_PROFILE === previousProfile,
  `DSH_HOME=${String(process.env.DSH_HOME)} DSH_PROFILE=${String(process.env.DSH_PROFILE)}`)

console.log('\nroot resolution: the workspace is the root');

const fallback = join(boundary, 'notebook')
check('a live Session is the root, with no configuration in the way',
  storyRootFor(fallback, workspace).dir === workspace
  && storyRootFor(fallback, workspace).source === 'workspace')
check('a different Session gets a different root',
  storyRootFor(fallback, other).dir === other)
check('a session-less call takes the fallback, and says so',
  storyRootFor(fallback, undefined).dir === fallback
  && storyRootFor(fallback, undefined).source === 'fallback')
check('an empty cwd is treated as no Session at all',
  storyRootFor(fallback, '').source === 'fallback')
check('the fallback is the deployment boundary, not a shelf this plugin invented',
  fallbackRootDir({ workspaceRoot: boundary }) === boundary)
// Both branches of the last resort are pinned rather than read from the ambient
// environment: this script used to assert a shape against whatever `DSH_HOME`
// happened to be, which is how it passed under dsh (which sets it) and failed in a
// clean terminal (which does not).
setEnv('DSH_HOME', win ? 'C:\\dsh-home' : '/dsh-home')
const underHome = fallbackRootDir(undefined)
check('with no boundary the fallback lands under DSH_HOME',
  underHome === join(process.env.DSH_HOME, 'notebook'), underHome)
setEnv('DSH_HOME', undefined)
const underUser = fallbackRootDir(undefined)
check('with no DSH_HOME either, the fallback lands under the user home',
  underUser === join(homedir(), '.dsh', 'notebook'), underUser)
check('every fallback is an absolute directory, never a bare name',
  resolve(underHome) === underHome && resolve(underUser) === underUser, `${underHome} / ${underUser}`)
setEnv('DSH_HOME', previousHome)
check('no rule can report a pinned root any more',
  storyRootFor(fallback, workspace).source !== 'override'
  && storyRootFor(fallback, undefined).source !== 'override',
  'the retired rootDir must not survive in the resolver')

console.log(failures === 0
  ? '\nwrite boundary verified\n'
  : `\n${failures} check(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)
