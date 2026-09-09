import { DispatchJournal, digest } from "./journal.mjs";
import { assertRestrictedProfile, TOOL_NAME, PLUGIN_ID } from "./profile.mjs";

function nonempty(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing trusted OpenClaw ${name}`);
  return value;
}

export function createNativePlugin(executeKernel) {
  return {
    id: PLUGIN_ID,
    name: "Chio Kernel",
    register(api) {
      assertRestrictedProfile(api.config);
      const options = api.pluginConfig;
      const journal = new DispatchJournal(options.stateDir);
      api.on("before_tool_call", (event) => event.toolName === TOOL_NAME
        ? undefined : { block: true, blockReason: "Native effect paths are disabled in Chio restricted mode" }, { priority: 1000 });
      api.registerTool((ctx) => ({
        name: TOOL_NAME,
        label: "Chio kernel execution",
        description: "Execute an allowed tool at the Chio kernel resource owner. Native file, shell, network and delegation tools are disabled. The operator defines the available kernel tools.",
        parameters: {
          type: "object", additionalProperties: false,
          required: ["tool", "arguments"],
          properties: { tool: { type: "string", minLength: 1 }, arguments: { type: "object" } },
        },
        async execute(toolCallId, params, signal) {
          assertRestrictedProfile(ctx.getRuntimeConfig?.() ?? ctx.runtimeConfig ?? ctx.config ?? api.config);
          if (!params || Object.keys(params).some((key) => !["tool", "arguments"].includes(key)) ||
              typeof params.tool !== "string" || !params.tool ||
              !params.arguments || typeof params.arguments !== "object" || Array.isArray(params.arguments)) {
            throw new Error("Invalid Chio call: authority and caller fields cannot be supplied by the agent");
          }
          const caller = {
            host: "openclaw",
            agentId: nonempty(ctx.agentId, "agentId"),
            sessionId: nonempty(ctx.sessionId, "sessionId"),
            sessionKey: nonempty(ctx.sessionKey, "sessionKey"),
          };
          if (signal?.aborted) throw new Error("Chio call cancelled before dispatch");
          const request = {
            requestId: digest({ caller, toolCallId: nonempty(toolCallId, "toolCallId") }),
            caller, tool: params.tool, arguments: structuredClone(params.arguments),
            authority: {
              endpoint: options.endpoint ?? null,
              subjectKey: options.subjectKey ?? null,
              capabilityId: options.capabilityId ?? null,
              serverId: options.serverId ?? null,
              kernelSessionId: options.sessionId ?? null,
              trustedSigners: options.trustedSigners ?? null,
            },
          };
          const response = await journal.run(request, () => executeKernel(request, { ...options, signal }));
          return { content: [{ type: "text", text: JSON.stringify(response) }], details: response, isError: response.state !== "completed" || response.result?.isError === true };
        },
      }), { names: [TOOL_NAME], optional: true });
    },
  };
}
