// Disposable qualification only. Kill the protected parent after Docker creates
// its relay, before the native agent exists. Record exact owned names for cleanup.
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {writeFileSync} from 'node:fs';
const original=childProcess.spawnSync;
childProcess.spawnSync=function(command,args,options){
 const result=original.call(this,command,args,options);
 if(command==='docker'&&result.status===0&&args[0]==='run'&&args.includes('-d')){
  const name=args[args.indexOf('--name')+1];
  if(/^chio-openclaw-relay-[a-f0-9-]{36}$/.test(name)){
   const id=name.slice('chio-openclaw-relay-'.length);
   writeFileSync(process.env.CHIO_EARLY_CRASH_LOG,JSON.stringify({cutpoint:'relay-created-before-native-host',launcherPid:process.pid,signal:'SIGKILL',id,relayName:name,agentName:`chio-openclaw-agent-${id}`,network:`chio-required-openclaw-${id}`,volume:`chio-required-openclaw-state-${id}`,controlVolume:`chio-required-openclaw-control-${id}`})+'\n',{flag:'wx',mode:0o600,flush:true});
   process.kill(process.pid,'SIGKILL');
  }
 }
 return result;
};
syncBuiltinESMExports();
