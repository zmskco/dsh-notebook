/**
 * highlight.js ships one ambient declaration for the package root; the grammars
 * under `lib/languages/*` are reached by subpath and carry no types of their own.
 * Declaring that one wildcard here is the whole fix: each grammar module
 * default-exports a `LanguageFn`, which is exactly what `lowlightregister` takes.
 */
declare module 'highlight.js/lib/languages/*' {
  import type { LanguageFn } from 'highlight.js'
  const grammar: LanguageFn
  export default grammar
}
