#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const artifactDir = arg("--artifact-dir", "dist-artifacts");
const outPath = arg("--out", "latest.json");
const releaseTag = arg("--release-tag", process.env.RELEASE_TAG ?? "");
const repository = arg("--repository", process.env.GITHUB_REPOSITORY ?? "dantericardo88/DanteClicky");

if (!releaseTag.startsWith("v")) {
  throw new Error(`--release-tag must start with v. Got '${releaseTag}'.`);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const files = walk(artifactDir);

function findSingle(label, patterns) {
  for (const pattern of patterns) {
    const matches = files.filter((file) => pattern.test(file.replaceAll("\\", "/")));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `${label} matched multiple artifacts for ${pattern}: ${matches.map((file) => relative(artifactDir, file)).join(", ")}`
      );
    }
  }
  throw new Error(`${label} artifact was not found.`);
}

function sigFor(asset) {
  const sig = `${asset}.sig`;
  if (!files.includes(sig)) {
    throw new Error(`Missing updater signature for ${relative(artifactDir, asset)}: expected ${relative(artifactDir, sig)}`);
  }
  const signature = readFileSync(sig, "utf8").trim();
  if (!signature) {
    throw new Error(`Updater signature is empty: ${relative(artifactDir, sig)}`);
  }
  return signature;
}

function urlFor(asset) {
  const filename = asset.split(/[\\/]/).pop();
  return `https://github.com/${repository}/releases/download/${releaseTag}/${encodeURIComponent(filename)}`;
}

const assets = {
  "windows-x86_64": findSingle("Windows installer", [/\.exe$/i, /\.msi$/i]),
  "darwin-aarch64": findSingle("macOS Apple Silicon updater bundle", [/(aarch64|arm64).*\.app\.tar\.gz$/i]),
  "darwin-x86_64": findSingle("macOS Intel updater bundle", [/(x64|x86_64).*\.app\.tar\.gz$/i]),
  "linux-x86_64": findSingle("Linux AppImage", [/\.AppImage$/]),
};

const manifest = {
  version: releaseTag.replace(/^v/, ""),
  notes: `See https://github.com/${repository}/releases/tag/${releaseTag}`,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms: Object.fromEntries(
    Object.entries(assets).map(([platform, asset]) => [
      platform,
      {
        signature: sigFor(asset),
        url: urlFor(asset),
      },
    ])
  ),
};

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`latest.json generated for ${Object.keys(assets).join(", ")}`);
