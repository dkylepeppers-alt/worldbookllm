import type { InkDiagnostic } from '@worldbookllm/shared';

import { isIfid } from './format.js';
import type { StoryStructure } from './structure.js';

/** A diagnostic as one line: `chapters/chapter-01.md:6: message`. */
export function describeDiagnostic(entry: InkDiagnostic): string {
  const place =
    entry.path === null ? '' : `${entry.path}${entry.line === null ? '' : `:${entry.line}`}: `;
  return `${place}${entry.message}`;
}

/**
 * What the story's structure shows that the compiler does not: chapters,
 * knots, and stitches nothing leads to, ones that run out of story with no
 * choice, divert, or ending, variables nothing reads, and a missing IFID.
 */
export function storyFindings(structure: StoryStructure | null, ifid: unknown): InkDiagnostic[] {
  const findings: InkDiagnostic[] = [];
  if (!isIfid(ifid)) {
    findings.push({
      severity: 'warning',
      message:
        'story.md has no IFID (a version 4 UUID), which story archives and players use to tell stories apart',
      path: 'story.md',
      line: null,
    });
  }
  if (structure === null) return findings;
  const withStitches = new Set(
    structure.nodes
      .filter((node) => node.kind === 'stitch')
      .map((node) => node.name.split('.')[0]!),
  );
  for (const node of structure.nodes) {
    if (node.kind === 'function') continue;
    const label = node.kind === 'stitch' ? `stitch ${node.name}` : `${node.title} (${node.name})`;
    if (!node.reachable) {
      findings.push({
        severity: 'warning',
        message: `Nothing leads to ${label}`,
        path: node.path,
        line: node.line,
      });
    }
    const stops =
      node.choices.length > 0 ||
      node.diverts.length > 0 ||
      node.ends ||
      withStitches.has(node.name);
    if (!stops) {
      findings.push({
        severity: 'warning',
        message: `${label} runs out of story: it has no choices, divert, or -> END`,
        path: node.path,
        line: node.line,
      });
    }
  }
  const read = new Set(structure.nodes.flatMap((node) => node.reads));
  for (const variable of structure.variables) {
    if (variable.kind === 'list' || read.has(variable.name)) continue;
    findings.push({
      severity: 'warning',
      message: `${variable.name} is never read`,
      path: variable.path,
      line: variable.line,
    });
  }
  return findings;
}
