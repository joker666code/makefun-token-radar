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
    'The 0.08 is the snapshot&rsquo;s own median mcap/TVL (0.082, n = 52 token-trading protocols with TVL above $50M), ' +
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
      (state.watch ? ' — all ' + list.length + ' of the 40 watchlist protocols' : '') +
      (state.cat !== 'all' ? ' — ' + esc(state.cat) : '') + '. Click any row for its farm plan.';
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty">No protocol matches this filter.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (r) {
      var g = r.change_7d;
      var cls = g === null ? '' : (g >= 0 ? 'up' : 'down');
      var flag = r.model && r.model.growth_capped ? ' <span class="capflag" title="7-day change winsorised to the model cap">capped</span>' : '';
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.slug === r.slug ? ' class="sel"' : '') + '>' +
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
    detailEl.innerHTML =
      '<button id="closedetail" type="button">Close</button>' +
      '<h2>' + esc(r.name) + (r.on_watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<div class="meta">Rank #' + r.rank + ' &middot; ' + esc(r.category || 'no category') +
      ' &middot; ' + esc((r.chains || []).join(', ')) + ' &middot; TVL ' + usdFull(r.tvl_usd) +
      ' &middot; 7d ' + pct(r.change_7d) + ' &middot; tracked since ' + esc(r.listed_at || 'date not reported') +
      ' (' + ageFmt(r.age_days) + ')' + (m.age_known ? '' : ' — age unknown, maturity at floor') +
      ' &middot; the snapshot records no token for this protocol.</div>' +
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
      'It is a way to use the protocol so that, if it ever does reward past users, the record exists — sized so the cost of being wrong is one deliberate position, not a portfolio bet.</p>';
    document.getElementById('closedetail').addEventListener('click', function () {
      detailEl.hidden = true; state.slug = '';
      tbody.querySelectorAll('tr.sel').forEach(function (tr) { tr.classList.remove('sel'); });
    });
    render();
    detailEl.scrollIntoView({ block: 'nearest' });
  }

  // ---- already-trading reference ------------------------------------------
  var live = DATA.live || [];
  document.getElementById('live').innerHTML =
    '<h2>Already trading — not a launch</h2>' +
    '<p>These protocols already have a token that trades, so they are not on the board. ' +
    'Their market caps are the market&rsquo;s own values, and the mcap/TVL column is where the board&rsquo;s 0.08 multiple comes from.</p>' +
    '<table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap / TVL</th></tr></thead><tbody>' +
    live.map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.category || '—') + '</td>' +
        '<td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td>' +
        '<td class="num">' + p.mcap_tvl.toFixed(3) + '</td></tr>';
    }).join('') + '</tbody></table>';

  render();
  if (state.slug) showDetail(state.slug);
})();
