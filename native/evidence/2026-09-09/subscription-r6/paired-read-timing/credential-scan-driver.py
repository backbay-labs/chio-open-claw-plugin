import json,pathlib,subprocess,base64
root=pathlib.Path('/Users/connor/Medica/backbay/standalone/chio-open-claw-plugin/.worktrees/required-agent-integrations-20260909/native');evidence=root/'evidence/2026-09-09/subscription-r6/paired-read-timing';cache=pathlib.Path('/Users/connor/.local/share/chio-required-operators/native-subscription-auth-20260909/codex/profile/auth.json');tokens=json.loads(cache.read_text())['tokens'];secrets={str(tokens[k]).encode() for k in ['access_token','refresh_token','id_token','account_id'] if tokens.get(k)}
for name in ['openclaw-subscription-probes-20260909']:
 owner=pathlib.Path('/Users/connor/.local/share/chio-required-operators')/name;op=json.loads((owner/'operator.json').read_text());secrets.update(str(op[k]).encode() for k in ['agentToken','adminToken'] if op.get(k))
 for config in owner.rglob('gateway.json'):
  try:value=json.loads(config.read_text()).get('execution',{}).get('bearerToken')
  except (ValueError,KeyError):continue
  if value:secrets.add(value.encode())
leaks=[];files=0
for path in evidence.rglob('*'):
 if path.is_file():
  body=path.read_bytes();files+=1
  if any(secret in body for secret in secrets):leaks.append(str(path.relative_to(root)))
volumes=set()
for path in evidence.rglob('launch.json'):
 obj=json.loads(path.read_text())
 for key in ['volume','controlVolume']:
  if isinstance(obj.get(key),str):volumes.add(obj[key])
existing=set(subprocess.check_output(['docker','volume','ls','--format','{{.Name}}'],text=True).splitlines());retained=sorted(volumes&existing);removed=sorted(volumes-existing);guestfiles=0
for start in range(0,len(retained),20):
 batch=retained[start:start+20];cmd=['docker','run','--rm','--network','none','--read-only']
 for i,volume in enumerate(batch):cmd+=['--mount',f'type=volume,src={volume},dst=/scan/v{i},readonly']
 code="const f=require('fs');function walk(p){for(const n of f.readdirSync(p)){const q=p+'/'+n,s=f.lstatSync(q);if(s.isDirectory())walk(q);else if(s.isFile())console.log(JSON.stringify({path:q,data:f.readFileSync(q).toString('base64')}))}}walk('/scan')"
 cmd+=['--entrypoint','node','sha256:7f925d68ced724f4a6314ab76dc117e9000515ba62149ee971a11c510be6637f','-e',code]
 raw=subprocess.check_output(cmd,text=True)
 for line in raw.splitlines():
  rec=json.loads(line);body=base64.b64decode(rec['data']);guestfiles+=1
  if any(secret in body for secret in secrets):leaks.append('guest '+rec['path'])
result={'passed':not leaks,'evidenceFilesScanned':files,'retainedGuestVolumesScanned':len(retained),'guestFilesScanned':guestfiles,'lifecycleRemovedVolumes':removed,'secretValuesCompared':len(secrets),'leakPaths':leaks,'claim':'exact values from private native model cache, designated operator/bootstrap/admin and delegated kernel credentials absent from exported evidence and retained guest volumes; ephemeral relay tokens intentionally excluded'}
(evidence/'credential-scan.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));assert not leaks
