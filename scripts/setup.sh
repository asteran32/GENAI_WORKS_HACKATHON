#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
umask 077

if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi
export PIP_CACHE_DIR="$PWD/.cache/pip"
if [[ -d .cache/wheels ]]; then
  .venv/bin/python -m pip install --disable-pip-version-check --no-index --find-links .cache/wheels -r requirements.txt ||
    .venv/bin/python -m pip install --disable-pip-version-check -r requirements.txt
else
  .venv/bin/python -m pip install --disable-pip-version-check -r requirements.txt
fi
.venv/bin/python -m pip check

if [[ ! -f .env ]]; then
  cp .env.example .env
fi
chmod 600 .env

printf '%s\n' 'Python environment ready. Enter your keys in .env, then run:'
printf '%s\n' '  .venv/bin/python smoke_test.py --config-only'
printf '%s\n' '  .venv/bin/python smoke_test.py'
