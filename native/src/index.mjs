import { createNativePlugin } from "./plugin.mjs";

// The bridge performs the protected request. No local execution callback exists.
export default createNativePlugin(async (request, options) => {
  let client;
  try {
    const { createMcpExecutionClient } = await import("@chio/bridge");
    client = createMcpExecutionClient({
      endpoint: options.endpoint,
      bearerToken: process.env[options.tokenEnv],
      trustedSigners: options.trustedSigners,
      subjectKey: options.subjectKey,
      capabilityId: options.capabilityId,
      serverId: options.serverId,
      sessionId: options.sessionId,
      timeoutMs: options.timeoutMs,
    });
  } catch {
    return { state: "not_dispatched", evidence: "unverified", requestId: request.requestId, reason: "Chio execution bridge or operator authority configuration unavailable" };
  }
  return client.execute({ tool: request.tool, arguments: request.arguments, requestId: request.requestId }, { signal: options.signal });
});
