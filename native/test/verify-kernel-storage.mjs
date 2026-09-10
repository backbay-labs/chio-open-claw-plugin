// Read-only state-specific audit of retained native/kernel storage-fault evidence.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createHash,createPublicKey,verify} from "node:crypto";
const [rootArg,sdkArg]=process.argv.slice(2);
if(!rootArg||!sdkArg)throw new Error("Explicit evidence root and pinned installed SDK module required");
const root=resolve(rootArg),sdk=resolve(sdkArg),{canonicalizeJsonString}=await import(pathToFileURL(sdk).href);
const read=path=>JSON.parse(readFileSync(path,"utf8"));
const digest=path=>createHash("sha256").update(readFileSync(path)).digest("hex");
const results=[];
for(const mode of ["after-receipt","before-admission","after-admission"]){
 const folder=join(root,mode),identity=read(join(folder,"identity.json"));
 const binding=read(join(folder,"authority-binding.json"));assert.equal(binding.configurationSha256,identity.configurationSha256);
 const publicKey=readFileSync(join(folder,"trusted-kernel-signer.txt"),"utf8").trim();
 assert.deepEqual(binding.trustedSigners,[publicKey]);assert.equal(binding.sessionId,identity.sessionId);assert.equal(binding.capabilityId,identity.capabilityId);
 const key=createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(publicKey,"hex")]),format:"der",type:"spki"});
 const journal=read(join(folder,"faulted-native/journal.json"));
 const fault=journal.filter(row=>row.state==="unknown");assert.equal(fault.length,1);
 const requestId=fault[0].requestId;
 const snapshots=["positive-completed","while-locked","after-unlock","after-same-action","after-owner-restart","final"];
 let signatures=0,originalFence;
 const states=[];
 for(const label of snapshots){
  const snapshot=read(join(folder,label+".json")),remote=snapshot.databases["sessions.sqlite"],admission=snapshot.databases["sessions.sqlite.admission"];
  for(const table of ["remote_session_credential_calls","remote_session_credential_latches"]){
   for(const row of remote[table]){
    const record=JSON.parse(row.record_json);
    assert.equal(record.schema,"chio.mcp.session-credential-call.v1");
    assert.equal(record.sessionId,identity.sessionId);assert.equal(record.sessionId,row.session_id);assert.equal(record.requestId,row.request_id);
    assert.equal(record.subjectKey,binding.subjectKey);assert.equal(record.serverId,binding.serverId);assert.deepEqual(record.capabilityIds,[binding.capabilityId]);
    assert.ok(verify(null,Buffer.from(canonicalizeJsonString(row.record_json)),key,Buffer.from(row.signature,"hex")),"stored call/latch signature must bind canonical complete record to trusted key");signatures++;
   }
  }
  if(label==="positive-completed")continue;
  const rows=remote.remote_session_credential_calls.filter(row=>row.request_id===requestId),latches=remote.remote_session_credential_latches.filter(row=>row.request_id===requestId);
  assert.equal(rows.length,1);assert.equal(latches.length,1);assert.equal(rows[0].record_json,latches[0].record_json);assert.equal(rows[0].signature,latches[0].signature);
  if(originalFence)assert.deepEqual(rows[0],originalFence,"original signed fence must survive release and restart unchanged");else originalFence=rows[0];
  const record=JSON.parse(rows[0].record_json);assert.equal(record.state,"fenced");
  assert.equal(record.toolName,fault[0].request.tool);
  assert.equal(record.parameterHash,createHash("sha256").update(canonicalizeJsonString(JSON.stringify(fault[0].request.arguments))).digest("hex"));
  const error=mode==="after-receipt"?"receipt persistence failed: sqlite receipt commit append timed out after 5000ms":"durable admission failed: admission operation store is unavailable: database is locked";
  assert.ok(JSON.stringify(record.response).includes(error),"exact kernel storage error must be retained in signed record");
  const operation=admission.admission_operations.filter(row=>row.request_id===requestId),outcomes=admission.tool_outcomes.filter(row=>row.request_id===requestId);
  if(mode==="before-admission"){assert.equal(operation.length,0);assert.equal(outcomes.length,0);}
  else{
   assert.equal(operation.length,1);
   const expected=mode==="after-receipt"?"completed":["after-owner-restart","final"].includes(label)?"outcome_unknown_after_dispatch":"dispatch_committed";
   assert.equal(operation[0].state,expected);assert.equal(outcomes.length,mode==="after-receipt"?1:0);
  }
  states.push({snapshot:label,delegatedCallState:record.state,admissionState:operation[0]?.state??null,durableFaultOutcomeCount:outcomes.length,kernelError:error});
 }
 const native=[];
 for(const [label,expected] of [["positive","completed"],["faulted-native","unknown"],["same-action-after-unlock","not_dispatched"],["new-action-after-restart","not_dispatched"]]){
  const history=read(join(folder,label,"native-history.json"));
  const calls=history.flatMap(event=>event.message?.role==="assistant"?event.message.content.filter(block=>block.type==="toolCall"):[]);
  const returns=history.filter(event=>event.message?.role==="toolResult").map(event=>event.message);
  assert.equal(calls.length,1);assert.equal(returns.length,1);assert.equal(calls[0].id,returns[0].toolCallId);
  const outcome=JSON.parse(returns[0].content.find(block=>block.type==="text").text);assert.equal(outcome.state,expected);
  native.push({label,callId:calls[0].id,outcome:outcome.state});
 }
 assert.equal(new Set(native.map(row=>row.callId)).size,4);
 const lock=read(join(folder,"helper-public/fault-locked.json"));assert.equal(lock.cutpoint,mode);assert.equal(lock.mutation,"none; BEGIN IMMEDIATE held, then ROLLBACK");
 assert.ok(lock.database.endsWith(mode==="after-receipt"?"/receipts.sqlite":"/sessions.sqlite.admission"));
 results.push({case:mode,passed:true,trustedKernelSigner:publicKey,storedSignaturesVerified:signatures,faultRequestId:requestId,states,native,exactOriginalNativeIdReplayClaim:false});
}
const result={passed:true,verifierSha256:digest(new URL(import.meta.url)),sdkEntrySha256:digest(sdk),canonicalizer:"pinned SDK RFC8785 canonicalizeJsonString",storedSignaturesVerified:results.reduce((sum,result)=>sum+result.storedSignaturesVerified,0),cases:results,scope:"read-only native outcomes, real SQLite error/state transitions and signed owner fences; no dispatch or authority issuance"};
writeFileSync(join(root,"state-verification.json"),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({passed:true,cases:results.length,signaturesVerified:result.storedSignaturesVerified}));
