# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/joker666code/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/joker666code/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: ranks 198 protocols by implied launch value from a sealed DefiLlama snapshot (top: Steakhouse Financial at $185.7M), with a static offline dashboard (board, protocol detail, filtered views) and a farm plan for each protocol.

Model v2 adds a per-category value breakdown, the full 52-protocol calibration set behind the 0.08 multiple (median pair highlighted), a per-protocol context line (category rank, TVL rank, share of board value, farm size), and an implied-per-$TVL sort. Board values are unchanged from v1 — the model is the same; v2 makes its calibration auditable in the page.

Model v3 (board values still unchanged — board.json md5 identical since v1) adds three audits computed from the snapshot at build time: a sensitivity table re-ranking the board under 7 one-change variants (rank #1 never moves; top-10 overlap 9–10/10; no row moves more than 10 places); a thin-data table counting the board's gaps (age unknown 7, growth capped 7, 7d unreported 2, single chain 113, below floor 138) with the model's stated handling of each; and a below-floor calibration check — the same mcap/TVL median on the 76 smaller trading protocols under $50M is 0.419, so the 0.08 understates the small rows rather than flattering them. It also corrects the calibration footnote: the 4 protocols left out above the floor record a market cap of exactly $0, they do not lack a Gecko record. New lens: an "Implied per farm $" sort, and each detail view now states the implied value per farm dollar.

Model v4 (implied values still unchanged since v1 — only farm-plan wording and page copy moved): each farm plan's step 2 now states the reason when its size was capped — a record under 180 days old (capped at $100) or a 7-day TVL jump over 50% (cut a tier) — so the sizing is auditable from the plan itself; a cap that did not bind is not mentioned, and no pool or vault is ever named, because the snapshot carries no pool-level data. The calibration section now names its median pair: Dolomite (Lending, $128.3M TVL) and Re (RWA, $487.6M TVL), different categories and sizes, both at 0.082. The two-variable sensitivity combo (growth 0.6 + maturity floor 0.60) was computed — top-10 9/10, biggest move 9, no row over 10 — and deliberately not added as an eighth table row, since it lands inside the band the seven single-variable rows already show. First-screen density was tightened (method box, controls and board rows) so one more ranked row fits in a 1440×900 view; the method box's "Why this calibration" details stays collapsed by design — the formula and calibration summary are already visible above it, and opening it would push the board down.

## Run it

```sh
node main.ts --input <snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=fmgbq1n7&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
