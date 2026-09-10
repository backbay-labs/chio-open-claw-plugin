import test from "node:test";
import assert from "node:assert/strict";
import {validateModelRequest,validateCodexRequest,chatGptCredential,startModelRelay} from "../src/model-relay.mjs";
const request=()=>({model:"gpt-4.1-mini",messages:[{role:"user",content:"Read an approved file"}],tools:[{type:"function",function:{name:"chio_call",parameters:{type:"object"}}}]});
test("model transport permits only inline Chio tool history",()=>{
 validateModelRequest(request(),"gpt-4.1-mini");
 for(const change of [{model:"alternate"},{tools:[{type:"web_search"}]},{tools:[{type:"function",function:{name:"exec",parameters:{}}}]},{background:true},{messages:[{role:"user",content:[{type:"image_url",image_url:{url:"https://example.invalid"}}]}]},{previous_response_id:"outside-context"},{store:true}]) assert.throws(()=>validateModelRequest({...request(),...change},"gpt-4.1-mini"));
});
test("model output budget cannot grow beyond the supported mode",()=>{
 for(const max_tokens of [-1,0,4097,Infinity,"4096"])assert.throws(()=>validateModelRequest({...request(),max_tokens},"gpt-4.1-mini"));
});

const codexRequest=()=>({model:"gpt-5.5",store:false,stream:true,instructions:"Only controlled file tools",input:[{role:"user",content:[{type:"input_text",text:"Read the approved file"}]}],tools:[{type:"function",name:"chio_call",parameters:{type:"object"},strict:null}],include:["reasoning.encrypted_content"],text:{verbosity:"low"},tool_choice:"auto",parallel_tool_calls:true});
test("native subscription cache reader never retains refresh or identity tokens",()=>{
 const cache={auth_mode:"chatgpt",tokens:{access_token:"parent-access-secret",account_id:"private-account",refresh_token:"refresh-never-used",id_token:"identity-never-used"}};
 assert.deepEqual(chatGptCredential(cache),{kind:"chatgpt",secret:"parent-access-secret",accountId:"private-account"});
 for(const mutation of [{auth_mode:"api_key"},{OPENAI_API_KEY:"wrong-mode"},{tokens:{access_token:"abc\r\ninjected",account_id:"private-account"}},{tokens:{access_token:"abc"}}])assert.throws(()=>chatGptCredential({...cache,...mutation}),/Native ChatGPT cache/);
});
test("native Codex Responses admits complete inline Chio history only",()=>{
 const body=codexRequest();body.input.push({type:"function_call",id:"fc_old",call_id:"call_a",name:"chio_call",arguments:"{}",status:"completed"},{type:"function_call_output",call_id:"call_a",output:'{"state":"completed"}'},{type:"reasoning",id:"rs_old",summary:[{type:"summary_text",text:"Check the result"}],encrypted_content:"inline-encrypted-body"});
 validateCodexRequest(body,"gpt-5.5");assert.equal(body.input[1].id,undefined);assert.equal(body.input[3].id,undefined);
 for(const mutation of [{model:"other"},{previous_response_id:"outside-context"},{background:true},{store:true},{stream:false},{tools:[{type:"web_search"}]},{tools:[{type:"function",name:"exec",parameters:{}}]},{input:[{type:"item_reference",id:"secret-item"}]},{input:[{role:"user",content:[{type:"input_image",image_url:"https://outside.invalid"}]}]},{input:[{type:"function_call",call_id:"x",name:"exec",arguments:"{}"}]},{input:[{type:"function_call_output",call_id:"x",output:[{type:"input_file",file_id:"outside-file"}]}]},{reasoning:{effort:"xhigh"}},{text:{format:{type:"json_schema"}}}])assert.throws(()=>validateCodexRequest({...codexRequest(),...mutation},"gpt-5.5"));
});
test("subscription relay substitutes credentials only at fixed parent route after delivery confirmation",async()=>{
 const originalFetch=globalThis.fetch,forwards=[],confirmed=[];
 globalThis.fetch=async(url,options)=>{
  if(String(url)==="https://chatgpt.com/backend-api/codex/responses"){
   assert.equal(confirmed.length,1,"delivery confirmation must precede inference");
   forwards.push({url,options});return new Response("data: [DONE]\n\n",{headers:{"content-type":"application/json"}});
  }
  return originalFetch(url,options);
 };
 let relay;
 try{
  relay=await startModelRelay({kind:"chatgpt",secret:"parent-access-secret",accountId:"private-account"},"gpt-5.5",async results=>{confirmed.push(results);});
  const payload=JSON.parse(Buffer.from(relay.token.split(".")[1],"base64").toString());
  assert.equal(payload["https://api.openai.com/auth"].chatgpt_account_id,"chio-local-relay");
  assert.ok(!relay.token.includes("parent-access-secret"));
  const body=codexRequest();body.input.push({type:"function_call_output",call_id:"call_a",output:'{"state":"completed"}'});
  const headers={authorization:`Bearer ${relay.token}`,"content-type":"application/json","chatgpt-account-id":"guest-cannot-select-account"};
  const refused=await originalFetch(`http://127.0.0.1:${relay.port}/v1/chat/completions`,{method:"POST",headers,body:JSON.stringify(body)});
  assert.equal(refused.status,403);assert.equal(forwards.length,0);
  const response=await originalFetch(`http://127.0.0.1:${relay.port}/v1/codex/responses`,{method:"POST",headers,body:JSON.stringify(body)});
  assert.equal(response.status,200);assert.equal(response.headers.get("content-type"),"text/event-stream");await response.text();
  assert.equal(forwards.length,1);assert.equal(forwards[0].options.headers.Authorization,"Bearer parent-access-secret");
  assert.equal(forwards[0].options.headers["ChatGPT-Account-Id"],"private-account");
  assert.equal(forwards[0].options.redirect,"error");assert.equal(JSON.parse(forwards[0].options.body).parallel_tool_calls,false);
  assert.deepEqual(confirmed[0],[{toolCallId:"call_a",content:'{"state":"completed"}'}]);
  assert.ok(!JSON.stringify(relay.events).includes("parent-access-secret"));assert.ok(!JSON.stringify(relay.events).includes("private-account"));
 }finally{await relay?.close();globalThis.fetch=originalFetch;}
});
test("subscription relay never forwards rejected acknowledgement or exposes provider failures",async()=>{
 const originalFetch=globalThis.fetch;let forwards=0,relay;
 globalThis.fetch=async(url,options)=>{
  if(String(url)==="https://chatgpt.com/backend-api/codex/responses"){
   forwards++;return new Response("parent-access-secret private-account provider detail",{status:401});
  }
  return originalFetch(url,options);
 };
 try{
  relay=await startModelRelay({kind:"chatgpt",secret:"parent-access-secret",accountId:"private-account"},"gpt-5.5",async results=>{if(results.length)throw new Error("sensitive callback error parent-access-secret");});
  const send=body=>originalFetch(`http://127.0.0.1:${relay.port}/v1/codex/responses`,{method:"POST",headers:{authorization:`Bearer ${relay.token}`,"content-type":"application/json"},body:JSON.stringify(body)});
  const body=codexRequest();body.input.push({type:"function_call_output",call_id:"a",output:"{}"});
  const failed=await send(body);assert.equal(failed.status,403);assert.equal(forwards,0);assert.ok(!(await failed.text()).includes("parent-access-secret"));
  const provider=await send(codexRequest());assert.equal(provider.status,401);assert.equal(forwards,1);
  const errorBody=await provider.text();assert.ok(!errorBody.includes("parent-access-secret"));assert.ok(!errorBody.includes("private-account"));
  assert.ok(!JSON.stringify(relay.events).includes("parent-access-secret"));assert.equal(relay.events[0].reason,"Model delivery failed");
 }finally{await relay?.close();globalThis.fetch=originalFetch;}
});
