/**
 * Show the workspace in the operating system's file manager.
 *
 * The directory column is a *view* of the workspace, and the browser cannot open
 * a local folder — so "show me the real folder" is the one thing the page has to
 * ask the Host for. The directory is always the workspace that request resolved
 * to: nothing here takes a path from the client, so the panel can never be talked
 * into opening somewhere else.
 *
 * On Windows the launch goes through **`cmd /c start`**, not `explorer.exe`
 * directly, and the child is **not** started hidden. Both halves were measured:
 * spawning `explorer.exe` starts a process that exits without ever showing a
 * window, and a hidden show-state (`windowsHide`, `-WindowStyle Hidden`) is
 * inherited by the window ShellExecute creates, so the folder opens invisibly.
 * `cmd /c start` with the default show state uses ShellExecute, and the
 * already-running Explorer opens a window the author can see.
 *
 * @module notebook/http/reveal
 */
import { spawn } from 'node:child_process'

/** What to launch, for one platform. */
export interface RevealLaunch {
  /** The executable. */
  command: string
  /** Its arguments, already in the order they must appear. */
  args: string[]
  /**
   * Whether `args` must be joined without quoting.
   *
   * Windows is the case: `start` needs an explicit empty title and a quoted path,
   * and `cmd` parses the whole tail itself — a second layer of quoting from Node
   * would change what it runs.
   */
  verbatim: boolean
}

/**
 * The command that opens one directory on a platform.
 *
 * Exported for the test that asserts the mapping without launching anything: a
 * test suite that opens windows on the machine running it is not a test.
 * @param platform - `process.platform`.
 * @param dir - an absolute directory path.
 * @returns what to launch.
 */
export function revealCommand(platform: NodeJS.Platform, dir: string): RevealLaunch {
  if (platform === 'win32') {
    // ShellExecute through `start`: the empty argument is the window title slot,
    // which `start` requires before a quoted target.
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/c', `start "" "${dir}"`],
      verbatim: true,
    }
  }
  if (platform === 'darwin') return { command: 'open', args: [dir], verbatim: false }
  return { command: 'xdg-open', args: [dir], verbatim: false }
}

/**
 * Launch the platform's file manager on a directory.
 * @param dir - an absolute directory path.
 * @returns whether the launcher was started; `false` means it was not.
 */
export function revealInFileManager(dir: string): Promise<boolean> {
  const launch = revealCommand(process.platform, dir)
  return new Promise((resolve) => {
    try {
      const child = spawn(launch.command, launch.args, {
        detached: true,
        stdio: 'ignore',
        // No `windowsHide`: it would be inherited by the Explorer window this
        // launches, which then opens invisibly. The child inherits this process's
        // console, so there is no console flash to hide either.
        windowsVerbatimArguments: launch.verbatim,
      })
      child.on('error', () => { resolve(false) })
      child.on('spawn', () => { child.unref(); resolve(true) })
    } catch {
      resolve(false)
    }
  })
}
