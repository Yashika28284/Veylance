"""Faithful reproduction of the 20-round FedAvg cell in FL.ipynb.

The notebook scales each hospital before its 80/20 split. This intentionally
reproduces that experiment, including its test-set preprocessing leakage.
"""
import csv
import json
import random
from pathlib import Path

import numpy as np
import torch

from data import FEATURES, TARGET
from model import metrics

SETTINGS = {'A': (800, 5, 7, .3), 'B': (600, 7, 10, .8), 'C': (500, 4, 5, -.2)}
TRAIN_SAMPLES = {'A': 640, 'B': 480, 'C': 400}
INITIAL = {'weight': [0.3822692632675171, 0.4150039553642273,
                      -0.11713624000549316, 0.45930564403533936],
           'bias': [-0.10955178737640381]}
LOCAL_EPOCHS = 10
LR = .01


def generate(root):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)
    hospitals = []
    for hospital, (n, los, med, base) in SETTINGS.items():
        x, y = [], []
        for _ in range(n):
            e = random.choice([0, 1])
            p = random.randint(0, 8)
            l = max(1, int(random.gauss(los, 2)))
            m = max(1, int(random.gauss(med, 3)))
            probability = 1 / (1 + np.exp(-(
                .8 * e + .15 * p + .12 * l + .08 * m - 2.5 + base
                + random.gauss(0, .6))))
            x.append([e, p, l, m])
            y.append(1 if random.random() < probability else 0)
        x = np.array(x, dtype=np.float32)
        y = np.array(y, dtype=np.float32)
        minimum, maximum = x.min(0), x.max(0)
        span = maximum - minimum
        span[span == 0] = 1
        x = (x - minimum) / span
        cut = int(len(x) * .8)
        folder = root / hospital
        folder.mkdir(exist_ok=True)
        for split, indices in [('train', range(cut)), ('test', range(cut, n))]:
            with (folder / (split + '.csv')).open('w', newline='') as stream:
                writer = csv.writer(stream)
                writer.writerow([*FEATURES, TARGET])
                writer.writerows([*x[i].tolist(), int(y[i])] for i in indices)
        (folder / 'preprocessing.json').write_text(json.dumps({
            'minimum': minimum.astype(float).tolist(),
            'span': span.astype(float).tolist(),
            'fitted_on': 'full hospital dataset before 80/20 split (notebook exact)'}))
        hospitals.append({'id': hospital, 'n': n, 'train': cut, 'test': n-cut})
    meta = {'synthetic': True, 'version': 'FL.ipynb-cell-4-fedavg-v1',
            'features': FEATURES, 'target': TARGET, 'hospitals': hospitals,
            'partition': 'Original generated order, first 80% train, last 20% test',
            'preprocessing': 'Hospital min-max on full data before split'}
    (root / 'metadata.json').write_text(json.dumps(meta, indent=2))
    return meta


def ensure(root):
    root = Path(root)
    meta = root / 'metadata.json'
    if not meta.exists():
        return generate(root)
    data = json.loads(meta.read_text())
    if data.get('version') != 'FL.ipynb-cell-4-fedavg-v1':
        raise ValueError('Notebook dataset version mismatch')
    return data


def load(folder, split):
    with (Path(folder) / (split + '.csv')).open() as stream:
        rows = list(csv.DictReader(stream))
    return (np.array([[float(row[f]) for f in FEATURES] for row in rows], np.float32),
            np.array([float(row[TARGET]) for row in rows], np.float32))


def train(folder, parameters):
    x, y = load(folder, 'train')
    model = torch.nn.Sequential(torch.nn.Linear(4, 1), torch.nn.Sigmoid())
    with torch.no_grad():
        model[0].weight.copy_(torch.tensor(parameters['weight'], dtype=torch.float32).reshape(1, 4))
        model[0].bias.copy_(torch.tensor(parameters['bias'], dtype=torch.float32))
    optimizer = torch.optim.SGD(model.parameters(), lr=LR)
    xx = torch.tensor(x)
    yy = torch.tensor(y).unsqueeze(1)
    for _ in range(LOCAL_EPOCHS):
        optimizer.zero_grad()
        torch.nn.BCELoss()(model(xx), yy).backward()
        optimizer.step()
    return {'weight': model[0].weight.detach().numpy().flatten().astype(float).tolist(),
            'bias': model[0].bias.detach().numpy().astype(float).tolist()}, len(y)


def evaluate(root, parameters):
    all_y, all_p, by_hospital = [], [], []
    for hospital in SETTINGS:
        x, y = load(Path(root) / hospital, 'test')
        with torch.no_grad():
            z = torch.tensor(x) @ torch.tensor(parameters['weight'], dtype=torch.float32)
            z += torch.tensor(parameters['bias'][0], dtype=torch.float32)
            p = torch.sigmoid(z).numpy()
        by_hospital.append({'hospitalId': hospital, **metrics(y, p)})
        all_y.append(y)
        all_p.append(p)
    pooled = metrics(np.concatenate(all_y), np.concatenate(all_p))
    macro = {key: float(np.mean([item[key] for item in by_hospital if item[key] is not None]))
             for key in ['accuracy', 'precision', 'recall', 'f1', 'loss', 'roc_auc']}
    return {'label': 'FL.ipynb 20-round FedAvg reproduction on synthetic data',
            'positiveClass': 'readmitted_lt30d=1',
            'dataset': 'Notebook random.seed(42), hospitals A/B/C, pooled test n=380',
            'protocol': '80/20 ordered split; full-hospital min-max before split; ten full-batch SGD epochs per round at LR 0.01; threshold 0.5',
            'limitation': 'The notebook fits min-max scaling before the split, so test ranges influence preprocessing.',
            'pooled': pooled, 'hospitalMacro': macro, 'byHospital': by_hospital}
