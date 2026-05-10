#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const candidates = process.platform === "win32" ? ["powershell", "pwsh"] : ["pwsh", "powershell"];
const shell = candidates.find((name) => spawnSync(name, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion"], { stdio: "ignore" }).status === 0);

if (!shell) {
  console.error("Could not find powershell or pwsh to run scripts/check-dim47-release-readiness.ps1.");
  process.exit(1);
}

const result = spawnSync(
  shell,
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/check-dim47-release-readiness.ps1", ...args],
  { stdio: "inherit" }
);

process.exit(result.status ?? 1);
