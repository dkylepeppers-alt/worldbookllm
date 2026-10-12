import type { ChapterEnding } from '@worldbookllm/shared';

// `name = value`, `name += 1`, `name -= 1`, `name++`, `name--`.
const ASSIGNMENT = /^\s*([A-Za-z_]\w*)\s*(=|\+=|-=|\+\+|--)\s*(.*)$/u;

/** A declaration's starting value, from what an assignment gives it. */
function initialFor(operator: string, value: string): string {
  if (operator !== '=') return '0';
  const text = value.trim();
  if (text === 'true' || text === 'false') return 'false';
  if (/^"/u.test(text)) return '""';
  return '0';
}

/**
 * `VAR` lines for the variables an ending's choices change that the story
 * does not declare, so the choices screen never leaves an undeclared name.
 */
export function undeclaredVariables(
  ending: ChapterEnding,
  declared: ReadonlySet<string>,
): string[] {
  const lines = new Map<string, string>();
  for (const choice of ending.choices) {
    for (const effect of choice.effects) {
      const match = ASSIGNMENT.exec(effect);
      if (match === null || match[1] === 'temp') continue;
      const name = match[1]!;
      if (declared.has(name) || lines.has(name)) continue;
      lines.set(name, `VAR ${name} = ${initialFor(match[2]!, match[3] ?? '')}`);
    }
  }
  return [...lines.values()];
}

/** `ink/variables.md` with declarations added, or a new one holding them. */
export function appendDeclarations(
  existing: string | null,
  declarations: readonly string[],
): string {
  if (existing === null) {
    return ['---', 'title: Story variables', '---', ...declarations, ''].join('\n');
  }
  return `${existing.trimEnd()}\n${declarations.join('\n')}\n`;
}
