import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function dependencySection(cargoToml: string): string {
  const start = cargoToml.indexOf("[dependencies]");
  const nextTable = cargoToml.slice(start + "[dependencies]".length).search(/^\[/m);
  const end = nextTable === -1
    ? cargoToml.length
    : start + "[dependencies]".length + nextTable;
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return cargoToml.slice(start, end);
}

describe("cross-platform architecture", () => {
  it("keeps Windows API crates and capture backends behind Windows target gates", () => {
    const cargoToml = readProjectFile("src-tauri/Cargo.toml");
    const videoMod = readProjectFile("src-tauri/src/video/mod.rs");
    const deps = dependencySection(cargoToml);

    expect(deps).not.toMatch(/^\s*windows\s*=/m);
    expect(deps).not.toMatch(/^\s*windows-capture\s*=/m);
    expect(cargoToml).toMatch(/\[target\.'cfg\(target_os = "windows"\)'\.dependencies\]/);
    expect(cargoToml).toMatch(/windows\s*=\s*\{[\s\S]*Win32_UI_Accessibility/);
    expect(cargoToml).toMatch(/windows-capture\s*=\s*\{[\s\S]*optional\s*=\s*true/);
    expect(videoMod).toContain("all(feature = \"video-hw-capture\", target_os = \"windows\")");
    expect(existsSync(resolve(root, "src-tauri/src/video/capture_hw.rs"))).toBe(true);
  });

  it("provides non-Windows fallbacks for platform-specific Rust commands", () => {
    const accessibility = readProjectFile("src-tauri/src/accessibility.rs");
    const cursor = readProjectFile("src-tauri/src/cursor.rs");
    const ocr = readProjectFile("src-tauri/src/ocr.rs");
    const overlay = readProjectFile("src-tauri/src/overlay.rs");

    expect(accessibility).toContain("#[cfg(not(target_os = \"windows\"))]");
    expect(accessibility).toContain("pub fn get_ui_tree() -> Vec<UiElement>");
    expect(accessibility).toContain("Vec::new()");

    expect(cursor).toContain("#[cfg(not(target_os = \"windows\"))]");
    expect(cursor).toContain("enigo");
    expect(cursor).toContain("animate_cursor_to_blocking");

    expect(ocr).toContain("#[cfg(not(target_os = \"windows\"))]");
    expect(ocr).toContain("pub async fn ocr_screenshot");
    expect(ocr).toContain("String::new()");

    expect(overlay).toContain("#[cfg(not(target_os = \"windows\"))]");
    expect(overlay).toContain("overlay stealth is only supported on Windows");
  });

  it("exposes a first-class platform capability contract to the app", () => {
    const platformPath = resolve(root, "src-tauri/src/platform.rs");
    expect(existsSync(platformPath)).toBe(true);

    const platform = readProjectFile("src-tauri/src/platform.rs");
    const lib = readProjectFile("src-tauri/src/lib.rs");

    expect(platform).toContain("pub struct PlatformCapabilities");
    expect(platform).toContain("pub struct CapabilityStatus");
    expect(platform).toContain("get_platform_capabilities");
    expect(platform).toContain("windows");
    expect(platform).toContain("macos");
    expect(platform).toContain("linux");
    expect(platform).toContain("nativeScreenCapture");
    expect(platform).toContain("nativeInputControl");
    expect(platform).toContain("accessibilityTree");

    expect(lib).toContain("mod platform;");
    expect(lib).toContain("platform::get_platform_capabilities");
  });

  it("uses the same managed session database state type for registered commands", () => {
    const session = readProjectFile("src-tauri/src/session.rs");
    const lib = readProjectFile("src-tauri/src/lib.rs");

    expect(lib).toContain(".manage(Arc::new(db))");
    expect(session).not.toContain("tauri::State<'_, SessionDb>");
    expect(session).not.toContain("app.state::<SessionDb>()");
    expect(session).toContain("tauri::State<'_, Arc<SessionDb>>");
    expect(session).toContain("app.state::<Arc<SessionDb>>()");
  });

  it("build and release workflows exercise Windows, macOS, and Linux", () => {
    const buildWorkflow = readProjectFile(".github/workflows/build.yml");
    const releaseWorkflow = readProjectFile(".github/workflows/release.yml");
    const latestManifestScript = readProjectFile("scripts/generate-latest-manifest.mjs");
    const tauriConfig = readProjectFile("src-tauri/tauri.conf.json");

    for (const workflow of [buildWorkflow, releaseWorkflow]) {
      expect(workflow).toContain("windows-latest");
      expect(workflow).toContain("macos-latest");
      expect(workflow).toContain("ubuntu-latest");
      expect(workflow).toContain("matrix:");
      expect(workflow).toContain("libwebkit2gtk-4.1-dev");
      expect(workflow).toContain("build-essential");
      expect(workflow).toContain("libayatana-appindicator3-dev");
      expect(workflow).toContain("libssl-dev");
    }

    expect(buildWorkflow).toContain("cargo check --manifest-path src-tauri/Cargo.toml --locked");
    expect(buildWorkflow).toContain("workflow_dispatch");
    expect(buildWorkflow).toContain("startsWith(github.ref, 'refs/heads/feat/')");
    expect(buildWorkflow).toContain("scripts/ci-runtime-smoke.ps1");
    expect(buildWorkflow).toContain("xvfb-run -a dbus-run-session");
    expect(buildWorkflow).toContain("danteclicky-${{ matrix.os }}-runtime-smoke");
    expect(buildWorkflow).toContain("actions/upload-artifact@v4");
    expect(buildWorkflow).toContain("danteclicky-${{ matrix.os }}-no-bundle");
    expect(releaseWorkflow).toContain("release-preflight");
    expect(releaseWorkflow).toContain("__TAURI_UPDATER_PUBKEY__");
    expect(releaseWorkflow).toContain("expected_version=\"${RELEASE_TAG#v}\"");
    expect(releaseWorkflow).toContain("package.json:$package_version");
    expect(releaseWorkflow).toContain("src-tauri/tauri.conf.json:$tauri_version");
    expect(releaseWorkflow).toContain("src-tauri/Cargo.toml:$cargo_version");
    expect(releaseWorkflow).toContain("does not match release tag");
    expect(releaseWorkflow).toContain("Missing required release secret");
    expect(releaseWorkflow).toContain("WINDOWS_CERTIFICATE");
    expect(releaseWorkflow).toContain("APPLE_CERTIFICATE");
    expect(releaseWorkflow).toContain("APPLE_TEAM_ID");
    expect(releaseWorkflow).toContain("Import Windows signing certificate");
    expect(releaseWorkflow).toContain("Import macOS signing certificate");
    expect(releaseWorkflow).toContain("tauri-apps/tauri-action@84b9d35b5fc46c1e45415bdb6144030364f7ebc5");
    expect(releaseWorkflow).toContain("# v0.6.2");
    expect(releaseWorkflow).toContain("No Developer ID Application signing identity found for direct GitHub distribution");
    expect(releaseWorkflow).not.toContain("Developer ID Application|Apple Distribution");
    expect(releaseWorkflow).not.toMatch(/uses:\s+\S+@(v\d+|stable)(\s|$)/);
    expect(releaseWorkflow).toContain("actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5");
    expect(releaseWorkflow).toContain("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020");
    expect(releaseWorkflow).toContain("dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8");
    expect(releaseWorkflow).toContain("swatinem/rust-cache@42dc69e1aa15d09112580998cf2ef0119e2e91ae");
    expect(releaseWorkflow).toContain("softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65");
    expect(releaseWorkflow).toContain("Record release tool versions");
    expect(releaseWorkflow).toContain("ImageVersion=$env:ImageVersion");
    expect(releaseWorkflow).toContain("tauri=$(npm run --silent tauri -- --version)");
    expect(releaseWorkflow).toContain("Verify release artifacts and manifest");
    expect(releaseWorkflow).toContain("macos-aarch64");
    expect(releaseWorkflow).toContain("linux-x86_64");
    expect(releaseWorkflow).toContain("windows-x86_64");
    expect(releaseWorkflow).toContain("workflow_dispatch");
    expect(releaseWorkflow).toContain("RELEASE_TAG");
    expect(releaseWorkflow).toContain("ref: ${{ env.RELEASE_TAG }}");
    expect(releaseWorkflow).toContain("aarch64-apple-darwin");
    expect(releaseWorkflow).toContain("x86_64-apple-darwin");
    expect(releaseWorkflow).toContain("--target aarch64-apple-darwin -- --features sqlcipher");
    expect(releaseWorkflow).toContain("--target x86_64-apple-darwin -- --features sqlcipher");
    expect(releaseWorkflow).toContain("scripts/generate-latest-manifest.mjs");
    expect(releaseWorkflow).not.toContain("WIN_SIG=$(find");
    expect(releaseWorkflow).not.toContain("cat > latest.json << EOF");
    expect(releaseWorkflow).not.toContain(".AppImage.tar.gz");
    expect(releaseWorkflow).toContain("macos-x86_64");
    expect(latestManifestScript).toContain("darwin-aarch64");
    expect(latestManifestScript).toContain("darwin-x86_64");
    expect(releaseWorkflow).toContain("Verify Windows signed artifacts");
    expect(releaseWorkflow).toContain("signtool");
    expect(releaseWorkflow).toContain("verify /pa /all /tw /v");
    expect(releaseWorkflow).toContain("signtool verify /pa /all /tw /v $($artifact.FullName)");
    expect(releaseWorkflow).toContain("did not include timestamp evidence");
    expect(releaseWorkflow).toContain("Verify macOS signing and notarization");
    expect(releaseWorkflow).toContain("codesign --verify --deep --strict --verbose=2");
    expect(releaseWorkflow).toContain("spctl --assess --type execute --verbose=4");
    expect(releaseWorkflow).toContain("xcrun stapler validate");
    expect(releaseWorkflow).toContain("apps_file=\"$(mktemp)\"");
    expect(releaseWorkflow).not.toContain("mapfile -t apps");
    expect(releaseWorkflow).toContain("Verify Linux AppImage updater artifacts");
    expect(releaseWorkflow).toContain("pubkey-sha256=");
    expect(releaseWorkflow).toContain("signature-bytes=");
    expect(releaseWorkflow).toContain("danteclicky-${{ matrix.platformName }}-trust-evidence");
    expect(releaseWorkflow).toContain("danteclicky-${{ matrix.platformName }}-windows-signing.txt");
    expect(releaseWorkflow).toContain("danteclicky-${{ matrix.platformName }}-macos-signing-notarization.txt");
    expect(releaseWorkflow).toContain("danteclicky-${{ matrix.platformName }}-linux-appimage-updater.txt");
    expect(releaseWorkflow).toContain("Download platform trust evidence");
    expect(releaseWorkflow).toContain("actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093");
    expect(releaseWorkflow).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
    expect(releaseWorkflow).toContain("Upload latest.json and trust evidence to release");
    expect(releaseWorkflow).toContain("release-trust-evidence/*");
    expect(releaseWorkflow).toContain("releaseDraft: true");
    expect(releaseWorkflow).toContain("gh release download \"$RELEASE_TAG\"");
    expect(releaseWorkflow).toContain("Record draft release state before manifest publish");
    expect(releaseWorkflow).toContain("release-state-before-publish.json");
    expect(releaseWorkflow).toContain("scripts/verify-release-artifacts.sh dist-artifacts latest.json \"$RELEASE_TAG\" \"${{ github.repository }}\"");
    expect(releaseWorkflow).toContain("id-token: write");
    expect(releaseWorkflow).toContain("attestations: write");
    expect(releaseWorkflow).toContain("artifact-metadata: write");
    expect(releaseWorkflow).toContain("actions/attest@281a49d4cbb0a72c9575a50d18f6deb515a11deb");
    expect(releaseWorkflow).toContain("group: release-${{ inputs.releaseTag || github.ref_name }}");
    expect(releaseWorkflow).toContain("Generate release artifact attestations");
    expect(releaseWorkflow).toContain("danteclicky-${{ matrix.platformName }}-github-attestation.txt");
    expect(releaseWorkflow).toContain("Generate release checksums");
    expect(releaseWorkflow).toContain("SHA256SUMS");
    expect(releaseWorkflow).toContain("Generate manifest and evidence attestations");
    expect(releaseWorkflow).toContain("danteclicky-release-manifest-attestation.txt");
    expect(releaseWorkflow).toContain("gh release edit \"$RELEASE_TAG\"");
    expect(releaseWorkflow).toContain("release-state-after-publish.json");
    expect(tauriConfig).toContain("\"createUpdaterArtifacts\": true");
    expect(tauriConfig).not.toContain("__TAURI_UPDATER_PUBKEY__");
    expect(tauriConfig).toContain("https://github.com/dantericardo88/DanteClicky");
    expect(tauriConfig).not.toContain("danteforge/dante-clicky");

    const lib = readProjectFile("src-tauri/src/lib.rs");
    const platformStatusCard = readProjectFile("src/windows/companion/settings/PlatformStatusCard.tsx");
    expect(lib).toContain("check_for_update");
    expect(lib).toContain("tauri_plugin_updater::UpdaterExt");
    expect(lib).toContain("reached_manifest");
    expect(lib).toContain("latest_manifest_platform_probe");
    expect(lib).toContain("signature_present");
    expect(platformStatusCard).toContain("check_for_update");
    expect(platformStatusCard).toContain("Updater manifest");
    expect(platformStatusCard).toContain("Manifest reached");
    expect(platformStatusCard).toContain("manifestUrl");
  });

  it("ships auditable release artifact proof scaffolding", () => {
    expect(existsSync(resolve(root, "CHANGELOG.md"))).toBe(true);
    expect(existsSync(resolve(root, "scripts/ci-runtime-smoke.ps1"))).toBe(true);
    expect(existsSync(resolve(root, "scripts/verify-release-artifacts.ps1"))).toBe(true);
    expect(existsSync(resolve(root, "scripts/verify-release-artifacts.sh"))).toBe(true);
    expect(existsSync(resolve(root, "scripts/check-dim47-release-readiness.ps1"))).toBe(true);
    expect(existsSync(resolve(root, "scripts/generate-latest-manifest.mjs"))).toBe(true);
    expect(existsSync(resolve(root, "scripts/run-dim47-release-check.mjs"))).toBe(true);
    expect(existsSync(resolve(root, "docs/cross-platform-smoke/artifacts.json"))).toBe(true);

    const packageJson = readProjectFile("package.json");
    const runtimeSmoke = readProjectFile("scripts/ci-runtime-smoke.ps1");
    const verifyPs1 = readProjectFile("scripts/verify-release-artifacts.ps1");
    const verifySh = readProjectFile("scripts/verify-release-artifacts.sh");
    const releaseReadiness = readProjectFile("scripts/check-dim47-release-readiness.ps1");

    expect(packageJson).toContain("node scripts/run-dim47-release-check.mjs");
    expect(runtimeSmoke).toContain("DANTE_STARTUP_PROBE_PATH");
    expect(runtimeSmoke).toContain("tray_ready");
    expect(runtimeSmoke).toContain("hotkey_registered");
    expect(runtimeSmoke).toContain("native_ready");
    expect(verifyPs1).toContain("macOS Apple Silicon updater bundle");
    expect(verifyPs1).toContain("*.exe.sig");
    expect(verifyPs1).toContain("*.AppImage.sig");
    expect(verifyPs1).toContain("macOS Intel updater bundle");
    expect(verifyPs1).toContain("latest.json platform '$Platform' URL points to");
    expect(verifySh).toContain("macOS Apple Silicon updater bundle");
    expect(verifySh).toContain("macOS Intel updater bundle");
    expect(verifySh).toContain("but that artifact was not downloaded");
    expect(releaseReadiness).toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(releaseReadiness).toContain("WINDOWS_CERTIFICATE");
    expect(releaseReadiness).toContain("APPLE_CERTIFICATE");
    expect(releaseReadiness).toContain("manual-smoke-$Platform");
    expect(releaseReadiness).toContain("Test-ManualSmokeLogContent");
    expect(releaseReadiness).toContain("release-workflow-actions-sha-pinned");
    expect(releaseReadiness).toContain("release-workflow-attestations-configured");
    expect(releaseReadiness).toContain("release-workflow-developer-id-only");
    expect(releaseReadiness).toContain("release-not-draft");
    expect(releaseReadiness).toContain("release-not-prerelease");
    expect(releaseReadiness).toContain("release-tag-provided");
    expect(releaseReadiness).toContain("release-artifact-manifest-verification");
    expect(releaseReadiness).toContain("release-checksums-content");
    expect(releaseReadiness).toContain("Get-FileHash");
    expect(releaseReadiness).toContain("^SHA256SUMS$");
    expect(releaseReadiness).toContain("platform trust evidence");
    expect(releaseReadiness).toContain("SHA256SUMS");
    expect(releaseReadiness).toContain("Test-TrustEvidenceContent");
    expect(releaseReadiness).toContain("release-trust-evidence-content-$evidenceName");
    expect(releaseReadiness).toContain("windows-trust-evidence");
    expect(releaseReadiness).toContain("macos-arm-trust-evidence");
    expect(releaseReadiness).toContain("Release-attached trust evidence logs");
    expect(releaseReadiness).toContain("github-attestation.txt");
    expect(releaseReadiness).toContain("release-artifact-attestations");
    expect(releaseReadiness).toContain("gh attestation verify");
    expect(releaseReadiness).toContain("-ExpectedTag $ReleaseTag");
    expect(releaseReadiness).toContain("-ExpectedRepository \"dantericardo88/DanteClicky\"");
    expect(releaseReadiness).toContain("signtool verify");
    expect(releaseReadiness).toContain("xcrun stapler validate");
    expect(releaseReadiness).toContain("pubkey-sha256=");
    expect(releaseReadiness).toContain("signature-bytes=");
    expect(releaseReadiness).toContain("Artifact SHA256 must be a 64-character hex digest");
    expect(releaseReadiness).toContain("gh attestation verify");
    expect(releaseReadiness).toContain("non-empty evidence");
    expect(verifyPs1).toContain("ExpectedRepository");
    expect(verifyPs1).toContain("Assert-ManifestSignature");
    expect(verifyPs1).toContain("signature matches '$sigName'");
    expect(verifyPs1).toContain("Manifest '$ManifestPath' does not exist");
    expect(verifyPs1).toContain("valid SemVer-like version");
    expect(verifyPs1).toContain("unexpected platform key");
    expect(verifySh).toContain("expected_repository");
    expect(verifySh).toContain("manifest '$manifest_path' does not exist");
    expect(verifySh).toContain("signature does not match");
    expect(verifySh).toContain("signature matches");
    expect(verifySh).toContain("RFC3339 UTC timestamp");
  });

  it("product metadata no longer frames the app as Windows-only", () => {
    const packageJson = readProjectFile("package.json");
    const tauriConfig = readProjectFile("src-tauri/tauri.conf.json");
    const promptSource = readProjectFile("src/lib/buildSystemPrompt.ts");
    const onboardingSource = readProjectFile("src/windows/OnboardingWindow.tsx");
    const readme = readProjectFile("README.md");
    const contributing = readProjectFile("CONTRIBUTING.md");
    const releaseChecklist = readProjectFile("RELEASE_CHECKLIST.md");

    expect(packageJson).not.toContain("Windows");
    expect(tauriConfig).not.toContain("AI Companion for Windows");
    expect(tauriConfig).toContain("\"targets\": \"all\"");
    expect(promptSource).not.toContain("windows system tray");
    expect(onboardingSource).not.toContain("AI companion for Windows");
    expect(onboardingSource).not.toContain("Windows desktop");
    expect(readme).not.toContain("Windows AI Companion");
    expect(readme).not.toContain("platform-Windows-blue");
    expect(contributing).not.toContain("Windows desktop companion");
    expect(releaseChecklist).not.toContain("DanteClicky Windows");
  });

  it("surfaces platform capabilities in the visible app UI", () => {
    const settingsSection = readProjectFile("src/windows/companion/settings/SettingsSection.tsx");
    const platformStatusCard = readProjectFile("src/windows/companion/settings/PlatformStatusCard.tsx");

    expect(settingsSection).toContain("get_platform_capabilities");
    expect(settingsSection).toContain("PlatformCapabilities");
    expect(settingsSection).toContain("PlatformStatusCard");
    expect(platformStatusCard).toContain("overlayStealth");
    expect(platformStatusCard).toContain("accessibilityTree");
  });
});
