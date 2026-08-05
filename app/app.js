// ============================================================================
// Expense Tracker - Phase 1 app logic (plain ES modules, no build step).
// Adds: editable expenses, category-correction learning loop (README §3.5),
// richer account management, and monthly charts (README §3.8).
// RLS scopes every query to the signed-in user.
// ============================================================================
import { categorize, quickParse, CATEGORIES } from "./categorize.js";
import {
  monthKey, monthLabel, lastMonths, sumBy, monthlyTotals,
  renderBreakdownBar, renderTrendBar,
} from "./charts.js";
import {
  monthlyAmount, totalMonthly, daysUntil, upcomingRenewals, renewalLabel,
} from "./subscriptions.js";
import { findDeals, studentUpsell, matchService } from "./discounts.js";
import { parseWithGemma, askGemma } from "./gemma.js";
import { buildQaContext } from "./insights.js";
import { computeNetWorth } from "./networth.js";

const { SUPABASE_URL, SUPABASE_ANON_KEY, GEMMA_ENDPOINT, GEMMA_MODEL, DEAL_FINDINGS_ENABLED } = window.APP_CONFIG || {};
if (!SUPABASE_URL || SUPABASE_URL.includes("YOUR-PROJECT")) {
  alert("Set your Supabase URL and anon key in config.js (see SETUP.md §4).");
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- tiny helpers ----------------------------------------------------------
const $ = (id) => document.getElementById(id);
const fmt = (n) => "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}
const acctName = (id) => (accounts.find((a) => a.id === id) || {}).name || "";
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// A stable keyword to learn from (first meaningful token of merchant/description).
function learnKeyword(row) {
  const src = (row.merchant || row.description || "").toLowerCase().trim();
  const tok = src.split(/\s+/).filter((w) => w.length >= 3)[0];
  return tok || null;
}

let userRules = {};   // keyword -> category
let accounts = [];
let allExpenses = []; // cache for reports (last ~12 months)
let subscriptions = []; // cache of the user's subscriptions
let catalog = [];     // shared subscription_catalog reference data
let dealFindings = []; // shared, machine-found deals (F6 stretch, docs/F6-live-deals-proposal.md)
let assets = [];      // net-worth assets (Log page)
let debts = [];        // tracked debts, i.e. rows in the `liabilities` table (Log page)
let editing = null;   // expense row currently in the edit modal
let editingSub = null; // subscription row currently in the sub form
let userId = null;    // signed-in user's uuid
let profile = null;   // the user's profiles row
let entrySource = "manual"; // 'manual' | 'parsed' - set to 'parsed' when Gemma fills fields
let gemmaTimer = null;      // debounce handle for background parsing

// ---- AUTH ------------------------------------------------------------------
$("signInBtn").onclick = async () => {
  const email = $("email").value.trim();
  if (!email) return toast("Enter your email");
  $("signInBtn").disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
  $("signInBtn").disabled = false;
  $("authMsg").textContent = error ? error.message : "✅ Link sent - check your email.";
};
$("signOutBtn").onclick = async () => { await sb.auth.signOut(); location.reload(); };

sb.auth.onAuthStateChange((_e, session) => renderAuth(session));
sb.auth.getSession().then(({ data }) => renderAuth(data.session));

function renderAuth(session) {
  const authed = !!session;
  userId = session?.user?.id ?? null;
  $("authView").classList.toggle("hidden", authed);
  $("nav").classList.toggle("hidden", !authed);
  if (authed) { showView("log"); init(); }
  else { $("logView").classList.add("hidden"); $("subsView").classList.add("hidden"); $("reportsView").classList.add("hidden"); }
}

// ---- NAVIGATION ------------------------------------------------------------
$("navLog").onclick = () => showView("log");
$("navSubs").onclick = () => { showView("subs"); loadSubscriptions(); };
$("navReports").onclick = () => { showView("reports"); loadReports(); };
$("backFromSubs").onclick = () => showView("log");
$("backFromReports").onclick = () => showView("log");
function showView(v) {
  $("logView").classList.toggle("hidden", v !== "log");
  $("subsView").classList.toggle("hidden", v !== "subs");
  $("reportsView").classList.toggle("hidden", v !== "reports");
  $("navLog").classList.toggle("active", v === "log");
  $("navSubs").classList.toggle("active", v === "subs");
  $("navReports").classList.toggle("active", v === "reports");
}

// ---- INIT ------------------------------------------------------------------
async function init() {
  fillCategorySelect($("fCategory"));
  fillCategorySelect($("eCategory"));
  $("fDate").value = new Date().toISOString().slice(0, 10);
  await ensureCashAccount();
  await Promise.all([loadRules(), loadAccounts(), loadProfile(), loadCatalog(), loadDealFindings(), loadAssets(), loadDebts()]);
  await Promise.all([loadExpenses(), loadSubscriptions()]);
}

// Every user gets exactly one Cash account + linked Cash asset, auto-created
// on first load rather than manually added (accounts_one_cash_per_user in
// 09_cash_account.sql is the DB-level backstop against duplicates).
async function ensureCashAccount() {
  const { data } = await sb.from("accounts").select("id").eq("type", "cash").limit(1);
  if (data && data.length) return;
  const { data: asset, error: assetErr } = await sb.from("assets")
    .insert({ name: "Cash", type: "cash", value: 0 }).select().single();
  if (assetErr) return; // best-effort - don't block app load on this
  await sb.from("accounts").insert({ name: "Cash", type: "cash", linked_asset_id: asset.id });
}

async function loadCatalog() {
  const { data } = await sb.from("subscription_catalog").select("*");
  catalog = data || [];
}

// F6 stretch - dormant until DEAL_FINDINGS_ENABLED is flipped on (config.js) and
// the home-machine search agent starts writing rows (docs/F6-live-deals-proposal.md).
async function loadDealFindings() {
  if (!DEAL_FINDINGS_ENABLED) { dealFindings = []; return; }
  const { data } = await sb.from("deal_findings").select("*").gt("expires_at", new Date().toISOString());
  dealFindings = data || [];
}
function fillCategorySelect(sel) { sel.innerHTML = CATEGORIES.map((c) => `<option>${c}</option>`).join(""); }

async function loadRules() {
  const { data } = await sb.from("category_rules").select("keyword,category");
  userRules = {};
  (data || []).forEach((r) => { userRules[r.keyword] = r.category; });
}

// ---- ACCOUNTS --------------------------------------------------------------
// Account types that represent real money on hand get a matching Asset
// auto-created and linked, so they count toward net worth without a manual
// second step. 'credit' is a liability, not an asset, so it's excluded;
// 'other' is ambiguous and left to manual linking. A manually chosen link
// (the picker below) always wins over auto-creation. 'cash' is deliberately
// absent - there's exactly one Cash account per user, auto-managed by
// ensureCashAccount(), never created through this form.
const AUTO_ASSET_TYPE = { checking: "bank", debit: "bank" };

$("addAcctBtn").onclick = () => $("acctForm").classList.toggle("hidden");
$("saveAcctBtn").onclick = async () => {
  const name = $("acctName").value.trim();
  const type = $("acctType").value;
  let linked_asset_id = $("acctAsset").value || null;
  if (!name) return toast("Account name required");
  if (type === "cash") return toast("Cash is automatic - use the Cash account above to add or subtract.");

  let autoLinked = false;
  if (!linked_asset_id && AUTO_ASSET_TYPE[type]) {
    const { data: newAsset, error: assetErr } = await sb.from("assets")
      .insert({ name, type: AUTO_ASSET_TYPE[type], value: 0 })
      .select().single();
    if (assetErr) return toast(assetErr.message);
    linked_asset_id = newAsset.id;
    autoLinked = true;
  }

  const { error } = await sb.from("accounts").insert({ name, type, linked_asset_id });
  if (error) return toast(error.message);
  $("acctName").value = ""; $("acctForm").classList.add("hidden");
  await loadAssets(); await loadAccounts();
  toast(autoLinked ? "Account added - linked to a new $0 asset, edit its value below" : "Account added");
};

const ACCT_COLORS = ["#0ea5e9", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#f472b6", "#22d3ee", "#fb923c"];

async function loadAccounts() {
  const { data } = await sb.from("accounts").select("*").order("created_at");
  accounts = data || [];
  $("acctList").innerHTML = accounts.length
    ? accounts.map((a, i) => `
      <div class="acct-circle-item" ${a.linked_asset_id ? `data-adjust-acct="${a.id}" style="cursor:pointer"` : ""}>
        <div class="acct-circle" style="background:${ACCT_COLORS[i % ACCT_COLORS.length]}">${a.type === "cash" ? "💵" : (a.name.trim()[0] || "?").toUpperCase()}</div>
        ${a.type === "cash" ? "" : `<span class="x" data-del-acct="${a.id}">✕</span>`}
        <div class="name">${a.name}</div>
        <div class="type">${cap(a.type)}</div>
      </div>`).join("")
    : `<p class="muted" style="font-size:13px">No accounts yet.</p>`;
  // account selects (add + edit)
  const opts = `<option value="">None</option>` + accounts.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
  $("fAccount").innerHTML = opts;
  $("eAccount").innerHTML = opts;
  $("sAccount").innerHTML = opts;
  // delete handlers - expenses keep their history (account_id -> null on delete, per schema)
  // Cash has no delete affordance - it's auto-managed (ensureCashAccount), use
  // the +/- adjust form instead of removing it.
  document.querySelectorAll("[data-del-acct]").forEach((el) => {
    el.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm("Delete this account? Existing expenses stay but become unassigned.")) return;
      const { error } = await sb.from("accounts").delete().eq("id", el.dataset.delAcct);
      if (error) return toast(error.message);
      await loadAccounts(); await loadExpenses(); toast("Account deleted");
    };
  });
  document.querySelectorAll("[data-adjust-acct]").forEach((el) => {
    el.onclick = () => openAssetAdjust(el.dataset.adjustAcct);
  });
}

// ---- ASSETS ------------------------------------------------------------
$("addAssetBtn").onclick = () => $("assetForm").classList.toggle("hidden");
$("saveAssetBtn").onclick = async () => {
  const name = $("assetName").value.trim();
  const type = $("assetType").value;
  const value = parseFloat($("assetValue").value);
  if (!name) return toast("Asset name required");
  if (!Number.isFinite(value)) return toast("Enter a value");
  if (type === "cash") return toast("Cash is automatic - use the Cash account's +/- panel instead.");
  const { error } = await sb.from("assets").insert({ name, type, value });
  if (error) return toast(error.message);
  $("assetName").value = ""; $("assetValue").value = ""; $("assetForm").classList.add("hidden");
  await loadAssets(); toast("Asset added");
};

async function loadAssets() {
  const { data } = await sb.from("assets").select("*").order("created_at");
  assets = data || [];
  $("assetsList").innerHTML = assets.length
    ? assets.map((a) => `
      <div class="exp">
        <div>${a.type === "cash" ? "" : `<div class="meta">${cap(a.type)}</div>`}${a.name}</div>
        <span class="amt">${fmt(a.value)}<span class="x" data-del-asset="${a.id}" style="margin-left:8px">✕</span></span>
      </div>`).join("")
    : `<p class="muted" style="font-size:13px">No assets yet.</p>`;
  $("acctAsset").innerHTML = `<option value="">No link</option>` + assets.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
  document.querySelectorAll("[data-del-asset]").forEach((el) => {
    el.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm("Delete this asset?")) return;
      const { error } = await sb.from("assets").delete().eq("id", el.dataset.delAsset);
      if (error) return toast(error.message);
      await loadAssets(); toast("Asset deleted"); renderNetWorth();
    };
  });
  renderNetWorth();
}

// Non-credit expenses draw down the linked asset (if the account has one),
// so assets stay in sync with real spending. Credit-card spending is a
// liability, not a draw on an asset, so it's deliberately skipped here.
// sign: -1 to apply an expense (deduct), +1 to reverse one (edit/delete).
async function applyAssetDelta(accountId, paymentType, amount, sign) {
  if (paymentType === "credit" || !accountId) return;
  const account = accounts.find((a) => a.id === accountId);
  if (!account || !account.linked_asset_id) return;
  const asset = assets.find((a) => a.id === account.linked_asset_id);
  if (!asset) return;
  let newValue = Math.round((Number(asset.value) + sign * Number(amount)) * 100) / 100;
  // Physical cash can never go negative - floor it rather than block the
  // expense (an over-budget cash purchase should still get logged).
  if (asset.type === "cash") newValue = Math.max(0, newValue);
  await sb.from("assets").update({ value: newValue }).eq("id", asset.id);
}

// ---- ADJUST AN ACCOUNT'S LINKED ASSET -----------------------------------
// Tapping any account circle with a linked asset opens this. Bank-linked
// accounts (checking/debit, typically) get a direct "set the full balance"
// field, since you can just look up and type the real number. Everything
// else - Cash included - gets +/- adjustment instead, matching how you'd
// actually track a value you don't get to look up exactly.
let adjustingAssetId = null;

function findLinkedAsset(accountId) {
  const acct = accounts.find((a) => a.id === accountId);
  if (!acct || !acct.linked_asset_id) return null;
  return assets.find((a) => a.id === acct.linked_asset_id) || null;
}

function refreshAdjustDisplay() {
  const asset = assets.find((a) => a.id === adjustingAssetId);
  if (asset) $("adjustCurrentValue").textContent = fmt(asset.value);
}

function openAssetAdjust(accountId) {
  const asset = findLinkedAsset(accountId);
  if (!asset) return;
  const panel = $("assetAdjustForm");
  // Tapping the same account again while its panel is already open closes it.
  if (adjustingAssetId === asset.id && !panel.classList.contains("hidden")) {
    panel.classList.add("hidden");
    adjustingAssetId = null;
    return;
  }
  adjustingAssetId = asset.id;
  $("adjustAssetLabel").textContent = asset.name;
  $("adjustCurrentValue").textContent = fmt(asset.value);
  $("adjustAmount").value = "";
  $("adjustNewBalance").value = String(asset.value);
  const isBank = asset.type === "bank";
  $("adjustDeltaMode").classList.toggle("hidden", isBank);
  $("adjustBankMode").classList.toggle("hidden", !isBank);
  panel.classList.remove("hidden");
}

$("adjustAddBtn").onclick = async () => {
  const amount = parseFloat($("adjustAmount").value);
  if (!amount || amount <= 0) return toast("Enter a valid amount");
  const asset = assets.find((a) => a.id === adjustingAssetId);
  if (!asset) return;
  const newValue = Math.round((Number(asset.value) + amount) * 100) / 100;
  const { error } = await sb.from("assets").update({ value: newValue }).eq("id", asset.id);
  if (error) return toast(error.message);
  $("adjustAmount").value = "";
  await loadAssets(); refreshAdjustDisplay(); toast("Added");
};

$("adjustSubtractBtn").onclick = async () => {
  const amount = parseFloat($("adjustAmount").value);
  if (!amount || amount <= 0) return toast("Enter a valid amount");
  const asset = assets.find((a) => a.id === adjustingAssetId);
  if (!asset) return;
  if (amount > Number(asset.value)) return toast("Not enough - value can't go below $0");
  const newValue = Math.round((Number(asset.value) - amount) * 100) / 100;
  const { error } = await sb.from("assets").update({ value: newValue }).eq("id", asset.id);
  if (error) return toast(error.message);
  $("adjustAmount").value = "";
  await loadAssets(); refreshAdjustDisplay(); toast("Subtracted");
};

$("adjustSetBtn").onclick = async () => {
  const newValue = parseFloat($("adjustNewBalance").value);
  if (!Number.isFinite(newValue)) return toast("Enter a valid balance");
  const asset = assets.find((a) => a.id === adjustingAssetId);
  if (!asset) return;
  const { error } = await sb.from("assets").update({ value: Math.round(newValue * 100) / 100 }).eq("id", asset.id);
  if (error) return toast(error.message);
  await loadAssets(); refreshAdjustDisplay(); toast("Balance updated");
};

// ---- LIABILITIES (tracked debts) ---------------------------------------
$("addDebtBtn").onclick = () => $("debtForm").classList.toggle("hidden");
$("saveDebtBtn").onclick = async () => {
  const name = $("debtName").value.trim();
  const type = $("debtType").value;
  const balance = parseFloat($("debtBalance").value);
  if (!name) return toast("Liability name required");
  if (!Number.isFinite(balance)) return toast("Enter a balance");
  const row = {
    name, type, balance,
    interest_rate: $("debtRate").value ? parseFloat($("debtRate").value) : null,
    minimum_payment: $("debtMinPay").value ? parseFloat($("debtMinPay").value) : null,
    due_date: $("debtDue").value || null,
  };
  const { error } = await sb.from("liabilities").insert(row);
  if (error) return toast(error.message);
  $("debtName").value = ""; $("debtBalance").value = ""; $("debtRate").value = "";
  $("debtMinPay").value = ""; $("debtDue").value = ""; $("debtForm").classList.add("hidden");
  await loadDebts(); toast("Liability added");
};

async function loadDebts() {
  const { data } = await sb.from("liabilities").select("*").order("created_at");
  debts = data || [];
  $("debtsList").innerHTML = debts.length
    ? debts.map((d) => `
      <div class="exp">
        <div>${d.name}<div class="meta">${d.type}${d.due_date ? " · due " + d.due_date : ""}</div></div>
        <span class="amt">${fmt(d.balance)}<span class="x" data-del-debt="${d.id}" style="margin-left:8px">✕</span></span>
      </div>`).join("")
    : `<p class="muted" style="font-size:13px">No other liabilities.</p>`;
  document.querySelectorAll("[data-del-debt]").forEach((el) => {
    el.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm("Delete this liability?")) return;
      const { error } = await sb.from("liabilities").delete().eq("id", el.dataset.delDebt);
      if (error) return toast(error.message);
      await loadDebts(); toast("Liability deleted"); renderNetWorth();
    };
  });
  renderNetWorth();
}

// ---- NET WORTH (Log page) ----------------------------------------------
// Recomputed from already-loaded state - cheap, no extra queries. Call
// after anything that changes assets, debts, subscriptions, or expenses.
function renderNetWorth() {
  const ym = monthKey();
  const monthRows = allExpenses.filter((r) => (r.occurred_at || "").startsWith(ym));
  const monthExpenseTotal = monthRows.reduce((s, r) => s + Number(r.amount), 0);

  const nw = computeNetWorth(assets, debts, subscriptions, monthExpenseTotal);

  $("netWorthTotal").textContent = fmt(nw.netWorth);
  $("assetsTotal").textContent = fmt(nw.assetsTotal);
  $("liabilitiesTotal").textContent = fmt(nw.liabilitiesTotal);

  const creditTotal = monthRows.filter((r) => r.payment_type === "credit").reduce((s, r) => s + Number(r.amount), 0);
  const debitTotal = monthRows.filter((r) => r.payment_type === "debit").reduce((s, r) => s + Number(r.amount), 0);
  const otherTotal = Math.round((monthExpenseTotal - creditTotal - debitTotal) * 100) / 100; // cash + unspecified
  const expenseRow = (label, value) => `
    <div class="exp" style="cursor:default">
      <div>${label}</div>
      <span class="amt">${fmt(value)}</span>
    </div>`;
  $("expensesLiabList").innerHTML =
    expenseRow("Total", monthExpenseTotal) +
    expenseRow("Credit", creditTotal) +
    expenseRow("Debit", debitTotal) +
    (otherTotal > 0 ? expenseRow("Cash / other", otherTotal) : "");

  const activeSubs = subscriptions.filter((s) => s.is_active);
  $("subsLiabList").innerHTML = activeSubs.length
    ? activeSubs.map((s) => `
      <div class="exp" style="cursor:pointer">
        <div>${s.name}</div>
        <span class="amt">${fmt(monthlyAmount(s))}/mo</span>
      </div>`).join("")
    : `<p class="muted" style="font-size:13px">No active subscriptions. Tap to add →</p>`;
  $("subsLiabList").onclick = () => $("navSubs").click();
}

// ---- QUICK ADD -------------------------------------------------------------
$("quick").addEventListener("input", (e) => {
  const raw = e.target.value;
  if (!raw.trim()) { $("confirm").classList.add("hidden"); $("parseStatus").textContent = ""; return; }
  $("confirm").classList.remove("hidden");
  // Layer 1: instant keyword parse (always on, README §3.5).
  const p = quickParse(raw);
  $("fAmount").value = p.amount ?? "";
  $("fPayment").value = p.payment_type ?? "";
  $("fDesc").value = p.rest;
  const guessed = categorize(raw, userRules);
  if (guessed) $("fCategory").value = guessed;
  entrySource = "manual";
  // Layer 2: best-effort Gemma enrichment, debounced (README §3.6).
  scheduleGemma(raw);
});
$("cancelBtn").onclick = () => { $("quick").value = ""; $("confirm").classList.add("hidden"); $("parseStatus").textContent = ""; };

// Debounced background call to Gemma. Never blocks; silently falls back.
function scheduleGemma(raw) {
  if (!GEMMA_ENDPOINT) return; // feature dormant when unconfigured
  clearTimeout(gemmaTimer);
  $("parseStatus").textContent = "";
  gemmaTimer = setTimeout(async () => {
    const sent = raw;
    $("parseStatus").textContent = "✨ asking Gemma…";
    try {
      const g = await parseWithGemma(sent, {
        endpoint: GEMMA_ENDPOINT, model: GEMMA_MODEL, today: $("fDate").value,
      });
      // Only apply if the user hasn't typed something new in the meantime.
      if ($("quick").value !== sent) { $("parseStatus").textContent = ""; return; }
      if (g.amount != null) $("fAmount").value = g.amount;
      if (g.payment_type) $("fPayment").value = g.payment_type;
      if (g.merchant) $("fDesc").value = g.merchant;
      if (g.category) $("fCategory").value = g.category;
      if (g.occurred_at) $("fDate").value = g.occurred_at;
      entrySource = "parsed";
      $("parseStatus").textContent = "✨ parsed by Gemma - confirm & save";
    } catch (err) {
      // Home machine asleep / unreachable - keep the keyword guess.
      $("parseStatus").textContent = "Gemma unavailable - using quick parse";
    }
  }, 650);
}

$("saveBtn").onclick = async () => {
  const amount = parseFloat($("fAmount").value);
  if (!amount || amount <= 0) return toast("Enter a valid amount");
  const desc = $("fDesc").value.trim();
  const fullText = $("quick").value.trim();
  const row = {
    amount, description: fullText || desc || null,
    merchant: desc.split(/\s+/)[0] || null,
    category: $("fCategory").value || null,
    payment_type: $("fPayment").value || null,
    account_id: $("fAccount").value || null,
    occurred_at: $("fDate").value,
    raw_input: fullText, source: entrySource,
  };
  $("saveBtn").disabled = true;
  const { error } = await sb.from("expenses").insert(row);
  $("saveBtn").disabled = false;
  if (error) return toast(error.message);
  await applyAssetDelta(row.account_id, row.payment_type, amount, -1);
  $("quick").value = ""; $("confirm").classList.add("hidden"); $("parseStatus").textContent = "";
  entrySource = "manual";
  await loadAssets(); await loadExpenses(); toast("Saved ✓");
};

// ---- EXPENSE LIST ----------------------------------------------------------
async function loadExpenses() {
  // Pull ~12 months so Reports can aggregate without a second round-trip.
  const since = lastMonths(12)[0] + "-01";
  const { data, error } = await sb.from("expenses")
    .select("*").gte("occurred_at", since)
    .order("occurred_at", { ascending: false }).order("created_at", { ascending: false });
  if (error) { $("expList").innerHTML = `<p class="muted">${error.message}</p>`; return; }
  allExpenses = data || [];

  const ym = monthKey();
  const monthRows = allExpenses.filter((r) => (r.occurred_at || "").startsWith(ym));
  $("monthTotal").textContent = fmt(monthRows.reduce((s, r) => s + Number(r.amount), 0));
  $("monthCount").textContent = monthRows.length;
  renderNetWorth();

  const rows = allExpenses.slice(0, 50);
  if (!rows.length) { $("expList").innerHTML = `<p class="muted">No expenses yet - add one above.</p>`; return; }
  $("expList").innerHTML = rows.map((r, i) => `
    <div class="exp" data-idx="${i}">
      <div>
        <div>${r.description || r.merchant || "(no description)"}</div>
        <div class="meta">${r.occurred_at} · ${r.category || "Uncategorized"}${r.payment_type ? " · " + r.payment_type : ""}${acctName(r.account_id) ? " · " + acctName(r.account_id) : ""}</div>
      </div>
      <span class="amt">${fmt(r.amount)}</span>
    </div>`).join("");
  document.querySelectorAll(".exp").forEach((el) => {
    el.onclick = () => openEdit(rows[Number(el.dataset.idx)]);
  });
}

// ---- EDIT MODAL + LEARNING LOOP -------------------------------------------
function openEdit(row) {
  editing = row;
  $("eAmount").value = row.amount ?? "";
  $("ePayment").value = row.payment_type ?? "";
  $("eDesc").value = row.description ?? "";
  $("eCategory").value = row.category ?? CATEGORIES[0];
  $("eAccount").value = row.account_id ?? "";
  $("eDate").value = row.occurred_at ?? new Date().toISOString().slice(0, 10);
  $("eLearn").checked = true;
  $("editModal").classList.remove("hidden");
}
$("editClose").onclick = () => { $("editModal").classList.add("hidden"); editing = null; };

$("editSave").onclick = async () => {
  if (!editing) return;
  const amount = parseFloat($("eAmount").value);
  if (!amount || amount <= 0) return toast("Enter a valid amount");
  const desc = $("eDesc").value.trim();
  const newCategory = $("eCategory").value || null;
  const categoryChanged = newCategory && newCategory !== editing.category;
  const prevAccountId = editing.account_id, prevPaymentType = editing.payment_type, prevAmount = Number(editing.amount);

  const patch = {
    amount, description: desc || null, merchant: desc.split(/\s+/)[0] || editing.merchant,
    category: newCategory, payment_type: $("ePayment").value || null,
    account_id: $("eAccount").value || null, occurred_at: $("eDate").value,
  };
  $("editSave").disabled = true;
  const { error } = await sb.from("expenses").update(patch).eq("id", editing.id);
  if (error) { $("editSave").disabled = false; return toast(error.message); }

  // Reverse the old asset deduction (if any), then apply the new one -
  // covers amount/account/payment-type all changing in the same edit.
  await applyAssetDelta(prevAccountId, prevPaymentType, prevAmount, +1);
  await applyAssetDelta(patch.account_id, patch.payment_type, amount, -1);
  await loadAssets();

  // Learning loop (README §3.5): on a category correction, remember keyword->category.
  if (categoryChanged && $("eLearn").checked) {
    const kw = learnKeyword(patch);
    if (kw) {
      await sb.from("category_rules").upsert(
        { keyword: kw, category: newCategory },
        { onConflict: "user_id,keyword" }
      );
      userRules[kw] = newCategory;
    }
  }
  $("editSave").disabled = false;
  $("editModal").classList.add("hidden"); editing = null;
  await loadExpenses(); toast(categoryChanged ? "Saved - I'll remember that" : "Saved ✓");
};

$("editDelete").onclick = async () => {
  if (!editing) return;
  if (!confirm("Delete this expense?")) return;
  const { error } = await sb.from("expenses").delete().eq("id", editing.id);
  if (error) return toast(error.message);
  await applyAssetDelta(editing.account_id, editing.payment_type, Number(editing.amount), +1);
  await loadAssets();
  $("editModal").classList.add("hidden"); editing = null;
  await loadExpenses(); toast("Deleted");
};

// ---- REPORTS ---------------------------------------------------------------
async function loadReports() {
  if (!allExpenses.length) await loadExpenses();
  // Build month selector from the last 12 months.
  const months = lastMonths(12).reverse(); // newest first for the dropdown
  const sel = $("monthSel");
  if (sel.options.length !== months.length) {
    sel.innerHTML = months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join("");
    sel.value = monthKey();
    sel.onchange = renderReports;
  }
  renderReports();
  loadInsights();
}

// Latest monthly report, generated server-side by tools/monthly-report.js.
// RLS-scoped: only the signed-in user's own rows are ever returned.
async function loadInsights() {
  const { data } = await sb.from("spending_insights").select("*").order("created_at", { ascending: false }).limit(1);
  const row = (data || [])[0];
  $("insightsBody").textContent = row ? row.report : "No monthly reports yet.";
  $("insightsBody").classList.toggle("muted", !row);
}

// ---- INTERACTIVE Q&A (Gemma, optional/best-effort like Phase 3) -----------
$("qaAskBtn").onclick = async () => {
  const question = $("qaQuestion").value.trim();
  if (!question) return toast("Type a question first");
  if (!GEMMA_ENDPOINT) {
    $("qaStatus").textContent = "Not configured - set GEMMA_ENDPOINT in config.js (SETUP.md §3.6).";
    return;
  }
  $("qaAskBtn").disabled = true;
  $("qaAnswer").classList.add("hidden");
  $("qaStatus").textContent = "🤔 thinking…";
  try {
    if (!allExpenses.length) await loadExpenses();
    const context = buildQaContext(allExpenses, subscriptions);
    const answer = await askGemma(question, context, { endpoint: GEMMA_ENDPOINT, model: GEMMA_MODEL });
    $("qaAnswer").textContent = answer;
    $("qaAnswer").classList.remove("hidden");
    $("qaStatus").textContent = "";
  } catch (err) {
    $("qaStatus").textContent = "Couldn't get an answer - is Gemma reachable? (" + err.message + ")";
  } finally {
    $("qaAskBtn").disabled = false;
  }
};

async function renderReports() {
  const ym = $("monthSel").value || monthKey();
  const byCat = sumBy(allExpenses, "category", ym);
  const byAcct = sumBy(allExpenses, "account", ym, acctName);
  const byPayment = sumBy(allExpenses, "payment_type", ym);
  const total = byCat.reduce((s, d) => s + d.value, 0);
  const subs = byCat.filter((d) => d.label === "Subscriptions").reduce((s, d) => s + d.value, 0);

  $("rptTotal").textContent = fmt(total);
  $("rptSubs").textContent = fmt(subs);

  const empty = total === 0;
  $("rptEmpty").classList.toggle("hidden", !empty);

  renderBreakdownBar($("catChart"), byCat);
  renderBreakdownBar($("acctChart"), byAcct);
  renderBreakdownBar($("payChart"), byPayment);
  const trailing = lastMonths(6, ym);
  renderTrendBar($("trendChart"), trailing, monthlyTotals(allExpenses, trailing));
}

// ---- SUBSCRIPTIONS (README §3.7 / F5) --------------------------------------
async function loadSubscriptions() {
  const { data, error } = await sb.from("subscriptions").select("*").order("next_renewal", { ascending: true });
  if (error) { $("subList").innerHTML = `<p class="muted">${error.message}</p>`; return; }
  subscriptions = data || [];
  renderSubscriptions();
  renderDeals();
  renderDealFindings();
  renderNetWorth();
}

// ---- DISCOUNT DISCOVERY (README §3.7 / F6) ---------------------------------
function renderDeals() {
  const deals = findDeals(subscriptions, catalog, profile);
  const upsells = studentUpsell(subscriptions, catalog, profile);
  const totalYearly = deals.reduce((s, d) => s + d.yearlySavings, 0);
  $("dealsTotal").textContent = totalYearly > 0 ? `up to ${fmt(totalYearly)}/yr` : "";

  const parts = [];

  for (const d of deals) {
    const link = d.url ? `<a href="${d.url}" target="_blank" rel="noopener" style="color:var(--accent)">view plan →</a>` : "";
    parts.push(`
      <div class="exp" style="cursor:default">
        <div>
          <div>${d.service} · <span style="color:var(--ok)">save ${fmt(d.monthlySavings)}/mo</span></div>
          <div class="meta">You pay ${fmt(d.currentMonthly)}/mo · ${d.planType} plan is ${fmt(d.planPrice)}/${d.planCycle === "annual" ? "yr" : "mo"}${d.eligibility ? " (" + d.eligibility + ")" : ""} ${link}</div>
        </div>
        <span class="amt" style="color:var(--ok)">${fmt(d.yearlySavings)}/yr</span>
      </div>`);
  }

  // Gentle student upsell if the user hasn't set student status.
  if (upsells.length) {
    const svc = upsells.map((u) => `${u.service} (${fmt(u.potentialYearly)}/yr)`).join(", ");
    parts.push(`
      <div class="exp" style="cursor:pointer;border-top:1px dashed var(--border)" id="upsellRow">
        <div>
          <div>🎓 Are you a student?</div>
          <div class="meta">Set your status to Student to unlock deals on: ${svc}. Tap to update your profile.</div>
        </div>
      </div>`);
  }

  if (!parts.length) {
    const hint = subscriptions.some((s) => s.is_active)
      ? "No cheaper eligible plans found for your current subscriptions. 👍"
      : "Add subscriptions to see cheaper eligible plans.";
    $("dealsList").innerHTML = `<p class="muted" style="font-size:13px">${hint}</p>`;
    return;
  }
  $("dealsList").innerHTML = parts.join("");
  const up = $("upsellRow");
  if (up) up.onclick = () => $("profileBtn").click();
}

// Machine-found deals (F6 stretch) - separate, clearly-labeled, unverified.
// Never blended into the trusted curated numbers above.
function renderDealFindings() {
  const card = $("dealFindingsCard");
  if (!card) return;
  if (!DEAL_FINDINGS_ENABLED) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");

  const activeNames = subscriptions.filter((s) => s.is_active).map((s) => s.name);
  const matches = dealFindings.filter((f) => activeNames.some((name) => matchService(name, f.service)));

  if (!matches.length) {
    $("dealFindingsList").innerHTML = `<p class="muted" style="font-size:13px">No live findings yet for your subscriptions.</p>`;
    return;
  }
  $("dealFindingsList").innerHTML = matches.map((f) => {
    const link = f.url ? `<a href="${f.url}" target="_blank" rel="noopener" style="color:var(--accent)">check source →</a>` : "";
    const price = f.price != null ? fmt(Number(f.price)) : "?";
    return `
      <div class="exp" style="cursor:default">
        <div>
          <div>${f.service}${f.plan_type ? " · " + f.plan_type : ""}</div>
          <div class="meta">${price}${f.eligibility ? " (" + f.eligibility + ")" : ""} ${link}</div>
        </div>
        <span class="amt muted" style="font-size:11px">${f.status === "verified" ? "✓ verified" : "unverified"}</span>
      </div>`;
  }).join("");
}

function renderSubscriptions() {
  const monthly = totalMonthly(subscriptions);
  $("subsTotalMonthly").textContent = fmt(monthly);
  $("subsTotalYearly").textContent = fmt(monthly * 12);

  // Upcoming renewals (next 30 days)
  const up = upcomingRenewals(subscriptions, 30);
  $("subUpcoming").innerHTML = up.length
    ? up.map((s) => `
      <div class="exp" data-sub="${s.id}">
        <div><div>${s.name}</div><div class="meta">${s.next_renewal} · ${renewalLabel(s.days)}${acctName(s.account_id) ? " · " + acctName(s.account_id) : ""}</div></div>
        <span class="amt">${fmt(s.amount)}${s.billing_cycle === "annual" ? "/yr" : "/mo"}</span>
      </div>`).join("")
    : `<p class="muted">None in the next 30 days.</p>`;

  // Full list (active first, then inactive)
  const sorted = [...subscriptions].sort((a, b) => (b.is_active - a.is_active) || a.name.localeCompare(b.name));
  $("subList").innerHTML = sorted.length
    ? sorted.map((s) => `
      <div class="exp" data-sub="${s.id}" style="${s.is_active ? "" : "opacity:.5"}">
        <div>
          <div>${s.name}${s.is_active ? "" : " · (inactive)"}</div>
          <div class="meta">${fmt(monthlyAmount(s))}/mo${s.billing_cycle !== "monthly" ? " (" + s.billing_cycle + ")" : ""}${s.next_renewal ? " · renews " + s.next_renewal : ""}</div>
        </div>
        <span class="amt">${fmt(s.amount)}</span>
      </div>`).join("")
    : `<p class="muted">No subscriptions yet - add one above.</p>`;

  document.querySelectorAll("[data-sub]").forEach((el) => {
    el.onclick = () => {
      const sub = subscriptions.find((x) => x.id === el.dataset.sub);
      if (sub) openSubForm(sub);
    };
  });
}

$("addSubBtn").onclick = () => openSubForm(null);
$("cancelSubBtn").onclick = closeSubForm;

function openSubForm(sub) {
  editingSub = sub;
  $("subFormTitle").textContent = sub ? "Edit subscription" : "New subscription";
  $("sName").value = sub?.name ?? "";
  $("sAmount").value = sub?.amount ?? "";
  $("sCycle").value = sub?.billing_cycle ?? "monthly";
  $("sRenewal").value = sub?.next_renewal ?? "";
  $("sAccount").value = sub?.account_id ?? "";
  $("sActive").checked = sub ? !!sub.is_active : true;
  $("sNotes").value = sub?.notes ?? "";
  $("deleteSubBtn").classList.toggle("hidden", !sub);
  $("subForm").classList.remove("hidden");
  $("subForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function closeSubForm() { $("subForm").classList.add("hidden"); editingSub = null; }

$("saveSubBtn").onclick = async () => {
  const name = $("sName").value.trim();
  const amount = parseFloat($("sAmount").value);
  if (!name) return toast("Service name required");
  if (!amount || amount <= 0) return toast("Enter a valid amount");
  const row = {
    name, amount,
    billing_cycle: $("sCycle").value,
    next_renewal: $("sRenewal").value || null,
    account_id: $("sAccount").value || null,
    is_active: $("sActive").checked,
    notes: $("sNotes").value.trim() || null,
  };
  $("saveSubBtn").disabled = true;
  const q = editingSub
    ? sb.from("subscriptions").update(row).eq("id", editingSub.id)
    : sb.from("subscriptions").insert(row);
  const { error } = await q;
  $("saveSubBtn").disabled = false;
  if (error) return toast(error.message);
  closeSubForm();
  await loadSubscriptions();
  toast(editingSub ? "Subscription updated" : "Subscription added");
};

$("deleteSubBtn").onclick = async () => {
  if (!editingSub) return;
  if (!confirm(`Delete ${editingSub.name}?`)) return;
  const { error } = await sb.from("subscriptions").delete().eq("id", editingSub.id);
  if (error) return toast(error.message);
  closeSubForm();
  await loadSubscriptions();
  toast("Subscription deleted");
};

// ---- PROFILE (README §1.2, feeds Phase 4 discount matching) ----------------
async function loadProfile() {
  // A profile row is auto-created on sign-up by the DB trigger; fetch it.
  const { data } = await sb.from("profiles").select("*").eq("id", userId).maybeSingle();
  profile = data || null;
}

function toggleStudentFields() {
  $("pStudentFields").classList.toggle("hidden", $("pStatus").value !== "student");
}
$("pStatus").onchange = toggleStudentFields;

$("profileBtn").onclick = () => {
  $("pName").value = profile?.display_name ?? "";
  $("pStatus").value = profile?.status ?? "other";
  $("pSchool").value = profile?.school ?? "";
  $("pGradYear").value = profile?.graduation_year ?? "";
  $("pNotes").value = profile?.notes ?? "";
  toggleStudentFields();
  $("profileModal").classList.remove("hidden");
};
$("profileClose").onclick = () => $("profileModal").classList.add("hidden");

$("profileSave").onclick = async () => {
  const isStudent = $("pStatus").value === "student";
  const gradRaw = parseInt($("pGradYear").value, 10);
  const row = {
    id: userId,
    display_name: $("pName").value.trim() || null,
    status: $("pStatus").value,
    school: isStudent ? ($("pSchool").value.trim() || null) : null,
    graduation_year: isStudent && Number.isFinite(gradRaw) ? gradRaw : null,
    notes: $("pNotes").value.trim() || null,
  };
  $("profileSave").disabled = true;
  const { error } = await sb.from("profiles").upsert(row, { onConflict: "id" });
  $("profileSave").disabled = false;
  if (error) return toast(error.message);
  profile = row;
  $("profileModal").classList.add("hidden");
  renderDeals(); // eligibility may have changed (e.g. now a student)
  toast("Profile saved");
};