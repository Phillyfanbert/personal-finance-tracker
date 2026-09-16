// ============================================================================
// Palette checker: WCAG contrast in every theme, plus colour-vision-deficiency
// separation for the identity palette.
//
// Run: node tools/check-palette.mjs
//
// It PARSES app/index.html rather than holding its own copy of the palette.
// A checker with its own copy passes forever while the app drifts underneath
// it, which is the failure this exists to prevent - so the only colour
// literals below are the two ink colours, which are themselves read back out
// of the stylesheet and asserted against it.
//
// Algorithms, named so the numbers can be defended or reproduced:
//   Contrast    WCAG 2.x relative luminance. Verified against the table in
//               docs/UI-UX-PRINCIPLES.md section 6.1: all 11 rows reproduce
//               exactly, which is what makes the values this prints
//               trustworthy rather than merely self-consistent.
//   CVD         Machado, Oliveira and Fernandes (2009), severity 1.0, applied
//               in linear RGB. The reference algorithm is Brettel, Vienot and
//               Mollon (1997); the common Vienot 1999 simplification models
//               tritanopia poorly, so if a tritan number ever has to be
//               defended, implement Brettel rather than Vienot.
//   Distance    CIEDE2000 in CIELAB under D65, the standard answer to "are
//               these two categorical colours distinguishable".
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : (fail++, console.log("  FAIL:", msg)); };
const section = (t) => console.log(`\n--- ${t} ---`);

// ---- colour maths -----------------------------------------------------------
const toRgb = (h) => {
  const s = h.replace("#", "").trim();
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const unlin = (c) => { c = Math.min(1, Math.max(0, c)); return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
const lum = (h) => { const [r, g, b] = toRgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
};

// Composites a translucent colour over an opaque one, because a scrim's real
// contrast is against what it actually paints, not against its own rgba.
const over = (rgba, base) => {
  const m = rgba.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\s*\)/);
  if (!m) return rgba;
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const base3 = toRgb(base);
  const mix = [r, g, b].map((c, i) => Math.round(c * a + base3[i] * (1 - a)));
  return "#" + mix.map((c) => c.toString(16).padStart(2, "0")).join("");
};

const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const simulate = (hexv, mode) => {
  if (mode === "normal") return hexv;
  const m = MACHADO[mode];
  const [r, g, b] = toRgb(hexv).map(lin);
  const out = m.map((row) => row[0] * r + row[1] * g + row[2] * b).map((v) => Math.round(unlin(v) * 255));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
};

const toLab = (hexv) => {
  const [r, g, b] = toRgb(hexv).map(lin);
  let X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  let Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [X, Y, Z] = [f(X), f(Y), f(Z)];
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
};
function deltaE00(h1, h2) {
  const [L1, a1, b1] = toLab(h1), [L2, a2, b2] = toLab(h2);
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const A1 = (1 + G) * a1, A2 = (1 + G) * a2;
  const Cp1 = Math.hypot(A1, b1), Cp2 = Math.hypot(A2, b2);
  const ang = (x, y) => { if (x === 0 && y === 0) return 0; const d = (Math.atan2(y, x) * 180) / Math.PI; return d < 0 ? d + 360 : d; };
  const hp1 = ang(A1, b1), hp2 = ang(A2, b2);
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = hp2 - hp1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh * Math.PI) / 360);
  const Lb = (L1 + L2) / 2, Cpb = (Cp1 + Cp2) / 2;
  let hb;
  if (Cp1 * Cp2 === 0) hb = hp1 + hp2;
  else { hb = (hp1 + hp2) / 2; if (Math.abs(hp1 - hp2) > 180) hb += hp1 + hp2 < 360 ? 180 : -180; }
  const T = 1 - 0.17 * Math.cos(((hb - 30) * Math.PI) / 180) + 0.24 * Math.cos((2 * hb * Math.PI) / 180)
    + 0.32 * Math.cos(((3 * hb + 6) * Math.PI) / 180) - 0.20 * Math.cos(((4 * hb - 63) * Math.PI) / 180);
  const Sl = 1 + (0.015 * Math.pow(Lb - 50, 2)) / Math.sqrt(20 + Math.pow(Lb - 50, 2));
  const Sc = 1 + 0.045 * Cpb, Sh = 1 + 0.015 * Cpb * T;
  const Rt = -2 * Math.sqrt(Math.pow(Cpb, 7) / (Math.pow(Cpb, 7) + Math.pow(25, 7)))
    * Math.sin((60 * Math.exp(-Math.pow((hb - 275) / 25, 2)) * Math.PI) / 180);
  return Math.sqrt(Math.pow(dL / Sl, 2) + Math.pow(dC / Sc, 2) + Math.pow(dH / Sh, 2) + Rt * (dC / Sc) * (dH / Sh));
}
const MODES = ["normal", "protan", "deutan", "tritan"];
function worstPair(palette) {
  const out = {};
  for (const mode of MODES) {
    let min = Infinity, pair = null;
    for (let i = 0; i < palette.length; i++) {
      for (let j = i + 1; j < palette.length; j++) {
        const d = deltaE00(simulate(palette[i], mode), simulate(palette[j], mode));
        if (d < min) { min = d; pair = [palette[i], palette[j]]; }
      }
    }
    out[mode] = { min: Math.round(min * 10) / 10, pair };
  }
  return out;
}

// ---- parse the stylesheet ---------------------------------------------------
const html = read("app/index.html");
const styleBlock = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

// Strips comments first: the :root blocks carry prose that contains hex
// literals, and counting those as declarations would report tokens nobody set.
const noComments = styleBlock.replace(/\/\*[\s\S]*?\*\//g, "");
function tokensIn(selector) {
  const at = noComments.indexOf(selector + " {");
  if (at < 0) return null;
  const body = noComments.slice(at + selector.length + 2, noComments.indexOf("}", at));
  const map = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map[m[1]] = m[2].trim();
  return map;
}
const darkTokens = tokensIn(":root");
const lightTokens = tokensIn(':root[data-theme="light"]');

console.log(`Read ${Object.keys(darkTokens || {}).length} tokens from :root`
  + (lightTokens ? `, ${Object.keys(lightTokens).length} from the light block` : ", no light block yet"));

// ---- A: the two blocks declare the same colour tokens ----------------------
section("A. Token parity between themes");
if (!lightTokens) {
  console.log("  (skipped: no light theme block yet)");
} else {
  // Which tokens MUST differ per theme is derived by exclusion, never from the
  // shape of their value. That distinction is the whole check: a value-shaped
  // test only recognises #hex/rgba(), so --shadow-card (which starts with a
  // length) and --lift (a bare number) both slipped through it. Deleting
  // --shadow-card from the light block used to PASS while every card in light
  // mode grew a 50%-black shadow. --lift had a hand-written special case;
  // deriving the set instead covers shadows, filters, gradients and whatever
  // comes next with no further entries.
  //
  // The scales (type, spacing, radius, target size) are identical in both
  // themes by definition, so they are the exclusion.
  const SCALE = (k) => /^--(fs|sp|r|target)-/.test(k);
  // Shared in both themes ON PURPOSE. Short and explicit, because adding to it
  // should be a deliberate act rather than a way to silence the check.
  //   --ink-on-series  rides the identity fills, which stay light in both
  //   --series-1..8    one account keeps one colour whichever theme is on
  const SHARED = (k) => k === "--ink-on-series" || /^--series-\d+$/.test(k);
  const varying = Object.keys(darkTokens).filter((k) => !SCALE(k) && !SHARED(k));
  const light = new Set(Object.keys(lightTokens));
  const missingInLight = varying.filter((k) => !light.has(k));
  const extraInLight = [...light].filter((k) => !(k in darkTokens));
  const wronglyShared = [...light].filter((k) => SHARED(k) || SCALE(k));
  ok(!missingInLight.length, `theme-varying tokens set in :root but not in the light block: ${missingInLight.join(", ")}`);
  ok(!extraInLight.length, `tokens set only in the light block: ${extraInLight.join(", ")}`);
  ok(!wronglyShared.length, `tokens meant to be theme-invariant are overridden in light: ${wronglyShared.join(", ")}`);
  if (!missingInLight.length && !extraInLight.length && !wronglyShared.length) {
    console.log(`  both themes declare the same ${varying.length} theme-varying tokens`);
    console.log(`  ${Object.keys(darkTokens).filter(SHARED).length} shared by design, ${Object.keys(darkTokens).filter(SCALE).length} scale tokens excluded`);
  }
}

// ---- B: WCAG contrast, every theme -----------------------------------------
section("B. WCAG contrast");
const themes = [["dark", darkTokens]];
if (lightTokens) themes.push(["light", { ...darkTokens, ...lightTokens }]);

for (const [name, t] of themes) {
  console.log(`\n  ${name} theme`);
  const surfaces = [["panel", t["--panel"]], ["panel-2", t["--panel-2"]], ["bg", t["--bg"]]];
  // 4.5:1 is WCAG 1.4.3 for normal text. Held against ALL three surfaces
  // rather than only --panel: the dark palette happens to clear --bg too, and
  // it is cheaper to hold the stronger invariant than to audit which token is
  // ever painted on which surface.
  for (const token of ["--text", "--muted", "--accent", "--accent-2", "--ok", "--err", "--warn"]) {
    if (!t[token]) continue;
    const rows = surfaces.map(([s, v]) => [s, ratio(t[token], v)]);
    const min = Math.min(...rows.map((r) => r[1]));
    ok(min >= 4.5, `${name}: ${token} is ${min}:1 at worst against a surface, needs 4.5`);
    console.log(`    ${min >= 4.5 ? "ok  " : "FAIL"} ${token.padEnd(16)} ${rows.map(([s, r]) => `${s} ${r}`).join("  ")}`);
  }
  // 3:1 is WCAG 1.4.11 for a UI component boundary and 2.4.11 for a focus ring.
  for (const token of ["--border-strong"]) {
    if (!t[token]) continue;
    const rows = surfaces.map(([s, v]) => [s, ratio(t[token], v)]);
    const min = Math.min(...rows.map((r) => r[1]));
    ok(min >= 3, `${name}: ${token} is ${min}:1 at worst, needs 3.0 as a control boundary`);
    console.log(`    ${min >= 3 ? "ok  " : "FAIL"} ${token.padEnd(16)} ${rows.map(([s, r]) => `${s} ${r}`).join("  ")}  (needs 3.0)`);
  }
  // Ink on a solid fill. --on-solid rides --accent-2 and --err, which both go
  // deep in light where dark ink fails; --ink-on-series rides the identity
  // fills, which are light in both themes so its ink never flips.
  for (const [ink, fill] of [["--on-solid", "--accent-2"], ["--on-solid", "--err"]]) {
    if (!t[ink] || !t[fill]) continue;
    const r = ratio(t[ink], t[fill]);
    ok(r >= 4.5, `${name}: ${ink} on ${fill} is ${r}:1, needs 4.5`);
    console.log(`    ${r >= 4.5 ? "ok  " : "FAIL"} ${ink} on ${fill}: ${r}`);
  }
  // --accent sits ON the washes as text: the selected nav tab and the Help
  // button both do it. An opaque wash in one theme and an alpha tint in the
  // other means this cannot be eyeballed from the token values.
  for (const wash of ["--accent-wash", "--accent-wash-2"]) {
    if (!t[wash] || !t["--accent"]) continue;
    const behind = over(t[wash], t["--panel"]);
    const r = ratio(t["--accent"], behind);
    ok(r >= 4.5, `${name}: --accent on ${wash} is ${r}:1, needs 4.5`);
    console.log(`    ${r >= 4.5 ? "ok  " : "FAIL"} --accent on ${wash}: ${r}`);
  }

  // A scrim's contrast is against what it composites to, not its own rgba.
  //
  // Judged on the WCAG ratio OR a raw luminance multiple, because the ratio
  // formula is the wrong instrument at the dark end: its +0.05 flare constant
  // compresses differences near black, so the dark sheet reads 1.36:1 while
  // actually sitting at 7.9x the scrim's luminance, which is obvious on
  // screen. The property being tested is "the sheet reads as a separate
  // surface", and in a light theme that is a contrast question while in a dark
  // one it is a brightness question. A white-veil scrim, the real mistake this
  // guards against, fails both.
  if (t["--scrim"] && t["--panel"]) {
    const behind = over(t["--scrim"], t["--bg"]);
    const r = ratio(t["--panel"], behind);
    const mult = Math.round((Math.max(lum(t["--panel"]), lum(behind)) / Math.max(lum(behind), 0.0001)) * 10) / 10;
    ok(r >= 3 || mult >= 3, `${name}: the modal sheet is ${r}:1 and ${mult}x the luminance of its own backdrop; needs 3:1 or 3x to read as a separate surface`);
    console.log(`    ${r >= 3 || mult >= 3 ? "ok  " : "FAIL"} sheet vs scrim: ${r}:1, ${mult}x luminance  (scrim composites to ${behind})`);
  }
  // The tour ring has to hold against BOTH the undimmed content inside the
  // hole and the dimmed surround outside it, which is why a halo exists.
  if (t["--scrim-strong"] && t["--accent"]) {
    const surround = over(t["--scrim-strong"], t["--bg"]);
    const halo = t["--spot-halo"] && t["--spot-halo"] !== "transparent" ? t["--spot-halo"] : null;
    const outer = halo ? ratio(halo, surround) : ratio(t["--accent"], surround);
    ok(outer >= 3, `${name}: the tour spotlight ring is ${outer}:1 against the dimmed surround, needs 3.0`);
    console.log(`    ${outer >= 3 ? "ok  " : "FAIL"} tour ring vs surround: ${outer}${halo ? " (via halo)" : ""}`);
  }
}

// ---- C: colour vision deficiency -------------------------------------------
section("C. Colour vision deficiency (Machado 2009, CIEDE2000)");

// The floor is calibrated to what the shipped palette actually measures rather
// than to a round number, so it catches a regression instead of blessing one.
const SERIES_FLOOR = 7.0;

const seriesTokens = Object.keys(darkTokens).filter((k) => /^--series-\d+$/.test(k))
  .sort((a, b) => Number(a.split("-")[2]) - Number(b.split("-")[2]));
const identityPalettes = [];
if (seriesTokens.length) {
  identityPalettes.push(["--series tokens", seriesTokens.map((k) => darkTokens[k])]);
} else {
  // Before the tokens exist the palettes still live in JS. Checking them where
  // they are is what lets this script fail honestly on the current code.
  const acct = read("app/app.js").match(/const ACCT_COLORS = \[([^\]]+)\]/);
  if (acct) identityPalettes.push(["ACCT_COLORS (app.js)", acct[1].match(/#[0-9a-f]{6}/gi) || []]);
  const pal = read("app/charts.js").match(/const PALETTE = \[([^\]]+)\]/);
  if (pal) identityPalettes.push(["PALETTE (charts.js)", pal[1].match(/#[0-9a-f]{6}/gi) || []]);
}

for (const [label, palette] of identityPalettes) {
  console.log(`\n  ${label} (${palette.length} colours)`);
  const w = worstPair(palette);
  for (const mode of MODES) {
    const { min, pair } = w[mode];
    ok(min >= SERIES_FLOOR, `${label}: ${mode} min dE00 ${min} is below ${SERIES_FLOOR} (${pair.join(" / ")})`);
    console.log(`    ${min >= SERIES_FLOOR ? "ok  " : "FAIL"} ${mode.padEnd(7)} min dE00 ${String(min).padStart(5)}   worst ${pair.join(" / ")}`);
  }
  // The ink has to stay readable on every identity fill in every theme, which
  // is the constraint that stops the palette drifting darker over time.
  const ink = darkTokens["--ink-on-series"];
  if (ink) {
    const worst = Math.min(...palette.map((c) => ratio(ink, c)));
    ok(worst >= 4.5, `${label}: --ink-on-series is ${worst}:1 on the worst fill, needs 4.5`);
    console.log(`    ${worst >= 4.5 ? "ok  " : "FAIL"} ink-on-series worst fill: ${worst}`);
  }
}

// err and warn sit next to each other constantly (a budget bar, a cycle line),
// so they are the one semantic pair worth holding to a separation floor.
for (const [name, t] of themes) {
  if (!t["--err"] || !t["--warn"]) continue;
  const d = Math.round(deltaE00(simulate(t["--err"], "deutan"), simulate(t["--warn"], "deutan")) * 10) / 10;
  ok(d >= 15, `${name}: --err and --warn are dE00 ${d} apart under deuteranopia, needs 15`);
  console.log(`    ${d >= 15 ? "ok  " : "FAIL"} ${name}: err vs warn under deuteranopia: ${d}`);
}

// ---- E: a progress fill against its own track -------------------------------
// WCAG 1.4.11: a graphic you have to decode needs 3:1. A bar's fill says how
// full it is only if it is distinguishable from the track behind it, and this
// caught a real failure by hand before it was a check: a bucket bar was filled
// with the bucket's IDENTITY colour, and --series-2 measures 1.22:1 against
// --panel-2 in light, which is no bar at all.
//
// The identity palette is deliberately NOT held to this. Those eight hues are
// tuned in section C to separate from EACH OTHER under colour vision
// deficiency, and they are only ever painted as adjacent segments of a stacked
// bar that always sums to 100%, so the track is never exposed behind them.
// Status tones are the ones that sit on an exposed track, so they are the ones
// measured here.
const appJsForFills = read("app/app.js");
section("E. Progress fills against their track (WCAG 1.4.11, 3:1)");
const FILL_FLOOR = 3.0;
const TRACKS = ["--panel-2", "--panel"];
const STATUS_FILLS = ["--ok", "--warn", "--err"];
for (const [name, T] of themes) {
  for (const fill of STATUS_FILLS) {
    for (const track of TRACKS) {
      if (!T[fill] || !T[track]) continue;
      const r = ratio(T[fill], T[track]);
      ok(r >= FILL_FLOOR, `${name}: ${fill} on ${track} is ${r.toFixed(2)}:1, below ${FILL_FLOOR}`);
      if (r >= FILL_FLOOR) console.log(`  ${name.padEnd(5)} ${fill.padEnd(7)} on ${track.padEnd(9)} ${r.toFixed(2)}:1`);
    }
  }
}
// The rule this encodes, so a future edit cannot quietly undo the fix: a bar
// whose track is visible must be filled from the status tones, never from the
// identity palette.
//
// Written as a scan over EVERY budget bar rather than a match on one
// function. The first version keyed off the split row's own `const tone =`
// line, so deleting that row deleted its guard with it: the suite dropped
// from 55 assertions to 54 and still reported "0 failed", which is the
// checker-agrees-with-a-drifting-app failure this file exists to prevent. A
// scan that finds nothing is now itself a failure.
const barFills = [...appJsForFills.matchAll(/class="budget-bar"[\s\S]{0,240}?background:([^;"]+)/g)]
  .map((m) => m[1].trim());
ok(barFills.length > 0, "found no budget bar fills to check - the scan pattern has gone stale");
for (const expr of barFills) {
  // Either an inline var(--x) or a ${name} referring to a const above it.
  const ref = /^\$\{([A-Za-z0-9_$.]+)\}?$/.exec(expr);
  let resolved = expr;
  if (ref) {
    const decl = new RegExp(`const ${ref[1]}\\s*=([^;]*);`).exec(appJsForFills);
    ok(decl, `cannot find where the budget bar fill \`${ref[1]}\` is defined`);
    resolved = decl ? decl[1] : expr;
  }
  ok(!/--series-\d/.test(resolved),
    `a budget bar fill uses an identity colour (${expr}); it must use a status tone (see above)`);
}
console.log(`  ${barFills.length} budget bar fill(s) come from status tones, not the identity palette`);

// ---- D: drift guards --------------------------------------------------------
section("D. Drift guards");
const appJs = read("app/app.js");

// The theme key is a literal in two files because the head script cannot
// import. If they disagree the app forgets the choice on every load.
const headKey = html.match(/localStorage\.getItem\("([^"]+)"\)\s*===\s*"light"/);
const appKey = appJs.match(/const THEME_KEY = "([^"]+)"/);
if (headKey || appKey) {
  ok(headKey && appKey && headKey[1] === appKey[1],
    `the theme storage key differs: head script has ${headKey?.[1]}, app.js has ${appKey?.[1]}`);
  if (headKey && appKey && headKey[1] === appKey[1]) console.log(`  theme key agrees in both files: "${headKey[1]}"`);
} else {
  console.log("  (skipped: no theme key yet)");
}

// Every colour belongs to a token (UI-UX-PRINCIPLES rule 4.3). Outside the
// :root blocks a literal is a value one theme cannot override.
const rootBlocks = [...noComments.matchAll(/:root(?:\[data-theme="[^"]+"\])?\s*\{[^}]*\}/g)].map((m) => m[0]);
let rules = noComments;
for (const b of rootBlocks) rules = rules.replace(b, "");
const strays = [...rules.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)].map((m) => m[0]);
ok(!strays.length, `colour literals outside the :root blocks: ${[...new Set(strays)].join(", ")}`);
if (!strays.length) console.log("  no colour literals in CSS rules; every colour comes from a token");

// Placeholders inherit the BROWSER's grey when no rule names them, and that
// default fails 1.4.3 on both of this app's control surfaces: it measured
// 4.10:1 in light and 2.72:1 in dark across all 50 of them. The failure is
// invisible to a token-pair check because no token is involved until a rule
// exists, so the guard is that the rule exists and uses a token.
const phRule = noComments.match(/::placeholder\s*(?:,[^{]*)?\{([^}]*)\}/);
ok(!!phRule, "no ::placeholder rule: every placeholder falls back to the browser grey, which fails AA in both themes");
if (phRule) {
  const usesToken = /var\(--[a-z0-9-]+\)/.test(phRule[1]);
  ok(usesToken, `::placeholder does not take its colour from a token: ${phRule[1].trim()}`);
  if (usesToken) console.log("  ::placeholder colour comes from a token, not the browser default");
}

// A theme change users never receive looks like a change that did not work.
const cache = read("app/sw.js").match(/const CACHE = "([^"]+)"/);
console.log(`  service worker cache: ${cache ? cache[1] : "not found"} (bump this when index.html or a module changes)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
