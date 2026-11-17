import { spawnSync } from "node:child_process";

const hasCargo = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["cargo"], { stdio: "ignore" }).status === 0;

if (!hasCargo) {
  console.log("cargo not installed in environment; skipping Rust checks.");
  process.exit(0);
}

const fmt = spawnSync("cargo", ["fmt", "--manifest-path", "runner/Cargo.toml", "--all", "--", "--check"], { stdio: "inherit" });
if (fmt.status !== 0) {
  process.exit(fmt.status ?? 1);
}

const check = spawnSync("cargo", ["check", "--manifest-path", "runner/Cargo.toml", "--locked", "--workspace"], { stdio: "inherit" });
process.exit(check.status ?? 1);
