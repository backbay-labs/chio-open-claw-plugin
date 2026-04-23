/* eslint-disable @typescript-eslint/no-unused-expressions */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntent } from "../src/core/intent.js";

test("bond with explicit tool server and budget", () => {
  const i = parseIntent(
    "@chio, bond an agent for customer_exports on mcp/zendesk, cap $40, ttl 4h",
  );
  assert.equal(i.kind, "bond");
  if (i.kind !== "bond") return;
  assert.equal(i.budgetUsd, 40);
  assert.equal(i.ttlHours, 4);
  assert.ok(i.toolServers.includes("mcp/zendesk"));
});

test("bump_budget with $25", () => {
  const i = parseIntent("chio, bump the budget by $25");
  assert.equal(i.kind, "bump_budget");
  if (i.kind !== "bump_budget") return;
  assert.equal(i.deltaUsd, 25);
});

test("require_approval for refunds over $100", () => {
  const i = parseIntent("chio, require approval for refunds over $100");
  assert.equal(i.kind, "require_approval");
});

test("revoke without target", () => {
  const i = parseIntent("chio, stop");
  assert.equal(i.kind, "revoke");
});

test("revoke with did target", () => {
  const i = parseIntent("chio, revoke agent did:chio:abc123");
  assert.equal(i.kind, "revoke");
  if (i.kind !== "revoke") return;
  assert.equal(i.target, "did:chio:abc123");
});

test("post_receipts with count", () => {
  const i = parseIntent("chio, post the last 10 receipts in-thread");
  assert.equal(i.kind, "post_receipts");
  if (i.kind !== "post_receipts") return;
  assert.equal(i.n, 10);
});

test("move_channel", () => {
  const i = parseIntent("chio, move this agent to #ops-team");
  assert.equal(i.kind, "move_channel");
  if (i.kind !== "move_channel") return;
  assert.equal(i.channel, "ops-team");
});

test("promote_policy", () => {
  const i = parseIntent("chio, promote this policy to live");
  assert.equal(i.kind, "promote_policy");
});

test("bind_trust", () => {
  const i = parseIntent("chio, bind trust to https://trust.acme.internal");
  assert.equal(i.kind, "bind_trust");
  if (i.kind !== "bind_trust") return;
  assert.equal(i.url, "https://trust.acme.internal");
});

test("register_passkey", () => {
  const i = parseIntent("chio, register my passkey");
  assert.equal(i.kind, "register_passkey");
});

test("shift_handoff", () => {
  const i = parseIntent("chio, rotate to next on-call");
  assert.equal(i.kind, "shift_handoff");
});

test("attenuate", () => {
  const i = parseIntent("chio, attenuate — lower budget to $10");
  assert.equal(i.kind, "attenuate");
  if (i.kind !== "attenuate") return;
  assert.equal(i.budgetUsd, 10);
});

test("approve_proposal by id", () => {
  const i = parseIntent("chio, approve proposal 11111111-2222-3333-4444-555555555555");
  assert.equal(i.kind, "approve_proposal");
  if (i.kind !== "approve_proposal") return;
  assert.equal(i.proposalId, "11111111-2222-3333-4444-555555555555");
});

test("deny_proposal", () => {
  const i = parseIntent("chio, deny proposal abc123");
  assert.equal(i.kind, "deny_proposal");
});

test("status with target", () => {
  const i = parseIntent("chio, status of agent did:chio:xyz");
  assert.equal(i.kind, "status");
});

test("evidence_export", () => {
  const i = parseIntent("chio, export evidence last 48h");
  assert.equal(i.kind, "evidence_export");
  if (i.kind !== "evidence_export") return;
  assert.equal(i.sinceHours, 48);
});

test("policy_draft", () => {
  const i = parseIntent("chio, draft a support-desk policy");
  assert.equal(i.kind, "policy_draft");
});

test("help", () => {
  const i = parseIntent("chio, help");
  assert.equal(i.kind, "help");
});

test("unknown fallthrough", () => {
  const i = parseIntent("chio, banana pancakes");
  assert.equal(i.kind, "unknown");
});
