# -*- coding: utf-8 -*-
"""Logic Mapper API — OpenAI 호출은 서버에서만 수행 (CORS 없음)."""

from __future__ import annotations

import io
import json
import re
from typing import Any, Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from openai import APIError, OpenAI
from pydantic import BaseModel

from prompts import (
    build_clipboard_prompt,
    default_system_prompt,
    build_user_content,
    pre_analysis_system_prompt,
    build_pre_analysis_user,
    file_analysis_system_prompt,
    build_file_analysis_user,
    fill_codes_system_user,
    chat_refine_system_prompt,
    build_chat_refine_user,
)

app = FastAPI(title="Logic Mapper API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(127\.0\.0\.1|localhost|tauri\.localhost)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _strip_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
        s = re.sub(r"\s*```$", "", s)
    return s.strip()


def _parse_ai_json(raw: str) -> dict[str, Any]:
    s = _strip_fence(raw)
    obj = json.loads(s)
    if not obj.get("mermaid") or not isinstance(obj.get("blocks"), list):
        raise ValueError("JSON에 mermaid 또는 blocks 배열이 없습니다.")
    return obj


def _parse_fill_blocks(raw: str) -> list[dict]:
    s = _strip_fence(raw)
    obj = json.loads(s)
    if not isinstance(obj.get("blocks"), list):
        raise ValueError("응답에 blocks 배열이 없습니다.")
    return obj["blocks"]


class PromptTextBody(BaseModel):
    requirements: str = ""
    language: Literal["c", "java", "python"] = "java"


class GenerateBody(BaseModel):
    requirements: str
    language: Literal["c", "java", "python"] = "java"
    api_key: str


class BlockMeta(BaseModel):
    id: str
    title: str = ""
    description: str = ""


class FillCodesBody(BaseModel):
    requirements: str = ""
    mermaid: str = ""
    blocks_meta: list[BlockMeta]
    language: Literal["c", "java", "python"] = "java"
    api_key: str


def _client(api_key: str) -> OpenAI:
    key = (api_key or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="api_key가 비었습니다.")
    return OpenAI(api_key=key)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.post("/api/prompt-text")
def prompt_text(body: PromptTextBody) -> dict:
    text = body.requirements.strip() or "(요건 문서를 입력한 뒤 다시 요청하세요)"
    return {"text": build_clipboard_prompt(text, body.language)}


@app.post("/api/generate")
def generate(body: GenerateBody) -> dict:
    req = body.requirements.strip()
    if not req:
        raise HTTPException(status_code=400, detail="requirements가 비었습니다.")
    client = _client(body.api_key)
    prompt = build_clipboard_prompt(req, body.language)
    try:
        r = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )
    except APIError as e:
        raise _http_from_openai(e)
    raw = (r.choices[0].message.content or "").strip()
    if not raw:
        raise HTTPException(status_code=502, detail="OpenAI 응답 본문이 비었습니다.")
    try:
        return _parse_ai_json(raw)
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"JSON 파싱 실패: {e}. 원문 일부: {raw[:500]}")


@app.post("/api/fill-codes")
def fill_codes(body: FillCodesBody) -> dict:
    if not body.blocks_meta:
        raise HTTPException(status_code=400, detail="blocks_meta가 비었습니다.")
    client = _client(body.api_key)
    meta = [m.model_dump() for m in body.blocks_meta]
    system, user = fill_codes_system_user(
        body.language, body.requirements, body.mermaid, meta
    )
    try:
        r = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.2,
        )
    except APIError as e:
        raise _http_from_openai(e)
    raw = (r.choices[0].message.content or "").strip()
    if not raw:
        raise HTTPException(status_code=502, detail="OpenAI 응답 본문이 비었습니다.")
    try:
        blocks = _parse_fill_blocks(raw)
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"JSON 파싱 실패: {e}")
    return {"blocks": blocks}


def _extract_text_from_file(filename: str, content: bytes) -> str:
    """업로드된 파일에서 텍스트를 추출합니다."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext in ("txt", "md", "csv", "log", "rst"):
        for enc in ("utf-8", "utf-8-sig", "cp949", "euc-kr", "latin-1"):
            try:
                return content.decode(enc)
            except UnicodeDecodeError:
                continue
        return content.decode("utf-8", errors="replace")

    if ext == "pdf":
        try:
            import PyPDF2  # type: ignore
            reader = PyPDF2.PdfReader(io.BytesIO(content))
            pages = [p.extract_text() or "" for p in reader.pages]
            return "\n\n".join(p.strip() for p in pages if p.strip())
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"PDF 파싱 실패: {e}")

    if ext in ("docx",):
        try:
            import docx  # type: ignore
            doc = docx.Document(io.BytesIO(content))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"DOCX 파싱 실패: {e}")

    if ext in ("xlsx", "xls"):
        try:
            import openpyxl  # type: ignore
            wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            lines: list[str] = []
            for ws in wb.worksheets:
                lines.append(f"[시트: {ws.title}]")
                for row in ws.iter_rows(values_only=True):
                    row_str = "\t".join("" if v is None else str(v) for v in row)
                    if row_str.strip():
                        lines.append(row_str)
            return "\n".join(lines)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Excel 파싱 실패: {e}")

    raise HTTPException(
        status_code=415,
        detail=f"지원하지 않는 파일 형식입니다: .{ext}  (지원: txt, md, csv, pdf, docx, xlsx)",
    )


@app.post("/api/extract-text")
async def extract_text(file: UploadFile = File(...)) -> dict:  # noqa: no form fields
    """파일을 업로드하면 텍스트를 추출해서 반환합니다."""
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="파일 크기가 10MB를 초과합니다.")
    text = _extract_text_from_file(file.filename or "upload.txt", content)
    if not text.strip():
        raise HTTPException(status_code=422, detail="파일에서 텍스트를 추출할 수 없습니다.")
    return {"text": text, "filename": file.filename, "size": len(content)}


@app.post("/api/pre-analyze")
async def pre_analyze(
    file: UploadFile = File(...),
    api_key: str = Form(default=""),
) -> dict:
    """1단계: 파일을 AI가 학습 — 업무 유형, 흐름, 외부 시스템, 규칙, 예외를 구조화해서 반환합니다."""
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="파일 크기가 10MB를 초과합니다.")
    text = _extract_text_from_file(file.filename or "upload.txt", content)
    if not text.strip():
        raise HTTPException(status_code=422, detail="파일에서 텍스트를 추출할 수 없습니다.")

    client = _client(api_key)
    system = pre_analysis_system_prompt()
    user = build_pre_analysis_user(text)
    try:
        r = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.1,
            max_tokens=1500,
        )
    except APIError as e:
        raise _http_from_openai(e)
    raw = (r.choices[0].message.content or "").strip()
    if not raw:
        raise HTTPException(status_code=502, detail="OpenAI 응답 본문이 비었습니다.")
    try:
        s = raw.strip()
        if s.startswith("```"):
            s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
            s = re.sub(r"\s*```$", "", s)
        result = json.loads(s.strip())
        result["extracted_text"] = text[:3000]
        return result
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"JSON 파싱 실패: {e}. 원문: {raw[:300]}")


class GenerateFromAnalysisBody(BaseModel):
    extracted_text: str
    pre_analysis: dict = {}
    language: Literal["c", "java", "python"] = "java"
    api_key: str


@app.post("/api/generate-from-analysis")
def generate_from_analysis(body: GenerateFromAnalysisBody) -> dict:
    """2단계: 사전 분석 결과를 컨텍스트로 활용해 다이어그램을 생성합니다."""
    if not body.extracted_text.strip():
        raise HTTPException(status_code=400, detail="extracted_text가 비었습니다.")
    client = _client(body.api_key)
    system = file_analysis_system_prompt(body.language)
    user = build_file_analysis_user(body.extracted_text, body.language, body.pre_analysis or None)
    try:
        r = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.15,
            max_tokens=4096,
        )
    except APIError as e:
        raise _http_from_openai(e)
    raw = (r.choices[0].message.content or "").strip()
    if not raw:
        raise HTTPException(status_code=502, detail="OpenAI 응답 본문이 비었습니다.")
    try:
        return _parse_ai_json(raw)
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"JSON 파싱 실패: {e}. 원문 일부: {raw[:500]}")


@app.post("/api/analyze-file")
async def analyze_file(
    file: UploadFile = File(...),
    language: str = Form(default="java"),
    api_key: str = Form(default=""),
) -> dict:
    """파일 업로드 → 텍스트 추출 → OpenAI로 다이어그램 생성까지 한 번에 처리합니다."""
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="파일 크기가 10MB를 초과합니다.")
    text = _extract_text_from_file(file.filename or "upload.txt", content)
    if not text.strip():
        raise HTTPException(status_code=422, detail="파일에서 텍스트를 추출할 수 없습니다.")

    lang = language if language in ("c", "java", "python") else "java"
    client = _client(api_key)
    system = file_analysis_system_prompt(lang)
    user = build_file_analysis_user(text, lang)
    try:
        r = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.15,
            max_tokens=4096,
        )
    except APIError as e:
        raise _http_from_openai(e)
    raw = (r.choices[0].message.content or "").strip()
    if not raw:
        raise HTTPException(status_code=502, detail="OpenAI 응답 본문이 비었습니다.")
    try:
        result = _parse_ai_json(raw)
        result["extracted_text"] = text[:2000]
        return result
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"JSON 파싱 실패: {e}. 원문 일부: {raw[:500]}")


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatBlockMeta(BaseModel):
    id: str
    title: str = ""
    description: str = ""
    code: str = ""


class ChatRefineBody(BaseModel):
    question: str
    current_mermaid: str = ""
    current_blocks: list[ChatBlockMeta] = []
    history: list[ChatMessage] = []
    document_context: str = ""
    language: Literal["c", "java", "python"] = "java"
    api_key: str


@app.post("/api/chat-refine")
def chat_refine(body: ChatRefineBody) -> dict:
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="question이 비었습니다.")
    client = _client(body.api_key)
    system = chat_refine_system_prompt(body.language)
    user = build_chat_refine_user(
        body.question,
        body.current_mermaid,
        [b.model_dump() for b in body.current_blocks],
        [m.model_dump() for m in body.history],
        body.document_context,
    )
    try:
        r = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.2,
            max_tokens=4096,
        )
    except APIError as e:
        raise _http_from_openai(e)
    raw = (r.choices[0].message.content or "").strip()
    if not raw:
        raise HTTPException(status_code=502, detail="OpenAI 응답 본문이 비었습니다.")
    try:
        return _parse_ai_json(raw)
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"JSON 파싱 실패: {e}. 원문: {raw[:500]}")


def _http_from_openai(e: APIError) -> HTTPException:
    msg = getattr(e, "message", None) or str(e)
    code = getattr(e, "code", None)
    typ = getattr(e, "type", None)
    status = getattr(e, "status_code", None)
    http = int(status) if status and 100 <= int(status) < 600 else 502
    if http == 401 or http == 403:
        http = 401
    elif http >= 500:
        http = 502
    detail = {"message": msg, "type": typ, "code": code}
    return HTTPException(status_code=http, detail=detail)


# ─── Tauri 사이드카 / PyInstaller 진입점 ───────────────────────────────────────
if __name__ == "__main__":
    import os
    import sys
    import logging
    import uvicorn

    # 실행 파일 위치 기준으로 로그 파일 생성
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    log_dir = os.path.join(os.path.expanduser("~"), "AppData", "Local", "LogicMapper")
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, "backend.log")

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_level="info",
        access_log=True,
    )
