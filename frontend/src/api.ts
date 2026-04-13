import type { CodeLang, GenerateResult, LogicBlock } from "./types";

export interface FileAnalysisResult {
  business_type: string;
  summary: string;
  key_flows: string[];
  entities: string[];
  external_systems: string[];
  business_rules: string[];
  exception_cases: string[];
  extracted_text: string;
}

/**
 * Tauri v2 프로덕션: http://tauri.localhost 에서 서빙
 * Tauri 개발 모드:  http://localhost:5173 (Vite 프록시 사용)
 * 일반 브라우저:    http://localhost:5173 (Vite 프록시 사용)
 */
const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const IS_TAURI_DEV = IS_TAURI && window.location.hostname === "localhost";
const IS_TAURI_PROD = IS_TAURI && !IS_TAURI_DEV;

const prefix = IS_TAURI_PROD ? "http://127.0.0.1:8000" : "";

async function parseError(res: Response): Promise<string> {
  // body 스트림은 한 번만 읽기 — text로 먼저 읽고 JSON 파싱 시도
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    const d = j.detail;
    if (typeof d === "string") return d;
    if (d && typeof d === "object" && "message" in d) {
      const msg = String((d as { message: string }).message);
      const typ = (d as { type?: string }).type;
      const code = (d as { code?: string }).code;
      return [msg, typ && `type: ${typ}`, code && `code: ${code}`].filter(Boolean).join(" · ");
    }
    return JSON.stringify(j);
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

export async function fetchPromptText(requirements: string, language: CodeLang): Promise<string> {
  const res = await fetch(`${prefix}/api/prompt-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requirements, language }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { text: string };
  return data.text;
}

export async function generateDiagram(
  requirements: string,
  language: CodeLang,
  apiKey: string
): Promise<GenerateResult> {
  const res = await fetch(`${prefix}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requirements, language, api_key: apiKey }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<GenerateResult>;
}

export async function extractTextFromFile(file: File): Promise<{ text: string; filename: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${prefix}/api/extract-text`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<{ text: string; filename: string }>;
}

export async function analyzeFile(
  file: File,
  language: CodeLang,
  apiKey: string
): Promise<GenerateResult & { extracted_text?: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("language", language);
  form.append("api_key", apiKey);
  const res = await fetch(`${prefix}/api/analyze-file`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<GenerateResult & { extracted_text?: string }>;
}

export async function preAnalyzeFile(
  file: File,
  apiKey: string,
): Promise<FileAnalysisResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", apiKey);
  const res = await fetch(`${prefix}/api/pre-analyze`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<FileAnalysisResult>;
}

export async function generateFromAnalysis(
  extractedText: string,
  preAnalysis: FileAnalysisResult,
  language: CodeLang,
  apiKey: string,
): Promise<GenerateResult> {
  const res = await fetch(`${prefix}/api/generate-from-analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      extracted_text: extractedText,
      pre_analysis: preAnalysis,
      language,
      api_key: apiKey,
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<GenerateResult>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function chatRefine(
  question: string,
  currentMermaid: string,
  currentBlocks: LogicBlock[],
  history: ChatMessage[],
  language: CodeLang,
  apiKey: string,
  documentContext?: string,
): Promise<GenerateResult> {
  const res = await fetch(`${prefix}/api/chat-refine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      current_mermaid: currentMermaid,
      current_blocks: currentBlocks,
      history,
      language,
      api_key: apiKey,
      document_context: documentContext ?? "",
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<GenerateResult>;
}

export async function fillBlockCodes(
  requirements: string,
  mermaid: string,
  blocksMeta: Pick<LogicBlock, "id" | "title" | "description">[],
  language: CodeLang,
  apiKey: string
): Promise<{ id: string; code: string }[]> {
  const res = await fetch(`${prefix}/api/fill-codes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requirements,
      mermaid,
      blocks_meta: blocksMeta,
      language,
      api_key: apiKey,
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { blocks: { id: string; code: string }[] };
  return data.blocks;
}
