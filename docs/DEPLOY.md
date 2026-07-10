# Deploying FreshCrate (Vercel + Supabase, free tier)

This app is Next.js + a Postgres/pgvector database. The cheapest credible host is **Vercel** (app) + **Supabase** (Postgres with pgvector built in). Both have free tiers. Total cost at demo scale: effectively $0 plus a fraction of a cent per turn in OpenAI usage.

**You drive the account/auth steps** (Vercel and Supabase logins can't be automated). Everything here is copy-paste.

---

## What you'll need
- A [Supabase](https://supabase.com) account (free).
- A [Vercel](https://vercel.com) account (free) connected to your GitHub.
- Your `OPENAI_API_KEY`.
- This repo pushed to GitHub (it already is).

---

## Part A — Database (Supabase)

1. **Create a project.** Supabase dashboard → *New project*. Pick a region near your users; save the database password.

2. **Enable pgvector.** Dashboard → *Database* → *Extensions* → search `vector` → enable. (Or it's created automatically in step 4 by `db:enable-vector`, which runs `CREATE EXTENSION IF NOT EXISTS vector`.)

3. **Get the two connection strings.** Dashboard → *Project Settings* → *Database* → *Connection string*:
   - **Direct** (`...:5432/postgres`) — use this for the one-time schema push + seed below (DDL over a direct connection).
   - **Pooled / Transaction** (`...pooler...:6543/postgres`) — use this as the **runtime** `DATABASE_URL` in Vercel (serverless-friendly). The DB client already sets `prepare: false` (`db/index.ts:12`), which is exactly what the transaction pooler needs.

4. **Push schema + seed + embed the KB — run locally against Supabase.** From your machine, point `DATABASE_URL` at the **direct** string and run:
   ```bash
   # temporarily use the Supabase DIRECT connection string
   export DATABASE_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres'
   export OPENAI_API_KEY='sk-...'

   npm run db:reset      # enable pgvector + push tables + seed demo data
   npm run kb:ingest     # embed the KB articles into pgvector (uses OPENAI_API_KEY)
   npm run kb:test       # sanity-check retrieval
   ```
   > On Windows PowerShell use `$env:DATABASE_URL='...'` instead of `export`.

---

## Part B — App (Vercel)

1. **Import the repo.** Vercel dashboard → *Add New* → *Project* → import `freshcrate-support-agent`. Framework auto-detects as **Next.js**; leave build/output settings at their defaults (`next build`).

2. **Set environment variables** (Project → *Settings* → *Environment Variables*), for Production:

   | Variable | Value | Notes |
   |---|---|---|
   | `DATABASE_URL` | Supabase **pooled** string (`:6543`) | runtime connection |
   | `OPENAI_API_KEY` | `sk-...` | chat + embeddings |
   | `REFUND_CEILING_CENTS` | `1000` | optional (defaults to $10) |
   | `MAX_LOOP_ITERATIONS` | `6` | optional |
   | `MAX_OUTPUT_TOKENS` | `1024` | optional |
   | `RATE_LIMIT_PER_MIN` | `20` | optional |
   | `CHAT_MODEL_FAST` | `gpt-4o-mini` | optional |
   | `EMBEDDING_MODEL` | `text-embedding-3-small` | optional |

   **Do NOT set `MOCK_LLM`** in production — that switches the agent to the deterministic test stub instead of OpenAI.

3. **Deploy.** Vercel builds and deploys. The chat API route already pins the Node runtime (`export const runtime = "nodejs"`), so postgres.js and the OpenAI SDK work.

---

## Post-deploy checks
- Open the URL, pick a demo customer (Ava, Marcus, Noah…), and try a prompt from the README's demo table.
- Confirm citations resolve (KB articles were embedded in Part A step 4).
- Confirm a refund proposal card appears (e.g. Priya → "refund my damaged box").

## Set a spend cap
In the OpenAI dashboard, set a hard monthly usage limit and disable auto-reload — the app has per-session rate limiting, but an account-level cap is the real backstop.

---

## Troubleshooting
- **`type "vector" does not exist` / extension errors:** pgvector wasn't enabled — redo Part A step 2, then `npm run db:reset`.
- **Prepared-statement errors on Vercel:** you're likely using the direct (`:5432`) string at runtime — switch Vercel's `DATABASE_URL` to the **pooled** (`:6543`) string. (`prepare: false` is already set in the client.)
- **KB answers say "I don't have that information":** the KB vectors aren't in the Supabase DB — run `npm run kb:ingest` against the Supabase `DATABASE_URL` (Part A step 4).
- **Shared demo data drifts** (refunds/pauses persist): expected — it's a single shared demo DB. Re-run `npm run db:seed` against Supabase to reset. A "reset demo data" endpoint is planned (Phase 7).
- **Cold starts feel slow:** first request after idle spins up the serverless function; subsequent turns are fast.

---

## Note on branch/state
Deploy from `main`. For the cleanest demo, merge the Phase 4.5 hardening branch first — it fixes the duplicate-reply-text and positional-order behavior that would otherwise be visible in the live demo.
