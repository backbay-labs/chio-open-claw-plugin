#!/usr/bin/env node
// A private parent lifeline owns only this run's exact container/network names.
// Keep resource, state and control volumes for operator recovery.
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
const [state] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(join(state,'launch.json'),'utf8'));
const id = manifest.sessionId;
if (!/^[a-f0-9-]{36}$/.test(id) || manifest.schema !== 'chio.openclaw.protected-run.v1'
 || manifest.network !== `chio-required-openclaw-${id}` || manifest.agentName !== `chio-openclaw-agent-${id}`
 || manifest.relayName !== `chio-openclaw-relay-${id}` || !/^sha256:[a-f0-9]{64}$/.test(manifest.image)) throw new Error('Unrecognized private run identity');
const docker = args => spawnSync('docker',args,{encoding:'utf8',timeout:10000});
function exists(kind,name) {
 const result=docker([kind,'ls',...(kind==='container'?['--all']:[]),'--filter',`name=${name}`,'--format',kind==='container'?'{{.Names}}':'{{.Name}}']);
 // A failed Docker query is never evidence that the resource is absent.
 if(result.status!==0)throw new Error('Docker cleanup inventory unavailable');
 return result.stdout.trim().split('\n').includes(name);
}
let closing = false;
async function cleanup() {
 if (closing) return; closing = true;
 const events=[];
 try {
  // Creation may already be in flight when the parent dies. Repeat only
  // idempotent cleanup, never host creation or protected tool dispatch.
  for (let attempt=0;attempt<3;attempt++) {
   for (const name of [manifest.agentName,manifest.relayName]) {
    if(!exists('container',name))continue;
    const inspected=docker(['container','inspect',name]);
    if(inspected.status!==0){if(!exists('container',name))continue;throw new Error('Container identity unavailable');}
    const value=JSON.parse(inspected.stdout)[0];
    if(value.Image!==manifest.image || !Object.hasOwn(value.NetworkSettings.Networks,manifest.network)) throw new Error('Refuse changed container identity');
    docker(['rm','-f',name]);
    const absent=!exists('container',name);
    events.push({name,attempt,wasRunning:value.State.Running,removed:absent});
    if(!absent)throw new Error('Run container cleanup failed');
   }
   if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1000));
  }
  const remaining=[manifest.agentName,manifest.relayName].filter(name=>exists('container',name));
  let networkRemoved=!exists('network',manifest.network);
  if(!networkRemoved){const inspected=docker(['network','inspect',manifest.network]);if(inspected.status!==0)throw new Error('Network identity unavailable');const value=JSON.parse(inspected.stdout)[0];if(Object.keys(value.Containers??{}).length)throw new Error('Refuse network with remaining endpoints');docker(['network','rm',manifest.network]);networkRemoved=!exists('network',manifest.network);}
  if(remaining.length||!networkRemoved)throw new Error('Run cleanup remains unresolved');
  writeFileSync(join(state,'watchdog-cleanup.json'),JSON.stringify({status:'cleaned',events,networkRemoved,volumesPreserved:[manifest.volume,manifest.controlVolume]})+'\n',{mode:0o600,flag:'wx'});
 } catch(error) {
  writeFileSync(join(state,'watchdog-cleanup.json'),JSON.stringify({status:'unresolved',reason:error.message,events,volumesPreserved:[manifest.volume,manifest.controlVolume]})+'\n',{mode:0o600,flag:'wx'});process.exitCode=1;
 }
 process.stdin.destroy();
}
process.stdin.once('end',()=>{void cleanup();});process.stdin.once('error',()=>{void cleanup();});process.stdin.resume();

// The parent waits for this handshake before it creates owned resources.
process.stdout.write("chio-watchdog-ready\n");
