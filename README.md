# TeleAI Flowise Telegram Bridge

Lean Telegram bot project that:

- sends user messages to your existing Flowise flow
- keeps conversation memory inside Flowise
- stores only Telegram user/profile/session metadata locally
- shows users, sessions, and Flowise chat history in a small admin dashboard
- can snapshot the local state to Neon on a fixed minute interval

## What it stores locally

- Telegram user ID
- username
- first name
- last name
- public name
- language code
- chat ID and chat type
- first seen / last seen
- command usage count
- forwarded AI message count
- per-user settings
- locally created Flowise session keys
- local rate-limit counters

It does **not** store message transcripts locally. The dashboard fetches chat history from Flowise on demand.

## Persistence model

- live state is written locally to `data/store.json`
- Neon is used as a periodic backup snapshot store
- Neon keeps only the latest two snapshots for the configured backup key
- on startup, the app can restore the latest Neon snapshot
- during runtime, the app only talks to Neon on the configured backup interval

This keeps Neon usage low while still giving you recovery if Render restarts.

## Flowise requirements

If your flow uses memory nodes:

- use `FLOWISE_SESSION_MODE=sessionId`
- make sure your chatflow allows `sessionId` through `overrideConfig`

If your flow is an OpenAI Assistant / threads flow:

- use `FLOWISE_SESSION_MODE=chatId`

Relevant docs:

- `https://docs.flowiseai.com/using-flowise/prediction`
- `https://docs.flowiseai.com/integrations/langchain/memory`
- `https://docs.flowiseai.com/integrations/langchain/agents/openai-assistant/threads`
- `https://docs.flowiseai.com/api-reference/chat-message`

## Session format

- default session: `tg_<telegram_user_id>`
- new sessions via `/newchat`: `tg1_<telegram_user_id>_<public_name_slug>`, `tg2_...`

## Commands

- `/start` welcome message
- `/help` command list
- `/settings` inline settings menu
- `/newchat` create a fresh Flowise session key

## User settings

- preferred language: auto / English / Hindi
- response style: standard / concise / friendly
- rate-limit alerts: on / off

Language/style settings are applied by lightly prefixing the outgoing question before it is sent to Flowise.

## Rate limiting

Use `MESSAGES_PER_6_HOURS` to limit how many AI messages one Telegram user can send within a rolling 6-hour window.

This project applies rate limiting before the Flowise request, so your bot is protected even if Flowise-side limits are not configured.

## Neon backup

This project uses the Neon serverless driver for one-shot backup queries. That matches the Neon docs recommendation for single non-interactive queries over HTTP.

Environment variables:

- `NEON_DATABASE_URL` your Neon connection string
- `NEON_BACKUP_KEY` unique key for this app snapshot
- `BACKUP_INTERVAL_MINUTES` how often to push a fresh backup snapshot to Neon

Recommended starting value:

- `BACKUP_INTERVAL_MINUTES=30`

Tradeoff:

- lower interval = less potential data loss on crash, more Neon wake-ups
- higher interval = lower Neon activity, more possible data loss between snapshots

Backup retention:

- the app stores only the latest two Neon snapshots for each `NEON_BACKUP_KEY`
- the dashboard can view live local data, the latest backup, or the previous backup
- the admin dashboard can also trigger a manual backup immediately

## Setup

1. Install dependencies:

   `npm install`

2. Copy env file:

   `copy .env.example .env`

3. Fill in:

   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_MODE`
   - `APP_BASE_URL`
   - `TELEGRAM_POLL_RETRY_MS`
   - `FLOWISE_BASE_URL`
- `FLOWISE_FLOW_ID`
- `FLOWISE_API_KEY`
- `ADMIN_TOKEN`
- `NEON_DATABASE_URL`

If `ADMIN_TOKEN` contains `#`, spaces, or quotes, keep it wrapped in quotes in `.env`.

For Render, set `APP_BASE_URL` to your public service URL so Telegram uses webhook mode instead of polling.
Set `FLOWISE_TIMEOUT_MS` higher if your Flowise responses are slow. Use `0` to disable the timeout entirely.
Set `DEBUG_LOGS=true` temporarily when you need end-to-end Telegram and Flowise tracing in Render logs.

4. Start the app:

   `npm run dev`

5. Open dashboard:

   `http://localhost:3001`

## Admin dashboard auth

The dashboard uses `ADMIN_TOKEN`. Enter it in the page and it will be sent as `x-admin-token`.

## Project structure

- `src/index.js` app bootstrap
- `src/bot.js` Telegram bot logic
- `src/flowiseClient.js` Flowise API calls
- `src/store.js` local JSON persistence
- `src/adminRoutes.js` dashboard APIs
- `public/` static admin dashboard

## Notes

- Telegram uses webhook mode automatically when `APP_BASE_URL` or `RENDER_EXTERNAL_URL` is available.
- Telegram uses polling only when no public base URL is configured.
- If you later want, it can be upgraded to webhooks, SQLite/PostgreSQL, and stronger admin auth.
- If `NEON_DATABASE_URL` is not set, Neon backup is disabled and the app uses only the local JSON file.
