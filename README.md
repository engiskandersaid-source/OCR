# Bank Transfer OCR

Extracts **sender**, **amount** and **operation date** from French bank-transfer PDFs, saves the extracted fields, and lets you question them through a built-in chat assistant.

```
 PDF ──► Next.js (web/) ──► Phase 1: ocr-service/ (FastAPI + PaddleOCR, French)
                       │         returns OCR text lines
                       ├──► Phase 2: OpenAI gpt-4o-mini (strict JSON schema)
                       │         returns { sender, amount, currency, date }
                       └──► Store: SQLite, web/data/virementocr.db
                                 extracted fields only (no PDF, no OCR text)
                                        ▲
 Chat widget ──► /api/chat ──► OpenAI gpt-4o ──► search_transfers (function tool,
                                                  runs in code over the store)
```

## What is stored

- The **PDF is never stored**, and neither is the OCR text. (While a request runs, the OCR service's web framework may spool an upload over 1 MB to a temporary file, removed when the request ends.)
- The **extracted fields** of each real bank transfer (file name, sender, amount, currency, date, review flag, time of analysis, uploader) are saved locally on the server in a SQLite database, `web/data/virementocr.db` (git-ignored, table `transfers`). The history survives refreshes and restarts.
- The same file holds **accounts** (scrypt password hashes), **sessions** (token hashes only), login throttling and an **audit log** of account changes and history clears.
- `GET /api/transfers` lists the records the user may see (newest first); `DELETE /api/transfers` clears all of them (admin only).

## Roles

| Action | Employee | Admin |
|---|---|---|
| Analyse a PDF | Yes, saved as theirs | Yes, saved as theirs |
| History and CSV export | Own transfers | All transfers, with the uploader |
| Clear the history | No | Yes, after confirmation |
| Chat assistant | Own transfers only | All transfers |
| Manage users (`/admin/users`) | No | Yes |
| Change own password | Yes | Yes |

- Permissions are enforced on the server, in every page and API route. `web/middleware.ts` only checks that a cookie exists.
- Transfers saved before roles existed have no uploader: only admins see them, as "Non attribué".
- Admins cannot demote or disable themselves, and the last active admin cannot be removed.
- New accounts and password resets produce a temporary password, shown once, which must be changed at sign-in.
- Sessions end after 2 hours of inactivity or 12 hours in total. Five failed sign-ins lock a username for 15 minutes.
- Anyone able to edit `web/data` or run `create-admin` on the server is effectively an admin: restrict that folder and its backups to the service account and administrators.

## Scope guard ("no out-of-context answers")

Extraction:

- The model gets only the OCR text, wrapped as *untrusted data*. The system prompt tells it to ignore any instructions inside that text.
- The response is forced into a strict JSON schema, so the model can't reply in free text.
- If the document isn't a bank transfer, the model returns `is_bank_transfer: false`, the UI rejects the document, and nothing is saved.
- The server checks the output again: date format, amount > 0, and the sender must appear in the OCR text.

## Chat assistant

The floating button (bottom right) opens the VirementOCR assistant. It answers **only from the stored transfers** and politely declines everything else.

- **Retrieval, not guessing.** The model has one function tool, `search_transfers` (strict schema: sender substring, date range, amount range, currency, review flag, limit). The tool filters the `transfers` table in SQL (bound parameters only) and returns exact counts and per-currency sums, minimums, maximums and averages over all matches, so figures are computed, never estimated by the model. Tool arguments are parsed and validated server-side before anything runs.
- **Scope.** The system prompt limits the assistant to the stored transfers and the app's fields. General knowledge, coding, writing, advice, jokes, role-play and "ignore your instructions" requests get a short refusal. Sender and file names coming back from the tool are treated as untrusted data, never as instructions.
- **API.** `POST /api/chat` with `{ messages: [{ role, content }], locale: "fr" | "en" }` (1 to 24 messages, 1000 characters each, last one from the user). The response is an NDJSON stream: `{"type":"status","status":"searching"}`, `{"type":"delta","text":"..."}`, `{"type":"done"}` or `{"type":"error","code":"..."}`. Closing the panel or pressing stop cancels the upstream request.
- **Access.** The route requires a signed-in user. The search scope comes from the session and is re-checked before every search: employees reach only their own transfers, including in counts and totals.
- **Key.** It uses the same `OPENAI_API_KEY` as the extraction. Without it the route answers 503 `{ "code": "no_api_key" }` and the widget shows a translated message.
- The conversation is kept in memory only: it is not saved in the browser or on the server, and it restarts on reload and whenever the stored transfers change.

## Setup

### 1. Web app configuration (Node 22+)

```powershell
cd web
copy .env.example .env.local   # then set OPENAI_API_KEY and OCR_SERVICE_TOKEN
npm install
```

### 2. OCR service (Python 3.9–3.12)

```powershell
cd ocr-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8001
```

The first start downloads the PaddleOCR French models (~100 MB). The service reads `OCR_SERVICE_TOKEN` from `web/.env.local` and refuses to start without it. Never expose it with `--host 0.0.0.0`.

### 3. First admin, then start

```powershell
cd web
npm run create-admin -- <username>   # asks for a password (12 characters minimum)
npm run dev
```

Open http://localhost:3000. Running `create-admin` again for an existing username resets its password and restores admin access, which is also the recovery path after a lockout.

### Local network (HTTPS)

Passwords must not travel over plain HTTP. The app listens on `127.0.0.1` only, and [Caddy](https://caddyserver.com) serves it to the network:

1. Copy `Caddyfile.example` to `Caddyfile` and set your address.
2. Set `APP_ORIGIN=https://your-address` in `web/.env.local`.
3. In `web`, run `npm run build`, then `npm start`.
4. Run `caddy run` next to the `Caddyfile`, and install Caddy's root certificate on employee PCs.

## Configuration (`web/.env.local`)

| Variable | Default | |
|---|---|---|
| `OPENAI_API_KEY` | — | required for extraction and for the chat assistant, never commit it |
| `OPENAI_MODEL` | `gpt-4o-mini` | extraction model |
| `OPENAI_CHAT_MODEL` | `gpt-4o` | chat assistant model (must support function calling) |
| `OCR_SERVICE_URL` | `http://127.0.0.1:8001` | |
| `OCR_SERVICE_TOKEN` | — | required, shared secret with the OCR service |
| `APP_ORIGIN` | `http://localhost:3000` in development | required in production: the exact address used in the browser |
| `VIREMENTOCR_DATA_DIR` | `web/data` | folder of the SQLite database |
