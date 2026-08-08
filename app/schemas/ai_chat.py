# app/schemas/ai_chat.py
from typing import Any

from pydantic import BaseModel


class ChatMessageIn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatContext(BaseModel):
    page: str | None = None


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessageIn] = []
    context: ChatContext | None = None


class ToolCall(BaseModel):
    id: str
    name: str
    args: dict[str, Any]
    result: Any | None = None


class ChatResponse(BaseModel):
    response: str
    tool_calls: list[ToolCall] | None = None
