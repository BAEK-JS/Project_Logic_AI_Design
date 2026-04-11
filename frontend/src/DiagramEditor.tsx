import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import { nodesToMermaid } from './flowToMermaid';
import { reLayoutNodes } from './mermaidParser';
import {
  LANE_DEFS,
  LANE_ID_SET,
  LANE_H,
  LANE_LABEL_W,
  getLaneIndex,
  laneTopY,
} from './laneDefs';

/* ─────────────────────────────────────────
   Public handle
───────────────────────────────────────── */
export interface DiagramHandle {
  addNode: (id: string, label: string, laneId?: string) => void;
  getMermaid: () => string;
}

/* ─────────────────────────────────────────
   레인 배경 노드 (클릭/드래그 불가)
───────────────────────────────────────── */
function LaneNode({ data }: NodeProps) {
  const bgColor = String(data?.bgColor ?? 'transparent');
  const textColor = String(data?.textColor ?? '#fff');
  const borderColor = String(data?.borderColor ?? '#333');
  const label = String(data?.label ?? '');

  return (
    <div
      className="rf-lane-node"
      style={{ background: bgColor, borderBottom: `${LANE_GAP}px solid ${borderColor}` }}
    >
      <div className="rf-lane-label" style={{ color: textColor }}>
        {label}
      </div>
    </div>
  );
}
const LANE_GAP = 3;

/* ─────────────────────────────────────────
   커스텀 편집 노드
───────────────────────────────────────── */
function EditableNode({ id, data, selected }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const label = String(data?.label ?? id);

  // 레인 색상
  const laneId = String(data?.laneId ?? 'lane-main');
  const laneDef = LANE_DEFS.find(l => l.id === laneId);
  const accentColor = laneDef?.textColor ?? '#3d8bfd';

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = useCallback(
    (val: string) => {
      setEditing(false);
      const next = val.trim();
      if (next) updateNodeData(id, { label: next });
    },
    [id, updateNodeData],
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      deleteElements({ nodes: [{ id }] });
    },
    [id, deleteElements],
  );

  return (
    <div
      className={`rf-node${selected ? ' rf-node--selected' : ''}`}
      style={{ borderColor: selected ? accentColor : undefined }}
    >
      <Handle type="target" position={Position.Top} />
      <div
        className="rf-node-lane-bar"
        style={{ background: accentColor + '28', borderBottom: `2px solid ${accentColor}44` }}
      />
      <button className="rf-node-del nodrag nopan" type="button" title="노드 삭제" onClick={handleDelete}>
        ✕
      </button>
      {editing ? (
        <input
          ref={inputRef}
          className="rf-node-input nodrag nopan"
          defaultValue={label}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <div className="rf-node-label" onDoubleClick={() => setEditing(true)} title="더블클릭: 이름 편집">
          {label}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

// nodeTypes는 컴포넌트 외부에서 안정적으로 정의
const NODE_TYPES = { default: EditableNode, lane: LaneNode };

/* ─────────────────────────────────────────
   Inner component (ReactFlow context 보유)
───────────────────────────────────────── */
interface InnerProps {
  defaultNodes: Node[];
  defaultEdges: Edge[];
  handleRef: React.MutableRefObject<DiagramHandle | null>;
  activeNodeId?: string | null;
  onNodeClick?: (id: string) => void;
  onAddBlock?: (id: string, label: string) => void;
  onNodesDelete?: (ids: string[]) => void;
}

function DiagramEditorInner({
  defaultNodes,
  defaultEdges,
  handleRef,
  activeNodeId,
  onNodeClick,
  onAddBlock,
  onNodesDelete,
}: InnerProps) {
  const { addNodes, getNodes, getEdges, setNodes, fitView } = useReactFlow();
  const [selectedLane, setSelectedLane] = useState('lane-main');

  const rfRef = useRef({ addNodes, getNodes, getEdges, setNodes, fitView });
  useEffect(() => { rfRef.current = { addNodes, getNodes, getEdges, setNodes, fitView }; });

  /* Imperative handle */
  useEffect(() => {
    handleRef.current = {
      addNode: (id: string, label: string, laneId?: string) => {
        const resolved = laneId ?? 'lane-main';
        const idx = getLaneIndex(resolved);
        const topY = laneTopY(idx >= 0 ? idx : 2);
        const existing = rfRef.current.getNodes().filter(n => n.data?.laneId === resolved);
        const maxX = existing.length
          ? Math.max(...existing.map(n => n.position.x)) + 240
          : LANE_LABEL_W + 20;
        rfRef.current.addNodes({
          id,
          type: 'default',
          position: { x: maxX, y: topY + (LANE_H - 56) / 2 },
          data: { label, laneId: resolved },
        });
      },
      getMermaid: () =>
        nodesToMermaid(rfRef.current.getNodes() as Node[], rfRef.current.getEdges() as Edge[]),
    };
  }, [handleRef]);

  /* 활성 노드 강조 */
  useEffect(() => {
    setNodes(nds =>
      nds.map(n => ({ ...n, className: n.id === activeNodeId ? 'node-active' : '' })),
    );
  }, [activeNodeId, setNodes]);

  /* 툴바: 노드 추가 */
  const handleAddNode = () => {
    const id = 'N' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const label = '새 노드 ' + id;
    const idx = getLaneIndex(selectedLane);
    const topY = laneTopY(idx >= 0 ? idx : 2);
    const existing = getNodes().filter(n => n.data?.laneId === selectedLane);
    const maxX = existing.length
      ? Math.max(...existing.map(n => n.position.x)) + 240
      : LANE_LABEL_W + 20;

    addNodes({
      id,
      type: 'default',
      position: { x: maxX, y: topY + (LANE_H - 56) / 2 },
      data: { label, laneId: selectedLane },
    });
    onAddBlock?.(id, label);
  };

  /* 자동 정렬 */
  const handleAutoLayout = () => {
    const relaid = reLayoutNodes(getNodes() as Node[], getEdges() as Edge[]);
    setNodes(relaid as Node[]);
    setTimeout(() => fitView({ duration: 400 }), 50);
  };

  return (
    <>
      <div className="rf-toolbar">
        <select
          className="rf-lane-select"
          value={selectedLane}
          onChange={e => setSelectedLane(e.target.value)}
          title="추가할 구간 선택"
        >
          {LANE_DEFS.map(l => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
        <button type="button" className="secondary" onClick={handleAddNode}>＋ 노드 추가</button>
        <button type="button" className="secondary" onClick={handleAutoLayout}>자동 정렬</button>
        <span className="rf-hint">더블클릭: 이름편집 · Delete: 삭제 · 연결점 드래그: 엣지 추가</span>
      </div>
      <div className="rf-canvas-wrap">
        <ReactFlow
          defaultNodes={defaultNodes}
          defaultEdges={defaultEdges}
          defaultEdgeOptions={{ type: 'step', animated: false }}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_, node) => {
            if (!LANE_ID_SET.has(node.id)) onNodeClick?.(node.id);
          }}
          onNodesDelete={deleted => {
            const ids = deleted.map(n => n.id).filter(id => !LANE_ID_SET.has(id));
            if (ids.length) onNodesDelete?.(ids);
          }}
          colorMode="dark"
          deleteKeyCode="Delete"
          fitView
          proOptions={{ hideAttribution: true }}
          style={{ width: '100%', height: '100%' }}
        >
          <Background />
          <Controls />
          <MiniMap nodeStrokeWidth={3} />
        </ReactFlow>
      </div>
    </>
  );
}

/* ─────────────────────────────────────────
   Public component
───────────────────────────────────────── */
export interface DiagramEditorProps {
  defaultNodes: Node[];
  defaultEdges: Edge[];
  editorRef: React.MutableRefObject<DiagramHandle | null>;
  activeNodeId?: string | null;
  onNodeClick?: (id: string) => void;
  onAddBlock?: (id: string, label: string) => void;
  onNodesDelete?: (ids: string[]) => void;
}

export function DiagramEditor(props: DiagramEditorProps) {
  return (
    <div className="diagram-editor-outer">
      <ReactFlowProvider>
        <DiagramEditorInner
          defaultNodes={props.defaultNodes}
          defaultEdges={props.defaultEdges}
          handleRef={props.editorRef}
          activeNodeId={props.activeNodeId}
          onNodeClick={props.onNodeClick}
          onAddBlock={props.onAddBlock}
          onNodesDelete={props.onNodesDelete}
        />
      </ReactFlowProvider>
    </div>
  );
}
