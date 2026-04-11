export type CodeLang = "c" | "java" | "python";

export interface LogicBlock {
  id: string;
  title: string;
  description: string;
  code: string;
}

export interface GenerateResult {
  summary?: string;
  mermaid: string;
  blocks: LogicBlock[];
}
