import os
os.environ['FLWR_TELEMETRY_ENABLED']='0'
import hashlib
import hmac
import json
import socket
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
import numpy as np
import flwr as fl
from flwr.common import ndarrays_to_parameters,parameters_to_ndarrays
from data import FEATURES,ensure
from model import train,evaluate,baselines
import notebook_fedavg as notebook

def post(config,path,payload,secret):
    req=urllib.request.Request(config['api']+path,data=json.dumps(payload,allow_nan=False).encode(),headers={'Authorization':'Bearer '+secret,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=30) as r:return json.load(r)
def arrays(p):return [np.array(p['weight'],np.float32).reshape(1,4),np.array(p['bias'],np.float32)]
def params(a):return {'weight':a[0].flatten().astype(float).tolist(),'bias':a[1].flatten().astype(float).tolist()}

class HospitalClient(fl.client.NumPyClient):
    def __init__(self,c):self.c=c
    def get_parameters(self,config):return arrays(self.c['parameters'])
    def fit(self,parameters,config):
        c=self.c
        request={'sessionId':c['sessionId'],'hospitalId':c['hospitalId'],'resource':'federated-model:hospital-readmission','purpose':'hospital-readmission-research','features':FEATURES,'scopeVersion':c['scopeVersion']}
        try:
            for operation in ['download_model','train_local']:post(c,'/worker/authorize',{**request,'operation':operation},c['token'])
        except Exception:
            return parameters,0,{'hospitalId':c['hospitalId'],'denied':True}
        p,n=(notebook.train(c['hospitalDir'],params(parameters)) if c.get('experiment')=='notebook-fedavg'
             else train(c['hospitalDir'],c['hospitalId'],params(parameters),c['round']))
        envelope={**request,'operation':'submit_update','parameters':p,'numExamples':n,'round':c['round'],'modelVersion':c['round']-1,'baseHash':c['baseHash']}
        payload=json.dumps(envelope,sort_keys=True,separators=(',',':'),allow_nan=False)
        signature=hmac.new(c['token'].encode(),payload.encode(),hashlib.sha256).hexdigest()
        return arrays(p),n,{'hospitalId':c['hospitalId'],'payload':payload,'signature':signature}
    def evaluate(self,parameters,config):raise RuntimeError('Coordinator evaluates untouched tests; fit clients do not send records')

class GovernedFedAvg(fl.server.strategy.FedAvg):
    def __init__(self,c):
        self.c=c
        participants=len(c['workers'])
        super().__init__(fraction_fit=1,min_fit_clients=participants,min_available_clients=participants,fraction_evaluate=0,min_evaluate_clients=0,initial_parameters=ndarrays_to_parameters(arrays(c['parameters'])),accept_failures=True)
    def aggregate_fit(self,server_round,results,failures):
        c=self.c;updates=[]
        for _,r in results:
            if r.num_examples<=0 or 'payload' not in r.metrics:continue
            payload=json.loads(r.metrics['payload'])
            expected=arrays(payload['parameters']);actual=parameters_to_ndarrays(r.parameters)
            if len(actual)!=2 or any(a.shape!=b.shape or not np.array_equal(a,b) for a,b in zip(actual,expected)):raise ValueError('Signed update and Flower reply differ')
            if payload['hospitalId']!=r.metrics['hospitalId'] or payload['numExamples']!=r.num_examples:raise ValueError('Signed sample/identity mismatch')
            updates.append({'hospitalId':r.metrics['hospitalId'],'payload':r.metrics['payload'],'signature':r.metrics['signature']})
        deadline=time.monotonic()+150
        while True:
            decision=post(c,'/internal/finalize',{'sessionId':c['sessionId'],'round':c['round'],'updates':updates},c['coordinator'])
            if not decision.get('waiting'):break
            if time.monotonic()>deadline:raise TimeoutError('Queued round expired before acceptance')
            time.sleep(.2)
        allowed=set(decision['accepted']);filtered=[(proxy,r) for proxy,r in results if r.metrics.get('hospitalId') in allowed]
        if not filtered:raise RuntimeError('No authorized updates')
        # Flower's strategy performs sample-weighted aggregation of the actual network client replies.
        aggregate,metrics=super().aggregate_fit(server_round,filtered,failures)
        if aggregate is None:raise RuntimeError('Flower did not aggregate')
        self.result=params(parameters_to_ndarrays(aggregate));return aggregate,metrics

def run_coordinator(c):
    (notebook.ensure(c['dataDir']) if c.get('experiment')=='notebook-fedavg' else ensure(c['dataDir']))
    strategy=GovernedFedAvg(c)
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    address='127.0.0.1:'+str(port);children=[]
    try:
        for w in c['workers']:
            # Each client receives one hospital folder and its own bound worker credential.
            child=subprocess.Popen([sys.executable,'-u',__file__,'client'],stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True)
            child.stdin.write(json.dumps({**{k:c[k] for k in ['api','sessionId','round','parameters','baseHash','experiment']},**w,'hospitalDir':str(Path(c['dataDir'])/w['hospitalId']),'address':address}));child.stdin.close();children.append(child)
        fl.server.start_server(server_address=address,config=fl.server.ServerConfig(num_rounds=1,round_timeout=160),strategy=strategy,grpc_max_message_length=256*1024)
        if not hasattr(strategy,'result'):raise RuntimeError('No Flower result')
        is_notebook=c.get('experiment')=='notebook-fedavg'
        local=[] if is_notebook else (c['baselines'] or baselines(c['dataDir'],c['plannedRounds']))
        evaluation=notebook.evaluate(c['dataDir'],strategy.result) if is_notebook else evaluate(c['dataDir'],strategy.result)
        post(c,'/internal/complete',{'sessionId':c['sessionId'],'round':c['round'],'parameters':strategy.result,'evaluation':evaluation,'baselines':local},c['coordinator'])
    finally:
        for child in children:
            if child.poll() is None:child.terminate()
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:child.kill();child.wait()

if __name__=='__main__':
    signal.signal(signal.SIGTERM,lambda *_:sys.exit(143))
    c=json.load(sys.stdin)
    if len(sys.argv)>1:
        fl.client.start_client(server_address=c['address'],client=HospitalClient(c).to_client(),insecure=True,grpc_max_message_length=256*1024,max_retries=15,max_wait_time=30)
    else:run_coordinator(c)
