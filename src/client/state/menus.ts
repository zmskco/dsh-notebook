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
 * Mouse: the browser's menu is suppressed and the shared popup opens at the pointer.
 * Keyboard: `Shift+F10` and the dedicated Context Menu key are the two gestures a
 * keyboard has, and both open it at the row's bottom-left corner — the same anchor
 * the shell's own hook uses, so a keyboard user sees the menu where a mouse user
 * would have right-clicked.
 *
 * **`stop` is what makes the whole directory area targetable.** The column itself
 * takes the gesture for the workspace root, so right-clicking blank space below the
 * rows still offers "new file / new folder here"; a row's own handler then has to
 * stop the event, or the column's would run as well and replace the row's target
 * with the root (last opener wins). Without `stop` the row-level menu would never
 * be the one you see.
 *
 * With no service published the handlers are empty, which leaves the element's own
 * behaviour (the browser menu) in place rather than swallowing the gesture.
 * @param target - the captured target; built per row.
 * @param options - `stop: true` for a nested trigger (a row inside the column).
 * @returns the handlers to spread onto the row, or `{}` without a menu.
 */
export function triggerProps(target: ContextMenuTarget, options: { stop?: boolean } = {}): MenuTriggerProps {
  if (current === undefined) return {}
  return {
    onContextMenu: (event) => {
      event.preventDefault()
      // A row inside the column: the column's handler is the same gesture and would
      // otherwise open a second menu on the workspace root.
      if (options.stop === true) event.stopPropagation()
      current?.open(target, { x: event.clientX, y: event.clientY })
    },
    onKeyDown: (event) => {
      const keyboard = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
      if (!keyboard) return
      event.preventDefault()
      const element = event.currentTarget as { getBoundingClientRect?: () => { left: number, bottom: number } } | null
      const box = element?.getBoundingClientRect?.()
      current?.open(target, { x: box?.left ?? 0, y: box?.bottom ?? 0 })
    },
  }
}
