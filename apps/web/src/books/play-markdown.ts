const FENCE = /^ {0,3}(`{3,})/u;
const TABLE_ROW = /^ {0,3}\|/u;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/u;

/**
 * The Markdown for a passage's lines. ink prints each line as a paragraph,
 * so lines are paragraphs apart, except where Markdown needs them together:
 * the lines of a fenced code block, the rows of a table, and the items of a
 * list (the ink writer puts each on its own line, ADR 0028).
 */
export function markdownOf(lines: readonly string[]): string {
  let out = '';
  let fence: string | null = null;
  let previous: string | null = null;
  for (const line of lines) {
    const together =
      previous !== null &&
      (fence !== null ||
        (TABLE_ROW.test(line) && TABLE_ROW.test(previous)) ||
        (LIST_ITEM.test(line) && LIST_ITEM.test(previous)));
    out += previous === null ? line : `${together ? '\n' : '\n\n'}${line}`;
    const marker = FENCE.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === null) fence = marker;
      else if (marker.length >= fence.length && line.trim() === marker) fence = null;
    }
    previous = line;
  }
  return out;
}
