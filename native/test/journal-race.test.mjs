import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

for (const mismatch of [false, true]) test(`a stale missing-completion read ${mismatch ? "with changed arguments cleans its new lock" : "cannot redispatch after acquiring the lock"}`, () => {
  // Isolate built-in filesystem mocks in a child process. This forces a race
  // cutpoint without injecting a testing callback into production code.
  const script = `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import assert from 'node:assert/strict';
    const files = new Map();
    let firstDispatch = false, intercepted = false, effects = 0;
    let started, sawStaleRead, releaseStaleRead;
    const startedGate = new Promise(r => started = r);
    const readGate = new Promise(r => sawStaleRead = r);
    const releaseGate = new Promise(r => releaseStaleRead = r);
    const missing = () => Object.assign(new Error('missing'), {code:'ENOENT'});
    fs.mkdir = async () => {};
    fs.open = async (path, flags) => {
      if (flags === 'wx') {
        if (files.has(path)) throw Object.assign(new Error('exists'), {code:'EEXIST'});
        files.set(path, '');
      }
      return {writeFile:async value => files.set(path,value), sync:async()=>{}, close:async()=>{}};
    };
    fs.readFile = async path => {
      if (files.has(path)) return files.get(path);
      if (firstDispatch && !intercepted) {
        intercepted = true; sawStaleRead(); await releaseGate;
      }
      throw missing();
    };
    fs.unlink = async path => {files.delete(path);};
    syncBuiltinESMExports();
    const {DispatchJournal} = await import(${JSON.stringify(new URL("../src/journal.mjs", import.meta.url).href)});
    const journal = new DispatchJournal('/isolated-test-state');
    const request = {requestId:'op',caller:{host:'openclaw',sessionId:'one'},authority:{subjectKey:'subject',serverId:'files'},tool:'write',arguments:{}};
    const response = {state:'completed',evidence:'verified',result:'once'};
    const a = journal.run(request,async()=>{effects++;firstDispatch=true;started();await readGate;return response;});
    await startedGate;
    const bRequest = ${mismatch ? "{...request,arguments:{changed:true}}" : "request"};
    const b = journal.run(bRequest,async()=>{effects++;return response;});
    assert.deepEqual(await a,response);
    releaseStaleRead();
    ${mismatch ? "await assert.rejects(b,/different request/);" : "assert.deepEqual(await b,response);"}
    assert.equal(effects,1);
    assert.equal([...files.keys()].some(p=>p.endsWith('pending.json')),false);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
