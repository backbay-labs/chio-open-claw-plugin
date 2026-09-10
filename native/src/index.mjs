import { createNativePlugin } from "./plugin.mjs";
import { createHttpExecutor } from "./http-executor.mjs";

let executor, binding;
export default createNativePlugin(async (request, options) => {
  try {
    const {signal, ...configuration} = options;
    const identity = JSON.stringify(configuration);
    if (binding !== undefined && identity !== binding) throw new Error("Operator transport changed during host execution");
    if (!executor) {executor = createHttpExecutor(configuration); binding = identity;}
    return await executor(request, {signal});
  } catch {
    return {state: "not_dispatched", evidence: "unverified", requestId: request.requestId,
      reason: "Native OpenClaw requires a prepared launcher-owned HTTP gateway"};
  }
});
