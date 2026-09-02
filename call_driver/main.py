from __future__ import annotations

import asyncio
import re
import uuid
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from .config import ROOT, settings
from .engine import create_brain, deterministic_safety_gate
from .models import (
    CallBrief,
    CallSession,
    CallStatus,
    SpeechInput,
    TranscriptTurn,
    TurnInput,
)
from .services import KokoroClient, SpeechRecognizer
from .store import SessionStore


app = FastAPI(title="Call Driver", docs_url=None, redoc_url=None)
store = SessionStore(settings.sessions_dir)
brain = create_brain(settings)
recognizer = SpeechRecognizer(settings.whisper_model)
kokoro = KokoroClient(settings)
static_dir = ROOT / "static"
warmup_task: asyncio.Task | None = None


async def warm_components() -> None:
    await asyncio.gather(recognizer.warm_up(), brain.warm_up())


def opening_for(brief: CallBrief) -> str:
    greeting = f"Hi {brief.contact_name}," if brief.contact_name else "Hello,"
    return (
        f"{greeting} I’m an AI assistant calling on behalf of "
        f"{brief.calling_on_behalf_of}. I use live transcription to follow the call. "
        "Is it okay if I continue?"
    )


def safe_session_id(session_id: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{16}", session_id):
        raise HTTPException(404, "Session not found")
    return session_id


async def require_session(session_id: str) -> CallSession:
    session = await store.get(safe_session_id(session_id))
    if session is None:
        raise HTTPException(404, "Session not found")
    return session


@app.middleware("http")
async def local_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; media-src 'self' blob:; connect-src 'self'"
    )
    return response


@app.get("/api/status")
async def status():
    model_cache = (
        Path.home()
        / ".cache"
        / "huggingface"
        / "hub"
        / f"models--{settings.local_llm_model.replace('/', '--')}"
    )
    whisper_cache = (
        Path.home()
        / ".cache"
        / "huggingface"
        / "hub"
        / f"models--{settings.whisper_model.replace('/', '--')}"
    )
    return {
        "tts": await kokoro.health(),
        "stt": whisper_cache.exists(),
        "stt_warmed": recognizer.warmed,
        "brain_provider": settings.brain_provider,
        "brain_ready": settings.brain_provider == "mock"
        or (settings.brain_provider == "openai" and bool(settings.openai_api_key))
        or (settings.brain_provider == "local" and model_cache.exists()),
        "brain_model": settings.local_llm_model
        if settings.brain_provider == "local"
        else settings.openai_model,
        "brain_warmed": brain.warmed,
        "phone_app": Path("/System/Applications/Phone.app").exists(),
        "default_voice": settings.tts_voice,
        "default_speed": settings.tts_speed,
    }


@app.post("/api/warmup", status_code=202)
async def warmup():
    global warmup_task
    if warmup_task is None or warmup_task.done():
        warmup_task = asyncio.create_task(warm_components())
    return {"status": "warming" if not warmup_task.done() else "ready"}


@app.get("/api/voices")
async def voices():
    try:
        return await kokoro.voices()
    except httpx.HTTPError as error:
        raise HTTPException(503, f"Kokoro is unavailable: {error}") from error


@app.post("/api/sessions", status_code=201)
async def create_session(brief: CallBrief):
    session = CallSession(id=uuid.uuid4().hex[:16], brief=brief)
    session.transcript.append(TranscriptTurn(role="agent", text=opening_for(brief)))
    await store.save(session)
    return session


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    return await require_session(session_id)


@app.post("/api/sessions/{session_id}/turn")
async def next_turn(session_id: str, turn: TurnInput):
    session = await require_session(session_id)
    if session.status in {CallStatus.SUCCEEDED, CallStatus.ENDED}:
        raise HTTPException(409, "This session has already ended")
    session.status = CallStatus.ACTIVE
    session.transcript.append(TranscriptTurn(role="recipient", text=turn.text.strip()))
    decision = deterministic_safety_gate(session, turn.text.strip())
    if decision is None:
        try:
            decision = await brain.decide(session, turn.text.strip())
        except Exception as error:
            session.status = CallStatus.TAKEOVER
            session.next_goal = "Take over: the conversation brain needs attention"
            session.end_reason = str(error)[:300]
            await store.save(session)
            raise HTTPException(503, f"Conversation brain unavailable: {error}") from error

    if decision.say:
        session.transcript.append(TranscriptTurn(role="agent", text=decision.say))
    for fact in decision.facts_learned:
        clean_fact = fact.strip()
        if clean_fact and clean_fact not in session.learned_facts:
            session.learned_facts.append(clean_fact[:500])
    session.learned_facts = session.learned_facts[-30:]
    session.next_goal = decision.next_goal
    session.end_reason = decision.reason
    session.status = {
        "continue": CallStatus.ACTIVE,
        "success": CallStatus.SUCCEEDED,
        "handoff": CallStatus.TAKEOVER,
        "end": CallStatus.ENDED,
    }[decision.status]
    await store.save(session)
    return {"decision": decision, "session": session}


@app.post("/api/sessions/{session_id}/transcribe")
async def transcribe(session_id: str, request: Request):
    session = await require_session(session_id)
    audio = await request.body()
    if not 1_000 <= len(audio) <= 20_000_000:
        raise HTTPException(400, "Audio must be between 1 KB and 20 MB")
    extension = request.headers.get("x-audio-extension", "webm")
    prompt = " ".join(
        filter(
            None,
            [
                session.brief.contact_name,
                session.brief.organization,
                session.brief.intention[:500],
            ],
        )
    )
    try:
        text = await recognizer.transcribe(audio, extension, prompt)
    except Exception as error:
        raise HTTPException(503, f"Local transcription failed: {error}") from error
    return {"text": text}


@app.post("/api/speech")
async def speech(speech_input: SpeechInput):
    try:
        audio = await kokoro.speak(
            speech_input.text, speech_input.voice, speech_input.speed
        )
    except Exception as error:
        raise HTTPException(503, f"Kokoro is unavailable: {error}") from error
    return Response(content=audio, media_type="audio/mpeg")


@app.post("/api/sessions/{session_id}/pause")
async def pause_session(session_id: str):
    session = await require_session(session_id)
    session.status = CallStatus.TAKEOVER
    await store.save(session)
    return session


@app.post("/api/sessions/{session_id}/resume")
async def resume_session(session_id: str):
    session = await require_session(session_id)
    if session.status in {CallStatus.SUCCEEDED, CallStatus.ENDED}:
        raise HTTPException(409, "This session has already ended")
    session.status = CallStatus.ACTIVE
    await store.save(session)
    return session


@app.post("/api/sessions/{session_id}/end")
async def end_session(session_id: str):
    session = await require_session(session_id)
    session.status = CallStatus.ENDED
    session.end_reason = session.end_reason or "Ended by operator"
    await store.save(session)
    return session


@app.get("/api/sessions/{session_id}/transcript.txt")
async def export_transcript(session_id: str):
    session = await require_session(session_id)
    lines = [
        f"Call intention: {session.brief.intention}",
        f"Status: {session.status}",
        "",
    ]
    lines.extend(
        f"[{turn.at.astimezone().strftime('%H:%M:%S')}] {turn.role.upper()}: {turn.text}"
        for turn in session.transcript
    )
    return PlainTextResponse(
        "\n".join(lines),
        headers={
            "Content-Disposition": f'attachment; filename="call-{session.id}.txt"'
        },
    )


@app.get("/")
async def index():
    return FileResponse(static_dir / "index.html")


app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.exception_handler(404)
async def not_found(_: Request, exception: HTTPException):
    return JSONResponse({"detail": exception.detail}, status_code=404)


def run() -> None:
    import uvicorn

    uvicorn.run(
        "call_driver.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        loop="asyncio",
    )


if __name__ == "__main__":
    run()
