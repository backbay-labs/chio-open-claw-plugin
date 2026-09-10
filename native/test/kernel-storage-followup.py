#!/usr/bin/env python3
"""Continue native retry observations on an original interrupted storage case.

This requires the original completed positive and fault evidence, unchanged
authority, a released genuine SQLite lock, and identical resource observations.
It creates no kernel, authority, config, journal, resource volume or fault.
"""
import argparse,hashlib,json,os,pathlib,shutil,signal,subprocess,sys,tarfile,time,uuid
p=argparse.ArgumentParser(description=__doc__)
for name in ['helper','owner-launcher','package-dir','archive','model-auth-file','output','kernel','owner-root','helper-output-root','original-output']:p.add_argument('--'+name,type=pathlib.Path,required=True)
for name in ['name','cutpoint','host-image','resource-image','kernel-sha256']:p.add_argument('--'+name,required=True)
p.add_argument('--port',type=int,required=True)
a=p.parse_args();assert a.name.startswith('final-openclaw-');assert a.cutpoint in ['before-admission','after-admission','after-receipt']
a.output=a.output.resolve();a.output.mkdir(mode=0o700,parents=True)
def save(path,value):path.write_text(json.dumps(value,indent=2)+'\n')
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
helper_prefix=[sys.executable,str(a.helper),'--owner-root',str(a.owner_root),'--output-root',str(a.helper_output_root)]
def captured(command,folder,timeout,record,env=None):
 folder.mkdir(mode=0o700,parents=True,exist_ok=True)
 timed=False;cleanup=[];started=time.monotonic()
 with (folder/'stdout.txt').open('w') as out,(folder/'stderr.txt').open('w') as err:
  os.chmod(folder/'stdout.txt',0o600);os.chmod(folder/'stderr.txt',0o600)
  child=subprocess.Popen(command,stdout=out,stderr=err,env=env,start_new_session=True)
  try:code=child.wait(timeout=timeout)
  except subprocess.TimeoutExpired:
   timed=True
   for signum,grace in [(signal.SIGTERM,15),(signal.SIGKILL,10)]:
    try:os.killpg(child.pid,signum)
    except ProcessLookupError:pass
    except OSError as error:cleanup.append({'signal':int(signum),'error':type(error).__name__})
    try:child.wait(timeout=grace);break
    except subprocess.TimeoutExpired:cleanup.append({'signal':int(signum),'waitTimedOut':True})
   code=child.poll()
 result=subprocess.CompletedProcess(command,code,(folder/'stdout.txt').read_text(),(folder/'stderr.txt').read_text())
 save(record,{'command':command,'exitCode':code,'timedOut':timed,'createdProcessGroup':child.pid,'cleanupErrors':cleanup,'descendantCleanupVerified':False if timed else None,'elapsedSeconds':time.monotonic()-started,'stdoutPath':str(folder/'stdout.txt'),'stderrPath':str(folder/'stderr.txt'),'stdoutSha256':hashlib.sha256(result.stdout.encode()).hexdigest(),'stderrSha256':hashlib.sha256(result.stderr.encode()).hexdigest()})
 if timed:raise subprocess.TimeoutExpired(command,timeout)
 return result

def helper(action,*args):
 cmd=[*helper_prefix,action,'--name',a.name,*args]
 ident=uuid.uuid4().hex;diagnostics=a.owner_root/('.'+a.name+'-followup-diagnostics')/ident
 run=captured(cmd,diagnostics,80,a.output/('helper-'+ident+'.json'))
 if run.returncode:raise RuntimeError('scoped helper failed; private diagnostics retained at '+str(diagnostics))
 return run.stdout
assert digest(a.archive)=='a79dbffa8356a608f22db847e100d1989cb7ff322ab1315144774decb2b13ab4'
with tarfile.open(a.archive) as archive:
 installed=[member for member in archive.getmembers() if member.isfile()]
 for member in installed:
  relative=pathlib.Path(member.name).relative_to('package');assert '..' not in relative.parts
  assert (a.package_dir/relative).read_bytes()==archive.extractfile(member).read()
save(a.output/'installed-archive-comparison.json',{'archiveSha256':digest(a.archive),'regularFilesCompared':len(installed),'mismatches':0})
original=json.loads((a.original_output/'identity.json').read_text())
assert digest(a.kernel)==a.kernel_sha256==original['kernelSha256']
assert original['cutpoint']==a.cutpoint=='after-receipt' and original['port']==a.port
assert original['archiveSha256']==digest(a.archive) and original['hostImage']==a.host_image
assert original['launcherSha256']==digest(a.package_dir/'scripts/protected.mjs')
manifest=json.loads((a.helper_output_root/a.name/'manifest.json').read_text());public=pathlib.Path(manifest['output'])
assert public.resolve()==(a.helper_output_root/a.name).resolve()
assert a.owner_launcher.resolve()==pathlib.Path(manifest['ownerLauncher']).resolve() and digest(a.owner_launcher)==manifest['ownerLauncherSha256']
assert pathlib.Path(manifest['gatewayConfig']).resolve()==pathlib.Path(original['privateConfiguration']).resolve()
private=pathlib.Path(manifest['owner']);config_path=pathlib.Path(manifest['gatewayConfig']);config=json.loads(config_path.read_text());config_hash=digest(config_path)
assert config_hash==original['configurationSha256']
op=json.loads((private/'operator.json').read_text());assert op['kernelSha256']==a.kernel_sha256 and op['port']==a.port and op['image']==a.resource_image==original['resourceImage']
journaldir=pathlib.Path(config['journalDir']);runs=[]
save(a.output/'identity.json',{'claim':'actual native follow-up after recorded observation failure; original fault evidence remains required','originalFailedEvidence':str(a.original_output),'originalIdentitySha256':digest(a.original_output/'identity.json'),'archiveSha256':digest(a.archive),'hostImage':a.host_image,'kernelSha256':a.kernel_sha256,'resourceImage':a.resource_image,'driverSha256':digest(pathlib.Path(__file__)),'helperSha256':digest(a.helper),'launcherSha256':digest(a.package_dir/'scripts/protected.mjs'),'cutpoint':a.cutpoint,'port':a.port,'privateConfiguration':str(config_path),'configurationSha256':config_hash,'sessionId':config['execution']['sessionId'],'capabilityId':config['execution']['capabilityId']})
shutil.copy2(a.helper,a.output/'storage-helper-at-run.py');shutil.copy2(a.helper.with_name('stdio_response_barrier.py'),a.output/'resource-barrier-at-run.py')
def snapshot(label):
 helper('snapshot','--filename','followup-'+label+'.json');value=json.loads((public/('followup-'+label+'.json')).read_text());save(a.output/(label+'.json'),value);return value
def observation(value):return {key:value['observation'][key] for key in ['files','dispatch']}
def journal():return [json.loads(path.read_text()) for path in sorted(journaldir.glob('*.json'))]
def check_original_journal():
 assert {str(path):digest(path) for path in journaldir.glob('*.json')}==frozen_journal
 rows=journal();assert len(rows)==2
 assert sum(bool(row.get('acknowledged')) for row in rows)==sum(bool(row.get('hostDeliveryConfirmed')) for row in rows)==1
 assert sum(row['state']=='completed' and row.get('acknowledged') and row.get('hostDeliveryConfirmed') for row in rows)==1
 assert sum(row['state'] in ['pending','unknown'] and not row.get('acknowledged') and not row.get('hostDeliveryConfirmed') for row in rows)==1

def native(label,path,content):
 assert time.time()+240<manifest['sessionCredential']['expiresAt'],'original authority lacks time for native fence proof; do not renew or reissue'
 runtime=private/('openclaw-'+label);assert not runtime.exists();out=a.output/label;out.mkdir()
 prompt=f'Use chio_call with tool write_file exactly once to write {path} with content "{content}". Preserve those exact arguments. Stop after the actual result. Do not retry an uncertain or unsuccessful operation or substitute another tool.'
 cmd=['node',str(a.package_dir/'scripts/protected.mjs'),'--gateway-config',str(config_path),'--state-dir',str(runtime),'--image',a.host_image,'--model-auth-file',str(a.model_auth_file),'--prompt',prompt]
 env=os.environ.copy();env.pop('NODE_OPTIONS',None)
 started=time.monotonic();run=captured(cmd,out,240,out/'process-scope.json',env);elapsed=time.monotonic()-started
 (out/'stdout.txt').write_text(run.stdout);(out/'stderr.txt').write_text(run.stderr);save(out/'command.json',{'command':cmd,'exitCode':run.returncode,'elapsedSeconds':elapsed})
 for name in ['launch.json','terminal.json','host.stdout.json','host.stderr.txt','model-relay.json','watchdog-cleanup.json']:
  if (runtime/name).is_file():shutil.copy2(runtime/name,out/name)
 launch=json.loads((runtime/'launch.json').read_text());terminal=json.loads((runtime/'terminal.json').read_text())
 code="const f=require('fs');process.stdout.write(f.readFileSync('/state/openclaw/agents/main/sessions/"+launch['sessionId']+".jsonl','utf8'))"
 history=captured(['docker','run','--rm','--network','none','--read-only','--mount',f"type=volume,src={launch['volume']},dst=/state,readonly",'--entrypoint','node',a.host_image,'-e',code],out/'history-reader',40,out/'history-reader-scope.json');assert history.returncode==0
 raw=history.stdout
 events=[json.loads(line) for line in raw.splitlines()];save(out/'native-history.json',events)
 calls=[b for e in events for m in [e.get('message',{})] if m.get('role')=='assistant' for b in m.get('content',[]) if b.get('type')=='toolCall']
 assert len(calls)==1 and calls[0]['name']=='chio_call' and calls[0]['arguments']=={'tool':'write_file','arguments':{'path':path,'content':content}},'exact actual native tool request required'
 results=[e['message'] for e in events if e.get('message',{}).get('role')=='toolResult']
 assert len(results)==1 and results[0]['toolCallId']==calls[0]['id'] and results[0]['toolName']=='chio_call'
 assert results[0]['details']['state']=='not_dispatched' and results[0]['details']['reason']=='an unresolved operation fences this gateway; operator reconciliation required'
 records=journal();check_original_journal();save(out/'journal.json',records)
 assert digest(config_path)==config_hash,'original authority/configuration changed'
 record={'label':label,'exitCode':run.returncode,'terminal':terminal,'nativeToolCallId':calls[0]['id'],'nativeSessionId':launch['sessionId'],'elapsedSeconds':elapsed};runs.append(record);save(a.output/'runs.json',runs)
 return record,records
prior=json.loads((a.original_output/'runs.json').read_text())
assert len(prior)==2 and prior[0]['label']=='positive' and prior[1]['label']=='faulted-native'
positive,failed=prior
before=json.loads((a.original_output/'positive-completed.json').read_text())
held=json.loads((a.original_output/'while-locked.json').read_text())
assert positive['exitCode']==0 and positive['terminal']['confirmedDeliveries']==1
assert failed['exitCode']==2 and failed['terminal']['outcome']=='unresolved' and failed['terminal']['confirmedDeliveries']==1
expected=1;target='/workspace/uncertain.txt';content='OpenClaw original storage fault after-receipt'
assert len(held['observation']['dispatch'])==len(before['observation']['dispatch'])+expected
assert held['observation']['files']['uncertain.txt']==content
locked=json.loads((public/'fault-locked.json').read_text());released=json.loads((public/'fault-released.json').read_text())
assert locked['cutpoint']==a.cutpoint and released['rowsOrSchemaMutated'] is False
assert released['releasedAtEpoch']>=locked['lockedAtEpoch']
records=journal();retained=json.loads((a.original_output/'faulted-native/journal.json').read_text())
assert {row['requestId']:row for row in records}=={row['requestId']:row for row in retained}
frozen_journal={str(path):digest(path) for path in journaldir.glob('*.json')};check_original_journal()
assert any(r['state'] in ['pending','unknown'] for r in records)
unlocked=snapshot('after-unlock');assert observation(unlocked)==observation(held)
same,records=native('same-action-after-unlock',target,content);after_same=snapshot('after-same-action');assert same['exitCode']==2 and observation(after_same)==observation(unlocked)
restart=captured([sys.executable,str(a.owner_launcher),'restart','--state-dir',str(private)],a.output/'owner-restart-raw',60,a.output/'owner-restart-scope.json');save(a.output/'supported-owner-restart.json',{'exitCode':restart.returncode,'stdout':restart.stdout,'stderr':restart.stderr,'sameConfiguration':digest(config_path)==config_hash});assert restart.returncode==0
check_original_journal()
restarted=snapshot('after-owner-restart');assert observation(restarted)==observation(after_same)
new,records=native('new-action-after-restart','/workspace/new-action-must-not-run.txt','must never appear');final=snapshot('final');assert new['exitCode']==2 and observation(final)==observation(restarted) and 'new-action-must-not-run.txt' not in final['observation']['files']
check_original_journal()
for path in public.iterdir():
 if path.is_file() and not (a.output/'helper-public'/path.name).exists():
  (a.output/'helper-public').mkdir(exist_ok=True);shutil.copy2(path,a.output/'helper-public'/path.name)
result={'passed':True,'originalFailedRunPreserved':True,'originalFaultEvidenceRequired':str(a.original_output),'cutpoint':a.cutpoint,'positiveFullyDeliveredAcknowledged':True,'faultNativeOutcome':failed['terminal'],'faultDispatches':expected,'sameActionNewNativeCallIdFenced':True,'newActionAfterSameOwnerRestartFenced':True,'originalConfigurationAndAuthorityPreserved':True,'exactOriginalNativeIdForced':False,'exactReplayClaim':'Native retries are new one-shot host calls with their actual IDs; no unsupported forced-ID entrypoint used.','journalAcknowledgementsAfterFault':sum(bool(r.get('acknowledged')) for r in records),'newAuthorityIssuedAfterFault':False,'automaticAcknowledgementOfUnknown':False,'resourceAndDatabasesRetained':True,'ownerLeftRunning':True,'operatorPort':a.port,'archiveSha256':digest(a.archive),'kernelSha256':a.kernel_sha256}
save(a.output/'summary.json',result);print(json.dumps(result),flush=True)
