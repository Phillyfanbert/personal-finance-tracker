// ============================================================================
// A curated, static reference list of real stock/ETF/mutual-fund ticker
// symbols and crypto symbols, used to validate the ticker field on an
// Investments-tab holding - same role BANK_NAMES plays for the Bank field
// (isKnownBank), same shape of honesty required about it too.
//
// IMPORTANT LIMITATION, stated plainly: unlike BANK_NAMES (fetched from a
// real FDIC data source), there is no free, live market-data API this
// $0-constrained project can pull a verified ticker feed from. This list is
// hand-curated from training knowledge as of this file's creation
// (2026-08-12), not a live or independently verified feed - it WILL miss
// real, legitimate tickers (thousands of publicly traded securities exist;
// this covers a few hundred well-known ones), and index membership/fund
// lineups change over time in ways this file will not track. Treat it as
// "a reasonable first check," not an authority - which is exactly why
// isKnownTicker()'s caller (app.js) always offers a confirm-to-override
// path for a real ticker it doesn't recognize, the same pattern
// isKnownBank() already established. Never treat a false negative here as
// proof a ticker isn't real.
//
// Three separate sets, not one flat list, because a ticker collision across
// them is a real risk (a mutual fund symbol coinciding with an unrelated
// stock ticker is possible) and because the UI may eventually want to
// label a match by kind. STOCK_TICKERS covers large, well-known US-listed
// equities. ETF_TICKERS covers broad-market/sector/bond/thematic index
// funds (this is where "index funds" mostly live - most index EXPOSURE
// today is via an ETF wrapper, not a mutual fund one). MUTUAL_FUND_TICKERS
// covers the actual 5-letter-code mutual fund share classes (Vanguard/
// Fidelity/Schwab/American Funds/T. Rowe Price/Dodge & Cox families
// especially) - this is the other half of "index and mutual funds," since
// a fund like VFIAX (Vanguard 500 Index Fund) is an index fund in mutual-
// fund form, not ETF form. CRYPTO_SYMBOLS is separate again, deliberately -
// a crypto "ticker" (BTC, ETH) is not a market-issued security symbol the
// way a stock/ETF/fund ticker is, so it is checked against this list
// instead of the other three, only for a holding whose parent account is
// type 'crypto'.
// ============================================================================

export const STOCK_TICKERS = [
  "AAPL", "ABBV", "ABNB", "ABT", "ADBE", "AEP", "AIG", "ALL", "AMD", "AMGN",
  "AMT", "AMZN", "AON", "APD", "ATVI", "AVB", "AVGO", "AXP", "BA", "BAC",
  "BDX", "BK", "BKNG", "BLK", "BMY", "BSX", "C", "CAT", "CB", "CCI",
  "CHTR", "CI", "CL", "CMCSA", "CMG", "COF", "COIN", "COP", "COST", "CRM",
  "CRWD", "CSCO", "CVS", "CVX", "D", "DASH", "DDOG", "DE", "DG", "DHR",
  "DIS", "DLTR", "DOCU", "DUK", "EA", "EBAY", "ECL", "EL", "ELV", "EMR",
  "EOG", "EQIX", "EQR", "ETN", "ETSY", "EXC", "FCX", "FDX", "FOXA", "GD",
  "GE", "GILD", "GIS", "GOOG", "GOOGL", "GS", "HD", "HON", "HOOD", "HSY",
  "HUM", "IBM", "INTC", "INTU", "ISRG", "ITW", "JNJ", "JPM", "K", "KMB",
  "KO", "KR", "LIN", "LLY", "LMT", "LOW", "LULU", "MA", "MAR", "MCD",
  "MDB",
  "MDLZ", "MDT", "MET", "META", "MMC", "MMM", "MO", "MPC", "MRK", "MS",
  "MSFT", "NEE", "NEM", "NET", "NFLX", "NKE", "NOC", "NOW", "NVDA", "NWSA",
  "O", "OKTA", "ORCL", "OXY", "PANW", "PARA", "PEP", "PFE", "PG", "PGR",
  "PH", "PLD", "PLTR", "PM", "PNC", "PRU", "PSA", "PSX", "PYPL", "QCOM",
  "RBLX", "REGN", "ROST", "RTX", "SBUX", "SCHW", "SHOP", "SHW", "SLB", "SNOW",
  "SO", "SPG", "SPGI", "SQ", "STZ", "SYK", "SYY", "T", "TEAM", "TFC",
  "TGT", "TJX", "TMO", "TMUS", "TRV", "TSLA", "TTWO", "TXN", "U", "UBER",
  "UNH", "UNP", "UPS", "USB", "V", "VLO", "VRTX", "VZ", "WBD", "WDAY",
  "WELL",
  "WFC", "WMT", "XEL", "XOM", "YUM", "ZM", "ZTS",
];

export const ETF_TICKERS = [
  "ACWI", "ACWX", "AGG", "ARKF", "ARKG", "ARKK", "ARKQ", "ARKW", "BITO", "BND",
  "BNDX", "DIA", "DVY", "EEM", "EFA", "FBTC", "GBTC", "GDX", "GLD", "HDV",
  "HYG", "IAU", "IBIT", "IEF", "IEMG", "IJH", "IJR", "IVV", "IWD", "IWF",
  "IWM", "LQD", "MDY", "MGK", "MGV", "MUB", "NOBL", "QQQ", "QQQM", "SCHD",
  "SCZ", "SDY", "SHY", "SLV", "SPHD", "SPY", "SPYG", "SPYV", "TIP", "TLT",
  "UNG", "USO", "VAW", "VB", "VBR", "VCIT", "VCSH", "VDC", "VDE", "VEA",
  "VFH", "VGIT", "VGSH", "VGT", "VHT", "VIG", "VIS", "VNQ", "VO", "VOE",
  "VONG", "VONV", "VOO", "VOX", "VPU", "VSS", "VT", "VTI", "VTV", "VTWO",
  "VUG", "VWO", "VXUS", "VYM", "XLB", "XLC", "XLE", "XLF", "XLI", "XLK",
  "XLP", "XLRE", "XLU", "XLV", "XLY",
];

export const MUTUAL_FUND_TICKERS = [
  "AEPGX", "AGTHX", "AIVSX", "AMCPX", "ANCFX", "AWSHX", "CWGIX", "DODBX", "DODFX", "DODGX",
  "FBALX", "FBGRX", "FCNTX", "FDEWX", "FDGRX", "FDVV", "FFFHX", "FLPSX", "FMAGX", "FPURX",
  "FSKAX", "FSMAX", "FSSNX", "FTIHX", "FXAIX", "FXNAX", "FZILX", "FZROX", "OAKMX", "PARNX",
  "PRGFX", "PRWCX", "SWAGX", "SWISX", "SWLGX", "SWMCX", "SWPPX", "SWSSX", "SWTSX", "TRBCX",
  "VBTLX", "VDIGX", "VEXAX", "VFFVX", "VFIAX", "VFIFX", "VFORX", "VGENX", "VGHCX", "VGSLX",
  "VGSTX", "VIGAX", "VPMAX", "VSMAX", "VTHRX", "VTIAX", "VTIVX", "VTSAX", "VTWAX", "VVIAX",
  "VWELX", "VWENX", "VWINX",
];

export const CRYPTO_SYMBOLS = [
  "AAVE", "ADA", "ALGO", "APE", "APT", "ARB", "ATOM", "AVAX", "BCH", "BNB",
  "BTC", "DOGE", "DOT", "EOS", "ETC", "ETH", "FIL", "GRT", "LINK", "LTC",
  "MANA", "MATIC", "MKR", "NEAR", "OP", "SAND", "SHIB", "SOL", "TRX", "UNI",
  "USDC", "USDT", "VET", "XLM", "XMR", "XRP",
];


// All non-crypto tickers combined, for a single "is this a known
// stock/ETF/fund symbol" check - callers that want to know WHICH kind
// matched (not needed by isKnownTicker() itself today) can check the three
// exported arrays directly instead.
export const ALL_SECURITY_TICKERS = [
  ...STOCK_TICKERS, ...ETF_TICKERS, ...MUTUAL_FUND_TICKERS,
];

// ============================================================================
// Ticker -> company/fund name, for the Tracked companies autocomplete
// (searchTickers() below) and for showing a real name under a bare symbol.
//
// **Each name is deliberately the SHORT, headline-plausible form** ("Apple",
// not "Apple Inc."; "JPMorgan Chase", not "JPMorgan Chase & Co."). That is a
// hard constraint, not a style choice: this value is what gets written to
// watchlist_symbols.company_name, and price-agent.js's pickRelevantHeadline()
// matches it as a WHOLE PHRASE against real headline text. A full legal name
// ("Apple Inc.") would essentially never appear in a headline, so storing one
// would silently stop that symbol from ever matching news. Keep new entries
// in the same short form for the same reason.
//
// Same honesty as the ticker lists above: hand-curated from training
// knowledge, not a live feed. It covers the symbols in this file and nothing
// else, so the autocomplete is a convenience for well-known names, never a
// gate - the Add field stays free-text and any real ticker can still be typed
// in and saved without appearing here.
// ============================================================================
export const TICKER_NAMES = {
  // Stocks
  AAPL: "Apple", ABBV: "AbbVie", ABNB: "Airbnb", ABT: "Abbott", ADBE: "Adobe",
  AEP: "American Electric Power", AIG: "AIG", ALL: "Allstate", AMD: "AMD", AMGN: "Amgen",
  AMT: "American Tower", AMZN: "Amazon", AON: "Aon", APD: "Air Products", ATVI: "Activision Blizzard",
  AVB: "AvalonBay", AVGO: "Broadcom", AXP: "American Express", BA: "Boeing", BAC: "Bank of America",
  BDX: "Becton Dickinson", BK: "BNY Mellon", BKNG: "Booking Holdings", BLK: "BlackRock", BMY: "Bristol Myers Squibb",
  BSX: "Boston Scientific", C: "Citigroup", CAT: "Caterpillar", CB: "Chubb", CCI: "Crown Castle",
  CHTR: "Charter Communications", CI: "Cigna", CL: "Colgate-Palmolive", CMCSA: "Comcast", CMG: "Chipotle",
  COF: "Capital One", COIN: "Coinbase", COP: "ConocoPhillips", COST: "Costco", CRM: "Salesforce",
  CRWD: "CrowdStrike", CSCO: "Cisco", CVS: "CVS Health", CVX: "Chevron", D: "Dominion Energy",
  DASH: "DoorDash", DDOG: "Datadog", DE: "Deere", DG: "Dollar General", DHR: "Danaher",
  DIS: "Disney", DLTR: "Dollar Tree", DOCU: "DocuSign", DUK: "Duke Energy", EA: "Electronic Arts",
  EBAY: "eBay", ECL: "Ecolab", EL: "Estee Lauder", ELV: "Elevance Health", EMR: "Emerson Electric",
  EOG: "EOG Resources", EQIX: "Equinix", EQR: "Equity Residential", ETN: "Eaton", ETSY: "Etsy",
  EXC: "Exelon", FCX: "Freeport-McMoRan", FDX: "FedEx", FOXA: "Fox", GD: "General Dynamics",
  GE: "General Electric", GILD: "Gilead", GIS: "General Mills", GOOG: "Alphabet", GOOGL: "Alphabet",
  GS: "Goldman Sachs", HD: "Home Depot", HON: "Honeywell", HOOD: "Robinhood", HSY: "Hershey",
  HUM: "Humana", IBM: "IBM", INTC: "Intel", INTU: "Intuit", ISRG: "Intuitive Surgical",
  ITW: "Illinois Tool Works", JNJ: "Johnson & Johnson", JPM: "JPMorgan Chase", K: "Kellanova", KMB: "Kimberly-Clark",
  KO: "Coca-Cola", KR: "Kroger", LIN: "Linde", LLY: "Eli Lilly", LMT: "Lockheed Martin",
  LOW: "Lowe's", LULU: "Lululemon", MAR: "Marriott", MCD: "McDonald's", MDB: "MongoDB",
  MA: "Mastercard", MDLZ: "Mondelez", MDT: "Medtronic", MET: "MetLife", META: "Meta",
  MMC: "Marsh McLennan",
  MMM: "3M", MO: "Altria", MPC: "Marathon Petroleum", MRK: "Merck", MS: "Morgan Stanley",
  MSFT: "Microsoft", NEE: "NextEra Energy", NEM: "Newmont", NET: "Cloudflare", NFLX: "Netflix",
  NKE: "Nike", NOC: "Northrop Grumman", NOW: "ServiceNow", NVDA: "Nvidia", NWSA: "News Corp",
  O: "Realty Income", OKTA: "Okta", ORCL: "Oracle", OXY: "Occidental Petroleum", PANW: "Palo Alto Networks",
  PARA: "Paramount", PEP: "PepsiCo", PFE: "Pfizer", PG: "Procter & Gamble", PGR: "Progressive",
  PH: "Parker Hannifin", PLD: "Prologis", PLTR: "Palantir", PM: "Philip Morris", PNC: "PNC Financial",
  PRU: "Prudential", PSA: "Public Storage", PSX: "Phillips 66", PYPL: "PayPal", QCOM: "Qualcomm",
  RBLX: "Roblox", REGN: "Regeneron", ROST: "Ross Stores", RTX: "RTX", SBUX: "Starbucks",
  SCHW: "Charles Schwab", SHOP: "Shopify", SHW: "Sherwin-Williams", SLB: "SLB", SNOW: "Snowflake",
  SO: "Southern Company", SPG: "Simon Property", SPGI: "S&P Global", SQ: "Block", STZ: "Constellation Brands",
  SYK: "Stryker", SYY: "Sysco", T: "AT&T", TEAM: "Atlassian", TFC: "Truist",
  TGT: "Target", TJX: "TJX", TMO: "Thermo Fisher", TMUS: "T-Mobile", TRV: "Travelers",
  TSLA: "Tesla", TTWO: "Take-Two", TXN: "Texas Instruments", U: "Unity", UBER: "Uber",
  UNH: "UnitedHealth", UNP: "Union Pacific", UPS: "UPS", USB: "U.S. Bancorp", V: "Visa",
  VLO: "Valero",
  VRTX: "Vertex Pharmaceuticals", VZ: "Verizon", WBD: "Warner Bros. Discovery", WDAY: "Workday", WELL: "Welltower",
  WFC: "Wells Fargo", WMT: "Walmart", XEL: "Xcel Energy", XOM: "Exxon Mobil", YUM: "Yum Brands",
  ZM: "Zoom", ZTS: "Zoetis",

  // ETFs
  ACWI: "iShares MSCI ACWI ETF", ACWX: "iShares MSCI ACWI ex US ETF", AGG: "iShares Core US Aggregate Bond ETF",
  ARKF: "ARK Fintech Innovation ETF", ARKG: "ARK Genomic Revolution ETF", ARKK: "ARK Innovation ETF",
  ARKQ: "ARK Autonomous Technology ETF", ARKW: "ARK Next Generation Internet ETF", BITO: "ProShares Bitcoin Strategy ETF",
  BND: "Vanguard Total Bond Market ETF", BNDX: "Vanguard Total International Bond ETF", DIA: "SPDR Dow Jones Industrial Average ETF",
  DVY: "iShares Select Dividend ETF", EEM: "iShares MSCI Emerging Markets ETF", EFA: "iShares MSCI EAFE ETF",
  FBTC: "Fidelity Wise Origin Bitcoin Fund", GBTC: "Grayscale Bitcoin Trust", GDX: "VanEck Gold Miners ETF",
  GLD: "SPDR Gold Shares", HDV: "iShares Core High Dividend ETF", HYG: "iShares High Yield Corporate Bond ETF",
  IAU: "iShares Gold Trust", IBIT: "iShares Bitcoin Trust", IEF: "iShares 7-10 Year Treasury Bond ETF",
  IEMG: "iShares Core MSCI Emerging Markets ETF", IJH: "iShares Core S&P Mid-Cap ETF", IJR: "iShares Core S&P Small-Cap ETF",
  IVV: "iShares Core S&P 500 ETF", IWD: "iShares Russell 1000 Value ETF", IWF: "iShares Russell 1000 Growth ETF",
  IWM: "iShares Russell 2000 ETF", LQD: "iShares Investment Grade Corporate Bond ETF", MDY: "SPDR S&P MidCap 400 ETF",
  MGK: "Vanguard Mega Cap Growth ETF", MGV: "Vanguard Mega Cap Value ETF", MUB: "iShares National Muni Bond ETF",
  NOBL: "ProShares S&P 500 Dividend Aristocrats ETF", QQQ: "Invesco QQQ Trust", QQQM: "Invesco NASDAQ 100 ETF",
  SCHD: "Schwab US Dividend Equity ETF", SCZ: "iShares MSCI EAFE Small-Cap ETF", SDY: "SPDR S&P Dividend ETF",
  SHY: "iShares 1-3 Year Treasury Bond ETF", SLV: "iShares Silver Trust", SPHD: "Invesco S&P 500 High Dividend Low Volatility ETF",
  SPY: "SPDR S&P 500 ETF Trust", SPYG: "SPDR Portfolio S&P 500 Growth ETF", SPYV: "SPDR Portfolio S&P 500 Value ETF",
  TIP: "iShares TIPS Bond ETF", TLT: "iShares 20+ Year Treasury Bond ETF", UNG: "United States Natural Gas Fund",
  USO: "United States Oil Fund", VAW: "Vanguard Materials ETF", VB: "Vanguard Small-Cap ETF",
  VBR: "Vanguard Small-Cap Value ETF", VCIT: "Vanguard Intermediate-Term Corporate Bond ETF", VCSH: "Vanguard Short-Term Corporate Bond ETF",
  VDC: "Vanguard Consumer Staples ETF", VDE: "Vanguard Energy ETF", VEA: "Vanguard FTSE Developed Markets ETF",
  VFH: "Vanguard Financials ETF", VGIT: "Vanguard Intermediate-Term Treasury ETF", VGSH: "Vanguard Short-Term Treasury ETF",
  VGT: "Vanguard Information Technology ETF", VHT: "Vanguard Health Care ETF", VIG: "Vanguard Dividend Appreciation ETF",
  VIS: "Vanguard Industrials ETF", VNQ: "Vanguard Real Estate ETF", VO: "Vanguard Mid-Cap ETF",
  VOE: "Vanguard Mid-Cap Value ETF", VONG: "Vanguard Russell 1000 Growth ETF", VONV: "Vanguard Russell 1000 Value ETF",
  VOO: "Vanguard S&P 500 ETF", VOX: "Vanguard Communication Services ETF", VPU: "Vanguard Utilities ETF",
  VSS: "Vanguard FTSE All-World ex-US Small-Cap ETF", VT: "Vanguard Total World Stock ETF", VTI: "Vanguard Total Stock Market ETF",
  VTV: "Vanguard Value ETF", VTWO: "Vanguard Russell 2000 ETF", VUG: "Vanguard Growth ETF",
  VWO: "Vanguard FTSE Emerging Markets ETF", VXUS: "Vanguard Total International Stock ETF", VYM: "Vanguard High Dividend Yield ETF",
  XLB: "Materials Select Sector SPDR", XLC: "Communication Services Select Sector SPDR", XLE: "Energy Select Sector SPDR",
  XLF: "Financial Select Sector SPDR", XLI: "Industrial Select Sector SPDR", XLK: "Technology Select Sector SPDR",
  XLP: "Consumer Staples Select Sector SPDR", XLRE: "Real Estate Select Sector SPDR", XLU: "Utilities Select Sector SPDR",
  XLV: "Health Care Select Sector SPDR", XLY: "Consumer Discretionary Select Sector SPDR",

  // Mutual funds
  AEPGX: "American Funds EuroPacific Growth", AGTHX: "American Funds Growth Fund of America", AIVSX: "American Funds Investment Company of America",
  AMCPX: "American Funds AMCAP", ANCFX: "American Funds Fundamental Investors", AWSHX: "American Funds Washington Mutual",
  CWGIX: "American Funds Capital World Growth and Income", DODBX: "Dodge & Cox Balanced", DODFX: "Dodge & Cox International Stock",
  DODGX: "Dodge & Cox Stock", FBALX: "Fidelity Balanced", FBGRX: "Fidelity Blue Chip Growth",
  FCNTX: "Fidelity Contrafund", FDEWX: "Fidelity Freedom Index 2065", FDGRX: "Fidelity Growth Company",
  FDVV: "Fidelity High Dividend ETF", FFFHX: "Fidelity Freedom 2035", FLPSX: "Fidelity Low-Priced Stock",
  FMAGX: "Fidelity Magellan", FPURX: "Fidelity Puritan", FSKAX: "Fidelity Total Market Index",
  FSMAX: "Fidelity Extended Market Index", FSSNX: "Fidelity Small Cap Index", FTIHX: "Fidelity Total International Index",
  FXAIX: "Fidelity 500 Index", FXNAX: "Fidelity US Bond Index", FZILX: "Fidelity ZERO International Index",
  FZROX: "Fidelity ZERO Total Market Index", OAKMX: "Oakmark Fund", PARNX: "Parnassus Mid Cap",
  PRGFX: "T. Rowe Price Growth Stock", PRWCX: "T. Rowe Price Capital Appreciation", SWAGX: "Schwab US Aggregate Bond Index",
  SWISX: "Schwab International Index", SWLGX: "Schwab US Large-Cap Growth Index", SWMCX: "Schwab US Mid-Cap Index",
  SWPPX: "Schwab S&P 500 Index", SWSSX: "Schwab US Small-Cap Index", SWTSX: "Schwab Total Stock Market Index",
  TRBCX: "T. Rowe Price Blue Chip Growth", VBTLX: "Vanguard Total Bond Market Index", VDIGX: "Vanguard Dividend Growth",
  VEXAX: "Vanguard Extended Market Index", VFFVX: "Vanguard Target Retirement 2055", VFIAX: "Vanguard 500 Index",
  VFIFX: "Vanguard Target Retirement 2050", VFORX: "Vanguard Target Retirement 2040", VGENX: "Vanguard Energy Fund",
  VGHCX: "Vanguard Health Care Fund", VGSLX: "Vanguard Real Estate Index", VGSTX: "Vanguard STAR Fund",
  VIGAX: "Vanguard Growth Index", VPMAX: "Vanguard PRIMECAP", VSMAX: "Vanguard Small-Cap Index",
  VTHRX: "Vanguard Target Retirement 2030", VTIAX: "Vanguard Total International Stock Index", VTIVX: "Vanguard Target Retirement 2045",
  VTSAX: "Vanguard Total Stock Market Index", VTWAX: "Vanguard Total World Stock Index", VVIAX: "Vanguard Value Index",
  VWELX: "Vanguard Wellington", VWENX: "Vanguard Wellington Admiral", VWINX: "Vanguard Wellesley Income",

  // Crypto
  AAVE: "Aave", ADA: "Cardano", ALGO: "Algorand", APE: "ApeCoin", APT: "Aptos",
  ARB: "Arbitrum", ATOM: "Cosmos", AVAX: "Avalanche", BCH: "Bitcoin Cash", BNB: "BNB",
  BTC: "Bitcoin", DOGE: "Dogecoin", DOT: "Polkadot", EOS: "EOS", ETC: "Ethereum Classic",
  ETH: "Ethereum", FIL: "Filecoin", GRT: "The Graph", LINK: "Chainlink", LTC: "Litecoin",
  MANA: "Decentraland", MATIC: "Polygon", MKR: "Maker", NEAR: "NEAR Protocol", OP: "Optimism",
  SAND: "The Sandbox", SHIB: "Shiba Inu", SOL: "Solana", TRX: "TRON", UNI: "Uniswap",
  USDC: "USD Coin", USDT: "Tether", VET: "VeChain", XLM: "Stellar", XMR: "Monero",
  XRP: "XRP",
};

// Ranked matches for the Tracked companies autocomplete. Ticker-prefix
// matches rank above name matches, so typing "V" leads with V (Visa) rather
// than burying it under every fund whose name contains a "v".
export function searchTickers(query, limit = 8) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const [symbol, name] of Object.entries(TICKER_NAMES)) {
    const sym = symbol.toLowerCase();
    const nm = name.toLowerCase();
    let score = null;
    if (sym === q) score = 0;
    else if (sym.startsWith(q)) score = 1;
    else if (nm.startsWith(q)) score = 2;
    else if (nm.includes(q)) score = 3;
    else if (sym.includes(q)) score = 4;
    if (score !== null) scored.push({ symbol, name, score });
  }
  // Within a score band, the shorter name wins before alphabetical order.
  // Without this, searching "bitcoin" put Bitcoin Cash above Bitcoin, and
  // alphabetical order alone buried the plainest match under every longer
  // fund name that happened to start the same way.
  scored.sort((a, b) =>
    a.score - b.score ||
    a.name.length - b.name.length ||
    a.symbol.localeCompare(b.symbol));
  return scored.slice(0, limit);
}
