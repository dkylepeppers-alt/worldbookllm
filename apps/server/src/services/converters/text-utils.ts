export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function decodeUtf8(bytes: Buffer): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * Deterministic plain-text normalization shared by the text and PDF converters:
 * unify line endings, drop trailing whitespace per line, collapse runs of blank
 * lines to a single blank line, and trim leading/trailing blank lines.
 */
export function normalizeText(text: string): string {
  return stripBom(text)
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/^\n+/u, '')
    .replace(/\n+$/u, '');
}

export function fileStem(fileName: string): string {
  const base = fileName.split(/[/\\]/u).at(-1) ?? fileName;
  const withoutExt = base.replace(/\.[^.]+$/u, '');
  return withoutExt.trim() || base.trim() || 'Untitled source';
}

export function cleanTitle(value: string | undefined, fallback: string): string {
  const title = value?.trim() || fallback;
  return title.slice(0, 300);
}
