// ============================================================================
// First-run guided tour: what each page's steps are, and which of them can
// actually be shown right now.
//
// Data + pure logic only, no DOM and no sb.from(...) - same separation every
// other logic module here keeps (see CLAUDE.md's JS style section). app.js
// owns the spotlight positioning, the card rendering and the persistence;
// this file owns what the tour SAYS and which steps survive filtering.
//
// A step's `target` is an element id. `placement` is a preference only -
// app.js flips it when there isn't room, so a step near the bottom of the
// viewport still gets a readable card.
//
// **A step whose target is missing or hidden is dropped, not shown empty.**
// That is the whole reason visibleSteps() exists: a large share of this app's
// cards only appear once real data exists (the budget warning, Market
// overview, the budget warning, Realized gain/loss), and a brand-new user -
// exactly the person taking this tour - has none of it. Pointing an arrow at
// a collapsed or absent element is worse than skipping it silently.
// ============================================================================

// `diagram` on the first step of each page names the help modal's existing
// per-page SVG. app.js clones that node into the tour card rather than this
// file restating the layout: it is already written, already theme-aware, and
// already kept current, so a diagram here could only ever drift from it.
export const TOUR_STEPS = {
  log: [
    {
      target: "logView",
      diagram: "helpDiagramLog",
      title: "Welcome",
      body: "This app keeps track of your money: what you spend, what you have, and what you owe. Nothing here is shared with anyone, and nothing happens automatically to your real bank accounts - you are just keeping a record. This first page is called Log, and here is what is on it, top to bottom.",
      placement: "center",
    },
    {
      target: "nav",
      title: "The four pages",
      body: "Log is the one you are on: your day-to-day money. Subscriptions/Bills is for things that charge you every month, like a phone bill. Reports turns what you have entered into charts. Investments is for money you have invested, if you have any. Whichever page you leave off on is the one you come back to.",
      placement: "bottom",
    },
    {
      target: "logTotals",
      title: "Your numbers at a glance",
      body: "How much you have spent so far this month, how many things you have written down, and roughly how much you earn in a year. The income one shows $0 until you tell the app about your pay, which you can do further down this page.",
      placement: "bottom",
    },
    {
      target: "quickAddCard",
      title: "Writing down something you bought",
      body: "Type it however you would say it out loud, like \"14 lunch chipotle debit\". The app pulls out the amount, where you spent it, and which card or account you used, then shows you what it worked out before saving. Nothing is saved until you press Save, so it is safe to experiment. If you have a file of transactions from your bank, Import CSV brings those in instead.",
      placement: "bottom",
    },
    {
      target: "recentHistoryCard",
      title: "Everything you have written down",
      body: "A list of everything, newest first, which you can search or narrow down. Tap any item to change it if you got something wrong. Every row also has an undo arrow that removes it and puts your balance back the way it was.",
      placement: "top",
    },
    {
      target: "budgetsCard",
      title: "Setting a spending limit",
      body: "If you want to cap how much you spend on something each month - say $200 on eating out - you can set that here. The app warns you as you get close, not only once you have gone over.",
      placement: "top",
    },
    {
      target: "netWorthCard",
      title: "Net worth, in plain terms",
      body: "Net worth is just everything you have, minus everything you owe. If you have $500 in the bank and owe $200 on a card, your net worth is $300. It can be a negative number, which is normal and very common, especially with student loans. This updates itself from what you enter below.",
      placement: "top",
    },
    {
      target: "accountsCard",
      title: "Accounts: where your money sits",
      body: "Add each bank account, card or wallet you actually use. You pick the type and the bank, and the app sets up the rest. These are how you answer \"what did I pay with\" when you write down a purchase. Each type also tells you its real-world rules, like needing to be 18 to open it.",
      placement: "top",
    },
    {
      target: "assetsCard",
      title: "What you have, and what you owe",
      body: "Two lists. Things you have that are worth money - savings, a car, investments - and things you owe, like a credit card balance or a loan. Both feed into the net worth number above. You do not need to fill in everything at once; add what you know and come back later.",
      placement: "top",
    },
    {
      target: "incomeSourcesCard",
      title: "Telling the app about your pay",
      body: "Add your paycheck once: how much, and how often it arrives - weekly, every two weeks, twice a month, monthly, or one time only. After that the app records it for you each time it is due, so you do not have to remember. This is also where that yearly income figure at the top comes from.",
      placement: "top",
    },
    {
      target: "helpLogBtn",
      title: "If you get stuck",
      body: "Every page has this Help button. It explains each part of that page in more detail, and you can replay this walkthrough from there any time. You will not lose anything by clicking around - have a look.",
      placement: "bottom",
    },
  ],

  subs: [
    {
      target: "subsView",
      diagram: "helpDiagramSubs",
      title: "Things that charge you every month",
      body: "A subscription or bill is anything that takes money automatically on a schedule: a phone plan, streaming, insurance, rent. Tell the app about each one once, and it records the charge for you when it is due, so your balances stay right without you doing anything.",
      placement: "center",
    },
    {
      target: "subsTotals",
      title: "What it all adds up to",
      body: "The monthly total, and the same thing over a year. The yearly figure is often the surprising one - $15 a month is $180 a year. Anything you pay yearly is spread out so the two totals can be compared fairly.",
      placement: "bottom",
    },
    {
      target: "addSubBtn",
      title: "Adding one",
      body: "You need the name, how much it costs, how often it charges, and which account it comes out of. If you are not sure of the exact date, put your best guess - you can fix it later.",
      placement: "bottom",
    },
    {
      target: "recurringCard",
      title: "Ones it spots for you",
      body: "If the same payment keeps showing up in what you have written down, the app points it out and offers to track it properly, so you do not have to enter everything by hand.",
      placement: "top",
    },
    {
      target: "helpSubsBtn",
      title: "More on this page",
      body: "Help covers what happens when a bill is due, how cheaper-plan suggestions work, and what to do when you cancel something.",
      placement: "bottom",
    },
  ],

  reports: [
    {
      target: "reportsView",
      diagram: "helpDiagramReports",
      title: "Seeing where your money went",
      body: "This page takes everything you have written down and turns it into charts and totals, so patterns are easier to spot than in a long list. You do not need to set anything up - it fills in as you use the app.",
      placement: "center",
    },
    {
      target: "monthSel",
      title: "Pick a month",
      body: "Most of this page shows whichever month you choose here, so you can look back at any point. A few things at the bottom always describe right now instead, because they are about your current balances rather than a past month.",
      placement: "bottom",
    },
    {
      target: "reportTotals",
      title: "The three totals",
      body: "What you spent that month, how much of it was subscriptions, and how long your savings would last if your income stopped. That last one is worked out from your recent spending, and the small line underneath always says what it is based on.",
      placement: "bottom",
    },
    {
      target: "qaCard",
      title: "Just ask a question",
      body: "You can type a plain question like \"how much did I spend on food last month\" and get an answer from your own records. No special wording needed.",
      placement: "top",
    },
    {
      target: "rptExpListCard",
      title: "That month's list",
      body: "Everything from the month you picked. Tap one to change it, or tick several to change them together. You can also save the list as a file if you need it elsewhere.",
      placement: "top",
    },
    {
      target: "trendCard",
      title: "The charts",
      body: "Where your money goes by type, how the last six months compare, what came in against what went out, and what your balance is likely to look like over the next month based on bills and pay you have already told the app about.",
      placement: "top",
    },
    {
      target: "helpReportsBtn",
      title: "More on this page",
      body: "Help explains each chart one at a time, and which ones ignore the month picker.",
      placement: "bottom",
    },
  ],

  invest: [
    {
      target: "investView",
      diagram: "helpDiagramInvest",
      title: "Investments",
      body: "If you have money invested - in a retirement account through work, or shares you have bought - this page tracks it. If you do not, you can skip this page entirely; nothing else depends on it. Importantly, this app never tells you what to buy or sell. It only shows you the numbers.",
      placement: "center",
    },
    {
      target: "investHealthCard",
      title: "The short version",
      body: "A few plain sentences summing up what the rest of this page says, so you do not have to read all of it. Every line comes from real numbers further down, never a made-up rating, and a line is left out entirely if there is nothing real behind it yet.",
      placement: "bottom",
    },
    {
      target: "investTabBar",
      title: "Two halves",
      body: "Market is about the stock market generally - things that are true for everyone, whether or not you own any of it. My portfolio is only your own money. Each half splits into smaller tabs so you are not scrolling forever.",
      placement: "bottom",
    },
    {
      target: "watchlistGearBtn",
      title: "Choosing what to follow",
      body: "Everything on the Market side is built from this list of companies. Add any you want to keep an eye on. Anything you already own is added for you automatically.",
      placement: "bottom",
    },
    {
      target: "investSubTabsMarket",
      title: "Getting around the Market side",
      body: "Overview explains the day in ordinary words first, with the numbers underneath. Biggest movers shows which companies changed most. Price history charts one company over time. Tapping any company name anywhere on this page opens its history.",
      placement: "bottom",
    },
    {
      target: "helpInvestBtn",
      title: "More on this page",
      body: "Every card here also has a small \"i\" you can tap for an explanation of that card, and Help covers the whole page.",
      placement: "bottom",
    },
  ],
};

export const TOUR_VIEWS = Object.keys(TOUR_STEPS);

/**
 * Steps that can actually be pointed at right now.
 *
 * `isShowable(id)` is supplied by app.js (it needs the DOM); this stays pure
 * so the filtering rule itself can be tested without a browser. A step is
 * kept only when its target both exists and is currently visible - see this
 * file's header for why a hidden target must be dropped rather than shown.
 *
 * @param {Array<object>} steps
 * @param {(id: string) => boolean} isShowable
 * @returns {Array<object>}
 */
export function visibleSteps(steps, isShowable) {
  if (!Array.isArray(steps)) return [];
  return steps.filter((s) => s && s.target && isShowable(s.target));
}

/**
 * Clamp a step index into range. Returns -1 for an empty tour so callers can
 * treat "nothing to show" as a single case rather than guarding separately.
 */
export function clampStep(index, total) {
  if (!Number.isFinite(total) || total <= 0) return -1;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.trunc(index), total - 1));
}
