#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { restrictedTools } from "../src/profile.mjs";

const { values } = parseArgs({ options: Object.fromEntries([
  "directory", "endpoint", "token-env", "subject-key", "capability-id", "server-id", "trusted-signer",
  "model-base-url", "model-key-env", "model-id", "kernel-session-id",
].map((name) => [name, { type: "string" }])) });
for (const name of ["directory", "endpoint", "token-env", "subject-key", "capability-id", "server-id", "trusted-signer", "model-base-url", "model-key-env", "model-id"]) {
  if (!values[name]) throw new Error(`Required argument: --${name}`);
}
if (!isAbsolute(values.directory)) throw new Error("--directory must be an absolute, new path");
for (const key of ["token-env", "model-key-env"]) {
  if (!/^[A-Z][A-Z0-9_]+$/.test(values[key])) throw new Error(`--${key} must name an environment variable`);
}
for (const key of ["subject-key", "trusted-signer"]) {
  if (!/^[a-fA-F0-9]{64}$/.test(values[key])) throw new Error(`--${key} must be a 32-byte hexadecimal public key`);
}
const endpoint = new URL(values.endpoint);
if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname))) {
  throw new Error("Kernel endpoint requires HTTPS or loopback HTTP");
}
const root = values.directory;
await mkdir(root, { mode: 0o700 }); // Never overwrite or merge a normal profile.
await mkdir(join(root, "state"), { mode: 0o700 });
await mkdir(join(root, "workspace"), { mode: 0o700 });
await mkdir(join(root, "home"), { mode: 0o700 });
const model = values["model-id"];
const cfg = {
  agents: { defaults: { workspace: join(root, "workspace"), skipBootstrap: true, skills: [], model: `chio-model/${model}`, heartbeat: { every: "0m" } } },
  models: { mode: "replace", providers: { "chio-model": { baseUrl: values["model-base-url"], apiKey: `\${${values["model-key-env"]}}`, api: "openai-completions", agentRuntime: { id: "pi" }, models: [{ id: model, name: model, input: ["text"], reasoning: false, contextWindow: 128000, maxTokens: 4096 }] } } },
  tools: restrictedTools(),
  plugins: { enabled: true, allow: ["chio-kernel"], slots: { memory: "none" }, load: { paths: [join(root, "packages", "node_modules", "@chio", "openclaw-kernel")] }, entries: { "chio-kernel": { enabled: true, config: { endpoint: values.endpoint, tokenEnv: values["token-env"], stateDir: join(root, "journal"), subjectKey: values["subject-key"], capabilityId: values["capability-id"], serverId: values["server-id"], trustedSigners: [values["trusted-signer"]], timeoutMs: 30000, ...(values["kernel-session-id"] ? { sessionId: values["kernel-session-id"] } : {}) } } } },
  commands: { native: false, nativeSkills: false, text: false, bash: false, config: false, restart: false, mcp: false, plugins: false, debug: false },
  browser: { enabled: false }, cron: { enabled: false }, channels: {}, hooks: { enabled: false }, acp: { enabled: false },
  gateway: { mode: "local", bind: "loopback" },
};
await writeFile(join(root, "openclaw.install.json"), JSON.stringify({ gateway: { mode: "local" }, tools: restrictedTools(), plugins: { slots: { memory: "none" } } }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
await writeFile(join(root, "openclaw.json"), JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600, flag: "wx" });
process.stdout.write(`Created isolated profile at ${root}. Install the plugin using openclaw.install.json before switching to openclaw.json.\n`);
