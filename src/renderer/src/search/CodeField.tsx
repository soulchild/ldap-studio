import {
  autocompletion,
  closeCompletion,
  completionStatus,
  type CompletionContext,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { linter, type Diagnostic as LintDiagnostic } from '@codemirror/lint'
import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { cn } from '@renderer/lib/utils'
import type { Diagnostic, Suggestions } from './assist'

const theme = EditorView.theme({
  '&': { fontSize: '0.8125rem', backgroundColor: 'transparent', color: 'var(--foreground)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.25rem', overflow: 'hidden' },
  '.cm-content': { padding: '0.3125rem 0.625rem', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--subtle-foreground)', fontFamily: 'var(--font-sans)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--destructive)' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warning)' },
  '.cm-tooltip': {
    border: '1px solid var(--border)',
    backgroundColor: 'var(--popover)',
    borderRadius: '6px',
    boxShadow: 'var(--shadow-popover)',
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8125rem',
    maxHeight: '14rem',
  },
  '.cm-tooltip-autocomplete > ul > li': { padding: '0.25rem 0.625rem' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--selection-strong)',
    color: 'var(--foreground)',
  },
  '.cm-tooltip-lint': { display: 'none' },
})

/** A single-line code input with suggestions and inline problem marks (filter and attribute list). */
export function CodeField({
  id,
  label,
  value,
  placeholder,
  invalid,
  onChange,
  onSubmit,
  suggest,
  diagnose,
}: {
  id: string
  label: string
  value: string
  placeholder?: string
  invalid?: boolean
  onChange: (value: string) => void
  onSubmit?: () => void
  suggest?: (input: string, cursor: number) => Suggestions | undefined
  diagnose?: (input: string) => Diagnostic[]
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(undefined)
  // The editor is created once; callbacks and helpers are read through this ref.
  const latest = useRef({ onChange, onSubmit, suggest, diagnose })
  useEffect(() => {
    latest.current = { onChange, onSubmit, suggest, diagnose }
  })

  useEffect(() => {
    if (!host.current) {
      return
    }
    const complete = (context: CompletionContext) => {
      const result = latest.current.suggest?.(context.state.doc.toString(), context.pos)
      if (!result || (result.options.length === 0 && !context.explicit)) {
        return null
      }
      return {
        from: result.from,
        options: result.options.map((label) => ({ label })),
        validFor: /^[\w.;-]*$/,
      }
    }
    const lint = (editor: EditorView): LintDiagnostic[] =>
      (latest.current.diagnose?.(editor.state.doc.toString()) ?? []).map((item) => ({ ...item }))

    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          theme,
          // One line: drop line breaks, e.g. from pasted text.
          EditorState.transactionFilter.of((transaction) =>
            transaction.newDoc.lines > 1 ? [] : transaction,
          ),
          Prec.highest(
            keymap.of([
              {
                key: 'Enter',
                run: (editor) => {
                  if (completionStatus(editor.state) === 'active') {
                    return false
                  }
                  latest.current.onSubmit?.()
                  return true
                },
              },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          autocompletion({ override: [complete], icons: false, activateOnTyping: true }),
          linter(lint, { delay: 150 }),
          placeholderExtension(placeholder ?? ''),
          EditorView.contentAttributes.of({ 'aria-label': label, id, spellcheck: 'false' }),
          // Suggestions belong to the focused field only.
          EditorView.domEventHandlers({
            blur: (_event, editor) => {
              closeCompletion(editor)
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              latest.current.onChange(update.state.doc.toString())
            }
          }),
        ],
      }),
    })
    return () => view.current?.destroy()
    // Created once; later value changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the editor in sync when the value is set from outside (e.g. a recent search).
  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
    }
  }, [value])

  return (
    <div
      ref={host}
      className={cn(
        'min-w-0 flex-1 rounded-sm border border-input bg-surface focus-within:border-primary',
        invalid && 'border-destructive focus-within:border-destructive',
      )}
    />
  )
}
