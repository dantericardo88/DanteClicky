#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:-dist-artifacts}"
manifest_path="${2:-latest.json}"
expected_tag="${3:-}"
expected_repository="${4:-}"

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

if [[ ! -f "$manifest_path" ]]; then
  echo "manifest '$manifest_path' does not exist" >&2
  exit 1
fi

python - "$manifest_path" "$artifact_dir" "$expected_tag" "$expected_repository" <<'PY'
import json
from pathlib import Path
import sys
from urllib.parse import unquote, urlparse

path = sys.argv[1]
artifact_dir = Path(sys.argv[2])
expected_tag = sys.argv[3]
expected_repository = sys.argv[4]
with open(path, "r", encoding="utf-8-sig") as f:
    manifest = json.load(f)

if expected_tag:
    expected_version = expected_tag.removeprefix("v")
    if manifest.get("version") != expected_version:
        raise SystemExit(
            f"latest.json version '{manifest.get('version')}' does not match expected tag '{expected_tag}'"
        )
import re
version = manifest.get("version")
if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?", version):
    raise SystemExit(f"latest.json version '{version}' is not a valid SemVer-like version")
pub_date = manifest.get("pub_date")
if not isinstance(pub_date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", pub_date):
    raise SystemExit("latest.json pub_date must be an RFC3339 UTC timestamp like 2026-05-10T00:00:00Z")

required = ["windows-x86_64", "darwin-aarch64", "darwin-x86_64", "linux-x86_64"]
platforms = manifest.get("platforms", {})
for platform_key in platforms:
    if platform_key not in required:
        raise SystemExit(f"latest.json contains unexpected platform key '{platform_key}'")
for platform in required:
    entry = platforms.get(platform)
    if not entry:
        raise SystemExit(f"latest.json is missing platform '{platform}'")
    if not entry.get("signature"):
        raise SystemExit(f"latest.json platform '{platform}' is missing a signature")
    if not entry.get("url"):
        raise SystemExit(f"latest.json platform '{platform}' is missing a URL")
    parsed = urlparse(entry["url"])
    if parsed.scheme != "https":
        raise SystemExit(f"latest.json platform '{platform}' URL must use https")
    if expected_repository and parsed.netloc != "github.com":
        raise SystemExit(f"latest.json platform '{platform}' URL must point to github.com")
    if expected_repository and not parsed.path.startswith(f"/{expected_repository}/releases/download/"):
        raise SystemExit(f"latest.json platform '{platform}' URL does not point to {expected_repository} release downloads")
    if expected_tag and f"/releases/download/{expected_tag}/" not in parsed.path:
        raise SystemExit(f"latest.json platform '{platform}' URL does not point to release tag '{expected_tag}'")

    asset_name = unquote(Path(parsed.path).name)
    artifact_matches = [candidate for candidate in artifact_dir.rglob("*") if candidate.is_file() and candidate.name == asset_name]
    if not artifact_matches:
        raise SystemExit(
            f"latest.json platform '{platform}' URL points to '{asset_name}', "
            "but that artifact was not downloaded"
        )
    sig_name = f"{asset_name}.sig"
    sig_matches = [candidate for candidate in artifact_dir.rglob("*") if candidate.is_file() and candidate.name == sig_name]
    if not sig_matches:
        raise SystemExit(
            f"latest.json platform '{platform}' references '{asset_name}', but '{sig_name}' was not downloaded"
        )
    sig_content = sig_matches[0].read_text(encoding="utf-8-sig").strip()
    if not sig_content:
        raise SystemExit(f"updater signature file '{sig_name}' is empty")
    if entry["signature"].strip() != sig_content:
        raise SystemExit(f"latest.json platform '{platform}' signature does not match '{sig_name}' content")
print("ok: latest.json contains all expected updater platforms")
PY

echo "release artifact verification passed"
