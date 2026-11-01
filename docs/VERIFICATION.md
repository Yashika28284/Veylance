# Verification report — 31 October 2026

## Executed

Environment: Linux, Node **24.22.1**, Python **3.12.14**, Flower **1.42.0**, PyTorch **2.9.1+cpu**, NumPy **2.3.5**, scikit-learn **1.7.2**. The universal Python lock was resolved and installed; JavaScript dependencies were installed with `npm ci`. Local Chart.js/fonts and their license files were bundled. Docker is not installed in this execution environment. A native startup smoke check returned health 200, readiness 503 for missing NamoID settings, protected snapshot 401, and demo page 200.

**13 Node tests passed, 0 failed**, including the actual Flower integration test. **2 Python tests passed, 0 failed**. Final Node suite runtime was about 23 seconds on this host; this is an observation, not a runtime guarantee. Tests use temporary SQLite databases and clearly named offline identities inside `tests/`. They do not establish successful NamoID sign-in.

| Check | Observed result |
|---|---|
| Three distinct reviewers, server-managed roles | Pass. One identity cannot occupy two slots; requester self-review rejected. |
| Scope narrowing, stale scope rejection, expansion denial | Pass. Narrowing increments version and resets earlier approvals. Review/consent must identify the current version. |
| Original requester consent | Pass. Narrowed warrant stays inactive until acceptance; another requester is denied. |
| Rejection, expiry, revocation, quotas | Pass. Terminal/inactive warrants deny operations; finite quota enforced. |
| Resource, purpose, hospital, feature and operation checks | Pass. Restricted `age_band`, target-as-input, cross-hospital and wrong-scope operations denied. |
| Concurrent duplicates and idempotency | Pass. Twelve simultaneous identical finalize requests consume one allowance and create one receipt. Changed update conflicts. |
| Worker signatures, malformed dimensions/values, stale model binding | Pass. Invalid signature, null/non-finite numeric representation, shape, model hash and scope version are rejected. |
| Unauthorized API access / CSRF | Pass. Protected APIs require a session; mutations require Origin and CSRF token. No `/auth/demo` route. |
| Model-download bypass | Pass. Training metadata excludes model parameters; public artifact paths return 404; revoked B cannot download. Authorized A receives bytes whose SHA-256 matches provenance. |
| Audit-chain consistency, range, optional checkpoint | Pass. Persisted SHA-256 chain verifies; mismatched checkpoint fails. |
| Deliberate ledger tampering | Pass. Direct storage mutation at entry 2 reports first invalid entry 2. |
| Actual Flower coordinator and three connected clients | Pass. Actual gRPC networking, PyTorch client training, and Flower FedAvg strategy executed. No handwritten averaging loop substitutes for Flower. |
| Live B denial/revocation scenario | Pass. Real bound-worker authorization call denies age_band. Queued B update rejected after revocation. A and C finish later rounds. |
| Persistence | Pass. A second SQLite connection reads committed session/hash after the training run. The app's startup recovery marks interrupted processes failed and retains committed data. |
| Online backup / offline restore | Pass. Actual SQLite online backup, manifest and artifact checks, restore into a new database/artifact directory, then chain/model verification. |
| Data reproducibility and scaler isolation | Pass. Independent generation produces identical file bytes. Scaler moments equal training-only moments. Four input columns exclude target and age_band. |
| Metric semantics | Pass. Positive-class precision/recall/F1 checked on known labels; single-class AUC becomes unavailable. |
| Empty/live frontend rendering | Pass. All five workspace renderers execute with no warrants or model, preserving unavailable values. |

## Actual measured run

`docs/evidence/executed-session.json`, three `model-v*.json` artifacts and `dataset-metadata.json` contain executed, separately labelled evidence. The production app does not seed them into the live database. Every new live database starts empty.

Three actual communication rounds were run. Round 1 accepts A/B/C. Round 2 queues A/B/C, then B is revoked before acceptance; A/C are accepted, B is rejected with `REVOKED`. Round 3 rejects B at preflight and accepts A/C. Final totals: **7 accepted, 2 rejected**; B uses only one allowance. The restricted-feature denial and revocation decisions appear in both audit and security records.

Pooled untouched synthetic tests: **540 examples**, positive class `readmitted_lt30d=1`, fixed 0.5 threshold. Final results (small floating-point differences may occur across versions/order/platforms):

| Model | Accuracy | Precision | Recall | F1 | ROC-AUC | Log loss |
|---|---:|---:|---:|---:|---:|---:|
| Federated, final round | 76.48% | 60.00% | 4.65% | 0.0863 | 0.7372 | 0.6025 |

This classifier has poor positive-class recall. Federation does not beat every local baseline. No result was replaced by an attractive fixture. Baselines share the same model, per-hospital epoch budget and common pooled test evaluation; detailed metrics and hospital macro averages are in the evidence JSON. Tests remain separate from training and preprocessing. The protocol fixes the final round in advance; it does not select a best test checkpoint.

## Browser checks

The managed cloud browser opened the existing extended interface through a local test server. Its visible identity reads **Offline identity · browser test harness**. That harness uses separately persisted measured results from an executed session. It is a test file, is not imported by `server/index.js`, and is not the normal `npm start`/`npm run dev` path.

Executed browser checks:

- Public introduction, Overview, Warrants, Federated training, Security events and Audit history navigation.
- Measured metrics, real round rows, local comparison and full artifact SHA-256 shown in the training view.
- Security hospital/type filters and expandable forbidden-feature explanation.
- Real SHA-256 verification interaction and audit text search.
- Complete browser-local guided demo: advance, restricted request, revoke, rejected B contribution, continued A/C rounds and completion.
- Native modal request form, successful submission, pending status filter and warrant search. Initial dialog focus visibly lands on its close control.
- A 390-pixel iframe (375-pixel content width after scrollbar) exercises responsive CSS: page width equals viewport width; the 681-pixel table scrolls inside its 343-pixel container. Mobile menu and keyboard navigation to Warrants work.
- No application console errors/warnings were observed in the inspected browser logs. Unrelated browser-extension metadata errors were excluded from that finding.

Screenshots are in `docs/screenshots/`. They show an executed measured test-harness instance and a separate mobile fixture demo. Session IDs, timestamps and hashes change between test runs. The screenshots are not evidence of NamoID authentication or a public deployment.

## Blocked or unexecuted

| Component | Exact limitation |
|---|---|
| NamoID live sign-in | The exact Test issuer and the confidential client's configured token authentication method were not supplied. Registration of `http://localhost:3000/auth/callback` has not been confirmed. Client ID/secret alone cannot determine these. |
| NamoID flow verification | Official documentation was read and the discovery/PKCE/RS256/UserInfo/session implementation was completed. Missing configuration and invalid callback refusal were tested. No successful provider callback, token refresh, provider logout or multi-account provider login was executed. The app uses bounded local sessions and does not implement refresh-token renewal or global provider logout. |
| Docker images / Compose | Docker executable/daemon unavailable here. Compose files were inspected and parsed as YAML, but containers were not built or run. |
| Windows native execution | PowerShell commands and a universal Python 3.12 lock are supplied. Tests were executed on Linux, not Windows. |
| AWS, Nginx, DNS and HTTPS | Deployment files and operator commands supplied; no resources, certificates, security groups, DNS records or AWS accounts were changed. Renewal dry-run is an operator step. |
| Privacy and threat claims | No clinical validation, differential privacy, secure aggregation, malicious-client attestation, strong host isolation or federated unlearning. |
| Independent audit anchoring | No external anchor was implemented. A supplied checkpoint can be matched, but its trust must be established independently. Full storage control can rewrite the local chain. |

The archive deliberately contains placeholders instead of credentials and excludes `.env`, runtime databases, sessions, worker tokens, caches and installed dependencies.
