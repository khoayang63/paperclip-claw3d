#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const claw3dDir = path.join(rootDir, "claw3d");

const jobs = [
  {
    name: "adapter",
    cmd: "node",
    args: ["server/paperclip-gateway-adapter.js"],
    cwd: claw3dDir,
  },
  {
    name: "claw3d",
    cmd: "node",
    args: ["server/index.js", "--dev"],
    cwd: claw3dDir,
  },
];

const nameWidth = Math.max(...jobs.map((j) => j.name.length));
const children = [];
let stopping = false;

function prefix(name, data) {
  const label = `[${name.padEnd(nameWidth)}] `;
  return label + String(data).replace(/\n(?!$)/g, `\n${label}`);
}

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) {
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
  }
  setTimeout(() => process.exit(code), 500).unref();
}

console.log("==============================================================");
console.log(" Starting Claw3D 3D Virtual Office for Paperclip Control Plane");
console.log("   - Paperclip API:       http://localhost:3100/api");
console.log("   - Claw3D Gateway:      ws://localhost:18789");
console.log("   - 3D Virtual Office:   http://localhost:3000");
console.log("==============================================================\n");

for (const job of jobs) {
  const child = spawn(job.cmd, job.args, {
    cwd: job.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PAPERCLIP_API_URL: process.env.PAPERCLIP_API_URL || "http://127.0.0.1:3100/api",
      GATEWAY_URL: process.env.GATEWAY_URL || "ws://127.0.0.1:18789",
    },
    shell: true,
  });

  child.stdout.on("data", (d) => process.stdout.write(prefix(job.name, d)));
  child.stderr.on("data", (d) => process.stderr.write(prefix(job.name, d)));
  child.on("exit", (code, signal) => {
    process.stderr.write(prefix(job.name, `exited (code=${code} signal=${signal})\n`));
    stopAll(code ?? 1);
  });
  children.push({ name: job.name, child });
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => stopAll(0));
}
