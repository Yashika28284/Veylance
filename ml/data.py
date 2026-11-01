import csv
import json
from pathlib import Path
import numpy as np

FEATURES=['emergency_admission','prior_inpatient_visits','length_of_stay','medication_count']
TARGET='readmitted_lt30d'
SETTINGS={'A':(900,4101,.24,.7,4.5,11,0),'B':(780,5202,.39,1.25,5.9,14,.35),'C':(1020,6303,.17,.48,3.8,9.4,-.22)}
def generate(root):
    root=Path(root); root.mkdir(parents=True,exist_ok=True); hospitals=[]
    for hospital,(n,seed,emergency,visits,stay,meds,bias) in SETTINGS.items():
        rng=np.random.default_rng(seed)
        x=np.column_stack([rng.binomial(1,emergency,n),np.clip(rng.poisson(visits,n),0,8),np.clip(np.rint(rng.gamma(2.3,stay/2.3,n)),1,18),np.clip(np.rint(rng.normal(meds,4.1,n)),1,30)])
        age=rng.choice(4,n,p={'A':[.18,.30,.31,.21],'B':[.1,.23,.34,.33],'C':[.26,.34,.25,.15]}[hospital])
        z=-2.95+x@np.array([.92,.39,.105,.045])+np.array([-.35,-.1,.22,.48])[age]+bias
        y=rng.binomial(1,1/(1+np.exp(-z))); indices=rng.permutation(n);folder=root/hospital;folder.mkdir(exist_ok=True)
        parts={'train':indices[:int(n*.6)],'validation':indices[int(n*.6):int(n*.8)],'test':indices[int(n*.8):]}
        for split,idx in parts.items():
            with (folder/(split+'.csv')).open('w',newline='') as f:
                writer=csv.writer(f);writer.writerow([*FEATURES,'age_band',TARGET])
                writer.writerows([[*x[i].astype(int),['18-39','40-59','60-74','75+'][age[i]],int(y[i])] for i in idx])
        train=x[parts['train']];mean=train.mean(0);scale=train.std(0);scale[scale==0]=1
        (folder/'preprocessing.json').write_text(json.dumps({'mean':mean.tolist(),'scale':scale.tolist(),'fitted_on':'train only'}))
        hospitals.append({'id':hospital,'seed':seed,'n':n,'train':len(parts['train']),'validation':len(parts['validation']),'test':len(parts['test']),'positive_rate_train':float(y[parts['train']].mean())})
    meta={'synthetic':True,'version':1,'description':'Generated fictional records inspired in structure by hospital readmission datasets; no UCI patient records.','features':FEATURES,'restricted':'age_band','target':TARGET,'partition':'Seeded independent random 60/20/20, no overlap','hospitals':hospitals}
    (root/'metadata.json').write_text(json.dumps(meta,indent=2));return meta
def ensure(root):
    root=Path(root)
    if not (root/'metadata.json').exists():return generate(root)
    return json.loads((root/'metadata.json').read_text())
def load(folder,split):
    with (Path(folder)/(split+'.csv')).open() as f: rows=list(csv.DictReader(f))
    return np.array([[float(r[k]) for k in FEATURES] for r in rows],np.float32),np.array([int(r[TARGET]) for r in rows],np.float32)
if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--out',default='datasets');args=p.parse_args();print(json.dumps(generate(args.out),indent=2))
