#!/usr/bin/env bash
set -euo pipefail
cd /opt/veylance
certbot renew --config-dir /opt/veylance/deploy/certbot/conf --work-dir /opt/veylance/deploy/certbot/work --logs-dir /opt/veylance/deploy/certbot/logs
docker compose exec -T nginx nginx -t
docker compose exec -T nginx nginx -s reload
