import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ml'))
import notebook_fedavg as notebook


class NotebookFedAvgTests(unittest.TestCase):
    def test_all_twenty_round_metrics_match_saved_notebook_output(self):
        expected_accuracy = [.5211,.5237,.5316,.5342,.5342,.5421,.5474,.5526,.5579,.5605,
                             .5632,.5737,.5789,.5895,.5921,.5974,.6132,.6105,.6079,.6079]
        with tempfile.TemporaryDirectory() as root:
            notebook.generate(root)
            parameters = notebook.INITIAL
            for round_no, expected in enumerate(expected_accuracy, 1):
                updates = []
                for hospital in ['A','B','C']:
                    if hospital == 'B' and round_no > 14:
                        continue
                    update, samples = notebook.train(Path(root) / hospital, parameters)
                    updates.append((update, samples))
                total = sum(samples for _, samples in updates)
                parameters = {name: sum((np.array(update[name], dtype=np.float32) * (samples / total)
                                         for update, samples in updates)).astype(float).tolist()
                              for name in ['weight', 'bias']}
                measured = notebook.evaluate(root, parameters)['pooled']
                self.assertEqual(round(measured['accuracy'],4), expected, f'round {round_no}')
            self.assertEqual(round(measured['precision'],4), .5742)
            self.assertEqual(round(measured['recall'],4), .7861)
            self.assertEqual(round(measured['f1'],4), .6637)
