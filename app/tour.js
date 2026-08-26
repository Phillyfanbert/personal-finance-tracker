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
// cards only appear once real data exists (Live asset prices, Market
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
      title: "Welcome to your Log page",
      body: "This is where day-to-day money movement lives: what you spent, what you own, and what you owe. Here is the running order of the page, then we will walk through each part.",
      placement: "center",
    },
    {
      target: "nav",
      title: "Four pages",
      body: "Log is here. Subscriptions/Bills tracks recurring costs, Reports shows charts and totals, and Investments follows your portfolio and the market. Your last page is remembered.",
      placement: "bottom",
    },
    {
      target: "logTotals",
      title: "Your headline numbers",
      body: "This month's spending, how many entries you logged, and your income per year. Income reads $0 until you add a source further down this page.",
      placement: "bottom",
    },
    {
      target: "quickAddCard",
      title: "Log an expense in one line",
      body: "Type it the way you would say it - \"14 lunch chipotle debit\". The amount, merchant, category and account are picked out automatically, and you confirm before it saves. Import CSV loads a bank export instead.",
      placement: "bottom",
    },
    {
      target: "recentHistoryCard",
      title: "Everything you have logged",
      body: "Search and filter by account, category or amount. Tap an expense to edit it. Every row has an undo icon, which for balance adjustments is the only way to correct a mistake.",
      placement: "top",
    },
    {
      target: "budgetsCard",
      title: "Budgets",
      body: "Set a monthly cap per category. You get a warning near the limit rather than only once you are over it.",
      placement: "top",
    },
    {
      target: "netWorthCard",
      title: "Net worth",
      body: "What you own minus what you owe. Accounts by themselves are not counted here - the asset or liability linked behind each one is what carries the value.",
      placement: "top",
    },
    {
      target: "accountsCard",
      title: "Accounts are payment methods",
      body: "\"How did I pay for this\" - a card, a bank, a wallet. Adding one creates the asset or liability behind it automatically. Each type shows its real opening requirements, and Transfer moves money between two of your own accounts.",
      placement: "top",
    },
    {
      target: "assetsCard",
      title: "Assets and liabilities",
      body: "Assets are what you own, liabilities what you owe, and both count toward net worth. A vehicle can depreciate over time; a card tracks its statement cycle and credit limit.",
      placement: "top",
    },
    {
      target: "incomeSourcesCard",
      title: "Income sources",
      body: "Add a paycheck once with its cadence and the app logs it automatically each time it is due, the same way a bill is charged. This is also what fills in the Income figure at the top.",
      placement: "top",
    },
    {
      target: "helpLogBtn",
      title: "Help is always here",
      body: "Every page has this button, with a full written guide to each card. You can replay this tour from there too.",
      placement: "bottom",
    },
  ],

  subs: [
    {
      target: "subsView",
      diagram: "helpDiagramSubs",
      title: "Subscriptions and bills",
      body: "Recurring money going out. Add each one once and the app charges it against the right account when it comes due.",
      placement: "center",
    },
    {
      target: "subsTotals",
      title: "What recurring costs you",
      body: "Your monthly total and the same figure annualized, so an annual plan and a monthly one can be compared honestly.",
      placement: "bottom",
    },
    {
      target: "addSubBtn",
      title: "Add a subscription or bill",
      body: "Name, amount, billing cycle and which account pays it. Once the renewal date passes, the charge is logged for you.",
      placement: "bottom",
    },
    {
      target: "recurringCard",
      title: "Found in your spending",
      body: "The app watches for bill-shaped repetition in expenses you already logged and offers to track it, so you do not have to enter everything by hand.",
      placement: "top",
    },
    {
      target: "helpSubsBtn",
      title: "More detail",
      body: "The help sheet covers renewal maths, the discount finder, and what happens when you cancel something.",
      placement: "bottom",
    },
  ],

  reports: [
    {
      target: "reportsView",
      diagram: "helpDiagramReports",
      title: "Reports",
      body: "Where your spending gets turned into charts and totals. Most of this page follows the month you pick at the top right.",
      placement: "center",
    },
    {
      target: "monthSel",
      title: "Pick a month",
      body: "Everything above the bottom few cards follows this. The exceptions are deliberate: Emergency fund, balance history and net worth trend always describe right now, not a past month.",
      placement: "bottom",
    },
    {
      target: "reportTotals",
      title: "Totals at a glance",
      body: "That month's spending, its Subscriptions slice, and how many months your liquid savings would cover. The small line under each number says what it is actually based on.",
      placement: "bottom",
    },
    {
      target: "qaCard",
      title: "Ask about your spending",
      body: "Plain questions like \"how much did I spend on food last month\". It reads your own transactions, including older ones outside the recent window.",
      placement: "top",
    },
    {
      target: "rptExpListCard",
      title: "The month's expenses",
      body: "Every expense for the selected month, exportable as CSV or PDF. Tap one to edit or recategorize it, or tick several to change them together.",
      placement: "top",
    },
    {
      target: "trendCard",
      title: "Charts",
      body: "Breakdowns by category, account and payment type, a six-month trend, income against expense with your savings rate, and a forward cash-flow forecast built only from real scheduled items.",
      placement: "top",
    },
    {
      target: "helpReportsBtn",
      title: "More detail",
      body: "The help sheet explains each chart and exactly which ones ignore the month picker.",
      placement: "bottom",
    },
  ],

  invest: [
    {
      target: "investView",
      diagram: "helpDiagramInvest",
      title: "Investments",
      body: "Two halves: what the market did, and what your own portfolio is doing. The page never tells you what to buy - it shows you the maths and leaves the decision to you.",
      placement: "center",
    },
    {
      target: "investHealthCard",
      title: "Daily health check",
      body: "A plain-English summary compiled from the real numbers further down the page. It is never a made-up score, and a line is left out entirely when there is nothing real to base it on.",
      placement: "bottom",
    },
    {
      target: "investTabBar",
      title: "Market or your portfolio",
      body: "Market covers public facts nobody owns. My portfolio is your own money. Each side splits again into smaller tabs so one page is not an endless scroll.",
      placement: "bottom",
    },
    {
      target: "watchlistGearBtn",
      title: "Choose what to track",
      body: "Everything on the Market side is built from this list - the written recap, the up and down count, and the price history charts. Stocks you own are added automatically.",
      placement: "bottom",
    },
    {
      target: "investSubTabsMarket",
      title: "Market tabs",
      body: "Overview reads the day in plain words first and the numbers second. Biggest movers ranks the day's largest moves, and Price history charts any single symbol. Tap any ticker anywhere to open its history.",
      placement: "bottom",
    },
    {
      target: "helpInvestBtn",
      title: "More detail",
      body: "Every card here also has a small \"i\" icon explaining it, and the help sheet covers the whole page.",
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
