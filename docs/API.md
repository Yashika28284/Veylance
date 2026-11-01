# API contracts

Same-origin JSON. Errors: `{code,message,requestId}`. The server derives actors from verified opaque sessions and current SQLite role assignments. Browser `actorId`, role and hospital claims cannot grant authority. POSTs under `/api/v1` require the session's `X-CSRF-Token` and an `Origin` exactly matching `APP_ORIGIN`. Browser cookies are HttpOnly, SameSite=Lax, Secure on HTTPS. There is no CORS API or demo login endpoint.

## Identity and health

| Endpoint | Behavior |
|---|---|
| `GET /api/health` | Liveness and SQLite connectivity; no sign-in needed. |
| `GET /api/ready` | Ledger consistency and identity configuration status. 503 identifies missing settings; it does not attest successful NamoID integration. |
| `GET /auth/login` | OIDC discovery, Authorization Code + S256 PKCE, state and nonce, short-lived one-use browser transaction. Missing config returns 503. |
| `GET /auth/callback` | Consumes transaction, exchanges code once, verifies RS256 signature/JWKS, issuer, audience, nonce, expiry/issued-at and matching UserInfo subject. Creates server session only after validation. |
| `POST /auth/logout` | CSRF-protected removal of the local session. Does not promise global provider logout. |
| `GET /api/v1/session` | `{user:{sub,name,roles,hospital},csrfToken}`. 401 without verified session. |

Sessions expire no later than the verified ID token or one hour. Local roles are re-read every request. Tokens are not returned to frontend storage. Discovery uses the exact configured issuer and confidential authentication method; no client-credentials flow is used to authenticate humans.

## Warrants

`GET /api/v1/warrants` returns persisted warrants. `GET /api/v1/snapshot` returns the unified frontend contract: `clock,user,hospitals,warrants,rounds,events,audit,session,provenance`. It never returns live model parameters.

`POST /api/v1/warrants` (assigned requester only):

```json
{"hospitalId":"A","resource":"federated-model:hospital-readmission","purpose":"hospital-readmission-research","duration":24,"quota":12,"operations":["train_local","submit_update","download_model"],"features":["emergency_admission","prior_inpatient_visits","length_of_stay","medication_count"],"controls":["No patient identifiers","Aggregate model updates only","Four-feature allowlist"]}
```

Expiry is an absolute server-derived timestamp at request creation. `scopeVersion` starts at 1. Quota is an integer 1–50; duration is 1–72 hours. Target and restricted fields cannot enter input permissions.

| Endpoint | Body and rules |
|---|---|
| `POST /api/v1/warrants/:id/reviews` | `{scopeVersion}` approves the current user's available assigned slot. Optional `slot`: manager/risk/owner. Optional `decision:"reject",reason`. |
| Same endpoint with `scope` | `{scopeVersion,scope:{features,operations,quota,expiresAt}}` narrows and approves the reviewer's slot. Nonempty subsets only; future expiry no later than current. Increments version, clears all prior approvals and invalidates consent. |
| `POST /api/v1/warrants/:id/accept` | `{scopeVersion}`; only original requester, after all three distinct current-version approvals. |
| `POST /api/v1/warrants/:id/revoke` | `{reason}`; independent manager/risk/owner. Terminal, blocks future access. |
| `POST /api/v1/warrants/:id/download` | `{}`; only assigned original holder, active permissions, correct hospital and current quota. Returns actual JSON artifact bytes after checking stored SHA-256. |

Effective state: pending, awaiting_acceptance, approved, rejected, revoked, expired or exhausted. Expiry and exhausted allowance are derived from authoritative server time/counters, including for reads. No inactive warrant grants permission. Rejected/revoked decisions cannot be undone. Changes remain in the ledger and warrant history.

## Training

Resource owner controls only. `GET /api/v1/training` returns the current session's metadata, bindings, round summaries and evaluations; it does not grant access to model parameters.

| Endpoint | Body | Result |
|---|---|---|
| `POST /api/v1/training/sessions` | `{plannedRounds:4}` | Creates a notebook FedAvg session with any positive whole number of rounds and approved A/B/C four-feature warrants. Allowances are checked for each contribution. |
| `POST /api/v1/training/:id/advance` | `{pauseBeforeAcceptance:false}` | 202, spawns a real single-round Flower coordinator plus participating clients (A/B/C through notebook round 14; A/C thereafter). |
| Same endpoint | `{pauseBeforeAcceptance:true}` | Trains clients and waits in `queued` before any acceptance. Queue timeout: 150 seconds. |
| `POST /api/v1/training/:id/commit` | `{}` | Releases queued updates for current-state checks. Does not override a denial. |
| `POST /api/v1/training/:id/restricted-attempt` | `{}` | Sends actual bound B worker request to `/worker/authorize` for `age_band`; returns `{allowed:false,code:"FEATURE_DENIED",...}` after backend denial. Start a round first to issue worker credentials. |

Poll the snapshot every 1.5 seconds. States: ready, preparing, queued, running, finishing, completed, failed. Server restarts mark interrupted work failed; committed results persist. Failures display without fixture substitution. A round has accepted/rejected hospital lists, version, timestamp, actual artifact SHA-256, pooled metrics and detailed evaluation protocol. Baselines and federation share the same pooled test set and per-client epoch budget. Classification positive class is `readmitted_lt30d=1`; missing values remain null/unavailable.

## Private worker and coordinator boundary

Nginx rejects `/worker/` and `/internal/`. Python processes call them over loopback with short-lived random Bearer credentials passed through process stdin. No credential is placed in a URL, command argument or source file. Each hospital credential maps server-side to one session, hospital, warrant and scope version; coordinator credentials are separate. Credentials are rotated for each launched round and lost on restart.

`POST /worker/authorize`: body `{sessionId,hospitalId,resource,purpose,operation,features,scopeVersion}`. Checks current status, time, quota and scope. Denials produce real security/audit events.

`POST /internal/finalize`: coordinator body `{sessionId,round,updates:[{hospitalId,payload,signature}]}`. Each payload is JSON signed with that hospital's worker credential using HMAC-SHA-256. Payload includes resource, purpose, scope version, parameters, sample count, base artifact hash and model version. Node checks credential binding, exact four-feature order, finite bounded numeric shapes (`weight[4],bias[1]`), expected sample count, payload size, current version/hash and signature. Flower separately compares its network reply arrays and example counts with the signed payload. Only server-accepted hospitals are passed to Flower's FedAvg strategy.

`(session,hospital,round)` is the idempotency identity. Receipt insert, quota increment and acceptance ledger entry share a `BEGIN IMMEDIATE` transaction. Concurrent identical retries return prior receipts; changed payloads conflict. A queued revocation is checked at this point. Revocation after acceptance leaves the prior accepted receipt valid. Previous models and accepted updates cannot be remotely erased.

`POST /internal/complete`: trusted coordinator submits the actual aggregated parameters, baselines and measured evaluation. Server persists canonical artifact bytes, hashes those bytes, then records round/model provenance. Uploaded models use JSON; no pickle or unsafe PyTorch deserialization is accepted. The 128 KiB HTTP body limit and 32 KiB signed update limit bound submissions.

## Audit verification

`GET /api/v1/audit/verify`, or POST with `{checkpoint:{seq,hash}}` and CSRF, returns:

```json
{"valid":true,"count":12,"range":[1,12],"firstInvalid":null,"method":"SHA-256 over canonical JSON and previous hash","cryptographic":true,"independentCheckpointSupplied":false,"independentCheckpointVerified":false,"head":"<actual-sha256>","verifiedAt":"<server-time>","message":"Chain consistent · 12 entries · no independent anchor"}
```

Values shown here illustrate response shape, not measured evidence. `range` identifies the persisted sequence extent and `count` the successfully checked prefix. On inconsistency, `firstInvalid` names the entry. A submitted checkpoint is matched only after checking the chain; its independent trust is the caller's responsibility. No external anchoring service exists. Full local storage control can rewrite the entire chain.
