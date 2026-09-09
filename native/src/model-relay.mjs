import {createServer} from "node:http";
import {randomBytes} from "node:crypto";
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
export function validateModelRequest(body, model) {
  if (!only(body, ["model","messages","tools","tool_choice","parallel_tool_calls","stream","stream_options","max_tokens","max_completion_tokens","temperature","top_p","frequency_penalty","presence_penalty","seed","stop","store"]) || body.model !== model || body.store === true || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 512) throw new Error("Unsupported model request");
  for (const key of ["max_tokens", "max_completion_tokens"]) if (body[key] !== undefined && (!Number.isSafeInteger(body[key]) || body[key] < 1 || body[key] > 4096)) throw new Error("Model output budget refused");
  for (const tool of body.tools ?? []) if (!only(tool, ["type","function"]) || tool.type !== "function" || !only(tool.function, ["name","description","parameters","strict"]) || tool.function.name !== "chio_call" || !object(tool.function.parameters)) throw new Error("Only native Chio function definitions are allowed");
  if (body.tool_choice !== undefined && !["auto","none","required"].includes(body.tool_choice)
    && !(only(body.tool_choice,["type","function"]) && body.tool_choice.type === "function" && only(body.tool_choice.function,["name"]) && body.tool_choice.function.name === "chio_call")) throw new Error("Alternate tool choice refused");
  for (const message of body.messages) {
    if (!only(message, ["role","content","tool_calls","tool_call_id","name"]) || !["system","developer","user","assistant","tool"].includes(message.role)) throw new Error("Only inline model history is supported");
    if (message.content !== null && typeof message.content !== "string" && !(Array.isArray(message.content) && message.content.every(part => only(part,["type","text"]) && part.type === "text" && typeof part.text === "string"))) throw new Error("Nontext or referenced content refused");
    for (const call of message.tool_calls ?? []) if (!only(call,["id","type","function"]) || typeof call.id !== "string" || call.type !== "function" || !only(call.function,["name","arguments"]) || call.function.name !== "chio_call" || typeof call.function.arguments !== "string") throw new Error("Alternate function history refused");
  }
}
export async function startModelRelay(apiKey, model = "gpt-4.1-mini") {
  if (!apiKey || model !== "gpt-4.1-mini") throw new Error("Operator key and pinned model required");
  const token = randomBytes(32).toString("base64url"), events = []; let port, remaining = 100;
  const server = createServer(async (request, response) => {
    const event = {forwarded: false}; events.push(event);
    const controller = new AbortController(); response.once("close", () => controller.abort());
    try {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions" || request.headers.host !== `127.0.0.1:${port}` || request.headers.origin || request.headers.authorization !== `Bearer ${token}` || remaining <= 0) throw new Error("Model route refused");
      let raw = ""; for await (const chunk of request) {raw += chunk; if (Buffer.byteLength(raw) > 8*1024*1024) throw new Error("Model request too large");}
      const body = JSON.parse(raw); validateModelRequest(body, model); remaining--;
      // This supported mode admits one tool per model turn. The resource owner
      // fences any overlapping call until the guest confirms the first result.
      body.store = false; body.parallel_tool_calls = false;
      if (body.max_tokens === undefined && body.max_completion_tokens === undefined) body.max_tokens = 4096;
      event.tools = (body.tools ?? []).map(tool => tool.function.name);
      event.results = body.messages.filter(message => message.role === "tool").map(message => ({toolCallId: message.tool_call_id, content: message.content}));
      const upstream = await fetch("https://api.openai.com/v1/chat/completions", {method: "POST", redirect: "error", signal: AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]), headers: {"Content-Type":"application/json",Authorization:`Bearer ${apiKey}`}, body: JSON.stringify(body)});
      event.forwarded = true; event.status = upstream.status;
      response.writeHead(upstream.status, {"Content-Type":upstream.headers.get("content-type") ?? "application/json"});
      if (upstream.body) for await (const chunk of upstream.body) response.write(chunk);
      response.end();
    } catch {event.failed = true; if (!response.headersSent) response.writeHead(403,{"Content-Type":"application/json"}); response.end('{"error":{"message":"Operator model relay refused or failed"}}');}
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);}); port=server.address().port;
  return {port,token,events,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
