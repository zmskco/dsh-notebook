/**
 * The shell's menu service, held for the components that need it.
 *
 * The supported way to attach a context menu is `useContextMenu()`, which
 * `ui-context-menu` injects into every Slot scope through `provideRoot`. That hook
 * did not reach the panel's component in practice — the rows kept showing the
 * browser's own menu — so this module carries the other officially supported path
 * instead: `apply` resolves `ctx.contextMenus` once and publishes it here, and the
 * tree calls `open()` itself.
 *
 * Two consequences worth stating, because they are the reason this is not just a
 * workaround:
 *
 * - **Ordering is the plugin's problem, not the component's.** The service is read
 *   while the plugin activates; `ui-context-menu` is an earlier row of the same web
 *   bundle, so it is already there. When it is not (a shell without the menu plugin),
 *   every call below is a no-op and the browser's own menu stays — the panel is
 *   unaffected.
 * - **The gesture is explicit.** `open()` takes the viewport point, so the caller has
 *   already called `preventDefault()`; `triggerProps` below builds exactly that pair
 *   of handlers, mouse and keyboard, so a row does not have to know either detail.
 *
 * @module notebook/client/state/menus
 */
import type { ContextMenuTarget, ContextMenusService } from '../dsh'

let current: ContextMenusService | undefined

/**
 * Publish the shell's menu service.
 * @param menus - the service, from `ctx.get('contextMenus')`.
 */
export function setMenuService(menus: ContextMenusService | undefined): void {
  current = menus
}

/**
 * The published menu service.
 * @returns it, or undefined when this shell has no context menu.
 */
export function menuService(): ContextMenusService | undefined {
  return current
}

/** The handlers one row spreads onto its element. */
export interface MenuTriggerProps {
  onContextMenu?: (event: { preventDefault(): void, stopPropagation(): void, clientX: number, clientY: number }) => void
  onKeyDown?: (event: { key: string, shiftKey: boolean, preventDefault(): void, currentTarget: unknown }) => void
}

/**
 * The gesture handlers that open this plugin's menu for one target.
 *
 * The handlers are **always** returned, and the service is read when the gesture
 * happens rather than when the row renders. That is not a micro-optimisation: the
 * service is published from `ctx.inject`, whose callback runs whenever
 * `ui-context-menu` gets there, which can be after the panel's first render. Deciding
 * at render time would bind nothing on that first pass and never re-render.
 *
 * With no service yet, a gesture is left completely alone — no `preventDefault`, no
 * `stopPropagation` — so the browser's own menu appears until the service arrives.
 * Swallowing a right-click the plugin cannot answer would be worse than the default.
 *
 * Mouse: the browser's menu is suppressed and the shared popup opens at the pointer.
 * Keyboard: `Shift+F10` and the dedicated Context Menu key, anchored at the row's
 * bottom-left corner — the same place a mouse user would have right-clicked.
 *
 * **`stop` is what makes the whole directory area targetable.** The column takes the
 * gesture for the workspace root, so right-clicking blank space still offers "new
 * file / new folder here"; a row has to stop the event, or the column's handler would
 * run as well and replace the row's target with the root.
 * @param target - the captured target; built per row.
 * @param options - `stop: true` for a nested trigger (a row inside the column).
 * @returns the handlers to spread onto the row.
 */
export function triggerProps(target: ContextMenuTarget, options: { stop?: boolean } = {}): MenuTriggerProps {
  return {
    onContextMenu: (event) => {
      if (current === undefined) return
      event.preventDefault()
      // A row inside the column: the column's handler is the same gesture and would
      // otherwise open a second menu on the workspace root.
      if (options.stop === true) event.stopPropagation()
      current.open(target, { x: event.clientX, y: event.clientY })
    },
    onKeyDown: (event) => {
      if (current === undefined) return
      const keyboard = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
      if (!keyboard) return
      event.preventDefault()
      const element = event.currentTarget as { getBoundingClientRect?: () => { left: number, bottom: number } } | null
      const box = element?.getBoundingClientRect?.()
      current.open(target, { x: box?.left ?? 0, y: box?.bottom ?? 0 })
    },
  }
}
