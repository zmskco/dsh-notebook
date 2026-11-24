/**
 * tsdown build for the Client half.
 *
 * The artifact is the same lazy-CJS plugin bundle DSH's own client preset
 * emits: `window.__ModuleLoader__.load({ id, factory })`, with `banner`,
 * `intro` and `footer` supplying the wrapper around the module body and every
 * specifier except `react` inlined. The three wrapper strings below are the
 * contract, not a preference — the loader reads the factory's return value as
 * the plugin's exports, and the shell's module table answers a `require` only
 * for its own rows, so anything else left external throws at materialization.
 *
 * DSH's preset itself is not usable here: it lives at
 * `packages/client/tsdown.client.ts` inside the DSH source checkout and imports
 * repo-internal modules (`./web/src/platform.ts`, `../../scripts/...`), none of
 * which ship in a published package. This reproduces its output contract with
 * the published tsdown.
 */
import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { name: string }

export default defineConfig({
  entry: ['src/client/index.tsx'],
  outDir: 'lib',
  /**
   * The Host half is emitted into this same `lib/` by `tsc`. tsdown's default
   * clean would delete `lib/index.js` and every sibling module, silently
   * breaking the Host plugin — the same reason DSH pins `clean: false` on its
   * own client preset.
   */
  clean: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  /**
   * Everything but `react` has to end up *inside* the bundle: the loader answers
   * `require` from its own module table, so a leaked specifier throws at
   * materialization. `neverBundle` keeps the shell's own `react` external, and
   * the editor core is forced in.
   */
  deps: {
    neverBundle: ['react'],
    // The editor core and the syntax colouring are forced in. Both ship as
    // ordinary npm packages, and a specifier that leaked out of the bundle would
    // throw at materialization, since the loader answers `require` only for its
    // own rows.
    alwaysBundle: [/^prosemirror-/, /^lowlight$/, /^highlight\.js(?:\/|$)/],
    // Nothing else is meant to stay external, so the "maybe you forgot to
    // externalize" hint has nothing to warn about.
    onlyBundle: false,
  },
  // A Client component cannot read the package filesystem, so artwork is
  // inlined: `import iconUrl from '../../icon.png'` becomes a data URL, and each
  // tree icon imported from `assets/material-icons/` becomes its SVG source
  // string (which the tree renders inline — see `src/client/icons/material.tsx`).
  // Two `loader` rows instead of a generated source of duplicated bytes keep the
  // files under `assets/` the only copies of the drawings.
  loader: { '.png': 'dataurl', '.svg': 'text' },
  // Classic JSX comes from `tsconfig.json` (`"jsx": "react"`): the shell answers
  // `react`, not `react/jsx-runtime`.
  outputOptions: {
    entryFileNames: 'client.js',
    banner: [
      // Kept as a real directive prologue: the banner runs before any
      // generated `"use strict"` line, which would otherwise stop being a
      // directive and leave the bundle sloppy.
      "'use strict';",
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`,
    ].join('\n'),
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})
