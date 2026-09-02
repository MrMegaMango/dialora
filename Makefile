.PHONY: setup run test

setup:
	uv sync
	uv run python -m scripts.setup_models

run:
	uv run python -m call_driver.main

test:
	uv run pytest -q
