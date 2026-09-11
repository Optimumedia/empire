/* Empire City — an isometric town fed by real life.
   Grit (earned by missions) buys and upgrades buildings.
   Bucks (the town's own income) buy decor, boosts, and are the Ad Auction payout.
   Pure helpers are exported so the main app can price things; mount() runs the canvas. */
window.City = (() => {
  'use strict';

  const N = 6; // grid
  const TW = 64, TH = 32, TWH = 32, THH = 16;
  const GROWTH = 1.15, OFFLINE_CAP_MS = 8 * 3600e3, MAX_LV = 30;
  const DISTRICTS = {
    business: { name: 'Downtown',  hue: 210, x0: 0, y0: 0 },
    family:   { name: 'Hillside',  hue: 325, x0: 3, y0: 0 },
    body:     { name: 'Riverside', hue: 18,  x0: 0, y0: 3 },
    health:   { name: 'Greenbelt', hue: 145, x0: 3, y0: 3 },
  };
  const BUILDINGS = {
    hq:        { d: 'business', name: 'Agency HQ',    e: '🏢', cost: 60,  inc: 2,  unlock: 1 },
    billboard: { d: 'business', name: 'Billboard',    e: '📣', cost: 90,  inc: 3,  unlock: 2 },
    studio:    { d: 'business', name: 'Studio',       e: '🎬', cost: 150, inc: 5,  unlock: 3 },
    tower:     { d: 'business', name: 'Media Tower',  e: '📡', cost: 400, inc: 12, unlock: 5 },
    home:      { d: 'family',   name: 'Home',         e: '🏠', cost: 60,  inc: 2,  unlock: 1 },
    playground:{ d: 'family',   name: 'Playground',   e: '🛝', cost: 90,  inc: 3,  unlock: 2 },
    school:    { d: 'family',   name: 'School',       e: '🏫', cost: 150, inc: 5,  unlock: 3 },
    park:      { d: 'family',   name: 'Grand Park',   e: '🌳', cost: 400, inc: 12, unlock: 5 },
    gym:       { d: 'body',     name: 'Gym',          e: '🏋️', cost: 60,  inc: 2,  unlock: 1 },
    track:     { d: 'body',     name: 'Track',        e: '🏃', cost: 90,  inc: 3,  unlock: 2 },
    pool:      { d: 'body',     name: 'Pool',         e: '🏊', cost: 150, inc: 5,  unlock: 3 },
    stadium:   { d: 'body',     name: 'Stadium',      e: '🏟️', cost: 400, inc: 12, unlock: 5 },
    clinic:    { d: 'health',   name: 'Clinic',       e: '🏥', cost: 60,  inc: 2,  unlock: 1 },
    garden:    { d: 'health',   name: 'Garden',       e: '🌿', cost: 90,  inc: 3,  unlock: 2 },
    lodge:     { d: 'health',   name: 'Sleep Lodge',  e: '🛏️', cost: 150, inc: 5,  unlock: 3 },
    spa:       { d: 'health',   name: 'Spa',          e: '♨️', cost: 400, inc: 12, unlock: 5 },
  };
  const DECOR = {
    road: { name: 'Road',        e: '🛣️', bucks: 400,  bonus: 0.03 },
    tree: { name: 'Trees',       e: '🌲', bonus: 0.03, bucks: 700 },
    lamp: { name: 'Streetlight', e: '💡', bonus: 0.04, bucks: 1200 },
    fountain: { name: 'Fountain', e: '⛲', bonus: 0.06, bucks: 2500 },
  };
  const BOOST_COST = 2000, BOOST_MS = 8 * 3600e3;

  const districtOf = (x, y) => { for (const k in DISTRICTS) { const d = DISTRICTS[k]; if (x >= d.x0 && x < d.x0 + 3 && y >= d.y0 && y < d.y0 + 3) return k; } return null; };
  const upgradeCost = (b, lv) => Math.round(b.cost * Math.pow(GROWTH, lv));            // cost to go lv → lv+1 (lv 0 = build)
  const totalCost = (b, lv) => Math.round(b.cost * (Math.pow(GROWTH, lv) - 1) / (GROWTH - 1)); // grit sunk to reach lv
  const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));

  const emptyCity = () => ({ plots: {}, decor: {}, ledger: {}, lastCollect: { t: 0 }, boost: { until: 0, t: 0 }, skill: { v: 0, t: 0 }, auction: {}, seen: {} });
  function norm(c) {
    const out = emptyCity();
    if (!c || typeof c !== 'object') return out;
    for (const k in c.plots || {}) { const p = c.plots[k]; if (p && BUILDINGS[p.type]) out.plots[k] = { type: p.type, lv: Math.max(0, Math.min(MAX_LV, +p.lv || 0)), t: +p.t || 0 }; }
    for (const k in c.decor || {}) { const p = c.decor[k]; if (p && DECOR[p.type]) out.decor[k] = { type: p.type, on: !!p.on, t: +p.t || 0 }; }
    for (const k in c.ledger || {}) { const l = c.ledger[k]; if (l) out.ledger[k] = { earned: +l.earned || 0, spent: +l.spent || 0 }; }
    out.lastCollect = { t: +(c.lastCollect && c.lastCollect.t) || 0 };
    out.boost = { until: +(c.boost && c.boost.until) || 0, t: +(c.boost && c.boost.t) || 0 };
    out.skill = { v: +(c.skill && c.skill.v) || 0, t: +(c.skill && c.skill.t) || 0 };
    for (const k in c.auction || {}) { const a = c.auction[k]; if (a) out.auction[k] = { plays: +a.plays || 0, hits: +a.hits || 0, won: +a.won || 0 }; }
    for (const k in c.seen || {}) out.seen[k] = true;
    return out;
  }
  function merge(a, b) {
    a = norm(a); b = norm(b); const out = emptyCity();
    const keys = (x, y) => [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
    const newer = (x, y) => (!x ? y : !y ? x : (x.t || 0) >= (y.t || 0) ? x : y);
    for (const k of keys(a.plots, b.plots)) out.plots[k] = newer(a.plots[k], b.plots[k]);
    for (const k of keys(a.decor, b.decor)) out.decor[k] = newer(a.decor[k], b.decor[k]);
    for (const k of keys(a.ledger, b.ledger)) { const x = a.ledger[k] || { earned: 0, spent: 0 }, y = b.ledger[k] || { earned: 0, spent: 0 }; out.ledger[k] = { earned: Math.max(x.earned, y.earned), spent: Math.max(x.spent, y.spent) }; }
    out.lastCollect = { t: Math.max(a.lastCollect.t, b.lastCollect.t) };
    out.boost = newer(a.boost, b.boost); out.skill = newer(a.skill, b.skill);
    for (const k of keys(a.auction, b.auction)) { const x = a.auction[k] || { plays: 0, hits: 0, won: 0 }, y = b.auction[k] || { plays: 0, hits: 0, won: 0 }; out.auction[k] = { plays: Math.max(x.plays, y.plays), hits: Math.max(x.hits, y.hits), won: Math.max(x.won, y.won) }; }
    for (const k of keys(a.seen, b.seen)) out.seen[k] = true;
    return out;
  }

  // ---- economy ----
  const gritSpent = c => Object.values(c.plots).reduce((s, p) => s + totalCost(BUILDINGS[p.type], p.lv), 0);
  const bucks = c => Object.values(c.ledger).reduce((s, l) => s + l.earned - l.spent, 0);
  function adjacency(c, x, y) {
    const me = c.plots[`${x},${y}`]; if (!me) return 0; let n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const o = c.plots[`${x + dx},${y + dy}`]; if (o && BUILDINGS[o.type].d !== BUILDINGS[me.type].d) n++; }
    return Math.min(0.3, n * 0.1);
  }
  const decorBonus = c => Object.values(c.decor).reduce((s, d) => s + (d.on ? DECOR[d.type].bonus : 0), 0);
  function incomePerMin(c, vitality) {
    let s = 0;
    for (const k in c.plots) { const [x, y] = k.split(',').map(Number); const p = c.plots[k]; const b = BUILDINGS[p.type]; if (p.lv <= 0) continue; s += b.inc * p.lv * (1 + adjacency(c, x, y)) * (vitality[b.d] || 1); }
    s *= 1 + decorBonus(c);
    if (c.boost.until > Date.now()) s *= 2;
    return s;
  }
  function pending(c, vitality, now) {
    if (!c.lastCollect.t) return 0;
    const ms = Math.max(0, Math.min(OFFLINE_CAP_MS, now - c.lastCollect.t));
    return incomePerMin(c, vitality) * ms / 60000;
  }
  function population(c, vitality) {
    const ds = Object.keys(DISTRICTS); const avg = ds.reduce((s, d) => s + (vitality[d] || 1), 0) / ds.length;
    return Math.round(Object.values(c.plots).reduce((s, p) => s + p.lv * 4, 0) * avg);
  }
  const districtLevel = c => { const out = {}; for (const k in c.plots) { const b = BUILDINGS[c.plots[k].type]; out[b.d] = (out[b.d] || 0) + c.plots[k].lv; } return out; };

  // =====================================================================
  // Controller: canvas + panel
  // =====================================================================
  function mount(opts) {
    const { canvas, panel, hud, get, commit, toast, deviceId } = opts;
    // get() → { city, grit, vitality, statLevels, todayKey }
    const ctx = canvas.getContext('2d');
    let sel = null, scale = 1, ox = 0, oy = 0, W = 0, H = 0, raf = 0, visible = false, lastFrame = 0;
    let citizens = [];
    let auction = null; // live mini-game
    const now = () => Date.now();

    function size() {
      const cssW = canvas.clientWidth || 360; const dpr = window.devicePixelRatio || 1;
      W = cssW; scale = cssW / (N * TW + 40); H = Math.round((N * TH + 120) * scale);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.height = H + 'px';
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      ox = (W / scale) / 2; oy = 60;
    }
    const toScreen = (mx, my) => [ox + (mx - my) * TWH, oy + (mx + my) * THH];
    function toGrid(sx, sy) { const x = sx - ox, y = sy - oy; return [Math.floor((x / TWH + y / THH) / 2), Math.floor((y / THH - x / TWH) / 2)]; }

    function tileColor(d, vit, lit) {
      const h = DISTRICTS[d].hue; const v = Math.max(0.5, Math.min(1.5, vit || 1));
      const sat = 20 + 40 * (v - 0.5); const light = lit ? 78 - 10 * (v - 1) : 70 - 10 * (v - 1);
      return `hsl(${h} ${sat}% ${light}%)`;
    }
    function drawTile(x, y, d, vit, selected) {
      const [sx, sy] = toScreen(x, y);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + TWH, sy + THH); ctx.lineTo(sx, sy + TH); ctx.lineTo(sx - TWH, sy + THH); ctx.closePath();
      ctx.fillStyle = tileColor(d, vit, true); ctx.fill();
      ctx.strokeStyle = selected ? '#F2B233' : 'rgba(0,0,0,.12)'; ctx.lineWidth = selected ? 2.5 : 1; ctx.stroke();
    }
    function drawBlock(x, y, p, vit, selected) {
      const b = BUILDINGS[p.type]; const h = Math.min(90, 6 + p.lv * 3); const [sx, sy0] = toScreen(x, y); const sy = sy0 + THH; // center of tile
      const hue = DISTRICTS[b.d].hue; const v = Math.max(0.5, Math.min(1.5, vit || 1)); const sat = 30 + 35 * (v - 0.5);
      const top = `hsl(${hue} ${sat}% ${62 + 6 * (v - 1)}%)`, left = `hsl(${hue} ${sat}% 46%)`, right = `hsl(${hue} ${sat}% 38%)`;
      const inset = 8;
      const T = [[sx, sy - THH + inset / 2], [sx + TWH - inset, sy], [sx, sy + THH - inset / 2], [sx - TWH + inset, sy]];
      // left face
      ctx.beginPath(); ctx.moveTo(T[3][0], T[3][1]); ctx.lineTo(T[2][0], T[2][1]); ctx.lineTo(T[2][0], T[2][1] - h); ctx.lineTo(T[3][0], T[3][1] - h); ctx.closePath(); ctx.fillStyle = left; ctx.fill();
      // right face
      ctx.beginPath(); ctx.moveTo(T[2][0], T[2][1]); ctx.lineTo(T[1][0], T[1][1]); ctx.lineTo(T[1][0], T[1][1] - h); ctx.lineTo(T[2][0], T[2][1] - h); ctx.closePath(); ctx.fillStyle = right; ctx.fill();
      // top
      ctx.beginPath(); ctx.moveTo(T[0][0], T[0][1] - h); ctx.lineTo(T[1][0], T[1][1] - h); ctx.lineTo(T[2][0], T[2][1] - h); ctx.lineTo(T[3][0], T[3][1] - h); ctx.closePath(); ctx.fillStyle = top; ctx.fill();
      if (selected) { ctx.strokeStyle = '#F2B233'; ctx.lineWidth = 2.5; ctx.stroke(); }
      // windows (tier 2 at lv>=10)
      if (p.lv >= 10) { ctx.fillStyle = 'rgba(255,240,170,.85)'; for (let i = 1; i < Math.min(6, Math.floor(h / 12)); i++) { ctx.fillRect(sx - 18, sy - 2 - i * 12, 5, 5); ctx.fillRect(sx + 12, sy - 2 - i * 12, 5, 5); } }
      ctx.font = `${p.lv >= 10 ? 22 : 18}px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.e, sx, sy - h - 2);
      ctx.font = 'bold 9px "Chakra Petch", sans-serif'; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillText(`L${p.lv}`, sx, sy + 4);
    }
    function drawDecor(x, y, d) {
      const [sx, sy] = toScreen(x, y);
      ctx.font = '16px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(DECOR[d.type].e, sx, sy + THH - 2);
    }
    function draw() {
      const S = get(); const c = S.city; const vit = S.vitality;
      ctx.clearRect(0, 0, W / scale, H / scale);
      // ground
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const d = districtOf(x, y); drawTile(x, y, d, vit[d], sel && sel[0] === x && sel[1] === y); }
      // district labels
      ctx.font = 'bold 10px "Chakra Petch", sans-serif'; ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.textAlign = 'center';
      for (const k in DISTRICTS) { const d = DISTRICTS[k]; const [sx, sy] = toScreen(d.x0 + 1, d.y0 + 1); const locked = !S.unlocked[k]; ctx.fillText((locked ? '🔒 ' : '') + d.name.toUpperCase() + (vit[k] < 0.8 ? ' · DORMANT' : ''), sx, sy + THH + (locked ? 0 : 26)); }
      // buildings, painter's order
      const items = [];
      for (const k in c.plots) { const [x, y] = k.split(',').map(Number); items.push({ x, y, p: c.plots[k] }); }
      for (const k in c.decor) { const [x, y] = k.split(',').map(Number); if (c.decor[k].on) items.push({ x, y, d: c.decor[k] }); }
      items.sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.x - b.x);
      for (const it of items) { const d = districtOf(it.x, it.y); if (it.p) drawBlock(it.x, it.y, it.p, vit[d], sel && sel[0] === it.x && sel[1] === it.y); else drawDecor(it.x, it.y, it.d); }
      // citizens
      ctx.fillStyle = 'rgba(20,32,43,.75)';
      for (const z of citizens) { const [sx, sy] = toScreen(z.x, z.y); ctx.beginPath(); ctx.arc(sx, sy + THH, 2.2, 0, Math.PI * 2); ctx.fill(); }
    }
    function stepCitizens(dt) {
      const S = get(); const target = Math.min(24, Math.floor(population(S.city, S.vitality) / 12));
      while (citizens.length < target) citizens.push({ x: Math.random() * N, y: Math.random() * N, tx: Math.random() * N, ty: Math.random() * N });
      citizens.length = Math.min(citizens.length, target);
      for (const z of citizens) { const dx = z.tx - z.x, dy = z.ty - z.y; const d = Math.hypot(dx, dy); if (d < 0.05) { z.tx = Math.random() * N; z.ty = Math.random() * N; } else { z.x += dx / d * dt * 0.35; z.y += dy / d * dt * 0.35; } }
    }
    function loop(ts) {
      if (!visible) { raf = 0; return; }
      if (ts - lastFrame >= 33) { const dt = Math.min(0.1, (ts - lastFrame) / 1000); lastFrame = ts; stepCitizens(dt); draw(); if (auction) drawAuction(ts); }
      raf = requestAnimationFrame(loop);
    }
    function show(v) { visible = v; if (v) { size(); renderHud(); renderPanel(); if (!raf) raf = requestAnimationFrame(loop); } }

    // ---- HUD (pending pile, bucks, pop) ----
    function renderHud() {
      const S = get(); const c = S.city; const t = now();
      const pend = pending(c, S.vitality, t); const inc = incomePerMin(c, S.vitality);
      const boosted = c.boost.until > t;
      hud.innerHTML = `
        <div class="ctile"><div class="k">Grit</div><div class="v">${fmt(S.grit)}</div><div class="s">from real life</div></div>
        <div class="ctile"><div class="k">Bucks</div><div class="v">${fmt(bucks(c))}</div><div class="s">${fmt(inc * 60)}/h${boosted ? ' · 2× boost' : ''}</div></div>
        <div class="ctile"><div class="k">Population</div><div class="v">${fmt(population(c, S.vitality))}</div><div class="s">${Object.keys(c.plots).length} buildings</div></div>
        <button class="collect${pend >= 1 ? ' ready' : ''}" id="city-collect" ${pend >= 1 ? '' : 'disabled'}>${c.lastCollect.t ? `Collect ${fmt(pend)} Bucks` : 'Start the clock'}<span class="s">8 h offline cap</span></button>`;
      hud.querySelector('#city-collect').addEventListener('click', () => {
        const S2 = get(); const c2 = S2.city; const t2 = now(); const p = Math.floor(pending(c2, S2.vitality, t2));
        const l = (c2.ledger[deviceId] ||= { earned: 0, spent: 0 }); l.earned += p; c2.lastCollect.t = t2;
        commit(); if (p > 0) toast(`+${fmt(p)} Bucks collected`); renderHud(); renderPanel();
      });
    }

    // ---- Panel (selected tile / actions / auction) ----
    function renderPanel() {
      if (auction) return;
      const S = get(); const c = S.city; const k = S.todayKey;
      const a = c.auction[k] || { plays: 0, hits: 0, won: 0 };
      let html = '';
      if (!sel) {
        html = `<div class="chint">Tap a plot to build or upgrade. Buildings cost <b>Grit</b> — earned only by real missions. Their income is <b>Bucks</b>.</div>`;
      } else {
        const [x, y] = sel; const d = districtOf(x, y); const key = `${x},${y}`; const p = c.plots[key]; const dec = c.decor[key];
        const lvl = S.statLevels[d] || 1; const cap = lvl * 3;
        if (!S.unlocked[d]) html = `<div class="chint">🔒 <b>${DISTRICTS[d].name}</b> opens when your <b>${d[0].toUpperCase() + d.slice(1)}</b> stat reaches level 2. Earn it in real life.</div>`;
        else if (p) {
          const b = BUILDINGS[p.type]; const cost = upgradeCost(b, p.lv); const adj = adjacency(c, x, y); const inc = b.inc * p.lv * (1 + adj) * (S.vitality[d] || 1);
          html = `<div class="csel"><span class="e">${b.e}</span><div><b>${b.name}</b> · level ${p.lv}${p.lv >= cap ? ' (cap)' : ''}<div class="s">${fmt(inc * 60)} Bucks/h${adj ? ` · +${Math.round(adj * 100)}% neighbours` : ''} · ${DISTRICTS[d].name} ${Math.round((S.vitality[d] || 1) * 100)}% vitality</div></div></div>
            <div class="cact">${p.lv >= cap ? `<span class="s">Level cap ${cap} — raise your ${d} stat to level ${lvl + 1} to build higher.</span>` : `<button class="btn primary" data-up="${key}" ${S.grit >= cost ? '' : 'disabled'}>Upgrade · ${fmt(cost)} Grit</button>`}</div>`;
        } else if (dec && dec.on) {
          html = `<div class="csel"><span class="e">${DECOR[dec.type].e}</span><div><b>${DECOR[dec.type].name}</b><div class="s">+${Math.round(DECOR[dec.type].bonus * 100)}% town income</div></div></div>`;
        } else {
          const opts = Object.entries(BUILDINGS).filter(([, b]) => b.d === d);
          html = `<div class="chint"><b>${DISTRICTS[d].name}</b> · empty plot. Build with Grit, or decorate with Bucks.</div><div class="cgrid">` +
            opts.map(([id, b]) => { const locked = lvl < b.unlock; const ok = !locked && S.grit >= b.cost; return `<button class="cbtn" data-build="${id}" data-key="${key}" ${ok ? '' : 'disabled'}><span class="e">${locked ? '🔒' : b.e}</span><b>${b.name}</b><span class="s">${locked ? `${d} lv ${b.unlock}` : `${b.cost} Grit · ${b.inc}/min`}</span></button>`; }).join('') +
            Object.entries(DECOR).map(([id, dd]) => `<button class="cbtn decor" data-decor="${id}" data-key="${key}" ${bucks(c) >= dd.bucks ? '' : 'disabled'}><span class="e">${dd.e}</span><b>${dd.name}</b><span class="s">${fmt(dd.bucks)} Bucks · +${Math.round(dd.bonus * 100)}%</span></button>`).join('') + `</div>`;
        }
      }
      const boosted = c.boost.until > now();
      html += `<div class="crow">
        <button class="btn" id="city-auction" ${a.plays >= 3 ? 'disabled' : ''}>🎯 Ad Auction · ${3 - a.plays} left today</button>
        <button class="btn" id="city-boost" ${boosted || bucks(c) < BOOST_COST ? 'disabled' : ''}>${boosted ? `⚡ Boost on · ${Math.ceil((c.boost.until - now()) / 3600e3)} h` : `⚡ 2× income 8 h · ${fmt(BOOST_COST)} Bucks`}</button>
      </div>`;
      panel.innerHTML = html;
    }
    panel.addEventListener('click', e => {
      const S = get(); const c = S.city;
      const up = e.target.closest('[data-up]'), bd = e.target.closest('[data-build]'), dc = e.target.closest('[data-decor]');
      if (up) { const p = c.plots[up.dataset.up]; const b = BUILDINGS[p.type]; const cost = upgradeCost(b, p.lv); if (S.grit < cost) return; p.lv++; p.t = now(); commit(); toast(`${b.name} → level ${p.lv}`); }
      else if (bd) { const b = BUILDINGS[bd.dataset.build]; if (S.grit < b.cost) return; c.plots[bd.dataset.key] = { type: bd.dataset.build, lv: 1, t: now() }; if (!c.lastCollect.t) c.lastCollect.t = now(); commit(); toast(`${b.e} ${b.name} built`); }
      else if (dc) { const dd = DECOR[dc.dataset.decor]; if (bucks(c) < dd.bucks) return; const l = (c.ledger[deviceId] ||= { earned: 0, spent: 0 }); l.spent += dd.bucks; c.decor[dc.dataset.key] = { type: dc.dataset.decor, on: true, t: now() }; commit(); toast(`${dd.e} ${dd.name} placed`); }
      else if (e.target.closest('#city-boost')) { if (bucks(c) < BOOST_COST) return; const l = (c.ledger[deviceId] ||= { earned: 0, spent: 0 }); l.spent += BOOST_COST; c.boost = { until: now() + BOOST_MS, t: now() }; commit(); toast('⚡ Income doubled for 8 hours'); }
      else if (e.target.closest('#city-auction')) { startAuction(); return; }
      else return;
      renderHud(); renderPanel(); draw();
    });
    canvas.addEventListener('pointerdown', e => {
      if (auction) { stopAuction(); return; }
      const r = canvas.getBoundingClientRect(); const sx = (e.clientX - r.left) / scale, sy = (e.clientY - r.top) / scale;
      const [gx, gy] = toGrid(sx, sy);
      sel = (gx >= 0 && gy >= 0 && gx < N && gy < N) ? [gx, gy] : null;
      renderPanel(); draw();
    });

    // ---- Ad Auction: stop the needle in the winning-bid zone ----
    function startAuction() {
      const S = get(); const c = S.city; const k = S.todayKey; const a = (c.auction[k] ||= { plays: 0, hits: 0, won: 0 });
      if (a.plays >= 3) return;
      const L = c.skill.v; const w = Math.max(0.08, 0.30 * Math.pow(0.94, L)); const T = Math.max(0.55, 1.4 * Math.pow(0.97, L));
      const zone = 0.1 + Math.random() * (0.8 - w);
      const base = Math.max(20, incomePerMin(c, S.vitality) * 60 * 24 * 0.1);
      auction = { t0: performance.now(), T, w, zone, base, result: null };
      panel.innerHTML = `<div class="auction"><div class="ah"><b>Ad Auction</b><span class="s">Stop the needle inside the winning bid. Tap anywhere on the city.</span></div>
        <div class="abar"><div class="azone" style="left:${zone * 100}%;width:${w * 100}%"></div><div class="aneedle" id="aneedle"></div></div>
        <div class="s">Skill ${L} · win pays ${fmt(base * 2)} Bucks · perfect ${fmt(base * 3)}</div></div>`;
      panel.onclick = () => stopAuction();
    }
    function drawAuction(ts) {
      if (!auction || auction.result) return;
      const el = panel.querySelector('#aneedle'); if (!el) return;
      const ph = ((ts - auction.t0) / 1000 / auction.T) % 2; const pos = ph < 1 ? ph : 2 - ph; // ping-pong 0→1→0
      auction.pos = pos; el.style.left = `${pos * 100}%`;
    }
    function stopAuction() {
      if (!auction || auction.result) return;
      const S = get(); const c = S.city; const k = S.todayKey; const a = (c.auction[k] ||= { plays: 0, hits: 0, won: 0 });
      const pos = auction.pos || 0; const { zone, w, base } = auction;
      const hit = pos >= zone && pos <= zone + w; const perfect = hit && Math.abs(pos - (zone + w / 2)) <= w * 0.2;
      const pay = Math.round(base * (perfect ? 3 : hit ? 2 : 0.5));
      a.plays++; if (hit) a.hits++; a.won += pay;
      const l = (c.ledger[deviceId] ||= { earned: 0, spent: 0 }); l.earned += pay;
      c.skill = { v: Math.max(0, c.skill.v + (hit ? 1 : -1)), t: now() };
      auction.result = perfect ? 'PERFECT BID' : hit ? 'PLACEMENT WON' : 'OUTBID';
      commit();
      const el = panel.querySelector('.auction'); if (el) el.insertAdjacentHTML('beforeend', `<div class="ares ${hit ? 'win' : 'loss'}">${auction.result} · +${fmt(pay)} Bucks${perfect ? ' 🏆' : ''}${hit ? '' : ' — learned the CPM'}</div>`);
      toast(`${auction.result} · +${fmt(pay)} Bucks`, perfect);
      setTimeout(() => { auction = null; panel.onclick = null; renderHud(); renderPanel(); }, 1400);
    }

    window.addEventListener('resize', () => { if (visible) { size(); draw(); } });
    return { show, refresh: () => { if (visible) { renderHud(); renderPanel(); draw(); } } };
  }

  return { DISTRICTS, BUILDINGS, DECOR, norm, merge, emptyCity, gritSpent, bucks, incomePerMin, pending, population, districtLevel, fmt, mount };
})();
