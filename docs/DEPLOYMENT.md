# Local, Docker and EC2 operation

These are commands for the operator to run. This delivery did not provision AWS resources or execute Docker, EC2, DNS or public TLS. Choose an x86-64 host with enough memory for four CPU Python processes plus Node; resource needs depend on the selected EC2 instance. No cost estimate or provisioning is implied.

## Native Ubuntu 24.04

Install Node 24 from its official distribution and ensure `node --version` reports 24.x. Ubuntu 24.04 provides Python 3.12. Extract the project to `/opt/veylance` and make it owned by your application user.

```bash
cd /opt/veylance
node --version
python3.12 --version
sudo apt-get update
sudo apt-get install -y python3.12-venv
npm ci
npm run vendor
python3.12 -m venv .venv
.venv/bin/python -m pip install -r ml/requirements.lock.txt
cp .env.example .env
chmod 600 .env
nano .env
```

Set `PYTHON_BIN=/opt/veylance/.venv/bin/python`. For localhost, keep `APP_ORIGIN=http://localhost:3000`. For a real domain, configure HTTPS as below and set `APP_ORIGIN=https://research.example.com` with the exact NamoID callback registered for that domain.

```bash
cd /opt/veylance
npm run db:init
npm start
```

NamoID missing configuration blocks sign-in and readiness while the public introduction/demo remain usable. Read the main README for server-side subject assignment. Do not expose Node's port publicly.

## Docker Desktop on Windows

Install and start Docker Desktop with Linux containers, then check the **engine**, not just CLI installation:

```powershell
Set-Location C:\Veylance
docker version
docker info
docker compose version
```

If `docker info` fails, start Docker Desktop and retry, or use the native Node/Python README path. The main Compose file is for a real HTTPS domain. For local development use this explicit localhost override:

```powershell
Set-Location C:\Veylance
Copy-Item .env.example .env
notepad .env
docker compose -f compose.local.yaml up --build -d
docker compose -f compose.local.yaml logs --tail 100
```

Open `http://localhost:3000/`. The local override publishes Node only on loopback; it does not run Nginx/TLS. The container still runs all Flower processes privately. On PowerShell, commands in `.env` do not expand `$PWD`; use actual literal values. In Docker the Python path is injected by Compose, so a Windows path from the native setup is overridden.

## One EC2 instance with Nginx

Use Ubuntu 24.04 x86-64. Upload the extracted folder through your chosen SSH/SCP workflow. Point the real domain's DNS A record at your instance. Replace every `research.example.com` below with that domain, and use your actual certificate email address.

Security group: inbound TCP 80 and 443 for public HTTP/HTTPS; TCP 22 restricted to your own administrator IP `/32` (or managed administrative network). Do not open 3000, database, gRPC/Flower or worker ports. There is no public database service. Use IPv6 rules only if you have configured IPv6 deliberately.

Install Docker using its official Ubuntu apt repository:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin certbot
sudo docker info
```

Prepare persistent directories with the application's UID (1000), never world-writable permissions:

```bash
cd /opt/veylance
mkdir -p data artifacts datasets deploy/certbot/www deploy/certbot/conf
sudo chown -R 1000:1000 data artifacts datasets
cp .env.example .env
chmod 600 .env
nano .env
```

Set `APP_ORIGIN=https://research.example.com`, the exact NamoID issuer, client ID, client secret and configured token authentication method. Register `https://research.example.com/auth/callback` in NamoID. The Compose app injects the canonical database/artifact paths and private binding.

Bootstrap HTTP **only for ACME issuance**; do not sign in over this temporary HTTP setup:

```bash
cd /opt/veylance
cp deploy/nginx/http.conf deploy/nginx/active.conf
sudo docker compose up --build -d
sudo docker compose logs --tail 100
sudo certbot certonly --webroot -w /opt/veylance/deploy/certbot/www \
  --config-dir /opt/veylance/deploy/certbot/conf \
  --work-dir /opt/veylance/deploy/certbot/work \
  --logs-dir /opt/veylance/deploy/certbot/logs \
  -d research.example.com --email YOUR-CERTIFICATE-EMAIL --agree-tos --no-eff-email
```

Edit the HTTPS configuration's `server_name` and both certificate paths for your actual domain, then activate it:

```bash
cd /opt/veylance
nano deploy/nginx/https.conf
cp deploy/nginx/https.conf deploy/nginx/active.conf
sudo docker compose exec nginx nginx -t
sudo docker compose restart nginx
curl -fsS https://research.example.com/api/health
curl -i https://research.example.com/api/ready
```

Only Nginx publishes ports. It serves `/assets/` locally and proxies the application/API under the same origin. It rejects `/worker/` and `/internal/`; Node's worker gateway remains container-private and the gRPC socket binds only Python's loopback address. Compose supplies restart policies and Tini signal reaping. The app handles SIGTERM, terminates its coordinator and clients, and preserves committed data. An interrupted round is recorded failed on restart.

Assign roles with the same exact subjects as the native README:

```bash
cd /opt/veylance
sudo docker compose exec app node scripts/admin.mjs assign 'https://YOUR-ISSUER|OWNER-SUB' owner
sudo docker compose exec app node scripts/admin.mjs assign 'https://YOUR-ISSUER|MANAGER-SUB' manager
sudo docker compose exec app node scripts/admin.mjs assign 'https://YOUR-ISSUER|RISK-SUB' risk
sudo docker compose exec app node scripts/admin.mjs assign 'https://YOUR-ISSUER|REQUESTER-A-SUB' requester A
```

Repeat requester assignments for B/C with their verified subjects. No app client secret can grant a reviewer identity.

## Certificate renewal

Run a renewal dry run first:

```bash
cd /opt/veylance
sudo certbot renew --dry-run \
  --config-dir /opt/veylance/deploy/certbot/conf \
  --work-dir /opt/veylance/deploy/certbot/work \
  --logs-dir /opt/veylance/deploy/certbot/logs
```

Install `deploy/renew-certificates.sh` as a root-owned script and use a systemd timer or root cron entry (example: `17 3 * * * /bin/bash /opt/veylance/deploy/renew-certificates.sh`). It runs renewal and reloads Nginx. Keep port 80's ACME challenge path available. Renewal and DNS were not tested here.

## Online backup and verified restore

Native PowerShell, from `C:\Veylance`:

```powershell
npm run db:backup -- backups\before-demo
```

Native Ubuntu, from `/opt/veylance`:

```bash
npm run db:backup -- backups/before-demo
```

The command uses Node's SQLite online backup API, checks `PRAGMA integrity_check`, verifies the chain and copies every model artifact referenced by the copied database. A manifest binds database/artifact bytes and the ledger head. Store backups outside the instance through your own secured storage workflow. If any artifact is missing or mismatched, backup fails instead of claiming success.

For Docker, the backup destination must be on a persistent mount; this example uses the data directory:

```bash
cd /opt/veylance
sudo docker compose exec app node scripts/admin.mjs backup /app/data/backups/before-demo
```

Restore requires all application writers stopped. Native Windows:

```powershell
Set-Location C:\Veylance
# Stop the npm-start process first.
$env:RESTORE_OFFLINE = 'yes'
npm run db:restore -- backups\before-demo
Remove-Item Env:RESTORE_OFFLINE
npm start
```

Docker Ubuntu:

```bash
cd /opt/veylance
sudo docker compose stop app
sudo docker compose run --rm -e RESTORE_OFFLINE=yes app \
  node scripts/admin.mjs restore /app/data/backups/before-demo
sudo docker compose up -d app
```

Restore verifies SQLite, manifest hashes and the chain before installation. Previous database/WAL/SHM files are retained with a `pre-restore` suffix. Referenced artifacts are restored and verified. Synthetic data can be regenerated with the published seeds; it is not needed to verify a saved model artifact. After restore, check health, readiness, warrants, round history and authorized downloads. Do not restore over a running writer.

## Reference documentation

- [Docker's official Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/)
- [Certbot webroot and renewal](https://eff-certbot.readthedocs.io/en/stable/using.html)
- [NamoID authentication protocol](https://docs.namoid.in/api/auth)
- [NamoID callback and token validation](https://docs.namoid.in/authentication/callback-and-token-validation)
