from __future__ import annotations

from huggingface_hub import snapshot_download

from call_driver.config import settings


def main() -> None:
    models = [settings.whisper_model]
    if settings.brain_provider == "local":
        models.append(settings.local_llm_model)
    for model in models:
        print(f"Preparing {model}…")
        snapshot_download(model)
    print("Local speech and conversation models are ready.")


if __name__ == "__main__":
    main()
