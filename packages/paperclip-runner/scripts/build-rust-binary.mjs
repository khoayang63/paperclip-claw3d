import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hasCargo = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["cargo"], { stdio: "ignore" }).status === 0;

if (!hasCargo) {
  console.log("cargo not installed in environment; skipping paperclip-runner binary build.");
  const binDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/bin");
  const exePath = path.join(binDir, process.platform === "win32" ? "paperclip-runnerd.exe" : "paperclip-runnerd");
  fs.mkdirSync(binDir, { recursive: true });
  if (!fs.existsSync(exePath)) {
    fs.writeFileSync(exePath, "");
  }
  process.exit(0);
}

const build = spawnSync("cargo", ["build", "--release", "--manifest-path", "runner/Cargo.toml", "--locked", "-p", "paperclip-runner-core", "--bin", "paperclip-runnerd"], { stdio: "inherit" });
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const stage = spawnSync("node", ["scripts/stage-runner-binary.mjs"], { stdio: "inherit" });
process.exit(stage.status ?? 1);
