#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo 'Node.js 22 이상이 필요합니다.' >&2
  exit 1
fi

# Prefer an explicit interpreter, then this checkout's venv. This workspace's
# checkout lives below .publish/, so a prepared ancestor venv can be reused.
python_bin="${COOL_SYDNEY_PYTHON:-}"
if [[ -z "$python_bin" && -x "$project_dir/.venv/bin/python" ]]; then
  python_bin="$project_dir/.venv/bin/python"
fi
if [[ -z "$python_bin" ]]; then
  for parent in "$project_dir/.." "$project_dir/../.."; do
    candidate="$parent/.venv/bin/python"
    if [[ -x "$candidate" ]] && "$candidate" -c 'import pyarrow' >/dev/null 2>&1; then
      python_bin="$candidate"
      break
    fi
  done
fi
if [[ -z "$python_bin" ]]; then
  python3 -m venv "$project_dir/.venv"
  python_bin="$project_dir/.venv/bin/python"
fi
if ! "$python_bin" -c 'import pyarrow' >/dev/null 2>&1; then
  if [[ "$python_bin" != "$project_dir/.venv/bin/python" ]]; then
    echo 'COOL_SYDNEY_PYTHON 환경에 PyArrow가 필요합니다. 해당 환경에 cool-sydney/requirements.txt를 설치하세요.' >&2
    exit 1
  fi
  "$python_bin" -m pip install -r "$project_dir/cool-sydney/requirements.txt"
fi
export COOL_SYDNEY_PYTHON="$python_bin"
printf '실행 코드: %s\n' "$project_dir"
printf 'Python: %s\n' "$python_bin"
node cool-sydney/prepare-data.js "$@"
echo '데이터 준비 완료. 대시보드를 시작합니다. 종료: Ctrl+C'
exec node cool-sydney/server.js
