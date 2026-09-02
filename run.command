#!/bin/zsh
set -e
cd "${0:A:h}"

if ! command -v uv >/dev/null 2>&1; then
  echo "Dialora needs uv. Install it from https://docs.astral.sh/uv/ and try again."
  read -r "?Press Return to close."
  exit 1
fi

uv sync --quiet
open "http://127.0.0.1:4310"
exec uv run python -m call_driver.main
