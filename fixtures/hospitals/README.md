# VeyLance hospital readmission research sandbox

This dataset has 1,350 invented index discharges for adults with diabetes across three fictional hospitals. Every row describes a different fictional person and is generated from a fixed seed. No patient records, names, identifiers, exact dates, or learned distributions from real people were used. The local encounter key is invented. The cohort is a scenario assumption.

## Reference and scope

The public documentation of the [UCI Diabetes 130-US Hospitals dataset](https://doi.org/10.24432/C5230J) motivates the discharge-time task, the encounter fields and the early-readmission outcome. UCI describes 101,766 historical encounters and stays of 1 to 14 days. This sandbox uses independently chosen distributions, hospital characteristics, and outcome coefficients. It does not replicate UCI's sites, readmission rates, or clinical associations. The synthetic label is sampled directly and has no linked future encounter. Use for software testing and demonstrations only.

## Files and reproducibility

Each hospital folder contains train.jsonl and test.jsonl with one JSON record per line. A has 480 training and 120 held-out rows, B has 360 and 90, and C has 240 and 60. Keep each site's files with its local worker in the simulation. Run `node generate.mjs` to recreate all six files. The generator has no external dependencies. Site settings vary emergency admissions, prior visits, and length of stay.

## Field dictionary

| Field | Meaning | Suggested warrant |
|---|---|---|
| encounter_id | Unique invented local encounter key | Local bookkeeping only |
| emergency_admission | Emergency admission flag, 0 or 1 | Training feature |
| prior_inpatient_visits | Simulated inpatient visits in the year before this admission | Training feature |
| length_of_stay | Length of completed index stay, 1 to 14 days | Training feature |
| medication_count | Simulated medication count for the index stay | Training feature |
| age_band | Invented adult age range | Available locally for a field-denial test; omit from model inputs |
| readmitted_lt30d | Binary toy outcome indicating a simulated readmission less than 30 days after discharge | Training label or local evaluation only |

## Suggested demonstration

A quality-improvement researcher requests a toy logistic regression training job for retrospective readmission research. The reviewer limits it to four features, three training rounds and a short expiry. Enforce the feature list inside the worker and check each site-specific warrant at dispatch and when accepting updates. Record decisions, site, round and grant ID. Keep rows local and release only approved model updates and summary metrics. Revoke the third site's warrant while a round is running and reject its uncommitted update. Previous contributions stay in completed model versions. This download supplies data and a generator; implement the workers, aggregation and warrant checks in the app.
