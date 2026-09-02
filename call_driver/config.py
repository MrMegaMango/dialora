from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


_load_env_file(ROOT / ".env.local")
_load_env_file(ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    host: str = os.getenv("CALL_DRIVER_HOST", "127.0.0.1")
    port: int = int(os.getenv("CALL_DRIVER_PORT", "4310"))
    brain_provider: str = os.getenv("BRAIN_PROVIDER", "local").lower()
    local_llm_model: str = os.getenv(
        "LOCAL_LLM_MODEL", "mlx-community/Qwen3.5-4B-MLX-4bit"
    )
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-5.4-mini")
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY")
    whisper_model: str = os.getenv(
        "WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo"
    )
    tts_base_url: str = os.getenv("TTS_BASE_URL", "http://127.0.0.1:8880").rstrip(
        "/"
    )
    tts_voice: str = os.getenv("TTS_VOICE", "af_heart")
    tts_speed: float = float(os.getenv("TTS_SPEED", "1.0"))
    sessions_dir: Path = ROOT / "data" / "sessions"


settings = Settings()
