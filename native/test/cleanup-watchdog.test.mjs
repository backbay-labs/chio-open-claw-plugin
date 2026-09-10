import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('Docker inventory failure cannot establish successful cleanup',()=>{
 const root=mkdtempSync(join(tmpdir(),'chio-watchdog-test-'));
 try {
  const bin=join(root,'bin');mkdirSync(bin);
  writeFileSync(join(bin,'docker'),'#!/bin/sh\nexit 1\n',{mode:0o700});
  const id='46cc73cf-ac46-4158-b01f-c6c842399320';
  const manifest={schema:'chio.openclaw.protected-run.v1',sessionId:id,image:'sha256:'+'a'.repeat(64),network:`chio-required-openclaw-${id}`,agentName:`chio-openclaw-agent-${id}`,relayName:`chio-openclaw-relay-${id}`,volume:'retained-state',controlVolume:'retained-control'};
  writeFileSync(join(root,'launch.json'),JSON.stringify(manifest));
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/cleanup-watchdog.mjs',import.meta.url)),root],{env:{PATH:bin},input:'',encoding:'utf8',timeout:10000});
  assert.equal(run.status,1,run.stderr);
  const record=JSON.parse(readFileSync(join(root,'watchdog-cleanup.json'),'utf8'));
  assert.equal(record.status,'unresolved');
  assert.equal(record.reason,'Docker cleanup inventory unavailable');
  assert.deepEqual(record.volumesPreserved,['retained-state','retained-control']);
 } finally {rmSync(root,{recursive:true,force:true});}
});
