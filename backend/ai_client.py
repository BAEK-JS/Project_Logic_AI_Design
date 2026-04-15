# -*- coding: utf-8 -*-
"""Multi-provider AI completion: ChatGPT (OpenAI), Gemini (REST), OpenAI-compatible (DS PlayGround)."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Literal

from fastapi import HTTPException
from openai import APIError, OpenAI

AiProvider = Literal["chatgpt", "gemini", "ds_playground"]

DEFAULT_MODELS: dict[str, str] = {
    "chatgpt": "gpt-4o",
    "gemini": "gemini-2.0-flash",
    "ds_playground": "",
}

DEFAULT_BASE_CHATGPT = "https://api.openai.com/v1"
DEFAULT_BASE_GEMINI = "https://generativelanguage.googleapis.com/v1beta"


def _resolve_model(provider: str, model: str) -> str:
    m = (model or "").strip()
    if m:
        return m
    d = DEFAULT_MODELS.get(provider, "")
    if not d:
        raise HTTPException(
            status_code=400,
            detail=f"{provider}: model name is required in settings.",
        )
    return d


def _resolve_openai_base(provider: str, base_url: str) -> str | None:
    u = (base_url or "").strip().rstrip("/")
    if u:
        return u
    if provider == "chatgpt":
        return DEFAULT_BASE_CHATGPT
    if provider == "ds_playground":
        raise HTTPException(
            status_code=400,
            detail="DS PlayGround requires a base URL.",
        )
    return None


def _messages_to_gemini_payload(messages: list[dict[str, str]]) -> dict[str, Any]:
    system_parts: list[str] = []
    contents: list[dict[str, Any]] = []
    for m in messages:
        role, content = m.get("role", ""), m.get("content", "")
        if role == "system":
            system_parts.append(content)
            continue
        if role == "user":
            contents.append({"role": "user", "parts": [{"text": content}]})
        elif role == "assistant":
            contents.append({"role": "model", "parts": [{"text": content}]})
        else:
            contents.append({"role": "user", "parts": [{"text": content}]})
    payload: dict[str, Any] = {"contents": contents}
    if system_parts:
        payload["systemInstruction"] = {"parts": [{"text": "\n\n".join(system_parts)}]}
    return payload


def _gemini_generate(
    api_key: str,
    model: str,
    base_url: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int | None,
) -> str:
    root = (base_url or "").strip().rstrip("/") or DEFAULT_BASE_GEMINI
    mname = model.strip()
    if mname.startswith("models/"):
        mname = mname[7:]
    url = f"{root}/models/{mname}:generateContent?key={urllib.parse.quote(api_key, safe='')}"
    body = _messages_to_gemini_payload(messages)
    gen: dict[str, Any] = {"temperature": temperature}
    if max_tokens:
        gen["maxOutputTokens"] = max_tokens
    body["generationConfig"] = gen
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")[:800]
        raise HTTPException(status_code=502, detail=f"Gemini API 오류 HTTP {e.code}: {err_body}") from e
    except urllib.error.URLError as e:
        raise HTTPException(status_code=502, detail=f"Gemini 연결 실패: {e}") from e

    try:
        cands = raw.get("candidates") or []
        if not cands:
            raise ValueError("candidates 비어 있음")
        parts = (cands[0].get("content") or {}).get("parts") or []
        texts = [p.get("text", "") for p in parts if isinstance(p, dict)]
        return "".join(texts).strip()
    except (IndexError, TypeError, ValueError) as ex:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini parse error: {ex}. Raw: {str(raw)[:400]}",
        ) from ex


def _openai_chat(
    api_key: str,
    model: str,
    base_url: str | None,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int | None,
) -> str:
    kw: dict[str, Any] = {"api_key": api_key.strip()}
    if base_url:
        kw["base_url"] = base_url
    client = OpenAI(**kw)
    try:
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        if max_tokens:
            kwargs["max_tokens"] = max_tokens
        r = client.chat.completions.create(**kwargs)
    except APIError as e:
        raise _http_from_openai(e) from e
    return (r.choices[0].message.content or "").strip()


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
    detail: Any = {"message": msg, "type": typ, "code": code}
    return HTTPException(status_code=http, detail=detail)


def complete_chat(
    messages: list[dict[str, str]],
    *,
    ai_provider: str,
    api_key: str,
    model: str = "",
    base_url: str = "",
    temperature: float = 0.2,
    max_tokens: int | None = None,
) -> str:
    key = (api_key or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key is empty.")

    prov = (ai_provider or "chatgpt").strip().lower()
    if prov not in ("chatgpt", "gemini", "ds_playground"):
        prov = "chatgpt"

    resolved_model = _resolve_model(prov, model)

    if prov == "gemini":
        root = (base_url or "").strip().rstrip("/") or DEFAULT_BASE_GEMINI
        return _gemini_generate(key, resolved_model, root, messages, temperature, max_tokens)

    obase = _resolve_openai_base(prov, base_url)
    return _openai_chat(key, resolved_model, obase, messages, temperature, max_tokens)
