/**
 * Converts arbitrary user input into a safe FTS5 MATCH expression: every
 * whitespace-separated token becomes a quoted prefix phrase (`"token"*`),
 * with embedded double quotes doubled. Quoting disarms all FTS5 query
 * syntax (`NEAR`, `-`, parentheses, unbalanced quotes), and the trailing
 * `*` gives find-as-you-type behavior. Tokens are joined with implicit AND.
 * NUL characters split tokens like whitespace — FTS5 rejects them even
 * inside a quoted string. Returns '' when the input contains no tokens;
 * callers treat that as no results rather than passing it to MATCH.
 */
export function toFtsMatchQuery(input: string): string {
  return input
    .split(/[\s\0]+/u)
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(' ');
}
