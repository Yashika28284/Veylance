import express from 'express';
import cookieParser from 'cookie-parser';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createNamoIDClient } from '@namoidhq/js';
import { validateOIDCIdToken } from '@namoidhq/js/server';

const clientId = process.env.NAMOID_CLIENT_ID?.trim();
const clientSecret = process.env.NAMOID_CLIENT_SECRET?.trim();
const appOrigin = process.env.APP_ORIGIN ?? 'http://localhost:3000';
const redirectUri = new URL('/auth/callback', appOrigin).href;
const postLogoutRedirectUri = new URL('/', appOrigin).href;
const secure = new URL(appOrigin).protocol === 'https:';
const port = Number(process.env.PORT ?? 3000);
const txLifetimeMs = 10 * 60 * 1000;
const sessionLifetimeMs = 8 * 60 * 60 * 1000;

if (!clientId || !clientSecret) {
  throw new Error('Set NAMOID_CLIENT_ID and NAMOID_CLIENT_SECRET in .env');
}

const dbPath = resolve(process.env.DB_FILE ?? 'data/veylance.db');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS auth_transactions (
    id_hash TEXT PRIMARY KEY,
    transaction_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    sub TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    sub TEXT NOT NULL REFERENCES users(sub),
    id_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

const namoid = createNamoIDClient({ clientId });
const app = express();
app.disable('x-powered-by');
if (secure) app.set('trust proxy', 1);
app.use(cookieParser());
app.get('/styles.css', (_req, res) => {
  res.sendFile(fileURLToPath(new URL('styles.css', import.meta.url)));
});

const cookieOptions = (path, maxAge) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure,
  path,
  maxAge,
});
const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const requiredString = value => typeof value === 'string' && value.length > 0 ? value : null;

app.get('/auth/login', async (_req, res, next) => {
  try {
    const started = await namoid.hostedAuth.start({ redirectUri });
    const txId = token();
    db.prepare('INSERT INTO auth_transactions VALUES (?, ?, ?)').run(
      hash(txId),
      JSON.stringify(started.transaction),
      Date.now() + txLifetimeMs,
    );
    res.cookie('vl_tx', txId, cookieOptions('/auth', txLifetimeMs));
    res.redirect(started.authorizationUrl);
  } catch (error) {
    next(error);
  }
});

app.get('/auth/callback', async (req, res, next) => {
  const txId = req.cookies.vl_tx;
  const txHash = txId ? hash(txId) : null;
  const row = txHash ? db.prepare('SELECT * FROM auth_transactions WHERE id_hash = ?').get(txHash) : null;
  if (row) db.prepare('DELETE FROM auth_transactions WHERE id_hash = ?').run(txHash);
  res.clearCookie('vl_tx', cookieOptions('/auth'));

  const transaction = row ? JSON.parse(row.transaction_json) : null;
  const code = requiredString(req.query.code);
  const state = requiredString(req.query.state);
  if (!transaction || row.expires_at < Date.now() || req.query.error || !code || state !== transaction.state) {
    return res.status(400).send('Sign-in could not be completed. <a href="/auth/login">Try again</a>.');
  }

  try {
    const discovery = await namoid.auth.getDiscovery();
    if (discovery.authorization_response_iss_parameter_supported &&
        req.query.iss !== discovery.issuer) {
      return res.status(400).send('Sign-in issuer mismatch.');
    }
    const tokens = await namoid.hostedAuth.exchangeCode({
      code,
      redirectUri: transaction.redirectUri,
      codeVerifier: transaction.codeVerifier,
      clientSecret,
    });
    if (!tokens.id_token) throw new Error('Missing ID token');
    const claims = await validateOIDCIdToken({
      idToken: tokens.id_token,
      discovery,
      clientId,
      nonce: transaction.nonce,
    });
    const identity = await namoid.hostedAuth.userInfo(tokens.access_token);
    if (identity.sub !== claims.sub) throw new Error('UserInfo subject mismatch');
    db.prepare('INSERT INTO users (sub, display_name, email, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(sub) DO UPDATE SET display_name=excluded.display_name, email=excluded.email').run(
      claims.sub,
      identity.name || identity.email || claims.sub,
      identity.email_verified === true ? identity.email : null,
      Date.now(),
    );
    const sessionId = token();
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(
      hash(sessionId),
      claims.sub,
      tokens.id_token,
      Date.now() + sessionLifetimeMs,
    );
    res.cookie('vl_sid', sessionId, cookieOptions('/', sessionLifetimeMs));
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});

app.get('/api/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const sid = req.cookies.vl_sid;
  const session = sid ? db.prepare('SELECT sub, expires_at FROM sessions WHERE id_hash = ?').get(hash(sid)) : null;
  if (!session || session.expires_at <= Date.now()) return res.status(401).json({ authenticated: false });
  const user = db.prepare('SELECT sub, display_name, email FROM users WHERE sub = ?').get(session.sub);
  res.json({ authenticated: true, user });
});

app.post('/auth/logout', async (req, res, next) => {
  if (req.get('origin') !== new URL(appOrigin).origin) return res.sendStatus(403);
  const sid = req.cookies.vl_sid;
  const session = sid ? db.prepare('SELECT id_token FROM sessions WHERE id_hash = ?').get(hash(sid)) : null;
  if (sid) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hash(sid));
  res.clearCookie('vl_sid', cookieOptions('/'));
  try {
    const redirect = session
      ? await namoid.hostedAuth.getLogoutUrl({
        idTokenHint: session.id_token,
        postLogoutRedirectUri,
      })
      : '/';
    res.json({ redirect });
  } catch (error) {
    next(error);
  }
});

app.get('/', (_req, res) => {
  res.sendFile(fileURLToPath(new URL('index.html', import.meta.url)));
});

app.use((error, _req, res, _next) => {
  console.error('VeyLance request failed', error instanceof Error ? error.message : 'unknown');
  res.status(500).send('The request failed. Please try signing in again.');
});

app.listen(port, '127.0.0.1', () => {
  console.log(`VeyLance listening on ${appOrigin}`);
});
