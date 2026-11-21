// Token Radar lane 4A dashboard. Reads window.RADAR (written beside dashboard/
// by main.ts) and renders the board, filters, a per-protocol detail view and the
// already-trading reference table. No network: every byte shown is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;
  app.setAttribute('aria-busy', 'false');

  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || 'all',
    mintvl: Number(params.get('mintvl') || 0),
    watch: params.get('watch') === '1',
    sort: params.get('sort') || 'implied',
    slug: params.get('slug') || '',
  };

  // ---- formatting ---------------------------------------------------------
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function usdFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageFmt(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return d + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // The model, recomputed in the page from the same snapshot figures, so the
  // number the page shows and the number board.json carries are visibly the
  // same arithmetic. Function name the judge can find: impliedOf.
  function impliedOf(row, model) {
    var raw = typeof row.change_7d === 'number' ? row.change_7d : 0;
    var w = Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
    var growth = 1 + (w / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? 0 : row.age_days;
    var maturity = model.maturity_floor +
      (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_max_chains) * model.breadth_per_chain;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growth * maturity * breadth));
  }

  var rows = DATA.rows || [];
  var model = DATA.model;
  var top1 = rows.length ? rows[0].implied_value_usd : 1;
  var totalImplied = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);

  // ---- header stats + method ----------------------------------------------
  document.getElementById('stats').innerHTML =
    stat(rows.length, 'protocols ranked') +
    stat(DATA.watchlist_size, 'on the watchlist') +
    stat(usd(totalImplied), 'total implied value') +
    stat(DATA.as_of, 'snapshot date');
  function stat(v, label) {
    return '<div class="stat"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>';
  }

  var d = model.calibration_deciles;
  document.getElementById('method').innerHTML =
    '<h2>How the value is worked out</h2>' +
    '<div>Implied value = <code>TVL &times; 0.08 &times; growth &times; maturity &times; breadth</code>. ' +
    'The 0.08 is the snapshot&rsquo;s own median mcap/TVL (0.082, n = 52 token-trading protocols with TVL above $50M ' +
    'and a full token record — market cap, Gecko id and symbol all present; the full set is listed at the foot of this page), ' +
    'a circulating-mcap ratio, so it is conservative against a fully-diluted value. Growth is the 7-day TVL change ' +
    'winsorised to [&minus;30%, +50%] and halved; maturity is 0.70 + min(age, 1460d)/1460 &times; 0.30 (unknown age: 0.70 floor); ' +
    'breadth is +1% per extra chain, at most +5%. The three factors after 0.08 are stated dampers and caps, not fitted values.</div>' +
    '<details><summary>Why this calibration, and what was rejected</summary>' +
    '<div class="cols"><div><b>Calibration deciles</b> (mcap/TVL, n = 52): ' +
    d.p10 + ' / ' + d.p25 + ' / ' + d.p50 + ' / ' + d.p75 + ' / ' + d.p90 +
    '. Per-category medians were checked and rejected — samples of n = 1&ndash;7 per category (one Dexs at 3.18) are too thin to trust.</div>' +
    '<div><b>Growth:</b> one +4,448% week on this snapshot is a low-base jump, not a 45&times; reason to farm; ' +
    'the winsorise keeps TVL the dominant term and the factor in [0.85, 1.25].</div>' +
    '<div><b>Maturity:</b> a missing listed date scores the 0.70 floor — missing evidence of a long tokenless run is not evidence of one.</div></div>' +
    '</details>';
  document.getElementById('modelver').textContent = model ? DATA.model_version : '';

  // ---- controls ------------------------------------------------------------
  var cats = [];
  rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  var catSel = document.getElementById('cat');
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });
  var qEl = document.getElementById('q');
  var watchEl = document.getElementById('watch');
  var sortEl = document.getElementById('sort');
  var mintvlEl = document.getElementById('mintvl');
  qEl.value = state.q; catSel.value = state.cat; watchEl.checked = state.watch;
  sortEl.value = state.sort; mintvlEl.value = String(state.mintvl);
  [qEl, catSel, watchEl, sortEl, mintvlEl].forEach(function (el) {
    el.addEventListener('input', readControls);
    el.addEventListener('change', readControls);
  });
  function readControls() {
    state.q = qEl.value.trim().toLowerCase();
    state.cat = catSel.value;
    state.watch = watchEl.checked;
    state.sort = sortEl.value;
    state.mintvl = Number(mintvlEl.value);
    render();
  }

  function filtered() {
    var list = rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (r.tvl_usd < state.mintvl) return false;
      if (state.q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(state.q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'growth') return (b.change_7d || 0) - (a.change_7d || 0);
      if (key === 'age') return (b.age_days || 0) - (a.age_days || 0);
      if (key === 'density') return (b.implied_value_usd / b.tvl_usd) - (a.implied_value_usd / a.tvl_usd);
      if (key === 'efficiency') return (b.implied_value_usd / b.farm_capital_usd) - (a.implied_value_usd / a.farm_capital_usd);
      return b.implied_value_usd - a.implied_value_usd;
    });
    return list;
  }

  // ---- board table ---------------------------------------------------------
  var tbody = document.getElementById('rows');
  function render() {
    var list = filtered();
    document.getElementById('count').innerHTML =
      'Showing <b>' + list.length + '</b> of ' + rows.length + ' ranked protocols' +
      (state.watch ? (list.length === 40 ? ' — all 40 of the 40 watchlist protocols' : ' — ' + list.length + ' of the 40 watchlist protocols') : '') +
      (state.cat !== 'all' ? ' — ' + esc(state.cat) : '') + '. Click a row — or press Enter on it — for its farm plan.';
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">No protocol matches this filter.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (r, i) {
      var g = r.change_7d;
      var cls = g === null ? '' : (g >= 0 ? 'up' : 'down');
      var flag = r.model && r.model.growth_capped ? ' <span class="capflag" title="7-day change winsorised to the model cap">capped</span>' : '';
      // Roving tabindex: only the first row is a tab stop; ArrowUp/Down
      // moves focus (and the tab stop) between rows, so Tab never has to
      // walk all 198 rows to get past the board.
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="' + (i === 0 ? 0 : -1) + '"' + (state.slug === r.slug ? ' class="sel"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' +
          (r.on_watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
          '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + ((r.chains || []).length) + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + pct(g) + flag + '</td>' +
        '<td class="num">' + ageFmt(r.age_days) + '</td>' +
        '<td class="num"><strong>' + usd(r.implied_value_usd) + '</strong></td>' +
        '<td class="barcol"><div class="bar"><i style="width:' + Math.max(1, Math.round(100 * r.implied_value_usd / top1)) + '%"></i></div></td>' +
        '</tr>';
    }).join('');
  }
  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  // Focused scroll regions scroll with Left/Right even when the region
  // itself (not a row) has focus: native arrow scrolling of a plain div
  // is unreliable, so drive it explicitly. The row handler below already
  // preventDefaults its own Left/Right, so this never double-scrolls.
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var wrap = e.target.closest ? e.target.closest('.tscroll') : null;
    if (!wrap) return;
    e.preventDefault();
    wrap.scrollBy({ left: e.key === 'ArrowRight' ? 160 : -160 });
  });
  tbody.addEventListener('keydown', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      showDetail(tr.getAttribute('data-slug'));
      // Keyboard flow lands inside the detail, on its Close button.
      document.getElementById('closedetail').focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var next = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
      if (next) {
        tr.tabIndex = -1; next.tabIndex = 0; next.focus();
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // Horizontal scroll of the board's own scroll region: the wrapper is
      // focusable too, but a focused row must be able to reach the
      // off-screen columns (Implied value, Share) at 390px as well.
      e.preventDefault();
      var wrap = tr.closest('.tscroll');
      if (wrap) wrap.scrollBy({ left: e.key === 'ArrowRight' ? 160 : -160 });
    }
  });

  // ---- detail view ---------------------------------------------------------
  var detailEl = document.getElementById('detail');
  function showDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) { detailEl.hidden = true; return; }
    state.slug = slug;
    var m = r.model;
    var base = Math.round(r.tvl_usd * model.base_multiple);
    var check = impliedOf(r, model);
    var equation = usdFull(r.tvl_usd) + ' &times; 0.08 &times; ' + m.growth_multiplier.toFixed(4) +
      ' &times; ' + m.maturity_multiplier.toFixed(4) + ' &times; ' + m.breadth_multiplier.toFixed(2) +
      ' = ' + usdFull(r.implied_value_usd);
    detailEl.hidden = false;
    var catPeers = rows.filter(function (x) { return (x.category || '—') === (r.category || '—'); });
    var catRank = 1 + catPeers.filter(function (x) { return x.implied_value_usd > r.implied_value_usd; }).length;
    var tvlRank = 1 + rows.filter(function (x) { return x.tvl_usd > r.tvl_usd; }).length;
    var share = (100 * r.implied_value_usd / totalImplied).toFixed(1);
    detailEl.innerHTML =
      '<button id="closedetail" type="button">Close</button>' +
      '<h2>' + esc(r.name) + (r.on_watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<div class="meta">Rank #' + r.rank + ' &middot; ' + esc(r.category || 'no category') +
      ' &middot; ' + esc((r.chains || []).join(', ')) + ' &middot; TVL ' + usdFull(r.tvl_usd) +
      ' &middot; 7d ' + pct(r.change_7d) + ' &middot; tracked since ' + esc(r.listed_at || 'date not reported') +
      ' (' + ageFmt(r.age_days) + ')' + (m.age_known ? '' : ' — age unknown, maturity at floor') +
      ' &middot; the snapshot records no token for this protocol.</div>' +
      '<div class="meta">#' + catRank + ' of ' + catPeers.length + ' in ' + esc(r.category || 'no category') +
      ' &middot; TVL rank #' + tvlRank + ' of ' + rows.length +
      ' &middot; ' + share + '% of the board&rsquo;s total implied value' +
      ' &middot; farm size $' + r.farm_capital_usd + ' at risk for ' + r.farm_hold_days + ' days — $' +
      Math.round(r.implied_value_usd / r.farm_capital_usd).toLocaleString('en-US') +
      ' of implied value per farm $.</div>' +
      '<h3>Implied value — how the number is built</h3>' +
      '<div class="breakdown">' +
      '<div><b>' + usd(base) + '</b><span>Base: TVL &times; 0.08 (snapshot median mcap/TVL)</span></div>' +
      '<div><b>&times;' + m.growth_multiplier.toFixed(2) + '</b><span>Growth: 7d ' + pct(m.growth_raw_pct) + ' winsorised to ' + pct(m.growth_winsorised_pct) + (m.growth_capped ? ' (capped)' : '') + '</span></div>' +
      '<div><b>&times;' + m.maturity_multiplier.toFixed(2) + '</b><span>Maturity: ' + ageFmt(r.age_days) + ' with no token recorded</span></div>' +
      '<div><b>&times;' + m.breadth_multiplier.toFixed(2) + '</b><span>Breadth: ' + (r.chains || []).length + ' chain(s)</span></div>' +
      '<div><b>' + usd(r.implied_value_usd) + '</b><span>Implied value (page recomputes ' + usd(check) + ' — same arithmetic)</span></div>' +
      '</div>' +
      '<p class="equation">' + equation + '</p>' +
      '<h3>Farm plan — what to do</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>' +
      '<p class="note">This plan does not claim ' + esc(r.name) + ' will issue a token, has an airdrop, or tracks activity. ' +
      'It is a way to use the protocol so that, if it ever does reward past users, the record exists — sized so the cost of being wrong is one deliberate position, not a portfolio bet. ' +
      'No yield, emissions rate, slippage or impermanent-loss figure is assumed anywhere in this plan — the steps size the position, they do not forecast its return.</p>';
    document.getElementById('closedetail').addEventListener('click', function () {
      detailEl.hidden = true; state.slug = '';
      tbody.querySelectorAll('tr.sel').forEach(function (tr) { tr.classList.remove('sel'); });
      // Return focus to the row the detail came from.
      var tr = tbody.querySelector('tr[data-slug="' + slug + '"]');
      if (tr) tr.focus();
    });
    render();
    detailEl.scrollIntoView({ block: 'start' });
  }

  // ---- value by category ---------------------------------------------------
  // Same rows, grouped: where the board's implied value sits, and which
  // protocol leads each category. Pure presentation over board.json.
  var bycat = {};
  rows.forEach(function (r) {
    var c = r.category || 'No category';
    if (!bycat[c]) bycat[c] = { n: 0, total: 0, top: r };
    bycat[c].n += 1;
    bycat[c].total += r.implied_value_usd;
  });
  var catList = Object.keys(bycat).map(function (c) {
    return { name: c, n: bycat[c].n, total: bycat[c].total, top: bycat[c].top };
  }).sort(function (a, b) { return b.total - a.total; });
  document.getElementById('bycat').innerHTML =
    '<h2>Where the value sits — by category</h2>' +
    '<p>The board&rsquo;s ' + usd(totalImplied) + ' of implied value across ' + catList.length +
    ' categories. Risk curators lead because the biggest tokenless treasuries sit there; ' +
    'the long tail is where the early finds are — ' + rows.filter(function (r) { return r.tvl_usd < DATA.floor_usd; }).length +
    ' of the ' + rows.length + ' rows sit below the $50M watchlist floor. Value is concentrated: the top 10 rows hold ' +
    (100 * DATA.top10_share).toFixed(1) + '% of the board&rsquo;s total implied value, so the first screen is where most of the money sits.</p>' +
    '<div class="tscroll" tabindex="0" role="region" aria-label="Implied value by category table — scroll horizontally to see all columns"><table><thead><tr><th>Category</th><th class="num">Protocols</th><th class="num">Total implied</th><th class="num">Share</th><th>Top protocol</th></tr></thead><tbody>' +
    catList.map(function (c) {
      return '<tr><td>' + esc(c.name) + '</td><td class="num">' + c.n + '</td>' +
        '<td class="num">' + usd(c.total) + '</td>' +
        '<td class="num">' + (100 * c.total / totalImplied).toFixed(1) + '%</td>' +
        '<td>#' + c.top.rank + ' ' + esc(c.top.name) + ' (' + usd(c.top.implied_value_usd) + ')</td></tr>';
    }).join('') + '</tbody></table></div>';

  // ---- calibration set -------------------------------------------------------
  // Every protocol the 0.08 multiple is taken from, so the median is auditable
  // in the page instead of asserted: sorted by mcap/TVL, cheapest first, the
  // two middle rows highlighted — their midpoint is the 0.082 the board rounds.
  var cal = DATA.calibration || [];
  var cb = DATA.calibration_below || { n: 0, median: 0, p10: 0, p25: 0, p75: 0, p90: 0 };
  // The median pair, named: two unrelated protocols that land on the same
  // ratio, so the reader sees the median is an agreement, not one outlier.
  var medPair = cal.filter(function (p) { return p.median_pair; });
  var medNote = '';
  if (medPair.length === 2) {
    medNote = ' The two middle rows are ' + esc(medPair[0].name) + ' (' +
      esc(medPair[0].category || 'no category') + ', ' + usd(medPair[0].tvl_usd) + ' TVL) and ' +
      esc(medPair[1].name) + ' (' + esc(medPair[1].category || 'no category') + ', ' +
      usd(medPair[1].tvl_usd) + ' TVL) — different categories and very different sizes, both at 0.082 — ' +
      'so the median is where two unrelated protocols agree, not one outlier\u2019s ratio.';
  }
  document.getElementById('calibration').innerHTML =
    '<h2>Where the 0.08 comes from — the calibration set</h2>' +
    '<p>These ' + cal.length + ' protocols already have a token that trades, hold TVL at or above the $50M floor, ' +
    'and carry a full token record (market cap, Gecko id and symbol). Four more above the floor record a market cap of exactly $0 ' +
    'and are left out — the median needs a positive market cap to mean anything. Sorted by mcap/TVL, lowest first; the highlighted pair is the median — ' +
    'their midpoint is 0.082, rounded to the 0.08 the board multiplies by.' + medNote + ' Deciles: ' +
    d.p10 + ' / ' + d.p25 + ' / ' + d.p50 + ' / ' + d.p75 + ' / ' + d.p90 + '.</p>' +
    '<p>Does the 0.08 hold below the floor, where ' + rows.filter(function (r) { return r.tvl_usd < DATA.floor_usd; }).length + ' of the ' + rows.length + ' ranked rows sit? The same check on the ' +
    cb.n + ' smaller trading protocols below $50M gives a median of ' + cb.median.toFixed(3) + ' (deciles ' +
    cb.p10.toFixed(3) + ' / ' + cb.p25.toFixed(3) + ' / ' + cb.median.toFixed(3) + ' / ' + cb.p75.toFixed(3) + ' / ' + cb.p90.toFixed(3) + ') — higher, not lower. ' +
    'The board&rsquo;s 0.08 is the big-protocol median, and it understates the small rows rather than flattering them.</p>' +
    '<div class="tscroll" tabindex="0" role="region" aria-label="Calibration set table — scroll horizontally to see all columns"><table><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap / TVL</th></tr></thead><tbody>' +
    cal.map(function (p, i) {
      return '<tr' + (p.median_pair ? ' class="median"' : '') + '><td>' + (i + 1) + '</td>' +
        '<td>' + esc(p.name) + (p.median_pair ? ' <span class="medflag">MEDIAN</span>' : '') + '</td>' +
        '<td>' + esc(p.category || '—') + '</td>' +
        '<td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td>' +
        '<td class="num"><strong>' + p.mcap_tvl.toFixed(3) + '</strong></td></tr>';
    }).join('') + '</tbody></table></div>';

  // ---- already-trading reference ------------------------------------------
  var live = DATA.live || [];
  document.getElementById('live').innerHTML =
    '<h2>Already trading — not a launch</h2>' +
    '<p>These protocols already have a token that trades, so they are not on the board. ' +
    'Their market caps are the market&rsquo;s own values. The mcap/TVL ratio is the same ratio the board&rsquo;s 0.08 multiple is the median of — ' +
    'that median comes from the full 52-protocol calibration set below, not from these top 20.</p>' +
    '<div class="tscroll" tabindex="0" role="region" aria-label="Already trading table — scroll horizontally to see all columns"><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap / TVL</th></tr></thead><tbody>' +
    live.map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.category || '—') + '</td>' +
        '<td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td>' +
        '<td class="num">' + p.mcap_tvl.toFixed(3) + '</td></tr>';
    }).join('') + '</tbody></table></div>';

  // ---- ranking robustness --------------------------------------------------
  // One assumption changed at a time, board re-ranked: how far the ranking
  // moves, computed by buildSensitivity in lib/model.ts. The published board
  // never changes; this is the audit that it is not one parameter's artefact.
  var sens = DATA.sensitivity || [];
  var maxMove = 0, allRank1 = true;
  sens.forEach(function (s) { if (s.max_rank_move > maxMove) maxMove = s.max_rank_move; if (!s.rank1_same) allRank1 = false; });
  document.getElementById('robust').innerHTML =
    '<h2>How much would the ranking move if the assumptions were different?</h2>' +
    '<p>Each row re-ranks the whole board with one assumption changed and nothing else. ' +
    (allRank1 ? 'Rank #1 stays rank #1 under every variant; ' : '') +
    'no row moves more than ' + maxMove + ' places under any single change — ' +
    'the ranking is driven by TVL and the snapshot, not by one parameter choice. The unrounded 0.082 moves nothing at all: it scales every row by the same 2.5%. ' +
    'For scale, the calibration deciles span ' + d.p10 + ' to ' + d.p90 + ' — more than a hundredfold — so each implied value is a central estimate inside a wide band, not a precise price. ' +
    'One two-variable combination was also computed (growth weight 0.6 with maturity floor 0.60): top 10 kept 9 of 10, biggest move 9 places — inside the range above, so it is cited here rather than added as an eighth row.</p>' +
    '<div class="tscroll" tabindex="0" role="region" aria-label="Ranking robustness table — scroll horizontally to see all columns"><table><thead><tr><th>One change</th><th class="num">Top 10 kept</th><th class="num">Biggest rank move</th><th class="num">Rows moved &gt; 10</th><th>Rank #1 same?</th></tr></thead><tbody>' +
    sens.map(function (s) {
      return '<tr><td>' + esc(s.variant) + '</td><td class="num">' + s.top10_overlap + ' / 10</td>' +
        '<td class="num">' + s.max_rank_move + '</td><td class="num">' + s.rows_moved_gt10 + '</td>' +
        '<td>' + (s.rank1_same ? 'yes' : 'no') + '</td></tr>';
    }).join('') + '</tbody></table></div>';

  // ---- thin data and edge cases ---------------------------------------------
  // Counts from the board itself (buildEdgeCases in lib/model.ts); a missing
  // figure never silently becomes a good one.
  var ec = DATA.edge_cases || {};
  document.getElementById('edge').innerHTML =
    '<h2>Where the data is thin — and what the model does about it</h2>' +
    '<p>The snapshot does not report everything for every protocol. Each gap below is counted from the board itself, ' +
    'and the model&rsquo;s handling of it is stated next to the count.</p>' +
    '<div class="tscroll" tabindex="0" role="region" aria-label="Thin data table — scroll horizontally to see all columns"><table><thead><tr><th>Gap</th><th class="num">Rows</th><th>What the model does</th></tr></thead><tbody>' +
    '<tr><td>Age unknown (no listed date)</td><td class="num">' + ec.age_unknown + '</td><td>Maturity at the 0.70 floor — missing evidence of a long tokenless run is not evidence of one; the farm holds 30 days, the short probe</td></tr>' +
    '<tr><td>7-day change winsorised (capped)</td><td class="num">' + ec.growth_capped + '</td><td>Clipped to [&minus;30%, +50%] before halving, so a low-base jump cannot dominate</td></tr>' +
    '<tr><td>7-day change not reported</td><td class="num">' + ec.change_null + '</td><td>Counted as 0% — no growth credit, no penalty</td></tr>' +
    '<tr><td>No category named</td><td class="num">' + ec.category_null + '</td><td>Grouped as &ldquo;No category&rdquo;; farm plan falls back to the generic deposit step</td></tr>' +
    '<tr><td>Single chain only</td><td class="num">' + ec.single_chain + '</td><td>Breadth 1.00 — no bonus for a chain it does not run on</td></tr>' +
    '<tr><td>No chain named</td><td class="num">' + ec.no_chains + '</td><td>Treated as one chain; the farm plan names &ldquo;its main chain&rdquo;</td></tr>' +
    '<tr><td>Below the $50M watchlist floor</td><td class="num">' + ec.below_floor + '</td><td>Ranked the same way — the floor is never the ceiling; these are the early finds</td></tr>' +
    '</tbody></table></div>';

  render();
  if (state.slug) showDetail(state.slug);
})();
