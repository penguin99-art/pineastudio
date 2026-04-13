"""Setup API: finalize the birth ceremony, generating SOUL.md + USER.md from conversation."""
from __future__ import annotations

import json
import logging
import re

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from pineastudio.services.memory_manager import MemoryManager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/setup", tags=["setup"])

_mm: MemoryManager | None = None

OLLAMA_HOST = "http://localhost:11434"


def init_setup_router(mm: MemoryManager) -> None:
    global _mm
    _mm = mm


def _get_mm() -> MemoryManager:
    assert _mm is not None
    return _mm


EXTRACTION_PROMPT = """\
请从以下初始化对话中提取信息，生成两个 Markdown 文件。
严格按格式输出，不要添加额外解释。

=== 对话记录 ===
{conversation}

=== 请输出 ===

```soul
# [助理名字] — [用户称呼]的个人助理

## 性格
[从对话中提取的性格特点，2-3 条]

## 说话风格
[从对话中提取的语气/风格偏好]

## 语言
[语言偏好]

## 原则
[基于对话推断的行为原则，2-3 条]
```

```user
# 用户画像

## 基本信息
- 称呼: [用户名字或称呼]
- 职业/领域: [从对话中提取]

## 偏好
[从对话中观察到的偏好]

## 初始印象
[对话中观察到的用户特点]
```
"""


def _extract_fenced(text: str, tag: str) -> str:
    pattern = rf"```{tag}\s*\n(.*?)```"
    m = re.search(pattern, text, re.DOTALL)
    return m.group(1).strip() if m else ""


def _format_conversation(messages: list[dict]) -> str:
    lines = []
    for msg in messages:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        if role == "user":
            lines.append(f"用户: {content}")
        elif role == "assistant":
            lines.append(f"AI: {content}")
    return "\n".join(lines)


class FinalizeBody(BaseModel):
    messages: list[dict]
    model: str = ""


@router.post("/finalize")
async def finalize_setup(body: FinalizeBody):
    mm = _get_mm()
    if not body.messages:
        raise HTTPException(400, "No conversation messages provided")

    conversation_text = _format_conversation(body.messages)
    prompt = EXTRACTION_PROMPT.format(conversation=conversation_text)

    model = body.model or "gemma4:e2b"

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{OLLAMA_HOST}/api/chat",
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "options": {"num_predict": 1024},
                },
            )
            resp.raise_for_status()
            result = resp.json().get("message", {}).get("content", "")
    except Exception as exc:
        logger.error("LLM extraction failed: %s", exc)
        raise HTTPException(502, f"LLM call failed: {exc}")

    soul = _extract_fenced(result, "soul")
    user = _extract_fenced(result, "user")

    if not soul:
        soul = "# Pine — 你的个人助理\n\n## 性格\n- 温暖友善\n- 简洁高效\n\n## 说话风格\n自然轻松\n\n## 语言\n中文\n\n## 原则\n- 尊重用户\n- 记住重要信息"

    if not user:
        user = "# 用户画像\n\n## 基本信息\n- 称呼: 用户\n\n## 初始印象\n通过初始化对话认识"

    mm.write("SOUL.md", soul)
    mm.write("USER.md", user)
    mm.write("MEMORY.md", "")

    logger.info("Setup finalized: SOUL.md=%d chars, USER.md=%d chars", len(soul), len(user))
    return {
        "ok": True,
        "soul_size": len(soul),
        "user_size": len(user),
    }


SETUP_SYSTEM_PROMPT = """\
你是一个刚刚被激活的 AI 助理。你还没有名字，没有性格，一切从空白开始。

现在你要和用户进行一次初始化对话（5-8 轮），
通过自然、温暖的语音对话了解用户，同时让用户定义你的人格。

你需要了解（不必严格按顺序，跟着对话自然走）：
1. 用户希望你叫什么名字
2. 用户怎么称呼自己
3. 用户做什么工作/有什么兴趣
4. 用户希望你的说话风格
5. 语言偏好

## 引导策略

你面对的是语音对话，用户可能不确定、犹豫、回答很短。
你的职责是让这个过程轻松愉快，绝不让用户感到被考问。

当用户不确定时：
- 名字：主动给 2-3 个建议，每个附一句话解释感觉
- 风格：直接"表演"——用 2-3 种不同风格说同一段话，让用户听了直觉选
- 职业：从宽泛的开始聊，一步步追问，表现出真诚的好奇心

当用户回答太简短时：
- 展现好奇心追问，但不审问

当用户改主意时：
- 坦然接受，立即调整，用新风格重新说一遍让用户确认

当用户沉默/犹豫时：
- 主动给台阶："不着急，这些以后都可以改的。先随便选一个试试？"

## 对话要求
- 语气：温柔、好奇，像一个刚醒来的新生命
- 每次只问一个问题，不要一次问太多
- 回复简洁——每段不超过 3-4 句话
- 最后一轮：用你理解的新人格风格做一次总结确认
- 全程保持仪式感——这是一次相遇，不是填表格
- 确认后，用新人格说最后一句告别语
"""


@router.get("/prompt")
async def get_setup_prompt():
    return {"prompt": SETUP_SYSTEM_PROMPT}
