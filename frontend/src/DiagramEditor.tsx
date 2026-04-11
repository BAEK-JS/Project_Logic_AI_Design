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
   Public handle exposed to parent via ref
───────────────────────────────────────── */
export interface DiagramHandle {
  addNode: (id: string, label: string) => void;
  getMermaid: () => string;
}

/* ─────────────────────────────────────────
   Custom editable node
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
      <button
        className="rf-node-del nodrag nopan"
        type="button"
        title="노드 삭제"
        onClick={handleDelete}
      >
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

// nodeTypes must be stable (defined outside component)
const NODE_TYPES = { default: EditableNode };

/* ─────────────────────────────────────────
   Inner component – has ReactFlow context
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

  const rfRef = useRef({ addNodes, getNodes, getEdges, setNodes, fitView });
  useEffect(() => {
    rfRef.current = { addNodes, getNodes, getEdges, setNodes, fitView };
  });

  // Expose imperative handle to parent
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

  // Highlight active node
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
    const nodes = getNodes() as Node[];
    const edges = getEdges() as Edge[];
    const relaid = reLayoutNodes(nodes, edges);
    setNodes(relaid as Node[]);
    setTimeout(() => fitView({ duration: 400 }), 50);
  };

  return (
    <>
      <div className="rf-toolbar">
        <button type="button" className="secondary" onClick={handleAddNode}>
          ＋ 노드 추가
        </button>
        <button type="button" className="secondary" onClick={handleAutoLayout}>
          자동 정렬
        </button>
        <span className="rf-hint">더블클릭: 이름편집 · Delete: 삭제 · 연결점 드래그: 엣지 추가</span>
      </div>
      <div className="rf-canvas-wrap">
        <ReactFlow
          defaultNodes={defaultNodes}
          defaultEdges={defaultEdges}
          defaultEdgeOptions={{ type: 'step', animated: false }}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_, node) => onNodeClick?.(node.id)}
          onNodesDelete={(deleted) => onNodesDelete?.(deleted.map(n => n.id))}
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
