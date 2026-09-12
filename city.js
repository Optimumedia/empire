/* Empire City v2 — an isometric town fed by real life.
   Grit (earned by missions) buys and upgrades buildings. Bucks (the town's own income) buy decor, boosts, and are the mini-game payout.
   Pure helpers are exported so the main app can price things; mount() runs the canvas. */
window.City = (() => {
  'use strict';

  const N = 6, TW = 64, TH = 32, TWH = 32, THH = 16;
  const GROWTH = 1.15, OFFLINE_CAP_MS = 8 * 3600e3, MAX_LV = 30;
  const DISTRICTS = {
    business: { name: 'Downtown',  hue: 212, x0: 0, y0: 0, ground: [214, 12, 74], landmark: '🏛️' },
    family:   { name: 'Hillside',  hue: 325, x0: 3, y0: 0, ground: [95, 30, 68],  landmark: '🎡' },
    body:     { name: 'Riverside', hue: 18,  x0: 0, y0: 3, ground: [40, 28, 70],  landmark: '🗽' },
    health:   { name: 'Greenbelt', hue: 145, x0: 3, y0: 3, ground: [120, 32, 62], landmark: '⛲' },
  };
  const BUILDINGS = {
    hq:        { d: 'business', name: 'Agency HQ',    e: '🏢', cost: 60,  inc: 2,  unlock: 1, shape: 'tower' },
    billboard: { d: 'business', name: 'Billboard',    e: '📣', cost: 90,  inc: 3,  unlock: 2, shape: 'billboard' },
    studio:    { d: 'business', name: 'Studio',       e: '🎬', cost: 150, inc: 5,  unlock: 3, shape: 'studio' },
    tower:     { d: 'business', name: 'Media Tower',  e: '📡', cost: 400, inc: 12, unlock: 5, shape: 'antenna' },
    home:      { d: 'family',   name: 'Home',         e: '🏠', cost: 60,  inc: 2,  unlock: 1, shape: 'house' },
    playground:{ d: 'family',   name: 'Playground',   e: '🛝', cost: 90,  inc: 3,  unlock: 2, shape: 'playground' },
    school:    { d: 'family',   name: 'School',       e: '🏫', cost: 150, inc: 5,  unlock: 3, shape: 'school' },
    park:      { d: 'family',   name: 'Grand Park',   e: '🌳', cost: 400, inc: 12, unlock: 5, shape: 'park' },
    gym:       { d: 'body',     name: 'Gym',          e: '🏋️', cost: 60,  inc: 2,  unlock: 1, shape: 'gym' },
    track:     { d: 'body',     name: 'Track',        e: '🏃', cost: 90,  inc: 3,  unlock: 2, shape: 'track' },
    pool:      { d: 'body',     name: 'Pool',         e: '🏊', cost: 150, inc: 5,  unlock: 3, shape: 'pool' },
    stadium:   { d: 'body',     name: 'Stadium',      e: '🏟️', cost: 400, inc: 12, unlock: 5, shape: 'stadium' },
    clinic:    { d: 'health',   name: 'Clinic',       e: '🏥', cost: 60,  inc: 2,  unlock: 1, shape: 'clinic' },
    garden:    { d: 'health',   name: 'Garden',       e: '🌿', cost: 90,  inc: 3,  unlock: 2, shape: 'garden' },
    lodge:     { d: 'health',   name: 'Sleep Lodge',  e: '🛏️', cost: 150, inc: 5,  unlock: 3, shape: 'lodge' },
    spa:       { d: 'health',   name: 'Spa',          e: '♨️', cost: 400, inc: 12, unlock: 5, shape: 'spa' },
  };
  const DECOR = {
    road:     { name: 'Plaza',       e: '🧱', bucks: 400,  bonus: 0.03 },
    tree:     { name: 'Trees',       e: '🌲', bucks: 700,  bonus: 0.03 },
    lamp:     { name: 'Streetlight', e: '💡', bucks: 1200, bonus: 0.04 },
    fountain: { name: 'Fountain',    e: '⛲', bucks: 2500, bonus: 0.06 },
  };
  const BOOST_COST = 2000, BOOST_MS = 8 * 3600e3;
  const CITY_TITLES = [[0, 'Empty lot'], [3, 'Startup Street'], [12, 'Agency Avenue'], [30, 'Founder’s Quarter'], [60, 'Empire District'], [100, 'Capital'], [160, 'Metropolis'], [240, 'Empire']];
  const CONTRACTS = [
    { id: 'collect3', text: 'Collect income 3 times', check: (c, k) => (c.collects[k] || 0) >= 3, reward: 150 },
    { id: 'upgrade', text: 'Upgrade any building', check: (c, k) => Object.values(c.plots).some(p => p.t >= dayStart(k) && p.lv > 1), reward: 200 },
    { id: 'auction', text: 'Win an Ad Auction', check: (c, k) => ((c.auction[k] || {}).hits || 0) >= 1, reward: 150 },
    { id: 'perfect', text: 'Land a perfect bid', check: (c, k) => ((c.auction[k] || {}).perfect || 0) >= 1, reward: 300 },
    { id: 'imp', text: 'Pop 25 impressions in one round', check: (c, k) => ((c.imp[k] || {}).best || 0) >= 25, reward: 200 },
    { id: 'build', text: 'Build something new', check: (c, k) => Object.values(c.plots).some(p => p.lv === 1 && p.t >= dayStart(k)), reward: 200 },
  ];
  const dayStart = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 4).getTime() - 24 * 3600e3 * 0; };

  const districtOf = (x, y) => { for (const k in DISTRICTS) { const d = DISTRICTS[k]; if (x >= d.x0 && x < d.x0 + 3 && y >= d.y0 && y < d.y0 + 3) return k; } return null; };
  const upgradeCost = (b, lv) => Math.round(b.cost * Math.pow(GROWTH, lv));
  const totalCost = (b, lv) => Math.round(b.cost * (Math.pow(GROWTH, lv) - 1) / (GROWTH - 1));
  const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
  const tier = lv => lv >= 20 ? 3 : lv >= 10 ? 2 : 1;

  const emptyCity = () => ({ plots: {}, decor: {}, ledger: {}, lastCollect: { t: 0 }, boost: { until: 0, t: 0 }, skill: { v: 0, t: 0 }, auction: {}, imp: {}, collects: {}, contracts: {}, seen: {} });
  function norm(c) {
    const out = emptyCity(); if (!c || typeof c !== 'object') return out;
    for (const k in c.plots || {}) { const p = c.plots[k]; if (p && BUILDINGS[p.type]) out.plots[k] = { type: p.type, lv: Math.max(0, Math.min(MAX_LV, +p.lv || 0)), t: +p.t || 0 }; }
    for (const k in c.decor || {}) { const p = c.decor[k]; if (p && DECOR[p.type]) out.decor[k] = { type: p.type, on: !!p.on, t: +p.t || 0 }; }
    for (const k in c.ledger || {}) { const l = c.ledger[k]; if (l) out.ledger[k] = { earned: +l.earned || 0, spent: +l.spent || 0 }; }
    out.lastCollect = { t: +(c.lastCollect && c.lastCollect.t) || 0 };
    out.boost = { until: +(c.boost && c.boost.until) || 0, t: +(c.boost && c.boost.t) || 0 };
    out.skill = { v: +(c.skill && c.skill.v) || 0, t: +(c.skill && c.skill.t) || 0 };
    for (const k in c.auction || {}) { const a = c.auction[k]; if (a) out.auction[k] = { plays: +a.plays || 0, hits: +a.hits || 0, perfect: +a.perfect || 0, won: +a.won || 0 }; }
    for (const k in c.imp || {}) { const a = c.imp[k]; if (a) out.imp[k] = { plays: +a.plays || 0, best: +a.best || 0, won: +a.won || 0 }; }
    for (const k in c.collects || {}) out.collects[k] = +c.collects[k] || 0;
    for (const k in c.contracts || {}) { const a = c.contracts[k]; if (a) out.contracts[k] = { claimed: +a.claimed || 0 }; }
    for (const k in c.seen || {}) out.seen[k] = true;
    return out;
  }
  function merge(a, b) {
    a = norm(a); b = norm(b); const out = emptyCity();
    const keys = (x, y) => [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
    const newer = (x, y) => (!x ? y : !y ? x : (x.t || 0) >= (y.t || 0) ? x : y);
    const maxf = (field, fields) => { for (const k of keys(a[field], b[field])) { const x = a[field][k] || {}, y = b[field][k] || {}; const o = {}; for (const f of fields) o[f] = Math.max(+x[f] || 0, +y[f] || 0); out[field][k] = o; } };
    for (const k of keys(a.plots, b.plots)) out.plots[k] = newer(a.plots[k], b.plots[k]);
    for (const k of keys(a.decor, b.decor)) out.decor[k] = newer(a.decor[k], b.decor[k]);
    maxf('ledger', ['earned', 'spent']); maxf('auction', ['plays', 'hits', 'perfect', 'won']); maxf('imp', ['plays', 'best', 'won']); maxf('contracts', ['claimed']);
    for (const k of keys(a.collects, b.collects)) out.collects[k] = Math.max(a.collects[k] || 0, b.collects[k] || 0);
    out.lastCollect = { t: Math.max(a.lastCollect.t, b.lastCollect.t) };
    out.boost = newer(a.boost, b.boost); out.skill = newer(a.skill, b.skill);
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
  const districtLevel = c => { const out = {}; for (const k in c.plots) { const b = BUILDINGS[c.plots[k].type]; out[b.d] = (out[b.d] || 0) + c.plots[k].lv; } return out; };
  const landmarks = c => { const dl = districtLevel(c); const out = {}; for (const d in DISTRICTS) out[d] = (dl[d] || 0) >= 30; return out; };
  function incomePerMin(c, vitality) {
    let s = 0; const lm = landmarks(c);
    for (const k in c.plots) { const [x, y] = k.split(',').map(Number); const p = c.plots[k]; const b = BUILDINGS[p.type]; if (p.lv <= 0) continue; s += b.inc * p.lv * (1 + adjacency(c, x, y)) * (vitality[b.d] || 1) * (lm[b.d] ? 1.25 : 1); }
    s *= 1 + decorBonus(c); if (c.boost.until > Date.now()) s *= 2; return s;
  }
  function pending(c, vitality, now) { if (!c.lastCollect.t) return 0; const ms = Math.max(0, Math.min(OFFLINE_CAP_MS, now - c.lastCollect.t)); return incomePerMin(c, vitality) * ms / 60000; }
  function population(c, vitality) { const ds = Object.keys(DISTRICTS); const avg = ds.reduce((s, d) => s + (vitality[d] || 1), 0) / ds.length; return Math.round(Object.values(c.plots).reduce((s, p) => s + p.lv * 4, 0) * avg); }
  const cityLevel = c => Object.values(c.plots).reduce((s, p) => s + p.lv, 0);
  const cityTitle = c => { const L = cityLevel(c); let t = CITY_TITLES[0][1]; for (const [n, name] of CITY_TITLES) if (L >= n) t = name; return t; };
  const nextTitle = c => { const L = cityLevel(c); for (const [n, name] of CITY_TITLES) if (L < n) return [n, name]; return null; };
  function contractFor(k) { let h = 0; for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return CONTRACTS[h % CONTRACTS.length]; }

  // =====================================================================
  // Rendering helpers (isometric, procedural)
  // =====================================================================
  const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
  function mount(opts) {
    const { canvas, panel, hud, get, commit, toast, deviceId } = opts;
    const ctx = canvas.getContext('2d');
    let sel = null, scale = 1, ox = 0, oy = 0, W = 0, H = 0, raf = 0, visible = false, lastFrame = 0, tsec = 0;
    let citizens = [], cars = [], fx = [], clouds = [];
    let auction = null, imp = null;
    const now = () => Date.now();
    const night = () => { const h = new Date().getHours(); return h >= 20 || h < 6 ? 1 : (h >= 18 ? (h - 18) / 2 : h < 7 ? 1 - h / 7 * 0 : 0); };

    function size() {
      const cssW = canvas.clientWidth || 360; const dpr = window.devicePixelRatio || 1;
      W = cssW; scale = cssW / (N * TW + 24); H = Math.round((N * TH + 150) * scale);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.height = H + 'px';
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      ox = (W / scale) / 2; oy = 78;
      if (!clouds.length) for (let i = 0; i < 4; i++) clouds.push({ x: Math.random() * (W / scale), y: 10 + Math.random() * 40, s: 0.6 + Math.random() * 0.8, v: 3 + Math.random() * 4 });
    }
    const toScreen = (mx, my) => [ox + (mx - my) * TWH, oy + (mx + my) * THH];
    function toGrid(sx, sy) { const x = sx - ox, y = sy - oy; return [Math.floor((x / TWH + y / THH) / 2), Math.floor((y / THH - x / TWH) / 2)]; }
    // footprint corners for a box of w×d tile-units centred on tile (x,y); returns ground corners back,right,front,left
    function corners(x, y, w, d) {
      const [sx, sy0] = toScreen(x, y); const cx = sx, cy = sy0 + THH;
      const ax = w * TWH / 2, ay = w * THH / 2, bx = d * TWH / 2, by = d * THH / 2;
      return { c: [cx, cy], b: [cx - ax + bx, cy - ay - by], r: [cx + ax + bx, cy + ay - by], f: [cx + ax - bx, cy + ay + by], l: [cx - ax - bx, cy - ay + by] };
    }
    function poly(pts, fill, stroke) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } }
    const up = (p, h) => [p[0], p[1] - h];
    // cuboid with shaded faces
    function cuboid(x, y, w, d, h, hue, sat, lit, opts = {}) {
      const c = corners(x, y, w, d); const nt = night();
      const top = hsl(hue, sat, lit + 8), left = hsl(hue, sat, lit - 6), right = hsl(hue, sat, lit - 16);
      poly([c.l, c.f, up(c.f, h), up(c.l, h)], left);
      poly([c.f, c.r, up(c.r, h), up(c.f, h)], right);
      poly([up(c.b, h), up(c.r, h), up(c.f, h), up(c.l, h)], top, 'rgba(0,0,0,.18)');
      if (opts.windows) {
        const rows = Math.max(1, Math.floor(h / 11)), cols = opts.windows;
        for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) {
          const fy = h - 6 - r * 11; const lx = c.l[0] + (c.f[0] - c.l[0]) * (0.18 + cc * 0.64 / Math.max(1, cols - 1)); const ly = c.l[1] + (c.f[1] - c.l[1]) * (0.18 + cc * 0.64 / Math.max(1, cols - 1));
          const rx = c.f[0] + (c.r[0] - c.f[0]) * (0.18 + cc * 0.64 / Math.max(1, cols - 1)); const ry = c.f[1] + (c.r[1] - c.f[1]) * (0.18 + cc * 0.64 / Math.max(1, cols - 1));
          const on = nt > 0.3 && ((r * 7 + cc * 13 + Math.floor(x * 3 + y * 5)) % 5 !== 0);
          ctx.fillStyle = on ? 'rgba(255,225,140,.95)' : 'rgba(255,255,255,.35)';
          ctx.fillRect(lx - 1.5, ly - fy - 2, 3, 4); ctx.fillRect(rx - 1.5, ry - fy - 2, 3, 4);
        }
      }
      return c;
    }
    function roofPrism(c, h, rh, hue, sat, lit) { // pitched roof along the w axis on top of cuboid corners c
      const bl = up(c.l, h), bf = up(c.f, h), br = up(c.r, h), bb = up(c.b, h);
      const ridge1 = [(bl[0] + bb[0]) / 2, (bl[1] + bb[1]) / 2 - rh], ridge2 = [(bf[0] + br[0]) / 2, (bf[1] + br[1]) / 2 - rh];
      poly([bl, bf, ridge2, ridge1], hsl(hue, sat, lit - 4)); poly([bf, br, ridge2], hsl(hue, sat, lit - 18)); poly([bb, br, ridge2, ridge1], hsl(hue, sat, lit - 24));
    }
    function ellipseIso(cx, cy, rx, ry, fill, stroke, lw) { ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); } }
    function tree(cx, cy, s, hue = 130) { ctx.fillStyle = hsl(28, 40, 30); ctx.fillRect(cx - 1.2 * s, cy - 6 * s, 2.4 * s, 6 * s); ellipseIso(cx, cy - 9 * s, 5 * s, 5.5 * s, hsl(hue, 45, 34)); ellipseIso(cx - 1.5 * s, cy - 10.5 * s, 3.5 * s, 3.8 * s, hsl(hue, 50, 42)); }
    function label(txt, cx, cy, size, color) { ctx.font = `${size}px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; if (color) ctx.fillStyle = color; ctx.fillText(txt, cx, cy); }

    // ---- building shapes ----
    function drawBuilding(x, y, p, vit) {
      const b = BUILDINGS[p.type]; const T = tier(p.lv); const hue = DISTRICTS[b.d].hue; const v = Math.max(0.5, Math.min(1.5, vit || 1)); const sat = 28 + 34 * (v - 0.5); const lit = 52 + 6 * (v - 1);
      const g = 0.72 + Math.min(0.2, p.lv * 0.008); // footprint grows a little
      const base = 8 + Math.min(70, p.lv * 2.6);
      const [sx, sy0] = toScreen(x, y); const cx = sx, cy = sy0 + THH;
      switch (b.shape) {
        case 'tower': { const h = base + 10; cuboid(x, y, g * 0.8, g * 0.8, h, hue, sat, lit, { windows: T + 1 }); if (T >= 2) cuboid(x, y, g * 0.45, g * 0.45, h + 14, hue, sat, lit + 4, { windows: 1 }); if (T >= 3) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy - h - 14); ctx.lineTo(cx, cy - h - 30); ctx.stroke(); ellipseIso(cx, cy - h - 31, 2, 2, '#ff5d5d'); } break; }
        case 'antenna': { const h = base + 16; cuboid(x, y, g * 0.55, g * 0.55, h, hue, sat, lit - 4, { windows: 1 }); ctx.strokeStyle = hsl(hue, 20, 80); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy - h); ctx.lineTo(cx, cy - h - 26 - T * 6); ctx.stroke(); for (let i = 0; i < T + 1; i++) ellipseIso(cx, cy - h - 10 - i * 8, 7 - i, 3 - i * 0.6, null, hsl(hue, 30, 85), 1.5); const blink = Math.floor(tsec * 2) % 2 === 0; ellipseIso(cx, cy - h - 27 - T * 6, 2.2, 2.2, blink ? '#ff4d4d' : '#7a2020'); break; }
        case 'billboard': { cuboid(x, y, g * 0.9, g * 0.35, 6, hue, 10, 40); ctx.strokeStyle = hsl(0, 0, 35); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy - 22 - base * 0.4); ctx.stroke(); const bh = 14 + T * 3, bw = 22 + T * 4; const by = cy - 22 - base * 0.4 - bh; ctx.fillStyle = '#f7f1e3'; ctx.fillRect(cx - bw / 2, by, bw, bh); ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1.5; ctx.strokeRect(cx - bw / 2, by, bw, bh); ctx.fillStyle = hsl(hue, 70, 45); ctx.fillRect(cx - bw / 2 + 3, by + 3, bw * 0.55, bh - 6); ctx.fillStyle = '#333'; ctx.fillRect(cx + bw * 0.1, by + 4, bw * 0.35, 2); ctx.fillRect(cx + bw * 0.1, by + 8, bw * 0.3, 2); break; }
        case 'studio': { const h = base * 0.6 + 8; const c = cuboid(x, y, g, g * 0.8, h, hue, sat - 10, lit - 2); ctx.fillStyle = hsl(hue, 30, 30); poly([up(c.b, h), up(c.r, h), up(c.r, h + 4), up(c.b, h + 4)], hsl(hue, 30, 25)); ellipseIso(cx + 10, cy - h - 6, 5, 3, '#222'); ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx + 10, cy - h - 6); ctx.lineTo(cx + 16, cy - h - 14); ctx.stroke(); if (T >= 2) label('🎬', cx - 8, cy - h - 8, 12); break; }
        case 'house': { const h = 10 + base * 0.45; const c = cuboid(x, y, g * 0.85, g * 0.85, h, hue, sat - 8, lit + 6, { windows: 1 }); roofPrism(c, h, 9 + T * 3, 8, 45, 40); ctx.fillStyle = hsl(28, 40, 28); const d = c.f; ctx.fillRect(d[0] - 8, d[1] - 9, 4, 9); if (T >= 2) { ctx.fillStyle = hsl(0, 0, 45); ctx.fillRect(cx + 6, cy - h - 16, 4, 9); } if (T >= 3) tree(cx - 20, cy + 4, 0.8); break; }
        case 'playground': { cuboid(x, y, g, g, 3, 45, 30, 62); ctx.fillStyle = '#e8b13a'; ctx.fillRect(cx - 12, cy - 16, 3, 16); ctx.fillStyle = '#d9532b'; ctx.beginPath(); ctx.moveTo(cx - 12, cy - 16); ctx.lineTo(cx + 8, cy - 4); ctx.lineTo(cx + 8, cy); ctx.lineTo(cx - 9, cy - 12); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#3E7CB1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx + 4, cy - 18); ctx.lineTo(cx + 16, cy - 18); ctx.moveTo(cx + 7, cy - 18); ctx.lineTo(cx + 7, cy - 6 + Math.sin(tsec * 3) * 2); ctx.moveTo(cx + 13, cy - 18); ctx.lineTo(cx + 13, cy - 6 - Math.sin(tsec * 3) * 2); ctx.stroke(); if (T >= 2) label('🎠', cx - 14, cy - 2, 11); break; }
        case 'school': { const h = 12 + base * 0.4; const c = cuboid(x, y, g * 1.05, g * 0.8, h, 35, 35, 58, { windows: 3 }); ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1.5; const t = up(c.b, h); ctx.beginPath(); ctx.moveTo(t[0] + 6, t[1] + 4); ctx.lineTo(t[0] + 6, t[1] - 14); ctx.stroke(); ctx.fillStyle = hsl(hue, 70, 55); ctx.beginPath(); ctx.moveTo(t[0] + 6, t[1] - 14); ctx.lineTo(t[0] + 16, t[1] - 11); ctx.lineTo(t[0] + 6, t[1] - 8); ctx.fill(); if (T >= 2) { ellipseIso(cx, cy - h - 2, 6, 3, hsl(35, 30, 70)); } break; }
        case 'park': { cuboid(x, y, g * 1.1, g * 1.1, 2, 130, 40, 40); const n = 3 + T * 2; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; tree(cx + Math.cos(a) * 14, cy + Math.sin(a) * 7 + 4, 0.7 + (i % 2) * 0.25, 120 + i * 8); } if (T >= 2) ellipseIso(cx, cy + 2, 7, 3.5, '#5fb3e0'); if (T >= 3) label('⛲', cx, cy - 6, 12); break; }
        case 'gym': { const h = 10 + base * 0.4; const c = cuboid(x, y, g * 1.05, g * 0.9, h, hue, sat, lit - 4, { windows: 2 }); poly([up(c.b, h), up(c.r, h), up(c.r, h + 5), up(c.b, h + 5)], hsl(hue, sat, lit - 22)); ctx.fillStyle = '#2b2b2b'; const d = c.f; ctx.fillRect(d[0] - 10, d[1] - 12, 8, 12); label('🏋️', cx, cy - h - 10, 12 + T * 2); break; }
        case 'track': { cuboid(x, y, g * 1.15, g * 1.15, 2, 20, 30, 45); ellipseIso(cx, cy - 1, 24, 12, hsl(8, 60, 42)); ellipseIso(cx, cy - 1, 14, 7, hsl(130, 40, 42)); ctx.setLineDash([3, 3]); ellipseIso(cx, cy - 1, 19, 9.5, null, 'rgba(255,255,255,.8)', 1); ctx.setLineDash([]); const a = tsec * 1.5; ellipseIso(cx + Math.cos(a) * 19, cy - 1 + Math.sin(a) * 9.5 - 3, 2, 2, '#fff'); if (T >= 2) ellipseIso(cx + Math.cos(a + 2) * 19, cy - 1 + Math.sin(a + 2) * 9.5 - 3, 2, 2, '#ffd166'); break; }
        case 'pool': { cuboid(x, y, g * 1.1, g * 1.0, 4, 200, 10, 80); const c = corners(x, y, g * 0.85, g * 0.7); poly([up(c.b, 4), up(c.r, 4), up(c.f, 4), up(c.l, 4)], hsl(200, 70, 58)); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; for (let i = 0; i < 3; i++) { ctx.beginPath(); const yy = cy - 4 + (i - 1) * 5; for (let xx = -16; xx <= 16; xx += 4) ctx.lineTo(cx + xx, yy + Math.sin(xx * 0.5 + tsec * 3 + i) * 1.2); ctx.stroke(); } if (T >= 2) label('🏊', cx + 14, cy - 12, 11); if (T >= 3) { ctx.fillStyle = '#ddd'; ctx.fillRect(cx - 22, cy - 22, 2, 18); ctx.fillRect(cx - 24, cy - 22, 8, 2); } break; }
        case 'stadium': { const h = 12 + base * 0.35; cuboid(x, y, g * 1.15, g * 1.15, 3, 20, 20, 55); ellipseIso(cx, cy - 1, 27, 14, hsl(hue, 25, 48)); poly([[cx - 27, cy - 1], [cx - 27, cy - 1 - h], [cx + 27, cy - 1 - h], [cx + 27, cy - 1]], hsl(hue, 25, 40)); ellipseIso(cx, cy - 1 - h, 27, 14, hsl(hue, 28, 58), 'rgba(0,0,0,.25)'); ellipseIso(cx, cy - 1 - h, 17, 8, hsl(130, 45, 40)); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.moveTo(cx - 17, cy - 1 - h); ctx.lineTo(cx + 17, cy - 1 - h); ctx.stroke(); if (T >= 2) for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.7; ctx.fillStyle = night() > 0.3 ? '#fff3b0' : '#ddd'; ctx.fillRect(cx + Math.cos(a) * 28 - 1, cy - 1 - h - 14 + Math.sin(a) * 4, 2, 14); } break; }
        case 'clinic': { const h = 12 + base * 0.45; cuboid(x, y, g * 0.9, g * 0.9, h, 0, 0, 82, { windows: 2 }); ctx.fillStyle = '#d9342b'; ctx.fillRect(cx - 1.5, cy - h - 12, 3, 9); ctx.fillRect(cx - 4.5, cy - h - 9, 9, 3); if (T >= 2) label('🚑', cx + 14, cy + 4, 10); break; }
        case 'garden': { cuboid(x, y, g * 1.1, g * 1.1, 2, 40, 30, 42); for (let r = 0; r < 3; r++) for (let i = 0; i < 4 + T; i++) { const px = cx - 16 + i * (32 / (3 + T)) + r * 4, py = cy - 8 + r * 7 - i * 2; ellipseIso(px, py, 3.5, 2.5, hsl(120 + r * 15, 50, 38 + r * 5)); } if (T >= 2) label('🌻', cx + 16, cy - 10, 10); break; }
        case 'lodge': { const h = 8 + base * 0.4; const c = cuboid(x, y, g * 0.95, g * 0.85, h, 25, 35, 38, { windows: 1 }); roofPrism(c, h, 8 + T * 2, 220, 20, 30); if (night() > 0.3) label('🌙', cx + 12, cy - h - 18, 10); if (T >= 2) { ctx.fillStyle = 'rgba(200,200,200,.6)'; ellipseIso(cx + 8 + Math.sin(tsec) * 2, cy - h - 20 - (tsec * 6 % 12), 3, 2, 'rgba(220,220,220,.5)'); } break; }
        case 'spa': { const h = 8 + base * 0.3; cuboid(x, y, g, g, h, hue, sat, lit); ellipseIso(cx, cy - h - 2, 16, 9, hsl(hue, 35, 62), 'rgba(0,0,0,.2)'); ctx.beginPath(); ctx.arc(cx, cy - h - 2, 14, Math.PI, 0); ctx.fillStyle = hsl(hue, 35, 70); ctx.fill(); for (let i = 0; i < 2 + T; i++) { const ph = (tsec * 0.8 + i * 0.7) % 2; ellipseIso(cx - 8 + i * 8 + Math.sin(ph * 3) * 2, cy - h - 18 - ph * 10, 3, 2, `rgba(255,255,255,${0.6 - ph * 0.3})`); } break; }
        default: cuboid(x, y, g, g, base, hue, sat, lit);
      }
      // level tag
      ctx.font = 'bold 8px "Chakra Petch", sans-serif'; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`L${p.lv}`, cx, cy + 6);
      if (T >= 3) { ctx.font = '9px sans-serif'; ctx.fillText('👑', cx + 14, cy + 5); }
    }
    function drawDecor(x, y, d) {
      const [sx, sy0] = toScreen(x, y); const cx = sx, cy = sy0 + THH;
      if (d.type === 'tree') { tree(cx - 8, cy + 4, 0.8, 125); tree(cx + 8, cy + 1, 0.65, 140); tree(cx, cy - 6, 0.7, 115); }
      else if (d.type === 'road') { const c = corners(x, y, 0.95, 0.95); poly([c.b, c.r, c.f, c.l], hsl(30, 15, 62)); ctx.strokeStyle = 'rgba(0,0,0,.15)'; for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(c.l[0] + (c.b[0] - c.l[0]) * i / 4, c.l[1] + (c.b[1] - c.l[1]) * i / 4); ctx.lineTo(c.f[0] + (c.r[0] - c.f[0]) * i / 4, c.f[1] + (c.r[1] - c.f[1]) * i / 4); ctx.stroke(); } }
      else if (d.type === 'lamp') { ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 22); ctx.lineTo(cx + 6, cy - 22); ctx.stroke(); const on = night() > 0.3; ellipseIso(cx + 6, cy - 22, 2.5, 2.5, on ? '#ffe28a' : '#ccc'); if (on) { const g = ctx.createRadialGradient(cx + 6, cy - 10, 2, cx + 6, cy - 10, 18); g.addColorStop(0, 'rgba(255,226,138,.35)'); g.addColorStop(1, 'rgba(255,226,138,0)'); ctx.fillStyle = g; ctx.fillRect(cx - 14, cy - 30, 40, 36); } }
      else if (d.type === 'fountain') { ellipseIso(cx, cy, 13, 6.5, hsl(200, 30, 70), 'rgba(0,0,0,.2)'); ellipseIso(cx, cy - 1, 9, 4.5, hsl(200, 70, 60)); ctx.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < 5; i++) { const ph = (tsec * 1.5 + i * 0.4) % 1; ellipseIso(cx + (i - 2) * 3, cy - 4 - Math.sin(ph * Math.PI) * 12, 1.5, 1.5, `rgba(255,255,255,${1 - ph})`); } }
    }

    function drawGround(S) {
      const nt = night(); const vit = S.vitality;
      // sky/ground wash
      const g = ctx.createLinearGradient(0, 0, 0, H / scale);
      g.addColorStop(0, nt > 0.3 ? '#0b1220' : '#dfe9f2'); g.addColorStop(1, nt > 0.3 ? '#131c28' : '#eef2f5');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W / scale, H / scale);
      // clouds / stars
      if (nt > 0.3) { ctx.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < 18; i++) { const sx = ((i * 97) % (W / scale)), sy = (i * 41) % 60; if (Math.sin(tsec * 2 + i) > -0.6) ctx.fillRect(sx, sy, 1.2, 1.2); } }
      else for (const cl of clouds) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ellipseIso(cl.x, cl.y, 14 * cl.s, 6 * cl.s, 'rgba(255,255,255,.85)'); ellipseIso(cl.x + 9 * cl.s, cl.y - 3 * cl.s, 10 * cl.s, 6 * cl.s, 'rgba(255,255,255,.85)'); ellipseIso(cl.x - 9 * cl.s, cl.y - 1, 9 * cl.s, 5 * cl.s, 'rgba(255,255,255,.85)'); }
      // river along Riverside's outer edge (x = -1 column, y 3..6)
      const rv = corners(-0.9, 4.5, 1.0, 3.2); poly([rv.b, rv.r, rv.f, rv.l], nt > 0.3 ? hsl(210, 45, 28) : hsl(200, 60, 62));
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; for (let i = 0; i < 6; i++) { const t = i / 6; const px = rv.l[0] + (rv.b[0] - rv.l[0]) * t + 6, py = rv.l[1] + (rv.b[1] - rv.l[1]) * t; ctx.beginPath(); for (let k = 0; k <= 4; k++) ctx.lineTo(px + k * 5, py + k * 2.5 + Math.sin(tsec * 2 + i + k) * 1.2); ctx.stroke(); }
      // tiles
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const d = districtOf(x, y); const D = DISTRICTS[d]; const v = Math.max(0.5, Math.min(1.5, vit[d] || 1)); const locked = !S.unlocked[d];
        const [h, s, l] = D.ground; const ss = locked ? 6 : s * (0.5 + v * 0.5), ll = (nt > 0.3 ? l - 34 : l) + (locked ? 6 : 0);
        const c = corners(x, y, 1, 1); poly([c.b, c.r, c.f, c.l], hsl(h, ss, ll), nt > 0.3 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.10)');
        // texture speckle
        ctx.fillStyle = nt > 0.3 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.05)'; for (let i = 0; i < 3; i++) { const hx = ((x * 7 + y * 13 + i * 31) % 20) / 20 - 0.5, hy = ((x * 11 + y * 3 + i * 17) % 20) / 20 - 0.5; ctx.fillRect(c.c[0] + hx * 30, c.c[1] + hy * 12, 2, 1); }
        if (sel && sel[0] === x && sel[1] === y) { const pulse = 0.5 + Math.sin(tsec * 4) * 0.3; poly([c.b, c.r, c.f, c.l], `rgba(242,178,51,${0.25 * pulse})`); ctx.lineWidth = 2; ctx.strokeStyle = `rgba(242,178,51,${0.6 + pulse * 0.4})`; ctx.stroke(); }
      }
      // roads between districts (x=3 boundary and y=3 boundary)
      ctx.lineWidth = 7; ctx.strokeStyle = nt > 0.3 ? '#2a3441' : '#8b929b'; ctx.lineCap = 'butt';
      let a = toScreen(3, 0), b = toScreen(3, N); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      a = toScreen(0, 3); b = toScreen(N, 3); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.setLineDash([4, 5]);
      a = toScreen(3, 0); b = toScreen(3, N); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      a = toScreen(0, 3); b = toScreen(N, 3); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
      // district names + landmarks
      const lm = landmarks(S.city);
      ctx.font = 'bold 9px "Chakra Petch", sans-serif'; ctx.textAlign = 'center';
      for (const k in DISTRICTS) { const D = DISTRICTS[k]; const [sx, sy] = toScreen(D.x0 + 1, D.y0 + 1); const locked = !S.unlocked[k]; ctx.fillStyle = nt > 0.3 ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)'; ctx.fillText((locked ? '🔒 ' : '') + D.name.toUpperCase() + (!locked && (vit[k] || 1) < 0.8 ? ' · DORMANT' : ''), sx, sy + THH + 30); if (lm[k]) label(D.landmark, sx, sy + THH - 4, 14); }
    }
    function drawCitizens() {
      const nt = night();
      for (const z of citizens) { const [sx, sy] = toScreen(z.x, z.y); const py = sy + THH; ctx.fillStyle = z.c; ctx.fillRect(sx - 1.5, py - 6, 3, 5); ctx.fillStyle = nt > 0.3 ? '#e8d7c3' : '#f1dcc4'; ellipseIso(sx, py - 7.5, 1.6, 1.6, nt > 0.3 ? '#e8d7c3' : '#f1dcc4'); }
      for (const c of cars) { const [sx, sy] = c.axis === 'x' ? toScreen(c.p, 3) : toScreen(3, c.p); ctx.fillStyle = c.c; poly([[sx - 5, sy - 2], [sx + 5, sy - 2], [sx + 5, sy + 2], [sx - 5, sy + 2]], c.c); ctx.fillStyle = nt > 0.3 ? '#fff3b0' : '#333'; ctx.fillRect(sx + (c.dir > 0 ? 4 : -5), sy - 1, 1.5, 2); }
    }
    function drawFx() { for (const f of fx) { ctx.globalAlpha = Math.max(0, 1 - f.age / f.life); if (f.kind === 'coin') { ellipseIso(f.x, f.y, 3, 3, '#E9B53B', '#9a6d10', 1); } else { ctx.font = 'bold 11px "Chakra Petch", sans-serif'; ctx.fillStyle = f.color || '#1F7A5C'; ctx.textAlign = 'center'; ctx.fillText(f.text, f.x, f.y); } ctx.globalAlpha = 1; } }
    function draw() {
      const S = get(); const c = S.city; const vit = S.vitality;
      ctx.clearRect(0, 0, W / scale, H / scale);
      drawGround(S);
      const items = [];
      for (const k in c.plots) { const [x, y] = k.split(',').map(Number); items.push({ x, y, p: c.plots[k] }); }
      for (const k in c.decor) { const [x, y] = k.split(',').map(Number); if (c.decor[k].on) items.push({ x, y, d: c.decor[k] }); }
      for (const z of citizens) items.push({ x: z.x, y: z.y, z });
      items.sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.x - b.x);
      for (const it of items) { if (it.p) drawBuilding(it.x, it.y, it.p, vit[districtOf(it.x, it.y)]); else if (it.d) drawDecor(it.x, it.y, it.d); }
      drawCitizens(); drawFx();
    }
    function step(dt) {
      tsec += dt; const S = get(); const pop = population(S.city, S.vitality);
      const target = Math.min(28, Math.floor(pop / 10)); const colors = ['#3E7CB1', '#C9491F', '#2E8F5B', '#B33E7E', '#E9B53B', '#555'];
      while (citizens.length < target) citizens.push({ x: Math.random() * N, y: Math.random() * N, tx: Math.random() * N, ty: Math.random() * N, c: colors[citizens.length % colors.length] });
      citizens.length = Math.min(citizens.length, target);
      for (const z of citizens) { const dx = z.tx - z.x, dy = z.ty - z.y, d = Math.hypot(dx, dy); if (d < 0.05) { z.tx = Math.random() * N; z.ty = Math.random() * N; } else { z.x += dx / d * dt * 0.3; z.y += dy / d * dt * 0.3; } }
      const carN = Math.min(4, Math.floor(pop / 40)); while (cars.length < carN) cars.push({ axis: cars.length % 2 ? 'x' : 'y', p: Math.random() * N, dir: Math.random() < 0.5 ? 1 : -1, c: colors[(cars.length + 2) % colors.length] }); cars.length = Math.min(cars.length, carN);
      for (const c of cars) { c.p += c.dir * dt * 0.9; if (c.p > N) { c.p = N; c.dir = -1; } if (c.p < 0) { c.p = 0; c.dir = 1; } }
      for (const cl of clouds) { cl.x += cl.v * dt; if (cl.x > W / scale + 30) cl.x = -30; }
      for (const f of fx) { f.age += dt; f.x += (f.vx || 0) * dt; f.y += (f.vy || 0) * dt; if (f.vy !== undefined) f.vy += 60 * dt; } fx = fx.filter(f => f.age < f.life);
    }
    function loop(ts) { if (!visible) { raf = 0; return; } if (ts - lastFrame >= 33) { const dt = Math.min(0.1, (ts - lastFrame) / 1000 || 0.03); lastFrame = ts; step(dt); draw(); if (auction) drawAuction(ts); if (imp) tickImp(); } raf = requestAnimationFrame(loop); }
    function show(v) { visible = v; if (v) { size(); renderHud(); renderPanel(); if (!raf) raf = requestAnimationFrame(loop); } }
    function burst(n, text) { const cx = ox, cy = oy + N * THH; for (let i = 0; i < n; i++) fx.push({ kind: 'coin', x: cx + (Math.random() - 0.5) * 40, y: cy, vx: (Math.random() - 0.5) * 80, vy: -90 - Math.random() * 60, age: 0, life: 1.1 }); if (text) fx.push({ kind: 'text', text, x: cx, y: cy - 20, vx: 0, vy: -25, age: 0, life: 1.4, color: '#E9B53B' }); }

    // ---- HUD ----
    function renderHud() {
      const S = get(); const c = S.city; const t = now(); const pend = pending(c, S.vitality, t); const inc = incomePerMin(c, S.vitality); const boosted = c.boost.until > t;
      const nt = nextTitle(c);
      hud.innerHTML = `
        <div class="ctile"><div class="k">Grit</div><div class="v">${fmt(S.grit)}</div><div class="s">from real life</div></div>
        <div class="ctile"><div class="k">Bucks</div><div class="v">${fmt(bucks(c))}</div><div class="s">${fmt(inc * 60)}/h${boosted ? ' · 2×' : ''}</div></div>
        <div class="ctile"><div class="k">${cityTitle(c)}</div><div class="v">${fmt(population(c, S.vitality))}</div><div class="s">pop · city lv ${cityLevel(c)}${nt ? ` → ${nt[1]} at ${nt[0]}` : ''}</div></div>
        <button class="collect${pend >= 1 ? ' ready' : ''}" id="city-collect" ${pend >= 1 ? '' : 'disabled'}>${c.lastCollect.t ? `Collect ${fmt(pend)} Bucks` : 'Start the clock'}<span class="s">8 h offline cap</span></button>`;
      hud.querySelector('#city-collect').addEventListener('click', () => {
        const S2 = get(); const c2 = S2.city; const t2 = now(); const p = Math.floor(pending(c2, S2.vitality, t2));
        const l = (c2.ledger[deviceId] ||= { earned: 0, spent: 0 }); l.earned += p; c2.lastCollect.t = t2; c2.collects[S2.todayKey] = (c2.collects[S2.todayKey] || 0) + 1;
        commit(); if (p > 0) { toast(`+${fmt(p)} Bucks collected`); burst(Math.min(14, 3 + Math.floor(p / 50)), `+${fmt(p)}`); } renderHud(); renderPanel();
      });
    }

    // ---- Panel ----
    function renderPanel() {
      if (auction || imp) return;
      const S = get(); const c = S.city; const k = S.todayKey;
      const a = c.auction[k] || { plays: 0 }; const im = c.imp[k] || { plays: 0, best: 0 };
      const ct = contractFor(k); const ctDone = ct.check(c, k); const ctClaimed = !!(c.contracts[k] && c.contracts[k].claimed);
      let html = `<div class="contract${ctClaimed ? ' done' : ctDone ? ' ready' : ''}"><span>📜 <b>Today’s contract:</b> ${ct.text}</span>${ctClaimed ? '<span class="s">claimed</span>' : ctDone ? `<button class="btn sm gold" id="ct-claim">Claim ${ct.reward} Bucks</button>` : `<span class="s">+${ct.reward} Bucks</span>`}</div>`;
      if (!sel) html += `<div class="chint">Tap a plot to build or upgrade. Buildings cost <b>Grit</b> — earned only by real missions. Income is <b>Bucks</b>. Buildings change shape at level 10 and 20; a district with 30 total levels earns a landmark (+25%).</div>`;
      else {
        const [x, y] = sel; const d = districtOf(x, y); const key = `${x},${y}`; const p = c.plots[key]; const dec = c.decor[key]; const lvl = S.statLevels[d] || 1; const cap = lvl * 3;
        if (!S.unlocked[d]) html += `<div class="chint">🔒 <b>${DISTRICTS[d].name}</b> opens when your <b>${d[0].toUpperCase() + d.slice(1)}</b> stat reaches level 2. Earn it in real life.</div>`;
        else if (p) {
          const b = BUILDINGS[p.type]; const cost = upgradeCost(b, p.lv); const adj = adjacency(c, x, y); const inc = b.inc * p.lv * (1 + adj) * (S.vitality[d] || 1);
          const T = tier(p.lv); const nextT = T === 1 ? 10 : T === 2 ? 20 : null;
          html += `<div class="csel"><span class="e">${b.e}</span><div><b>${b.name}</b> · level ${p.lv} · tier ${T}${p.lv >= cap ? ' (cap)' : ''}<div class="s">${fmt(inc * 60)} Bucks/h${adj ? ` · +${Math.round(adj * 100)}% neighbours` : ''} · ${DISTRICTS[d].name} ${Math.round((S.vitality[d] || 1) * 100)}%${nextT ? ` · new look at L${nextT}` : ''}</div></div></div>
            <div class="cact">${p.lv >= cap ? `<span class="s">Level cap ${cap} — raise your ${d} stat to level ${lvl + 1} to build higher.</span>` : `<button class="btn primary" data-up="${key}" ${S.grit >= cost ? '' : 'disabled'}>Upgrade · ${fmt(cost)} Grit</button>`}</div>`;
        } else if (dec && dec.on) html += `<div class="csel"><span class="e">${DECOR[dec.type].e}</span><div><b>${DECOR[dec.type].name}</b><div class="s">+${Math.round(DECOR[dec.type].bonus * 100)}% town income</div></div></div>`;
        else {
          const opts = Object.entries(BUILDINGS).filter(([, b]) => b.d === d);
          html += `<div class="chint"><b>${DISTRICTS[d].name}</b> · empty plot. Build with Grit, or decorate with Bucks.</div><div class="cgrid">` +
            opts.map(([id, b]) => { const locked = lvl < b.unlock; const ok = !locked && S.grit >= b.cost; return `<button class="cbtn" data-build="${id}" data-key="${key}" ${ok ? '' : 'disabled'}><span class="e">${locked ? '🔒' : b.e}</span><b>${b.name}</b><span class="s">${locked ? `${d} lv ${b.unlock}` : `${b.cost} Grit · ${b.inc}/min`}</span></button>`; }).join('') +
            Object.entries(DECOR).map(([id, dd]) => `<button class="cbtn decor" data-decor="${id}" data-key="${key}" ${bucks(c) >= dd.bucks ? '' : 'disabled'}><span class="e">${dd.e}</span><b>${dd.name}</b><span class="s">${fmt(dd.bucks)} Bucks · +${Math.round(dd.bonus * 100)}%</span></button>`).join('') + `</div>`;
        }
      }
      const boosted = c.boost.until > now();
      html += `<div class="crow">
        <button class="btn" id="city-auction" ${a.plays >= 3 ? 'disabled' : ''}>🎯 Ad Auction · ${3 - a.plays} left</button>
        <button class="btn" id="city-imp" ${im.plays >= 2 ? 'disabled' : ''}>💥 Impressions · ${2 - im.plays} left${im.best ? ` · best ${im.best}` : ''}</button>
        <button class="btn" id="city-boost" ${boosted || bucks(c) < BOOST_COST ? 'disabled' : ''}>${boosted ? `⚡ Boost · ${Math.ceil((c.boost.until - now()) / 3600e3)} h left` : `⚡ 2× for 8 h · ${fmt(BOOST_COST)} Bucks`}</button></div>`;
      panel.innerHTML = html;
    }
    panel.addEventListener('click', e => {
      if (auction || imp) return;
      const S = get(); const c = S.city; const k = S.todayKey;
      const up = e.target.closest('[data-up]'), bd = e.target.closest('[data-build]'), dc = e.target.closest('[data-decor]');
      if (up) { const p = c.plots[up.dataset.up]; const b = BUILDINGS[p.type]; const cost = upgradeCost(b, p.lv); if (S.grit < cost) return; p.lv++; p.t = now(); commit(); toast(`${b.name} → level ${p.lv}${tier(p.lv) > tier(p.lv - 1) ? ' · NEW TIER' : ''}`, tier(p.lv) > tier(p.lv - 1)); burst(6); }
      else if (bd) { const b = BUILDINGS[bd.dataset.build]; if (S.grit < b.cost) return; c.plots[bd.dataset.key] = { type: bd.dataset.build, lv: 1, t: now() }; if (!c.lastCollect.t) c.lastCollect.t = now(); commit(); toast(`${b.e} ${b.name} built`); burst(6); }
      else if (dc) { const dd = DECOR[dc.dataset.decor]; if (bucks(c) < dd.bucks) return; const l = (c.ledger[deviceId] ||= { earned: 0, spent: 0 }); l.spent += dd.bucks; c.decor[dc.dataset.key] = { type: dc.dataset.decor, on: true, t: now() }; commit(); toast(`${dd.e} ${dd.name} placed`); }
      else if (e.target.closest('#city-boost')) { if (bucks(c) < BOOST_COST) return; const l = (c.ledger[deviceId] ||= { earned: 0, spent: 0 }); l.spent += BOOST_COST; c.boost = { until: now() + BOOST_MS, t: now() }; commit(); toast('⚡ Income doubled for 8 hours'); }
      else if (e.target.closest('#ct-claim')) { const ct = contractFor(k); if (!ct.check(c, k) || (c.contracts[k] && c.contracts[k].claimed)) return; const l = (c.ledger[deviceId] ||= { earned: 0, spent: 0 }); l.earned += ct.reward; c.contracts[k] = { claimed: now() }; commit(); toast(`📜 Contract paid · +${ct.reward} Bucks`, true); burst(10, `+${ct.reward}`); }
      else if (e.target.closest('#city-auction')) { startAuction(); return; }
      else if (e.target.closest('#city-imp')) { startImp(); return; }
      else return;
      renderHud(); renderPanel();
    });
    canvas.addEventListener('pointerdown', e => {
      if (auction) { stopAuction(); return; }
      if (imp) { tapImp(e); return; }
      const r = canvas.getBoundingClientRect(); const sx = (e.clientX - r.left) / scale, sy = (e.clientY - r.top) / scale;
      const [gx, gy] = toGrid(sx, sy); sel = (gx >= 0 && gy >= 0 && gx < N && gy < N) ? [gx, gy] : null; renderPanel();
    });

    // ---- Mini-game 1: Ad Auction (stop the needle) ----
    function startAuction() {
      const S = get(); const c = S.city; const k = S.todayKey; const a = (c.auction[k] ||= { plays: 0, hits: 0, perfect: 0, won: 0 }); if (a.plays >= 3) return;
      const L = c.skill.v; const w = Math.max(0.08, 0.30 * Math.pow(0.94, L)); const T = Math.max(0.55, 1.4 * Math.pow(0.97, L)); const zone = 0.1 + Math.random() * (0.8 - w);
      const base = Math.max(20, incomePerMin(c, S.vitality) * 60 * 24 * 0.1);
      auction = { t0: performance.now(), T, w, zone, base, result: null };
      panel.innerHTML = `<div class="auction"><div class="ah"><b>Ad Auction</b><span class="s">Stop the needle inside the winning bid. Tap the city.</span></div><div class="abar"><div class="azone" style="left:${zone * 100}%;width:${w * 100}%"></div><div class="aneedle" id="aneedle"></div></div><div class="s">Skill ${L} · win ${fmt(base * 2)} Bucks · perfect ${fmt(base * 3)}</div></div>`;
      panel.onclick = () => stopAuction();
    }
    function drawAuction(ts) { if (!auction || auction.result) return; const el = panel.querySelector('#aneedle'); if (!el) return; const ph = ((ts - auction.t0) / 1000 / auction.T) % 2; const pos = ph < 1 ? ph : 2 - ph; auction.pos = pos; el.style.left = `${pos * 100}%`; }
    function stopAuction() {
      if (!auction || auction.result) return;
      const S = get(); const c = S.city; const k = S.todayKey; const a = (c.auction[k] ||= { plays: 0, hits: 0, perfect: 0, won: 0 });
      const pos = auction.pos || 0; const { zone, w, base } = auction; const hit = pos >= zone && pos <= zone + w; const perfect = hit && Math.abs(pos - (zone + w / 2)) <= w * 0.2;
      const pay = Math.round(base * (perfect ? 3 : hit ? 2 : 0.5)); a.plays++; if (hit) a.hits++; if (perfect) a.perfect++; a.won += pay;
      const l = (c.ledger[deviceId] ||= { earned: 0, spent: 0 }); l.earned += pay; c.skill = { v: Math.max(0, c.skill.v + (hit ? 1 : -1)), t: now() };
      auction.result = perfect ? 'PERFECT BID' : hit ? 'PLACEMENT WON' : 'OUTBID'; commit();
      const el = panel.querySelector('.auction'); if (el) el.insertAdjacentHTML('beforeend', `<div class="ares ${hit ? 'win' : 'loss'}">${auction.result} · +${fmt(pay)} Bucks${perfect ? ' 🏆' : ''}${hit ? '' : ' — learned the CPM'}</div>`);
      toast(`${auction.result} · +${fmt(pay)} Bucks`, perfect); if (hit) burst(perfect ? 12 : 6);
      setTimeout(() => { auction = null; panel.onclick = null; renderHud(); renderPanel(); }, 1400);
    }
    // ---- Mini-game 2: Impressions (tap the bubbles before they pop) ----
    function startImp() {
      const S = get(); const c = S.city; const k = S.todayKey; const im = (c.imp[k] ||= { plays: 0, best: 0, won: 0 }); if (im.plays >= 2) return;
      imp = { t0: performance.now(), dur: 10000, bubbles: [], hits: 0, misses: 0, last: 0, done: false };
      panel.innerHTML = `<div class="auction"><div class="ah"><b>Impressions</b><span class="s">Tap the ad bubbles on the city before they fade. 10 seconds.</span></div><div class="s" id="imp-status">Go!</div></div>`;
    }
    function tickImp() {
      if (!imp || imp.done) return; const t = performance.now(); const el = t - imp.t0;
      const st = panel.querySelector('#imp-status'); if (st) st.textContent = `${Math.max(0, Math.ceil((imp.dur - el) / 1000))}s · ${imp.hits} popped`;
      if (t - imp.last > Math.max(320, 700 - el / 20)) { imp.last = t; imp.bubbles.push({ x: 30 + Math.random() * (W / scale - 60), y: 40 + Math.random() * (H / scale - 90), r: 11 + Math.random() * 7, born: t, life: 1400 + Math.random() * 600, e: ['📣', '👁️', '💬', '🛒', '📈'][Math.floor(Math.random() * 5)] }); }
      imp.bubbles = imp.bubbles.filter(b => { if (t - b.born > b.life) { imp.misses++; return false; } return true; });
      for (const b of imp.bubbles) { const a = 1 - (t - b.born) / b.life; ctx.globalAlpha = 0.35 + a * 0.65; ellipseIso(b.x, b.y, b.r, b.r, 'rgba(255,255,255,.9)', '#1F7A5C', 2); ctx.globalAlpha = 1; label(b.e, b.x, b.y + 1, b.r); }
      if (el >= imp.dur) endImp();
    }
    function tapImp(e) {
      if (!imp || imp.done) return; const r = canvas.getBoundingClientRect(); const sx = (e.clientX - r.left) / scale, sy = (e.clientY - r.top) / scale;
      const i = imp.bubbles.findIndex(b => Math.hypot(b.x - sx, b.y - sy) <= b.r + 6);
      if (i >= 0) { const b = imp.bubbles.splice(i, 1)[0]; imp.hits++; fx.push({ kind: 'text', text: '+1', x: b.x, y: b.y, vx: 0, vy: -30, age: 0, life: 0.6, color: '#1F7A5C' }); }
    }
    function endImp() {
      imp.done = true; const S = get(); const c = S.city; const k = S.todayKey; const im = (c.imp[k] ||= { plays: 0, best: 0, won: 0 });
      const base = Math.max(3, incomePerMin(c, S.vitality) * 60 * 24 * 0.004); const pay = Math.round(base * imp.hits);
      im.plays++; im.best = Math.max(im.best, imp.hits); im.won += pay; const l = (c.ledger[deviceId] ||= { earned: 0, spent: 0 }); l.earned += pay; commit();
      const el = panel.querySelector('.auction'); if (el) el.insertAdjacentHTML('beforeend', `<div class="ares win">${imp.hits} impressions · +${fmt(pay)} Bucks${imp.hits >= 25 ? ' 🏆' : ''}</div>`);
      toast(`💥 ${imp.hits} popped · +${fmt(pay)} Bucks`, imp.hits >= 25); burst(Math.min(12, imp.hits / 2));
      setTimeout(() => { imp = null; renderHud(); renderPanel(); }, 1500);
    }

    window.addEventListener('resize', () => { if (visible) { size(); } });
    return { show, refresh: () => { if (visible) { renderHud(); renderPanel(); } } };
  }

  return { DISTRICTS, BUILDINGS, DECOR, norm, merge, emptyCity, gritSpent, bucks, incomePerMin, pending, population, districtLevel, cityLevel, cityTitle, fmt, mount };
})();
