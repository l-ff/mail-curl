# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Install dependencies: `npm install` or `npm ci`
- Run the service locally: `npm start` or `node index.js`
- Build Docker image: `docker build -t mail-curl .`
- Run Docker image locally: `docker run --rm -p 3100:3100 --env-file .env mail-curl`

There are currently no `test`, `lint`, or `build` scripts in `package.json`.

## Runtime configuration

Configuration is loaded in `src/config.js`. The loader reads `.env` and `.env.local`, but it does not override keys already present in `process.env`.

- `PORT`: HTTP port, defaults to `3100`
- `HOST`: bind host, defaults to `::`; the Docker runtime sets it to `0.0.0.0`
- `MC_KEY`: shared API key passed as the `key` query parameter, defaults to `sk-test`
- `CHATGPT_MAIL_API_KEY`: enables the `chatgpt_mail` provider when present
- `CHATGPT_MAIL_BASE_URL`: defaults to `https://mail.chatgpt.org.uk`
- `CHATGPT_MAIL_TIMEOUT_MS`: defaults to `10000`
- `TWENTY_FOUR_EMAIL_ENABLED=1`: enables the `twenty_four_email` provider
- `TWENTY_FOUR_EMAIL_BASE_URL`: defaults to `https://24.email`
- `TWENTY_FOUR_EMAIL_TIMEOUT_MS`: defaults to `10000`

## Architecture

This is a lightweight Node.js ESM HTTP service that exposes a stable mail API while isolating provider-specific behavior in provider modules.

- Root `index.js` calls `startServer()` from `src/index.js`.
- `src/index.js` re-exports `buildApp` and `startServer` from `src/server.js`.
- `src/server.js` loads config, registers enabled providers, handles routing, validates auth/query parameters, and creates the HTTP server.
- `src/errors.js` defines the shared error model and converts errors to JSON HTTP responses.
- `src/http-client.js` wraps `fetch` with base URL resolution, timeouts, and `UpstreamError` wrapping.
- Provider modules live directly under `src/providers/`; large static domain data for `twenty_four_email` is kept in `src/providers/twenty-four-email-domains.js`.

## Provider model

Every provider exposes:

- `name`
- `capabilities()`
- `createMailbox() -> { id, email, provider }`
- `listInbox({ mailboxId }) -> Array<{ mail_id, sender_name, subject, received_at }>`
- `getMail({ id }) -> { id, subject, content, html, from, received_at }`

Current providers:

- `chatgpt_mail`: implemented as an HTTP API provider in `src/providers/chatgpt-mail.js`.
- `twenty_four_email`: implemented in `src/providers/twenty-four-email.js`; it creates addresses from local domain data, reads inbox events over WebSocket, and parses mail detail HTML with `jsdom`.

When adding a provider:

1. Add the provider implementation under `src/providers/`.
2. Add its config and enablement logic in `src/config.js`.
3. Register it in `createProviders()` in `src/server.js`.
4. Reuse `HttpClient` from `src/http-client.js` for HTTP-backed providers.

## Manual verification

Before manual endpoint testing, set `MC_KEY` and enable at least one provider.

- Start the service with `npm start`.
- Check health with `GET /health`; enabled providers should appear in the response.
- Create a mailbox with `POST /<provider>/api/remail?key=...`.
- List inbox with `GET /<provider>/api/inbox?key=...&mailbox_id=...`.
- Read a message with `GET /<provider>/api/mail?key=...&id=...`.
