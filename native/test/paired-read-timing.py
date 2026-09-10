#!/usr/bin/env python3
"""Three healthy paired reads, with measured transport/dispatch intervals only.

Direct control is an operator-only read-only resource mount. Native calls use
the unchanged installed host/plugin, same file and arguments, original prepared
authority throughout, and normal verified delivery acknowledgements.
"""
import argparse,hashlib,json,os,pathlib,queue,shutil,statistics,subprocess,threading,time,uuid
p=argparse.ArgumentParser(description=__doc__)
for name in ['operator-state','package-dir','model-auth-file','output','archive']:p.add_argument('--'+name,type=pathlib.Path,required=True)
p.add_argument('--kernel-sha256',required=True);p.add_argument('--image',required=True);p.add_argument('--path',required=True);a=p.parse_args();a.output=a.output.resolve();a.output.mkdir(mode=0o700)
op=json.loads((a.operator_state/'operator.json').read_text());instrument=pathlib.Path(__file__).with_name('kernel-read-timing.mjs').resolve();pairs=[]
def save(path,value):path.write_text(json.dumps(value,indent=2)+'\n')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def observe():
 code="const f=require('fs'),c=require('crypto');const files={};for(const n of f.readdirSync('/observe'))if(f.lstatSync('/observe/'+n).isFile())files[n]=c.createHash('sha256').update(f.readFileSync('/observe/'+n)).digest('hex');console.log(JSON.stringify({files,dispatch:f.readFileSync('/audit/dispatch.jsonl','utf8').trim().split('\\n').filter(Boolean).map(JSON.parse)}))"
 return json.loads(subprocess.check_output(['docker','run','--rm','--network','none','--read-only','--mount',f"type=volume,src={op['volume']},dst=/observe,readonly",'--mount',f"type=volume,src={op['auditVolume']},dst=/audit,readonly",'--entrypoint','node',op['image'],'-e',code],text=True))
assert sha(a.archive)=='a79dbffa8356a608f22db847e100d1989cb7ff322ab1315144774decb2b13ab4';assert op['kernelSha256']==a.kernel_sha256
before=observe();save(a.output/'before.json',before);name=pathlib.Path(a.path).name;assert a.path=='/workspace/'+name and name in before['files'],'pre-existing independently observed allowed target required'
private=a.operator_state/('paired-timing-'+uuid.uuid4().hex);private.mkdir(mode=0o700);conf=private/'gateway.json';request=private/'prepare.json'
save(request,{'endpoint':f"http://127.0.0.1:{op['port']}",'bearerToken':op['agentToken'],'adminToken':op['adminToken'],'credentialTtlSeconds':900,'trustedSigners':[(a.operator_state/'sessions.sqlite.admission.kernel.pub').read_text().strip()],'serverId':'fs','sessionId':str(uuid.uuid4()),'journalDir':str(private/'journal'),'allowedTools':['read_text_file','write_file','edit_file','list_directory']});request.chmod(0o600)
subprocess.run(['node',str(a.package_dir/'node_modules/@chio/bridge/dist/prepare-gateway.js'),str(request),str(conf)],capture_output=True,check=True,timeout=50);conf_hash=sha(conf)
save(a.output/'identity.json',{'archiveSha256':sha(a.archive),'hostImage':a.image,'kernelSha256':op['kernelSha256'],'resourceImage':op['image'],'resourceVolume':op['volume'],'auditVolume':op['auditVolume'],'policySha256':op['policySha256'],'target':a.path,'targetSha256':before['files'][name],'privateConfiguration':str(conf),'configurationSha256':conf_hash,'driverSha256':sha(pathlib.Path(__file__)),'instrumentSha256':sha(instrument),'instrumentScope':'trusted parent only; unchanged installed host and guest','pairs':3})
direct_command=['docker','run','--rm','-i','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--mount',f"type=volume,src={op['volume']},dst=/workspace,readonly",'--tmpfs','/audit:rw,noexec,nosuid,size=16m,uid=1000,gid=1000','--tmpfs','/tmp:rw,noexec,nosuid,size=16m',op['image']];save(a.output/'direct-resource-command.json',direct_command)
responses=queue.Queue();frames=[]
with (a.output/'direct-resource.stderr.txt').open('w') as stderr:
 direct=subprocess.Popen(direct_command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=stderr,text=True)
 def read_responses():
  for line in direct.stdout:
   parsed=json.loads(line);ended=time.perf_counter_ns();frames.append(parsed);responses.put((parsed,ended))
 thread=threading.Thread(target=read_responses,daemon=True);thread.start()
 def rpc(identifier,method,params):
  frame={'jsonrpc':'2.0','id':identifier,'method':method,'params':params};wire=json.dumps(frame)+'\n';started=time.perf_counter_ns();direct.stdin.write(wire);direct.stdin.flush();response,ended=responses.get(timeout=30);assert response.get('id')==identifier and 'result' in response and not response.get('error');return {'request':frame,'response':response,'startedMonotonicNs':str(started),'parsedMonotonicNs':str(ended),'elapsedMs':(ended-started)/1e6}
 try:
  initialize=rpc(1,'initialize',{'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'operator-readonly-paired-control','version':'1'}});save(a.output/'direct-initialize-excluded.json',initialize)
  direct.stdin.write(json.dumps({'jsonrpc':'2.0','method':'notifications/initialized'})+'\n');direct.stdin.flush()
  for i in range(1,4):
   folder=a.output/('pair-'+str(i));folder.mkdir();baseline=None
   if i==2:baseline=rpc(i+1,'tools/call',{'name':'read_text_file','arguments':{'path':a.path}})
   runtime=private/('native-'+str(i));env=os.environ.copy();env['NODE_OPTIONS']='--import='+str(instrument);env['CHIO_TIMING_KERNEL_ENDPOINT']=f"http://127.0.0.1:{op['port']}/mcp";env['CHIO_TIMING_LOG']=str(folder/'kernel-timing.jsonl')
   prompt=f'Use chio_call with tool read_text_file exactly once for {a.path}. Preserve the exact arguments. Report its actual contents, then stop. Do not retry or use another tool.'
   cmd=['node',str(a.package_dir/'scripts/protected.mjs'),'--gateway-config',str(conf),'--state-dir',str(runtime),'--image',a.image,'--model-auth-file',str(a.model_auth_file),'--prompt',prompt]
   run=subprocess.run(cmd,capture_output=True,text=True,env=env,timeout=220);(folder/'stdout.txt').write_text(run.stdout);(folder/'stderr.txt').write_text(run.stderr);save(folder/'command.json',{'command':cmd,'exitCode':run.returncode})
   for filename in ['launch.json','terminal.json','host.stdout.json','host.stderr.txt','model-relay.json','watchdog-cleanup.json']:
    if (runtime/filename).is_file():shutil.copy2(runtime/filename,folder/filename)
   launch=json.loads((runtime/'launch.json').read_text());terminal=json.loads((runtime/'terminal.json').read_text());assert run.returncode==0 and terminal['confirmedDeliveries']==i
   code="const f=require('fs');process.stdout.write(f.readFileSync('/state/openclaw/agents/main/sessions/"+launch['sessionId']+".jsonl','utf8'))";raw=subprocess.check_output(['docker','run','--rm','--network','none','--read-only','--mount',f"type=volume,src={launch['volume']},dst=/state,readonly",'--entrypoint','node',a.image,'-e',code],text=True);history=[json.loads(line) for line in raw.splitlines()];save(folder/'native-history.json',history)
   calls=[block for event in history for message in [event.get('message',{})] if message.get('role')=='assistant' for block in message.get('content',[]) if block.get('type')=='toolCall'];assert len(calls)==1 and calls[0]['name']=='chio_call' and calls[0]['arguments']=={'tool':'read_text_file','arguments':{'path':a.path}}
   timing=[json.loads(line) for line in (folder/'kernel-timing.jsonl').read_text().splitlines()];assert len(timing)==2 and all(row['tool']=='read_text_file' and row['arguments']=={'path':a.path} for row in timing)
   kernel=next(row for row in timing if row['stage']=='kernel-fetch-to-SDK-terminal-consumption');gateway=next(row for row in timing if row['stage']=='native-gateway-request-to-response-end');assert kernel['status']==200
   records=[json.loads(path.read_text()) for path in (private/'journal').glob('*.json')];assert len(records)==i and all(r['state']=='completed' and r.get('acknowledged') and r.get('hostDeliveryConfirmed') for r in records);save(folder/'journal.json',records)
   if baseline is None:baseline=rpc(i+1,'tools/call',{'name':'read_text_file','arguments':{'path':a.path}})
   save(folder/'direct.json',baseline);assert baseline['response']['result'].get('isError') is not True
   kernel_result=next(record['outcome']['result'] for record in records if record['requestId']==kernel['requestId']);assert kernel_result.get('isError') is not True and kernel_result['content']==baseline['response']['result']['content']
   assert sha(conf)==conf_hash
   pair={'pair':i,'order':'direct then native' if i==2 else 'native then direct','tool':'read_text_file','arguments':{'path':a.path},'nativeCallId':calls[0]['id'],'kernelRequestId':kernel['requestId'],'directMs':baseline['elapsedMs'],'kernelMs':kernel['elapsedMs'],'gatewayMs':gateway['elapsedMs'],'kernelMinusDirectMs':kernel['elapsedMs']-baseline['elapsedMs'],'gatewayMinusDirectMs':gateway['elapsedMs']-baseline['elapsedMs'],'sameContent':True,'nativeVerifiedAndAcknowledged':True};pairs.append(pair);save(a.output/'pairs.json',pairs);print(json.dumps(pair),flush=True)
 finally:
  direct.stdin.close();direct.wait(timeout=30);thread.join(timeout=3);save(a.output/'direct-resource-frames.json',frames)
after=observe();save(a.output/'after.json',after);delta=after['dispatch'][len(before['dispatch']):];assert after['files']==before['files'] and len(delta)==3 and all(row['tool']=='read_text_file' and row['path']==a.path for row in delta)
summary={'passed':True,'pairs':pairs,'medianDirectMs':statistics.median(p['directMs'] for p in pairs),'medianKernelMs':statistics.median(p['kernelMs'] for p in pairs),'medianGatewayMs':statistics.median(p['gatewayMs'] for p in pairs),'medianKernelMinusDirectMs':statistics.median(p['kernelMinusDirectMs'] for p in pairs),'medianGatewayMinusDirectMs':statistics.median(p['gatewayMinusDirectMs'] for p in pairs),'newAuditedNativeReads':3,'directControlReads':3,'resourceFilesUnchanged':True,'sameNativeAuthorityAndArguments':True,'timingScope':'kernel fetch through SDK terminal consumption, and parent HTTP gateway ingestion through response.end; compared with same-image read-only resource MCP stdin dispatch through parsed response','excluded':['container/session startup','model inference','native plugin/host scheduling','delivery acknowledgement'],'limitations':['three observations only, no statistical performance claim','includes differing HTTP versus stdio transport and kernel mediation','direct control is trusted operator access without kernel capability, not an agent bypass','direct control audit uses tmpfs; native resource audit uses existing persistent owner volume','kernel interval excludes post-response verification; gateway interval includes journal, verification and serialization']};save(a.output/'summary.json',summary)
