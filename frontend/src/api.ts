import type { CodeLang, GenerateResult, LogicBlock } from "./types";

export type AiProvider = "chatgpt" | "gemini" | "ds_playground";

export interface AiCredentials {
  ai_provider: AiProvider;
  api_key: string;
  model: string;
  base_url: string;
}

export interface ProviderFields {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface AiSettings {
  activeProvider: AiProvider;
  providers: Record<AiProvider, ProviderFields>;
}

export const AI_SETTINGS_STORAGE_KEY = "logic-map-ai-settings-v1";

const LEGACY_API_KEY = "logic-map-apikey";

export function defaultAiSettings(): AiSettings {
  return {
    activeProvider: "chatgpt",
    providers: {
      chatgpt: { apiKey: "", model: "gpt-4o", baseUrl: "" },
      gemini: { apiKey: "", model: "gemini-2.0-flash", baseUrl: "" },
      ds_playground: { apiKey: "", model: "", baseUrl: "" },
    },
  };
}

function normalizeAiSettings(raw: Partial<AiSettings>): AiSettings {
  const d = defaultAiSettings();
  const ap = raw.activeProvider;
  if (ap === "chatgpt" || ap === "gemini" || ap === "ds_playground") {
    d.activeProvider = ap;
  }
  const pr = raw.providers;
  if (pr) {
    for (const k of ["chatgpt", "gemini", "ds_playground"] as const) {
      const x = pr[k];
      if (x && typeof x === "object") {
        d.providers[k] = {
          apiKey: typeof x.apiKey === "string" ? x.apiKey : d.providers[k].apiKey,
          model: typeof x.model === "string" ? x.model : d.providers[k].model,
          baseUrl: typeof x.baseUrl === "string" ? x.baseUrl : d.providers[k].baseUrl,
        };
      }
    }
  }
  return d;
}

export function loadAiSettings(): AiSettings {
  try {
    const s = localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (s) return normalizeAiSettings(JSON.parse(s) as Partial<AiSettings>);
  } catch {
    /* ignore */
  }
  const d = defaultAiSettings();
  const legacy = localStorage.getItem(LEGACY_API_KEY);
  if (legacy) d.providers.chatgpt.apiKey = legacy;
  return d;
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export function credentialsFromSettings(s: AiSettings): AiCredentials {
  const p = s.activeProvider;
  const c = s.providers[p];
  return {
    ai_provider: p,
    api_key: c.apiKey.trim(),
    model: c.model.trim(),
    base_url: c.baseUrl.trim(),
  };
}

/** One provider is ready: API key + model; DS PlayGround also needs base URL. */
export function isProviderConfigured(id: AiProvider, s: AiSettings): boolean {
  const c = s.providers[id];
  if (!c.apiKey.trim() || !c.model.trim()) return false;
  if (id === "ds_playground" && !c.baseUrl.trim()) return false;
  return true;
}

/** Save allowed if at least one provider is fully configured; others may stay empty. */
export function validateAllProvidersSaved(s: AiSettings): string | null {
  for (const id of ["chatgpt", "gemini", "ds_playground"] as const) {
    if (isProviderConfigured(id, s)) return null;
  }
  return "At least one provider needs API key and model (DS PlayGround also needs base URL).";
}

/** For AI calls: only the selected active provider must be configured. */
export function activeProviderReady(s: AiSettings): boolean {
  return isProviderConfigured(s.activeProvider, s);
}

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
 * Vite dev(5173 등): /api -> FastAPI proxy
 * Tauri production: no proxy -> absolute backend URL
 */
function apiBaseUrl(): string {
  if (typeof window === "undefined") return "";
  const h = window.location.hostname;
  const port = window.location.port;
  const viteDev =
    (h === "localhost" || h === "127.0.0.1") &&
    (port === "5173" || port === "1420");
  if (viteDev) return "";
  return "http://127.0.0.1:8000";
}

/** `""` = Vite `/api` proxy; otherwise absolute backend base URL. */
export function getApiPrefix(): string {
  return apiBaseUrl();
}

/** Health check URL (relative in Vite dev so it hits the proxy). */
export function apiHealthUrl(): string {
  const p = apiBaseUrl();
  return p ? `${p}/api/health` : `/api/health`;
}

/** Map Failed-to-fetch style errors to actionable text. */
export function formatApiNetworkError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const low = m.toLowerCase();
  const looksNetwork =
    m === "Failed to fetch" ||
    low.includes("networkerror") ||
    low.includes("network request failed") ||
    low.includes("load failed") ||
    low.includes("failed to fetch");
  if (!looksNetwork) return m;
  if (apiBaseUrl() === "") {
    return [
      "\ube45\uc5d4\ub4dc\uc5d0 \uc5f0\uacb0\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4. (\ube0c\ub77c\uc6b0\uc800 \uac1c\ubc1c: Vite\uac00 8000\ubc88 \ud3ec\ud2b8\ub85c \ud504\ub85d\uc2dc)",
      "backend \ud3f4\ub354\uc5d0\uc11c \uc544\ub798\ub97c \uc2e4\ud589\ud55c \ud6c4 \uc0c8\ub85c\uace0\uce59\ud558\uc138\uc694:",
      "uvicorn main:app --reload --host 127.0.0.1 --port 8000",
    ].join(" ");
  }
  return [
    "API \uc11c\ubc84(127.0.0.1:8000)\uc5d0 \uc5f0\uacb0\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.",
    "\ub370\uc2a4\ud06c\ud1b1 \uc571\uc740 \uc644\uc804 \uc885\ub8cc \ud6c4 \ub2e4\uc2dc \uc2e4\ud589\ud558\uac70\ub098 \ubc29\ud654\ubcbd\uc744 \ud655\uc778\ud558\uc138\uc694. \uac1c\ubc1c \uc911\uc774\uba74 uvicorn \uc2e4\ud589 \uc5ec\ubd80\ub97c \ud655\uc778\ud558\uc138\uc694.",
  ].join(" ");
}

const prefix = apiBaseUrl();

async function parseError(res: Response): Promise<string> {
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

function credBody(c: AiCredentials) {
  return {
    ai_provider: c.ai_provider,
    api_key: c.api_key,
    model: c.model,
    base_url: c.base_url,
  };
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
  creds: AiCredentials,
): Promise<GenerateResult> {
  const res = await fetch(`${prefix}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requirements, language, ...credBody(creds) }),
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
  creds: AiCredentials,
): Promise<GenerateResult & { extracted_text?: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("language", language);
  form.append("api_key", creds.api_key);
  form.append("ai_provider", creds.ai_provider);
  form.append("model", creds.model);
  form.append("base_url", creds.base_url);
  const res = await fetch(`${prefix}/api/analyze-file`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<GenerateResult & { extracted_text?: string }>;
}

export async function preAnalyzeFile(file: File, creds: AiCredentials): Promise<FileAnalysisResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", creds.api_key);
  form.append("ai_provider", creds.ai_provider);
  form.append("model", creds.model);
  form.append("base_url", creds.base_url);
  const res = await fetch(`${prefix}/api/pre-analyze`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<FileAnalysisResult>;
}

export async function generateFromAnalysis(
  extractedText: string,
  preAnalysis: FileAnalysisResult,
  language: CodeLang,
  creds: AiCredentials,
): Promise<GenerateResult> {
  const res = await fetch(`${prefix}/api/generate-from-analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      extracted_text: extractedText,
      pre_analysis: preAnalysis,
      language,
      ...credBody(creds),
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
  creds: AiCredentials,
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
      document_context: documentContext ?? "",
      ...credBody(creds),
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
  creds: AiCredentials,
): Promise<{ id: string; code: string }[]> {
  const res = await fetch(`${prefix}/api/fill-codes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requirements,
      mermaid,
      blocks_meta: blocksMeta,
      language,
      ...credBody(creds),
    }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { blocks: { id: string; code: string }[] };
  return data.blocks;
}
