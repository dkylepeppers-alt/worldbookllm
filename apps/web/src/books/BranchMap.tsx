import type { BookBranches } from '@worldbookllm/shared';
import { Link } from 'react-router-dom';

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

function status(node: MapNode, branching: boolean): string {
  if (node.depth === null) return 'not reachable';
  if (node.chapter.start) return 'start';
  return branching && node.chapter.ending ? 'ending' : '';
}

/**
 * The chapters as a map: one box per chapter, top to bottom by how many
 * choices it takes to get there, with an arrow per choice. Each box opens
 * the chapter's choices; the same map follows as a list for screen readers
 * and anyone who prefers it.
 */
export function BranchMap({ slug, branches }: { slug: string; branches: BookBranches }) {
  const layout = layoutBranchMap(branches);
  const nodes = new Map(layout.nodes.map((node) => [node.chapter.id, node]));
  const editHref = (id: string) => `/books/${encodeURIComponent(slug)}/branches/edit#branch-${id}`;
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
            Map of {layout.nodes.length} chapters and {layout.edges.length} links between them
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
                <title>
                  {edge.text === null
                    ? `${from.chapter.title} goes on to ${to.chapter.title}`
                    : `${from.chapter.title}: “${edge.text}” leads to ${to.chapter.title}${edge.stateful ? ' (uses flags)' : ''}`}
                </title>
              </path>
            );
          })}
          {layout.nodes.map((node) => {
            const label = status(node, branches.branching);
            return (
              <Link
                key={node.chapter.id}
                to={editHref(node.chapter.id)}
                className="branch-map-node-link"
              >
                <g
                  className={`branch-map-node${label === '' ? '' : ` branch-map-node-${label.replace(' ', '-')}`}`}
                >
                  <title>
                    {node.chapter.title}
                    {label === '' ? '' : ` (${label})`}
                  </title>
                  <rect x={node.x} y={node.y} width={NODE_WIDTH} height={NODE_HEIGHT} rx={8} />
                  <text x={node.x + 12} y={node.y + 23} className="branch-map-title">
                    {fit(node.chapter.title, 20)}
                  </text>
                  <text x={node.x + 12} y={node.y + 42} className="branch-map-meta">
                    {label === '' ? node.chapter.id : `${node.chapter.id} · ${label}`}
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
            const out = layout.edges.filter((edge) => edge.from === node.chapter.id);
            const label = status(node, branches.branching);
            return (
              <li key={node.chapter.id}>
                <Link to={editHref(node.chapter.id)}>{node.chapter.title}</Link>
                {label === '' ? null : <span className="coordinate-label"> · {label}</span>}
                {out.length === 0 ? null : (
                  <ul>
                    {out.map((edge, index) => (
                      <li key={`${edge.to}:${index}`}>
                        {edge.text === null ? 'Then' : `“${edge.text}”`} →{' '}
                        {nodes.get(edge.to)!.chapter.title}
                        {edge.stateful ? ' (uses flags)' : ''}
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
