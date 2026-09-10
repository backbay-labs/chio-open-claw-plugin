#!/usr/bin/env python3
"""Observe an actual Docker startup crash. No native host was created at this cut."""
import argparse,hashlib,json,os,subprocess,time,uuid,shutil,tempfile
from pathlib import Path
p=argparse.ArgumentParser()
for name in ['operator-state','package-dir','image','output']:p.add_argument('--'+name,required=True)
p.add_argument('--model-auth-file',type=Path)
p.add_argument('--cutpoint',choices=['relay-created','missing-watchdog'],default='relay-created')
a=p.parse_args();owner=Path(a.operator_state);package=Path(a.package_dir);output=Path(a.output);output.mkdir(mode=0o700)
original_package=package
if a.cutpoint=='missing-watchdog':
 temporary=Path(tempfile.mkdtemp(prefix='chio-openclaw-missing-watchdog-'))
 package=temporary/'package';shutil.copytree(original_package,package)
 (package/'scripts/cleanup-watchdog.mjs').unlink()
op=json.loads((owner/'operator.json').read_text());private=owner/('openclaw-early-crash-'+uuid.uuid4().hex);private.mkdir(mode=0o700)
def save(path,obj):path.write_text(json.dumps(obj,indent=2)+'\n')
def docker(args):return subprocess.check_output(['docker',*args],text=True).strip()
def observe():
 code="const f=require('fs');const files={};for(const n of f.readdirSync('/observe'))if(f.lstatSync('/observe/'+n).isFile())files[n]=f.readFileSync('/observe/'+n,'utf8');console.log(JSON.stringify({files,dispatch:f.readFileSync('/audit/dispatch.jsonl','utf8')}))"
 return json.loads(docker(['run','--rm','--network','none','--read-only','--mount',f"type=volume,src={op['volume']},dst=/observe,readonly",'--mount',f"type=volume,src={op['auditVolume']},dst=/audit,readonly",'--entrypoint','node',op['image'],'-e',code]))
prepare={'endpoint':f"http://127.0.0.1:{op['port']}",'bearerToken':op['agentToken'],'adminToken':op['adminToken'],'credentialTtlSeconds':900,'trustedSigners':[(owner/'sessions.sqlite.admission.kernel.pub').read_text().strip()],'serverId':'fs','sessionId':str(uuid.uuid4()),'journalDir':str(private/'journal'),'allowedTools':['read_text_file','write_file','edit_file','list_directory']}
save(private/'prepare.json',prepare);(private/'prepare.json').chmod(0o600)
config=private/'gateway.json';subprocess.run(['node',str(package/'node_modules/@chio/bridge/dist/prepare-gateway.js'),str(private/'prepare.json'),str(config)],capture_output=True,check=True)
runtime=private/'runtime';before=observe();save(output/'before.json',before)
env=os.environ.copy()
if a.cutpoint=='relay-created':env.update(NODE_OPTIONS='--import='+str(Path(__file__).with_name('kill-after-relay.mjs').resolve()),CHIO_EARLY_CRASH_LOG=str((output/'fault.json').resolve()))
command=['node',str(package/'scripts/protected.mjs'),'--gateway-config',str(config),'--state-dir',str(runtime),'--image',a.image,'--prompt','Use Chio to read /workspace/secret.txt.']
if a.model_auth_file:command+=['--model-auth-file',str(a.model_auth_file.resolve())]
with (output/'stdout.txt').open('w') as stdout,(output/'stderr.txt').open('w') as stderr:r=subprocess.run(command,env=env,stdout=stdout,stderr=stderr,timeout=90)
fault=json.loads((output/'fault.json').read_text()) if a.cutpoint=='relay-created' else json.loads((runtime/'launch.json').read_text())
deadline=time.monotonic()+(12 if a.cutpoint=='relay-created' else 0)
while time.monotonic()<deadline:
 if (runtime/'watchdog-cleanup.json').exists():break
 time.sleep(0.2)
names=docker(['container','ls','--all','--format','{{.Names}}']).splitlines();networks=docker(['network','ls','--format','{{.Name}}']).splitlines()
remaining=[n for n in [fault['relayName'],fault['agentName']] if n in names];network_present=fault['network'] in networks
after=observe();save(output/'after.json',after)
watchdog=json.loads((runtime/'watchdog-cleanup.json').read_text()) if (runtime/'watchdog-cleanup.json').exists() else None
result={'case':'startup-crash-before-native-host' if a.cutpoint=='relay-created' else 'watchdog-loading-failure-before-native-host','exitCode':r.returncode,'nativeHostStarted':False,'kernelSha256':op['kernelSha256'],'hostImage':a.image,'packageDirectory':str(original_package),'faultedPackageDirectory':str(package) if a.cutpoint=='missing-watchdog' else None,'privateConfiguration':str(config),'remainingContainers':remaining,'networkPresent':network_present,'watchdog':watchdog,'resourceUnchanged':before==after,'automaticCleanup':not remaining and not network_present}
save(output/'result.json',result)
if remaining or network_present:
 for name in remaining:
  inspected=json.loads(docker(['container','inspect',name]))[0]
  assert inspected['Image']==a.image and fault['network'] in inspected['NetworkSettings']['Networks']
  docker(['rm','-f',name])
 if network_present:
  inspected=json.loads(docker(['network','inspect',fault['network']]))[0];assert not inspected['Containers'];docker(['network','rm',fault['network']])
 save(output/'operator-cleanup.json',{'removedContainers':remaining,'removedNetwork':network_present,'volumesPreserved':[fault['volume'],fault['controlVolume']]})
assert r.returncode==(-9 if a.cutpoint=='relay-created' else 1) and before==after and result['automaticCleanup'],result
if a.cutpoint=='missing-watchdog':assert 'Cleanup watchdog stopped before readiness' in (output/'stderr.txt').read_text()
print(json.dumps(result))
