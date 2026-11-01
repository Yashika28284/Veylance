import json
from pathlib import Path
import numpy as np
import torch
from sklearn.metrics import accuracy_score,precision_score,recall_score,f1_score,roc_auc_score,log_loss
from data import FEATURES,SETTINGS,load
torch.set_num_threads(1)
# FL.ipynb final FedAvg experiment: ten local epochs at learning rate 0.01.
LOCAL_EPOCHS=10
LR=.01
def train(folder,hospital,parameters,round_no):
    x,y=load(folder,'train');s=json.loads((Path(folder)/'preprocessing.json').read_text());mean=np.array(s['mean'],np.float32);scale=np.array(s['scale'],np.float32)
    torch.manual_seed(SETTINGS[hospital][1]+round_no)
    model=torch.nn.Linear(4,1)
    raw_w=np.asarray(parameters['weight'],np.float32);raw_b=float(parameters['bias'][0])
    with torch.no_grad():model.weight.copy_(torch.from_numpy((raw_w*scale)[None]));model.bias.fill_(raw_b+float(raw_w@mean))
    xx=torch.from_numpy((x-mean)/scale);yy=torch.from_numpy(y);optimizer=torch.optim.SGD(model.parameters(),lr=LR)
    g=torch.Generator().manual_seed(SETTINGS[hospital][1]+1000+round_no)
    for _ in range(LOCAL_EPOCHS):
        order=torch.randperm(len(y),generator=g)
        for ids in order.split(64):
            optimizer.zero_grad();loss=torch.nn.functional.binary_cross_entropy_with_logits(model(xx[ids]).flatten(),yy[ids]);loss.backward();optimizer.step()
    w=model.weight.detach().numpy().flatten()/scale;b=float(model.bias.detach().numpy()[0]-w@mean)
    return {'weight':w.astype(float).tolist(),'bias':[b]},len(y)
def metrics(y,p):
    pred=p>=.5
    return {'accuracy':float(accuracy_score(y,pred)),'precision':float(precision_score(y,pred,zero_division=0)),'recall':float(recall_score(y,pred,zero_division=0)),'f1':float(f1_score(y,pred,zero_division=0)),'roc_auc':float(roc_auc_score(y,p)) if len(np.unique(y))==2 else None,'loss':float(log_loss(y,np.clip(p,1e-7,1-1e-7),labels=[0,1])),'n':len(y)}
def evaluate(root,parameters):
    by=[];ys=[];ps=[]
    for hospital in SETTINGS:
        x,y=load(Path(root)/hospital,'test');z=x.astype(float)@np.array(parameters['weight'])+parameters['bias'][0];p=1/(1+np.exp(-np.clip(z,-500,500)))
        by.append({'hospitalId':hospital,**metrics(y,p)});ys.append(y);ps.append(p)
    pooled=metrics(np.concatenate(ys),np.concatenate(ps));macro={k:float(np.mean([m[k] for m in by if m[k] is not None])) for k in ['accuracy','precision','recall','f1','loss','roc_auc']}
    return {'label':'Measured on synthetic data','positiveClass':'readmitted_lt30d=1','dataset':'Seeded synthetic A/B/C untouched test partitions','protocol':'Fixed 0.5 threshold; fixed final round; pooled metrics from concatenated test labels and predictions; hospital macro metrics separately computed','pooled':pooled,'hospitalMacro':macro,'byHospital':by}
def baselines(root,rounds):
    out=[]
    for hospital in SETTINGS:
        p={'weight':[0.,0.,0.,0.],'bias':[0.]}
        for r in range(1,rounds+1):p,n=train(Path(root)/hospital,hospital,p,r)
        out.append({'hospitalId':hospital,'trainSamples':n,'localEpochs':rounds*LOCAL_EPOCHS,'evaluation':evaluate(root,p)})
    return out
