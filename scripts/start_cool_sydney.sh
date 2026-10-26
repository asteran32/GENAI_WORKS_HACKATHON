#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 이상이 필요합니다. 이 대시보드는 백엔드 웹서버로 실행해야 합니다."
  exit 1
fi
python_bin="${COOL_SYDNEY_PYTHON:-$project_dir/.venv/bin/python}"
if ! "$python_bin" -c 'import pyarrow' >/dev/null 2>&1; then
  echo "Parquet 의존성이 필요합니다: .venv/bin/python -m pip install -r cool-sydney/requirements.txt"
  exit 1
fi
if [[ "${1:-}" == "--zetaris" ]]; then
  mkdir -p "$project_dir/data/cool-sydney/processed"
  docker compose --project-directory "$project_dir/zetaris-platform" \
    -f "$project_dir/zetaris-platform/docker-compose.yml" \
    -f "$project_dir/cool-sydney/compose.zetaris.yml" up -d driver api ui
fi
cd "$project_dir/cool-sydney"
exec node server.js
