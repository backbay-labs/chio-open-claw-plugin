import type { Intent } from "./intent.js";
import type { PolicyDraft } from "./chio.js";

export function draftFromIntent(
  i: Extract<Intent, { kind: "bond" }>,
): PolicyDraft {
  const toolServers =
    i.toolServers && i.toolServers.length > 0
      ? i.toolServers
      : ["mcp/default"];
  return {
    name: i.name,
    scope: i.scope ?? toolServers.join(" · "),
    budgetUsd: i.budgetUsd ?? 40,
    ttlHours: i.ttlHours ?? 4,
    toolServers,
    gates: [
      "refund > $100 ⇒ human approve",
      "fs.write ⇒ allowlist",
    ],
  };
}
