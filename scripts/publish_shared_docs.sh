#!/usr/bin/env bash
set -euo pipefail

# Upload the HTML/Markdown architecture and six participant documents.
# Run from a terminal with GitHub network access and repository write access.
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_url="https://github.com/asteran32/GENAI_WORKS_HACKATHON.git"
documents=(
  ikea-ar-architecture.html
  ikea-ar-architecture.md
  event_calendar.txt
  f_and_q.txt
  hackathon_overview.txt
  participant_journey_map.txt
  solution_approach.txt
  welcome_guide.txt
)

for document in "${documents[@]}"; do
  if [[ ! -f "$project_root/shared/$document" ]]; then
    printf 'Missing document: %s\n' "$document" >&2
    exit 1
  fi
done

upload_checkout="$(mktemp -d "${TMPDIR:-/tmp}/genai-shared.XXXXXX")"
printf 'Temporary checkout: %s\n' "$upload_checkout"
printf '[1/4] Cloning the GitHub repository...\n'
git clone "$repository_url" "$upload_checkout"
target_branch="$(git -C "$upload_checkout" symbolic-ref --short HEAD)"
mkdir -p "$upload_checkout/shared"

printf '[2/4] Preparing %s documents...\n' "${#documents[@]}"
paths=()
for document in "${documents[@]}"; do
  cp "$project_root/shared/$document" "$upload_checkout/shared/$document"
  paths+=("shared/$document")
done

git -C "$upload_checkout" add -- "${paths[@]}"
if git -C "$upload_checkout" diff --cached --quiet; then
  printf 'All %s documents already match the remote repository.\n' "${#documents[@]}"
  exit 0
fi

git --no-pager -C "$upload_checkout" diff --cached --stat
printf '[3/4] Creating the commit...\n'
git -C "$upload_checkout" commit -m "Add web-first IKEA assembly architecture and hackathon guides"
printf '[4/4] Pushing to GitHub...\n'
git -C "$upload_checkout" push origin "HEAD:refs/heads/$target_branch"
printf 'Uploaded: https://github.com/asteran32/GENAI_WORKS_HACKATHON/tree/%s/shared\n' "$target_branch"
