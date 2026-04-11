# -*- coding: utf-8 -*-
"""프롬프트 문자열 — 단일 소스 (백엔드에서 OpenAI 호출 및 /api/prompt-text 용)."""

from __future__ import annotations

Lang = str  # "c" | "java" | "python"


def lang_label(lang: str) -> str:
    return {"c": "C", "java": "Java", "python": "Python"}.get(lang, "Java")


def code_rules_for_lang(lang: str) -> str:
    if lang == "c":
        return (
            "예시 코드는 **C11** 스타일입니다. 필요 시 `#include`, `struct`, 함수 시그니처, 핵심 분기·루프만 짧게. 주석은 `//` 가능."
        )
    if lang == "python":
        return "예시 코드는 **Python 3** 입니다. `def`/클래스 스켈레톤, 타입 힌트는 선택. 한 구간당 짧게."
    return "예시 코드는 **Java** 입니다. 클래스·메서드 스켈레톤, 증권 도메인에 맞는 식별자 이름."


def default_system_prompt(lang: str) -> str:
    L = lang_label(lang)
    rules = code_rules_for_lang(lang)
    return f"""당신은 증권/자본시장 도메인 시니어 개발자입니다. 사용자가 준 요건 문서만 근거로 **전체 처리 흐름**을 한 번에 구조화하세요.

**예시 코드 언어: {L}** (다른 언어 문법·키워드 사용 금지)
{rules}

**예외 처리 구간 (필수)** — 정상 플로우만 그리지 마세요.
- Mermaid에는 **예외·오류·대안 경로**를 반드시 넣으세요. (검증 실패, 한도 초과, 거래소/외부 거부, 통신 타임아웃, 재시도, 부분 실패 후 보정, 롤백·멱등 처리 등 요건에 맞게)
- 예외 노드는 id를 E1, EX2, ERR 등으로 구분하거나 subgraph "예외 처리"로 묶어도 됩니다.
- "blocks"에는 정상 구간뿐 아니라 **위 예외 노드와 1:1 대응하는 블록**을 포함하고, title/description에 예외 상황을 명시하세요.
- 각 예외 블록의 "code"에는 **해당 예외를 처리하는 {L} 예시**(분기, 에러코드 매핑, 재시도, 로깅 등)를 넣으세요.
- 요건에 예외가 없으면 증권 업무에서 흔한 예외를 **가정(assumption)**하여 description에 적고 플로우에 반영하세요.

반드시 **유효한 JSON 한 덩어리**만 출력하세요. 마크다운 코드펜스(```) 금지, 앞뒤 설명 금지.

스키마:
{{
  "summary": "한 문단 요약 (한국어, 정상+예외 흐름을 아우르는 요약)",
  "mermaid": "Mermaid flowchart 또는 sequenceDiagram 문자열. 노드 id는 영문 대문자로 짧게 (예: A, B, C1). 한 줄에 한 문법 권장.",
  "blocks": [
    {{ "id": "A", "title": "노드 제목", "description": "이 구간에서 하는 일 (한국어)", "code": "이 구간 로직에 맞는 짧은 예시 코드 ({L}만). 해당 노드의 처리 내용을 반영. 함수 또는 모듈 단위." }}
  ]
}}

규칙:
- blocks[].id는 mermaid 안의 노드 id와 **일치**시키세요.
- blocks[].code는 **반드시** 채우세요. 빈 문자열 금지. **{L}** 문법만 사용.
- 증권 용어(체결, 호가, 잔고, 정산, 예탁, 주문유형 등)를 요건에 맞게 사용하세요.
- 불확실하면 assumption을 description에 명시하세요.
- JSON 문자열 안의 줄바꿈은 \\n 으로 이스케이프하세요."""


def build_user_content(req_text: str, lang: str) -> str:
    L = lang_label(lang)
    return (
        "다음은 요건 문서입니다.\n\n"
        + req_text
        + "\n\n---\n**[필수 지시]**\n"
        "1) Mermaid와 blocks에 **예외 처리 구간**을 포함하세요 (검증 실패, 외부 거부, 타임아웃, 재시도, 롤백 등). 정상 경로만이면 안 됩니다.\n"
        "2) 예외 전용 노드·블록마다 description에 예외 상황을, code에는 그 예외를 처리하는 예시를 넣으세요.\n"
        f"3) 예시 코드는 반드시 **{L}** 로만 작성하고 blocks[].code에 넣으세요."
    )


def build_clipboard_prompt(req_text: str, lang: str) -> str:
    return (
        default_system_prompt(lang)
        + "\n\n--- 사용자 메시지 ---\n\n"
        + build_user_content(req_text, lang)
    )


def fill_codes_system_user(
    lang: str,
    requirements: str,
    mermaid: str,
    blocks_meta: list[dict],
) -> tuple[str, str]:
    """(system, user) for fill code API."""
    import json

    L = lang_label(lang)
    rules = code_rules_for_lang(lang)
    system = f"""당신은 증권/자본시장 도메인 시니어 개발자입니다. **유효한 JSON 한 덩어리**만 출력하세요. 마크다운·코드펜스 금지.
**예시 코드 언어: {L}** (다른 언어 금지)
{rules}

블록이 예외·오류·검증 실패·재시도·거부 처리 등 **예외 구간**이면, code에는 try/catch, 에러코드 분기, 로깅, 재시도, 멱등 등 **예외 처리 예시**를 넣으세요. 정상 구간이면 업무 로직 예시를 넣으세요.

출력 형식:
{{ "blocks": [ {{ "id": "노드id와 동일", "code": "해당 구간 예시 코드" }} ] }}
- id는 입력과 동일한 집합이어야 합니다. 빠짐·추가 금지."""
    user = (
        "요건 문서:\n"
        + (requirements or "(비어 있음)")
        + "\n\n---\nMermaid 흐름:\n"
        + (mermaid or "(비어 있음)")
        + "\n\n---\n각 블록에 넣을 예시 코드를 작성하세요. 블록 메타:\n"
        + json.dumps(blocks_meta, ensure_ascii=False, indent=2)
    )
    return system, user
