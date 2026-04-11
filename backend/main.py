# -*- coding: utf-8 -*-
"""Logic Mapper API — OpenAI 호출은 서버에서만 수행 (CORS 없음)."""

from __future__ import annotations

import json
import re
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import APIError, OpenAI
from pydantic import BaseModel

from prompts import build_clipboard_prompt, fill_codes_system_user

app = FastAPI(title="Logic Mapper API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(127\.0\.0\.1|localhost)(:\d+)?",
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
