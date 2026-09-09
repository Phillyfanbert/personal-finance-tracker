# Personal Finance Tracker

A private, self-hosted app for tracking where your money goes, what you own
and owe, and what your investments are doing. Built for one household of about
five people, and deliberately kept small enough that one person can understand
all of it.

It runs for **$0 a month with no credit card on file anywhere**, which is a
design constraint rather than a boast: it shapes what the app is allowed to
depend on, and a good deal of what follows exists because of it.

This is not a product or a service. There is nothing to sign up for. It is one
household's tool, published so the code can be read.

---

## What it does

**Record spending quickly.** Type `$14 lunch chipotle debit` into one box and
it works out the amount, the merchant, the category and which of your accounts
you paid from. That runs on a keyword parser built into the app, so it works
offline and with no setup. If you point the app at a language model on your own
machine, a second pass fills in whatever the parser missed.

**Import from your bank.** Feed it a CSV, TSV or Excel export and it detects
the columns, the date format, whether amounts are US or European style, and
which rows you have already imported. Files with no header row are handled too.
Every row is categorised before you confirm, so you can see what you are
getting rather than finding out afterwards. Correcting a category teaches the
app that merchant for next time.

**Track what you own and owe.** Around 24 kinds of account, from checking and
savings through credit cards, mortgages, 401(k)s and HSAs. Net worth is assets
minus tracked debts, and every balance changes only through a real, dated,
undoable entry.

**Plan ahead.** Per-category budgets that warn before you go over rather than
after, a "safe to spend" figure that nets off bills already committed, sinking
funds for costs that do not arrive monthly, a 30-day cash-flow projection, and
a side-by-side comparison of avalanche against snowball for paying down debt.

**Follow your investments.** Holdings priced every fifteen minutes while the
market is open, a daily written recap of what moved and why, the biggest movers
across the whole market rather than only the stocks you hold, contribution
limits against real IRS figures, and a target allocation you set yourself.

**Find cheaper subscriptions.** The app knows which plans you might qualify for
from what your profile says: a current student, a teacher, someone working in
healthcare, military or veteran status. When a cheaper plan you can actually
get exists, it says so and says which detail qualified you.

**Ask about your own money.** "How much did I spend on food last month", "what
does Netflix cost me", "am I spending more than last month". Most questions are
answered by counting your records directly, with no model involved at all, and
every answer is labelled with how it was produced.

**Get your data out.** Every page exports to CSV, Excel or JSON, reports print
to PDF, and a single button downloads everything you have ever recorded.

---

## What it costs to run

Every outbound call the project makes, and what it costs. Re-verified
2026-09-02.

| Component | Free tier | Credit card? |
|-----------|-----------|--------------|
| Supabase (database, auth, row-level security) | 500 MB Postgres, ~5 GB egress | No |
| Cloudflare Workers (hosting and the price proxy) | 100k requests/day | No |
| Cloudflare Tunnel (reaching the home machine) | Yes | No |
| Ollama + Gemma (language model, local) | Your own hardware | No |
| jsDelivr (three JavaScript libraries) | Public CDN | No |
| Tavily (subscription and index search) | 1,000 credits/month | No |
| Gemini (text extraction, written recaps) | 20 requests **per day** | No, and deliberately no billing account |
| Finnhub (share prices, company news) | 60 calls/min | No |
| Alpha Vantage (market-wide movers) | 25 requests/day | No |
| Installed as a web app rather than a native one | Yes | No, avoids Apple's $99/yr |
| Email and password sign-in rather than SMS | Yes | No, texts cost money |

**What actually makes this safe is that no card is on file anywhere, not that
usage stays under the caps.** With no payment method attached, exceeding a free
tier makes requests *fail*. It cannot produce a bill.

That is why the rule is "no card anywhere" rather than the softer "nothing that
actually bills us". Consider the Brave Search API, which in February 2026
converted the card it had promised would "only be used to confirm your identity
and will not be charged" into an active billing instrument with no published
spending cap. A promise not to charge a stored card is a reversible policy, not
a guarantee.

Two things here are genuinely not free and are not vendor charges:
**electricity, and the home machine itself**, which runs the language model and
the scheduled background jobs.

---

## How it is put together

Three zones, which are also the three privacy boundaries:

```
┌──────────────────────┐        store & read          ┌──────────────────────────┐
│  Phone or browser    │ <──────────────────────────> │  Supabase (cloud)        │
│  · quick entry       │                              │  · Postgres + Auth       │
│  · charts & reports  │                              │  · Row-Level Security    │
│  installed as an app │ ──────┐                      │  per-user data isolation │
└──────────────────────┘       │ parse text, answer   └──────────────────────────┘
                               ▼ questions
                        ┌──────────────────────────┐
                        │  Home machine            │
                        │  · Gemma via Ollama      │
                        │  · scheduled agents      │
                        │  reachable via a tunnel  │
                        └──────────────────────────┘
```

The **browser** holds no secrets beyond your own session. **Supabase** is the
source of truth and where privacy is actually enforced. The **home machine** is
optional enrichment that never blocks the app: with it switched off, everything
still works apart from the written summaries and the live price refresh.

**No build step.** The front end is plain HTML, CSS and JavaScript modules
loaded directly by the browser. There is no bundler, no framework and no
`package.json`. You can read a file and know that is exactly what runs. Three
libraries load from a CDN: the Supabase client, Chart.js and PapaParse.

The database schema lives in [`supabase/`](supabase/) as numbered migration
files, applied in order and never edited afterwards, so the history of why the
shape changed stays readable.

---

## Privacy

Each person sees only their own data. That is enforced by row-level security in
Postgres on every table, so it holds even if the application code has a bug,
and it is checked on every single request rather than trusted once at sign-in.

Your transactions, balances and notes are never sent to an outside company. The
questions you ask about your spending are answered on the home machine, not by
a cloud service. What does leave is deliberately impersonal: share symbols sent
to a price service, and the names of subscription services looked up against
public pricing pages.

There is no analytics, no tracking, and nothing sets a cookie. The app itself
has a plainer version of all this under **Profile → Your data and privacy**,
including the part people most need to know: whoever runs the app holds a key
that can read the whole database.

---

## Running your own copy

[**SETUP.md**](SETUP.md) walks through it end to end: creating a free Supabase
project, applying the schema and security policies, wiring in your own keys,
deploying to Cloudflare, and installing it on a phone. The optional home-machine
pieces are covered there too, along with a mock server so you can try the
natural-language entry without setting one up.

You will need your own Supabase project and your own API keys. Nothing in this
repository contains credentials, and `app/config.js` is deliberately not
committed.

---

## What it deliberately does not do

- **No bank syncing.** Transactions are typed in or imported from a file. This
  is a considered decision, not a missing feature: connecting a bank means a
  third party with continuous read access to every account, and it would break
  the rule that your financial data stays between your own devices and your own
  database.
- **No investment advice.** The app shows you your own numbers and general,
  widely published information. It will not tell you what to buy or sell, and
  it will not invent a score to summarise how you are doing.
- **No native app.** It installs to a home screen as a web app, which is what
  keeps it free of an Apple developer account.
- **No multi-currency.** Everything is US dollars.

---

## License

Source-available, not open source. See [LICENSE.md](LICENSE.md) for the full
terms. In short:

- **You may** read the source, fork it, and run your own copy for personal,
  non-commercial use. Configuring it to run, with your own keys and the
  database migrations, is expressly permitted, since it cannot run otherwise.
- **You may not** publish modified versions, sell it, or use it commercially.

This is a personal finance tracker, not a licensed financial service. It gives
no advice, and nothing it displays should be relied upon as advice.
