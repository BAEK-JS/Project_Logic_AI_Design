import * as Dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';
import {
  LANE_DEFS,
  LANE_ID_SET,
  LANE_H,
  LANE_W,
  LANE_X,
  LANE_LABEL_W,
  laneTopY,
  guessLane,
} from './laneDefs';

/* ── 노드 토큰 파싱 ── */
function parseNodeToken(token: string): { id: string; label: string } | null {
  const t = token.trim();
  if (!t) return null;
  let m: RegExpMatchArray | null;

  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\(\[(.+)\]\)$/);   if (m) return { id: m[1], label: m[2] };
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\(\((.+)\)\)$/);   if (m) return { id: m[1], label: m[2] };
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\[(.+)\]$/);        if (m) return { id: m[1], label: m[2] };
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\((.+)\)$/);        if (m) return { id: m[1], label: m[2] };
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\{(.+)\}$/);        if (m) return { id: m[1], label: m[2] };
  m = t.match(/^([A-Za-z][A-Za-z0-9_]*)$/);                if (m) return { id: m[1], label: m[1] };
  return null;
}

interface RawEdge { source: string; target: string; label?: string; }
interface NodeInfo  { label: string; laneId: string; }

/* ── 레인 배경 노드 생성 ── */
function createLaneBackgroundNodes(): Node[] {
  return LANE_DEFS.map((lane, i) => ({
    id: lane.id,
    type: 'lane',
    position: { x: LANE_X, y: laneTopY(i) },
    data: {
      label: lane.label,
      bgColor: lane.bgColor,
      textColor: lane.textColor,
      borderColor: lane.borderColor,
    },
    style: { width: LANE_W, height: LANE_H },
    selectable: false,
    draggable: false,
    focusable: false,
    connectable: false,
    deletable: false,
  }));
}

/* ── 레인별 Dagre 레이아웃 ── */
function layoutInLanes(
  nodeIds: string[],
  nodeInfo: Map<string, NodeInfo>,
  edges: RawEdge[],
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  const NODE_W = 200, NODE_H = 56;

  // 레인별 그룹화
  const byLane = new Map<string, string[]>();
  LANE_DEFS.forEach(l => byLane.set(l.id, []));
  for (const id of nodeIds) {
    const lid = nodeInfo.get(id)?.laneId ?? 'lane-main';
    const validLid = LANE_ID_SET.has(lid) ? lid : 'lane-main';
    byLane.get(validLid)!.push(id);
  }

  LANE_DEFS.forEach((lane, laneIdx) => {
    const ids = byLane.get(lane.id) ?? [];
    if (!ids.length) return;

    const laneEdges = edges.filter(e => ids.includes(e.source) && ids.includes(e.target));

    const g = new (Dagre as unknown as typeof import('@dagrejs/dagre')).graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'LR', ranksep: 60, nodesep: 50 });

    ids.forEach(id => g.setNode(id, { width: NODE_W, height: NODE_H }));
    laneEdges.forEach(e => {
      if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
    });
    (Dagre as unknown as typeof import('@dagrejs/dagre')).layout(g);

    const topY = laneTopY(laneIdx);
    const padX = LANE_LABEL_W + 20;
    const padY = (LANE_H - NODE_H) / 2;

    ids.forEach(id => {
      const pos = g.node(id);
      if (pos) {
        result.set(id, {
          x: padX + pos.x - NODE_W / 2,
          y: topY + padY + (pos.y - NODE_H / 2),
        });
      } else {
        const fallbackIdx = ids.indexOf(id);
        result.set(id, {
          x: padX + fallbackIdx * (NODE_W + 50),
          y: topY + padY,
        });
      }
    });
  });

  return result;
}

/* ── 메인 파서 ── */
export function parseMermaidToFlow(src: string): { nodes: Node[]; edges: Edge[] } {
  const nodeInfo = new Map<string, NodeInfo>();
  const rawEdges: RawEdge[] = [];

  let currentLaneId: string | null = null; // subgraph 섹션 중일 때 레인 ID

  const setNode = (id: string, label: string, laneIdHint?: string) => {
    if (!nodeInfo.has(id) || label !== id) {
      // 더 구체적인 레이블이 있을 때만 업데이트
      if (!nodeInfo.has(id) || (label !== id && nodeInfo.get(id)!.label === id)) {
        nodeInfo.set(id, { label, laneId: laneIdHint ?? currentLaneId ?? 'lane-main' });
      }
    }
  };

  for (const rawLine of src.split('\n')) {
    const line = rawLine.replace(/;$/, '').trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^(?:flowchart|graph)\s/i.test(line)) continue;

    // subgraph 시작: subgraph ID[레이블] 또는 subgraph 레이블
    const sgMatch =
      line.match(/^subgraph\s+(\S+)\s*\[(.+)\]$/i) ||
      line.match(/^subgraph\s+(.+)$/i);
    if (sgMatch) {
      const sgLabel = (sgMatch[2] ?? sgMatch[1]).trim();
      const matched = LANE_DEFS.find(l =>
        sgLabel === l.label ||
        sgLabel.replace(/\s/g, '') === l.label.replace(/\s/g, '') ||
        sgLabel.includes(l.label) ||
        l.label.includes(sgLabel),
      );
      currentLaneId = matched?.id ?? 'lane-main';
      continue;
    }

    if (/^end$/i.test(line)) {
      currentLaneId = null;
      continue;
    }

    // 화살표 파싱
    const arrowMatch = line.match(/-{2,}>|---/);
    if (arrowMatch && arrowMatch.index != null) {
      const fromStr = line.slice(0, arrowMatch.index).trim();
      const restStr = line.slice(arrowMatch.index + arrowMatch[0].length).trim();

      let edgeLabel: string | undefined;
      let toStr = restStr;
      const lblM = restStr.match(/^\|([^|]*)\|\s*(.*)/);
      if (lblM) { edgeLabel = lblM[1].trim() || undefined; toStr = lblM[2].trim(); }

      const fromTok = parseNodeToken(fromStr);
      const toTok = parseNodeToken(toStr);

      if (fromTok) setNode(fromTok.id, fromTok.label);
      if (toTok)   setNode(toTok.id,   toTok.label);
      if (fromTok && toTok) rawEdges.push({ source: fromTok.id, target: toTok.id, label: edgeLabel });
      continue;
    }

    // 단독 노드 정의
    const nodeTok = parseNodeToken(line);
    if (nodeTok) setNode(nodeTok.id, nodeTok.label);
  }

  // subgraph 없는 경우: 키워드 기반 레인 자동 추정
  const hasSrcSet = new Set(rawEdges.map(e => e.source));
  const hasTgtSet = new Set(rawEdges.map(e => e.target));
  const allIds = Array.from(nodeInfo.keys());

  for (const id of allIds) {
    const info = nodeInfo.get(id)!;
    if (info.laneId === 'lane-main' && currentLaneId === null) {
      // subgraph가 전혀 없었던 경우에만 재추정
    }
    const isFirst = !hasTgtSet.has(id);
    const isLast = !hasSrcSet.has(id);
    if (!LANE_ID_SET.has(info.laneId) || info.laneId === 'lane-main') {
      // 더 명확한 레인이 없을 때 추정
      const guessed = guessLane(id, info.label, isFirst, isLast);
      if (guessed !== 'lane-main' || info.laneId === 'lane-main') {
        nodeInfo.set(id, { ...info, laneId: guessed });
      }
    }
  }

  const positions = layoutInLanes(allIds, nodeInfo, rawEdges);
  const laneNodes = createLaneBackgroundNodes();

  const contentNodes: Node[] = allIds.map(id => ({
    id,
    type: 'default',
    position: positions.get(id) ?? { x: LANE_LABEL_W + 20, y: laneTopY(2) + 70 },
    data: {
      label: nodeInfo.get(id)!.label,
      laneId: nodeInfo.get(id)!.laneId,
    },
  }));

  const edges: Edge[] = rawEdges.map((e, i) => ({
    id: `e${i}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    label: e.label ?? '',
    type: 'step',
  }));

  return { nodes: [...laneNodes, ...contentNodes], edges };
}

/* ── 재레이아웃 (자동 정렬 버튼용) ── */
export function reLayoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const laneNodes = nodes.filter(n => LANE_ID_SET.has(n.id));
  const contentNodes = nodes.filter(n => !LANE_ID_SET.has(n.id));

  const nodeInfo = new Map<string, NodeInfo>();
  contentNodes.forEach(n => {
    nodeInfo.set(n.id, {
      label: String(n.data?.label ?? n.id),
      laneId: String(n.data?.laneId ?? 'lane-main'),
    });
  });

  const rawEdges = edges
    .filter(e => !LANE_ID_SET.has(e.source) && !LANE_ID_SET.has(e.target))
    .map(e => ({ source: e.source, target: e.target }));

  const positions = layoutInLanes(contentNodes.map(n => n.id), nodeInfo, rawEdges);

  return [
    ...laneNodes,
    ...contentNodes.map(n => ({ ...n, position: positions.get(n.id) ?? n.position })),
  ];
}
