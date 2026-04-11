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

/* ─────────────────────────────────────────
   Public handle
───────────────────────────────────────── */
export interface DiagramHandle {
  addNode: (id: string, label: string) => void;
  getMermaid: () => string;
}

/* ─────────────────────────────────────────
   커스텀 편집 노드
───────────────────────────────────────── */
function EditableNode({ id, data, selected }: NodeProps) {
  const { updateNodeData, deleteElements } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const label = String(data?.label ?? id);

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
    <div className={`rf-node${selected ? ' rf-node--selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
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
        <div
          className="rf-node-label"
          onDoubleClick={() => setEditing(true)}
          title="더블클릭: 이름 편집"
        >
          {label}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const NODE_TYPES = { default: EditableNode };

/* ─────────────────────────────────────────
   Inner component
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
  const canvasRef = useRef<HTMLDivElement>(null);

  const rfRef = useRef({ addNodes, getNodes, getEdges, setNodes, fitView });
  useEffect(() => { rfRef.current = { addNodes, getNodes, getEdges, setNodes, fitView }; });

  /* 컨테이너 크기가 바뀔 때마다 fitView 재실행 (채팅 패널 등 레이아웃 변화 대응) */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      rfRef.current.fitView({ duration: 250, padding: 0.12 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Imperative handle */
  useEffect(() => {
    handleRef.current = {
      addNode: (id: string, label: string) => {
        const existing = rfRef.current.getNodes();
        const maxY = existing.length ? Math.max(...existing.map(n => n.position.y)) + 110 : 80;
        rfRef.current.addNodes({
          id,
          type: 'default',
          position: { x: 80 + Math.random() * 240, y: maxY },
          data: { label },
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

  const handleAddNode = () => {
    const id = 'N' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const label = '새 노드 ' + id;
    const existing = getNodes();
    const maxY = existing.length ? Math.max(...existing.map(n => n.position.y)) + 110 : 80;
    addNodes({ id, type: 'default', position: { x: 80 + Math.random() * 240, y: maxY }, data: { label } });
    onAddBlock?.(id, label);
  };

  const handleAutoLayout = () => {
    const relaid = reLayoutNodes(getNodes() as Node[], getEdges() as Edge[]);
    setNodes(relaid as Node[]);
    setTimeout(() => fitView({ duration: 400, padding: 0.12 }), 50);
  };

  return (
    <>
      <div className="rf-toolbar">
        <button type="button" className="secondary" onClick={handleAddNode}>＋ 노드 추가</button>
        <button type="button" className="secondary" onClick={handleAutoLayout}>자동 정렬</button>
        <span className="rf-hint">더블클릭: 이름편집 · Delete: 삭제 · 연결점 드래그: 엣지 추가</span>
      </div>
      <div className="rf-canvas-wrap" ref={canvasRef}>
        <ReactFlow
          defaultNodes={defaultNodes}
          defaultEdges={defaultEdges}
          defaultEdgeOptions={{
            type: 'step',
            animated: false,
            labelBgPadding: [6, 4],
            labelBgBorderRadius: 4,
            labelBgStyle: { fill: '#0f1419', fillOpacity: 1, stroke: '#2d3a4d', strokeWidth: 1 },
            labelStyle: { fill: '#8b9cb3', fontSize: 11 },
          }}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_, node) => onNodeClick?.(node.id)}
          onNodesDelete={deleted => onNodesDelete?.(deleted.map(n => n.id))}
          colorMode="dark"
          deleteKeyCode="Delete"
          onInit={inst => {
            /* DOM 레이아웃이 완전히 정착한 뒤 fitView 실행 */
            requestAnimationFrame(() => {
              setTimeout(() => inst.fitView({ duration: 300, padding: 0.12 }), 80);
            });
          }}
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
