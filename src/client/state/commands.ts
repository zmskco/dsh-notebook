/**
 * The panel's operations, exposed to the context menu.
 *
 * The menu contributions are registered in `apply` — their lifetime is the plugin's
 * — while the tree they act on lives in `NotebookTab`'s state. Rather than lift that
 * state into the plugin (a large change for a menu), the panel publishes its own
 * handlers here while it is mounted, and the menu's `run` callbacks call through
 * this module. One writer (the mounted panel), one reader (a gesture), which is
 * exactly the relationship the menu has with any surface.
 *
 * With no panel mounted every call is a no-op: a menu opened against a stale target
 * after the panel went away must not throw inside the overlay.
 *
 * @module notebook/client/state/commands
 */

/** What the tree's context menu can ask the panel to do. */
export interface PanelCommands {
  /**
   * Start naming a new file or folder.
   * @param dir - the folder it should land in; `''` is the workspace root.
   * @param kind - a file or a folder.
   */
  create(dir: string, kind: 'file' | 'dir'): void
  /** Begin an inline rename of one entry. */
  rename(path: string): void
  /** Ask before deleting one entry. */
  remove(path: string): void
  /** Re-read the workspace. */
  refresh(): void
  /** Show one entry in the OS file manager. */
  reveal(path: string): void
}

let current: PanelCommands | undefined

/**
 * Publish the mounted panel's handlers.
 * @param commands - the live panel.
 * @returns the disposer that removes them, and only if they are still the published
 *   set: a panel that unmounts after a newer one mounted must not clear its handlers.
 */
export function setPanelCommands(commands: PanelCommands): () => void {
  current = commands
  return () => {
    if (current === commands) current = undefined
  }
}

/**
 * The published handlers.
 * @returns them, or undefined when no panel is mounted.
 */
export function panelCommands(): PanelCommands | undefined {
  return current
}
