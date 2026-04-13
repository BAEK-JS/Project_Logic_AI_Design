import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { ChatMessage } from "./api";
import type { CodeLang, LogicBlock } from "./types";
import type { Node, Edge } from "@xyflow/react";
import { DiagramEditor, type DiagramHandle } from "./DiagramEditor";
import { parseMermaidToFlow } from "./mermaidParser";

const ACCEPT_EXTS = ".txt,.md,.csv,.pdf,.docx,.xlsx,.log";

function randomId() {
  return "N" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function parseAiJson(raw: string) {
  let s = raw.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const obj = JSON.parse(s) as { summary?: string; mermaid?: unknown; blocks?: unknown };
  if (!obj.mermaid || !Array.isArray(obj.blocks)) throw new Error("JSON에 mermaid 또는 blocks 배열이 없습니다.");
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

/* ─── BlockCard ─── */
interface BlockCardProps {
  block: LogicBlock; index: number; active: boolean; lang: CodeLang;
  detailsRef: (el: HTMLDetailsElement | null) => void;
  onChange: (field: "title" | "description" | "code", value: string) => void;
  onDelete: () => void;
}
function BlockCard({ block, index, active, lang, detailsRef, onChange, onDelete }: BlockCardProps) {
  return (
    <details ref={detailsRef} className={`block-card${active ? " active" : ""}`} open={index === 0} data-block-id={block.id}>
      <summary>
        <div className="block-summary-left">
          <input className="block-title-input" value={block.title}
            onChange={(e) => onChange("title", e.target.value)} onClick={(e) => e.stopPropagation()} placeholder="블록 제목" />
          <span className="block-id">{block.id}</span>
        </div>
        <button className="block-delete" type="button" title="블록 삭제"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}>✕</button>
      </summary>
      <div className="block-body">
        <input className="block-desc-input" value={block.description}
          onChange={(e) => onChange("description", e.target.value)} placeholder="이 구간 설명 (선택)" />
        <textarea className="block-code" placeholder={codePlaceholder(lang)}
          value={block.code} onChange={(e) => onChange("code", e.target.value)} />
      </div>
    </details>
  );
}

/* ─── SettingsModal ─── */
interface SettingsModalProps {
  open: boolean; onClose: () => void;
  apiKey: string; onApiKeyChange: (v: string) => void;
  lang: CodeLang; onLangChange: (v: CodeLang) => void;
}
function SettingsModal({ open, onClose, apiKey, onApiKeyChange, lang, onLangChange }: SettingsModalProps) {
  if (!open) return null;
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span>⚙️ 설정</span>
          <button type="button" className="settings-close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-body">
          <div className="settings-field">
            <label className="settings-label">OpenAI API 키</label>
            <p className="settings-hint">입력하면 브라우저에 저장됩니다. 페이지를 닫아도 유지됩니다.</p>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              style={{ width: "100%" }}
            />
            {apiKey && (
              <p className="settings-saved">✓ API 키 저장됨 ({apiKey.slice(0, 7)}…)</p>
            )}
          </div>
          <div className="settings-field">
            <label className="settings-label">예시 코드 언어</label>
            <div className="settings-lang-row">
              {(["c", "java", "python"] as const).map((v) => (
                <label key={v} className={`settings-lang-btn${lang === v ? " active" : ""}`}>
                  <input type="radio" name="settings-lang" hidden checked={lang === v} onChange={() => onLangChange(v)} />
                  {v === "c" ? "C" : v === "java" ? "Java" : "Python"}
                </label>
              ))}
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-label">백엔드 실행 명령</label>
            <code className="settings-code">cd backend → uvicorn main:app --reload --port 8000</code>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Tauri 백엔드 준비 대기 훅 ─── */
const IS_TAURI_PROD =
  typeof window !== "undefined" &&
  (window.location.protocol === "tauri:" || window.location.protocol === "asset:");

function useBackendReady() {
  const [ready, setReady] = useState(!IS_TAURI_PROD);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!IS_TAURI_PROD) return;
    let cancelled = false;
    const poll = async () => {
      for (let i = 0; i < 40; i++) {
        if (cancelled) return;
        try {
          const res = await fetch("http://127.0.0.1:8000/api/health");
          if (res.ok) { setReady(true); return; }
        } catch {}
        setAttempt(i + 1);
        await new Promise((r) => setTimeout(r, 800));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, []);

  return { ready, attempt };
}

/* ─── App ─── */
type InputMode = "direct" | "file";

export default function App() {
  const { ready: backendReady, attempt: backendAttempt } = useBackendReady();

  /* 설정 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [codeVisible, setCodeVisible] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("logic-map-apikey") ?? "");
  const [lang, setLang] = useState<CodeLang>(() => {
    const s = localStorage.getItem("logic-map-lang");
    return (s === "c" || s === "java" || s === "python") ? s : "java";
  });

  useEffect(() => { localStorage.setItem("logic-map-apikey", apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem("logic-map-lang", lang); }, [lang]);

  /* 입력 모드 */
  const [inputMode, setInputMode] = useState<InputMode>("direct");
  const [directQuery, setDirectQuery] = useState("");
  const [requirements, setRequirements] = useState("");

  /* 파일 업로드 */
  const [uploadedFilename, setUploadedFilename] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [loadingExtract, setLoadingExtract] = useState(false);

  /* 다이어그램 */
  const [rfInitNodes, setRfInitNodes] = useState<Node[]>([]);
  const [rfInitEdges, setRfInitEdges] = useState<Edge[]>([]);
  const [diagramKey, setDiagramKey] = useState(0);
  const [mermaidImportText, setMermaidImportText] = useState("");

  /* 블록 */
  const [blocks, setBlocks] = useState<LogicBlock[]>([]);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  /* 상태 */
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<"ok" | "err" | "">("");
  const [errorDetail, setErrorDetail] = useState("");
  const [loadingGen, setLoadingGen] = useState(false);
  const [loadingFill, setLoadingFill] = useState(false);
  const [jsonPaste, setJsonPaste] = useState("");

  /* 채팅 */
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [loadingChat, setLoadingChat] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const analyzeFileRef = useRef<HTMLInputElement>(null);
  const blockRefs = useRef<Map<string, HTMLDetailsElement>>(new Map());
  const diagramRef = useRef<DiagramHandle | null>(null);

  const diagramHasContent = rfInitNodes.length > 0 || blocks.length > 0;

  /* 채팅 메시지가 실제로 추가됐을 때만 스크롤 (빈 배열 리셋 시 스크롤 방지) */
  useEffect(() => {
    if (chatMessages.length > 0) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [chatMessages]);

  const setErr = (msg: string, detail?: string) => { setStatus(msg); setStatusType("err"); setErrorDetail(detail ?? msg); };
  const setOk  = (msg: string) => { setStatus(msg); setStatusType("ok"); setErrorDetail(""); };

  const needApiKey = () => {
    if (!apiKey.trim()) { setErr("⚙️ 설정에서 OpenAI API 키를 먼저 입력해주세요."); setSettingsOpen(true); return true; }
    return false;
  };

  /* Mermaid 적용 */
  const applyMermaid = useCallback((txt: string) => {
    const t = txt.trim();
    setMermaidImportText(t);
    if (!t) return;
    const { nodes, edges } = parseMermaidToFlow(t);
    setRfInitNodes(nodes); setRfInitEdges(edges);
    setDiagramKey((k) => k + 1);
  }, []);

  const applyResult = useCallback((data: { mermaid?: string; blocks?: LogicBlock[]; summary?: string }, msg?: string) => {
    applyMermaid(data.mermaid ?? "");
    setBlocks(normalizeBlocks(data.blocks ?? []));
    setOk(msg ?? (data.summary ? data.summary.slice(0, 200) : "반영 완료"));
  }, [applyMermaid]);

  /* 노드 클릭 */
  const handleNodeClick = useCallback((id: string) => {
    setActiveBlockId(id);
    const el = blockRefs.current.get(id);
    if (el) { el.open = true; el.scrollIntoView({ behavior: "smooth", block: "center" }); }
    setTimeout(() => setActiveBlockId(null), 1500);
  }, []);

  const setBlockRef = useCallback((id: string) => (el: HTMLDetailsElement | null) => {
    if (el) blockRefs.current.set(id, el); else blockRefs.current.delete(id);
  }, []);

  const updateBlock = useCallback((i: number, field: "title" | "description" | "code", v: string) =>
    setBlocks((prev) => prev.map((b, idx) => idx === i ? { ...b, [field]: v } : b)), []);
  const deleteBlock = useCallback((i: number) => setBlocks((prev) => prev.filter((_, idx) => idx !== i)), []);

  const addEmptyBlock = () => {
    const id = randomId(); const label = "새 구간 " + id;
    setBlocks((prev) => [...prev, { id, title: label, description: "", code: "" }]);
    diagramRef.current?.addNode(id, label);
    setTimeout(() => document.querySelector(".blocks .block-card:last-child")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
  };

  const onAddBlockFromDiagram = useCallback((id: string, label: string) =>
    setBlocks((prev) => prev.some((b) => b.id === id) ? prev : [...prev, { id, title: label, description: "", code: "" }]), []);

  const onNodesDeleteFromDiagram = useCallback((ids: string[]) => {
    const s = new Set(ids);
    setBlocks((prev) => prev.filter((b) => !s.has(b.id)));
  }, []);

  /* ── 파일 핸들러 ── */
  const onExtractFile = async (f: File | null | undefined) => {
    if (!f) return;
    setLoadingExtract(true); setStatus(`"${f.name}" 텍스트 추출 중…`); setStatusType(""); setErrorDetail("");
    try {
      const { text, filename } = await api.extractTextFromFile(f);
      setRequirements(text); setUploadedFilename(filename);
      setOk(`"${filename}" 추출 완료`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoadingExtract(false); }
  };

  const onAnalyzeFile = async (f: File | null | undefined) => {
    if (!f) return;
    if (needApiKey()) return;
    setLoadingGen(true); setStatus(`"${f.name}" 분석 중…`); setStatusType(""); setErrorDetail("");
    try {
      const data = await api.analyzeFile(f, lang, apiKey);
      if (data.extracted_text) setRequirements(data.extracted_text);
      setUploadedFilename(f.name); setChatMessages([]);
      applyResult(data, `"${f.name}" 분석 완료`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoadingGen(false); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    onExtractFile(e.dataTransfer.files[0]);
  };

  /* ── AI 생성 ── */
  const onGenerate = async () => {
    const q = (inputMode === "direct" ? directQuery : requirements).trim();
    if (!q) { setErr("요건 또는 질문을 입력하세요."); return; }
    if (needApiKey()) return;
    setLoadingGen(true); setStatus("OpenAI 호출 중…"); setStatusType(""); setErrorDetail("");
    try {
      const data = await api.generateDiagram(q, lang, apiKey);
      if (inputMode === "direct") setRequirements(q);
      setChatMessages([]);
      applyResult(data);
    } catch (e) { const m = e instanceof Error ? e.message : String(e); setErr(m, m); }
    finally { setLoadingGen(false); }
  };

  /* ── 채팅 ── */
  const onSendChat = async () => {
    const q = chatInput.trim();
    if (!q || needApiKey()) return;
    const currentMermaid = diagramRef.current?.getMermaid() ?? mermaidImportText;
    const newMsgs: ChatMessage[] = [...chatMessages, { role: "user", content: q }];
    setChatMessages(newMsgs); setChatInput("");
    setLoadingChat(true); setStatus("다이어그램 수정 중…"); setStatusType("");
    try {
      const data = await api.chatRefine(q, currentMermaid, blocks, chatMessages, lang, apiKey);
      setChatMessages((prev) => [...prev, { role: "assistant", content: data.summary ?? "업데이트했습니다." }]);
      applyResult(data, data.summary ?? "다이어그램 업데이트 완료");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setChatMessages((prev) => [...prev, { role: "assistant", content: `⚠️ 오류: ${m}` }]);
      setErr(m, m);
    } finally { setLoadingChat(false); }
  };

  /* ── 기타 ── */
  const onCopyPrompt = async () => {
    try {
      const text = await api.fetchPromptText((inputMode === "direct" ? directQuery : requirements).trim(), lang);
      await navigator.clipboard.writeText(text); setOk("프롬프트 복사 완료");
    } catch (e) { setErr("복사 실패: " + (e instanceof Error ? e.message : String(e))); }
  };

  const onApplyJson = () => {
    try { const obj = parseAiJson(jsonPaste.trim()); setChatMessages([]); applyMermaid(obj.mermaid); setBlocks(normalizeBlocks(obj.blocks)); setOk(obj.summary ? obj.summary.slice(0, 200) : "반영 완료"); }
    catch (e) { setErr("JSON 파싱 실패: " + (e instanceof Error ? e.message : String(e))); }
  };

  const onFillCodes = async () => {
    if (needApiKey()) return;
    if (!blocks.length) { setErr("먼저 블록을 만드세요."); return; }
    setLoadingFill(true); setStatus("예시 코드 생성 중…"); setStatusType("");
    try {
      const mermaid = diagramRef.current?.getMermaid() ?? mermaidImportText;
      const meta = blocks.map(({ id, title, description }) => ({ id, title, description }));
      const filled = await api.fillBlockCodes(requirements, mermaid, meta, lang, apiKey);
      const byId: Record<string, string> = {};
      filled.forEach((b) => { byId[String(b.id)] = b.code ?? ""; });
      setBlocks((prev) => prev.map((b) => Object.prototype.hasOwnProperty.call(byId, b.id) ? { ...b, code: byId[b.id] } : b));
      setOk(lang + " 예시 코드 반영 완료");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoadingFill(false); }
  };

  const onExport = () => {
    const mermaid = diagramRef.current?.getMermaid() ?? mermaidImportText;
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), exampleLanguage: lang, requirements, mermaid, blocks }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "logic-map-" + new Date().toISOString().slice(0, 10) + ".json"; a.click();
    URL.revokeObjectURL(a.href); setOk("JSON 저장 완료");
  };

  const onImportFile = (f: File | null) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const o = JSON.parse(String(r.result)) as { requirements?: string; mermaid?: string; blocks?: LogicBlock[]; exampleLanguage?: string; };
        if (o.requirements != null) setRequirements(o.requirements);
        if (o.mermaid) { setChatMessages([]); applyMermaid(o.mermaid); }
        if (o.exampleLanguage === "c" || o.exampleLanguage === "java" || o.exampleLanguage === "python") setLang(o.exampleLanguage);
        if (Array.isArray(o.blocks)) setBlocks(normalizeBlocks(o.blocks));
        setOk("가져오기 완료");
      } catch (e) { setErr("가져오기 실패: " + (e instanceof Error ? e.message : String(e))); }
    };
    r.readAsText(f);
  };

  /* ─── JSX ─── */

  // Tauri 프로덕션에서 백엔드 사이드카가 준비될 때까지 스플래시 표시
  if (!backendReady) {
    return (
      <div className="tauri-splash">
        <div className="tauri-splash-inner">
          <div className="tauri-splash-logo">⬡</div>
          <h2>Logic Mapper</h2>
          <p className="tauri-splash-msg">백엔드 엔진을 시작하는 중…</p>
          <div className="tauri-splash-bar">
            <div className="tauri-splash-fill" style={{ width: `${Math.min(backendAttempt * 2.5, 95)}%` }} />
          </div>
          <p className="tauri-splash-sub">잠시만 기다려주세요 ({backendAttempt}/40)</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 설정 모달 */}
      <SettingsModal
        open={settingsOpen} onClose={() => setSettingsOpen(false)}
        apiKey={apiKey} onApiKeyChange={setApiKey}
        lang={lang} onLangChange={setLang}
      />

      <header className="app-header">
        <div>
          <h1>요건 → 로직 맵</h1>
          <p>노드 클릭 → 코드 이동 · 더블클릭 → 이름 편집 · 채팅으로 다이어그램 수정</p>
        </div>
        <div className="toolbar">
          <button type="button" className="secondary" onClick={onCopyPrompt}>프롬프트 복사</button>
          <button type="button" className="secondary" onClick={onExport}>JSON 내보내기</button>
          <label className="secondary" style={{ padding: "0.45rem 0.9rem", borderRadius: 6, cursor: "pointer" }}>
            가져오기
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(ev) => onImportFile(ev.target.files?.[0] ?? null)} />
          </label>
          <button
            type="button"
            className={`btn-settings${apiKey ? " has-key" : " no-key"}`}
            onClick={() => setSettingsOpen(true)}
            title="설정"
          >
            ⚙️ 설정{!apiKey && <span className="settings-badge">!</span>}
          </button>
        </div>
      </header>

      <main className={`grid${codeVisible ? "" : " code-hidden"}`}>
        {/* ── 1. 요건 입력 ── */}
        <section className="col">
          <div className="col-head">1. 요건 입력</div>
          <div className="pad">

            {/* ── 입력 모드 탭 ── */}
            <div className="input-tab-bar">
              <button
                type="button"
                className={`input-tab-btn${inputMode === "direct" ? " active" : ""}`}
                onClick={() => setInputMode("direct")}
              >
                <span className="tab-icon">💬</span>
                <span className="tab-label">AI에게 직접 질문</span>
              </button>
              <button
                type="button"
                className={`input-tab-btn${inputMode === "file" ? " active" : ""}`}
                onClick={() => setInputMode("file")}
              >
                <span className="tab-icon">📄</span>
                <span className="tab-label">파일 업로드</span>
              </button>
            </div>

            {/* ── 직접 질문 패널 ── */}
            {inputMode === "direct" && (
              <div className="input-panel">
                <textarea
                  className="req"
                  value={directQuery}
                  onChange={(e) => setDirectQuery(e.target.value)}
                  placeholder={"예) 증권사 주문 처리 흐름을 다이어그램으로 그려줘\n예) 입금 이체 시 AML 검사와 외부 거래소 연계 포함해서\n예) 오류 처리도 포함해줘\n\nCtrl+Enter 로 바로 생성"}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onGenerate(); }}
                />
                <button type="button" onClick={onGenerate} disabled={loadingGen} style={{ width: "100%" }}>
                  {loadingGen ? "생성 중…" : "AI로 다이어그램 생성"}
                </button>
              </div>
            )}

            {/* ── 파일 업로드 패널 ── */}
            {inputMode === "file" && (
              <div className="input-panel">
                <div
                  className={`file-dropzone${isDragOver ? " drag-over" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => analyzeFileRef.current?.click()}
                >
                  <input ref={analyzeFileRef} type="file" accept={ACCEPT_EXTS} hidden onChange={(e) => onExtractFile(e.target.files?.[0])} />
                  <span className="file-dropzone-icon">📄</span>
                  <span className="file-dropzone-text">
                    {loadingExtract ? "텍스트 추출 중…" : uploadedFilename ? `✓ ${uploadedFilename}` : "파일을 드래그하거나 클릭해서 업로드"}
                  </span>
                  <span className="file-dropzone-hint">txt · md · csv · pdf · docx · xlsx</span>
                </div>
                <div className="file-btn-row">
                  <button type="button" className="secondary" disabled={loadingExtract || loadingGen}
                    onClick={() => analyzeFileRef.current?.click()}>
                    {loadingExtract ? "추출 중…" : "파일 → 요건만 채우기"}
                  </button>
                  <button type="button" disabled={loadingGen || loadingExtract}
                    onClick={() => { const i = document.createElement("input"); i.type = "file"; i.accept = ACCEPT_EXTS; i.onchange = () => onAnalyzeFile(i.files?.[0]); i.click(); }}>
                    {loadingGen ? "생성 중…" : "파일 → 다이어그램 바로 생성"}
                  </button>
                </div>
                {requirements && (
                  <>
                    <textarea className="req" style={{ minHeight: 120 }} value={requirements}
                      onChange={(e) => setRequirements(e.target.value)}
                      placeholder="추출된 내용 (편집 후 생성 가능)" />
                    <button type="button" onClick={onGenerate} disabled={loadingGen} style={{ width: "100%" }}>
                      {loadingGen ? "생성 중…" : "추출된 내용으로 다이어그램 생성"}
                    </button>
                  </>
                )}
              </div>
            )}

            <details className="paste-zone">
              <summary>AI 응답 JSON 붙여넣기</summary>
              <textarea value={jsonPaste} onChange={(e) => setJsonPaste(e.target.value)}
                placeholder='{"summary":"...","mermaid":"...","blocks":[...]}' rows={5} style={{ marginTop: 8 }} />
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button type="button" className="secondary" onClick={onApplyJson}>응답 반영</button>
                <button type="button" className="secondary" onClick={onFillCodes} disabled={loadingFill}>
                  {loadingFill ? "채우는 중…" : "예시 코드만 채우기(API)"}
                </button>
              </div>
            </details>

            {errorDetail && (
              <details className="error-panel" open>
                <summary>오류 상세</summary>
                <pre>{errorDetail}</pre>
              </details>
            )}
            <div className={`status ${statusType}`}>{status}</div>
          </div>
        </section>

        {/* ── 2. 다이어그램 ── */}
        <section className="col">
          <div className="col-head">
            <span>2. 로직 다이어그램</span>
            <button
              type="button"
              className="btn-code-toggle"
              onClick={() => setCodeVisible((v) => !v)}
            >
              {codeVisible ? "◀ 코드 패널 닫기" : "코드 패널 열기 ▶"}
            </button>
          </div>
          <div className="pad diagram-pad">
            <details className="mermaid-import-zone">
              <summary>Mermaid 텍스트 가져오기 / 내보내기 ▶</summary>
              <textarea className="mermaid-import-textarea" value={mermaidImportText}
                onChange={(e) => setMermaidImportText(e.target.value)} rows={6}
                placeholder={"flowchart TD\n  A[시작] --> B[처리]"} />
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button type="button" onClick={() => { try { applyMermaid(mermaidImportText); setOk("적용 완료"); } catch (e) { setErr(String(e)); } }}>
                  다이어그램에 적용
                </button>
                <button type="button" className="secondary"
                  onClick={() => setMermaidImportText(diagramRef.current?.getMermaid() ?? "")}>
                  현재 다이어그램 → 텍스트
                </button>
              </div>
            </details>

            <DiagramEditor
              key={diagramKey}
              defaultNodes={rfInitNodes} defaultEdges={rfInitEdges}
              editorRef={diagramRef} activeNodeId={activeBlockId}
              onNodeClick={handleNodeClick}
              onAddBlock={onAddBlockFromDiagram}
              onNodesDelete={onNodesDeleteFromDiagram}
            />

            {/* 채팅 패널 */}
            {diagramHasContent && (
              <div className="chat-panel">
                <div className="chat-panel-head">💬 다이어그램 이어서 수정 · 추가 질문</div>
                <div className="chat-messages">
                  {chatMessages.length === 0 && (
                    <div className="chat-empty">
                      다이어그램에 대해 추가 요청을 입력하세요.<br />
                      <span>예) "재시도 로직 추가" · "KSD 연계 노드 넣어줘" · "오류 처리 더 자세히"</span>
                    </div>
                  )}
                  {chatMessages.map((m, i) => (
                    <div key={i} className={`chat-msg chat-msg--${m.role}`}>
                      <span className="chat-msg-role">{m.role === "user" ? "나" : "AI"}</span>
                      <span className="chat-msg-content">{m.content}</span>
                    </div>
                  ))}
                  {loadingChat && (
                    <div className="chat-msg chat-msg--assistant">
                      <span className="chat-msg-role">AI</span>
                      <span className="chat-msg-content chat-loading">분석 중…</span>
                    </div>
                  )}
                  <div ref={chatBottomRef} />
                </div>
                <div className="chat-input-row">
                  <textarea className="chat-input" rows={2} disabled={loadingChat}
                    placeholder="추가 수정·확장 요청 (Ctrl+Enter: 전송)"
                    value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSendChat(); } }}
                  />
                  <button type="button" onClick={onSendChat} disabled={loadingChat || !chatInput.trim()}>
                    {loadingChat ? "…" : "전송"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── 3. 소스코드 ── */}
        <section className={`col${codeVisible ? "" : " col-code-hidden"}`}>
          <div className="col-head">
            <span>3. 구간별 소스코드</span>
            <span className="code-block-count">{blocks.length}개</span>
          </div>
          <div className="code-panel-layout">
            <p className="hint code-hint">
              블록 id = Mermaid 노드 id · 제목·설명·코드 직접 편집 가능
            </p>
            <div className="blocks">
              {blocks.map((b, i) => (
                <BlockCard key={b.id + "-" + i} block={b} index={i}
                  active={activeBlockId === b.id} lang={lang}
                  detailsRef={setBlockRef(b.id)}
                  onChange={(field, value) => updateBlock(i, field, value)}
                  onDelete={() => deleteBlock(i)}
                />
              ))}
              {blocks.length === 0 && (
                <div className="blocks-empty">블록이 없습니다.<br />AI 생성 또는 직접 추가하세요.</div>
              )}
            </div>
            <div className="code-panel-footer">
              <button type="button" className="secondary" onClick={addEmptyBlock}>
                + 빈 블록 추가
              </button>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
