// Curated reference list of consumer credit card PRODUCTS, so an account can
// say which card it is ("Chase Sapphire Preferred") instead of only which
// bank issued it. Purely a naming convenience, the same job bankNames.js
// does for institutions and tickers.js does for securities.
//
// NAME, ISSUER AND NETWORK ONLY - no annual fee, no rewards rate, no APR,
// and that is a deliberate boundary rather than an unfinished one. Two
// separate reasons:
//
//   1. Those fields go stale in a way a name does not. A card's name is
//      stable for years; its fee and rewards structure change on the
//      issuer's schedule with no notice. CONTRIBUTION_LIMIT_GROUPS already
//      shows how that ends - it ran an entire tax year on last year's
//      figures because a hardcoded number looked permanent. A wrong annual
//      fee here would quietly distort safeToSpend() and every budget under
//      it.
//   2. Storing rewards rates makes "you would have earned more on your
//      other card" the obvious next feature, and that is recommending a
//      financial product. It is the same line the credit-utilization line
//      refuses to cross by not saying "aim for under 30%".
//
// Recording cashback you ACTUALLY received is fine and factual; predicting
// what you would earn is not. Keep this list on the factual side.
//
// Hand-curated, not fetched. Unlike bankNames.js (FDIC) and the SEC ticker
// file, no public registry of card products exists - the commercial sources
// are affiliate-funded rather than open data. So this is comprehensive for
// major US issuers and NOT exhaustive, the same honesty tickers.js states
// about itself. Say that plainly if asked; never imply it is authoritative.
// A card that is missing is not evidence the card is not real, which is why
// the field stays free text with confirm-to-override.

export const CREDIT_CARDS = [
  // ---- Chase ----
  { name: "Chase Sapphire Preferred", issuer: "Chase", network: "Visa" },
  { name: "Chase Sapphire Reserve", issuer: "Chase", network: "Visa" },
  { name: "Chase Freedom Unlimited", issuer: "Chase", network: "Visa" },
  { name: "Chase Freedom Flex", issuer: "Chase", network: "Mastercard" },
  { name: "Chase Slate Edge", issuer: "Chase", network: "Visa" },
  { name: "Amazon Prime Rewards Visa", issuer: "Chase", network: "Visa" },
  { name: "Chase Ink Business Cash", issuer: "Chase", network: "Visa" },
  { name: "Chase Ink Business Preferred", issuer: "Chase", network: "Visa" },
  { name: "Chase Ink Business Unlimited", issuer: "Chase", network: "Visa" },
  { name: "United Explorer", issuer: "Chase", network: "Visa" },
  { name: "United Quest", issuer: "Chase", network: "Visa" },
  { name: "Southwest Rapid Rewards Plus", issuer: "Chase", network: "Visa" },
  { name: "Southwest Rapid Rewards Priority", issuer: "Chase", network: "Visa" },
  { name: "World of Hyatt", issuer: "Chase", network: "Visa" },
  { name: "IHG One Rewards Premier", issuer: "Chase", network: "Mastercard" },
  { name: "Marriott Bonvoy Boundless", issuer: "Chase", network: "Visa" },
  { name: "Disney Rewards Visa", issuer: "Chase", network: "Visa" },
  { name: "Aeroplan", issuer: "Chase", network: "Mastercard" },

  // ---- American Express ----
  { name: "Amex Platinum", issuer: "American Express", network: "Amex" },
  { name: "Amex Gold", issuer: "American Express", network: "Amex" },
  { name: "Amex Green", issuer: "American Express", network: "Amex" },
  { name: "Blue Cash Preferred", issuer: "American Express", network: "Amex" },
  { name: "Blue Cash Everyday", issuer: "American Express", network: "Amex" },
  { name: "Amex EveryDay", issuer: "American Express", network: "Amex" },
  { name: "Amex Cash Magnet", issuer: "American Express", network: "Amex" },
  { name: "Delta SkyMiles Gold", issuer: "American Express", network: "Amex" },
  { name: "Delta SkyMiles Platinum", issuer: "American Express", network: "Amex" },
  { name: "Delta SkyMiles Reserve", issuer: "American Express", network: "Amex" },
  { name: "Delta SkyMiles Blue", issuer: "American Express", network: "Amex" },
  { name: "Marriott Bonvoy Brilliant", issuer: "American Express", network: "Amex" },
  { name: "Hilton Honors Amex", issuer: "American Express", network: "Amex" },
  { name: "Hilton Honors Surpass", issuer: "American Express", network: "Amex" },
  { name: "Hilton Honors Aspire", issuer: "American Express", network: "Amex" },
  { name: "Amex Business Platinum", issuer: "American Express", network: "Amex" },
  { name: "Amex Business Gold", issuer: "American Express", network: "Amex" },
  { name: "Blue Business Plus", issuer: "American Express", network: "Amex" },

  // ---- Capital One ----
  { name: "Capital One Venture", issuer: "Capital One", network: "Visa" },
  { name: "Capital One Venture X", issuer: "Capital One", network: "Visa" },
  { name: "Capital One VentureOne", issuer: "Capital One", network: "Visa" },
  { name: "Capital One Savor", issuer: "Capital One", network: "Mastercard" },
  { name: "Capital One SavorOne", issuer: "Capital One", network: "Mastercard" },
  { name: "Capital One Quicksilver", issuer: "Capital One", network: "Mastercard" },
  { name: "Capital One Platinum", issuer: "Capital One", network: "Mastercard" },
  { name: "Capital One Spark Cash Plus", issuer: "Capital One", network: "Visa" },
  { name: "Capital One Spark Miles", issuer: "Capital One", network: "Visa" },

  // ---- Citi ----
  { name: "Citi Double Cash", issuer: "Citi", network: "Mastercard" },
  { name: "Citi Custom Cash", issuer: "Citi", network: "Mastercard" },
  { name: "Citi Strata Premier", issuer: "Citi", network: "Mastercard" },
  { name: "Citi Rewards+", issuer: "Citi", network: "Mastercard" },
  { name: "Citi Simplicity", issuer: "Citi", network: "Mastercard" },
  { name: "Citi Diamond Preferred", issuer: "Citi", network: "Mastercard" },
  { name: "Costco Anywhere Visa", issuer: "Citi", network: "Visa" },
  { name: "AAdvantage Platinum Select", issuer: "Citi", network: "Mastercard" },
  { name: "AAdvantage Executive", issuer: "Citi", network: "Mastercard" },

  // ---- Discover ----
  { name: "Discover it Cash Back", issuer: "Discover", network: "Discover" },
  { name: "Discover it Chrome", issuer: "Discover", network: "Discover" },
  { name: "Discover it Miles", issuer: "Discover", network: "Discover" },
  { name: "Discover it Student Cash Back", issuer: "Discover", network: "Discover" },
  { name: "Discover it Secured", issuer: "Discover", network: "Discover" },

  // ---- Bank of America ----
  { name: "Bank of America Customized Cash Rewards", issuer: "Bank of America", network: "Visa" },
  { name: "Bank of America Travel Rewards", issuer: "Bank of America", network: "Visa" },
  { name: "Bank of America Premium Rewards", issuer: "Bank of America", network: "Visa" },
  { name: "Bank of America Unlimited Cash Rewards", issuer: "Bank of America", network: "Visa" },
  { name: "Alaska Airlines Visa", issuer: "Bank of America", network: "Visa" },

  // ---- Wells Fargo ----
  { name: "Wells Fargo Active Cash", issuer: "Wells Fargo", network: "Visa" },
  { name: "Wells Fargo Autograph", issuer: "Wells Fargo", network: "Visa" },
  { name: "Wells Fargo Reflect", issuer: "Wells Fargo", network: "Visa" },
  { name: "Bilt Mastercard", issuer: "Wells Fargo", network: "Mastercard" },

  // ---- US Bank ----
  { name: "U.S. Bank Altitude Go", issuer: "U.S. Bank", network: "Visa" },
  { name: "U.S. Bank Altitude Connect", issuer: "U.S. Bank", network: "Visa" },
  { name: "U.S. Bank Altitude Reserve", issuer: "U.S. Bank", network: "Visa" },
  { name: "U.S. Bank Cash+", issuer: "U.S. Bank", network: "Visa" },

  // ---- Apple / fintech ----
  { name: "Apple Card", issuer: "Goldman Sachs", network: "Mastercard" },
  { name: "PayPal Cashback Mastercard", issuer: "Synchrony", network: "Mastercard" },
  { name: "Venmo Credit Card", issuer: "Synchrony", network: "Visa" },
  { name: "Robinhood Gold Card", issuer: "Coastal Community Bank", network: "Visa" },
  { name: "SoFi Credit Card", issuer: "SoFi", network: "Mastercard" },
  { name: "Upgrade Cash Rewards", issuer: "Upgrade", network: "Visa" },

  // ---- Other national issuers ----
  { name: "Barclays View", issuer: "Barclays", network: "Mastercard" },
  { name: "JetBlue Plus", issuer: "Barclays", network: "Mastercard" },
  { name: "Hawaiian Airlines World Elite", issuer: "Barclays", network: "Mastercard" },
  { name: "Synchrony Premier", issuer: "Synchrony", network: "Mastercard" },
  { name: "Navy Federal cashRewards", issuer: "Navy Federal", network: "Visa" },
  { name: "Navy Federal More Rewards", issuer: "Navy Federal", network: "Amex" },
  { name: "USAA Cashback Rewards Plus", issuer: "USAA", network: "Amex" },
  { name: "USAA Preferred Cash Rewards", issuer: "USAA", network: "Visa" },
  { name: "PenFed Power Cash Rewards", issuer: "PenFed", network: "Visa" },
  { name: "PenFed Platinum Rewards", issuer: "PenFed", network: "Visa" },

  // ---- Store and retail cards ----
  { name: "Target RedCard", issuer: "TD Bank", network: "Mastercard" },
  { name: "Amazon Store Card", issuer: "Synchrony", network: "Store" },
  { name: "Walmart Rewards Card", issuer: "Capital One", network: "Mastercard" },
  { name: "Costco Anywhere Visa Business", issuer: "Citi", network: "Visa" },
  { name: "Best Buy Credit Card", issuer: "Citi", network: "Visa" },
  { name: "Home Depot Consumer Card", issuer: "Citi", network: "Store" },
  { name: "Lowe's Advantage Card", issuer: "Synchrony", network: "Store" },
  { name: "Nordstrom Credit Card", issuer: "TD Bank", network: "Visa" },
  { name: "Macy's Credit Card", issuer: "Citi", network: "Store" },
  { name: "Kohl's Card", issuer: "Capital One", network: "Store" },
  { name: "Gap Good Rewards", issuer: "Synchrony", network: "Store" },
  { name: "TJX Rewards", issuer: "Synchrony", network: "Store" },
  { name: "Apple Pay Later", issuer: "Apple", network: "Store" },

  // ---- Gas and travel branded ----
  { name: "Shell Fuel Rewards", issuer: "Citi", network: "Store" },
  { name: "ExxonMobil Smart Card+", issuer: "Citi", network: "Store" },
  { name: "Marriott Bonvoy Bold", issuer: "Chase", network: "Visa" },
  { name: "Hilton Honors Business", issuer: "American Express", network: "Amex" },
  { name: "Frontier Airlines World Mastercard", issuer: "Barclays", network: "Mastercard" },
  { name: "Spirit Airlines World Mastercard", issuer: "Bank of America", network: "Mastercard" },

  // ---- Student and secured ----
  { name: "Capital One Quicksilver Student", issuer: "Capital One", network: "Mastercard" },
  { name: "Capital One SavorOne Student", issuer: "Capital One", network: "Mastercard" },
  { name: "Chase Freedom Rise", issuer: "Chase", network: "Visa" },
  { name: "Capital One Platinum Secured", issuer: "Capital One", network: "Mastercard" },
  { name: "Discover it Student Chrome", issuer: "Discover", network: "Discover" },
  { name: "Petal 2 Visa", issuer: "WebBank", network: "Visa" },
  { name: "Chime Credit Builder", issuer: "Stride Bank", network: "Visa" },
  { name: "Self Visa Secured", issuer: "Lead Bank", network: "Visa" },
];

/** Every card name, for a plain membership check. */
export const CREDIT_CARD_NAMES = CREDIT_CARDS.map((c) => c.name);

/**
 * Is this a card product this list recognizes? Exact match after
 * normalizing case and whitespace - a product name is a specific string,
 * not something to fuzzy-match, the same call isKnownTicker() makes.
 * A false here means "not in this list", never "not a real card".
 */
export function isKnownCard(name) {
  const n = (name || "").trim().toLowerCase();
  if (!n) return false;
  return CREDIT_CARD_NAMES.some((c) => c.toLowerCase() === n);
}

/**
 * Suggestions for the card field, matching on the product name OR its
 * issuer, so "chase" finds every Chase card and "sapphire" finds the two
 * Sapphires. Same shape and scoring idea as searchTickers(): a prefix match
 * outranks a contained one, so typing "cit" puts Citi's own cards above a
 * card that merely contains those letters.
 */
export function searchCards(query, limit = 8) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const card of CREDIT_CARDS) {
    const name = card.name.toLowerCase();
    const issuer = card.issuer.toLowerCase();
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (issuer.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (issuer.includes(q)) score = 3;
    if (score >= 0) scored.push({ score, card });
  }
  scored.sort((a, b) => a.score - b.score || a.card.name.localeCompare(b.card.name));
  return scored.slice(0, limit).map((s) => s.card);
}
