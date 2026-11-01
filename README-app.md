# Veylance

Digital warrants govern real Flower federated learning among three fictional hospitals. This project extends the supplied Forest Green + Ivory interface and replaces the earlier archive's direct client/helper calls with a Flower gRPC coordinator and three connected PyTorch clients.

**Status:** backend, training and offline-identity integration tests executed. NamoID production/test-provider sign-in is implemented but blocked until the exact Test issuer and configured client authentication method are supplied and the callback is registered. No AWS resources have been provisioned. Docker and external HTTPS deployment were not executed in this environment.

## Run on Windows PowerShell, without Docker

Install Node.js **24.x** and Python **3.12 x64**. Extract the ZIP; the commands below assume the extracted directory is `C:\Veylance`.

```powershell
Set-Location C:\Veylance
node --version
py -3.12 --version
npm ci
npm run vendor
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r ml\requirements.lock.txt
Copy-Item .env.example .env
notepad .env
```

Keep your previously supplied client ID/secret only in `.env` (excluded from the ZIP and source control). Do not put them in `dist/`. Set these additional entries:

```dotenv
PYTHON_BIN=C:\Veylance\.venv\Scripts\python.exe
NAMOID_ISSUER=<exact Test issuer copied from NamoID Console>
NAMOID_TOKEN_AUTH_METHOD=<client_secret_basic or client_secret_post, as configured for this client>
```

Register exactly `http://localhost:3000/auth/callback` in the same NamoID Test application. Register `http://localhost:3000` as its allowed development origin. Issuer discovery determines endpoints; no provider host is guessed. Retain the other supplied settings: `APP_ORIGIN=http://localhost:3000`, `PORT=3000`, `DB_FILE=data/veylance.db`.

```powershell
Set-Location C:\Veylance
npm run db:init
npm start
```

Open `http://localhost:3000/`. The live workspace requires NamoID. `http://localhost:3000/demo/#/overview` opens **Interactive demo · synthetic data** and works without identity configuration. It uses labelled illustrative fixtures and never calls protected training APIs. Live failures do not fall back to fixtures.

The app starts without NamoID configuration so the public introduction, demo and liveness endpoint are usable. `/api/ready` reports 503 with the identity blocker. Signing in cannot be simulated through a public route.

## Server role assignments

For a loopback-only working model demonstration without NamoID, set `LOCAL_LIVE_DEMO=true` in `.env`, keep `HOST=127.0.0.1`, and open `/demo/#/overview`. This explicitly local mode uses the real backend and Flower model with synthetic data. The Warrants page offers a local actor selector: choose a hospital requester to create a warrant, then switch to manager, risk reviewer, and resource owner to approve it. Three preapproved synthetic warrants are seeded for the initial model run. Local actor switching is deliberately unavailable in production; it does not represent verified identities or clinical authorization.

First sign in using real NamoID accounts. The stable local identity key is `<exact-issuer>|<verified-sub>`, not an email address. A local administrator assigns the requester hospitals and the three independent reviewer roles. Before first sign-in, assignments can also be provisioned using verified Console subject IDs. Replace the example subjects with those exact values:

After each account signs in once, the preferred administrator workflow is to list the NamoID profile captured by Veylance and assign by verified email:

```powershell
npm run db:users
npm run db:assign-email -- "manager@example.com" manager
npm run db:assign-email -- "risk@example.com" risk
npm run db:assign-email -- "owner@example.com" owner
npm run db:assign-email -- "hospital-a@example.com" requester A
npm run db:assign-email -- "researcher@example.com" requester A,B,C
```

`db:users` shows name, email verification status, current roles, assigned hospitals and the stable subject. Email matching is case-insensitive. Assignment is refused when the email is unverified, has not signed in, or maps to more than one account. The email is only an administrator lookup key; Veylance saves authorization against the immutable issuer/subject identity. If an existing account predates this feature, sign out and sign in once so its NamoID email profile is captured.

The exact-subject command remains available as an audited recovery path:

```powershell
Set-Location C:\Veylance
npm run db:assign -- "https://YOUR-ISSUER|REQUESTER-A-SUB" requester A
npm run db:assign -- "https://YOUR-ISSUER|REQUESTER-B-SUB" requester B
npm run db:assign -- "https://YOUR-ISSUER|REQUESTER-C-SUB" requester C
npm run db:assign -- "https://YOUR-ISSUER|MANAGER-SUB" manager
npm run db:assign -- "https://YOUR-ISSUER|RISK-SUB" risk
npm run db:assign -- "https://YOUR-ISSUER|OWNER-SUB" owner
```

Use six separate accounts for the demonstration. The server refuses requester self-review and one identity occupying multiple reviewer slots. Roles never come from browser fields, NamoID app credentials or arbitrary token role claims. A newly authenticated subject has no roles until assigned locally. Identity issuer changes require new subject assignments.

## Live demonstration

New sessions use the FedAvg model and synthetic data from the 20-round cell of `FL.ipynb`. The owner chooses any positive whole number of rounds. Hospital B is omitted after round 14 as in that cell; the actual warrant is not revoked. Earlier sessions retain their original model and are replaced by a new notebook session when the owner next advances through the website.

After at least one round completes, a hospital requester can open **Federated training → Readmission prediction**, enter the four approved integer features, and get a server-calculated probability from the latest saved model. The request requires that requester's approved warrant bound to the current session, checks the model artifact hash, and records the model version in the audit trail without recording input values. Revocation, expiry, or loss of model access blocks further predictions. The results are computed immediately per request on synthetic research data, not validated for clinical decisions.

1. Each hospital requester signs in and requests its own four-feature warrant. Keep all three operations and required risk controls.
2. Manager, risk reviewer and owner sign in separately and approve each warrant. Any narrowing increments the scope version, clears earlier approvals, and requires original requester acceptance after all three reviewers approve again.
3. Owner opens Overview or Federated training and chooses a round count and selects **New session**, then **Advance round**. Polling displays preparation, running, finishing, ready, completed or failed states. Each advance runs one round.
4. After round one finishes, select **Test Hospital B · age_band**. The server sends an actual HTTP request with B's bound worker credential to the authorization API. Security events show the real `FEATURE_DENIED` decision.
5. Select **Prepare & pause**. When status becomes `queued`, all three workers have trained, but no update has been accepted. An independent reviewer revokes B through its warrant detail sheet.
6. Owner selects **Accept queued updates**. The server rechecks the latest warrant state under SQLite write transactions. B is rejected; A and C continue. Advance again to demonstrate B's subsequent preflight denial.
7. Inspect matching security events, audit history, local/federated comparisons and model provenance. **Verify ledger** performs a real SHA-256 check. An authorized requester can download the actual model JSON from its warrant detail sheet.

There is no live actor switcher or bootstrap route. The demo's actor selector and reset are explicitly confined to browser-local fixtures. A new live session requires an active, sufficiently scoped warrant for each hospital; after B is revoked, B must obtain a new approved warrant before starting another three-hospital session.

## Tests

```powershell
Set-Location C:\Veylance
$env:PYTHON_BIN = "$PWD\.venv\Scripts\python.exe"
npm test
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
```

Tests include an actual three-round Flower session, queued revocation, continued A/C participation, model downloads, SQLite online backup and verified restore. Offline user sessions are created only in `tests/`; they are not NamoID authentication evidence. See `docs/VERIFICATION.md` for executed results and limitations. The fresh project starts with an empty live database; `docs/evidence/` contains separately labelled measured test-run evidence, never automatically loaded by the production app.

## Architecture and evaluation

Nginx → one Node/Express app → persistent SQLite and authorized JSON model artifacts. For each requested round Node starts a Python Flower coordinator, which starts one authorized client process per participating hospital on a private loopback gRPC port. Processes exit after the round. Ephemeral worker credentials bind hospital, session, warrant and scope version. Model replies are signed, shape-checked and matched to Flower arrays; Flower's FedAvg strategy averages only updates accepted by the Node gateway, weighted by training sample count. Client processes receive their own data-folder path and credential, and do not receive NamoID secrets.

Data generation is deterministic (A: 4101, B: 5202, C: 6303), with different admission, visit, stay, medication and outcome distributions. Each hospital uses 60% train, 20% validation and 20% untouched test. A: 540/180/180; B: 468/156/156; C: 612/204/204. Only training rows fit each local standardizer. Standardized-model parameters are converted to a common raw-feature coordinate system before FedAvg. The target `readmitted_lt30d` and restricted `age_band` never enter the four-feature model.

The classifier is a CPU PyTorch linear binary model. Hyperparameters are fixed: ten local epochs per round, SGD learning rate 0.01, batches of 64, threshold 0.5, zero initialization. Validation partitions are reserved; this implementation does not tune hyperparameters or choose checkpoints on them. Final round count is fixed before training; interim test metrics are monitoring only. Baselines use the same initialization, model, optimizer, batch budget, local epochs and deterministic round seeds. Each baseline trains only at one hospital and is evaluated on the same 540 pooled test examples as federation.

New sessions reproduce the notebook FedAvg dataset, model, full-batch training and evaluation. Round counts can be any positive safe integer. The notebook omits B after round 14. Warrant status and remaining allowance are checked on each contribution, and an exhausted or revoked warrant prevents that hospital from contributing further. The notebook scales each hospital’s complete data before the train/test split, so test-set ranges influence preprocessing; its synthetic results are not an unbiased estimate.

To verify the full notebook curve through the real Flower backend with temporary offline identities and an isolated database, run `node --env-file-if-exists=.env scripts/verify-notebook-fedavg.mjs` with `PYTHON_BIN` pointing to the installed virtual environment. This takes several minutes and does not consume live warrants.

The coordinator reads the **synthetic test partitions** for exact pooled accuracy, precision, recall, F1, ROC-AUC and log loss. Training records are read only by their respective supplied client code. Hospital macro metrics are computed separately as equal-hospital averages. Pooled ROC-AUC is calculated from pooled predictions, not averaged local AUC. Positive class: `readmitted_lt30d=1`. Update aggregation weights do not redefine pooled metrics. Displayed results are labelled **Measured on synthetic data**.

The executed three-round revocation run reached 76.48% pooled accuracy, 60.00% precision, 4.65% recall, F1 0.0863, ROC-AUC 0.7372 and loss 0.6025. **Low recall limits this classifier; accuracy alone is misleading.** Federation did not beat every local baseline. These are synthetic demonstration measurements, not clinical evidence.

## Authorization and trust boundaries

The database commits contribution acceptance, quota consumption and the unique `(session,hospital,round)` receipt atomically. Exact retries return the earlier receipt without additional quota; changed payloads conflict. Queued updates are rechecked after the pause. Acceptance is the linearization point: revocation committed before acceptance rejects the update. Revocation after acceptance does not remove that already accepted update from aggregation. No browser authorization decision is authoritative. Revocation blocks future contributions and downloads; it cannot erase already downloaded files or aggregated history.

The supplied clients declare and use the approved schema. Signing and validating that declaration does not prove that arbitrary malicious hospitals trained honestly. Logical process/data-path boundaries on one EC2 instance are not strong isolation against a hostile host operator. This project does not implement differential privacy, secure aggregation, clinical validation or federated unlearning.

The local audit chain hashes canonical JSON plus the previous SHA-256. Verification reports count, range, first invalid entry, method and optional checkpoint matching. **No independent anchor is configured.** Full storage access can rewrite the complete unanchored chain. Do not call it immutable. Checkpoint trust must come from an independent channel; the server cannot establish that an arbitrary submitted checkpoint is trustworthy.

## Deployment and recovery

See `docs/DEPLOYMENT.md` for exact native Ubuntu, PowerShell Docker, EC2/Nginx/HTTPS and certificate renewal commands. SQLite is always selected by `DB_FILE`. Persistent paths are `data/`, `artifacts/` and `datasets/`. Worker and Flower ports remain private. The application marks interrupted rounds failed after a restart and retains committed results; it does not claim to reconstruct lost worker credentials.

See `docs/API.md` for request/response contracts. Bundled fonts use the SIL Open Font License and Chart.js uses MIT; license texts are in `dist/assets/licenses/`.
