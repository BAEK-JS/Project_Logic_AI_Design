import * as Dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

/* ── 노드 토큰 파싱 ── */
function parseNodeToken(token: string): { id: string; label: string } | null {
  const t = token.trim();
  if (!t) return null;
  let m: RegExpMatchArray | null;

  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\(\[(.+)\]\)$/);  if (m) return { id: m[1], label: m[2] };
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\(\((.+)\)\)$/);  if (m) return { id: m[1], label: m[2] };
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\[(.+)\]$/);       if (m) return { id: m[1], label: m[2] };
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\((.+)\)$/);       if (m) return { id: m[1], label: m[2] };
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\{(.+)\}$/);       if (m) return { id: m[1], label: m[2] };
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)$/);               if (m) return { id: m[1], label: m[1] };
  return null;
}

interface RawEdge { source: string; target: string; label?: string; }

/* ── Dagre 자동 레이아웃 ── */
const NODE_W = 200;
const NODE_H = 56;

function dagreLayout(
  nodeIds: string[],
  edges: RawEdge[],
): Map<string, { x: number; y: number }> {
  const g = new (Dagre as unknown as typeof import('@dagrejs/dagre')).graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', ranksep: 90, nodesep: 70 });

  nodeIds.forEach(id => g.setNode(id, { width: NODE_W, height: NODE_H }));
  edges.forEach(e => {
    if (nodeIds.includes(e.source) && nodeIds.includes(e.target)) {
      g.setEdge(e.source, e.target);
    }
  });
  (Dagre as unknown as typeof import('@dagrejs/dagre')).layout(g);

  const result = new Map<string, { x: number; y: number }>();
  nodeIds.forEach(id => {
    const p = g.node(id);
    result.set(id, p ? { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } : { x: Math.random() * 300, y: Math.random() * 300 });
  });
  return result;
}

/* ── 메인 파서 ── */
export function parseMermaidToFlow(src: string): { nodes: Node[]; edges: Edge[] } {
  const nodeMap = new Map<string, string>(); // id → label
  const rawEdges: RawEdge[] = [];

  const setNode = (id: string, label: string) => {
    if (!nodeMap.has(id) || label !== id) {
      nodeMap.set(id, label);
    }
  };

  for (const rawLine of src.split('\n')) {
    const line = rawLine.replace(/;$/, '').trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^(?:flowchart|graph)\s/i.test(line)) continue;
    if (/^subgraph\b/i.test(line) || /^end$/i.test(line)) continue;

    const arrowMatch = line.match(/-{2,}>|---/);
    if (arrowMatch && arrowMatch.index != null) {
      const fromStr = line.slice(0, arrowMatch.index).trim();
      const restStr = line.slice(arrowMatch.index + arrowMatch[0].length).trim();

      let edgeLabel: string | undefined;
      let toStr = restStr;
      const lblM = restStr.match(/^\|([^|]*)\|\s*(.*)/);
      if (lblM) { edgeLabel = lblM[1].trim() || undefined; toStr = lblM[2].trim(); }

      const fromTok = parseNodeToken(fromStr);
      const toTok   = parseNodeToken(toStr);

      if (fromTok) setNode(fromTok.id, fromTok.label);
      if (toTok)   setNode(toTok.id,   toTok.label);
      if (fromTok && toTok) rawEdges.push({ source: fromTok.id, target: toTok.id, label: edgeLabel });
      continue;
    }

    const nodeTok = parseNodeToken(line);
    if (nodeTok) setNode(nodeTok.id, nodeTok.label);
  }

  const nodeIds = Array.from(nodeMap.keys());
  const positions = dagreLayout(nodeIds, rawEdges);

  const nodes: Node[] = nodeIds.map(id => ({
    id,
    type: 'default',
    position: positions.get(id) ?? { x: 0, y: 0 },
    data: { label: nodeMap.get(id) ?? id },
  }));

  const edges: Edge[] = rawEdges.map((e, i) => ({
    id: `e${i}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    label: e.label ?? '',
    type: 'step',
    labelBgPadding: [6, 4] as [number, number],
    labelBgBorderRadius: 4,
    labelBgStyle: { fill: '#0f1419', fillOpacity: 1, stroke: '#2d3a4d', strokeWidth: 1 },
    labelStyle: { fill: '#8b9cb3', fontSize: 11 },
  }));

  return { nodes, edges };
}

/* ── 재레이아웃 ── */
export function reLayoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const rawEdges = edges.map(e => ({ source: e.source, target: e.target }));
  const positions = dagreLayout(nodes.map(n => n.id), rawEdges);
  return nodes.map(n => ({ ...n, position: positions.get(n.id) ?? n.position }));
}
