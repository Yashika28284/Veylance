import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Fictional parameters chosen only to exercise cross-site training and policy checks.
const sites = [
  { id: 'hospital-a', n: 600, seed: 3101, emergencyShare: 0.35, priorVisits: 0.65, stay: 2.5 },
  { id: 'hospital-b', n: 450, seed: 3102, emergencyShare: 0.65, priorVisits: 1.05, stay: 3.3 },
  { id: 'hospital-c', n: 300, seed: 3103, emergencyShare: 0.50, priorVisits: 1.50, stay: 4.0 },
];

function makeRng(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
}

function poisson(mean, random) {
  const cutoff = Math.exp(-mean);
  let product = 1;
  let draws = 0;
  do {
    draws += 1;
    product *= random();
  } while (product > cutoff);
  return draws - 1;
}

for (const site of sites) {
  const random = makeRng(site.seed);
  const dir = fileURLToPath(new URL('./' + site.id + '/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const splits = { train: [], test: [] };
  for (let i = 0; i < site.n; i++) {
    const emergency = Number(random() < site.emergencyShare);
    const previous = Math.min(8, poisson(site.priorVisits, random));
    const days = Math.min(14, 1 + poisson(site.stay + 0.4 * emergency, random));
    const meds = Math.min(35, 1 + poisson(4 + days * 0.8, random));
    const ageBand = ['18-39', '40-59', '60-79', '80+'][Math.floor(random() * 4)];
    const logOdds = -3.2 + 0.48 * previous + 0.14 * days + 0.36 * emergency;
    const probability = 1 / (1 + Math.exp(-logOdds));
    const outcome = Number(random() < probability);
    const row = { encounter_id: site.id + '-' + String(i + 1).padStart(4, '0'),
      emergency_admission: emergency, prior_inpatient_visits: previous,
      length_of_stay: days, medication_count: meds, age_band: ageBand, readmitted_lt30d: outcome };
    // Every row represents a distinct fictional patient. Split independently of the outcome.
    splits[i % 5 === 0 ? 'test' : 'train'].push(JSON.stringify(row));
  }
  for (const [split, rows] of Object.entries(splits)) {
    writeFileSync(dir + '/' + split + '.jsonl', rows.join('\n') + '\n');
  }
}
