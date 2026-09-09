#!/usr/bin/env node
import { mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stage = mkdtempSync(join(tmpdir(), "chio-openclaw-image-"));
for (const name of ["Dockerfile", "proxy.mjs"]) copyFileSync(join(root, "docker", name), join(stage, name));
const pack = spawnSync(process.execPath, [join(root, "scripts/pack-release.mjs"), stage], { cwd: root, stdio: "inherit" });
if (pack.status !== 0) process.exit(pack.status ?? 1);
const build = spawnSync("docker", ["build", "-t", "chio-openclaw-host:20260909", stage], { stdio: "inherit" });
process.stdout.write(`Container build context retained at ${stage}\n`);
process.exit(build.status ?? 1);
