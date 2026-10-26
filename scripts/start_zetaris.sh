#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../zetaris-platform"

if ! docker_check=$(docker info 2>&1); then
  case "$docker_check" in
    *"permission denied"*|*"operation not permitted"*)
      printf '%s\n' 'This terminal cannot access the Docker socket. Docker may already be running.' >&2
      printf '%s\n' 'Run this script from your Mac terminal, where Docker access is allowed.' >&2
      ;;
    *)
      printf '%s\n' 'The Docker engine is not reachable. Check Docker Desktop and your Docker context.' >&2
      ;;
  esac
  exit 1
fi
unset docker_check

./preflight.sh
mkdir -p ../data/cool-sydney/processed
compose=(docker compose -f docker-compose.yml -f ../cool-sydney/compose.zetaris.yml)
"${compose[@]}" config --quiet
"${compose[@]}" pull
"${compose[@]}" up -d
"${compose[@]}" ps --all

# First-time bootstrap can continue after compose up returns.
for attempt in {1..30}; do
  if ./verify.sh; then
    printf '%s\n' 'Zetaris is ready at http://localhost:3000'
    printf '%s\n' 'Read your login from zetaris-platform/.env in an editor; do not paste secrets into chat.'
    exit 0
  fi
  if [[ "$attempt" -lt 30 ]]; then
    printf 'Waiting for first-time startup (%s/30); retrying in 30 seconds.\n' "$attempt"
    sleep 30
  fi
done

printf '%s\n' 'Verification is still failing. Containers and data have been kept.' >&2
printf '%s\n' 'Inspect the FAIL lines above and rerun zetaris-platform/verify.sh after resolving them.' >&2
exit 1
