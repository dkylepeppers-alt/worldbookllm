export type DiffLine =
  { kind: 'same' | 'add' | 'del'; text: string } | { kind: 'skip'; count: number };

/** Above this many cells the middle section is shown as removed-then-added. */
const MAX_TABLE_CELLS = 4_000_000;
const CONTEXT = 3;

/**
 * Marks a last line that has no newline, as `diff` does, so a change that
 * only adds or removes the final newline still shows a line.
 */
export const NO_NEWLINE = '\\ No newline at end of file';

function splitLines(text: string | null): string[] {
  if (text === null || text === '') return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  else lines.push(NO_NEWLINE);
  return lines;
}

/** The longest-common-subsequence diff of two short line lists. */
function middleDiff(before: string[], after: string[]): DiffLine[] {
  const rows = before.length;
  const cols = after.length;
  if (rows === 0) return after.map((text) => ({ kind: 'add', text }));
  if (cols === 0) return before.map((text) => ({ kind: 'del', text }));
  if (rows * cols > MAX_TABLE_CELLS) {
    return [
      ...before.map((text) => ({ kind: 'del' as const, text })),
      ...after.map((text) => ({ kind: 'add' as const, text })),
    ];
  }
  // lengths[i * (cols + 1) + j]: LCS length of before[i..] and after[j..].
  const width = cols + 1;
  const lengths = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        before[i] === after[j]
          ? lengths[(i + 1) * width + j + 1]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (before[i] === after[j]) {
      lines.push({ kind: 'same', text: before[i]! });
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) {
      lines.push({ kind: 'del', text: before[i]! });
      i += 1;
    } else {
      lines.push({ kind: 'add', text: after[j]! });
      j += 1;
    }
  }
  for (; i < rows; i += 1) lines.push({ kind: 'del', text: before[i]! });
  for (; j < cols; j += 1) lines.push({ kind: 'add', text: after[j]! });
  return lines;
}

/** Folds unchanged runs longer than the context around each change. */
function fold(lines: DiffLine[]): DiffLine[] {
  const changed = lines.map((line) => line.kind === 'add' || line.kind === 'del');
  const keep = changed.map((_, index) => {
    for (let k = Math.max(0, index - CONTEXT); k <= index + CONTEXT && k < lines.length; k += 1) {
      if (changed[k]) return true;
    }
    return false;
  });
  const folded: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped > 0) folded.push({ kind: 'skip', count: skipped });
      skipped = 0;
      folded.push(line);
    } else {
      skipped += 1;
    }
  });
  if (skipped > 0) folded.push({ kind: 'skip', count: skipped });
  return folded;
}

/**
 * A line diff of a file's before and after text (null when the file did not
 * exist), with unchanged runs folded to three lines of context.
 */
export function lineDiff(before: string | null, after: string | null): DiffLine[] {
  const left = splitLines(before);
  const right = splitLines(after);
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  let endLeft = left.length;
  let endRight = right.length;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
    endLeft -= 1;
    endRight -= 1;
  }
  const lines: DiffLine[] = [
    ...left.slice(0, start).map((text) => ({ kind: 'same' as const, text })),
    ...middleDiff(left.slice(start, endLeft), right.slice(start, endRight)),
    ...left.slice(endLeft).map((text) => ({ kind: 'same' as const, text })),
  ];
  return fold(lines);
}
