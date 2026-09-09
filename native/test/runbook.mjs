// Actual installed CLI lifecycle against a new disposable profile. This does
// not use a model, protected resource, normal profile, or valid bearer.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = resolve(process.argv[2]);
const directory = await mkdtemp(join(tmpdir(), "chio-openclaw-runbook-"));
const profile = join(directory, "profile");
const evidence = resolve(process.env.CHIO_HOST_EVIDENCE_DIR ?? join(directory, "evidence"));
await mkdir(evidence, { recursive: true });
const env = {
  PATH: process.env.PATH, TMPDIR: tmpdir(), NO_COLOR: "1",
  OPENCLAW_HOME: join(profile, "home"), OPENCLAW_STATE_DIR: join(profile, "state"),
  OPENCLAW_CONFIG_PATH: join(profile, "openclaw.install.json"),
  OPENCLAW_DISABLE_BONJOUR: "1", OPENCLAW_NO_RESPAWN: "1",
  CHIO_MODEL_KEY: "disposable-not-a-credential", CHIO_KERNEL_TOKEN: "disposable-not-a-credential",
  npm_config_cache: join(directory, "empty-cache"), npm_config_registry: "http://127.0.0.1:9", npm_config_offline: "true",
};
const steps = [];
async function run(name, binary, args) {
  const started = Date.now();
  const result = await new Promise((resolveResult) => {
    const child = spawn(binary, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGTERM"), 60000);
    child.on("error", (error) => { clearTimeout(timer); resolveResult({ code: null, stdout, stderr: stderr + String(error) }); });
    child.on("close", (code, signal) => { clearTimeout(timer); resolveResult({ code, signal, stdout, stderr }); });
  });
  const record = { name, binary, args, ...result, elapsedMs: Date.now() - started };
  steps.push(record);
  await writeFile(join(evidence, `${name}.json`), JSON.stringify(record, null, 2));
  return result;
}
try {
  const args = ["scripts/create-profile.mjs", "--directory", profile, "--endpoint", "http://127.0.0.1:1", "--token-env", "CHIO_KERNEL_TOKEN", "--subject-key", "a".repeat(64), "--capability-id", randomUUID(), "--server-id", "fs", "--trusted-signer", "b".repeat(64), "--kernel-session-id", randomUUID(), "--model-base-url", "http://127.0.0.1:1/v1", "--model-key-env", "CHIO_MODEL_KEY", "--model-id", "disabled-local-probe"];
  const create = await run("profile-create", "node", args);
  assert.equal(create.code, 0, create.stderr);
  const original = await readFile(join(profile, "openclaw.json"));
  const repeat = await run("profile-existing-refused", "node", args);
  assert.notEqual(repeat.code, 0);
  assert.deepEqual(await readFile(join(profile, "openclaw.json")), original);
  const install = await run("artifact-offline-install", "npm", ["install", "--prefix", join(profile, "packages"), "--ignore-scripts", "--offline", "--no-audit", "--no-fund", artifact]);
  assert.equal(install.code, 0, install.stderr);
  const link = await run("plugin-link", "openclaw", ["plugins", "install", "--link", join(profile, "packages", "node_modules", "@chio", "openclaw-kernel")]);
  assert.equal(link.code, 0, link.stderr);
  env.OPENCLAW_CONFIG_PATH = join(profile, "openclaw.json");
  const validate = await run("runtime-config-validate", "openclaw", ["config", "validate"]);
  assert.equal(validate.code, 0, validate.stderr);
  const inspect = await run("runtime-plugin-inspect", "openclaw", ["plugins", "inspect", "chio-kernel", "--runtime", "--json"]);
  assert.equal(inspect.code, 0, inspect.stderr);
  assert.equal(JSON.parse(inspect.stdout).plugin.status, "loaded");
  // Uninstall must change only plugin installation state. This profile has no
  // valid capability to revoke; real authority revocation is a separate case.
  const uninstall = await run("plugin-uninstall", "openclaw", ["plugins", "uninstall", "chio-kernel", "--force"]);
  assert.equal(uninstall.code, 0, uninstall.stderr);
  const removed = JSON.parse(await readFile(join(profile, "openclaw.json"), "utf8"));
  assert.deepEqual(removed.tools, JSON.parse(original).tools);
  const refused = await run("removed-plugin-refuses-new-session", "openclaw", ["agent", "--local", "--agent", "main", "--session-id", randomUUID(), "--message", "Attempt a file write after removal", "--thinking", "off", "--timeout", "10", "--json"]);
  assert.notEqual(refused.code, 0);
  assert.match(refused.stderr, /No callable tools remain/);
  await writeFile(join(evidence, "summary.json"), JSON.stringify({ accepted: false, scope: "candidate offline install and removal, no protected authority", artifact, artifactSha256: createHash("sha256").update(await readFile(artifact)).digest("hex"), directory, steps: steps.map((step) => ({ name: step.name, exitCode: step.code })) }, null, 2));
  process.stdout.write(`Lifecycle evidence retained: ${evidence}\n`);
} catch (error) {
  await writeFile(join(evidence, "failure.json"), JSON.stringify({ error: String(error), stack: error.stack, directory }, null, 2));
  throw error;
}
