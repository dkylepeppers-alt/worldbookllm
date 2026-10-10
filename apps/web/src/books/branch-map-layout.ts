import type { BookBranches, BranchChapter } from '@worldbookllm/shared';

export const NODE_WIDTH = 168;
export const NODE_HEIGHT = 56;
const COLUMN_GAP = 20;
const ROW_GAP = 56;
const MARGIN = 16;

export interface MapNode {
  chapter: BranchChapter;
  x: number;
  y: number;
  /** Rows from the start; null for a chapter no path reaches. */
  depth: number | null;
}

export interface MapEdge {
  from: string;
  to: string;
  /** The choice text, or null for a linear book's "next chapter". */
  text: string | null;
  /** Leads to a row above or the same row: drawn as a loop around the side. */
  back: boolean;
  /** Has `sets` or `requires`, so it depends on or changes state. */
  stateful: boolean;
}

export interface MapLayout {
  nodes: MapNode[];
  edges: MapEdge[];
  width: number;
  height: number;
}

/**
 * Lays the chapters out top to bottom by how few choices the reader needs
 * to reach each one from the start, in chapter order within a row, with the
 * chapters no path reaches in a last row of their own. Links are the
 * choices in a branching book and "next chapter" in a linear one, as the
 * builds read them.
 */
export function layoutBranchMap(branches: BookBranches): MapLayout {
  const { chapters } = branches;
  const ids = new Set(chapters.map((chapter) => chapter.id));
  const edges: Omit<MapEdge, 'back'>[] = branches.branching
    ? chapters.flatMap((chapter) =>
        chapter.choices
          .filter((choice) => ids.has(choice.to))
          .map((choice) => ({
            from: chapter.id,
            to: choice.to,
            text: choice.text,
            stateful: choice.sets.length > 0 || choice.requires.length > 0,
          })),
      )
    : chapters.slice(1).map((chapter, index) => ({
        from: chapters[index]!.id,
        to: chapter.id,
        text: null,
        stateful: false,
      }));

  const depth = new Map<string, number>();
  const start = chapters.find((chapter) => chapter.start) ?? chapters[0];
  if (start !== undefined) {
    depth.set(start.id, 0);
    const queue = [start.id];
    for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
      for (const edge of edges) {
        if (edge.from === current && !depth.has(edge.to)) {
          depth.set(edge.to, depth.get(current)! + 1);
          queue.push(edge.to);
        }
      }
    }
  }

  const reachedRows = Math.max(-1, ...depth.values()) + 1;
  const rows: BranchChapter[][] = Array.from(
    { length: reachedRows + (chapters.some((chapter) => !depth.has(chapter.id)) ? 1 : 0) },
    () => [],
  );
  for (const chapter of chapters) rows[depth.get(chapter.id) ?? reachedRows]!.push(chapter);

  const widest = Math.max(1, ...rows.map((row) => row.length));
  const width = MARGIN * 2 + widest * NODE_WIDTH + (widest - 1) * COLUMN_GAP;
  const nodes: MapNode[] = rows.flatMap((row, rowIndex) => {
    const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * COLUMN_GAP;
    const left = (width - rowWidth) / 2;
    return row.map((chapter, column) => ({
      chapter,
      x: left + column * (NODE_WIDTH + COLUMN_GAP),
      y: MARGIN + rowIndex * (NODE_HEIGHT + ROW_GAP),
      depth: depth.get(chapter.id) ?? null,
    }));
  });
  const rowOf = new Map(nodes.map((node) => [node.chapter.id, node.y]));
  return {
    nodes,
    edges: edges.map((edge) => ({ ...edge, back: rowOf.get(edge.to)! <= rowOf.get(edge.from)! })),
    width,
    height: MARGIN * 2 + rows.length * NODE_HEIGHT + Math.max(0, rows.length - 1) * ROW_GAP,
  };
}
