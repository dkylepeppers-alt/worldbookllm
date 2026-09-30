/**
 * Sets one top-level scalar field in a Markdown file's YAML frontmatter,
 * leaving every other line as written. The value must be a plain YAML
 * scalar (a slug, a number); callers never pass user prose here.
 */
export function setFrontmatterField(markdown: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown);
  if (match === null) return `---\n${line}\n---\n\n${markdown}`;
  const lines = match[1]!.split(/\r?\n/u);
  const at = lines.findIndex((existing) => existing.startsWith(`${key}:`));
  if (at !== -1) {
    lines[at] = line;
  } else {
    // Keep the field near the title, where story.md keeps its identity fields.
    const title = lines.findIndex((existing) => existing.startsWith('title:'));
    lines.splice(title === -1 ? lines.length : title + 1, 0, line);
  }
  return `---\n${lines.join('\n')}\n---\n${markdown.slice(match[0].length)}`;
}
