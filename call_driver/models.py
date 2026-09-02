from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CallStatus(StrEnum):
    PREPARED = "prepared"
    ACTIVE = "active"
    TAKEOVER = "takeover"
    SUCCEEDED = "succeeded"
    ENDED = "ended"


class CallBrief(BaseModel):
    calling_on_behalf_of: str = Field(default="Zuo", min_length=1, max_length=80)
    contact_name: str = Field(default="", max_length=100)
    organization: str = Field(default="", max_length=120)
    phone_number: str = Field(default="", max_length=30)
    intention: str = Field(min_length=5, max_length=2000)
    facts: str = Field(default="", max_length=4000)
    boundaries: str = Field(default="", max_length=2000)
    success_definition: str = Field(default="", max_length=1200)
    voice: str = Field(default="af_heart", max_length=100)
    speed: float = Field(default=1.0, ge=0.7, le=1.4)

    @field_validator("phone_number")
    @classmethod
    def validate_phone_number(cls, value: str) -> str:
        value = value.strip()
        if not value:
            return value
        allowed = set("+0123456789 ()-.")
        digits = sum(character.isdigit() for character in value)
        if any(character not in allowed for character in value) or not 7 <= digits <= 15:
            raise ValueError("Enter a valid phone number with 7 to 15 digits")
        return value


class TranscriptTurn(BaseModel):
    role: Literal["agent", "recipient", "system"]
    text: str
    at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class AgentDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    say: str = Field(max_length=700)
    status: Literal["continue", "success", "handoff", "end"] = "continue"
    reason: str = Field(default="", max_length=500)
    facts_learned: list[str] = Field(default_factory=list, max_length=8)
    next_goal: str = Field(default="", max_length=500)


class CallSession(BaseModel):
    id: str
    brief: CallBrief
    status: CallStatus = CallStatus.PREPARED
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    transcript: list[TranscriptTurn] = Field(default_factory=list)
    permission_granted: bool = False
    learned_facts: list[str] = Field(default_factory=list)
    next_goal: str = "Ask for permission to continue"
    end_reason: str = ""


class TurnInput(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class SpeechInput(BaseModel):
    text: str = Field(min_length=1, max_length=1200)
    voice: str = Field(default="af_heart", max_length=100)
    speed: float = Field(default=1.0, ge=0.7, le=1.4)
