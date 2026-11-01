FROM node:24-bookworm-slim AS nodebase
FROM python:3.12-slim-bookworm
COPY --from=nodebase /usr/local/bin/node /usr/local/bin/node
COPY --from=nodebase /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx && apt-get update && apt-get install -y --no-install-recommends ca-certificates tini libstdc++6 && rm -rf /var/lib/apt/lists/* && useradd --uid 1000 --create-home app
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY ml/requirements.lock.txt ml/requirements.lock.txt
RUN python3 -m venv /opt/veylance-python && /opt/veylance-python/bin/pip install --no-cache-dir -r ml/requirements.lock.txt
COPY . .
RUN npm run vendor && mkdir -p /app/data /app/artifacts /app/datasets && chown -R app:app /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PYTHON_BIN=/opt/veylance-python/bin/python
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","server/index.js"]
