# Sahayak backend

Voice-first AI field-sales assistant — the server-side brain. The Android app is a thin client over this API.

## What's here

| Path | What |
| --- | --- |
| `src/orchestrator/` | The five jobs: brief, post-visit capture (draft → confirm), instant answers, WhatsApp draft, manager rollup. Claude via a swappable `Model` seam. |
| `src/connectors/` | ERP contract (`types.ts`) + adapters: `mock` (dev/tests), `tally` (Tally Prime XML/HTTP), `sapb1` (SAP B1 Service Layer). |
| `src/memory/` | Visits, rep memory, audit log. In-memory now; `db/schema.sql` for Postgres. |
| `src/whatsapp/` | Meta Cloud API client (text + templates) and webhook endpoints. |
| `src/speech/` | STT seam — provider chosen after the Hinglish benchmark. |
| `tests/` | Tally XML builders/parsers, Tally connector against a fake Tally, full capture flow end to end. |

## The app (installable PWA)

`public/` is the rep-facing app, served by the backend at `/`. On Android Chrome it offers "Install" and then opens
full-screen from the home screen with the mic. On iPhone: Share → Add to Home Screen. Works offline for the shell;
visits captured without signal queue on the phone and upload when it's back.

## Deploy in 10 minutes (one link for everyone)

The app needs HTTPS for the microphone and for install, so run it on a host that gives you HTTPS for free:

1. Push this folder to a GitHub repo.
2. On [render.com](https://render.com) → New → Blueprint → pick the repo (it reads `render.yaml`). Railway or Fly work the same way.
3. Set `ANTHROPIC_API_KEY`. Leave `CONNECTOR=mock` for the try-it-out link; switch to `tally` for the pilot.
4. Open `https://<your-app>.onrender.com` on a phone. Share that link.

Cost at pilot scale: the free/hobby tier of the host plus API usage (tens of rupees per rep per day).

## Run locally

```bash
cp .env.example .env        # add ANTHROPIC_API_KEY; CONNECTOR=mock to start
npm install
npm run dev                 # http://localhost:8080
npm test
```

Identity headers until SSO lands: `x-tenant-id`, `x-rep-id`, `x-rep-name`.

```bash
curl -s localhost:8080/brief -H 'x-rep-id: rahul' -H 'x-rep-name: Rahul'
curl -s localhost:8080/visits/draft -H 'content-type: application/json' -H 'x-rep-id: rahul' \
  -d '{"transcript":"Sharma Traders visited, 200 lengths 25mm pipe, delivery Friday, meet again on the 3rd"}'
curl -s -X POST localhost:8080/visits/<visitId>/confirm -H 'x-rep-id: rahul'
curl -s localhost:8080/ask -H 'content-type: application/json' -d '{"question":"25mm ka stock?"}'
curl -s localhost:8080/rollup -H 'x-rep-id: rahul'
```

## Connect Tally Prime

1. In Tally: F1 (Help) → Settings → Connectivity → Client/Server → enable "Tally acts as a Server", port 9000.
2. `.env`: `CONNECTOR=tally`, `TALLY_URL=http://<tally-pc-ip>:9000`, `TALLY_COMPANY=<exact company name>`, optional `TALLY_GODOWN`.
3. `curl localhost:8080/health` — `erp.ok` must be true.
4. Orders are created as Sales Order vouchers; over-credit dealers get `ISOPTIONAL=Yes` (draft) so accounts approves before dispatch.

Tally usually runs on a Windows PC inside the office network. For the pilot the API runs on the same network or a small on-prem agent relays port 9000 outbound.

## Self-host (what the buyer runs)

```bash
docker compose up -d
```

## Next

- Postgres `Store` implementation (schema is in `db/schema.sql`)
- SSO (OIDC/SAML) replacing identity headers; RBAC rep/manager/admin
- STT provider after the benchmark; audio streaming endpoint
- Manager rollup across a team; 7 pm WhatsApp summary
- Admin console (web)
