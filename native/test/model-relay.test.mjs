import test from "node:test";
import assert from "node:assert/strict";
import {validateModelRequest} from "../src/model-relay.mjs";
const request=()=>({model:"gpt-4.1-mini",messages:[{role:"user",content:"Read an approved file"}],tools:[{type:"function",function:{name:"chio_call",parameters:{type:"object"}}}]});
test("model transport permits only inline Chio tool history",()=>{
 validateModelRequest(request(),"gpt-4.1-mini");
 for(const change of [{model:"alternate"},{tools:[{type:"web_search"}]},{tools:[{type:"function",function:{name:"exec",parameters:{}}}]},{background:true},{messages:[{role:"user",content:[{type:"image_url",image_url:{url:"https://example.invalid"}}]}]},{previous_response_id:"outside-context"},{store:true}]) assert.throws(()=>validateModelRequest({...request(),...change},"gpt-4.1-mini"));
});
test("model output budget cannot grow beyond the supported mode",()=>{
 for(const max_tokens of [-1,0,4097,Infinity,"4096"])assert.throws(()=>validateModelRequest({...request(),max_tokens},"gpt-4.1-mini"));
});
