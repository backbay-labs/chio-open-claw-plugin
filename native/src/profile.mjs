export const TOOL_NAME = "chio_call";
export const PLUGIN_ID = "chio-kernel";

// This policy is independent of plugin loading. Removing this plugin cannot
// reveal native tools. The resource owner must also deny direct host access.
export function restrictedTools() {
  return {
    profile: "minimal",
    alsoAllow: [TOOL_NAME],
    deny: ["group:openclaw"],
    elevated: { enabled: false },
    exec: { security: "deny", applyPatch: { enabled: false } },
  };
}

export function assertRestrictedProfile(config) {
  const tools = config?.tools;
  if (tools?.profile !== "minimal" ||
      JSON.stringify(tools.alsoAllow) !== JSON.stringify([TOOL_NAME]) ||
      !tools.deny?.includes("group:openclaw") ||
      tools.allow !== undefined || tools.byProvider !== undefined ||
      tools.elevated?.enabled !== false || tools.exec?.security !== "deny") {
    throw new Error("Chio requires the restricted native OpenClaw tools profile");
  }
  if (Object.values(config?.mcp?.servers ?? {}).length ||
      Object.values(config?.channels ?? {}).some((channel) => channel?.enabled !== false) ||
      config?.acp?.enabled === true || config?.cron?.enabled !== false ||
      config?.browser?.enabled !== false || config?.hooks?.enabled === true ||
      ["native", "nativeSkills", "text", "bash", "config", "restart", "mcp", "plugins", "debug"].some((key) => config?.commands?.[key] !== false)) {
    throw new Error("Chio restricted mode requires channels, MCP, automation, browser, and administrative chat commands disabled");
  }
  if (JSON.stringify(config?.plugins?.allow) !== JSON.stringify([PLUGIN_ID]) ||
      config?.agents?.defaults?.skipBootstrap !== true ||
      JSON.stringify(config?.agents?.defaults?.skills) !== "[]" ||
      config?.agents?.defaults?.heartbeat?.every !== "0m" ||
      Object.values(config?.models?.providers ?? {}).some((provider) => provider.agentRuntime?.id !== "pi")) {
    throw new Error("Chio restricted mode requires isolated bootstrap, no skills or heartbeat, only the Chio plugin, and explicit PI model runtime");
  }
  for (const agent of config?.agents?.list ?? []) {
    if (agent.tools || agent.runtime || agent.heartbeat || agent.subagents) {
      throw new Error("Per-agent tool/runtime overrides are not supported by the Chio restricted profile");
    }
  }
}
