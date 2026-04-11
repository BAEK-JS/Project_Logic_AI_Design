import type { Node, Edge } from '@xyflow/react';
import { LANE_DEFS, LANE_ID_SET } from './laneDefs';

export function nodesToMermaid(nodes: Node[], edges: Edge[]): string {
  const lines = ['flowchart TD'];

  // 레인 배경 노드 제외, 일반 콘텐츠 노드만
  const contentNodes = nodes.filter(n => !LANE_ID_SET.has(n.id));
  const laneEdges = new Set([...edges.map(e => e.source), ...edges.map(e => e.target)].filter(id => LANE_ID_SET.has(id)));

  // 레인별 그룹화
  const byLane = new Map<string, Node[]>();
  LANE_DEFS.forEach(l => byLane.set(l.id, []));
  const ungrouped: Node[] = [];

  for (const node of contentNodes) {
    const lid = String(node.data?.laneId ?? '');
    if (LANE_ID_SET.has(lid)) {
      byLane.get(lid)!.push(node);
    } else {
      ungrouped.push(node);
    }
  }

  // 각 레인을 subgraph로 출력
  for (const lane of LANE_DEFS) {
    const laneNodes = byLane.get(lane.id) ?? [];
    if (!laneNodes.length) continue;
    lines.push(`  subgraph ${lane.id}[${lane.label}]`);
    for (const node of laneNodes) {
      const label = String(node.data?.label ?? node.id).replace(/"/g, "'");
      lines.push(`    ${node.id}["${label}"]`);
    }
    lines.push('  end');
  }

  // 레인 없는 노드
  for (const node of ungrouped) {
    const label = String(node.data?.label ?? node.id).replace(/"/g, "'");
    lines.push(`  ${node.id}["${label}"]`);
  }

  // 엣지 (레인 노드 연결 제외)
  for (const edge of edges) {
    if (laneEdges.has(edge.source) || laneEdges.has(edge.target)) continue;
    const lbl = typeof edge.label === 'string' ? edge.label.trim() : '';
    if (lbl) {
      lines.push(`  ${edge.source} -->|${lbl}| ${edge.target}`);
    } else {
      lines.push(`  ${edge.source} --> ${edge.target}`);
    }
  }

  return lines.join('\n');
}
