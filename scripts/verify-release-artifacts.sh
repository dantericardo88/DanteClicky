#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:-dist-artifacts}"
manifest_path="${2:-latest.json}"

require_match() {
  local patterns="$1"
  local label="$2"
  local match
  IFS='|' read -r -a pattern_list <<< "$patterns"
  for pattern in "${pattern_list[@]}"; do
    match="$(find "$artifact_dir" -type f -name "$pattern" -print -quit)"
    if [[ -n "$match" ]]; then
      echo "ok: $label -> $match"
      return 0
    fi
  done

  echo "missing $label artifact matching any of '$patterns' under '$artifact_dir'" >&2
  exit 1
}

if [[ ! -d "$artifact_dir" ]]; then
  echo "artifact directory '$artifact_dir' does not exist" >&2
  exit 1
fi

require_match "*.exe|*.msi" "Windows installer"
require_match "*.exe.sig|*.msi.sig|*.nsis.sig" "Windows updater signature"
require_match "*aarch64*.app.tar.gz|*arm64*.app.tar.gz" "macOS Apple Silicon updater bundle"
require_match "*aarch64*.app.tar.gz.sig|*arm64*.app.tar.gz.sig" "macOS Apple Silicon updater signature"
require_match "*x64*.app.tar.gz|*x86_64*.app.tar.gz" "macOS Intel updater bundle"
require_match "*x64*.app.tar.gz.sig|*x86_64*.app.tar.gz.sig" "macOS Intel updater signature"
require_match "*.AppImage" "Linux AppImage"
require_match "*.AppImage.sig" "Linux updater signature"

if [[ -f "$manifest_path" ]]; then
  python - "$manifest_path" "$artifact_dir" <<'PY'
import json
from pathlib import Path
import sys
from urllib.parse import unquote, urlparse

path = sys.argv[1]
artifact_dir = Path(sys.argv[2])
with open(path, "r", encoding="utf-8-sig") as f:
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
    asset_name = unquote(Path(urlparse(entry["url"]).path).name)
    if not any(candidate.is_file() and candidate.name == asset_name for candidate in artifact_dir.rglob("*")):
        raise SystemExit(
            f"latest.json platform '{platform}' URL points to '{asset_name}', "
            "but that artifact was not downloaded"
        )
print("ok: latest.json contains all expected updater platforms")
PY
fi

echo "release artifact verification passed"
