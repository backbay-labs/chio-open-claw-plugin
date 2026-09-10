import {createNativePlugin} from "./plugin.mjs"; export default createNativePlugin(async()=>{throw new Error("Injected enforcement executor crash before dispatch");});
