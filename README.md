# VeyLance

**[Powered by NamoID](https://namoid.in)** ·
[NamoID documentation](https://docs.namoid.in) ·
[Challenge catalog](https://challenges.namoid.in)

> Built on the NamoID identity platform for the **NamoID Community Challenges** program.

This repository is a contributor-owned response to the
`responsible-ai-access-gate` problem statement. It was created from the official
[NamoID challenge template](https://github.com/namoidhq/namoid-challenge-template).

This project is an independent community build. It is not an official
NamoID product, security recommendation, or endorsement.

## NamoID integration

VeyLance uses a NamoID Test server-rendered web application. Express starts
Hosted Auth with S256 PKCE and a server-held transaction. The callback at
`/auth/callback` checks state and issuer, exchanges the code with the
server-held Client Secret, validates the signed ID token and nonce, and
compares its subject with UserInfo. Users are keyed by the NamoID `sub`.
Express issues an opaque HttpOnly application session cookie. The Test
Client ID selects the issuer through NamoID discovery.

Keep the Client Secret in local `.env` or a deployment secret store. Never
commit credentials, authorization codes, or tokens.

## Community project metadata

- **Challenge ID:** `responsible-ai-access-gate`
- **Contributor:** Aryan Bansal
- **Live demo:** Add URL
- **Final commit:** Add the full 40-character SHA at submission time
- **Time spent:** Add estimate
- **License:** MIT

## Start here

1. Create your repository using **[Use this template](https://github.com/namoidhq/namoid-challenge-template/generate)**.
2. In the new repository, run:

```bash
npm run setup -- --challenge=responsible-ai-access-gate --name="Aryan Bansal" --title="VeyLance" --repo=https://github.com/Yashika28284/Veylance
npm run check
```

This repository has already been initialized for the challenge.

3. [Create an application in the NamoID Console](https://console.namoid.in/login).
4. Configure its callback URL and integrate NamoID Hosted Auth into your POC.
5. Build, test, deploy, and submit the pinned commit.

## Run locally

```bash
copy .env.example .env
npm install
npm run dev
```

Fill `NAMOID_CLIENT_ID` and `NAMOID_CLIENT_SECRET` in the ignored `.env` file.
Register `http://localhost:3000/auth/callback` and
`http://localhost:3000/` in the NamoID Test application's callback and logout
settings. Open `http://localhost:3000` and choose Sign in with NamoID.

## What works

The challenge template validates with `npm run check`. The synthetic hospital
dataset and deterministic generator are in `fixtures/hospitals`. Local
Hosted Auth routes and an application session are implemented. The live
sign-in round trip still needs verification with the Test Client Secret.

## Known limitations

The request, review, gateway, ledger, and federated training workflows are in
progress. The current page is an authentication smoke test.

## AI and external resources

Codex helped implement the initial Node integration. Dependencies include
Express, cookie-parser, and `@namoidhq/js`. The authentication flow follows
the NamoID documentation and official Express example.

## NamoID attribution

Keep the factual challenge attribution in this README,
`namoid-challenge.json`, and the deployed page. You may change the surrounding
design and implementation. Attribution must not imply that NamoID authored,
audited, or endorses your solution.

## Submit to the catalog

Commit and push the exact version you want reviewed, then copy its full SHA:

```bash
git push
git rev-parse HEAD
```

Open the [Submit a community build](https://github.com/namoidhq/namoid-challenges/issues/new?template=community-build.yml)
form and paste the 40-character SHA into **Pinned commit SHA**. This identifies
one immutable version even if you continue changing the repository later. You
can request a catalog update or removal later.


## Veylance application

For the current application, backend, federated learning model, and local setup, see [application documentation](README-app.md). The original project metadata and GitHub Pages landing page remain in place.
