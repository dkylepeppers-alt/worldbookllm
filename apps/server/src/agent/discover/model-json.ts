/**
 * The JSON in a model's plain-text reply. Models wrap it in prose, in a
 * ```json fence, or after a <think> block, and some answer with a bare
 * array. Tries a fenced block first, then each balanced `{…}` or `[…]` from
 * the longest down; undefined when none parses.
 */
export function readJsonReply(text: string): unknown {
  const visible = text.replace(/<think>[\s\S]*?<\/think>/giu, '');
  const candidates: string[] = [];
  for (const match of visible.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/giu)) {
    candidates.push(match[1]!.trim());
  }
  candidates.push(...balanced(visible).sort((left, right) => right.length - left.length));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Not JSON; try the next.
    }
  }
  return undefined;
}

/** The last JSON object in a reply that parses, or undefined. */
export function lastJsonObject(text: string): Record<string, unknown> | undefined {
  const visible = text.replace(/<think>[\s\S]*?<\/think>/giu, '');
  for (const span of balanced(visible).reverse()) {
    try {
      const value = JSON.parse(span) as unknown;
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // Not JSON; try the one before.
    }
  }
  return undefined;
}

/** Every top-level balanced `{…}` or `[…]` span, ignoring brackets inside strings. */
function balanced(text: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"' && depth > 0) inString = true;
    else if (char === '{' || char === '[') {
      if (depth === 0) start = index;
      depth += 1;
    } else if ((char === '}' || char === ']') && depth > 0) {
      depth -= 1;
      if (depth === 0) spans.push(text.slice(start, index + 1));
    }
  }
  return spans;
}
