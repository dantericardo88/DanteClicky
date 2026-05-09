#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:-dist-artifacts}"
manifest_path="${2:-latest.json}"

require_match() {
  local pattern="$1"
  local label="$2"
  local match
  match="$(find "$artifact_dir" -type f -name "$pattern" -print -quit)"
  if [[ -z "$match" ]]; then
    echo "missing $label artifact matching '$pattern' under '$artifact_dir'" >&2
    exit 1
  fi
  echo "ok: $label -> $match"
}

if [[ ! -d "$artifact_dir" ]]; then
  echo "artifact directory '$artifact_dir' does not exist" >&2
  exit 1
fi

require_match "*.exe" "Windows installer"
require_match "*.exe.sig" "Windows updater signature"
require_match "*.app.tar.gz" "macOS updater bundle"
require_match "*.app.tar.gz.sig" "macOS updater signature"
require_match "*.AppImage" "Linux AppImage"
require_match "*.AppImage.sig" "Linux updater signature"

if [[ -f "$manifest_path" ]]; then
  python - "$manifest_path" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    manifest = json.load(f)

required = ["windows-x86_64", "darwin-aarch64", "darwin-x86_64", "linux-x86_64"]
for platform in required:
    entry = manifest.get("platforms", {}).get(platform)
    if not entry:
        raise SystemExit(f"latest.json is missing platform '{platform}'")
    if not entry.get("signature"):
        raise SystemExit(f"latest.json platform '{platform}' is missing a signature")
    if not entry.get("url"):
        raise SystemExit(f"latest.json platform '{platform}' is missing a URL")
print("ok: latest.json contains all expected updater platforms")
PY
fi

echo "release artifact verification passed"

