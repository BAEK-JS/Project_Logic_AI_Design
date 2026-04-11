import type { CodeLang, GenerateResult, LogicBlock } from "./types";

const prefix = "";

async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json();
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
    return await res.text();
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
