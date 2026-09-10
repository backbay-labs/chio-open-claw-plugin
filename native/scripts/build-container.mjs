#!/usr/bin/env node
import { mkdtempSync, copyFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2] ?? "chio-openclaw-host:20260909";
if (!/^chio-openclaw-host:[a-z0-9-]+$/.test(tag)) throw new Error("Use a dedicated Chio host image tag");
const stage = mkdtempSync(join(tmpdir(), "chio-openclaw-image-"));
for (const name of ["Dockerfile", "proxy.mjs"]) copyFileSync(join(root, "docker", name), join(stage, name));
if (process.argv[3]) {
  // Installed archives deliberately omit development scripts. Build their host
  // image from the already delivered archive instead of attempting a source build.
  const artifact = resolve(process.argv[3]);
  const expected = readFileSync(`${artifact}.sha256`, "utf8").trim().split(/\s+/)[0];
  const actual = createHash("sha256").update(readFileSync(artifact)).digest("hex");
  if (!/^[a-f0-9]{64}$/.test(expected) || expected !== actual) throw new Error("Delivered archive SHA256 differs from its sidecar");
  copyFileSync(artifact, join(stage, "chio-openclaw-kernel-0.1.0.tgz"));
} else {
  const pack = spawnSync(process.execPath, [join(root, "scripts/pack-release.mjs"), stage], { cwd: root, stdio: "inherit" });
  if (pack.status !== 0) process.exit(pack.status ?? 1);
}
const build = spawnSync("docker", ["build", "-t", tag, stage], { stdio: "inherit" });
process.stdout.write(`Container build context retained at ${stage}\n`);
process.exit(build.status ?? 1);
