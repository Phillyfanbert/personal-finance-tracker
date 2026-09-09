# Setting up your own copy

By the end of this you will have your own private copy running: a database only
you can read, the app installed on your phone, and optionally a machine at home
doing the natural-language and market work.

Everything here is free and needs no credit card. Budget about an hour, most of
it waiting for things to provision.

You will need a Supabase account, a Cloudflare account, and somewhere to run
`python3` for local testing. Nothing else is required to get a working app; the
home machine at the end is optional and the app works fully without it.

---

## What is in here

```
app/          the whole front end: 25 JavaScript modules, one HTML file, no build step
supabase/     69 numbered migrations, applied in order, never edited afterwards
tools/        scripts that run on a home machine, all optional
worker.js     the Cloudflare Worker: serves the app and proxies live share prices
wrangler.jsonc  how that Worker is configured
docs/         background research the app was built from
```

Two files matter more than the rest while you are setting up:

- **`supabase/02_rls.sql`** is what actually keeps each person's data private.
  Skipping it leaves every row readable by anyone with your project URL.
- **`app/config.js`** holds your keys. It is gitignored and must never be
  committed. Read [SECURITY.md](SECURITY.md) before you create it.

---

## 1. Create a Supabase project

Sign up at [supabase.com](https://supabase.com), create a project, choose a
strong database password and keep it somewhere safe. Stay on the **Free** plan.
No card is asked for.

Provisioning takes a couple of minutes. While it runs, open **Project Settings
→ API** and keep the tab open: you will need the **Project URL** and the
**publishable** (anon) key shortly.

You will also see a `service_role` key there. **Never put that one in the app.**
It bypasses every privacy rule in this project. It belongs only on a home
machine, in a file that is not committed.

---

## 2. Apply the database schema

Open the **SQL Editor** and run these in order, one at a time, waiting for each
to finish:

| Order | File | What it does |
|---|---|---|
| 1 | `supabase/01_schema.sql` | tables and indexes |
| 2 | `supabase/01b_grants.sql` | lets the API reach those tables |
| 3 | `supabase/02_rls.sql` | **the privacy rules** |
| 4 | `supabase/03_seed.sql` | optional reference data for subscription plans |

Then run the rest, `04_` upward, in numerical order. They are small and each one
explains at the top what it changes and why.

---

## 3. Check the privacy rules actually took

This is the one step worth verifying rather than assuming. In the SQL Editor:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and not rowsecurity;
```

This should return **no rows**. Anything listed is a table with security
switched off, which means its contents are readable by anyone holding your
project URL and publishable key, both of which ship in the app.

---

## 4. Add your keys

```bash
cp app/config.example.js app/config.js
```

Open `app/config.js` and fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the
API tab. Leave everything else blank for now; those are for the optional home
machine.

The publishable key is safe to expose. It is designed to ship in client-side
code, and the privacy rules from step 2, not secrecy, are what protect the data.

`app/config.js` is gitignored. When you deploy in step 7, Cloudflare generates
its own copy from environment variables, so this file never leaves your machine.

---

## 5. Turn on sign-in

Under **Authentication → Providers**, make sure **Email** is enabled. That is
the default.

**Do not enable Phone or SMS.** Sending texts costs money and would break the
no-card property of the whole project.

Under **Authentication → URL Configuration**, add your redirect URLs. Add
`http://localhost:8000` now, and your deployed URL after step 7.

**A note on how sign-in works here.** Email and password is the main path.
Magic links exist as a fallback for setting or recovering a password, and the
reason is specific: on iOS, an app installed to the home screen gets its own
storage, separate from Safari. A magic-link email always opens in Safari, so a
session created that way can never reach the installed icon, which then stays
signed out no matter how many links you send. A password completes sign-in in
whatever window is already open, which is the only thing that works.

So the first time round: sign in with a magic link, then open **Profile →
Account security** and set a password. After that, use the password.

---

## 6. Run it locally, and check the privacy rules with two accounts

```bash
cd app && python3 -m http.server 8000
```

Open `http://localhost:8000`, sign in, and add an expense.

Then do the check that matters. Sign up a **second** account, sign in as that
one, and confirm you see none of the first account's data. If you can see it,
stop and go back to step 3: something is wrong with the privacy rules, and no
amount of application code will fix it.

---

## 7. Deploy to Cloudflare

The app is served by a Cloudflare **Worker**, which also proxies live share
prices. In the Cloudflare dashboard: **Workers & Pages → Create → Import a
repository**, and point it at your fork.

Set these under **Settings → Build**:

| Setting | Value |
|---|---|
| Build command | `node tools/generate-config.js` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

Then add your keys in that same section's **Variables and secrets** panel, as
**Secret** entries. `SUPABASE_URL` and `SUPABASE_ANON_KEY` are required; the
rest are only needed if you set up the home machine:

```
SUPABASE_URL              SUPABASE_ANON_KEY
GEMMA_ENDPOINT            GEMMA_MODEL            GEMMA_AUTH_KEY
DEAL_FINDINGS_ENABLED     PRICE_FINDINGS_ENABLED
```

`tools/generate-config.js` reads those at build time and writes `app/config.js`
into the deployed copy. That is why the file is gitignored: production builds
its own.

**Two things that catch people out.** Saving a variable does not trigger a
rebuild, and there is no retry button, so pick up a new value with an empty
commit: `git commit --allow-empty -m "rebuild"` and push. And there is a
*second* variables panel under **Settings → Runtime** which is a different
thing: `FINNHUB_API_KEY` goes there, because `worker.js` reads it at request
time rather than at build time.

Finally, add your new `workers.dev` URL to the Supabase redirect URLs from
step 5.

---

## 8. Install it on your phone

Open the deployed URL in Safari, then **Share → Add to Home Screen**. On
Android, Chrome offers the same through its menu.

It then behaves like an app: its own icon, no browser chrome, and it keeps
working offline for anything already loaded.

---

## 9. Stop the database going to sleep

A free Supabase project pauses after 7 days with no activity, and the app then
appears broken until something wakes it. If you use it most days you will never
hit this. If you might not, add a scheduled Cloudflare Worker that makes one
tiny query every few days.

Use a Cloudflare cron rather than GitHub Actions: GitHub disables scheduled
workflows after about 60 days without commits, which is exactly the situation a
finished, working project ends up in.

---

## Optional: the home machine

None of this is required. Without it you lose the written summaries, the
15-minute price refresh and the natural-language parsing; everything else works.

**Try the language features without setting anything up.** Run the mock server
and point the app at it:

```bash
node tools/mock-gemma-server.js
```

Then set `GEMMA_ENDPOINT` in `app/config.js` to
`http://localhost:11434/api/generate`. It answers in the same shape as the real
thing, so you can see how quick-add parsing behaves before committing to an
install.

**For the real thing**, `tools/setup-server-machine.sh` installs everything on a
Mac: Ollama with a Gemma model, a small authenticating proxy in front of it, a
Cloudflare Tunnel so your phone can reach it, and the scheduled jobs that fetch
prices, write the daily recap and generate monthly reports. Read the script
before running it; it explains each job and when it runs.

The scheduled jobs need their own keys in `tools/.env.deal-agent`, which is
gitignored. Copy `tools/.env.deal-agent.example` and fill in what you want. Every
service there has a free tier and none asks for a card.

---

## If something is not working

**Everything returns no rows, or "permission denied".** The grants in step 2
did not apply. Re-run `01b_grants.sql`, then the highest-numbered
`*_grants*.sql` migration.

**You can see another account's data.** Stop and re-run `02_rls.sql`. Check
step 3 returns nothing.

**The deployed app loads but cannot sign in.** Fetch `/config.js` from your
deployed URL. If it 404s, the build command is not set. If it has empty values,
the variables are missing or were added after the last build.

**Sign-in works in the browser but the installed icon stays signed out.** That
is the iOS storage split described in step 5. Set a password in Profile and use
that.

**Prices never update.** Check `PRICE_FINDINGS_ENABLED` is exactly the string
`true`, and that the home machine's scheduled jobs are actually running. Mutual
funds never price: the data source covers exchange-traded instruments only, and
the app skips them deliberately rather than reporting an error.
