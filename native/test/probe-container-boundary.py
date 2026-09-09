#!/usr/bin/env python3
"""Probe processes inside an actual running protected OpenClaw container.

The operator injects canary processes with docker exec. These are independent
OS boundary observations, separate from native tool-dispatch acceptance.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import uuid

p=argparse.ArgumentParser(description=__doc__)
for name in ['package-dir','operator-state','output']:
 p.add_argument('--'+name,type=Path,required=True)
p.add_argument('--image',required=True)
p.add_argument('--resource-path',required=True)
a=p.parse_args();a.output.mkdir(mode=0o700)
op=json.loads((a.operator_state/'operator.json').read_text())
private=a.operator_state/('container-boundary-'+uuid.uuid4().hex);private.mkdir(mode=0o700)
prepare={'endpoint':f"http://127.0.0.1:{op['port']}",'bearerToken':op['agentToken'],'adminToken':op['adminToken'],'credentialTtlSeconds':900,'trustedSigners':[(a.operator_state/'sessions.sqlite.admission.kernel.pub').read_text().strip()],'serverId':'fs','sessionId':str(uuid.uuid4()),'journalDir':str(private/'journal'),'allowedTools':['read_text_file','write_file','edit_file','list_directory']}
request=private/'prepare.json';request.write_text(json.dumps(prepare));request.chmod(0o600)
config=private/'gateway.json'
subprocess.run(['node',str(a.package_dir/'node_modules/@chio/bridge/dist/prepare-gateway.js'),str(request),str(config)],capture_output=True,check=True)
runtime=Path('/tmp')/('chio-openclaw-boundary-runtime-'+uuid.uuid4().hex)
cmd=['node',str(a.package_dir/'scripts/protected.mjs'),'--gateway-config',str(config),'--image',a.image,'--state-dir',str(runtime),'--prompt','Use chio_call with read_text_file for '+a.resource_path+' exactly eight times, sequentially, one per model turn. These reads keep the actual agent active for independent container boundary probes. Stop on any unsuccessful result. Do not write anything.']
stdout=(a.output/'host.stdout.json').open('w');stderr=(a.output/'host.stderr.txt').open('w')
proc=subprocess.Popen(cmd,stdout=stdout,stderr=stderr)
listener=socket.socket();listener.bind(('0.0.0.0',0));listener.listen(8);port=listener.getsockname()[1]
try:
 deadline=time.monotonic()+35
 manifest=None
 while time.monotonic()<deadline:
  if (runtime/'launch.json').exists():
   manifest=json.loads((runtime/'launch.json').read_text())
   live=subprocess.run(['docker','inspect','--format','{{.State.Running}}',manifest['agentName']],capture_output=True,text=True)
   if live.returncode==0 and live.stdout.strip()=='true':break
  if proc.poll() is not None:raise RuntimeError('actual host exited before boundary probe')
  time.sleep(.1)
 else:raise RuntimeError('actual host container unavailable')
 info=json.loads(subprocess.check_output(['docker','inspect',manifest['agentName']],text=True))[0]
 network=json.loads(subprocess.check_output(['docker','network','inspect',manifest['network']],text=True))[0]
 control_code="const n=require('net'),d=require('dns');d.lookup('host.docker.internal',(e,a)=>{if(e)throw e;const s=n.connect(Number(process.argv[1]),a,()=>{s.destroy();console.log(JSON.stringify({address:a}));});s.on('error',e=>{throw e});});"
 control=json.loads(subprocess.check_output(['docker','exec',manifest['relayName'],'node','-e',control_code,str(port)],text=True,timeout=8))
 peer,_=listener.accept();peer.close()
 guest=r'''
const f=require('fs'),n=require('net');const [address,port,privatePath]=process.argv.slice(1);let checks={};
function denied(name,fn){try{const fd=fn();if(typeof fd==='number')f.closeSync(fd);checks[name]='BYPASS';}catch(e){checks[name]=['EACCES','EPERM','EROFS','ENOENT'].includes(e.code)?'denied':'unexpected:'+e.code;}}
denied('operator_config',()=>f.openSync(privatePath,'r'));
denied('protected_resource',()=>f.openSync('/workspace/secret.txt','r'));
denied('docker_socket',()=>f.openSync('/var/run/docker.sock','r'));
denied('configuration_write',()=>f.openSync('/config/openclaw.json','r+'));
denied('plugin_write',()=>f.openSync('/opt/chio/node_modules/@chio/openclaw-kernel/src/index.mjs','r+'));
denied('root_write',()=>f.openSync('/forbidden-root-marker','wx'));
f.writeFileSync('/state/boundary-positive.txt','permitted isolated state');checks.isolated_state=f.readFileSync('/state/boundary-positive.txt','utf8')==='permitted isolated state'?'allowed':'FAILED';
checks.operator_credentials=['OPENAI_API_KEY','CHIO_KERNEL_TOKEN','CHIO_ADMIN_TOKEN'].some(k=>process.env[k])?'BYPASS':'absent';
const status=f.readFileSync('/proc/self/status','utf8');checks.no_privilege=/CapEff:\s+0000000000000000/.test(status)&&/NoNewPrivs:\s+1/.test(status)?'enforced':'BYPASS';
const s=n.connect(Number(port),address);let finished=false;function done(value){if(finished)return;finished=true;checks.direct_host_tcp=value;s.destroy();console.log(JSON.stringify(checks));}
s.on('connect',()=>done('BYPASS'));s.on('error',()=>done('denied'));setTimeout(()=>done('denied'),1200).unref();
'''
 results=[]
 for descendant in [False,True]:
  code=guest if not descendant else "const c=require('child_process');const r=c.spawnSync(process.execPath,['-e',"+json.dumps(guest)+",...process.argv.slice(1)],{encoding:'utf8'});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exit(r.status??1);"
  run=subprocess.run(['docker','exec',manifest['agentName'],'node','-e',code,control['address'],str(port),str(config)],capture_output=True,text=True,timeout=8)
  (a.output/('probe-'+str(int(descendant))+'.stderr.txt')).write_text(run.stderr)
  results.append({'descendant':descendant,'exitCode':run.returncode,'checks':json.loads(run.stdout) if run.returncode==0 else {},'stdout':run.stdout})
 listener.settimeout(.2)
 extra=0
 try:
  while True:
   peer,_=listener.accept();peer.close();extra+=1
 except TimeoutError:pass
 passed=network['Internal'] and info['HostConfig']['ReadonlyRootfs'] and info['Config']['User']=='1000:1000' and extra==0
 for result in results:
  expected={'isolated_state':'allowed','operator_credentials':'absent','no_privilege':'enforced'}
  passed &= result['exitCode']==0 and len(result['checks'])==10 and all(value==expected.get(key,'denied') for key,value in result['checks'].items())
 observation={'passed':bool(passed),'image':a.image,'manifest':str(runtime/'launch.json'),'internalNetwork':network['Internal'],'readonlyRoot':info['HostConfig']['ReadonlyRootfs'],'capDrop':info['HostConfig']['CapDrop'],'securityOpt':info['HostConfig']['SecurityOpt'],'mounts':info['Mounts'],'positiveRelayConnection':True,'forbiddenHostConnections':extra,'runs':results,'claim':'independent OS processes inside the actual host container; full host gate remains open'}
 (a.output/'observation.json').write_text(json.dumps(observation,indent=2)+'\n')
 code=proc.wait(timeout=180)
 (a.output/'host-run.json').write_text(json.dumps({'command':cmd,'exitCode':code,'terminal':json.loads((runtime/'terminal.json').read_text())},indent=2)+'\n')
 print(json.dumps({'passed':bool(passed),'hostExitCode':code}),flush=True)
 if not passed or code!=0:raise RuntimeError('boundary qualification failed; preserve evidence')
finally:
 listener.close();stdout.close();stderr.close()
 if proc.poll() is None:
  proc.terminate()
  try:proc.wait(timeout=15)
  except subprocess.TimeoutExpired:proc.kill();proc.wait()
