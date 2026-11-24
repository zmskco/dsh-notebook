# Syntax colour

The code colouring is [highlight.js](https://highlightjs.org) through
[lowlight](https://github.com/wooorm/lowlight), both bundled into `lib/client.js`.

- `LICENSE.txt` — highlight.js, BSD 3-Clause, Copyright (c) 2006 Ivan Sagalaev.
- `LICENSE-lowlight.txt` — lowlight, MIT, Copyright (c) Titus Wormer.

The grammars are the libraries' own files, unmodified. What this package adds is
the scope→colour vocabulary in `src/client/state/highlight.ts` and the colours
themselves, which are the paper palettes in `src/client/ui.ts` — original to this
plugin rather than a ported theme.
