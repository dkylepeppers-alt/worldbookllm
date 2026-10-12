import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

import { inkLanguage } from './ink-language.js';
import { inkPitfalls } from './ink-text.js';

/** A problem at a line of the file, from the ink compiler or the story's structure. */
export interface EditorProblem {
  severity: 'error' | 'warning' | 'todo';
  line: number | null;
  message: string;
}

export interface InkEditorProps {
  value: string;
  onChange: (value: string) => void;
  kind: 'chapter' | 'ink';
  /** What the server said about this file as it is in the editor. */
  problems: readonly EditorProblem[];
  /** Knot and stitch names, and variables, for completion. */
  names: { targets: readonly string[]; variables: readonly string[] };
  /** Labels the editing area. */
  label: string;
  /** A line to move the cursor to and show, when the writer picks a problem. */
  goTo: { line: number; at: number } | null;
}

// Colours come from the design tokens, so both themes follow the system.
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--accent)', fontWeight: '600' },
  { tag: tags.heading, color: 'var(--text)', fontWeight: '650' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--muted)' },
  { tag: [tags.brace, tags.bracket, tags.operator], color: 'var(--accent)' },
  { tag: [tags.number, tags.string], color: 'var(--text)', fontWeight: '550' },
]);

const theme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius)',
    fontSize: '0.92rem',
  },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '2px' },
  '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--text)', padding: '0.5rem 0' },
  '.cm-scroller': { minHeight: '18rem', maxHeight: '70vh', overflow: 'auto' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface-2)',
    color: 'var(--muted)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--accent-soft)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--text)',
  },
  // CodeMirror's lint theme hard-codes its colours; these follow the tokens.
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--danger)',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-warning, .cm-lintRange-info, .cm-lintRange-hint': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--border-strong)',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-active': { backgroundColor: 'var(--accent-soft)' },
  '.cm-lintPoint:after': { borderBottomColor: 'var(--danger)' },
  '.cm-lintPoint-warning:after, .cm-lintPoint-info:after, .cm-lintPoint-hint:after': {
    borderBottomColor: 'var(--border-strong)',
  },
  '.cm-lint-marker-error, .cm-lint-marker-warning, .cm-lint-marker-info': {
    content: 'none',
    width: '0.6rem',
    height: '0.6rem',
    margin: '0.2rem',
    borderRadius: '50%',
  },
  '.cm-lint-marker-error': { backgroundColor: 'var(--danger)' },
  '.cm-lint-marker-warning, .cm-lint-marker-info': { backgroundColor: 'var(--border-strong)' },
  '.cm-diagnostic': { padding: '0.25rem 0.6rem', color: 'var(--text)' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--danger)' },
  '.cm-diagnostic-warning, .cm-diagnostic-info, .cm-diagnostic-hint': {
    borderLeft: '3px solid var(--border-strong)',
  },
});

/** Problems as CodeMirror diagnostics on their lines. */
function diagnosticsOf(
  view: EditorView,
  problems: readonly EditorProblem[],
  kind: 'chapter' | 'ink',
): Diagnostic[] {
  const doc = view.state.doc;
  const onLine = (line: number) => doc.line(Math.min(Math.max(1, line), doc.lines));
  return [
    ...problems
      .filter((problem) => problem.line !== null)
      .map((problem) => {
        const line = onLine(problem.line!);
        return {
          from: line.from,
          to: line.to,
          severity: problem.severity === 'error' ? ('error' as const) : ('warning' as const),
          message: problem.message,
        };
      }),
    ...inkPitfalls(doc.toString(), kind).map((pitfall) => {
      const line = onLine(pitfall.line);
      return {
        from: line.from + pitfall.from,
        to: line.from + pitfall.to,
        severity: 'warning' as const,
        message: pitfall.message,
      };
    }),
  ];
}

/**
 * The ink editor (ADR 0031): CodeMirror with ink highlighting, the
 * compiler's errors on their lines, warnings for ink's traps, and
 * completion of knot names after `->` and variable names in `{ }` and `~`.
 */
export default function InkEditor({
  value,
  onChange,
  kind,
  problems,
  names,
  label,
  goTo,
}: InkEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lint = useRef(new Compartment());
  // The editor's callbacks read the latest props through this, set after each render.
  const latest = useRef({ onChange, names, problems });
  useEffect(() => {
    latest.current = { onChange, names, problems };
  });

  useEffect(() => {
    if (host.current === null) return;
    const complete = (context: CompletionContext) => {
      const divert = context.matchBefore(/(?:->|<-)\s*[\w.]*/u);
      if (divert !== null) {
        const word = context.matchBefore(/[\w.]*/u)!;
        return {
          from: word.from,
          options: [...latest.current.names.targets, 'END', 'DONE'].map((name) => ({
            label: name,
            type: 'namespace',
          })),
        };
      }
      const word = context.matchBefore(/\w+/u);
      const line = context.state.doc.lineAt(context.pos).text;
      const inLogic =
        /\{[^}]*$/u.test(line.slice(0, context.pos - context.state.doc.lineAt(context.pos).from)) ||
        /^\s*~/u.test(line);
      if (word === null || !inLogic) return null;
      return {
        from: word.from,
        options: [
          ...latest.current.names.variables.map((name) => ({ label: name, type: 'variable' })),
          ...latest.current.names.targets.map((name) => ({ label: name, type: 'namespace' })),
        ],
      };
    };
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          inkLanguage(kind),
          syntaxHighlighting(highlight),
          theme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'true' }),
          autocompletion({ override: [complete] }),
          lintGutter(),
          lint.current.of(
            linter((current) => diagnosticsOf(current, latest.current.problems, kind), {
              delay: 0,
            }),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // The editor is created once; later values arrive through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, label]);

  // A value from outside (a reload, a restored draft) replaces the text.
  useEffect(() => {
    const editor = view.current;
    if (editor !== null && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    }
  }, [value]);

  // New problems from the server: lint again.
  useEffect(() => {
    const editor = view.current;
    if (editor === null) return;
    editor.dispatch({
      effects: lint.current.reconfigure(
        linter((current) => diagnosticsOf(current, problems, kind), { delay: 0 }),
      ),
    });
  }, [problems, kind]);

  useEffect(() => {
    const editor = view.current;
    if (editor === null || goTo === null) return;
    const line = editor.state.doc.line(Math.min(Math.max(1, goTo.line), editor.state.doc.lines));
    editor.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    editor.focus();
  }, [goTo]);

  return <div ref={host} className="ink-editor" />;
}
