import * as Dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

/* ── Helpers ── */

function parseNodeToken(token: string): { id: string; label: string } | null {
  const t = token.trim();
  if (!t) return null;
  let m: RegExpMatchArray | null;

  // ID([label]) – stadium
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\(\[(.+)\]\)$/);
  if (m) return { id: m[1], label: m[2] };

  // ID((label)) – circle
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\(\((.+)\)\)$/);
  if (m) return { id: m[1], label: m[2] };

  // ID[label] – rectangle
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\[(.+)\]$/);
  if (m) return { id: m[1], label: m[2] };

  // ID(label) – rounded
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\((.+)\)$/);
  if (m) return { id: m[1], label: m[2] };

  // ID{label} – diamond
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\{(.+)\}$/);
  if (m) return { id: m[1], label: m[2] };

  // bare ID
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)$/);
  if (m) return { id: m[1], label: m[1] };

  return null;
}

interface RawEdge {
  source: string;
  target: string;
  label?: string;
}

/* ── Dagre auto-layout ── */

const NODE_W = 200;
const NODE_H = 56;

export function dagreLayout(
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

/* ── Main parse function ── */

export function parseMermaidToFlow(src: string): { nodes: Node[]; edges: Edge[] } {
  const nodeMap = new Map<string, string>(); // id → label
  const rawEdges: RawEdge[] = [];

  for (const rawLine of src.split('\n')) {
    const line = rawLine.replace(/;$/, '').trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^(?:flowchart|graph)\s/i.test(line)) continue;
    if (/^subgraph\b/i.test(line) || /^end$/i.test(line)) continue;

    // Find arrow (-->  ---  -.->) inside the line
    const arrowMatch = line.match(/-{2,}>|---/);
    if (!arrowMatch || arrowMatch.index == null) {
      const n = parseNodeToken(line);
      if (n) nodeMap.set(n.id, n.label);
      continue;
    }

    const arrowIdx = arrowMatch.index;
    const fromStr = line.slice(0, arrowIdx).trim();
    const restStr = line.slice(arrowIdx + arrowMatch[0].length).trim();

    // Extract optional edge label: |label| toStr
    let edgeLabel: string | undefined;
    let toStr = restStr;
    const labelMatch = restStr.match(/^\|([^|]*)\|\s*(.*)/);
    if (labelMatch) {
      edgeLabel = labelMatch[1].trim() || undefined;
      toStr = labelMatch[2].trim();
    }

    const fromNode = parseNodeToken(fromStr);
    const toNode = parseNodeToken(toStr);

    // 레이블이 있는 정의(A[이름])는 항상 반영, 레이블 없는 단순 ID(A)는 이미 등록된 이름을 덮어쓰지 않음
    if (fromNode) {
      if (!nodeMap.has(fromNode.id) || fromNode.label !== fromNode.id) {
        nodeMap.set(fromNode.id, fromNode.label);
      }
    }
    if (toNode) {
      if (!nodeMap.has(toNode.id) || toNode.label !== toNode.id) {
        nodeMap.set(toNode.id, toNode.label);
      }
    }

    if (fromNode && toNode) {
      rawEdges.push({ source: fromNode.id, target: toNode.id, label: edgeLabel });
    }
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
    animated: false,
  }));

  return { nodes, edges };
}

/* ── Re-layout existing React Flow nodes ── */

export function reLayoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const rawEdges = edges.map(e => ({ source: e.source, target: e.target }));
  const positions = dagreLayout(nodes.map(n => n.id), rawEdges);
  return nodes.map(n => ({ ...n, position: positions.get(n.id) ?? n.position }));
}
