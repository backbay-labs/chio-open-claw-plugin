#!/usr/bin/env python3
"""Four bounded live-provider/native-host failure cutpoints on a dedicated owner.

The operator-only injector is copied from the qualified Codex cutpoint helper.
It is never delivered inside the agent container. No unknown effect is retried.
"""
import argparse,hashlib,json,os,pathlib,shutil,signal,socket,sqlite3,subprocess,time,uuid
p=argparse.ArgumentParser(description=__doc__)
for name in ['operator-state','package-dir','output','model-auth-file']:p.add_argument('--'+name,type=pathlib.Path,required=True)
p.add_argument('--image',required=True)
p.add_argument('--cases',nargs='+',choices=['cancel-before-dispatch','kernel-network-refused','journal-before-dispatch','journal-after-effect'],default=['cancel-before-dispatch','kernel-network-refused','journal-before-dispatch','journal-after-effect'])
a=p.parse_args();a.output=a.output.resolve();a.output.mkdir(mode=0o700)
op=json.loads((a.operator_state/'operator.json').read_text());fault=pathlib.Path(__file__).with_name('subscription-faults.mjs').resolve();results=[]
def save(path,value):path.write_text(json.dumps(value,indent=2)+'\n')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def observe():
 code="const f=require('fs'),c=require('crypto');const files={};for(const n of f.readdirSync('/observe'))if(f.lstatSync('/observe/'+n).isFile())files[n]=c.createHash('sha256').update(f.readFileSync('/observe/'+n)).digest('hex');console.log(JSON.stringify({files,dispatch:f.readFileSync('/audit/dispatch.jsonl','utf8').trim().split('\\n').filter(Boolean).map(JSON.parse)}))"
 return json.loads(subprocess.check_output(['docker','run','--rm','--network','none','--read-only','--mount',f"type=volume,src={op['volume']},dst=/observe,readonly",'--mount',f"type=volume,src={op['auditVolume']},dst=/audit,readonly",'--entrypoint','node',op['image'],'-e',code],text=True))
def owner_records(config):
 with sqlite3.connect('file:'+str(a.operator_state/'sessions.sqlite')+'?mode=ro',uri=True) as db:
  rows=db.execute('SELECT record_json FROM remote_session_credential_calls WHERE session_id=?',(config['execution']['sessionId'],)).fetchall()
 return [{'requestId':r.get('requestId',r.get('request_id')),'state':r.get('state')} for (raw,) in rows for r in [json.loads(raw)]]
def command(conf,runtime,prompt):return ['node',str(a.package_dir/'scripts/protected.mjs'),'--gateway-config',str(conf),'--state-dir',str(runtime),'--image',a.image,'--model-auth-file',str(a.model_auth_file),'--prompt',prompt]
def export_run(runtime,out):
 out.mkdir()
 for name in ['launch.json','terminal.json','host.stdout.json','host.stderr.txt','model-relay.json','watchdog-cleanup.json']:
  if (runtime/name).is_file():shutil.copy2(runtime/name,out/name)
 launch=json.loads((runtime/'launch.json').read_text());code="const f=require('fs');process.stdout.write(f.readFileSync('/state/openclaw/agents/main/sessions/"+launch['sessionId']+".jsonl','utf8'))"
 raw=subprocess.check_output(['docker','run','--rm','--network','none','--read-only','--mount',f"type=volume,src={launch['volume']},dst=/state,readonly",'--entrypoint','node',a.image,'-e',code],text=True)
 calls=[b for line in raw.splitlines() for m in [json.loads(line).get('message',{})] if m.get('role')=='assistant' for b in m.get('content',[]) if b.get('type')=='toolCall']
 save(out/'native-calls.json',calls)
 terminal=json.loads((runtime/'terminal.json').read_text())
 return calls,terminal
save(a.output/'identity.json',{'hostImage':a.image,'kernelSha256':op['kernelSha256'],'faultInjectorSha256':sha(fault),'driverSha256':sha(pathlib.Path(__file__)),'launcherSha256':sha(a.package_dir/'scripts/protected.mjs'),'scope':'actual native OpenClaw and live ChatGPT subscription; operator-only selected transport/journal fault'})
for case in a.cases:
 out=a.output/case;out.mkdir();private=a.operator_state/('openclaw-cutpoint-'+case+'-'+uuid.uuid4().hex);private.mkdir(mode=0o700)
 conf=private/'gateway.json';request=private/'prepare.json';runtime=private/'runtime'
 save(request,{'endpoint':f"http://127.0.0.1:{op['port']}",'bearerToken':op['agentToken'],'adminToken':op['adminToken'],'credentialTtlSeconds':900,'trustedSigners':[(a.operator_state/'sessions.sqlite.admission.kernel.pub').read_text().strip()],'serverId':'fs','sessionId':str(uuid.uuid4()),'journalDir':str(private/'journal'),'allowedTools':['read_text_file','write_file','edit_file','list_directory']});request.chmod(0o600)
 subprocess.run(['node',str(a.package_dir/'node_modules/@chio/bridge/dist/prepare-gateway.js'),str(request),str(conf)],capture_output=True,check=True,timeout=40)
 config=json.loads(conf.read_text());original_hash=sha(conf);name='openclaw-cutpoint-'+uuid.uuid4().hex+'.txt';content='one original observed cutpoint effect'
 prompt=f'Use chio_call with write_file exactly once to write /workspace/{name} with content "{content}". Stop after the actual result. Never retry an uncertain or failed result.'
 env=os.environ.copy();env['NODE_OPTIONS']='--import='+str(fault);env['CHIO_SUBSCRIPTION_FAULT']='hold-before-dispatch' if case=='cancel-before-dispatch' else case
 env['CHIO_SUBSCRIPTION_FAULT_LOG']=str(out/'fault.jsonl');env['CHIO_SUBSCRIPTION_KERNEL_ENDPOINT']=f"http://127.0.0.1:{op['port']}/mcp";env['CHIO_SUBSCRIPTION_JOURNAL']=str((private/'journal').resolve())
 refused=None
 if case=='kernel-network-refused':
  refused=socket.socket();refused.bind(('127.0.0.1',0));env['CHIO_SUBSCRIPTION_REFUSED_ENDPOINT']=f'http://127.0.0.1:{refused.getsockname()[1]}/mcp'
  prompt=f'Use chio_call with write_file to write /workspace/{name} with content "{content}". After its successful result, use write_file once to replace the same file with "must never replace the original". Complete both sequential operations before your final reply. Stop on any uncertain or failed result. Never retry.'
  with socket.create_connection(('127.0.0.1',op['port']),timeout=3):pass
  save(out/'kernel-live-before.json',{'pid':int((a.operator_state/'kernel.pid').read_text()),'connectionSucceeded':True})
 before=observe();save(out/'before.json',before);cmd=command(conf,runtime,prompt)
 with (out/'stdout.txt').open('w') as stdout,(out/'stderr.txt').open('w') as stderr:
  child=subprocess.Popen(cmd,stdout=stdout,stderr=stderr,env=env)
  if case=='cancel-before-dispatch':
   deadline=time.monotonic()+150
   while not (out/'fault.jsonl').exists() and child.poll() is None and time.monotonic()<deadline:time.sleep(.1)
   if not (out/'fault.jsonl').exists():child.terminate();child.wait(timeout=40);raise RuntimeError('native cutpoint never reached; preserve evidence')
   at=observe();save(out/'at-cancellation.json',at);assert at==before
   child.send_signal(signal.SIGTERM);save(out/'signal.json',{'launcherPid':child.pid,'signal':'SIGTERM','beforeDispatchObserved':True})
  code=child.wait(timeout=220)
 save(out/'command.json',{'command':cmd,'exitCode':code});calls,terminal=export_run(runtime,out/'initial');after=observe();save(out/'after.json',after)
 records=[json.loads(path.read_text()) for path in (private/'journal').glob('*.json')]
 save(out/'journal-summary.json',[{'requestId':r['requestId'],'state':r['state'],'acknowledged':r.get('acknowledged'),'hostDeliveryConfirmed':r.get('hostDeliveryConfirmed')} for r in records]);owner=owner_records(config);save(out/'owner-summary.json',owner)
 delta=len(after['dispatch'])-len(before['dispatch']);expected=1 if case in ['kernel-network-refused','journal-after-effect'] else 0
 passed=code!=0 and delta==expected and sha(conf)==original_hash and (out/'fault.jsonl').exists() and len(calls)==(2 if case=='kernel-network-refused' else 1)
 passed &= after['files'].get(name)==hashlib.sha256(content.encode()).hexdigest() if expected else name not in after['files']
 passed &= terminal.get('confirmedDeliveries')==(1 if case=='kernel-network-refused' else 0)
 if case=='journal-before-dispatch':passed &= not records and not owner and before==after
 if case=='journal-after-effect':passed &= len(owner)==1 and owner[0]['state']=='completed_unacknowledged' and all(not r.get('acknowledged') for r in records)
 if case=='cancel-before-dispatch':passed &= not owner and before==after
 if case=='kernel-network-refused':
  with socket.create_connection(('127.0.0.1',op['port']),timeout=3):pass
  live={'pid':int((a.operator_state/'kernel.pid').read_text()),'connectionSucceeded':True};save(out/'kernel-live-after.json',live);passed &= live==json.loads((out/'kernel-live-before.json').read_text());refused.close()
 result={'case':case,'passed':bool(passed),'exitCode':code,'nativeCalls':len(calls),'newDispatchRows':delta,'terminal':terminal,'privateState':str(private),'sameAuthorityConfig':True}
 save(out/'initial-result.json',result)
 if not passed:raise RuntimeError('initial case failed; preserve evidence without retry')
 if case!='journal-before-dispatch':
  resumed_runtime=private/'restart';cmd2=command(conf,resumed_runtime,f'Use chio_call with write_file once to replace /workspace/{name} with "must never replace the original". Stop on refusal. Never retry.')
  resumed=subprocess.run(cmd2,capture_output=True,text=True,timeout=220);(out/'restart.stdout.txt').write_text(resumed.stdout);(out/'restart.stderr.txt').write_text(resumed.stderr);save(out/'restart-command.json',{'command':cmd2,'exitCode':resumed.returncode})
  restart_calls,restart_terminal=export_run(resumed_runtime,out/'restart');final=observe();save(out/'after-restart.json',final)
  result['restartFenced']=resumed.returncode!=0 and len(restart_calls)==1 and final==after and sha(conf)==original_hash
  assert result['restartFenced'],'same-authority native restart must preserve uncertainty and effects'
 results.append(result);save(a.output/'results.json',results);print(json.dumps(result),flush=True)
