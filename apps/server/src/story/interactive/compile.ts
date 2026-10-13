import type { InkDiagnostic } from '@worldbookllm/shared';
import { Compiler, CompilerOptions, JsonFileHandler } from 'inkjs/full';

import type { AssembledStory } from './assemble.js';

/**
 * The parts of inkjs's parsed story this module reads. inkjs does not
 * export its parse-tree classes from `inkjs/full`, so nodes are told apart
 * by `typeName` (ADR 0030).
 */
export interface ParsedNode {
  readonly typeName: string;
  readonly content: ParsedNode[] | null;
  readonly debugMetadata: { fileName: string | null; startLineNumber: number } | null;
}

export interface CompiledStory {
  /** The story in ink's JSON format, or null when it did not compile. */
  json: string | null;
  /** The parse tree, when the compiler got that far. */
  parsed: ParsedNode | null;
  diagnostics: InkDiagnostic[];
}

// inkjs reports `ERROR: 'file' line 3: message`, `WARNING: …`, or `TODO: …`.
const MESSAGE = /^(ERROR|WARNING|TODO):\s*(?:'([^']*)'\s+)?(?:line (\d+):\s*)?([\s\S]*)$/u;

/** A compiler message as a diagnostic at its book file and line. */
function diagnosticOf(
  story: AssembledStory,
  message: string,
  severity: InkDiagnostic['severity'],
): InkDiagnostic {
  const match = MESSAGE.exec(message.trim());
  if (match === null) return { severity, message: message.trim(), path: null, line: null };
  const [, kind, file, line, text] = match;
  const place = file === undefined || line === undefined ? null : story.locate(file, Number(line));
  return {
    severity: kind === 'TODO' ? 'todo' : kind === 'WARNING' ? 'warning' : 'error',
    message: text!.trim(),
    path: place?.path ?? null,
    line: place?.line ?? null,
  };
}

/**
 * Compiles an assembled story with inkjs, counting every visit so Play can
 * tell which chapter each line comes from and conditions can test any
 * knot's read count.
 */
export function compileStory(story: AssembledStory): CompiledStory {
  const diagnostics: InkDiagnostic[] = [];
  const compiler = new Compiler(
    story.files[story.root]!,
    new CompilerOptions(
      story.root,
      [],
      true,
      (message: string, type: number) => {
        // ErrorType: 0 author note (TODO), 1 warning, 2 error.
        diagnostics.push(
          diagnosticOf(story, message, type === 2 ? 'error' : type === 1 ? 'warning' : 'todo'),
        );
      },
      new JsonFileHandler(story.files),
    ),
  );
  let json: string | null = null;
  try {
    const compiled = compiler.Compile();
    if (!diagnostics.some((entry) => entry.severity === 'error')) {
      json = compiled.ToJson() ?? null;
    }
  } catch (error) {
    if (!diagnostics.some((entry) => entry.severity === 'error')) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push(diagnosticOf(story, message, 'error'));
    }
  }
  // The `parsedStory` getter throws when parsing threw before it finished,
  // so read its backing field, which is null then.
  const parsed = (compiler as unknown as { _parsedStory: ParsedNode | null })._parsedStory ?? null;
  return { json, parsed, diagnostics: dedupe(diagnostics) };
}

/** inkjs can report one problem twice (as it parses, and again as it fails). */
function dedupe(diagnostics: readonly InkDiagnostic[]): InkDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((entry) => {
    const key = `${entry.severity}\0${entry.path}\0${entry.line}\0${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
