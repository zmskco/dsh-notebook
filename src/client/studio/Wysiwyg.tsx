/**
 * The document editor: ProseMirror over the markdown file.
 *
 * This used to be a hand-rolled `contenteditable` with its own DOM reader, caret
 * restoration and redraw-on-pause. Every bug it had — the caret moving a line, the
 * page jumping to the top, the input method fighting a redraw — came from doing by
 * hand what an editor core is for. ProseMirror owns all of it now: selection, undo,
 * IME composition, structure changes.
 *
 * The two directions meet in `state/pm-document.ts`: markdown is read into a
 * document once, and every change is serialised back to markdown for the page to
 * autosave. The file on disk is still markdown.
 */
import * as React from 'react'
import { EditorState } from 'prosemirror-state'
import type { Command, Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history, redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap, chainCommands } from 'prosemirror-commands'
import { inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules'
import type { InputRule } from 'prosemirror-inputrules'
import { liftListItem, splitListItem } from 'prosemirror-schema-list'
import { documentFromMarkdown, documentNodes, markdownFromDocument } from '../state/pm-document'

export interface WysiwygProps {
  /** The file's markdown, at the moment it was opened. */
  text: string
  /** Called with the whole document as markdown after every change. */
  onChange: (markdown: string) => void
}

/**
 * The markdown shortcuts that turn typed punctuation into structure.
 *
 * These are what makes the surface feel like writing markdown rather than using a
 * word processor: `## ` becomes a heading, `- ` a bullet, `> ` a quote, ``` a code
 * block — while typing, with the caret exactly where the author left it.
 */
function markdownRules(): InputRule[] {
  return [
    textblockTypeInputRule(/^(#{1,6})\s$/, documentNodes.heading, match => ({ level: (match[1] ?? '#').length })),
    textblockTypeInputRule(/^```([A-Za-z0-9_+-]*)$/, documentNodes.codeBlock, match => ({ params: match[1] ?? '' })),
    wrappingInputRule(/^\s*>\s$/, documentNodes.blockquote),
    wrappingInputRule(/^\s*([-+*])\s$/, documentNodes.bulletList),
    wrappingInputRule(/^(\d+)\.\s$/, documentNodes.orderedList, match => ({ order: Number(match[1] ?? '1') })),
  ]
}

/**
 * The keys the editor takes from the browser.
 *
 * `Enter` is why this exists. `baseKeymap` binds it to `splitBlock`, which splits
 * the *textblock*: inside a list item that only adds a paragraph to the same item,
 * which is exactly the "Enter doesn't start a new bullet" the author reports. A
 * list item needs `splitListItem`; an empty item needs `liftListItem`, which is
 * what carries them back out of the list. Chaining the two means the editor falls
 * through to `baseKeymap` everywhere else.
 *
 * Tab is deliberately *not* bound: `sinkListItem` would build a nested list, and
 * the reader (`state/markdown.ts`) does not model nesting — it would come back as
 * two sibling lists after a save. Better no key than a key that quietly reshapes
 * the file.
 *
 * Exported so the artifact check can inspect the bindings without a browser.
 */
export function editorKeyBindings(): Record<string, Command> {
  const item = documentNodes.listItem
  return {
    Enter: chainCommands(splitListItem(item), liftListItem(item)),
    'Mod-z': undo,
    'Mod-y': redo,
    'Shift-Mod-z': redo,
  }
}

export function Wysiwyg({ text, onChange }: WysiwygProps): React.ReactElement {
  const host = React.useRef<HTMLDivElement | null>(null)
  // Read through a ref so the editor never holds a stale save handler.
  const notify = React.useRef(onChange)
  notify.current = onChange

  // Built once: the editor owns the document from then on. A new file remounts the
  // component (the parent keys it), which is the only moment a fresh parse is the
  // right thing.
  React.useEffect(() => {
    const element = host.current
    // The artifact check renders this outside a browser; there is no editor to
    // build there, and the host element is what it inspects.
    if (element === null || typeof document === 'undefined') return

    let view: EditorView | undefined
    view = new EditorView(element, {
      state: EditorState.create({
        doc: documentFromMarkdown(text),
        plugins: [
          inputRules({ rules: markdownRules() }),
          keymap(editorKeyBindings()),
          keymap(baseKeymap),
          history(),
        ],
      }),
      dispatchTransaction: (transaction: Transaction) => {
        if (view === undefined) return
        const next = view.state.apply(transaction)
        view.updateState(next)
        if (transaction.docChanged) notify.current(markdownFromDocument(next.doc))
      },
      attributes: {
        class: 'dsh-notebook-pm',
        'data-mode': 'wysiwyg',
        'aria-label': 'document',
      },
    })
    return () => {
      view?.destroy()
    }
  }, [])

  return React.createElement('div', {
    className: 'dsh-notebook-pmHost',
    'data-mode': 'wysiwyg',
    ref: host,
  })
}
