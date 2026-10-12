/** Where a book file's ink is, and the traps in it, without the editor (ADR 0030). */

/** The line numbers (1-based) where a file's ink starts and the ink applies. */
export function inkStartLine(text: string, kind: 'chapter' | 'ink'): number {
  const lines = text.split('\n');
  let index = 0;
  if (/^\uFEFF?---\s*$/u.test(lines[0] ?? '')) {
    index = lines.findIndex((line, at) => at > 0 && /^---\s*$/u.test(line)) + 1;
  }
  if (kind === 'ink') return index + 1;
  const heading = lines.findIndex(
    (line, at) => at >= index && /^ {0,3}##[ \t]+Chapter Text(?:[ \t]+#+)?[ \t]*$/iu.test(line),
  );
  return heading === -1 ? index + 1 : heading + 2;
}

/**
 * Traps in ink a writer coming from Markdown falls into, as warnings: `//`
 * in prose (a web address) starts a comment that hides the rest of the line.
 */
export function inkPitfalls(
  text: string,
  kind: 'chapter' | 'ink',
): { line: number; from: number; to: number; message: string }[] {
  const start = inkStartLine(text, kind);
  const found: { line: number; from: number; to: number; message: string }[] = [];
  text.split('\n').forEach((line, index) => {
    if (index + 1 < start) return;
    const url = /[a-z][a-z0-9+.-]*:\/\//iu.exec(line.replace(/\\./gu, '  '));
    if (url !== null) {
      const at = url.index + url[0].indexOf('//');
      found.push({
        line: index + 1,
        from: at,
        to: line.length,
        message:
          'ink reads // as the start of a comment, so the rest of this line is hidden. Write :\\/\\/ to keep a web address.',
      });
    }
  });
  return found;
}
