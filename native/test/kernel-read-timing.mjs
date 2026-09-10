// Operator-only timestamp instrumentation, never loaded in the protected child.
// Requests and results are forwarded unchanged. No provider headers/body are logged.
import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const destination = process.env.CHIO_TIMING_LOG;
const endpoint = process.env.CHIO_TIMING_KERNEL_ENDPOINT;
if (!destination || !endpoint?.startsWith('http://127.0.0.1:')) throw new Error('explicit timing output and isolated owner required');
const record = value => appendFileSync(destination, JSON.stringify(value) + '\n', { mode: 0o600 });
const requests = new WeakMap();
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function(event, ...args) {
  if (event === 'request' && args[0]?.url === '/mcp') {
    const state = { started: performance.now(), epoch: Date.now(), bytes: '' };
    requests.set(args[0], state);
    args[0].on('data', chunk => { state.bytes += chunk.toString('utf8'); });
  }
  return emit.call(this, event, ...args);
};
const end = http.ServerResponse.prototype.end;
http.ServerResponse.prototype.end = function(chunk, ...args) {
  const finished = performance.now();
  const state = requests.get(this.req);
  if (state) {
    let request;
    try { request = JSON.parse(state.bytes); } catch {}
    if (request?.method === 'tools/call') {
      record({ stage: 'native-gateway-request-to-response-end',
        startedAtEpochMs: state.epoch, startedMonotonicMs: state.started,
        finishedMonotonicMs: finished, elapsedMs: finished - state.started,
        requestId: request.id, tool: request.params?.name, arguments: request.params?.arguments,
        excludes: ['model', 'launcher startup', 'delivery ACK'],
        includes: ['local HTTP request ingestion', 'bridge journal', 'kernel exchange', 'evidence verification', 'response serialization'],
        endpoint: 'before ServerResponse.end writes the tool result' });
    }
  }
  return end.call(this, chunk, ...args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async function(input, init) {
  let request;
  try { request = JSON.parse(init?.body); } catch {}
  const url = String(input instanceof Request ? input.url : input);
  if (url !== endpoint || request?.method !== 'tools/call') return originalFetch(input, init);
  const started = performance.now(), epoch = Date.now();
  const response = await originalFetch(input, init);
  const headersAt = performance.now();
  let recorded = false;
  const finish = boundary => {
    if (recorded) return;
    recorded = true;
    const finished = performance.now();
    record({ stage: 'kernel-fetch-to-SDK-terminal-consumption', startedAtEpochMs: epoch,
      startedMonotonicMs: started, headersMonotonicMs: headersAt,
      finishedMonotonicMs: finished, elapsedMs: finished - started,
      requestId: request.params?._meta?.chioRequestId, tool: request.params?.name,
      arguments: request.params?.arguments, status: response.status, completionBoundary: boundary,
      excludes: ['model', 'launcher startup', 'bridge post-response verification', 'delivery ACK'],
      includes: ['HTTP transport', 'kernel authorization and durable execution', 'resource server', 'receipt signing and persistence', 'SDK response consumption through stream completion or terminal event parsing'] });
  };
  const text = response.text.bind(response);
  response.text = async function() {
    const body = await text();
    finish('response.text completed');
    return body;
  };
  if (response.body) {
    const getReader = response.body.getReader.bind(response.body);
    response.body.getReader = function(...args) {
      const reader = getReader(...args);
      const read = reader.read.bind(reader), cancel = reader.cancel.bind(reader);
      reader.read = async function(...readArgs) {
        const result = await read(...readArgs);
        if (result.done) finish('SDK stream reader reached end');
        return result;
      };
      reader.cancel = function(...cancelArgs) {
        finish('SDK cancelled stream after parsing terminal RPC event');
        return cancel(...cancelArgs);
      };
      return reader;
    };
  }
  return response;
};
