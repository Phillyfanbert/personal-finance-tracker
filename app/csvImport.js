// ============================================================================
// CSV expense-history import. Pure, unit-testable - same style as
// budgets.js/investments.js. Actual file reading and PapaParse invocation
// live in app.js (DOM/File API work); this module only turns already-
// parsed rows into normalized expense objects, plus the small heuristics
// (column guessing, sign convention, duplicate flagging) that benefit from
// being tested against constructed fixtures before ever touching real data.
//
// Deliberately conservative on dates: a wrong guess on a financial date is
// worse than refusing to import that row, so parseFlexibleDate only
// recognizes ISO (YYYY-MM-DD) and US slash (M/D/YYYY or M/D/YY) formats -
// no native Date() fallback, which parses inconsistently across formats/
// locales and can silently produce a wrong date instead of failing loudly.
// ============================================================================

/** @returns {string|null} "YYYY-MM-DD", or null if unrecognized/invalid. */
export function parseFlexibleDate(str) {
  const s = (str || "").trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return isValidYmd(y, m, d) ? `${y}-${m}-${d}` : null;
  }

  // Year-first with slashes or dots: unambiguous, since a 4-digit year can
  // only be the year. Handled before the day/month forms below for that
  // reason.
  const isoish = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (isoish) {
    const [, y, m, d] = isoish;
    return isValidYmd(y, m.padStart(2, "0"), d.padStart(2, "0"))
      ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : null;
  }

  // Compact YYYYMMDD, which some bank exports use for a sortable column.
  // Anchored to exactly 8 digits so it cannot swallow an amount or an id.
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const [, y, m, d] = compact;
    return isValidYmd(y, m, d) ? `${y}-${m}-${d}` : null;
  }

  // Month NAME forms, in either order. A name removes the day/month
  // ambiguity entirely, which is why both orders are safe to accept here
  // while a numeric "09/03" still has to pick a convention.
  const named = s.match(/^(?:(\d{1,2})[\s-]+([A-Za-z]{3,})|([A-Za-z]{3,})[\s-]+(\d{1,2}))[,\s]+(\d{4})$/);
  if (named) {
    const day = named[1] || named[4];
    const monthName = (named[2] || named[3]).slice(0, 3).toLowerCase();
    const y = named[5];
    const idx = ["jan", "feb", "mar", "apr", "may", "jun",
                 "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(monthName);
    if (idx >= 0) {
      const m = String(idx + 1).padStart(2, "0");
      const d = day.padStart(2, "0");
      return isValidYmd(y, m, d) ? `${y}-${m}-${d}` : null;
    }
    return null;
  }

  // Day/month/year with either separator. A slash and a dash carry the same
  // meaning in every export that uses them, so they share one branch and one
  // US-order convention rather than the dash form being rejected outright,
  // which is what silently skipped every row of an otherwise fine file.
  const numeric = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (numeric) {
    let [, m, d, y] = numeric;
    // 2-digit year pivot: this app is for recent expense history, not
    // decades-old records, so treat every 2-digit year as 20YY.
    if (y.length === 2) y = "20" + y;
    m = m.padStart(2, "0");
    d = d.padStart(2, "0");
    return isValidYmd(y, m, d) ? `${y}-${m}-${d}` : null;
  }

  return null;
}
// Checks the day against the REAL length of that month, not a flat 1-31.
// The range-only version accepted 30 February and 29 February in a non-leap
// year, so a typo or a malformed export created an expense dated to a day
// that does not exist. Constructing the date and reading it back is the
// cheapest way to be right about leap years without a rule of our own:
// if any component comes back different, the date was not real.
function isValidYmd(y, m, d) {
  const yi = Number(y), mi = Number(m), di = Number(d);
  if (!Number.isInteger(yi) || !Number.isInteger(mi) || !Number.isInteger(di)) return false;
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return false;
  // UTC, so this cannot shift a day in a timezone west of Greenwich.
  const dt = new Date(Date.UTC(yi, mi - 1, di));
  return dt.getUTCFullYear() === yi && dt.getUTCMonth() === mi - 1 && dt.getUTCDate() === di;
}

/**
 * Handles "$1,234.56", "(123.45)" (accounting negative notation), and a
 * plain "-123.45" - returns null (not 0) for anything that isn't a real
 * number, so a garbage cell skips the row rather than importing $0.
 * @returns {number|null}
 */
// A lone separator followed by exactly three digits is the one shape neither
// convention can claim on its own: "1.234" is 1.234 in the US and 1234 in
// Europe, and "1,234" is the reverse. No amount of looking at that ONE value
// resolves it. A whole column does, which is why the convention is decided
// per FILE and passed in - a single "1.234,56" or "1,234.56" anywhere in the
// column proves which side the file is on, because a value carrying BOTH
// separators is unambiguous (the later one is the decimal).
const AMBIGUOUS_RE = /^\d+[.,]\d{3}$/;

function conventionOf(body) {
  const lastComma = body.lastIndexOf(",");
  const lastDot = body.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) return lastComma > lastDot ? "eu" : "us";
  if (AMBIGUOUS_RE.test(body)) return null;
  if (lastComma > -1 && /,\d{1,2}$/.test(body)) return "eu";
  if (lastDot > -1 && /\.\d{1,2}$/.test(body)) return "us";
  return null;
}

/**
 * Decide whether a column of raw amount strings is written US or European
 * style. Only values that state it unambiguously get a vote; the ambiguous
 * three-digit shape abstains rather than guessing, which is the whole point.
 * Returns null when the column carries no evidence either way, and callers
 * then keep the US default - the same behaviour as before this existed, so a
 * file that imports correctly today still does.
 */
export function detectNumberConvention(values) {
  let eu = 0;
  let us = 0;
  for (const v of values) {
    const body = String(v ?? "").trim().replace(/[()$\s-]/g, "").replace(/[A-Za-z]{3}$/, "");
    if (!body) continue;
    const c = conventionOf(body);
    if (c === "eu") eu++;
    else if (c === "us") us++;
  }
  if (eu === us) return null;
  return eu > us ? "eu" : "us";
}

export function parseAmount(str, convention = null) {
  const s = (str || "").trim();
  if (!s) return null;
  const negParens = /^\(.*\)$/.test(s);
  // Strip currency/space/parens but NOT the separators yet - which of "," and
  // "." is the decimal point has to be decided first.
  let body = s.replace(/[()$\s]/g, "").replace(/[A-Za-z]{3}$/, "");
  // A trailing minus is how some bank exports mark a debit ("45.00-"). Stripped
  // BEFORE the separator convention is decided, and that order is load-bearing:
  // the lone-comma test below is anchored to the end of the string, so with the
  // minus still attached "50,00-" failed it, the comma was read as a thousands
  // separator, and a 50.00 debit imported as 5000 - a silent 100x error on a
  // real European export. "1.234,56-" happened to survive because it matches
  // the other branch, which is why this went unnoticed.
  const trailingMinus = /-$/.test(body);
  if (trailingMinus) body = body.slice(0, -1);
  const lastComma = body.lastIndexOf(",");
  const lastDot = body.lastIndexOf(".");
  // European convention: the comma is the decimal separator, e.g. "1.234,56"
  // or "1234,56". Detected by the comma coming AFTER the last period, or by a
  // lone comma followed by exactly two digits. Blindly stripping commas the
  // US way turned "1.234,56" into 1.23456 and "1234,56" into 123456 - a
  // silent 1000x error on a real bank export, with no warning anywhere.
  // An ambiguous value defers to the file's own convention when one was
  // established; with none, it keeps the US reading it has always had.
  const commaIsDecimal = AMBIGUOUS_RE.test(body)
    ? convention === "eu" && lastComma > -1
    : (lastComma > -1 && lastDot > -1 && lastComma > lastDot) ||
      (lastComma > -1 && lastDot === -1 && /,\d{1,2}$/.test(body));
  // "1.234" in a European file is 1234, so the period is a thousands
  // separator there and has to go the same way a comma does in a US file.
  const dotIsThousands = AMBIGUOUS_RE.test(body) && convention === "eu" && lastDot > -1;
  if (commaIsDecimal) {
    body = body.replace(/\./g, "").replace(",", ".");
  } else if (dotIsThousands) {
    body = body.replace(/\./g, "");
  } else {
    body = body.replace(/,/g, "");
  }
  if (!body) return null;
  const n = Number(body);
  if (!Number.isFinite(n)) return null;
  const magnitude = negParens || trailingMinus ? -Math.abs(n) : n;
  return magnitude;
}

// Ordered most-specific first: "transaction date" should win over a bare
// "date" when a file has both, and "original description" over "name".
// Widened well past the original four-keyword list because the mapping step
// is the part of an import a person is most likely to get wrong or give up
// on - every header matched here is one fewer dropdown they have to set.
const FIELD_KEYWORDS = {
  dateCol: ["transaction date", "posted date", "posting date", "value date",
    "date posted", "completed date", "started date", "date"],
  amountCol: ["transaction amount", "amount debited", "amount", "value", "sum", "total"],
  descCol: ["original description", "transaction description", "description",
    "merchant", "payee", "narrative", "reference", "details", "memo", "notes", "name"],
  categoryCol: ["category", "transaction category", "type of transaction"],
};

// A very common bank shape is two amount columns rather than one signed
// one: money out in "Debit"/"Withdrawal", money in "Credit"/"Deposit".
// Detecting that pair is the single biggest setup win for real bank files -
// without it the user has to pick one column and silently loses every row
// of the other kind.
const DEBIT_KEYWORDS = ["debit", "withdrawal", "withdrawals", "money out", "paid out", "spent", "charge"];
const CREDIT_KEYWORDS = ["credit", "deposit", "deposits", "money in", "paid in", "received"];

const matchIdx = (lower, keywords, used) => {
  for (const k of keywords) {
    const exact = lower.findIndex((h, i) => !used.has(i) && h === k);
    if (exact !== -1) return exact;
  }
  for (const k of keywords) {
    const partial = lower.findIndex((h, i) => !used.has(i) && h.includes(k));
    if (partial !== -1) return partial;
  }
  return -1;
};

/**
 * Best-guess header -> column-index mapping from common export header
 * names. A field stays null if nothing matches - the mapping UI shows
 * that as unset rather than silently guessing wrong. Never assigns the
 * same column to two fields.
 * `debitCol`/`creditCol` are set only when the file has a SEPARATE
 * money-out and money-in column, in which case `amountCol` is left null and
 * normalizeRow() reads the pair instead.
 * @param {string[]} headers
 * @returns {{dateCol:number|null, amountCol:number|null, descCol:number|null, categoryCol:number|null, debitCol:number|null, creditCol:number|null}}
 */
/**
 * Does this row look like DATA rather than a header? Used to catch a file
 * that has no header row at all - Wells Fargo exports this way, and treating
 * its first line as a header silently ate a real transaction while leaving
 * every column unmapped.
 */
export function looksLikeDataRow(row) {
  if (!Array.isArray(row) || !row.length) return false;
  return row.some((c) => parseFlexibleDate(c) !== null)
      && row.some((c) => parseAmount(c) !== null);
}

// Which column holds what, judged from the VALUES when the names did not
// say. A headerless file has no names to match, and a file with names in a
// language this list does not cover is the same problem - the data is the
// one thing every file has.
function inferFromContent(rows, used) {
  const cols = Math.max(0, ...rows.map((r) => r.length));
  const sample = rows.slice(0, 30);
  const score = (i, fn) => sample.filter((r) => fn(r[i])).length / (sample.length || 1);
  const best = (fn, min) => {
    let bestIdx = -1, bestScore = min;
    for (let i = 0; i < cols; i++) {
      if (used.has(i)) continue;
      const sc = score(i, fn);
      if (sc > bestScore) { bestScore = sc; bestIdx = i; }
    }
    return bestIdx;
  };
  // Thresholds are deliberately high: guessing a column wrong is worse than
  // leaving it for the user to pick, because the mapping step already exists
  // and a wrong guess silently imports the wrong field.
  return {
    date: best((c) => parseFlexibleDate(c) !== null, 0.8),
    amount: best((c) => parseAmount(c) !== null, 0.8),
    desc: best((c) => typeof c === "string" && c.trim().length > 2
      && parseAmount(c) === null && parseFlexibleDate(c) === null, 0.6),
  };
}

export function guessColumnMapping(headers, rows = []) {
  const lower = headers.map((h) => (h || "").toLowerCase().trim());
  const used = new Set();
  const mapping = {
    dateCol: null, amountCol: null, descCol: null, categoryCol: null,
    debitCol: null, creditCol: null,
  };

  // Date and description first, so an "amount" guess can never consume the
  // column a more specific field wanted.
  for (const field of ["dateCol", "descCol", "categoryCol"]) {
    const idx = matchIdx(lower, FIELD_KEYWORDS[field], used);
    if (idx !== -1) { mapping[field] = idx; used.add(idx); }
  }

  // The two-column shape wins over a single amount column when BOTH halves
  // are present - a file with only a "Debit" column is a single-column file
  // whose header happens to be called Debit, not a pair.
  const debit = matchIdx(lower, DEBIT_KEYWORDS, used);
  const credit = matchIdx(lower, CREDIT_KEYWORDS, used);
  if (debit !== -1 && credit !== -1) {
    mapping.debitCol = debit; used.add(debit);
    mapping.creditCol = credit; used.add(credit);
    return mapping;
  }

  const amount = matchIdx(lower, FIELD_KEYWORDS.amountCol, used);
  if (amount !== -1) { mapping.amountCol = amount; used.add(amount); }
  else if (debit !== -1) { mapping.amountCol = debit; used.add(debit); }

  // Fall back to the values only for what the names did not resolve, so a
  // file with good headers is never second-guessed by a content sniff.
  if (rows.length && (mapping.dateCol == null || mapping.amountCol == null)) {
    const guess = inferFromContent(rows, used);
    if (mapping.dateCol == null && guess.date !== -1) {
      mapping.dateCol = guess.date; used.add(guess.date);
    }
    if (mapping.amountCol == null && mapping.debitCol == null && guess.amount !== -1
        && guess.amount !== mapping.dateCol) {
      mapping.amountCol = guess.amount; used.add(guess.amount);
    }
    if (mapping.descCol == null && guess.desc !== -1 && !used.has(guess.desc)) {
      mapping.descCol = guess.desc; used.add(guess.desc);
    }
  }
  return mapping;
}

/**
 * Most bank/Mint-style exports show a spent amount as negative; a few show
 * it as a plain positive "Debit" column. If most parsed amounts in this
 * file are negative, assume "negative = spent" so the sign gets flipped to
 * this app's positive-expense convention. Always shown as an overridable
 * checkbox in the UI, never applied silently.
 * @param {string[][]} rows raw rows (not yet normalized)
 * @param {{amountCol:number|null}} mapping
 */
export function guessSignConvention(rows, mapping, convention = null) {
  if (mapping.amountCol == null) return false;
  let negatives = 0, total = 0;
  for (const row of rows) {
    const n = parseAmount(row[mapping.amountCol], convention);
    if (n == null) continue;
    total++;
    if (n < 0) negatives++;
  }
  return total > 0 && negatives / total > 0.5;
}

/**
 * One raw CSV row + the confirmed column mapping -> a normalized expense,
 * or null if the date/amount don't parse (skipped, not guessed).
 * @param {string[]} rawRow
 * @param {object} mapping from guessColumnMapping()
 * @param {{flipSign?: boolean, rowKind?: "expense"|"income"|"auto"}} [options]
 *   rowKind "auto" reads the direction from each row's own sign; the other
 *   two force it, and skip rows pointing the other way.
 * @returns {{occurred_at:string, amount:number, description:string|null,
 *   category:string|null, kind:"expense"|"income"}|null}
 */
export function normalizeRow(rawRow, mapping, { flipSign = false, rowKind = "expense", convention = null } = {}) {
  if (mapping.dateCol == null) return null;
  const occurred_at = parseFlexibleDate(rawRow[mapping.dateCol]);
  if (occurred_at == null) return null;

  // Two shapes. A separate debit/credit pair states the direction by which
  // column the value is in, so it needs no sign convention and no guessing;
  // a single amount column carries the direction in its sign.
  let signed = null;
  if (mapping.debitCol != null || mapping.creditCol != null) {
    const out = mapping.debitCol != null ? parseAmount(rawRow[mapping.debitCol], convention) : null;
    const inn = mapping.creditCol != null ? parseAmount(rawRow[mapping.creditCol], convention) : null;
    // A row normally fills exactly one of the two; the other is blank or 0.
    if (out != null && Math.abs(out) > 0) signed = Math.abs(out);
    else if (inn != null && Math.abs(inn) > 0) signed = -Math.abs(inn);
    else return null;
  } else {
    if (mapping.amountCol == null) return null;
    const raw = parseAmount(rawRow[mapping.amountCol], convention);
    if (raw == null) return null;
    signed = flipSign ? -raw : raw;
  }

  // After the step above, POSITIVE always means money out and NEGATIVE money
  // in, whichever shape the file had. rowKind then decides what to do with
  // that: "expense"/"income" force every row one way (the common case - a
  // file that is all one thing), while "auto" trusts the sign, which is what
  // a full bank statement needs.
  const kind = rowKind === "auto" ? (signed < 0 ? "income" : "expense") : rowKind;
  if (rowKind === "expense" && signed < 0) return null;  // money in, skipped
  if (rowKind === "income" && signed > 0) return null;   // money out, skipped

  const amount = Math.abs(signed);
  if (amount === 0) return null;
  const description = mapping.descCol != null ? (rawRow[mapping.descCol] || "").trim() || null : null;
  const category = mapping.categoryCol != null ? (rawRow[mapping.categoryCol] || "").trim() || null : null;
  return { occurred_at, amount, description, category, kind };
}

/**
 * Same date + amount (within a cent) + a case-insensitive description/
 * merchant match against an already-loaded expense - flagged for the user
 * to review, never auto-dropped, since a false positive silently skipping
 * a real expense would be worse than a false positive the user un-checks.
 * @param {{occurred_at:string, amount:number, description:string|null}} row
 * @param {object[]} existingExpenses rows from the `expenses` table
 */
export function isLikelyDuplicate(row, existingExpenses) {
  const desc = (row.description || "").toLowerCase().trim();
  return existingExpenses.some((e) =>
    e.occurred_at === row.occurred_at &&
    // Compared as whole CENTS, not as a float tolerance. The previous test
    // was Math.abs(a - b) < 0.01, and floating point makes that quietly
    // wrong at exactly the boundary it was written for: 50.01 - 50.00 is
    // 0.009999999999990905, which passes, so two charges a cent apart were
    // called duplicates. Amounts here are already money to two places, so
    // rounding to an integer is exact rather than a tolerance at all.
    Math.round(Number(e.amount) * 100) === Math.round(row.amount * 100) &&
    (e.description || e.merchant || "").toLowerCase().trim() === desc
  );
}
