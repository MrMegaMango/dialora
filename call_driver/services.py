from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from typing import Any

import httpx

from .config import Settings


class SpeechRecognizer:
    def __init__(self, model_name: str):
        self.model_name = model_name
        self._lock = asyncio.Lock()
        self._warmed = False

    @property
    def warmed(self) -> bool:
        return self._warmed

    def _warm_sync(self) -> None:
        import mlx.core as mx
        from mlx_whisper.transcribe import ModelHolder

        ModelHolder.get_model(self.model_name, mx.float16)
        self._warmed = True

    async def warm_up(self) -> None:
        async with self._lock:
            if not self._warmed:
                await asyncio.to_thread(self._warm_sync)

    def _transcribe_sync(self, path: str, prompt: str) -> dict[str, Any]:
        import mlx_whisper

        return mlx_whisper.transcribe(
            path,
            path_or_hf_repo=self.model_name,
            language="en",
            initial_prompt=prompt or None,
            condition_on_previous_text=False,
            verbose=None,
        )

    async def transcribe(self, audio: bytes, extension: str, prompt: str = "") -> str:
        suffix = extension if extension.startswith(".") else f".{extension}"
        if suffix not in {".webm", ".mp4", ".m4a", ".wav", ".ogg", ".mp3"}:
            suffix = ".webm"
        descriptor, path = tempfile.mkstemp(prefix="call-driver-", suffix=suffix)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(audio)
            async with self._lock:
                result = await asyncio.to_thread(self._transcribe_sync, path, prompt)
                self._warmed = True
            return str(result.get("text", "")).strip()
        finally:
            Path(path).unlink(missing_ok=True)


class KokoroClient:
    def __init__(self, config: Settings):
        self.base_url = config.tts_base_url

    async def health(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=2) as client:
                response = await client.get(f"{self.base_url}/health")
            return response.is_success
        except httpx.HTTPError:
            return False

    async def voices(self) -> Any:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{self.base_url}/v1/audio/voices")
            response.raise_for_status()
            return response.json()

    async def speak(self, text: str, voice: str, speed: float) -> bytes:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{self.base_url}/v1/audio/speech",
                json={
                    "model": "kokoro",
                    "input": text,
                    "voice": voice,
                    "response_format": "mp3",
                    "speed": speed,
                    "stream": False,
                },
            )
            response.raise_for_status()
            return response.content
