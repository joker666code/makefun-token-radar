// Token Radar lane 4A — the ranking model.
//
// What this file does: read the sealed DefiLlama snapshot, pick the protocols the
// radar may rank, score each one with a formula that uses only the snapshot's own
// figures, and write one farm plan per protocol. No protocol name is ever
// special-cased: every row goes through the same four functions below.
//
// Who gets ranked
//   A protocol is rankable when the snapshot records no token for it (gecko_id,
//   symbol and mcap_usd are all null) AND it is not a wrapped / staked / bridged
//   product of a token that already trades. That second half is the watchlist's
//   own rule, minus the $50M floor: category outside Bridge, Canonical Bridge,
//   Liquid Staking, Liquid Restaking, Restaked BTC and CEX; name not ending in a
//   version marker; no whole word wrapped / staked / staking; name not starting
//   with an exchange name. The floor is never the ceiling: this yields 198
//   protocols on the 2026-11-14 snapshot, all 40 watchlist slugs included.
//   Protocols with a token already trading are kept apart as the "live" set and
//   shown with the market's own market cap, never mixed into the ranked board.
//
// Implied value (the model's own claim, never make.fun's)
//   implied = TVL x baseMultiple x growthMult x maturityMult x breadthMult
//   baseMultiple  0.08 — CALIBRATED FROM THE SNAPSHOT, not picked: the median
//                 mcap/TVL (0.082, rounded to 0.08) of the 52 token-trading
//                 protocols with TVL above $50M. It is a circulating-mcap
//                 ratio, so it is conservative against a fully-diluted value.
//                 Per-category medians were checked and rejected: samples are
//                 n = 1..7 per category (one Dexs at 3.18), too thin to trust.
//   growthMult    1 + winsorised(change_7d) x 0.5, where change_7d is clipped to
//                 [-30%, +50%] first, so growthMult stays in [0.85, 1.25]. A
//                 +4448% week (Shift DeFi on this snapshot) is a low-base or
//                 re-listing jump, not a 45x reason to farm; the clip keeps TVL
//                 the dominant term. Null change counts as 0.
//   maturityMult  0.70 + min(age_days, 1460) / 1460 x 0.30, in [0.70, 1.00].
//                 Age is as_of minus listed_at. A missing listed_at scores the
//                 0.70 floor: missing evidence of a long tokenless run is not
//                 evidence of one. A listed_at after as_of counts as 0 days.
//   breadthMult   1 + min(chains - 1, 5) x 0.01, in [1.00, 1.05].
//   Only the 0.08 is snapshot-calibrated; the 0.5 growth weight, the 0.70-1.00
//   maturity band and the 1% per chain are stated assumptions, each moving a
//   row by at most about 30%.
//   Rows sort by the ROUNDED implied value, ties by TVL then slug, so the
//   displayed ranks never invert the displayed values.
//
// Farm plans
//   Six steps per protocol, built from its own record (category, first chain,
//   TVL tier, age). Every step states what it costs and how long it takes;
//   step 1 is always wallet/gas setup, step 6 is always how to unwind and what
//   not to over-commit. Nothing here claims a protocol has an airdrop, points
//   program or token plan: the text says to check the protocol's own page for
//   whether it tracks activity, and to keep a record either way.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, printed on the dashboard next to the formula. */
export interface ModelConstants {
  /** Snapshot-calibrated mcap/TVL median; see the header comment. */
  base_multiple: number;
  /** How many token-trading protocols the calibration median came from. */
  calibration_n: number;
  /** The calibration sample's mcap/TVL deciles, shown on the dashboard. */
  calibration_deciles: { p10: number; p25: number; p50: number; p75: number; p90: number };
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.08,
  calibration_n: 52,
  calibration_deciles: { p10: 0.006, p25: 0.032, p50: 0.082, p75: 0.317, p90: 1.043 },
  growth_weight: 0.5,
  growth_floor: -30,
  growth_cap: 50,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1460,
  breadth_per_chain: 0.01,
  breadth_max_chains: 5,
};

export const MODEL_VERSION = 'radar-4a-v1';

/** How many already-trading protocols the dashboard's reference table carries. */
export const LIVE_ROWS = 20;

const DAY_MS = 86_400_000;

/** Categories whose products are a wrapped / staked / bridged form of a token. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** The snapshot records no token at all for this protocol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

/** The watchlist's exclusion rule, without its $50M floor. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/** Whole days from listed_at to as_of; null when listed_at is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export interface ScoredParts {
  implied: number;
  growthRaw: number | null;
  growthWinsorised: number;
  growthMult: number;
  growthCapped: boolean;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
  ageKnown: boolean;
}

/** The four multipliers and the implied value for one protocol. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): ScoredParts {
  const raw = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const winsorised = Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
  const growthMult = 1 + (winsorised / 100) * model.growth_weight;
  const age = ageDays(asOf, p.listed_at);
  const ageKnown = age !== null;
  const ageForModel = age ?? 0;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.max(0, (p.chains?.length ?? 1) - 1);
  const breadthMult = 1 + Math.min(extraChains, model.breadth_max_chains) * model.breadth_per_chain;
  const implied = Math.max(
    1,
    Math.round(p.tvl_usd * model.base_multiple * growthMult * maturityMult * breadthMult),
  );
  return {
    implied,
    growthRaw: p.change_7d,
    growthWinsorised: winsorised,
    growthMult: round4(growthMult),
    growthCapped: raw !== winsorised,
    maturityMult: round4(maturityMult),
    breadthMult: round4(breadthMult),
    age,
    ageKnown,
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  token_status: 'records-no-token';
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_raw_pct: number | null;
    growth_winsorised_pct: number;
    growth_multiplier: number;
    growth_capped: boolean;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
    age_known: boolean;
  };
  farm_steps: string[];
}

/** One already-trading protocol, for the reference table (market's own value). */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  mcap_tvl: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  universe_size: number;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Build the ranked board: every rankable protocol, best implied value first. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, model) }));
  scored.sort(
    (a, b) =>
      b.s.implied - a.s.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: s.age,
    on_watchlist: watch.has(p.slug),
    token_status: 'records-no-token' as const,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_raw_pct: s.growthRaw,
      growth_winsorised_pct: s.growthWinsorised,
      growth_multiplier: s.growthMult,
      growth_capped: s.growthCapped,
      maturity_multiplier: s.maturityMult,
      breadth_multiplier: s.breadthMult,
      age_days: s.age,
      age_known: s.ageKnown,
    },
    farm_steps: farmSteps(p, s.age),
  }));
}

/** The already-trading reference set, biggest market cap first. */
export function buildLive(snapshot: Snapshot, limit: number = LIVE_ROWS): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      mcap_tvl: round4((p.mcap_usd as number) / Math.max(1, p.tvl_usd)),
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .slice(0, limit);
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): RadarData {
  const rows = buildBoard(snapshot, model);
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    universe_size: rows.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: rows.length,
    live_size: LIVE_ROWS,
    rows,
    live: buildLive(snapshot),
  };
}

/** The dashboard's data file: window.RADAR, read by dashboard/app.js. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// ---- farm plans -----------------------------------------------------------

/** First chain, or a neutral phrase when the snapshot names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains && p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** One farm position's size, from the protocol's own TVL tier, then capped for
 *  young protocols and 7-day spikes: farm small where the record is thinnest. */
function capitalFor(p: SnapshotProtocol, age: number | null, spiked: boolean): number {
  let capital: number;
  if (p.tvl_usd >= 1_000_000_000) capital = 250;
  else if (p.tvl_usd >= 100_000_000) capital = 150;
  else if (p.tvl_usd >= 25_000_000) capital = 100;
  else capital = 50;
  if (age !== null && age < 180) capital = Math.min(capital, 100);
  if (spiked) capital = capital >= 250 ? 150 : capital >= 150 ? 100 : 50;
  return capital;
}

/** How long to hold: a short probe for young protocols, longer once the record
 *  is established; unknown age probes short too. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 30;
  return 45;
}

/** The category's core action, in words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name}'s largest USDC lending pool on ${chain} and leave the position open so it keeps earning`;
  if (c.includes('dex') || c.includes('amm'))
    return `Add $${capital} of liquidity to ${name}'s largest balanced pool on ${chain} — the pool with the most TVL — and keep the position open`;
  if (c.includes('yield aggregator') || c.includes('yield'))
    return `Deposit $${capital} of USDC into ${name}'s largest vault on ${chain} and hold the vault shares`;
  if (c.includes('rwa'))
    return `Mint or buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your own wallet`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Deposit $${capital} of USDC as collateral on ${name} (${chain}) and open one small hedged position, not a leveraged bet`;
  if (c.includes('prediction'))
    return `Fund your ${name} account with $${capital} on ${chain} and take a position in one active market you understand`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('asset management'))
    return `Deposit $${capital} into ${name}'s largest vault on ${chain} and hold the vault shares while the curator allocates it`;
  if (c.includes('restak'))
    return `Restake $${capital} of liquid staking tokens through ${name} on ${chain} and keep the receipt token`;
  if (c.includes('basis'))
    return `Deposit $${capital} into ${name}'s largest basis strategy on ${chain} and hold the position through one funding cycle`;
  if (c.includes('payment'))
    return `Route $${capital} of real payments through ${name} on ${chain} over the next month instead of a single test`;
  if (c.includes('stable'))
    return `Mint $${capital} of the stable asset through ${name} on ${chain} against over-collateral, and keep the ratio healthy`;
  if (c.includes('chain'))
    return `Bridge $${capital} onto ${name}'s chain and use its core apps for a real transaction, not a dust transfer`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold, and keep the policy active`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC through ${name} to ${chain} and put the bridged funds to work in its app`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open so activity accrues`;
}

/** What "still healthy" means for this category: a check with a yes/no answer. */
function healthCheck(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return 'your supplied balance is above $0 and the pool still quotes a borrow rate';
  if (c.includes('dex') || c.includes('amm'))
    return 'your liquidity is still in range and the pool price has not moved more than 30% from entry';
  if (c.includes('perpetual') || c.includes('derivative'))
    return 'your margin is above the maintenance level and the position is still open';
  if (c.includes('prediction'))
    return 'your market is still unresolved and the position still shows in your account';
  if (c.includes('restak'))
    return 'your receipt-token balance is above $0 and still redeemable';
  if (c.includes('rwa'))
    return 'the asset still shows a redemption quote and your balance is above $0';
  if (c.includes('payment'))
    return 'your routed payments still settle and the balance is above $0';
  return 'your vault or deposit balance is above $0 and a withdrawal preview still loads';
}

/** Whether the position can compound yield at all; trading categories cannot. */
function compoundsYield(p: SnapshotProtocol): boolean {
  const c = (p.category ?? '').toLowerCase();
  return !(
    c.includes('perpetual') ||
    c.includes('derivative') ||
    c.includes('prediction') ||
    c.includes('payment')
  );
}

/** Second-chain / second-position action, for depth rather than one click. */
function secondAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const second = p.chains && p.chains.length > 1 ? p.chains[1]! : chain;
  const half = Math.max(25, Math.round(capital / 2));
  const total = capital + half;
  if (second !== chain)
    return `Open a second, smaller position of $${half} on ${second}, ${p.name}'s second chain, in the same kind of vault or pool, so one chain pausing does not end the farm; total at risk is now $${total}`;
  return `Open a second position of $${half} in a different pool or vault on ${chain}, so one pool pausing does not end the farm; total at risk is now $${total}`;
}

/**
 * Six concrete steps for one protocol. Every step carries its cost and its
 * time in the text; the gate counts 3-12 steps of 20-600 characters each.
 * Steps 4 and 5 branch on the protocol's category, and the totals in steps
 * 3 and 5 agree with each other. Nothing assumes an airdrop, points program
 * or yield exists: step 4 records whether the protocol shows one, or not.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const spiked =
    typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) && p.change_7d > 50;
  const capital = capitalFor(p, age, spiked);
  const hold = holdDaysFor(age);
  const secondChain = p.chains && p.chains.length > 1 ? p.chains[1]! : chain;
  const half = Math.max(25, Math.round(capital / 2));
  const total = capital + half;
  const weeks = Math.max(4, Math.ceil(hold / 7));
  const tvlExit = Math.round(p.tvl_usd * 0.7);
  const step5 = compoundsYield(p)
    ? `After ${hold} days, compound once if the position earned yield, keeping the total near $${total} so the farm stays one deliberate size. Cost: gas of roughly $1-5. Time: 15 minutes, once.`
    : `After ${hold} days, record the position's profit or loss and do not add capital automatically; only continue if the first ${hold} days behaved as expected. Cost: no new capital. Time: 15 minutes, once.`;
  const steps: string[] = [
    `Set up a fresh wallet for ${p.name}, fund it with $${total + 20} on ${chain} ($${total} to farm, about $20 for gas), and save the seed phrase offline. Cost: about $20 in gas plus the deposit. Time: 15 minutes, once.`,
    `${coreAction(p, capital, chain)}. Cost: $${capital} of capital at risk plus network gas of roughly $1-5 per transaction. Time: 20 minutes to open, then ${hold} days holding.`,
    `${secondAction(p, capital, chain)}. Cost: about $${half} more capital plus $1-5 gas. Time: 15 minutes, once.`,
    `Once a week for ${weeks} weeks, open ${p.name}'s own page and check two things: ${healthCheck(p)}, and whether its TVL is still above $${tvlExit.toLocaleString('en-US')} (30% below today). If the protocol's page shows an activity or rewards page, note what it says; if it shows none, record that too. Save the date, the position value and a screenshot each week. Cost: no new capital, about $0-2 gas if you rebalance. Time: 10 minutes a week.`,
    step5,
    `Unwind by withdrawing to ${secondChain === chain ? chain : `${chain} or ${secondChain}`}, keep $10 of gas in reserve, and stop at once if withdrawals pause, the health check fails, or terms change — never chase a farm that locks you out. Cost: $1-5 gas to exit. Time: 15 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 597)}...` : s));
}

/** Gate-shaped self-check: null when the board is valid, else the first problem. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `board holds ${board.length} rows, fewer than 100`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  const ranks = new Set<number>();
  let prev = Number.POSITIVE_INFINITY;
  for (const row of board) {
    if (!slugs.has(row.slug)) return `row names ${row.slug}, not in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!Number.isInteger(row.rank) || row.rank < 1) return `row ${row.slug} has a bad rank`;
    if (ranks.has(row.rank)) return `rank ${row.rank} appears twice`;
    ranks.add(row.rank);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1)
      return `row ${row.slug} has a bad implied value`;
    if (row.implied_value_usd > prev) return `implied value rises at rank ${row.rank}`;
    prev = row.implied_value_usd;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12)
      return `row ${row.slug} has ${row.farm_steps?.length ?? 0} farm steps`;
    for (const s of row.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${row.slug} has a farm step of ${t.length} chars`;
    }
  }
  for (let i = 1; i <= board.length; i++) if (!ranks.has(i)) return `rank ${i} is missing`;
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `watchlist slug ${slug} is missing`;
  if (new Set(board.map((r) => r.implied_value_usd)).size < 2) return 'all implied values are equal';
  return null;
}
