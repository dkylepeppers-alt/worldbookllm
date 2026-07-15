const FALLBACK_TITLE = 'Assistant response';
const TITLE_LIMIT = 300;

export function deriveResponseTitle(markdown: string): string {
  const lines = markdown.split(/\r?\n/u);
  const heading = lines
    .map((line) => {
      const content = /^\s{0,3}#{1,6}[ \t]+(.+?)\s*$/u.exec(line)?.[1];
      return content?.replace(/[ \t]+#+[ \t]*$/u, '').trim() ?? '';
    })
    .find((line) => line.length > 0);
  if (heading !== undefined) return heading.slice(0, TITLE_LIMIT);

  for (const line of lines) {
    const stripped = line
      .trim()
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .replace(/^(?:[-+*]|\d+[.)])\s+/u, '')
      .replace(/^>\s?/u, '')
      .replace(/[*_~`]/gu, '')
      .replace(/^[#\-()[\]\s]+|[#\-()[\]\s]+$/gu, '')
      .trim();
    if (/\p{L}|\p{N}/u.test(stripped)) return stripped.slice(0, TITLE_LIMIT);
  }
  return FALLBACK_TITLE;
}
