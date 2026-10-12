import type { InteractiveStory, StoryNode } from '@worldbookllm/shared';

export const NODE_WIDTH = 168;
export const NODE_HEIGHT = 56;
const COLUMN_GAP = 20;
const ROW_GAP = 56;
const MARGIN = 16;
/** A row wider than this wraps onto the next, so a map never grows one very long row. */
const MAX_COLUMNS = 6;

/** A box on the map: a chapter, or a knot from `ink/`, with its stitches folded in. */
export interface MapPlace {
  /** Its knot name. */
  name: string;
  title: string;
  chapterId: string | null;
  /** The book file it is written in. */
  path: string | null;
  start: boolean;
  /** Can end the story here (`-> END`), in it or one of its stitches. */
  ends: boolean;
  reachable: boolean;
  stitches: string[];
}

export interface MapNode {
  place: MapPlace;
  x: number;
  y: number;
  /** Steps from the start; null for a place no path reaches. */
  depth: number | null;
}

export interface MapEdge {
  from: string;
  to: string;
  /** The choice text, or null for a divert. */
  text: string | null;
  /** Leads to a row above or the same row: drawn as a loop around the side. */
  back: boolean;
  /** Has a condition or changes a variable. */
  stateful: boolean;
  /** The choice's condition, as written. */
  condition: string | null;
  kind: 'choice' | 'divert' | 'tunnel' | 'thread';
}

export interface MapLayout {
  nodes: MapNode[];
  edges: MapEdge[];
  width: number;
  height: number;
}

const knotOf = (name: string) => name.split('.')[0]!;

/** The story's knots as map places, chapters first in reading order. */
export function mapPlaces(story: InteractiveStory): MapPlace[] {
  const top = story.nodes.filter((node) => node.kind === 'chapter' || node.kind === 'knot');
  const order = new Map(story.chapters.map((chapter, index) => [chapter.knot, index]));
  const ordered = [...top].sort(
    (left, right) =>
      (order.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.name) ?? Number.MAX_SAFE_INTEGER),
  );
  const start = story.start === null ? null : knotOf(story.start);
  return ordered.map((node) => {
    const own = story.nodes.filter(
      (other) => other.kind === 'stitch' && knotOf(other.name) === node.name,
    );
    return {
      name: node.name,
      title: node.title,
      chapterId: node.chapterId,
      path: node.path,
      start: node.name === start,
      ends: node.ends || own.some((stitch) => stitch.ends),
      reachable: node.reachable || own.some((stitch) => stitch.reachable),
      stitches: own.map((stitch) => stitch.name.slice(node.name.length + 1)),
    };
  });
}

function edgesOf(
  nodes: readonly StoryNode[],
  places: ReadonlySet<string>,
): Omit<MapEdge, 'back'>[] {
  const edges: Omit<MapEdge, 'back'>[] = [];
  const add = (
    from: string,
    target: string | null,
    edge: Omit<MapEdge, 'back' | 'from' | 'to'>,
  ) => {
    if (target === null) return;
    const to = knotOf(target);
    // A move to a stitch inside the same knot stays inside its box.
    if (!places.has(to) || (to === from && target.includes('.'))) return;
    edges.push({ from, to, ...edge });
  };
  for (const node of nodes) {
    if (node.kind === 'function') continue;
    const from = knotOf(node.name);
    if (!places.has(from)) continue;
    for (const choice of node.choices) {
      add(from, choice.target, {
        text: choice.text,
        stateful: choice.condition !== null || choice.writes.length > 0,
        condition: choice.condition,
        kind: 'choice',
      });
    }
    for (const divert of node.diverts) {
      add(from, divert.target, { text: null, stateful: false, condition: null, kind: divert.kind });
    }
  }
  return edges;
}

/**
 * Lays the story's chapters and knots out top to bottom by how few steps
 * (choices or diverts) reach each from the start, in reading order within a
 * row, with what no path reaches in rows of its own at the end. A row wider
 * than six boxes wraps.
 */
export function layoutBranchMap(story: InteractiveStory): MapLayout {
  const places = mapPlaces(story);
  const names = new Set(places.map((place) => place.name));
  const edges = edgesOf(story.nodes, names);

  const depth = new Map<string, number>();
  const start = places.find((place) => place.start) ?? places[0];
  if (start !== undefined) {
    depth.set(start.name, 0);
    const queue = [start.name];
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
  const groups: MapPlace[][] = Array.from(
    { length: reachedRows + (places.some((place) => !depth.has(place.name)) ? 1 : 0) },
    () => [],
  );
  for (const place of places) groups[depth.get(place.name) ?? reachedRows]!.push(place);
  const rows = groups.flatMap((group) => {
    const wrapped: MapPlace[][] = [];
    for (let index = 0; index < group.length; index += MAX_COLUMNS) {
      wrapped.push(group.slice(index, index + MAX_COLUMNS));
    }
    return wrapped;
  });

  const widest = Math.max(1, ...rows.map((row) => row.length));
  const width = MARGIN * 2 + widest * NODE_WIDTH + (widest - 1) * COLUMN_GAP;
  const nodes: MapNode[] = rows.flatMap((row, rowIndex) => {
    const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * COLUMN_GAP;
    const left = (width - rowWidth) / 2;
    return row.map((place, column) => ({
      place,
      x: left + column * (NODE_WIDTH + COLUMN_GAP),
      y: MARGIN + rowIndex * (NODE_HEIGHT + ROW_GAP),
      depth: depth.get(place.name) ?? null,
    }));
  });
  const rowOf = new Map(nodes.map((node) => [node.place.name, node.y]));
  return {
    nodes,
    edges: edges.map((edge) => ({ ...edge, back: rowOf.get(edge.to)! <= rowOf.get(edge.from)! })),
    width,
    height: MARGIN * 2 + rows.length * NODE_HEIGHT + Math.max(0, rows.length - 1) * ROW_GAP,
  };
}
