import type { CodeLang, LogicBlock } from "./types";

/** Java / 식별자용: 알파숫자만 남기고 비면 fallback */
function alnumCore(s: string, fallback: string): string {
  const t = s.replace(/[^a-zA-Z0-9]/g, "");
  return t || fallback;
}

function escapeOneLine(s: string, max: number): string {
  return s.replace(/\s+/g, " ").trim().slice(0, max);
}

function cFunctionName(id: string): string {
  let base = id.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_");
  base = base.replace(/^_|_$/g, "");
  if (!base) base = "step";
  if (/^[0-9]/.test(base)) base = "n_" + base;
  return "process_" + base;
}

function pyFunctionName(id: string): string {
  return cFunctionName(id);
}

function javaMethodName(id: string): string {
  const core = alnumCore(id, "Step");
  const safe = /^[0-9]/.test(core) ? "N" + core : core;
  return "process" + safe.charAt(0).toUpperCase() + safe.slice(1);
}

/**
 * API 없이 구간 제목·설명·ID를 바탕으로 한 언어별 스켈레톤 코드.
 */
export function stubForBlock(
  lang: CodeLang,
  block: Pick<LogicBlock, "id" | "title" | "description">,
): string {
  const title = escapeOneLine(block.title || "구간", 72);
  const descFirst = escapeOneLine((block.description || "").split("\n")[0], 100);
  const bid = (block.id || "STEP").trim();

  if (lang === "python") {
    const fn = pyFunctionName(bid);
    return (
      `def ${fn}():\n` +
      `    """${title}${descFirst ? " — " + descFirst : ""} (${bid})"""\n` +
      `    # TODO: 이 구간 업무 로직 구현\n` +
      `    pass\n`
    );
  }

  if (lang === "c") {
    const fn = cFunctionName(bid);
    const head = descFirst ? `${title} — ${descFirst}` : title;
    return (
      `/* ${bid}: ${head} */\n` +
      `void ${fn}(void) {\n` +
      `    /* TODO: 구현 */\n` +
      `}\n`
    );
  }

  const jm = javaMethodName(bid);
  return (
    `// ${title} (${bid})\n` +
    `public void ${jm}() {\n` +
    `    // TODO: ${descFirst || "이 구간 업무 로직 구현"}\n` +
    `}\n`
  );
}
