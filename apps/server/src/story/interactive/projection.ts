/**
 * An ink chapter's prose without ink (ADR 0030): the text a reader could
 * see on any path, as Markdown paragraphs, for search, story-skills' prose
 * checks, and "read all text". It reads the source, not the compiled story,
 * so it works while the ink has errors. Every alternative of a sequence or
 * conditional is kept; logic, diverts, tags, and comments are dropped.
 */

// Escaped characters are set aside first, so `\{` never opens logic.
const ESCAPE_BASE = 0xe000;
const escapes: string[] = [];

function protect(text: string): string {
  return text.replace(/\\(.)/gu, (_, character: string) => {
    escapes.push(character);
    return String.fromCharCode(ESCAPE_BASE + escapes.length - 1);
  });
}

function restore(text: string): string {
  return text.replace(/[-]/gu, (mark) => escapes[mark.charCodeAt(0) - ESCAPE_BASE] ?? '');
}

/** `{a|b}`, `{&a|b}`, `{cond: a|b}`, `{x}`: the words of every alternative, or nothing for a value. */
function inlineLogic(text: string): string {
  let current = text;
  for (let previous = ''; previous !== current;) {
    previous = current;
    current = current.replace(/\{([^{}]*)\}/gu, (_, inner: string) => {
      const body = inner.replace(/^[&~!]\s*/u, '');
      const colon = body.indexOf(':');
      const pipe = body.indexOf('|');
      // `{x}` prints a value no one can know here; `{&once}` is text.
      if (colon === -1 && pipe === -1) return /^[&~!]/u.test(inner) ? body.trim() : '';
      // A condition, `{cond: a|b}`, has its colon before any alternative.
      const alternatives =
        colon !== -1 && (pipe === -1 || colon < pipe) ? body.slice(colon + 1) : body;
      return alternatives
        .split('|')
        .map((part) => part.trim())
        .filter((part) => part !== '')
        .join(' ');
    });
  }
  return current;
}

const STATEMENT = /^(?:~|VAR\b|CONST\b|LIST\b|INCLUDE\b|EXTERNAL\b|TODO\b|={1,})/u;
const SCENE_BREAK_TAG = /^#\s*break\s*$/u;

/** One ink line's readable text, or null when it has none. */
function proseOf(line: string): string | null {
  let text = line.trim();
  if (text === '' || STATEMENT.test(text)) return null;
  // Choice and gather bullets, with a label: `* * (label) {cond} [text]`, `- (label)`.
  text = text.replace(/^(?:[*+]\s*)+(?:\(\s*\w+\s*\)\s*)?(?:\{[^{}]*\}\s*)*/u, '');
  text = text.replace(/^(?:-(?!>)\s*)+(?:\(\s*\w+\s*\)\s*)?/u, '');
  text = text.replace(/\[([^\]]*)\]/gu, '$1');
  text = text.replace(/->->|->\s*[\w.]*(?:\([^)]*\))?|<-\s*[\w.]*/gu, '');
  text = text.replace(/<>/gu, '');
  text = text.replace(/#.*$/u, '');
  text = inlineLogic(text).replace(/[{}]/gu, '');
  text = text.replace(/\s+/gu, ' ').trim();
  return text === '' ? null : restore(text);
}

/** Drops `//` line comments and `/* … *\/` blocks, outside escaped characters. */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, (block) => '\n'.repeat(block.split('\n').length - 1))
    .replace(/\/\/.*$/gmu, '');
}

/** The prose of an ink body as Markdown: one paragraph per line with text. */
export function projectInk(body: string): string {
  escapes.length = 0;
  const lines = withoutComments(protect(body)).split('\n');
  const paragraphs: string[] = [];
  let depth = 0;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (SCENE_BREAK_TAG.test(restore(trimmed))) {
      paragraphs.push('* * *');
      continue;
    }
    // A multi-line conditional: `{ cond:` … `- else:` … `}`.
    if (/^\{[^}]*$/u.test(trimmed)) {
      depth += 1;
      const after = trimmed.replace(/^\{[^:]*:\s*/u, '').replace(/^\{\s*/u, '');
      const text = after === '' ? null : proseOf(after);
      if (text !== null) paragraphs.push(text);
      continue;
    }
    if (depth > 0 && /^\}\s*$/u.test(trimmed)) {
      depth -= 1;
      continue;
    }
    const branch = depth > 0 ? /^-\s*(?:else|[^:]{1,120}):\s*(.*)$/u.exec(trimmed) : null;
    const text = proseOf(branch ? (branch[1] ?? '') : raw);
    if (text !== null) paragraphs.push(text);
  }
  return paragraphs.join('\n\n');
}
