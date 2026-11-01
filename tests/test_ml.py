import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'ml'))
from data import generate,load,FEATURES,TARGET
from model import metrics
class DataTests(unittest.TestCase):
    def test_reproducible_partitions_and_train_only_scaler(self):
        with tempfile.TemporaryDirectory() as a,tempfile.TemporaryDirectory() as b:
            generate(a);generate(b)
            for file in Path(a).rglob('*'):
                if file.is_file():self.assertEqual(file.read_bytes(),(Path(b)/file.relative_to(a)).read_bytes())
            for h in ['A','B','C']:
                x,y=load(Path(a)/h,'train');s=json.loads((Path(a)/h/'preprocessing.json').read_text())
                np.testing.assert_allclose(x.astype(float).mean(0),s['mean'])
                np.testing.assert_allclose(x.astype(float).std(0),s['scale'])
                self.assertEqual(x.shape[1],4);self.assertNotIn(TARGET,FEATURES);self.assertNotIn('age_band',FEATURES)
                self.assertTrue(np.isfinite(x).all());self.assertGreater(y.mean(),0);self.assertLess(y.mean(),1)
    def test_metrics_positive_class_and_single_class_auc(self):
        m=metrics(np.array([0,0,1,1]),np.array([.1,.8,.9,.7]));self.assertEqual(m['accuracy'],.75);self.assertAlmostEqual(m['precision'],2/3);self.assertEqual(m['recall'],1);self.assertAlmostEqual(m['f1'],.8)
        self.assertIsNone(metrics(np.array([0,0]),np.array([.1,.2]))['roc_auc'])
if __name__=='__main__':unittest.main()
