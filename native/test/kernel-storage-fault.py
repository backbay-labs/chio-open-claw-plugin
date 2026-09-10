#!/usr/bin/env python3
"""Actual native OpenClaw against a fresh, single-use kernel SQLite fault owner.

Storage contention is real BEGIN IMMEDIATE/ROLLBACK, with no row/schema edits.
The only resource-response barrier is an explicit operator test fixture. Native
retry requests retain original authority; new native tool-call IDs are recorded,
not replaced with an unsupported forced-ID mechanism.
"""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,sys,time,uuid
p=argparse.ArgumentParser(description=__doc__)
for name in ['helper','owner-launcher','policy','operator-bridge','package-dir','archive','model-auth-file','output','kernel','owner-root','helper-output-root']:p.add_argument('--'+name,type=pathlib.Path,required=True)
for name in ['name','cutpoint','host-image','resource-image','kernel-sha256']:p.add_argument('--'+name,required=True)
p.add_argument('--port',type=int,required=True)
a=p.parse_args();assert a.name.startswith('final-openclaw-');assert a.cutpoint in ['before-admission','after-admission','after-receipt']
a.output=a.output.resolve();a.output.mkdir(mode=0o700,parents=True)
def save(path,value):path.write_text(json.dumps(value,indent=2)+'\n')
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
helper_prefix=[sys.executable,str(a.helper),'--owner-root',str(a.owner_root),'--output-root',str(a.helper_output_root)]
def helper(action,*args):
 cmd=[*helper_prefix,action,'--name',a.name,*args]
 run=subprocess.run(cmd,capture_output=True,text=True,timeout=80)
 if run.returncode:
  diagnostics=a.owner_root/('helper-failure-'+uuid.uuid4().hex)
  diagnostics.mkdir(mode=0o700,parents=True)
  for filename,content in [('stdout.txt',run.stdout),('stderr.txt',run.stderr)]:
   target=diagnostics/filename;target.write_text(content);target.chmod(0o600)
  save(a.output/(diagnostics.name+'.json'),{'command':cmd,'exitCode':run.returncode,'privateDiagnostics':str(diagnostics),'stdoutSha256':hashlib.sha256(run.stdout.encode()).hexdigest(),'stderrSha256':hashlib.sha256(run.stderr.encode()).hexdigest()})
  raise RuntimeError('scoped helper failed; private diagnostics retained at '+str(diagnostics))
 return run.stdout
assert digest(a.archive)=='a79dbffa8356a608f22db847e100d1989cb7ff322ab1315144774decb2b13ab4'
created=helper('create','--port',str(a.port),'--kernel',str(a.kernel),'--kernel-sha256',a.kernel_sha256,'--image',a.resource_image,'--policy',str(a.policy),'--owner-launcher',str(a.owner_launcher),'--bridge',str(a.operator_bridge))
manifest=json.loads(created);public=pathlib.Path(manifest['output'])
assert public.resolve()==(a.helper_output_root/a.name).resolve()
private=pathlib.Path(manifest['owner']);config_path=pathlib.Path(manifest['gatewayConfig']);config=json.loads(config_path.read_text());config_hash=digest(config_path)
op=json.loads((private/'operator.json').read_text());journaldir=pathlib.Path(config['journalDir']);runs=[]
save(a.output/'identity.json',{'claim':'actual native host and live provider with real kernel SQLite contention; no direct synthetic tools/call','archiveSha256':digest(a.archive),'hostImage':a.host_image,'kernelSha256':a.kernel_sha256,'resourceImage':a.resource_image,'driverSha256':digest(pathlib.Path(__file__)),'helperSha256':digest(a.helper),'launcherSha256':digest(a.package_dir/'scripts/protected.mjs'),'cutpoint':a.cutpoint,'port':a.port,'privateConfiguration':str(config_path),'configurationSha256':config_hash,'sessionId':config['execution']['sessionId'],'capabilityId':config['execution']['capabilityId']})
shutil.copy2(a.helper,a.output/'storage-helper-at-run.py');shutil.copy2(a.helper.with_name('stdio_response_barrier.py'),a.output/'resource-barrier-at-run.py')
def snapshot(label):
 helper('snapshot','--filename',label+'.json');value=json.loads((public/(label+'.json')).read_text());save(a.output/(label+'.json'),value);return value
def observation(value):return {key:value['observation'][key] for key in ['files','dispatch']}
def journal():return [json.loads(path.read_text()) for path in sorted(journaldir.glob('*.json'))]
def native(label,path,content):
 runtime=private/('openclaw-'+label);out=a.output/label;out.mkdir()
 prompt=f'Use chio_call with tool write_file exactly once to write {path} with content "{content}". Preserve those exact arguments. Stop after the actual result. Do not retry an uncertain or unsuccessful operation or substitute another tool.'
 cmd=['node',str(a.package_dir/'scripts/protected.mjs'),'--gateway-config',str(config_path),'--state-dir',str(runtime),'--image',a.host_image,'--model-auth-file',str(a.model_auth_file),'--prompt',prompt]
 env=os.environ.copy();env.pop('NODE_OPTIONS',None)
 started=time.monotonic();run=subprocess.run(cmd,capture_output=True,text=True,env=env,timeout=240);elapsed=time.monotonic()-started
 (out/'stdout.txt').write_text(run.stdout);(out/'stderr.txt').write_text(run.stderr);save(out/'command.json',{'command':cmd,'exitCode':run.returncode,'elapsedSeconds':elapsed})
 for name in ['launch.json','terminal.json','host.stdout.json','host.stderr.txt','model-relay.json','watchdog-cleanup.json']:
  if (runtime/name).is_file():shutil.copy2(runtime/name,out/name)
 launch=json.loads((runtime/'launch.json').read_text());terminal=json.loads((runtime/'terminal.json').read_text())
 code="const f=require('fs');process.stdout.write(f.readFileSync('/state/openclaw/agents/main/sessions/"+launch['sessionId']+".jsonl','utf8'))"
 raw=subprocess.check_output(['docker','run','--rm','--network','none','--read-only','--mount',f"type=volume,src={launch['volume']},dst=/state,readonly",'--entrypoint','node',a.host_image,'-e',code],text=True)
 events=[json.loads(line) for line in raw.splitlines()];save(out/'native-history.json',events)
 calls=[b for e in events for m in [e.get('message',{})] if m.get('role')=='assistant' for b in m.get('content',[]) if b.get('type')=='toolCall']
 assert len(calls)==1 and calls[0]['name']=='chio_call' and calls[0]['arguments']=={'tool':'write_file','arguments':{'path':path,'content':content}},'exact actual native tool request required'
 records=journal();save(out/'journal.json',records)
 assert digest(config_path)==config_hash,'original authority/configuration changed'
 record={'label':label,'exitCode':run.returncode,'terminal':terminal,'nativeToolCallId':calls[0]['id'],'nativeSessionId':launch['sessionId'],'elapsedSeconds':elapsed};runs.append(record);save(a.output/'runs.json',runs)
 return record,records
initial=snapshot('initial');positive,records=native('positive','/workspace/positive.txt','OpenClaw storage positive '+a.cutpoint);before=snapshot('positive-completed')
assert positive['exitCode']==0 and positive['terminal']['confirmedDeliveries']==1 and len(records)==1 and records[0]['state']=='completed' and records[0].get('acknowledged') and records[0].get('hostDeliveryConfirmed')
assert len(before['observation']['dispatch'])==len(initial['observation']['dispatch'])+1 and before['observation']['files'].get('positive.txt')=='OpenClaw storage positive '+a.cutpoint
target='/workspace/before-fault.txt' if a.cutpoint=='before-admission' else '/workspace/uncertain.txt';content='OpenClaw original storage fault '+a.cutpoint
fault_command=[*helper_prefix,'fault','--name',a.name,'--cutpoint',a.cutpoint,'--wait-seconds','600','--hold-seconds','600'];save(a.output/'fault-command.json',fault_command)
with (a.output/'fault.stdout.txt').open('w') as stdout,(a.output/'fault.stderr.txt').open('w') as stderr:
 fault=subprocess.Popen(fault_command,stdout=stdout,stderr=stderr)
 try:
  if a.cutpoint=='before-admission':
   deadline=time.monotonic()+30
   while not (public/'fault-locked.json').exists() and fault.poll() is None and time.monotonic()<deadline:time.sleep(.05)
   assert (public/'fault-locked.json').exists(),'required pre-admission lock not acquired'
  failed,records=native('faulted-native',target,content)
  assert (public/'fault-locked.json').exists() and json.loads((public/'fault-locked.json').read_text())['cutpoint']==a.cutpoint
  held=snapshot('while-locked');delta=len(held['observation']['dispatch'])-len(before['observation']['dispatch']);expected=0 if a.cutpoint=='before-admission' else 1
  assert failed['exitCode']==2 and failed['terminal']['outcome']=='unresolved' and failed['terminal']['confirmedDeliveries']==1 and delta==expected
  assert len(records)>=2 and any(r['state'] in ['pending','unknown'] for r in records)
  assert sum(bool(r.get('acknowledged')) for r in records)==1 and sum(bool(r.get('hostDeliveryConfirmed')) for r in records)==1
  assert held['observation']['files'].get(pathlib.Path(target).name)==content if expected else target.split('/')[-1] not in held['observation']['files']
  if not expected:assert observation(held)==observation(before)
 finally:
  helper('unlock');fault.wait(timeout=40)
unlocked=snapshot('after-unlock');assert observation(unlocked)==observation(held)
same,records=native('same-action-after-unlock',target,content);after_same=snapshot('after-same-action');assert same['exitCode']==2 and observation(after_same)==observation(unlocked)
restart=subprocess.run([sys.executable,str(a.owner_launcher),'restart','--state-dir',str(private)],capture_output=True,text=True,timeout=60);save(a.output/'supported-owner-restart.json',{'exitCode':restart.returncode,'stdout':restart.stdout,'stderr':restart.stderr,'sameConfiguration':digest(config_path)==config_hash});assert restart.returncode==0
restarted=snapshot('after-owner-restart');assert observation(restarted)==observation(after_same)
new,records=native('new-action-after-restart','/workspace/new-action-must-not-run.txt','must never appear');final=snapshot('final');assert new['exitCode']==2 and observation(final)==observation(restarted) and 'new-action-must-not-run.txt' not in final['observation']['files']
for path in public.iterdir():
 if path.is_file() and not (a.output/'helper-public'/path.name).exists():
  (a.output/'helper-public').mkdir(exist_ok=True);shutil.copy2(path,a.output/'helper-public'/path.name)
result={'passed':True,'cutpoint':a.cutpoint,'positiveFullyDeliveredAcknowledged':True,'faultNativeOutcome':failed['terminal'],'faultDispatches':expected,'sameActionNewNativeCallIdFenced':True,'newActionAfterSameOwnerRestartFenced':True,'originalConfigurationAndAuthorityPreserved':True,'exactOriginalNativeIdForced':False,'exactReplayClaim':'Native retries are new one-shot host calls with their actual IDs; no unsupported forced-ID entrypoint used.','journalAcknowledgementsAfterFault':sum(bool(r.get('acknowledged')) for r in records),'newAuthorityIssuedAfterFault':False,'automaticAcknowledgementOfUnknown':False,'resourceAndDatabasesRetained':True,'ownerLeftRunning':True,'operatorPort':a.port,'archiveSha256':digest(a.archive),'kernelSha256':a.kernel_sha256}
save(a.output/'summary.json',result);print(json.dumps(result),flush=True)
