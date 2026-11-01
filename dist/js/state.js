import { createDemoAdapter } from './adapters/demo.js';
import { createLiveAdapter } from './adapters/live.js';
const mode=globalThis.VEYLANCE_CONFIG?.mode;
export const adapter=mode==='demo'?createDemoAdapter():createLiveAdapter();
export const ui={page:'overview',search:'',filter:'all',hospital:'all',actorId:'reviewer-manager',drawer:null,busy:false,error:null,verification:null};
let state=null;
export const getState=()=>state;
export function clearState(){state=null;ui.actorId='';ui.verification=null;}
export async function initialize(){state=await adapter.load();return state;}
export async function dispatch(action,payload={}){state=await adapter.command(action,{...payload,actorId:ui.actorId});ui.verification=null;return state;}
export async function switchLocalActor(actor){state=await adapter.switchActor(actor);ui.actorId=state.user.sub;return state;}
