import { resolve } from 'node:path';
export function loadConfig(env=process.env){
 const origin=env.APP_ORIGIN??'http://localhost:3000';const url=new URL(origin);
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('HTTPS required outside localhost');
 if(env.NODE_ENV==='production'&&url.protocol!=='https:')throw new Error('HTTPS required in production');
 const localDemo=env.LOCAL_LIVE_DEMO==='true';
 if(localDemo&&env.NODE_ENV==='production')throw new Error('LOCAL_LIVE_DEMO cannot be enabled in production');
 if(localDemo&&!['127.0.0.1','::1'].includes(env.HOST??'127.0.0.1'))throw new Error('LOCAL_LIVE_DEMO requires loopback HOST');
 if(localDemo&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('LOCAL_LIVE_DEMO requires localhost APP_ORIGIN');
 return {origin,port:Number(env.PORT??3000),host:env.HOST??'127.0.0.1',dbFile:resolve(env.DB_FILE??'data/veylance.db'),artifacts:resolve(env.ARTIFACTS_DIR??'artifacts'),datasets:resolve(env.DATASET_DIR??'datasets'),python:env.PYTHON_BIN??'python',issuer:env.NAMOID_ISSUER??'',clientId:env.NAMOID_CLIENT_ID??'',clientSecret:env.NAMOID_CLIENT_SECRET??'',authMethod:env.NAMOID_TOKEN_AUTH_METHOD??'',localDemo,production:env.NODE_ENV==='production'};
}
