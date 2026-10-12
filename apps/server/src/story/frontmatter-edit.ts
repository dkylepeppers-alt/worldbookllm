/**
 * Sets one top-level scalar field in a Markdown file's YAML frontmatter,
 * leaving every other line as written. The value must be a plain YAML
 * scalar (a slug, a number); callers never pass user prose here.
 */
import matter from 'gray-matter';

/**
 * The index just past a top-level field that starts at `at`: a value YAML
 * wrapped or folded onto indented lines, or a list under an empty key,
 * belongs to the field.
 */
function fieldEnd(lines: readonly string[], at: number): number {
  const empty = /^[^:]+:\s*$/u.test(lines[at]!);
  let end = at + 1;
  while (end < lines.length) {
    const next = lines[end]!;
    if (!/^\s/u.test(next) && !(empty && next.startsWith('- '))) break;
    end += 1;
  }
  return end;
}

// A byte order mark from a Windows editor stays where it is.
const FRONTMATTER = /^(\uFEFF?)---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;

export function setFrontmatterField(markdown: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  const match = FRONTMATTER.exec(markdown);
  if (match === null) {
    const bom = markdown.startsWith('\uFEFF') ? '\uFEFF' : '';
    return `${bom}---\n${line}\n---\n\n${markdown.slice(bom.length)}`;
  }
  const lines = match[2]!.split(/\r?\n/u);
  const at = lines.findIndex((existing) => existing.startsWith(`${key}:`));
  if (at !== -1) {
    lines.splice(at, fieldEnd(lines, at) - at, line);
  } else {
    // Keep the field near the title, where story.md keeps its identity fields.
    const title = lines.findIndex((existing) => existing.startsWith('title:'));
    lines.splice(title === -1 ? lines.length : fieldEnd(lines, title), 0, line);
  }
  return `${match[1]}---\n${lines.join('\n')}\n---\n${markdown.slice(match[0].length)}`;
}

/** Removes one top-level field, with any lines its value runs onto, leaving the rest as written. */
export function removeFrontmatterField(markdown: string, key: string): string {
  const match = FRONTMATTER.exec(markdown);
  if (match === null) return markdown;
  const lines = match[2]!.split(/\r?\n/u);
  const at = lines.findIndex((existing) => new RegExp(`^${key}[ \t]*:`, 'u').test(existing));
  if (at === -1) return markdown;
  lines.splice(at, fieldEnd(lines, at) - at);
  return `${match[1]}---\n${lines.join('\n')}\n---\n${markdown.slice(match[0].length)}`;
}

// gray-matter hands these options to js-yaml's dump, which its types do not describe.
const DUMP = { lineWidth: -1 } as unknown as Parameters<typeof matter.stringify>[2];

/** Removes series metadata or one sibling's links while preserving unrelated YAML values/body. */
export function removeSeriesLinks(markdown: string, removedBook?: string): string {
  const parsed = matter(markdown, {});
  const data: Record<string, unknown> = { ...parsed.data };
  const before = Object.keys(data).length;
  let changed = false;
  if (removedBook === undefined) {
    for (const key of ['series', 'series-title', 'book-number', 'follows', 'precedes'])
      delete data[key];
    changed = Object.keys(data).length !== before;
  } else {
    for (const key of ['follows', 'precedes']) {
      const value = data[key];
      const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
      const remaining = values.filter(
        (link) =>
          typeof link !== 'string' ||
          link
            .trim()
            .replace(/\/story\.md$/u, '')
            .replace(/\/+$/u, '')
            .split('/')
            .at(-1) !== removedBook,
      );
      if (remaining.length === values.length) continue;
      changed = true;
      if (remaining.length === 0) delete data[key];
      else data[key] = remaining;
    }
  }
  // Rewriting the YAML loses comments and quoting, so only do it to remove something;
  // and never wrap long values, which line edits like setFrontmatterField would split.
  if (!changed) return markdown;
  return matter.stringify(parsed.content, data, DUMP);
}
