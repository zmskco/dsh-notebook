# Material Icon Theme artwork

The SVGs in `icons/` are the drawings of [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) 5.39.0
by Material Extensions, MIT licensed. The full licence text is in `LICENSE.txt`,
and vendored artwork is covered by the package licence notice.

Files are copied from the installed extension by `scripts/vendor-material-icons.mjs`
with one mechanical edit and no redrawing: each drawing's element ids are prefixed
with its icon name (the SVG is inlined into one page, where duplicate ids would
resolve across drawings). Everything else is byte-for-byte the theme's file. Both
the artwork and `src/client/icons/material.generated.ts` are committed so a build
needs no VS Code installation. Regenerate with `pnpm run vendor:icons` after
upgrading the extension, then commit the result.
