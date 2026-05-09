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
    expect(buildWorkflow).toContain("actions/upload-artifact@v4");
    expect(buildWorkflow).toContain("danteclicky-${{ matrix.os }}-no-bundle");
    expect(releaseWorkflow).toContain("macos-aarch64");
    expect(releaseWorkflow).toContain("linux-x86_64");
    expect(releaseWorkflow).toContain("windows-x86_64");
    expect(releaseWorkflow).toContain("workflow_dispatch");
    expect(releaseWorkflow).toContain("RELEASE_TAG");
    expect(releaseWorkflow).toContain("aarch64-apple-darwin");
    expect(releaseWorkflow).toContain("x86_64-apple-darwin");
    expect(releaseWorkflow).toContain("*.exe.sig");
    expect(releaseWorkflow).toContain("*.AppImage.sig");
    expect(releaseWorkflow).toContain("refusing to publish latest.json with missing updater signatures");
    expect(releaseWorkflow).not.toContain(".AppImage.tar.gz");
    expect(releaseWorkflow).toContain("macos-x86_64");
    expect(releaseWorkflow).toContain("darwin-aarch64");
    expect(releaseWorkflow).toContain("darwin-x86_64");
    expect(tauriConfig).toContain("\"createUpdaterArtifacts\": true");
    expect(tauriConfig).toContain("https://github.com/dantericardo88/DanteClicky");
    expect(tauriConfig).not.toContain("danteforge/dante-clicky");
  });

  it("ships auditable release artifact proof scaffolding", () => {
    expect(existsSync(resolve(root, "CHANGELOG.md"))).toBe(true);
    expect(existsSync(resolve(root, "scripts/verify-release-artifacts.ps1"))).toBe(true);
    expect(existsSync(resolve(root, "scripts/verify-release-artifacts.sh"))).toBe(true);
    expect(existsSync(resolve(root, "docs/cross-platform-smoke/artifacts.json"))).toBe(true);
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
    const companionPanel = readProjectFile("src/windows/CompanionPanel.tsx");

    expect(companionPanel).toContain("get_platform_capabilities");
    expect(companionPanel).toContain("PlatformCapabilities");
    expect(companionPanel).toContain("PlatformStatusCard");
    expect(companionPanel).toContain("overlayStealth");
    expect(companionPanel).toContain("accessibilityTree");
  });
});
