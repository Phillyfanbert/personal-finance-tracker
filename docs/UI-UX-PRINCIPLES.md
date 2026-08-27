# UI/UX principles for this app

The design rules this app is held to, and the reasoning behind each one.

Every rule here is **checkable**: it either passes or fails on a given screen, with
no judgement call. That is deliberate. "Make it cleaner" is not a rule; "every
interactive target is at least 44x44 CSS pixels" is.

Rules come from four sources that agree with each other far more than they differ:

- **[Nielsen's 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)** (Nielsen Norman Group, 1994, unchanged since) - the most widely used UX checklist there is.
- **[WCAG 2.2](https://www.w3.org/TR/WCAG22/)** Level AA - the accessibility standard, and the one with actual legal force in most jurisdictions.
- **[Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)** - 44x44pt minimum target, unchanged since the first iPhone.
- **[Material Design](https://m3.material.io/)** - 48x48dp minimum target.

Where they disagree on a number, this document takes the stricter one and says so.

A note on scope: this app is a **private financial tracker used on a phone, mostly
as an installed home-screen icon, by people who are not assumed to know anything
about personal finance**. That shapes several rules below in ways that would be
wrong for a different product. Where a rule is ours rather than universal, it is
marked **[house rule]**.

---

## 1. Visibility of system status

> "The design should always keep users informed about what is going on, through
> appropriate feedback within a reasonable amount of time." - Nielsen #1

**1.1** Every action that changes data confirms it happened. No silent success.

**1.2** Every action that takes longer than ~1 second shows that it is working.
A button that submits gets `disabled` while the request is in flight, so it cannot
be double-fired and so the user can see it was received.

**1.3** **Loading, empty and error are three different states and must look
different.** This is the one most often collapsed. A grey "no data" line standing in
for a failed request tells the user their data is missing when in fact it failed to
load, and they will go looking for the wrong problem.

| State | Means | Must show |
|---|---|---|
| Loading | Request in flight | A clear in-progress cue |
| Empty | Request succeeded, nothing there | What this card is for and how to add the first item |
| Error | Request failed | That it failed, and what to do about it |

**1.4** Status that is currently selected must be visible without relying on colour
alone - see 6.3.

**1.5 [house rule]** Freshness is stated in words, not implied. A card built from
background data says when that data was last updated, and says so in a muted tone
rather than an alarming one: a partial run of a best-effort background job is the
ordinary case, not a fault.

---

## 2. Match between the system and the real world

> "The design should speak the users' language, with words, phrases, and concepts
> familiar to the user, rather than internal jargon." - Nielsen #2

**2.1 [house rule]** **Write for someone who has never had a budget.** Not a
simplified version of finance vocabulary - no assumed vocabulary at all. "Things you
owe", not "liabilities". "How often it arrives", not "cadence".

**2.2 [house rule]** When an industry term is genuinely useful to know, give the
plain description first and the term in brackets after: "Highest interest rate first
(avalanche)". The reader can then recognise the word elsewhere without needing it
here.

**2.3 [house rule]** **An internal identifier must never appear in visible text.**
A filename, a table name, a config flag. It means nothing to the reader and makes
the app look unfinished. Developer notes go in HTML comments.

**2.4 [house rule]** Explanations live behind the card's "i" icon, not in a
permanently visible paragraph. A short line saying what a card *is* may stay; a
paragraph teaching a concept moves.

**2.5** Labels describe the thing in the user's terms, not the database's. A field
storing `purchase_price` is labelled "What you paid", not "Purchase price", when the
latter would be ambiguous about per-share versus total.

---

## 3. User control and freedom

> "Users often perform actions by mistake. They need a clearly marked 'emergency
> exit'." - Nielsen #3

**3.1** Every destructive action is either **confirmed first or undoable after**.
Prefer undo: a confirmation dialog interrupts everyone to protect against a rare
mistake, whereas undo costs nothing until it is needed.

**3.2** Every action that puts data outside the app - a file download, a print
view, an export - confirms first. The consequence is not reversible once the file
exists, and on a shared device it is a real disclosure.

**3.3** Every modal can be dismissed three ways: its close button, the Escape key,
and a click on the backdrop. A modal that traps the user is a bug.

**3.4** Nothing that moves real money happens without the user initiating it in that
session. Background jobs may read and suggest; they may not act.

**3.5 [house rule]** A warning is a warning, not a block, when the app cannot be
certain. Age-eligibility for an account type is inferred from a birth *year* and is
therefore accurate only to within a year - it warns and lets the user proceed. A
balance going negative is arithmetic and is blocked outright.

---

## 4. Consistency and standards

> "Users should not have to wonder whether different words, situations, or actions
> mean the same thing." - Nielsen #4

**4.1** **One job, one control.** If two buttons do the same thing they look the
same, are named the same, and are the same size. Two "+ Add" buttons that both open
the same form must not be 37px and 28px tall.

**4.2** One visual treatment per interaction pattern. "Pick one of N" is one
component, not four.

**4.3** **Every value in the type scale, spacing scale and colour palette comes from
a token.** A one-off `font-size: 13.5px` or `padding: 7px 14px` is a bug, not a
refinement. See §9 for this app's scales.

**4.4** A repeated inline style is a missing class. If the same declaration appears
three or more times, it becomes a class.

**4.5** Platform conventions win over invention. A checkbox looks like a checkbox; a
link looks like a link; the back gesture goes back.

**4.6 [house rule]** No em dashes anywhere in code, comments, docs or UI strings.
No decorative emoji. Functional glyphs are fine.

---

## 5. Error prevention

> "Even better than good error messages is a careful design which prevents a problem
> from occurring in the first place." - Nielsen #5

**5.1** Required fields are marked **before** the user submits, not only after
rejection. This app uses a live red border that appears while a required field is
empty and clears the instant it is filled.

**5.2** **A silent no-op is the worst possible outcome.** If a control appears to
work but does nothing, say so. Two real money-losing bugs in this app came from
exactly this: a helper that floored at zero instead of refusing, and a picker that
offered accounts the delta helper could not act on. If an action cannot do what the
form promises, the form says which field is missing and what will happen without it.

**5.3** Constrain the input rather than validating it afterwards where you can: a
date picker over a typed date, a select over free text, a fixed list over a
free-text field that must match exactly.

**5.4** Destructive and constructive actions are not adjacent and do not look alike.
Delete is visually distinct and is never the default.

**5.5** Show the consequence before the commit. A confirmation names what will
happen in specifics ("This saves 14 transactions from Aug 2026 to your device"), not
in generalities ("Are you sure?").

---

## 6. Perceivable: colour, contrast and non-colour cues

**6.1 Text contrast (WCAG 1.4.3, AA).** Normal text at least **4.5:1** against its
background. Large text (18.66px bold, or 24px) at least **3:1**.

This app's palette, measured:

| Pair | Ratio | Verdict |
|---|---|---|
| `--text` `#e2e8f0` on `--panel` `#1e293b` | 11.87:1 | pass |
| `--text` on `--bg` `#0f172a` | 14.48:1 | pass |
| `--muted` `#94a3b8` on `--panel` (the app's most common pair) | 5.71:1 | pass |
| `--muted` on `--panel-2` `#273449` | 4.89:1 | pass |
| `--accent` `#38bdf8` on `--panel` | 6.83:1 | pass |
| `--err` `#f87171` on `--panel` | 5.29:1 | pass |
| `--ok` `#34d399` on `--panel` | 7.61:1 | pass |
| `--warn` `#fbbf24` on `--panel` | 8.76:1 | pass |
| `#002233` on `--accent-2` `#0ea5e9` (primary button) | 5.94:1 | pass |

The palette is sound. **Do not "improve" these colours without re-measuring** - they
were chosen to clear AA and they do.

**6.2 Non-text contrast (WCAG 1.4.11, AA).** UI component boundaries and meaningful
graphics need **3:1**. An input border the user must find in order to know where to
type is a UI boundary, not decoration.

White text on a coloured chip is the trap here. Measured against this app's eight
account colours, `#fff` fails every one (1.67:1 to 2.77:1) while the existing
`#002233` ink passes every one (5.94:1 to 9.85:1). **On a mid-tone accent fill, use
dark ink.**

**6.3 Never use colour as the only carrier of meaning (WCAG 1.4.1, A).** A red
number, an amber bar, a green dot - each needs a second channel: a sign, a word, an
icon, or a shape.

A useful test: **read the screen aloud with all colour removed.** If a fact
disappears, it was colour-only. A gain of `+5.2%` survives because the sign carries
it. "Prices as of 4 minutes ago" turning amber to mean *stale* does not survive, and
needs the word.

**6.4** Selected state is never colour alone. Add weight, a border, an underline, or
a checkmark - and the matching ARIA state (§8.4).

**6.5** Do not remove focus outlines. If the default ring is ugly, replace it with a
better one; never `outline: none` with nothing after it.

---

## 7. Operable: targets, input and motion

**7.1 Target size.** WCAG 2.2 SC 2.5.8 (AA) requires **24x24 CSS px**. Apple asks
**44x44pt**; Material asks **48x48dp**.

> **This app's rule: 44x44 CSS px minimum for any control, no exceptions on primary
> actions.** It is a phone-first app handling real money, where a mis-tap can log a
> wrong transaction. WCAG's 24px floor is the legal minimum, not a target worth
> aiming at.

The visible ink may be smaller than the target. A 17px "i" glyph is fine as long as
its tappable box is padded out to 44px.

**7.2 Spacing between targets.** Adjacent controls need at least 8px between their
tap boxes. WCAG 2.5.8 permits sub-24px targets only when spacing compensates; that
exception is not a licence to make things small.

**7.3 Everything reachable by pointer is reachable by keyboard.** A `<div onclick>`
with no `tabindex` and no key handler is invisible to keyboard and switch users.
Prefer a real `<button>` over `role="button" tabindex="0"` plus a keydown handler -
the native element gets Enter, Space, focus and the correct role for free.

**7.4 Focus order follows visual order.** If an element renders at the top of the
screen it belongs near the top of the DOM. A fixed-position nav placed last in
`<body>` is reached last by Tab, which is wrong.

**7.5 Focus is visible on every focusable element**, at 3:1 against its background
(WCAG 2.4.11).

**7.6 Modals manage focus**: move focus in on open, trap Tab inside while open,
restore focus to the trigger on close, and mark the background inert.

**7.7 Respect `prefers-reduced-motion`.** Vestibular disorders are common and
animation can cause real nausea. Under the media query, reduce transitions to near-
instant and drop smooth scrolling.

**7.8** Do not block zoom. No `user-scalable=no`, no `maximum-scale`.

---

## 8. Understandable: structure and semantics

**8.1 One `<h1>` per view, and headings in order** with no skipped levels. A card
title is a heading, not a bold span. Screen reader users navigate by heading list;
a page whose heading list has one entry is a page they cannot navigate.

**8.2 Landmarks.** `<nav>` for navigation, `<main>` for the primary content, exactly
one `<main>` per view. This is how a screen reader user skips to content.

**8.3 Every form control has a programmatically associated label** - `<label for=>`
pointing at the control's id, or `aria-label` where a visible label genuinely does
not fit. A placeholder is **not** a label: it disappears on focus, usually fails
contrast, and is lost to autofill.

**8.4 State is exposed to assistive tech, not just to CSS.**

| Pattern | Required |
|---|---|
| Current page in nav | `aria-current="page"` |
| Selected tab | `role="tab"` + `aria-selected` |
| Toggle button | `aria-pressed` |
| Expandable disclosure | `aria-expanded` + `aria-controls` |
| Invalid field | `aria-invalid` + `aria-describedby` pointing at the message |
| Dialog | `role="dialog"` + `aria-modal` + `aria-labelledby` |

**8.5 Dynamic content is announced.** Anything that appears without a page change -
a toast, an inline validation message, an async result - lives in or writes to a
live region. `role="status"` / `aria-live="polite"` for confirmations,
`role="alert"` for errors that interrupt.

**8.6 Every control has an accessible name that makes sense out of context.** A
screen reader can list every button on the page; six identical "+ Add" entries are
six unanswered questions. "✕", "i", "←" and "Set" are not names.

**8.7 Non-decorative images and graphics have text alternatives.** A chart that is
the only presentation of a number needs that number available as text. Decorative
graphics get `aria-hidden="true"`.

**8.8 Lists are lists.** A pile of sibling `<div>`s gives no item count and no item
boundaries. Tabular data with real columns is a `<table>` with headers.

---

## 9. This app's scales

Values outside these are bugs.

**Type.** Base is 16px. Body text is never below 14px. 12px and 11px are for
captions and metadata only - never for prose the user is expected to read.

| Token | Size | Use |
|---|---|---|
| `--fs-xs` | 12px | Captions, metadata, timestamps |
| `--fs-sm` | 14px | Secondary text, labels |
| `--fs-base` | 16px | Body, inputs, buttons |
| `--fs-lg` | 18px | Card titles |
| `--fs-xl` | 22px | Stat figures |
| `--fs-2xl` | 30px | The single headline figure on a view |

**Spacing.** A 4px base scale: 4, 8, 12, 16, 24, 32. Nothing else.

**Targets.** 44px minimum height for any control. 8px minimum gap between adjacent
targets.

**Radius.** 8px for controls, 12px for cards, 999px for pills.

---

## 10. Aesthetic and minimalist design

> "Interfaces should not contain information which is irrelevant or rarely needed.
> Every extra unit of information competes with the relevant units." - Nielsen #8

**10.1** If two cards answer the same question, merge them. This app has done this
twice: three breakdown charts became one card with tabs, and two "savings" cards
became one card with two labelled trust tiers.

**10.2** If a number is shown twice on one screen, one of them is noise - unless the
two genuinely differ, in which case say why, right there.

**10.3 [house rule]** Omit rather than fake. A card with nothing real behind it is
hidden, not filled with a placeholder zero. A statistic that cannot be computed
honestly is left out, not estimated and presented as fact.

**10.4** A page is not a container for every card that relates to its topic. When a
page exceeds roughly six cards, it is doing more than one job and should be split -
by tab, not by scroll.

---

## 11. Help and documentation

> "It's best if the system doesn't need any explanation." - Nielsen #10

**11.1** Help is available from every page, in a control that says "Help" in words.

**11.2** Help is collapsed by default with a visible table of contents. Thirty-eight
topics presented as a wall of text is not documentation.

**11.3 [house rule]** When adding a page or a significant card, its help entry and
its tour step ship **in the same change**. This is the only thing that stops the
documentation drifting.

**11.4 [house rule]** The first-run tour explains what things *are*, not only where
they are, and defines every term it uses. A step whose target is not currently on
screen is dropped rather than pointed at nothing.

---

## 12. Honesty

**[house rule, and the one that overrides the rest]**

**12.1** The app never states something it cannot establish. A headline shown beside
a price move is that day's *coverage*, never the *cause*.

**12.2** No fabricated composite scores. Real arithmetic shown back to the user is
fine; an invented "health score" presented as authoritative is not.

**12.3** **No personalised financial advice.** Show both payoff strategies and their
real numbers; never say which to choose. Show the allocation gap; never say what to
buy. This line is enforced in code, not only in copy.

**12.4** AI-written text is labelled as AI-written, so the reader never has to guess
which parts are measured and which are generated.

**12.5** Where a number rests on thin data, say how thin: "based on 1 month so far".

---

## Review checklist

For any new or changed screen:

- [ ] One `<h1>`; card titles are real headings; content is inside `<main>`
- [ ] Every control is at least 44x44 with 8px between neighbours
- [ ] Every control reachable and operable by keyboard, with a visible focus ring
- [ ] Every control has an accessible name that stands alone
- [ ] Every input has a `<label for=>`
- [ ] Loading, empty and error look different from each other
- [ ] Every denial names its field, marks it, and says what to do
- [ ] No meaning carried by colour alone (read it aloud in greyscale)
- [ ] Selected state exposed via ARIA, not just a CSS class
- [ ] Toasts and async results announced to assistive tech
- [ ] Destructive actions confirmed or undoable
- [ ] Type, spacing and colour all from tokens
- [ ] Words a first-timer understands; explanations behind the "i"
- [ ] Help entry and tour step updated in the same change
- [ ] No em dashes, no decorative emoji, no internal identifiers on screen
