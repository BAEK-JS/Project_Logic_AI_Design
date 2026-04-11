import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { CodeLang, LogicBlock } from "./types";
import type { Node, Edge } from "@xyflow/react";
import { DiagramEditor, type DiagramHandle } from "./DiagramEditor";
import { parseMermaidToFlow } from "./mermaidParser";

/* ───────────── 유틸 ───────────── */
function randomId() {
  return "N" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function parseAiJson(raw: string) {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  const obj = JSON.parse(s) as { summary?: string; mermaid?: unknown; blocks?: unknown };
  if (!obj.mermaid || !Array.isArray(obj.blocks)) {
    throw new Error("JSON에 mermaid 또는 blocks 배열이 없습니다.");
  }
  return obj as { summary?: string; mermaid: string; blocks: LogicBlock[] };
}

function normalizeBlocks(blocks: LogicBlock[]): LogicBlock[] {
  return blocks.map((b) => ({
    id: String(b.id || "").trim() || randomId(),
    title: (b as LogicBlock).title || (b as { label?: string }).label || "블록",
    description: b.description || "",
    code: typeof b.code === "string" ? b.code : "",
  }));
}

function codePlaceholder(lang: CodeLang) {
  if (lang === "c") return "/* 이 구간 예시 코드 (C) */";
  if (lang === "python") return "# 이 구간 예시 코드 (Python)";
  return "// 이 구간 예시 코드 (Java)";
}

/* ───────────── BlockCard ───────────── */
interface BlockCardProps {
  block: LogicBlock;
  index: number;
  active: boolean;
  lang: CodeLang;
  detailsRef: (el: HTMLDetailsElement | null) => void;
  onChange: (field: "title" | "description" | "code", value: string) => void;
  onDelete: () => void;
}

function BlockCard({ block, index, active, lang, detailsRef, onChange, onDelete }: BlockCardProps) {
  return (
    <details
      ref={detailsRef}
      className={`block-card${active ? " active" : ""}`}
      open={index < 4}
      data-block-id={block.id}
    >
      <summary>
        <div className="block-summary-left">
          <input
            className="block-title-input"
            value={block.title}
            onChange={(e) => onChange("title", e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="블록 제목"
          />
          <span className="block-id">{block.id}</span>
        </div>
        <button
          className="block-delete"
          type="button"
          title="블록 삭제"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
        >
          ✕
        </button>
      </summary>
      <div className="block-body">
        <input
          className="block-desc-input"
          value={block.description}
          onChange={(e) => onChange("description", e.target.value)}
          placeholder="이 구간 설명 (선택)"
        />
        <textarea
          className="block-code"
          placeholder={codePlaceholder(lang)}
          value={block.code}
          onChange={(e) => onChange("code", e.target.value)}
        />
      </div>
    </details>
  );
}

/* ───────────── App ───────────── */
export default function App() {
  const [requirements, setRequirements] = useState("");

  /* 다이어그램 상태 */
  const [rfInitNodes, setRfInitNodes] = useState<Node[]>([]);
  const [rfInitEdges, setRfInitEdges] = useState<Edge[]>([]);
  const [diagramKey, setDiagramKey] = useState(0);
  const [mermaidImportText, setMermaidImportText] = useState("");

  const [blocks, setBlocks] = useState<LogicBlock[]>([]);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [lang, setLang] = useState<CodeLang>(() => {
    const s = localStorage.getItem("logic-map-lang");
    if (s === "c" || s === "java" || s === "python") return s;
    return "java";
  });
  const [apiKey, setApiKey] = useState("");
  const [jsonPaste, setJsonPaste] = useState("");
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"ok" | "err" | "">("");
  const [errorDetail, setErrorDetail] = useState("");
  const [loadingGen, setLoadingGen] = useState(false);
  const [loadingFill, setLoadingFill] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const blockRefs = useRef<Map<string, HTMLDetailsElement>>(new Map());
  const diagramRef = useRef<DiagramHandle | null>(null);

  /* lang 저장 */
  useEffect(() => { localStorage.setItem("logic-map-lang", lang); }, [lang]);

  const setErr = (msg: string, detail?: string) => {
    setStatus(msg); setStatusType("err"); setErrorDetail(detail ?? msg);
  };
  const setOk = (msg: string) => {
    setStatus(msg); setStatusType("ok"); setErrorDetail("");
  };

  /* Mermaid 텍스트 → 다이어그램 적용 */
  const applyMermaid = useCallback((mermaidText: string) => {
    const trimmed = mermaidText.trim();
    setMermaidImportText(trimmed);
    if (!trimmed) return;
    const { nodes, edges } = parseMermaidToFlow(trimmed);
    setRfInitNodes(nodes);
    setRfInitEdges(edges);
    setDiagramKey((k) => k + 1);
  }, []);

  /* 노드 클릭 → 블록 스크롤 */
  const handleNodeClick = useCallback((nodeId: string) => {
    setActiveBlockId(nodeId);
    const el = blockRefs.current.get(nodeId);
    if (el) {
      el.open = true;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setTimeout(() => setActiveBlockId(null), 1500);
  }, []);

  /* 블록 ref 등록 */
  const setBlockRef = useCallback(
    (id: string) => (el: HTMLDetailsElement | null) => {
      if (el) blockRefs.current.set(id, el);
      else blockRefs.current.delete(id);
    },
    [],
  );

  const updateBlock = useCallback(
    (index: number, field: "title" | "description" | "code", value: string) => {
      setBlocks((prev) => prev.map((b, i) => (i === index ? { ...b, [field]: value } : b)));
    },
    [],
  );

  const deleteBlock = useCallback((index: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /* 빈 블록 추가 → 다이어그램 노드도 추가 */
  const addEmptyBlock = () => {
    const id = randomId();
    const label = "새 구간 " + id;
    setBlocks((prev) => [...prev, { id, title: label, description: "", code: "" }]);
    diagramRef.current?.addNode(id, label);
    setTimeout(() => {
      const last = document.querySelector(".blocks .block-card:last-child");
      last?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  };

  /* 다이어그램의 "+ 노드 추가" 버튼 → 블록 추가 */
  const onAddBlockFromDiagram = useCallback((id: string, label: string) => {
    setBlocks((prev) => {
      if (prev.some((b) => b.id === id)) return prev;
      return [...prev, { id, title: label, description: "", code: "" }];
    });
  }, []);

  /* 다이어그램에서 노드 삭제 → 대응 블록도 삭제 */
  const onNodesDeleteFromDiagram = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setBlocks((prev) => prev.filter((b) => !idSet.has(b.id)));
  }, []);

  /* Mermaid 가져오기 적용 */
  const onApplyMermaidImport = () => {
    try {
      applyMermaid(mermaidImportText);
      setOk("다이어그램에 적용했습니다.");
    } catch (e) {
      setErr("파싱 실패: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  /* AI 생성 */
  const onGenerate = async () => {
    const req = requirements.trim();
    if (!req) { setErr("요건 문서를 입력하세요."); return; }
    if (!apiKey.trim()) { setErr("OpenAI API 키를 입력하세요."); return; }
    setLoadingGen(true); setErrorDetail(""); setStatus("백엔드(Python)에서 OpenAI 호출 중…"); setStatusType("");
    try {
      const data = await api.generateDiagram(req, lang, apiKey);
      applyMermaid(data.mermaid || "");
      setBlocks(normalizeBlocks(data.blocks));
      setOk(
        data.summary
          ? "[OpenAI] 요약: " + data.summary.slice(0, 200) + (data.summary.length > 200 ? "…" : "")
          : "[OpenAI] 반영 완료",
      );
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(m, m);
    } finally { setLoadingGen(false); }
  };

  /* 프롬프트 복사 */
  const onCopyPrompt = async () => {
    try {
      const text = await api.fetchPromptText(requirements.trim(), lang);
      await navigator.clipboard.writeText(text);
      setOk("프롬프트를 복사했습니다.");
    } catch (e) {
      setErr("복사 실패: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  /* JSON 반영 */
  const onApplyJson = () => {
    try {
      const obj = parseAiJson(jsonPaste.trim());
      applyMermaid(obj.mermaid || "");
      setBlocks(normalizeBlocks(obj.blocks));
      setOk(obj.summary ? "요약: " + obj.summary.slice(0, 200) : "반영 완료");
    } catch (e) {
      setErr("JSON 파싱 실패: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  /* 예시 코드 채우기 */
  const onFillCodes = async () => {
    if (!apiKey.trim()) { setErr("OpenAI API 키를 입력하세요."); return; }
    if (!blocks.length) { setErr("먼저 블록을 만드세요."); return; }
    setLoadingFill(true); setErrorDetail(""); setStatus("예시 코드 생성 중…"); setStatusType("");
    try {
      const currentMermaid = diagramRef.current?.getMermaid() ?? mermaidImportText;
      const meta = blocks.map(({ id, title, description }) => ({ id, title, description }));
      const filled = await api.fillBlockCodes(requirements, currentMermaid, meta, lang, apiKey);
      const byId: Record<string, string> = {};
      filled.forEach((b) => { byId[String(b.id)] = b.code ?? ""; });
      setBlocks((prev) =>
        prev.map((b) =>
          Object.prototype.hasOwnProperty.call(byId, b.id) ? { ...b, code: byId[b.id] } : b,
        ),
      );
      setOk(lang + " 예시 코드 반영 완료");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoadingFill(false); }
  };

  /* 내보내기 */
  const onExport = () => {
    const mermaid = diagramRef.current?.getMermaid() ?? mermaidImportText;
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), exampleLanguage: lang, requirements, mermaid, blocks }, null, 2)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "logic-map-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    setOk("JSON을 저장했습니다.");
  };

  /* 가져오기 */
  const onImportFile = (f: File | null) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const o = JSON.parse(String(r.result)) as {
          requirements?: string; mermaid?: string; blocks?: LogicBlock[]; exampleLanguage?: string;
        };
        if (o.requirements != null) setRequirements(o.requirements);
        if (o.mermaid) applyMermaid(o.mermaid);
        if (o.exampleLanguage === "c" || o.exampleLanguage === "java" || o.exampleLanguage === "python")
          setLang(o.exampleLanguage);
        if (Array.isArray(o.blocks)) setBlocks(normalizeBlocks(o.blocks));
        setOk("가져오기 완료");
      } catch (e) {
        setErr("가져오기 실패: " + (e instanceof Error ? e.message : String(e)));
      }
    };
    r.readAsText(f);
  };

  /* ─── JSX ─── */
  return (
    <>
      <header className="app-header">
        <div>
          <h1>요건 → 로직 맵</h1>
          <p>React + FastAPI · 다이어그램 노드 클릭 → 코드 블록 이동 · 노드 더블클릭 → 이름 편집 · 드래그 이동 · 연결점 드래그 → 엣지 추가</p>
        </div>
        <div className="toolbar">
          <button type="button" className="secondary" onClick={onCopyPrompt}>프롬프트만 복사</button>
          <button type="button" className="secondary" onClick={onExport}>JSON보내기</button>
          <label className="secondary" style={{ padding: "0.45rem 0.9rem", borderRadius: 6, cursor: "pointer" }}>
            가져오기
            <input ref={fileRef} type="file" accept=".json,application/json" hidden
              onChange={(ev) => onImportFile(ev.target.files?.[0] ?? null)} />
          </label>
        </div>
      </header>

      <main className="grid">
        {/* ── 1. 요건 문서 ── */}
        <section className="col">
          <div className="col-head">1. 요건 문서</div>
          <div className="pad">
            <textarea className="req" value={requirements} onChange={(e) => setRequirements(e.target.value)}
              placeholder="증권 업무 요건을 붙여넣으세요." />
            <div className="lang-row">
              <span className="lang-label">예시 코드 언어</span>
              {(["c", "java", "python"] as const).map((v) => (
                <label key={v}>
                  <input type="radio" name="code-lang" checked={lang === v} onChange={() => setLang(v)} />{" "}
                  {v === "c" ? "C" : v === "java" ? "Java" : "Python"}
                </label>
              ))}
            </div>
            <div className="openai-row">
              <div className="field">
                <label className="field-label" htmlFor="api-key">OpenAI API 키</label>
                <input id="api-key" type="text" autoComplete="off" spellCheck={false}
                  placeholder="sk-..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              </div>
              <div className="btn-wrap">
                <button type="button" onClick={onGenerate} disabled={loadingGen}>
                  {loadingGen ? "생성 중…" : "AI로 다이어그램 생성"}
                </button>
              </div>
            </div>
            <p className="hint">
              터미널 1: <code>cd backend &amp;&amp; uvicorn main:app --reload --port 8000</code>{" "}
              · 터미널 2: <code>cd frontend &amp;&amp; npm run dev</code>
            </p>
            <details className="paste-zone">
              <summary>AI 응답 JSON 붙여넣기</summary>
              <textarea value={jsonPaste} onChange={(e) => setJsonPaste(e.target.value)}
                placeholder='{"summary":"...","mermaid":"...","blocks":[...]}' rows={5}
                style={{ marginTop: 8 }} />
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button type="button" className="secondary" onClick={onApplyJson}>응답 반영</button>
                <button type="button" className="secondary" onClick={onFillCodes} disabled={loadingFill}>
                  {loadingFill ? "채우는 중…" : "예시 코드만 채우기(API)"}
                </button>
              </div>
            </details>
            {errorDetail ? (
              <details className="error-panel" open>
                <summary>오류 상세</summary>
                <pre>{errorDetail}</pre>
              </details>
            ) : null}
            <div className={`status ${statusType}`}>{status}</div>
          </div>
        </section>

        {/* ── 2. 다이어그램 편집기 ── */}
        <section className="col">
          <div className="col-head">2. 전체 로직 — 다이어그램 편집</div>
          <div className="pad diagram-pad">
            <details className="mermaid-import-zone">
              <summary>Mermaid 텍스트 가져오기 / 내보내기 ▶</summary>
              <textarea
                className="mermaid-import-textarea"
                value={mermaidImportText}
                onChange={(e) => setMermaidImportText(e.target.value)}
                rows={6}
                placeholder={"flowchart TD\n  A[시작] --> B[처리]"}
              />
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button type="button" onClick={onApplyMermaidImport}>다이어그램에 적용</button>
                <button
                  type="button" className="secondary"
                  onClick={() => {
                    const txt = diagramRef.current?.getMermaid() ?? "";
                    setMermaidImportText(txt);
                  }}
                >
                  현재 다이어그램 → 텍스트
                </button>
              </div>
            </details>
            <DiagramEditor
              key={diagramKey}
              defaultNodes={rfInitNodes}
              defaultEdges={rfInitEdges}
              editorRef={diagramRef}
              activeNodeId={activeBlockId}
              onNodeClick={handleNodeClick}
              onAddBlock={onAddBlockFromDiagram}
              onNodesDelete={onNodesDeleteFromDiagram}
            />
          </div>
        </section>

        {/* ── 3. 구간별 소스코드 ── */}
        <section className="col">
          <div className="col-head">3. 구간별 소스코드</div>
          <div className="pad" style={{ paddingTop: 0 }}>
            <p className="hint" style={{ padding: "0.5rem 0.75rem 0" }}>
              블록 id = Mermaid 노드 id · 제목·설명·코드 모두 직접 편집 가능합니다.
            </p>
            <div className="blocks">
              {blocks.map((b, i) => (
                <BlockCard
                  key={b.id + "-" + i}
                  block={b}
                  index={i}
                  active={activeBlockId === b.id}
                  lang={lang}
                  detailsRef={setBlockRef(b.id)}
                  onChange={(field, value) => updateBlock(i, field, value)}
                  onDelete={() => deleteBlock(i)}
                />
              ))}
            </div>
            <button type="button" className="secondary" style={{ margin: "0.5rem" }} onClick={addEmptyBlock}>
              + 빈 블록 추가 (다이어그램 노드도 자동 추가)
            </button>
          </div>
        </section>
      </main>
    </>
  );
}
