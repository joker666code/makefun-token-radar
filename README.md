# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/joker666code/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/joker666code/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: ranks 198 protocols by implied launch value from a sealed DefiLlama snapshot (top: Steakhouse Financial at $185.7M), with a static offline dashboard (board, protocol detail, filtered views) and a farm plan for each protocol.

Model v2 adds a per-category value breakdown, the full 52-protocol calibration set behind the 0.08 multiple (median pair highlighted), a per-protocol context line (category rank, TVL rank, share of board value, farm size), and an implied-per-$TVL sort. Board values are unchanged from v1 — the model is the same; v2 makes its calibration auditable in the page.

## Run it

```sh
node main.ts --input <snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=fmgbq1n7&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
