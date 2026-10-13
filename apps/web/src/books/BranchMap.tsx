import type { InteractiveStory } from '@worldbookllm/shared';
import { Link } from 'react-router-dom';

import { fileHref } from './book-sections.js';
import {
  layoutBranchMap,
  NODE_HEIGHT,
  NODE_WIDTH,
  type MapEdge,
  type MapNode,
} from './branch-map-layout.js';

/** A title cut to what fits a node, with an ellipsis. */
function fit(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;
}

function backEdgeReach(from: MapNode, to: MapNode): number {
  const right = (node: MapNode) => node.x + NODE_WIDTH;
  return Math.max(right(from), right(to)) + 28 + Math.abs(from.y - to.y) / 8;
}

function edgePath(edge: MapEdge, from: MapNode, to: MapNode): string {
  const right = (node: MapNode) => node.x + NODE_WIDTH;
  const middle = (node: MapNode) => node.y + NODE_HEIGHT / 2;
  if (edge.from === edge.to) {
    // A choice back to the same chapter: a small loop on its right side.
    const x = right(from);
    return `M ${x} ${from.y + 14} C ${x + 34} ${from.y + 4}, ${x + 34} ${from.y + NODE_HEIGHT - 4}, ${x} ${from.y + NODE_HEIGHT - 14}`;
  }
  if (edge.back) {
    // Up or across: around the right-hand side, so it never crosses the rows.
    const reach = backEdgeReach(from, to);
    return `M ${right(from)} ${middle(from)} C ${reach} ${middle(from)}, ${reach} ${middle(to)}, ${right(to) + 4} ${middle(to)}`;
  }
  const startX = from.x + NODE_WIDTH / 2;
  const endX = to.x + NODE_WIDTH / 2;
  const startY = from.y + NODE_HEIGHT;
  const endY = to.y - 4;
  const bend = (endY - startY) / 2;
  return `M ${startX} ${startY} C ${startX} ${startY + bend}, ${endX} ${endY - bend}, ${endX} ${endY}`;
}

const EDGE_WORD: Record<MapEdge['kind'], string> = {
  choice: 'Choice',
  divert: 'Then',
  tunnel: 'Visits',
  thread: 'Weaves in',
};

function edgeLabel(edge: MapEdge, from: MapNode, to: MapNode): string {
  if (edge.text === null) {
    return `${from.place.title} ${edge.kind === 'tunnel' ? 'visits' : edge.kind === 'thread' ? 'weaves in' : 'goes on to'} ${to.place.title}`;
  }
  const condition = edge.condition === null ? '' : ` (only if ${edge.condition})`;
  return `${from.place.title}: “${edge.text}” leads to ${to.place.title}${condition}`;
}

function status(node: MapNode, seeds: ReadonlySet<string>): string {
  if (node.place.chapterId !== null && seeds.has(node.place.chapterId)) return 'not written';
  if (node.depth === null) return 'not reachable';
  if (node.place.start) return 'start';
  return node.place.ends ? 'ending' : '';
}

/**
 * The chapters as a map: one box per chapter, top to bottom by how many
 * choices it takes to get there, with an arrow per choice. Each box opens
 * the chapter's choices; the same map follows as a list for screen readers
 * and anyone who prefers it.
 */
export function BranchMap({
  slug,
  story,
  seeds = new Set(),
}: {
  slug: string;
  story: InteractiveStory;
  /** Chapters discovery has not written yet (ADR 0033), drawn as open nodes. */
  seeds?: ReadonlySet<string>;
}) {
  const layout = layoutBranchMap(story);
  const nodes = new Map(layout.nodes.map((node) => [node.place.name, node]));
  // A chapter opens its choices; a knot from ink/ opens its file.
  const editHref = (node: MapNode) =>
    node.place.chapterId !== null
      ? `/books/${encodeURIComponent(slug)}/branches/edit#branch-${node.place.chapterId}`
      : node.place.path !== null
        ? fileHref(slug, node.place.path)
        : `/books/${encodeURIComponent(slug)}/branches`;
  const width = Math.max(
    layout.width,
    ...layout.edges
      .filter((edge) => edge.back)
      .map((edge) => {
        const from = nodes.get(edge.from)!;
        const to = nodes.get(edge.to)!;
        return (edge.from === edge.to ? from.x + NODE_WIDTH + 34 : backEdgeReach(from, to)) + 8;
      }),
  );

  return (
    <div className="branch-map">
      <div className="branch-map-scroll">
        <svg
          viewBox={`0 0 ${width} ${layout.height}`}
          width={width}
          height={layout.height}
          role="img"
          aria-labelledby="branch-map-title"
        >
          <title id="branch-map-title">
            Map of {layout.nodes.length} {layout.nodes.length === 1 ? 'knot' : 'chapters and knots'}{' '}
            and {layout.edges.length} links between them
          </title>
          <defs>
            <marker
              id="branch-map-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="branch-map-arrowhead" />
            </marker>
          </defs>
          {layout.edges.map((edge, index) => {
            const from = nodes.get(edge.from)!;
            const to = nodes.get(edge.to)!;
            return (
              <path
                key={`${edge.from}:${edge.to}:${index}`}
                d={edgePath(edge, from, to)}
                className={
                  edge.stateful ? 'branch-map-edge branch-map-edge-state' : 'branch-map-edge'
                }
                markerEnd="url(#branch-map-arrow)"
              >
                <title>{edgeLabel(edge, from, to)}</title>
              </path>
            );
          })}
          {layout.nodes.map((node) => {
            const label = status(node, seeds);
            return (
              <Link key={node.place.name} to={editHref(node)} className="branch-map-node-link">
                <g
                  className={`branch-map-node${label === '' ? '' : ` branch-map-node-${label.replace(' ', '-')}`}`}
                >
                  <title>
                    {node.place.title}
                    {label === '' ? '' : ` (${label})`}
                    {node.place.stitches.length === 0
                      ? ''
                      : `, stitches: ${node.place.stitches.join(', ')}`}
                  </title>
                  <rect x={node.x} y={node.y} width={NODE_WIDTH} height={NODE_HEIGHT} rx={8} />
                  <text x={node.x + 12} y={node.y + 23} className="branch-map-title">
                    {fit(node.place.title, 20)}
                  </text>
                  <text x={node.x + 12} y={node.y + 42} className="branch-map-meta">
                    {label === '' ? node.place.name : `${fit(node.place.name, 12)} · ${label}`}
                  </text>
                </g>
              </Link>
            );
          })}
        </svg>
      </div>

      <details className="branch-map-list">
        <summary>The map as a list</summary>
        <ol>
          {layout.nodes.map((node) => {
            const out = layout.edges.filter((edge) => edge.from === node.place.name);
            const label = status(node, seeds);
            return (
              <li key={node.place.name}>
                <Link to={editHref(node)}>{node.place.title}</Link>
                {label === '' ? null : <span className="coordinate-label"> · {label}</span>}
                {out.length === 0 ? null : (
                  <ul>
                    {out.map((edge, index) => (
                      <li key={`${edge.to}:${index}`}>
                        {edge.text === null ? EDGE_WORD[edge.kind] : `“${edge.text}”`} →{' '}
                        {nodes.get(edge.to)!.place.title}
                        {edge.condition === null ? '' : ` (only if ${edge.condition})`}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </details>
    </div>
  );
}
