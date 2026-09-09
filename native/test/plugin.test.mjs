import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativePlugin } from "../src/plugin.mjs";
import { restrictedTools } from "../src/profile.mjs";

export function profile() {
  return {
    tools: restrictedTools(), channels: {}, cron: { enabled: false }, browser: { enabled: false },
    commands: Object.fromEntries(["native", "nativeSkills", "text", "bash", "config", "restart", "mcp", "plugins", "debug"].map((key) => [key, false])),
    plugins: { allow: ["chio-kernel"] },
    agents: { defaults: { skipBootstrap: true, skills: [], heartbeat: { every: "0m" } } },
  };
}

async function fixture(t, dispatch, context = {}) {
  const stateDir = await mkdtemp(join(tmpdir(), "chio-openclaw-unit-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  let factory;
  const hooks = [];
  const config = profile();
  createNativePlugin(dispatch).register({
    config, pluginConfig: { stateDir },
    on: (...args) => hooks.push(args),
    registerTool: (value) => { factory = value; },
  });
  const ctx = { config, agentId: "main", sessionId: "session-a", sessionKey: "agent:main:main", ...context };
  return { tool: factory(ctx), factory, hooks, config, ctx, stateDir };
}

test("same host operation is dispatched once, bound to host caller and canonical arguments", async (t) => {
  const calls = [];
  const f = await fixture(t, async (request) => {
    calls.push(request);
    return { state: "completed", evidence: "verified", result: "resource-result" };
  });
  const args = { tool: "write_file", arguments: { path: "a.txt", content: "allowed" } };
  const a = await f.tool.execute("host-call-1", args);
  const b = await f.tool.execute("host-call-1", args);
  assert.deepEqual(a, b);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].caller.sessionId, "session-a");
  await assert.rejects(f.tool.execute("host-call-1", { ...args, arguments: { path: "secret" } }), /different request/);
  assert.equal(calls.length, 1);
});

test("unknown outcome fences subsequent calls and survives recreated plugin", async (t) => {
  let count = 0;
  const f = await fixture(t, async () => { count += 1; throw new Error("connection interrupted"); });
  const args = { tool: "write_file", arguments: { path: "a.txt" } };
  await assert.rejects(f.tool.execute("host-call-1", args), /interrupted/);
  await assert.rejects(f.tool.execute("host-call-2", args), /unresolved dispatch/);
  assert.equal(count, 1);
  const pending = (await readdir(f.stateDir)).find((name) => name.endsWith("pending.json"));
  assert.ok(pending);
  assert.equal(JSON.parse(await readFile(join(f.stateDir, pending), "utf8")).state, "dispatch_pending");
  let recreatedFactory;
  createNativePlugin(async () => { count += 1; }).register({ config: f.config, pluginConfig: { stateDir: f.stateDir }, on() {}, registerTool: (factory) => { recreatedFactory = factory; } });
  await assert.rejects(recreatedFactory(f.ctx).execute("host-call-3", args), /unresolved dispatch/);
  await assert.rejects(recreatedFactory({ ...f.ctx, sessionId: "replacement-session", sessionKey: "replacement-key" }).execute("host-call-4", args), /unresolved dispatch/);
  assert.equal(count, 1);
});

test("completed cache is bound to the operator authority configuration", async (t) => {
  const f = await fixture(t, async () => ({ state: "completed", evidence: "verified", result: "prior-subject-result" }));
  const args = { tool: "read_text_file", arguments: {} };
  await f.tool.execute("prior-call", args);
  let factory;
  createNativePlugin(async () => { throw new Error("must not dispatch"); }).register({ config: f.config, pluginConfig: { stateDir: f.stateDir, subjectKey: "new-subject" }, on() {}, registerTool: (value) => { factory = value; } });
  await assert.rejects(factory(f.ctx).execute("prior-call", args), /different request/);
});

test("missing trusted identity, injected authority, and cancelled calls never dispatch", async (t) => {
  let count = 0;
  const f = await fixture(t, async () => { count += 1; });
  const args = { tool: "write_file", arguments: {} };
  await assert.rejects(f.factory({ ...f.ctx, sessionId: undefined }).execute("host-call", args), /trusted OpenClaw sessionId/);
  await assert.rejects(f.tool.execute("host-call", { ...args, caller: "admin" }), /authority/);
  await assert.rejects(f.tool.execute("host-call", args, AbortSignal.abort()), /cancelled/);
  assert.equal(count, 0);
});

test("parallel dispatch is fenced before a second effect starts", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started;
  const admitted = new Promise((resolve) => { started = resolve; });
  let count = 0;
  const f = await fixture(t, async () => { count += 1; started(); await gate; return { state: "completed", evidence: "verified" }; });
  const first = f.tool.execute("first", { tool: "write_file", arguments: {} });
  await admitted;
  await assert.rejects(f.tool.execute("second", { tool: "write_file", arguments: {} }), /unresolved dispatch/);
  release(); await first;
  assert.equal(count, 1);
});

test("configuration changes and non-Chio hooks block before dispatch", async (t) => {
  const f = await fixture(t, async () => { throw new Error("must not execute"); });
  assert.equal(f.hooks[0][1]({ toolName: "exec" }).block, true);
  assert.equal(f.hooks[0][1]({ toolName: "chio_call" }), undefined);
  f.config.tools.elevated.enabled = true;
  await assert.rejects(f.tool.execute("call", { tool: "read_file", arguments: {} }), /restricted native/);
});

test("signed post-effect denial and unverified success cannot release the session fence", async (t) => {
  for (const response of [{ state: "denied", evidence: "verified" }, { state: "completed", evidence: "unverified" }]) {
    let calls = 0;
    const f = await fixture(t, async () => { calls += 1; return response; });
    const result = await f.tool.execute("first", { tool: "write_file", arguments: {} });
    assert.equal(result.details.fenced, true);
    await assert.rejects(f.tool.execute("retry", { tool: "write_file", arguments: {} }), /unresolved dispatch/);
    assert.equal(calls, 1);
  }
});

test("known pre-dispatch failure releases the fence for a later fresh operation", async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls += 1;
    return calls === 1 ? { state: "not_dispatched", evidence: "unverified" } : { state: "completed", evidence: "verified", result: "restored" };
  });
  await f.tool.execute("first", { tool: "read_file", arguments: {} });
  const result = await f.tool.execute("fresh", { tool: "read_file", arguments: {} });
  assert.equal(result.details.result, "restored");
  assert.equal(calls, 2);
});

test("a verified completed tool error remains an error to the host", async (t) => {
  const f = await fixture(t, async () => ({ state: "completed", evidence: "verified", result: { isError: true, content: [{ type: "text", text: "resource error" }] } }));
  const result = await f.tool.execute("call", { tool: "read_file", arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(result.details.state, "completed");
});
