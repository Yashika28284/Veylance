import { loadConfig } from './config.js';
import { createApp } from './app.js';
const config=loadConfig(),context=createApp(config);const server=context.app.listen(config.port,config.host,()=>{context.bind(server);console.log(JSON.stringify({event:'listening',port:config.port,namoidConfigured:!!config.issuer}));});
const shutdown=async()=>{setTimeout(()=>process.exit(1),10000).unref();await context.close();server.close(()=>{context.store.close();process.exit(0);});};process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
