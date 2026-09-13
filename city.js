/* Empire City v3 — a SimCity-style simulation fed by real life.
   Grit (earned only by real missions) pays for every structural decision: roads, zones, services, land.
   The city zones grow on their own over real-time hours when conditions hold; taxes pay Bucks, which buy only cosmetics.
   Exports pure helpers for the main app (merge, gritSpent, bucks, fmt, population, cityTitle) and mount() for the canvas. */
window.City = (() => {
  'use strict';

  // =====================================================================
  // World & rules
  // =====================================================================
  const W = 16, TW = 64, TH = 32, TWH = 32, THH = 16;
  const CORE = [3, 13];                       // owned x/y range at ring 0 (10×10); each ring adds one tile each side
  const RIVER_X = 0;                          // column of water down the left edge
  const HOUR = 3600e3, DAY = 24 * HOUR;
  const TAX_CAP_MS = 12 * HOUR;               // unclaimed tax stops accruing after 12 h
  const ZONES = {
    r: { name: 'Residential', e: '🏘️', grit: 10, hue: 32,  pop: [0, 8, 30, 100],  jobs: [0, 0, 0, 0] },
    c: { name: 'Commercial',  e: '🏬', grit: 12, hue: 212, pop: [0, 0, 0, 0],     jobs: [0, 4, 15, 50] },
    i: { name: 'Industrial',  e: '🏭', grit: 12, hue: 20,  pop: [0, 0, 0, 0],     jobs: [0, 6, 20, 60], poll: [0, 4, 8, 12] },
  };
  const SERVICES = {
    power:  { name: 'Power plant', e: '⚡', grit: 150, r: 8, cap: 60,  capKind: 'tiles', up: 20, poll: 15, pr: 4, mile: 0 },
    water:  { name: 'Water tower', e: '💧', grit: 80,  r: 6, cap: 40,  capKind: 'tiles', up: 10, mile: 0 },
    park:   { name: 'Park',        e: '🌳', grit: 30,  r: 3, up: 2, mile: 50 },
    school: { name: 'School',      e: '🏫', grit: 150, r: 5, cap: 250, capKind: 'pop', up: 15, mile: 50 },
    clinic: { name: 'Clinic',      e: '🏥', grit: 120, r: 5, cap: 300, capKind: 'pop', up: 15, mile: 200 },
    fire:   { name: 'Fire station',e: '🚒', grit: 100, r: 6, cap: 400, capKind: 'pop', up: 12, mile: 200 },
    police: { name: 'Police',      e: '🚓', grit: 100, r: 6, cap: 400, capKind: 'pop', up: 12, mile: 500 },
    stadium:{ name: 'Stadium',     e: '🏟️', grit: 500, r: 6, up: 30, mile: 4000 },
  };
  const DECOR = {
    tree:   { name: 'Trees',       e: '🌲', bucks: 50,  lv: 4,  mile: 0 },
    light:  { name: 'Streetlight', e: '💡', bucks: 100, lv: 3,  mile: 50 },
    plaza:  { name: 'Plaza',       e: '⛲', bucks: 150, lv: 8,  mile: 1500 },
    statue: { name: 'Statue',      e: '🗽', bucks: 400, lv: 12, mile: 1500 },
    // landmarks: gated by the player's level (rank), not by population; each lifts land value within reach
    monument: { name: 'Monument',     e: '🗿', bucks: 300, lv: 12, mile: 0, rank: 7,  r: 3 },
    tower:    { name: 'Sky Tower',    e: '🗼', bucks: 500, lv: 16, mile: 0, rank: 8,  r: 4 },
    arch:     { name: 'Grand Arch',   e: '🌉', bucks: 650, lv: 20, mile: 0, rank: 9,  r: 4 },
    palace:   { name: 'Crown Palace', e: '👑', bucks: 900, lv: 25, mile: 0, rank: 10, r: 5 },
  };
  const ROAD_GRIT = 5, FEST_BUCKS = 300, FEST_MS = DAY;
  const MILES = [[0, 'Outpost'], [50, 'Hamlet'], [200, 'Village'], [500, 'Town'], [1500, 'City'], [4000, 'Metropolis'], [10000, 'Empire City']];
  const LAND_GATE = [50, 200, 500];         // peak pop needed to buy ring 1, 2, 3
  const GROW_H = [2, 24, 72];                 // hours to reach L1, L2, L3 when conditions hold
  const DECLINE_H = 48;
  const POP_MAX = { L2: 500, L3: 1500 };      // milestone gates for density
  const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
  const kkey = (x, y) => `${x},${y}`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // seeded prng — buildings look the same every render
  const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

  // =====================================================================
  // State (merge-friendly: every record carries t)
  // =====================================================================
  const emptyCity = () => ({ v: 3, tiles: {}, ring: { v: 0, t: 0 }, tax: { v: 7, t: 0 }, ledger: {}, gspent: {}, lastTax: { t: 0 }, lastSim: { t: 0 }, fest: { until: 0, t: 0 }, peakPop: { v: 0, t: 0 }, seen: {} });
  const KINDS = new Set(['road', 'r', 'c', 'i', 'hall', ...Object.keys(SERVICES), ...Object.keys(DECOR)]);
  function norm(c) {
    const out = emptyCity(); if (!c || typeof c !== 'object' || c.v !== 3) return out; // v1/v2 towns are retired; the founder's stipend rebuilds
    for (const k in c.tiles || {}) { const p = c.tiles[k]; if (p && KINDS.has(p.k)) out.tiles[k] = { k: p.k, lv: clamp(+p.lv || 0, 0, 3), t: +p.t || 0, g: +p.g || 0, d: +p.d || 0, gone: !!p.gone }; }
    out.ring = { v: clamp(+(c.ring && c.ring.v) || 0, 0, 3), t: +(c.ring && c.ring.t) || 0 };
    out.tax = { v: clamp(+(c.tax && c.tax.v) || 7, 0, 20), t: +(c.tax && c.tax.t) || 0 };
    for (const k in c.ledger || {}) { const l = c.ledger[k]; if (l) out.ledger[k] = { earned: +l.earned || 0, spent: +l.spent || 0 }; }
    for (const k in c.gspent || {}) out.gspent[k] = +c.gspent[k] || 0;
    out.lastTax = { t: +(c.lastTax && c.lastTax.t) || 0 }; out.lastSim = { t: +(c.lastSim && c.lastSim.t) || 0 };
    out.fest = { until: +(c.fest && c.fest.until) || 0, t: +(c.fest && c.fest.t) || 0 };
    out.peakPop = { v: +(c.peakPop && c.peakPop.v) || 0, t: +(c.peakPop && c.peakPop.t) || 0 };
    for (const k in c.seen || {}) out.seen[k] = true;
    return out;
  }
  function merge(a, b) {
    a = norm(a); b = norm(b); const out = emptyCity();
    const keys = (x, y) => [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
    const newer = (x, y) => (!x ? y : !y ? x : (x.t || 0) >= (y.t || 0) ? x : y);
    for (const k of keys(a.tiles, b.tiles)) out.tiles[k] = newer(a.tiles[k], b.tiles[k]);
    out.ring = newer(a.ring, b.ring); out.tax = newer(a.tax, b.tax); out.fest = newer(a.fest, b.fest); out.peakPop = { v: Math.max(a.peakPop.v, b.peakPop.v), t: 0 };
    for (const k of keys(a.ledger, b.ledger)) { const x = a.ledger[k] || { earned: 0, spent: 0 }, y = b.ledger[k] || { earned: 0, spent: 0 }; out.ledger[k] = { earned: Math.max(x.earned, y.earned), spent: Math.max(x.spent, y.spent) }; }
    for (const k of keys(a.gspent, b.gspent)) out.gspent[k] = Math.max(a.gspent[k] || 0, b.gspent[k] || 0);
    out.lastTax = { t: Math.max(a.lastTax.t, b.lastTax.t) }; out.lastSim = { t: Math.max(a.lastSim.t, b.lastSim.t) };
    for (const k of keys(a.seen, b.seen)) out.seen[k] = true;
    return out;
  }
  const gritSpent = c => Object.values(c.gspent || {}).reduce((s, v) => s + v, 0);
  const bucks = c => Object.values(c.ledger || {}).reduce((s, l) => s + l.earned - l.spent, 0);
  const owned = (c, x, y) => { const r = c.ring.v; return x >= Math.max(RIVER_X + 1, CORE[0] - r) && x < Math.min(W, CORE[1] + r) && y >= Math.max(0, CORE[0] - r) && y < Math.min(W, CORE[1] + r); };
  const tileAt = (c, x, y) => { const p = c.tiles[kkey(x, y)]; return p && !p.gone ? p : null; };
  const expandCost = c => Math.round(250 * Math.pow(1.5, c.ring.v));
  const landSize = r => { const x0 = Math.max(RIVER_X + 1, CORE[0] - r), x1 = Math.min(W, CORE[1] + r), y0 = Math.max(0, CORE[0] - r), y1 = Math.min(W, CORE[1] + r); return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0 }; };

  // =====================================================================
  // Simulation
  // =====================================================================
  // vit: {business, body, health, family} in 0..1 → modifier 0.7..1.3
  const mod = v => 0.7 + 0.6 * clamp(v == null ? 0.5 : v, 0, 1);
  function analyze(c, vit) {
    const M = { family: mod(vit.family), business: mod(vit.business), body: mod(vit.body), health: mod(vit.health) };
    const T = c.tiles; const live = {}; for (const k in T) if (!T[k].gone) live[k] = T[k];
    const at = (x, y) => live[kkey(x, y)];
    // road network connected to City Hall
    let hall = null; for (const k in live) if (live[k].k === 'hall') hall = k.split(',').map(Number);
    const conn = new Set();
    if (hall) { const q = []; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const p = at(hall[0] + dx, hall[1] + dy); if (p && p.k === 'road') { const kk = kkey(hall[0] + dx, hall[1] + dy); if (!conn.has(kk)) { conn.add(kk); q.push([hall[0] + dx, hall[1] + dy]); } } }
      while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const p = at(x + dx, y + dy); const kk = kkey(x + dx, y + dy); if (p && p.k === 'road' && !conn.has(kk)) { conn.add(kk); q.push([x + dx, y + dy]); } } } }
    const nearRoad = (x, y, r) => { for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (Math.abs(dx) + Math.abs(dy) <= r && conn.has(kkey(x + dx, y + dy))) return true; return false; };
    const info = {}; // per tile
    for (const k in live) { const [x, y] = k.split(',').map(Number); const p = live[k]; info[k] = { x, y, p, active: false, cov: {}, eff: {}, poll: 0, lv: 0 }; if (ZONES[p.k]) info[k].active = nearRoad(x, y, 2); else if (SERVICES[p.k]) info[k].active = nearRoad(x, y, 1) || p.k === 'park'; else info[k].active = true; }
    // service coverage & capacity
    const svc = []; for (const k in live) if (SERVICES[live[k].k] && info[k].active) svc.push({ ...info[k], s: SERVICES[live[k].k], type: live[k].k });
    const popOf = i => ZONES[i.p.k] ? ZONES[i.p.k].pop[i.p.lv] : 0;
    for (const s of svc) {
      const R = s.type === 'park' || s.type === 'stadium' ? Math.max(2, Math.round(s.s.r * M.body)) : s.s.r; let load = 0; const inR = [];
      for (const k in info) { const i = info[k]; if (Math.max(Math.abs(i.x - s.x), Math.abs(i.y - s.y)) <= R) { inR.push(i); if (s.s.capKind === 'tiles') load += ZONES[i.p.k] ? 1 : 0; else if (s.s.capKind === 'pop') load += popOf(i); } }
      let cap = s.s.cap || Infinity; if (s.type === 'clinic') cap = Math.round(cap * M.health);
      const eff = cap === Infinity ? 1 : Math.min(1, cap / Math.max(1, load)); s.load = load; s.cap = cap; s.eff = eff; s.R = R;
      for (const i of inR) { i.cov[s.type] = true; i.eff[s.type] = Math.max(i.eff[s.type] || 0, eff); }
    }
    // pollution
    const pm = {}; const emit = (x, y, E, r) => { for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); if (d > r) continue; const kk = kkey(x + dx, y + dy); pm[kk] = (pm[kk] || 0) + E * (1 - d / (r + 1)); } };
    const pollMul = 1.3 - 0.6 * clamp(vit.health == null ? 0.5 : vit.health, 0, 1);
    for (const k in info) { const i = info[k]; if (i.p.k === 'i' && i.p.lv > 0 && i.active) emit(i.x, i.y, ZONES.i.poll[i.p.lv] * pollMul, 3); if (i.p.k === 'power' && i.active) emit(i.x, i.y, SERVICES.power.poll * pollMul, SERVICES.power.pr); }
    for (const k in info) info[k].poll = Math.round(pm[k] || 0);
    // pop / jobs
    let pop = 0, jobsC = 0, jobsI = 0, rTiles = 0, rCov = 0, rPark = 0, rPoll = 0, vacantR = 0;
    for (const k in info) { const i = info[k]; if (!ZONES[i.p.k] || !i.active) continue; if (i.p.k === 'r') { pop += ZONES.r.pop[i.p.lv]; if (i.p.lv > 0) { rTiles++; let n = 0; for (const s of ['power', 'water', 'clinic', 'school', 'fire', 'police']) if (i.cov[s]) n += i.eff[s]; rCov += n / 6; if (i.cov.park) rPark++; rPoll += i.poll; } else vacantR++; } else if (i.p.k === 'c') jobsC += ZONES.c.jobs[i.p.lv]; else jobsI += ZONES.i.jobs[i.p.lv]; }
    const jobs = jobsC + jobsI, workforce = 0.5 * pop, tax = c.tax.v;
    const avgCov = rTiles ? rCov / rTiles : 0, parkShare = rTiles ? rPark / rTiles : 0, avgPoll = rTiles ? rPoll / rTiles : 0;
    const fest = c.fest.until > Date.now() ? 5 : 0;
    const happiness = clamp(Math.round(50 + 25 * avgCov + 10 * parkShare - 0.1 * avgPoll - 3 * (tax - 7) + 20 * (clamp(vit.family == null ? 0.5 : vit.family, 0, 1) - 0.5) + fest), 0, 100);
    // land value
    const lms = []; for (const k in live) { const d = DECOR[live[k].k]; if (d && d.rank) { const [x, y] = k.split(',').map(Number); lms.push({ x, y, r: d.r, b: d.lv }); } }
    for (const k in info) { const i = info[k]; let lv = 30; for (const lm of lms) if (Math.max(Math.abs(i.x - lm.x), Math.abs(i.y - lm.y)) <= lm.r) lv += lm.b; if (i.cov.park) lv += 20; if (i.cov.school || i.cov.clinic) lv += 15; if (i.cov.fire && i.cov.police) lv += 10; let l3 = 0, adjI = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const o = at(i.x + dx, i.y + dy); if (o && ZONES[o.k] && o.lv === 3) l3++; if (o && o.k === 'i') adjI = true; } lv += 5 * l3 - i.poll - (adjI ? 10 : 0); if (i.cov.plaza) lv += 5; i.lv = clamp(Math.round(lv), 0, 100); }
    for (const k in info) { const i = info[k]; let s = 0, n = 0; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const o = info[kkey(i.x + dx, i.y + dy)]; if (o) { s += o.lv; n++; } } i.lvs = Math.round(s / Math.max(1, n)); }
    // demand
    const dem = { r: clamp(0.6 * clamp((jobs - workforce) / (workforce + 20), -1, 1) + 0.4 * (happiness - 50) / 50 - 0.05 * (tax - 7), -1, 1),
                  c: clamp(clamp((0.3 * pop - jobsC) / (0.3 * pop + 10), -1, 1) * M.business - 0.05 * (tax - 7), -1, 1),
                  i: clamp(clamp((0.25 * pop - jobsI) / (0.25 * pop + 10), -1, 1) - 0.05 * (tax - 7), -1, 1) };
    if (pop === 0) { dem.r = 0.8; dem.c = 0.3; dem.i = 0.3; } else if (pop < 50) { dem.r = Math.max(dem.r, 0.3); dem.c = Math.max(dem.c, 0.2); dem.i = Math.max(dem.i, 0.2); } // a young town always wants to grow
    // budget (per day)
    let avgLV = 0, nz = 0; for (const k in info) if (ZONES[info[k].p.k]) { avgLV += info[k].lvs; nz++; } avgLV = nz ? avgLV / nz : 30;
    const income = pop * 0.5 * (tax / 7) * (0.75 + 0.5 * avgLV / 100) * M.business + 0.1 * jobs;
    let upkeep = 0; for (const s of svc) upkeep += s.s.up;
    const peak = Math.max(pop, c.peakPop.v); let mile = MILES[0]; for (const m of MILES) if (peak >= m[0]) mile = m; const next = MILES.find(m => peak < m[0]) || null;
    return { M, info, svc, conn, hall, pop, jobs, jobsC, jobsI, workforce, happiness, dem, income, upkeep, avgCov, parkShare, avgPoll, avgLV, vacantR, mile, next, peak, tax, unemployed: Math.max(0, workforce - jobs) };
  }
  // growth: run at open and once a minute; returns events for the away report
  function simulate(c, vit, now) {
    const ev = { grew: 0, fell: 0, touched: false };
    for (let iter = 0; iter < 4; iter++) {
      const A = analyze(c, vit); let changed = false;
      for (const k in A.info) {
        const i = A.info[k], p = i.p, z = ZONES[p.k]; if (!z) continue;
        const ok = growthOK(i, A, c), hold = growthOK(i, A, c, true);
        if (ok.ok && p.lv < 3) { const tm = GROW_H[p.lv] * HOUR / (p.k === 'r' ? A.M.family : p.k === 'c' ? A.M.business : 1); if (!p.g) { p.g = now; ev.touched = true; } else if (now - p.g >= tm) { p.lv++; p.t = now; p.g = now; ev.grew++; changed = true; } }
        else if (p.g) { p.g = 0; ev.touched = true; }
        // a built tile only declines when it loses what its CURRENT level needs (road, power, water, services) — never for lack of demand
        if (p.lv > 0 && !hold.ok) { if (!p.d) { p.d = now; ev.touched = true; } else if (now - p.d >= DECLINE_H * HOUR) { p.lv--; p.t = now; p.d = now; ev.fell++; changed = true; } } else p.d = 0;
      }
      if (!changed) break;
    }
    const A = analyze(c, vit); if (A.pop > c.peakPop.v) c.peakPop = { v: A.pop, t: now };
    c.lastSim.t = now; return ev;
  }
  // hold=false: what the NEXT level needs. hold=true: what the CURRENT level needs to stay standing (structure only, never demand/mood).
  function growthOK(i, A, c, hold) {
    const p = i.p, need = []; const want = hold ? p.lv : p.lv + 1;
    if (want >= 1) { if (!i.active) need.push('road within 2 tiles'); if (!i.cov.power) need.push('power'); }
    if (!hold && want >= 1 && A.dem[p.k] <= 0 && A.pop > 0) need.push('demand');
    if (want >= 2) { if (!i.cov.water) need.push('water'); if (!(i.cov.clinic || i.cov.school)) need.push('clinic or school'); if (!hold) { if (A.happiness < 60) need.push('happiness 60'); if (i.lvs < 40) need.push('land value 40'); if (A.peak < POP_MAX.L2) need.push('Town (500 pop)'); } }
    if (want >= 3) { for (const s of ['water', 'clinic', 'school', 'fire', 'police']) if (!i.cov[s]) need.push(s); if (!hold) { if (A.happiness < 75) need.push('happiness 75'); if (i.lvs < 70) need.push('land value 70'); for (const s of ['water', 'clinic', 'school', 'fire', 'police']) if (i.cov[s] && i.eff[s] < 0.99) need.push(s + ' over capacity'); if (A.dem[p.k] <= 0.2) need.push('stronger demand'); if (A.peak < POP_MAX.L3) need.push('City (1500 pop)'); } }
    if (!hold && p.lv >= 3) return { ok: true, need: [] };
    return { ok: need.length === 0, need };
  }
  function taxPending(c, A, now) { if (!c.lastTax.t) return 0; const ms = clamp(now - c.lastTax.t, 0, TAX_CAP_MS); return Math.max(0, A.income - A.upkeep) * ms / DAY; }
  function advisor(c, A) {
    const inf = Object.values(A.info); const zones = inf.filter(i => ZONES[i.p.k]);
    if (!A.hall) return 'Place City Hall — everything connects to it.';
    if (!inf.some(i => i.p.k === 'road')) return 'Draw roads from City Hall. Zones only grow within 2 tiles of a road.';
    if (!inf.some(i => i.p.k === 'power')) return 'No power plant. Nothing grows without electricity — put it downwind of homes.';
    if (zones.length === 0) return 'Zone some land: Residential first, then a little Commercial and Industrial for jobs.';
    const un = zones.filter(i => !i.cov.power && i.active); if (un.length) return `${un.length} zoned tile${un.length > 1 ? 's are' : ' is'} outside the power plant’s reach.`;
    const off = zones.filter(i => !i.active); if (off.length) return `${off.length} zoned tile${off.length > 1 ? 's' : ''} too far from a connected road — nothing will move in.`;
    if (A.pop >= 50 && A.income - A.upkeep < 0) return 'Upkeep exceeds tax income. Raise tax a point or hold off on the next service.';
    if (A.pop >= 50 && !inf.some(i => i.p.k === 'water')) return 'Homes want water before they’ll densify. A water tower covers 6 tiles.';
    if (A.unemployed > 0.15 * A.workforce && A.workforce > 10) return 'Unemployment is high — zone Commercial or Industrial for jobs.';
    if (A.pop > 0 && A.jobs === 0) return 'No jobs yet. A strip of Industrial away from the homes gets people working — and paying tax.';
    if (A.pop > 0 && A.jobs > A.workforce * 1.6) return 'More jobs than workers. Zone Residential.';
    if (A.happiness < 50) return A.avgPoll > 30 ? 'Pollution is on your homes. Move industry away or buffer it with a park.' : 'Happiness is low — services in range and a park would lift it.';
    if (A.pop >= 50 && A.parkShare < 0.3) return 'Fewer than a third of homes are near a park. Land value is waiting on it.';
    if (A.pop >= 200 && !inf.some(i => i.p.k === 'school')) return 'A school is what unlocks the next density.';
    const best = Object.entries(A.M).sort((a, b) => b[1] - a[1])[0];
    return { family: 'Your Family streak is why the lights are on in every window tonight.', business: 'Business is strong — shops are filling and the treasury shows it.', body: 'Body streak: the parks are packed and reach further.', health: 'Health streak: the air is cleaner than it should be for this much industry.' }[best[0]];
  }
  const population = (c, vit) => analyze(c, vit || {}).pop;
  const cityTitle = (c, vit) => analyze(c, vit || {}).mile[1];

  // =====================================================================
  // Controller: canvas, camera, tools, panel
  // =====================================================================
  function mount(opts) {
    const { canvas, panel, hud, get, commit, toast, deviceId } = opts;
    const ctx = canvas.getContext('2d');
    let cssW = 0, cssH = 0, dpr = 1, cam = { x: 0, y: 0, z: 1 }, visible = false, raf = 0, lastFrame = 0, tsec = 0;
    let tool = 'select', sub = null, view = 'none', sel = null, dirtyG = true, dirtyB = true, nightFlag = null;
    let ground = null, blds = null, GS = 2; // offscreen layers rendered at scale GS
    let cars = [], smoke = [], fx = [], lastA = null, awayShown = false;
    const now = () => Date.now();
    const isNight = () => { const h = new Date().getHours(); return h >= 20 || h < 6; };
    const WORLD_W = W * TW, WORLD_H = W * TH + 220, OX = WORLD_W / 2, OY = 140;
    const toScreen = (x, y) => [OX + (x - y) * TWH, OY + (x + y) * THH];
    const toGrid = (sx, sy) => { const x = sx - OX, y = sy - OY; return [Math.floor((x / TWH + y / THH) / 2), Math.floor((y / THH - x / TWH) / 2)]; };
    function size() {
      cssW = canvas.clientWidth || 360; cssH = Math.round(Math.min(520, cssW * 1.2)); dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr); canvas.style.height = cssH + 'px';
      if (!ground) { ground = document.createElement('canvas'); blds = document.createElement('canvas'); ground.width = blds.width = WORLD_W * GS; ground.height = blds.height = WORLD_H * GS; fitCamera(); }
    }
    function fitCamera() { const L = landSize(get().city.ring.v); const n = Math.max(L.w, L.h); cam.z = clamp(cssW / ((n + 1) * TW + 16), 0.35, 1.6); const [cx, cy] = toScreen((L.x0 + L.x1) / 2, (L.y0 + L.y1) / 2); cam.x = cssW / 2 / cam.z - cx; cam.y = cssH / 2 / cam.z - cy + 6; }
    function zoomAt(f) { const z = clamp(cam.z * f, 0.35, 2.2); const mx = cssW / 2, my = cssH / 2; cam.x = mx / z - (mx / cam.z - cam.x); cam.y = my / z - (my / cam.z - cam.y); cam.z = z; }
    const zoomEl = canvas.parentElement && canvas.parentElement.querySelector('.czoom');
    if (zoomEl) zoomEl.addEventListener('click', e => { const b = e.target.closest('[data-z]'); if (!b) return; if (b.dataset.z === 'fit') fitCamera(); else zoomAt(b.dataset.z === 'in' ? 1.3 : 0.77); });
    const toWorld = (px, py) => [px / cam.z - cam.x, py / cam.z - cam.y];

    // ---- drawing primitives (world space) ----
    let g; // current ctx for helpers
    const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
    function corners(x, y, w, d) { const [sx, sy0] = toScreen(x, y); const cx = sx, cy = sy0 + THH; const ax = w * TWH / 2, ay = w * THH / 2, bx = d * TWH / 2, by = d * THH / 2; return { c: [cx, cy], b: [cx - ax + bx, cy - ay - by], r: [cx + ax + bx, cy + ay - by], f: [cx + ax - bx, cy + ay + by], l: [cx - ax - bx, cy - ay + by] }; }
    function poly(pts, fill, stroke, lw) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 1; g.stroke(); } }
    const up = (p, h) => [p[0], p[1] - h];
    function box(x, y, w, d, h, hue, sat, lit, o = {}) {
      const c = corners(x, y, w, d);
      // ground shadow + base band = the "not floating" trick
      poly([c.b, [c.r[0] + 6, c.r[1] + 2], [c.f[0] + 6, c.f[1] + 4], c.l], 'rgba(0,0,30,.16)');
      poly([c.l, c.f, up(c.f, h), up(c.l, h)], hsl(hue, sat, lit));
      poly([c.f, c.r, up(c.r, h), up(c.f, h)], hsl(hue, sat, lit - 14));
      poly([c.l, c.f, up(c.f, 3), up(c.l, 3)], 'rgba(0,0,0,.22)'); poly([c.f, c.r, up(c.r, 3), up(c.f, 3)], 'rgba(0,0,0,.28)');
      poly([up(c.b, h), up(c.r, h), up(c.f, h), up(c.l, h)], o.roof || hsl(hue, sat, lit + 12), 'rgba(0,0,0,.15)');
      if (o.win) windows(c, h, o.win, o.night, o.glass);
      return c;
    }
    function windows(c, h, spec, night, glass) {
      const r = spec.rng; const rows = Math.max(1, Math.floor((h - 8) / spec.fp)), cols = spec.cols;
      for (const [A, B, dark] of [[c.l, c.f, false], [c.f, c.r, true]]) for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const t = (col + 0.5) / cols; const px = A[0] + (B[0] - A[0]) * t, py = A[1] + (B[1] - A[1]) * t - 7 - row * spec.fp;
        const lit = night && r() < 0.62; g.fillStyle = lit ? 'rgba(255,224,140,.95)' : glass ? (dark ? 'rgba(170,205,235,.55)' : 'rgba(200,228,250,.7)') : (dark ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.45)');
        if (spec.ribbon) g.fillRect(px - (B[0] - A[0]) / cols / 2 + 1, py - 2, (B[0] - A[0]) / cols - 2, 3); else g.fillRect(px - 1.5, py - 2.5, 3, 4);
      }
    }
    function roof(c, h, rh, hue, sat, lit) { const bl = up(c.l, h), bf = up(c.f, h), br = up(c.r, h), bb = up(c.b, h); const r1 = [(bl[0] + bb[0]) / 2, (bl[1] + bb[1]) / 2 - rh], r2 = [(bf[0] + br[0]) / 2, (bf[1] + br[1]) / 2 - rh]; poly([bl, bf, r2, r1], hsl(hue, sat, lit)); poly([bf, br, r2], hsl(hue, sat, lit - 16)); poly([bb, br, r2, r1], hsl(hue, sat, lit - 22)); }
    function ell(cx, cy, rx, ry, fill, stroke, lw) { g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 1; g.stroke(); } }
    function cyl(cx, cy, r, h, hue, sat, lit) { g.fillStyle = hsl(hue, sat, lit - 10); g.fillRect(cx - r, cy - h, r, h); g.fillStyle = hsl(hue, sat, lit - 22); g.fillRect(cx, cy - h, r, h); ell(cx, cy, r, r / 2, hsl(hue, sat, lit - 16)); ell(cx, cy - h, r, r / 2, hsl(hue, sat, lit + 8), 'rgba(0,0,0,.2)'); }
    function tree(cx, cy, s, hue) { ell(cx + 3, cy + 1, 5 * s, 2.5 * s, 'rgba(0,0,30,.18)'); g.fillStyle = hsl(28, 40, 30); g.fillRect(cx - 1.2 * s, cy - 6 * s, 2.4 * s, 6 * s); ell(cx, cy - 8 * s, 5 * s, 5 * s, hsl(hue, 45, 32)); ell(cx - 1, cy - 10 * s, 4 * s, 4 * s, hsl(hue, 50, 40)); ell(cx - 2, cy - 12 * s, 3 * s, 3 * s, hsl(hue, 55, 48)); }
    function label(txt, cx, cy, sz) { g.font = `${sz}px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, cx, cy); }

    // ---- ground layer ----
    function drawGround() {
      g = ground.getContext('2d'); g.setTransform(GS, 0, 0, GS, 0, 0); g.clearRect(0, 0, WORLD_W, WORLD_H);
      const S = get(); const c = S.city; const night = isNight(); const A = lastA || analyze(c, S.vitality);
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const cc = corners(x, y, 1, 1); const own = owned(c, x, y); const p = tileAt(c, x, y); const r = rng(hash(x, y, 7));
        if (x === RIVER_X) { poly([cc.b, cc.r, cc.f, cc.l], night ? hsl(212, 45, 26) : hsl(202, 62, 58)); continue; }
        const n = r(); const base = own ? hsl(110, 28 + n * 12, (night ? 24 : 58) + n * 6) : hsl(100, 18, (night ? 18 : 46) + n * 4);
        poly([cc.b, cc.r, cc.f, cc.l], base, night ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.08)');
        if (!own) { if (r() < 0.35) tree(cc.c[0] + (r() - 0.5) * 20, cc.c[1] + (r() - 0.5) * 8 + 4, 0.7 + r() * 0.5, 100 + r() * 40); continue; }
        if (p && ZONES[p.k]) { const z = ZONES[p.k]; const i = A.info[kkey(x, y)]; poly([cc.b, cc.r, cc.f, cc.l], p.lv === 0 ? hsl(z.hue, 20, night ? 30 : 66) : hsl(z.hue, 12, night ? 28 : 60)); if (p.lv === 0) { g.setLineDash([3, 3]); poly([cc.b, cc.r, cc.f, cc.l], null, hsl(z.hue, 60, i && i.active ? 45 : 30), 1.5); g.setLineDash([]); if (i && !i.active) label('🚧', cc.c[0], cc.c[1], 9); } }
        if (p && p.k === 'park') { poly([cc.b, cc.r, cc.f, cc.l], hsl(125, 40, night ? 26 : 46)); }
        if (p && p.k === 'plaza') { poly([cc.b, cc.r, cc.f, cc.l], hsl(35, 18, night ? 40 : 76)); }
      }
      // roads: 4-bit mask
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const p = tileAt(c, x, y); if (!p || p.k !== 'road') continue;
        const isR = (a, b) => { const q = tileAt(c, a, b); return !!(q && (q.k === 'road' || q.k === 'hall')); };
        const N = isR(x, y - 1), E = isR(x + 1, y), Sx = isR(x, y + 1), Wx = isR(x - 1, y);
        const cc = corners(x, y, 1, 1);
        poly([cc.b, cc.r, cc.f, cc.l], night ? '#39424e' : '#8d949c');
        // sidewalks on edges without road
        g.fillStyle = night ? '#525b66' : '#c9ced4';
        const edge = (P, Q) => { const dx = Q[0] - P[0], dy = Q[1] - P[1]; poly([P, Q, [Q[0] - dx * 0.08 + (P[0] + Q[0] > 2 * cc.c[0] ? -3 : 3) * 0, Q[1] - dy * 0.08], [P[0], P[1]]], null); };
        if (!N) poly([cc.b, cc.r, [cc.r[0] - 5, cc.r[1] + 2.5], [cc.b[0] - 5, cc.b[1] + 2.5]], g.fillStyle); if (!E) poly([cc.r, cc.f, [cc.f[0] - 5, cc.f[1] - 2.5], [cc.r[0] - 5, cc.r[1] - 2.5]], g.fillStyle);
        if (!Sx) poly([cc.f, cc.l, [cc.l[0] + 5, cc.l[1] - 2.5], [cc.f[0] + 5, cc.f[1] - 2.5]], g.fillStyle); if (!Wx) poly([cc.l, cc.b, [cc.b[0] + 5, cc.b[1] + 2.5], [cc.l[0] + 5, cc.l[1] + 2.5]], g.fillStyle);
        // center dashes along axes
        g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1; g.setLineDash([4, 4]);
        const mid = (P, Q) => [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2];
        const ne = mid(cc.b, cc.r), se = mid(cc.r, cc.f), sw = mid(cc.f, cc.l), nw = mid(cc.l, cc.b);
        if (N) { g.beginPath(); g.moveTo(cc.c[0], cc.c[1]); g.lineTo(nw[0], nw[1]); g.stroke(); } if (Sx) { g.beginPath(); g.moveTo(cc.c[0], cc.c[1]); g.lineTo(se[0], se[1]); g.stroke(); }
        if (E) { g.beginPath(); g.moveTo(cc.c[0], cc.c[1]); g.lineTo(ne[0], ne[1]); g.stroke(); } if (Wx) { g.beginPath(); g.moveTo(cc.c[0], cc.c[1]); g.lineTo(sw[0], sw[1]); g.stroke(); }
        g.setLineDash([]);
        if ((N || Sx) && (E || Wx)) { g.fillStyle = 'rgba(255,255,255,.75)'; for (let i = -1; i <= 1; i++) g.fillRect(cc.c[0] - 1 + i * 4, cc.c[1] - 1, 2, 2); }
      }
      // owned border
      const r = c.ring.v; const x0 = Math.max(RIVER_X + 1, CORE[0] - r), x1 = Math.min(W, CORE[1] + r), y0 = Math.max(0, CORE[0] - r), y1 = Math.min(W, CORE[1] + r);
      const a = toScreen(x0, y0), b = toScreen(x1, y0), cpt = toScreen(x1, y1), d = toScreen(x0, y1); g.setLineDash([6, 4]); poly([a, b, cpt, d], null, night ? 'rgba(255,255,255,.35)' : 'rgba(20,32,43,.45)', 1.5); g.setLineDash([]);
      dirtyG = false;
    }
    // ---- buildings layer ----
    function drawBuildings() {
      g = blds.getContext('2d'); g.setTransform(GS, 0, 0, GS, 0, 0); g.clearRect(0, 0, WORLD_W, WORLD_H);
      const S = get(); const c = S.city; const night = isNight(); const A = lastA || analyze(c, S.vitality);
      const items = []; for (const k in c.tiles) { const p = c.tiles[k]; if (p.gone || p.k === 'road' || p.k === 'park' || p.k === 'plaza') continue; const [x, y] = k.split(',').map(Number); items.push({ x, y, p }); }
      for (const k in c.tiles) { const p = c.tiles[k]; if (p.gone || (p.k !== 'park' && p.k !== 'plaza')) continue; const [x, y] = k.split(',').map(Number); items.push({ x, y, p, flat: true }); }
      items.sort((a, b) => (a.x + a.y) - (b.x + b.y) || a.x - b.x);
      for (const it of items) drawStructure(it.x, it.y, it.p, night, A.info[kkey(it.x, it.y)]);
      nightFlag = night; dirtyB = false;
    }
    function drawStructure(x, y, p, night, i) {
      const r = rng(hash(x, y, [...p.k].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) + p.lv * 101)); const [sx, sy0] = toScreen(x, y); const cx = sx, cy = sy0 + THH; const lv = p.lv;
      const active = !i || i.active;
      if (ZONES[p.k]) {
        if (lv === 0) { if (p.g && active) { g.fillStyle = 'rgba(0,0,30,.22)'; g.fillRect(cx - 14, cy - 3, 14, 5); g.strokeStyle = hsl(35, 90, 55); g.lineWidth = 2; g.beginPath(); g.moveTo(cx + 8, cy + 2); g.lineTo(cx + 8, cy - 26); g.lineTo(cx - 12, cy - 26); g.stroke(); g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 8, cy - 26); g.lineTo(cx - 8, cy - 12); g.stroke(); g.fillStyle = hsl(35, 90, 55); g.fillRect(cx - 10, cy - 12, 4, 3); g.fillStyle = hsl(35, 30, 45); g.fillRect(cx + 6, cy - 1, 5, 3); } return; }
        if (p.k === 'r') {
          if (lv === 1) { const w = 0.55 + r() * 0.15; const hue = 25 + r() * 20; const h = 12 + r() * 4; poly([corners(x, y, 1, 1).b, corners(x, y, 1, 1).r, corners(x, y, 1, 1).f, corners(x, y, 1, 1).l], hsl(120, 35, night ? 24 : 52)); const c = box(x, y, w, w, h, hue, 45 + r() * 10, 58 + r() * 8, { win: { rng: r, fp: 10, cols: 2 }, night }); roof(c, h, 8 + r() * 3, r() < 0.5 ? 8 : 200, 35, 42); g.fillStyle = hsl(28, 40, 28); g.fillRect(c.f[0] - 7, c.f[1] - 8, 4, 8); if (r() < 0.6) tree(cx - 18, cy + 4, 0.7, 120 + r() * 20); }
          else if (lv === 2) { const h = 26 + r() * 14; const c = box(x, y, 0.85, 0.85, h, 30 + r() * 15, 40, 60, { win: { rng: r, fp: 9, cols: 3 }, night }); g.fillStyle = 'rgba(0,0,0,.18)'; for (let f = 1; f < Math.floor(h / 9); f++) { const t = 0.5; g.fillRect(c.l[0] + (c.f[0] - c.l[0]) * 0.15, c.l[1] + (c.f[1] - c.l[1]) * 0.15 - f * 9 - 3, 8, 1.5); } g.fillStyle = hsl(30, 30, 40); g.fillRect(cx + 4, cy - h - 12, 5, 8); }
          else { const h = 60 + r() * 30; const c = box(x, y, 0.8, 0.8, h, 35 + r() * 10, 30, 62, { win: { rng: r, fp: 8, cols: 3 }, night }); cyl(cx + 8, cy - h - 2, 4, 8, 30, 30, 45); g.fillStyle = hsl(30, 20, 35); g.fillRect(cx + 6, cy - h + 6, 1.5, 6); g.fillRect(cx + 10, cy - h + 6, 1.5, 6); }
        } else if (p.k === 'c') {
          if (lv === 1) { const h = 12 + r() * 4; const hue = 200 + r() * 40; const c = box(x, y, 0.8, 0.7, h, hue, 18, 62, { win: { rng: r, fp: 9, cols: 3, ribbon: true }, night, glass: true }); const aw = r() < 0.5 ? 0 : 340; for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? hsl(aw, 70, 55) : '#f4f4f4'; const t0 = 0.1 + k * 0.16, t1 = t0 + 0.16; poly([[c.l[0] + (c.f[0] - c.l[0]) * t0, c.l[1] + (c.f[1] - c.l[1]) * t0 - h + 3], [c.l[0] + (c.f[0] - c.l[0]) * t1, c.l[1] + (c.f[1] - c.l[1]) * t1 - h + 3], [c.l[0] + (c.f[0] - c.l[0]) * t1, c.l[1] + (c.f[1] - c.l[1]) * t1 - h + 7], [c.l[0] + (c.f[0] - c.l[0]) * t0, c.l[1] + (c.f[1] - c.l[1]) * t0 - h + 7]], g.fillStyle); } g.fillStyle = night ? hsl(aw || 190, 90, 65) : hsl(aw || 190, 60, 45); g.fillRect(c.f[0] + 2, c.f[1] - h + 2, 10, 3); }
          else if (lv === 2) { const h = 30 + r() * 16; box(x, y, 0.85, 0.8, h, 210 + r() * 20, 22, 55, { win: { rng: r, fp: 9, cols: 4, ribbon: r() < 0.5 }, night, glass: true, roof: hsl(210, 10, 45) }); g.fillStyle = night ? 'rgba(120,220,255,.9)' : 'rgba(40,90,140,.9)'; g.fillRect(cx - 10, cy - 14, 12, 3); }
          else { const h = 76 + r() * 40; const c = box(x, y, 0.75, 0.75, h, 205 + r() * 25, 35, 52, { win: { rng: r, fp: 7, cols: 4, ribbon: true }, night, glass: true, roof: hsl(210, 20, 40) }); box(x, y, 0.4, 0.4, h + 12, 205, 30, 50, { roof: hsl(210, 20, 42) }); g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, cy - h - 12); g.lineTo(cx, cy - h - 28); g.stroke(); ell(cx, cy - h - 29, 2, 2, Math.floor(tsec * 2) % 2 ? '#ff5252' : '#7a2020'); }
        } else { // industrial
          if (lv === 1) { const h = 14 + r() * 4; const c = box(x, y, 0.85, 0.7, h, 20, 12, 46, { roof: hsl(20, 10, 40) }); cyl(c.b[0] + 8, c.b[1] + 6, 3, 18, 0, 5, 40); g.fillStyle = hsl(25, 30, 35); g.fillRect(c.f[0] - 10, c.f[1] - 10, 8, 10); }
          else if (lv === 2) { const h = 20 + r() * 6; const c = box(x, y, 0.95, 0.9, h, 25, 15, 44, { roof: hsl(25, 12, 38) }); for (let k = 0; k < 3; k++) { poly([up(c.b, h), up(c.r, h), up([c.r[0], c.r[1]], h + 5), up([c.b[0], c.b[1]], h + 5)], hsl(25, 12, 50)); } cyl(c.b[0] + 6, c.b[1] + 8, 3, 24, 0, 5, 42); cyl(c.b[0] + 16, c.b[1] + 13, 3, 20, 0, 5, 42); g.strokeStyle = hsl(30, 20, 55); g.lineWidth = 2; g.beginPath(); g.moveTo(c.l[0] + 4, c.l[1] - 6); g.lineTo(c.f[0] - 6, c.f[1] - 10); g.stroke(); }
          else { const h = 26 + r() * 8; const c = box(x, y, 1.0, 0.95, h, 20, 15, 40, { roof: hsl(20, 12, 34) }); cyl(c.l[0] + 10, c.l[1] - 2, 7, 14, 200, 10, 55); cyl(c.f[0] - 12, c.f[1] - 8, 6, 12, 200, 10, 55); cyl(c.b[0] + 4, c.b[1] + 10, 4, 34, 0, 5, 38); cyl(c.b[0] + 14, c.b[1] + 14, 4, 30, 0, 5, 38); ell(c.b[0] + 4, c.b[1] + 10 - 35, 1.8, 1.8, Math.floor(tsec * 2) % 2 ? '#ff5252' : '#7a2020'); }
        }
        return;
      }
      switch (p.k) {
        case 'hall': { const c = box(x, y, 0.95, 0.95, 20, 40, 20, 78, { roof: hsl(40, 20, 84) }); for (let k = 0; k < 4; k++) { const t = 0.15 + k * 0.23; g.fillStyle = '#fff'; g.fillRect(c.l[0] + (c.f[0] - c.l[0]) * t - 1, c.l[1] + (c.f[1] - c.l[1]) * t - 18, 2.5, 16); } ell(cx, cy - 22, 12, 6, hsl(45, 25, 70)); g.beginPath(); g.arc(cx, cy - 22, 11, Math.PI, 0); g.fillStyle = hsl(160, 30, 55); g.fill(); g.strokeStyle = '#ddd'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, cy - 33); g.lineTo(cx, cy - 44); g.stroke(); g.fillStyle = '#E9B53B'; g.beginPath(); g.moveTo(cx, cy - 44); g.lineTo(cx + 8, cy - 41); g.lineTo(cx, cy - 38); g.fill(); break; }
        case 'power': { const c = box(x, y, 0.95, 0.8, 16, 0, 0, 44, { roof: hsl(0, 0, 38) }); cyl(c.l[0] + 12, c.l[1] - 2, 9, 30, 0, 0, 62); cyl(c.f[0] - 10, c.f[1] - 6, 7, 24, 0, 0, 62); cyl(c.b[0] + 6, c.b[1] + 6, 3, 34, 0, 5, 40); if (!active) label('⚠️', cx, cy - 40, 12); break; }
        case 'water': { g.strokeStyle = hsl(0, 0, 40); g.lineWidth = 2; for (const dx of [-9, -3, 3, 9]) { g.beginPath(); g.moveTo(cx + dx, cy); g.lineTo(cx + dx * 0.6, cy - 24); g.stroke(); } cyl(cx, cy - 24, 11, 14, 200, 30, 60); g.fillStyle = hsl(200, 40, 40); g.fillRect(cx - 6, cy - 34, 12, 3); break; }
        case 'clinic': { const c = box(x, y, 0.9, 0.85, 22, 0, 0, 86, { win: { rng: r, fp: 9, cols: 3 }, night }); g.fillStyle = '#d9342b'; g.fillRect(cx - 1.5, cy - 32, 3, 9); g.fillRect(cx - 4.5, cy - 29, 9, 3); ell(cx + 12, cy + 3, 6, 3, '#eee'); break; }
        case 'school': { const c = box(x, y, 1.0, 0.8, 18, 38, 40, 62, { win: { rng: r, fp: 9, cols: 4 }, night, roof: hsl(15, 45, 45) }); g.strokeStyle = '#ccc'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(c.b[0] + 6, c.b[1] + 4); g.lineTo(c.b[0] + 6, c.b[1] - 14); g.stroke(); g.fillStyle = '#3E7CB1'; g.beginPath(); g.moveTo(c.b[0] + 6, c.b[1] - 14); g.lineTo(c.b[0] + 16, c.b[1] - 11); g.lineTo(c.b[0] + 6, c.b[1] - 8); g.fill(); ell(cx + 10, cy + 4, 8, 4, hsl(20, 40, 50)); break; }
        case 'park': { const c = corners(x, y, 1, 1); g.strokeStyle = hsl(35, 20, 70); g.lineWidth = 3; g.beginPath(); g.moveTo(c.l[0] + 6, c.l[1]); g.lineTo(c.r[0] - 6, c.r[1]); g.stroke(); for (let k = 0; k < 4; k++) tree(cx + (r() - 0.5) * 34, cy + (r() - 0.5) * 12 + 4, 0.65 + r() * 0.4, 110 + r() * 30); g.fillStyle = hsl(28, 40, 35); g.fillRect(cx + 8, cy + 2, 7, 2); break; }
        case 'fire': { const c = box(x, y, 0.9, 0.85, 20, 2, 70, 48, { win: { rng: r, fp: 9, cols: 2 }, night, roof: hsl(2, 40, 40) }); g.fillStyle = '#eee'; g.fillRect(c.f[0] - 12, c.f[1] - 12, 10, 12); g.fillStyle = '#c33'; g.fillRect(c.f[0] - 11, c.f[1] - 11, 8, 10); break; }
        case 'police': { const c = box(x, y, 0.9, 0.85, 20, 215, 45, 42, { win: { rng: r, fp: 9, cols: 3 }, night, roof: hsl(215, 30, 35) }); label('🛡️', cx, cy - 26, 9); if (night) ell(c.f[0] - 4, c.f[1] - 22, 2.5, 2.5, Math.floor(tsec * 3) % 2 ? '#4da3ff' : '#ff5252'); break; }
        case 'stadium': { const h = 26; poly([corners(x, y, 1.1, 1.1).b, corners(x, y, 1.1, 1.1).r, corners(x, y, 1.1, 1.1).f, corners(x, y, 1.1, 1.1).l], 'rgba(0,0,30,.16)'); ell(cx, cy - 1, 28, 14, hsl(20, 15, 48)); poly([[cx - 28, cy - 1], [cx - 28, cy - 1 - h], [cx + 28, cy - 1 - h], [cx + 28, cy - 1]], hsl(20, 15, 40)); ell(cx, cy - 1 - h, 28, 14, hsl(20, 18, 58), 'rgba(0,0,0,.25)'); ell(cx, cy - 1 - h, 18, 8, hsl(130, 45, 40)); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.7; g.fillStyle = night ? '#fff3b0' : '#ddd'; g.fillRect(cx + Math.cos(a) * 29 - 1, cy - 1 - h - 16 + Math.sin(a) * 4, 2, 16); } break; }
        case 'tree': { for (let k = 0; k < 3; k++) tree(cx + (r() - 0.5) * 26, cy + (r() - 0.5) * 10 + 4, 0.6 + r() * 0.5, 105 + r() * 40); break; }
        case 'light': { g.strokeStyle = '#555'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - 22); g.lineTo(cx + 6, cy - 22); g.stroke(); ell(cx + 6, cy - 22, 2.5, 2.5, night ? '#ffe28a' : '#ccc'); if (night) { const gr = g.createRadialGradient(cx + 6, cy - 8, 2, cx + 6, cy - 8, 20); gr.addColorStop(0, 'rgba(255,226,138,.35)'); gr.addColorStop(1, 'rgba(255,226,138,0)'); g.fillStyle = gr; g.fillRect(cx - 16, cy - 30, 44, 40); } break; }
        case 'plaza': { ell(cx, cy, 12, 6, hsl(200, 30, 72), 'rgba(0,0,0,.2)'); ell(cx, cy - 1, 8, 4, hsl(200, 70, 60)); g.fillStyle = hsl(30, 20, 60); g.fillRect(cx - 22, cy - 2, 6, 2); g.fillRect(cx + 16, cy - 2, 6, 2); break; }
        case 'monument': { ell(cx, cy + 2, 14, 7, hsl(35, 15, night ? 40 : 60), 'rgba(0,0,0,.2)'); box(x, y, 0.4, 0.4, 6, 35, 10, 66); g.fillStyle = hsl(35, 12, night ? 50 : 72); g.beginPath(); g.moveTo(cx - 4, cy - 6); g.lineTo(cx + 4, cy - 6); g.lineTo(cx + 1.5, cy - 46); g.lineTo(cx - 1.5, cy - 46); g.closePath(); g.fill(); g.fillStyle = hsl(45, 80, 60); g.beginPath(); g.moveTo(cx - 1.5, cy - 46); g.lineTo(cx + 1.5, cy - 46); g.lineTo(cx, cy - 52); g.closePath(); g.fill(); break; }
        case 'tower': { ell(cx, cy + 2, 12, 6, 'rgba(0,0,30,.18)'); g.strokeStyle = hsl(20, 60, 45); g.lineWidth = 2.5; for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(cx + sg * 12, cy); g.quadraticCurveTo(cx + sg * 3, cy - 30, cx + sg * 2, cy - 70); g.stroke(); } g.lineWidth = 1.5; for (const yy of [-14, -30, -46]) { g.beginPath(); g.moveTo(cx - 10 + Math.abs(yy) * 0.11, cy + yy); g.lineTo(cx + 10 - Math.abs(yy) * 0.11, cy + yy); g.stroke(); } ell(cx, cy - 72, 3, 3, night ? '#ffd166' : '#eee'); if (night) ell(cx, cy - 72, 6, 6, 'rgba(255,209,102,.25)'); break; }
        case 'arch': { g.strokeStyle = hsl(40, 15, night ? 45 : 78); g.lineWidth = 7; g.beginPath(); g.moveTo(cx - 16, cy + 2); g.lineTo(cx - 16, cy - 20); g.quadraticCurveTo(cx, cy - 48, cx + 16, cy - 20); g.lineTo(cx + 16, cy + 2); g.stroke(); g.strokeStyle = hsl(40, 15, 55); g.lineWidth = 1; g.stroke(); break; }
        case 'palace': { box(x, y, 1.0, 0.9, 26, 45, 30, 80, { win: { rng: r, fp: 8, cols: 4 }, night, roof: hsl(210, 45, 45) }); cyl(cx, cy - 26, 8, 10, 210, 45, 50); ell(cx, cy - 36, 8, 4, hsl(210, 45, 55)); g.fillStyle = hsl(45, 85, 58); g.beginPath(); g.moveTo(cx - 5, cy - 38); g.lineTo(cx - 5, cy - 46); g.lineTo(cx - 2.5, cy - 41); g.lineTo(cx, cy - 47); g.lineTo(cx + 2.5, cy - 41); g.lineTo(cx + 5, cy - 46); g.lineTo(cx + 5, cy - 38); g.closePath(); g.fill(); break; }
        case 'statue': { box(x, y, 0.35, 0.35, 8, 0, 0, 70); g.fillStyle = hsl(150, 25, 55); g.fillRect(cx - 2, cy - 22, 4, 12); ell(cx, cy - 24, 2.5, 2.5, hsl(150, 25, 55)); g.fillRect(cx + 2, cy - 30, 1.5, 9); break; }
      }
    }
    // ---- fx layer (every frame, screen space) ----
    function drawFrame() {
      const S = get(); const c = S.city; const night = isNight(); if (nightFlag !== null && nightFlag !== night) { dirtyB = true; dirtyG = true; }
      if (dirtyG) drawGround(); if (dirtyB) drawBuildings();
      const A = lastA || (lastA = analyze(c, S.vitality));
      g = ctx; g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sky = g.createLinearGradient(0, 0, 0, cssH); const h = new Date().getHours();
      if (night) { sky.addColorStop(0, '#0b1030'); sky.addColorStop(1, '#1b2350'); } else if (h < 8 || h >= 18) { sky.addColorStop(0, '#f2a86a'); sky.addColorStop(1, '#8fb0d8'); } else { sky.addColorStop(0, '#8ec5ff'); sky.addColorStop(1, '#e3f2ff'); }
      g.fillStyle = sky; g.fillRect(0, 0, cssW, cssH);
      g.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * cam.z * cam.x, dpr * cam.z * cam.y);
      g.drawImage(ground, 0, 0, WORLD_W, WORLD_H); g.drawImage(blds, 0, 0, WORLD_W, WORLD_H);
      // water shimmer
      for (let y = 0; y < W; y++) { const [sx, sy] = toScreen(RIVER_X, y); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1; g.beginPath(); for (let k = 0; k <= 4; k++) g.lineTo(sx - 14 + k * 7 + Math.sin(tsec * 2 + y + k) * 2, sy + THH + Math.sin(tsec * 1.5 + y * 0.7 + k) * 1.5); g.stroke(); }
      // pollution haze
      for (const k in A.info) { const i = A.info[k]; if (i.poll < 12) continue; const [sx, sy] = toScreen(i.x, i.y); const gr = g.createRadialGradient(sx, sy + THH - 6, 4, sx, sy + THH - 6, 34); const a = Math.min(0.45, i.poll / 60); gr.addColorStop(0, `rgba(110,90,60,${a})`); gr.addColorStop(1, 'rgba(110,90,60,0)'); g.fillStyle = gr; g.fillRect(sx - 36, sy - 30, 72, 60); }
      // data views
      if (view !== 'none') for (const k in A.info) { const i = A.info[k]; if (!owned(c, i.x, i.y)) continue; const cc = corners(i.x, i.y, 1, 1); let col = null; if (view === 'lv') { const t = i.lvs / 100; col = `hsla(${Math.round(220 - 220 * t)},80%,50%,.45)`; } else if (view === 'poll') { if (i.poll > 0) col = `rgba(120,60,20,${Math.min(0.6, i.poll / 40)})`; } else if (SERVICES[view]) { col = i.cov[view] ? (i.eff[view] >= 0.99 ? 'rgba(46,143,91,.45)' : 'rgba(233,181,59,.45)') : null; } if (col) poly([cc.b, cc.r, cc.f, cc.l], col); }
      // coverage preview for the service tool
      if (tool === 'service' && sub && SERVICES[sub] && SERVICES[sub].r && hover) { const R = SERVICES[sub].r; for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) { const x = hover[0] + dx, y = hover[1] + dy; if (x < 0 || y < 0 || x >= W || y >= W) continue; const cc = corners(x, y, 1, 1); poly([cc.b, cc.r, cc.f, cc.l], 'rgba(62,124,177,.22)'); } }
      // selection / hover
      const hl = sel || hover; if (hl) { const cc = corners(hl[0], hl[1], 1, 1); const pulse = 0.6 + Math.sin(tsec * 4) * 0.3; poly([cc.b, cc.r, cc.f, cc.l], `rgba(242,178,51,${0.18 * pulse})`, `rgba(242,178,51,${0.5 + pulse * 0.4})`, 2); }
      // cars, smoke, fx
      for (const car of cars) { const [sx, sy] = toScreen(car.x, car.y); g.fillStyle = car.c; poly([[sx - 4, sy + THH - 2], [sx + 4, sy + THH - 2], [sx + 4, sy + THH + 2], [sx - 4, sy + THH + 2]], car.c); if (night) { g.fillStyle = '#fff3b0'; g.fillRect(sx + (car.dx > 0 || car.dy < 0 ? 3 : -4), sy + THH - 1, 1.5, 2); } }
      for (const s of smoke) { g.globalAlpha = 0.35 * (1 - s.age); ell(s.x, s.y, 2 + s.age * 5, 1.5 + s.age * 3.5, night ? '#8a8a9a' : '#c9c9c9'); g.globalAlpha = 1; }
      for (const f of fx) { g.globalAlpha = Math.max(0, 1 - f.age / f.life); if (f.kind === 'coin') ell(f.x, f.y, 3, 3, '#E9B53B', '#9a6d10', 1); else { g.font = 'bold 12px "Chakra Petch", sans-serif'; g.fillStyle = f.color || '#E9B53B'; g.textAlign = 'center'; g.fillText(f.text, f.x, f.y); } g.globalAlpha = 1; }
      // night streetlights on roads
      if (night) { for (const k in c.tiles) { const p = c.tiles[k]; if (p.gone || p.k !== 'road') continue; const [x, y] = k.split(',').map(Number); if ((x + y) % 2) continue; const [sx, sy] = toScreen(x, y); const gr = g.createRadialGradient(sx, sy + THH, 2, sx, sy + THH, 18); gr.addColorStop(0, 'rgba(255,226,138,.22)'); gr.addColorStop(1, 'rgba(255,226,138,0)'); g.fillStyle = gr; g.fillRect(sx - 18, sy, 36, 36); } }
    }
    let hover = null;
    function step(dt) {
      tsec += dt; const S = get(); const c = S.city; const A = lastA || analyze(c, S.vitality);
      // cars on the connected road graph
      const roads = [...A.conn].map(k => k.split(',').map(Number)); const want = Math.min(14, Math.floor(roads.length / 3) + (A.pop > 50 ? 2 : 0));
      const colors = ['#3E7CB1', '#C9491F', '#2E8F5B', '#B33E7E', '#E9B53B', '#d8d8d8', '#333'];
      while (cars.length < want && roads.length) { const r0 = roads[Math.floor(Math.random() * roads.length)]; cars.push({ x: r0[0] + 0.5, y: r0[1] + 0.5, tx: r0[0], ty: r0[1], dx: 0, dy: 0, c: colors[cars.length % colors.length], sp: 0.9 + Math.random() * 0.6 }); }
      cars.length = Math.min(cars.length, want);
      for (const car of cars) {
        const gx = car.tx + 0.5, gy = car.ty + 0.5; const d = Math.hypot(gx - car.x, gy - car.y);
        if (d < 0.05) { const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => A.conn.has(kkey(car.tx + dx, car.ty + dy)) && !(dx === -car.dx && dy === -car.dy)); const pick = opts.length ? opts[Math.floor(Math.random() * opts.length)] : [-car.dx, -car.dy]; if (!A.conn.has(kkey(car.tx + pick[0], car.ty + pick[1]))) { car.tx = roads.length ? roads[0][0] : car.tx; car.ty = roads.length ? roads[0][1] : car.ty; continue; } car.dx = pick[0]; car.dy = pick[1]; car.tx += pick[0]; car.ty += pick[1]; }
        else { car.x += (gx - car.x) / d * dt * car.sp; car.y += (gy - car.y) / d * dt * car.sp; }
      }
      // smoke from industry & power
      if (Math.random() < dt * 3) for (const k in A.info) { const i = A.info[k]; if ((i.p.k === 'i' && i.p.lv >= 2) || i.p.k === 'power') if (Math.random() < 0.3) { const [sx, sy] = toScreen(i.x, i.y); smoke.push({ x: sx + (i.p.k === 'power' ? -26 : -14), y: sy + THH - (i.p.k === 'power' ? 40 : 30), age: 0 }); } }
      for (const s of smoke) { s.age += dt * 0.5; s.x += dt * 6; s.y -= dt * 10; } smoke = smoke.filter(s => s.age < 1);
      for (const f of fx) { f.age += dt; f.x += (f.vx || 0) * dt; f.y += (f.vy || 0) * dt; if (f.vy !== undefined) f.vy += 60 * dt; } fx = fx.filter(f => f.age < f.life);
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function loop(ts) { if (!visible) { raf = 0; return; } if (reduced) { if (ts - lastFrame >= 1000) { lastFrame = ts; drawFrame(); } raf = requestAnimationFrame(loop); return; } if (ts - lastFrame >= 33) { const dt = Math.min(0.1, (ts - lastFrame) / 1000 || 0.03); lastFrame = ts; step(dt); drawFrame(); } raf = requestAnimationFrame(loop); }
    function burst(n, text) { const [sx, sy] = toScreen(8, 8); const px = (sx + cam.x) * cam.z, py = (sy + cam.y) * cam.z; for (let i = 0; i < n; i++) fx.push({ kind: 'coin', x: sx + (Math.random() - 0.5) * 40, y: sy, vx: (Math.random() - 0.5) * 80, vy: -90 - Math.random() * 60, age: 0, life: 1.1 }); if (text) fx.push({ kind: 'text', text, x: sx, y: sy - 20, vx: 0, vy: -25, age: 0, life: 1.4 }); }

    // ---- sim tick + away report ----
    function tick() {
      const S = get(); const c = S.city; const t = now();
      if (!Object.values(c.tiles).some(p => p.k === 'hall' && !p.gone)) { c.tiles[kkey(8, 8)] = { k: 'hall', lv: 0, t, g: 0, d: 0, gone: false }; commit(); dirtyG = dirtyB = true; }
      const before = c.lastSim.t; const ev = simulate(c, S.vitality, t); lastA = analyze(c, S.vitality); if (!c.lastTax.t && lastA.pop > 0) { c.lastTax.t = t; commit(); }
      if (ev.grew || ev.fell) { dirtyB = true; dirtyG = true; }
      if (!awayShown && before && t - before > 2 * HOUR) { awayShown = true; const hrs = Math.round((t - before) / HOUR); toast(`Away ${hrs} h: ${ev.grew} grew${ev.fell ? `, ${ev.fell} declined` : ''}, ${fmt(taxPending(c, lastA, t))} Bucks in taxes`, true); }
      if (ev.grew || ev.fell || ev.touched || !before) commit(true);
    }
    function show(v) { visible = v; if (v) { size(); tick(); renderHud(); renderPanel(); if (!raf) raf = requestAnimationFrame(loop); } }

    // ---- HUD ----
    function renderHud() {
      const S = get(); const c = S.city; const A = lastA || (lastA = analyze(c, S.vitality)); const t = now(); const pend = taxPending(c, A, t); const net = A.income - A.upkeep;
      const bar = (v, col) => `<div class="rci"><i style="width:${Math.round(50 + v * 50)}%;background:${col}"></i></div>`;
      hud.innerHTML = `
        <div class="ctile"><div class="k">Grit</div><div class="v">${fmt(S.grit)}</div><div class="s">from real life</div></div>
        <div class="ctile"><div class="k">Bucks</div><div class="v">${fmt(bucks(c))}</div><div class="s">${net >= 0 ? '+' : ''}${fmt(net)}/day · tax ${c.tax.v}%</div></div>
        <div class="ctile"><div class="k">${A.mile[1]}</div><div class="v">${fmt(A.pop)}</div><div class="s">pop · ${A.jobs} jobs${A.next ? ` · ${A.next[1]} at ${fmt(A.next[0])}` : ''}</div></div>
        <div class="ctile wide"><div class="k">Happiness ${A.happiness} · Demand</div><div class="rcis"><span>R</span>${bar(A.dem.r, '#C9491F')}<span>C</span>${bar(A.dem.c, '#3E7CB1')}<span>I</span>${bar(A.dem.i, '#8a7a4a')}</div></div>
        <button class="collect${pend >= 1 ? ' ready' : ''}" id="city-collect" ${pend >= 1 ? '' : 'disabled'}>${c.lastTax.t ? `Collect ${fmt(pend)} Bucks in taxes` : 'Open the treasury'}<span class="s">12 h cap</span></button>`;
      hud.querySelector('#city-collect').addEventListener('click', () => { const S2 = get(); const c2 = S2.city; const t2 = now(); const p = Math.floor(taxPending(c2, lastA || analyze(c2, S2.vitality), t2)); (c2.ledger[deviceId] ||= { earned: 0, spent: 0 }).earned += p; c2.lastTax.t = t2; commit(); if (p > 0) { toast(`+${fmt(p)} Bucks`); burst(Math.min(14, 3 + Math.floor(p / 50)), `+${fmt(p)}`); } renderHud(); });
    }
    // ---- Panel: tools + info ----
    const TOOLS = [['select', '👆', 'Inspect'], ['road', '🛣️', 'Road'], ['r', '🏘️', 'Homes'], ['c', '🏬', 'Shops'], ['i', '🏭', 'Industry'], ['service', '🏫', 'Services'], ['decor', '🌳', 'Decor'], ['land', '🗺️', 'Land & tax'], ['bulldoze', '🧨', 'Bulldoze'], ['view', '📊', 'Views']];
    function renderPanel() {
      const S = get(); const c = S.city; const A = lastA || (lastA = analyze(c, S.vitality)); const peak = A.peak;
      let html = `<div class="advisor">🧑‍💼 ${advisor(c, A)}</div><div class="tools">${TOOLS.map(([id, e, n]) => `<button class="tool${tool === id ? ' on' : ''}" data-tool="${id}"><span>${e}</span>${n}</button>`).join('')}</div>`;
      if (tool === 'service') html += `<div class="cgrid">${Object.entries(SERVICES).map(([id, s]) => { const locked = peak < s.mile; return `<button class="cbtn${sub === id ? ' on' : ''}" data-sub="${id}" ${locked ? 'disabled' : ''}><span class="e">${locked ? '🔒' : s.e}</span><b>${s.name}</b><span class="s">${locked ? `${MILES.find(m => m[0] === s.mile)[1]} (${s.mile} pop)` : `${s.grit} Grit · reach ${s.r}${s.cap ? ` · ${s.cap} ${s.capKind}` : ''} · ${s.up}/day`}</span></button>`; }).join('')}</div>`;
      if (tool === 'decor') html += `<div class="cgrid">${Object.entries(DECOR).map(([id, d]) => { const rankLock = d.rank && (S.level || 1) < d.rank; const locked = peak < d.mile || rankLock; return `<button class="cbtn decor${sub === id ? ' on' : ''}" data-sub="${id}" ${locked ? 'disabled' : ''}><span class="e">${locked ? '🔒' : d.e}</span><b>${d.name}</b><span class="s">${rankLock ? `Level ${d.rank}` : locked ? `${MILES.find(m => m[0] === d.mile)[1]}` : `${d.bucks} Bucks · +${d.lv} land value${d.rank ? ` · reach ${d.r}` : ''}`}</span></button>`; }).join('')}<button class="cbtn decor" data-fest="1" ${bucks(c) < FEST_BUCKS || c.fest.until > now() ? 'disabled' : ''}><span class="e">🎉</span><b>Festival</b><span class="s">${c.fest.until > now() ? `on · ${Math.ceil((c.fest.until - now()) / HOUR)} h` : `${FEST_BUCKS} Bucks · +5 happiness 24 h`}</span></button></div>`;
      if (tool === 'land') { const r = c.ring.v; const L = landSize(r), N = landSize(r + 1); const gate = LAND_GATE[r] || Infinity; const cost = expandCost(c); const gated = peak < gate; const can = r < 3 && !gated && S.grit >= cost;
        html += `<div class="csel"><span class="e">🗺️</span><div><b>Your land: ${L.w}×${L.h} tiles</b><div class="s">${r >= 3 ? 'City limits at their maximum.' : `Next ring: ${N.w}×${N.h} tiles for ${fmt(cost)} Grit.${gated ? ` Unlocks at ${MILES.find(m => m[0] === gate)[1]} — ${fmt(gate)} people (you peaked at ${fmt(peak)}).` : S.grit < cost ? ` You have ${fmt(S.grit)} Grit.` : ''}`}</div></div></div>`;
        html += `<div class="crow"><button class="btn sm${can ? ' primary' : ''}" id="expand" ${can ? '' : 'disabled'}>${r >= 3 ? 'Max size' : `Expand · ${fmt(cost)} Grit`}</button></div>`;
        html += `<div class="crow" style="align-items:center"><label class="s" for="tax">Tax ${c.tax.v}%</label><input type="range" id="tax" min="0" max="20" value="${c.tax.v}" style="flex:1"></div><div class="chint">Tax pays Bucks for decor and festivals. Above 12% happiness slips${peak < 200 ? '; at Village (200) tax starts to matter' : ''}.</div>`; }
      if (tool === 'view') html += `<div class="crow">${[['none', 'Normal'], ['lv', 'Land value'], ['poll', 'Pollution'], ['power', 'Power'], ['water', 'Water'], ['school', 'School'], ['clinic', 'Clinic'], ['fire', 'Fire'], ['police', 'Police'], ['park', 'Parks']].map(([id, n]) => `<button class="btn sm${view === id ? ' primary' : ''}" data-view="${id}">${n}</button>`).join('')}</div>`;
      if (sel) {
        const [x, y] = sel; const p = tileAt(c, x, y); const i = A.info[kkey(x, y)];
        if (!owned(c, x, y)) html += `<div class="chint">Outside your land. Open <b>Land &amp; tax</b> to expand${c.ring.v < 3 ? ` — ${fmt(expandCost(c))} Grit${peak < (LAND_GATE[c.ring.v] || 0) ? `, from ${fmt(LAND_GATE[c.ring.v])} people` : ''}` : ''}.</div>`;
        else if (!p) html += `<div class="chint">Empty land at ${x},${y}${i ? '' : ''}. Land value ${(A.info[kkey(x, y)] || { lvs: 30 }).lvs}.</div>`;
        else if (ZONES[p.k]) { const z = ZONES[p.k]; const ok = growthOK(i, A, c); const tm = p.lv < 3 ? GROW_H[p.lv] * HOUR / (p.k === 'r' ? A.M.family : p.k === 'c' ? A.M.business : 1) : 0; const left = p.g ? Math.max(0, tm - (now() - p.g)) : tm; html += `<div class="csel"><span class="e">${z.e}</span><div><b>${z.name}</b> · ${p.lv === 0 ? (p.g ? 'under construction' : 'vacant lot') : `level ${p.lv}`}${p.k === 'r' ? ` · ${z.pop[p.lv]} people` : ` · ${z.jobs[p.lv]} jobs`}<div class="s">land value ${i.lvs} · pollution ${i.poll} · services: ${['power', 'water', 'school', 'clinic', 'fire', 'police', 'park'].filter(s => i.cov[s]).join(', ') || 'none'}</div><div class="s">${p.lv >= 3 ? 'Maxed out.' : ok.ok ? `Growing → L${p.lv + 1} in ${left > HOUR ? Math.ceil(left / HOUR) + ' h' : Math.ceil(left / 60000) + ' min'}` : `To grow, needs: ${ok.need.join(', ')}`}${p.d && p.lv > 0 ? ` · <span style="color:var(--body)">losing ${growthOK(i, A, c, true).need.join(', ')} — declines in ${Math.ceil((DECLINE_H * HOUR - (now() - p.d)) / HOUR)} h</span>` : ''}</div></div></div>`; }
        else if (SERVICES[p.k]) { const s = A.svc.find(v => v.x === x && v.y === y); html += `<div class="csel"><span class="e">${SERVICES[p.k].e}</span><div><b>${SERVICES[p.k].name}</b>${i && !i.active ? ' · <span style="color:var(--body)">not next to a road</span>' : ''}<div class="s">${s ? `reach ${s.R} · load ${s.cap === Infinity ? '—' : `${s.load}/${s.cap} (${Math.round(s.eff * 100)}%)`} · upkeep ${SERVICES[p.k].up}/day` : ''}</div></div></div>`; }
        else if (p.k === 'hall') html += `<div class="csel"><span class="e">🏛️</span><div><b>City Hall</b><div class="s">${A.mile[1]} · ${fmt(A.pop)} people · happiness ${A.happiness} · avg land value ${Math.round(A.avgLV)} · pollution on homes ${Math.round(A.avgPoll)}</div></div></div>`;
        else if (p.k === 'road') html += `<div class="chint">Road${A.conn.has(kkey(x, y)) ? '' : ' — <b>not connected to City Hall</b>'}.</div>`;
        else if (DECOR[p.k]) html += `<div class="chint">${DECOR[p.k].name}.</div>`;
      } else if (tool !== 'land') html += `<div class="chint">${tool === 'select' ? 'Tap a tile to inspect it. Drag to pan, pinch or use the buttons to zoom.' : tool === 'road' ? `Road · ${ROAD_GRIT} Grit a tile. Tap or drag from City Hall. Two fingers to pan.` : ZONES[tool] ? `${ZONES[tool].name} · ${ZONES[tool].grit} Grit a tile, within 2 tiles of a road. It builds itself over hours once it has power.` : tool === 'bulldoze' ? 'Tap a tile to clear it. No refund.' : tool === 'service' ? 'Pick a service, then tap a tile next to a road. The blue area is its reach.' : tool === 'decor' ? 'Paid in Bucks from taxes. Landmarks unlock by your level.' : ''}</div>`;
      panel.innerHTML = html;
    }
    panel.addEventListener('click', e => {
      const S = get(); const c = S.city;
      const tb = e.target.closest('[data-tool]'), sb = e.target.closest('[data-sub]'), vb = e.target.closest('[data-view]'), fest = e.target.closest('[data-fest]'), ex = e.target.closest('#expand');
      if (tb) { tool = tb.dataset.tool; sub = null; if (tool !== 'view') view = view; renderPanel(); return; }
      if (sb) { sub = sb.dataset.sub; if (tool === 'service' && SERVICES[sub]) view = 'none'; renderPanel(); return; }
      if (vb) { view = vb.dataset.view; renderPanel(); return; }
      if (fest) { if (bucks(c) < FEST_BUCKS) return; (c.ledger[deviceId] ||= { earned: 0, spent: 0 }).spent += FEST_BUCKS; c.fest = { until: now() + FEST_MS, t: now() }; lastA = null; commit(); toast('🎉 Festival — +5 happiness for 24 h'); renderHud(); renderPanel(); return; }
      if (ex) { const cost = expandCost(c); if (S.grit < cost || c.ring.v >= 3 || (lastA || analyze(c, S.vitality)).peak < (LAND_GATE[c.ring.v] || Infinity)) return; c.ring = { v: c.ring.v + 1, t: now() }; c.gspent[deviceId] = (c.gspent[deviceId] || 0) + cost; lastA = null; dirtyG = true; commit(); toast('City limits expanded', true); fitCamera(); renderHud(); renderPanel(); return; }
    });
    panel.addEventListener('input', e => { if (e.target.id === 'tax') { const c = get().city; c.tax = { v: +e.target.value, t: now() }; lastA = null; commit(); renderHud(); const l = panel.querySelector('label[for=tax]'); if (l) l.textContent = `Tax ${c.tax.v}%`; } });

    // ---- placing ----
    function place(x, y) {
      const S = get(); const c = S.city; const t = now(); const A = lastA || analyze(c, S.vitality);
      if (x < 0 || y < 0 || x >= W || y >= W) return false;
      if (tool === 'select') { sel = [x, y]; renderPanel(); return false; }
      if (!owned(c, x, y)) { sel = [x, y]; renderPanel(); return false; }
      const p = tileAt(c, x, y); const spend = n => { c.gspent[deviceId] = (c.gspent[deviceId] || 0) + n; };
      if (tool === 'bulldoze') { if (!p || p.k === 'hall') return false; p.gone = true; p.t = t; lastA = null; dirtyG = dirtyB = true; commit(); return true; }
      if (p) return false; // occupied
      if (tool === 'road') { if (S.grit < ROAD_GRIT) { toast('Not enough Grit'); return false; } c.tiles[kkey(x, y)] = { k: 'road', lv: 0, t, g: 0, d: 0, gone: false }; spend(ROAD_GRIT); }
      else if (ZONES[tool]) { if (S.grit < ZONES[tool].grit) { toast('Not enough Grit — earn it in missions'); return false; } c.tiles[kkey(x, y)] = { k: tool, lv: 0, t, g: 0, d: 0, gone: false }; spend(ZONES[tool].grit); }
      else if (tool === 'service' && sub && SERVICES[sub]) { const s = SERVICES[sub]; if (A.peak < s.mile) return false; if (S.grit < s.grit) { toast(`Needs ${s.grit} Grit`); return false; } c.tiles[kkey(x, y)] = { k: sub, lv: 0, t, g: 0, d: 0, gone: false }; spend(s.grit); const A2 = analyze(c, S.vitality); const inf = A2.info[kkey(x, y)]; toast(inf && !inf.active ? `${s.name} isn’t next to a road — it won’t operate` : `${s.e} ${s.name} built`); }
      else if (tool === 'decor' && sub && DECOR[sub]) { const d = DECOR[sub]; if (A.peak < d.mile || (d.rank && (S.level || 1) < d.rank)) return false; if (bucks(c) < d.bucks) { toast(`Needs ${d.bucks} Bucks`); return false; } c.tiles[kkey(x, y)] = { k: sub, lv: 0, t, g: 0, d: 0, gone: false }; (c.ledger[deviceId] ||= { earned: 0, spent: 0 }).spent += d.bucks; }
      else return false;
      lastA = null; dirtyG = dirtyB = true; commit(); return true;
    }
    // ---- pointer: tap / drag-paint / pan / pinch ----
    const ptrs = new Map(); let drag = null, pinch = null, painted = new Set();
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: cam.z, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, cx: cam.x, cy: cam.y }; drag = null; return; }
      const r = canvas.getBoundingClientRect(); const [wx, wy] = toWorld(e.clientX - r.left, e.clientY - r.top); const [gx, gy] = toGrid(wx, wy);
      drag = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false, gx, gy }; painted = new Set();
      hover = [gx, gy];
    });
    canvas.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const z = clamp(pinch.z * d / pinch.d, 0.35, 2.2); const r = canvas.getBoundingClientRect(); const mx = pinch.mx - r.left, my = pinch.my - r.top; cam.x = mx / z - (mx / pinch.z - pinch.cx); cam.y = my / z - (my / pinch.z - pinch.cy); cam.z = z; return; }
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy; if (Math.hypot(dx, dy) > 6) drag.moved = true;
      const r = canvas.getBoundingClientRect(); const [wx, wy] = toWorld(e.clientX - r.left, e.clientY - r.top); const [gx, gy] = toGrid(wx, wy); hover = [gx, gy];
      const paintTool = tool === 'road' || ZONES[tool] || tool === 'bulldoze';
      if (paintTool && drag.moved) { const k = kkey(gx, gy); if (!painted.has(k)) { painted.add(k); if (place(gx, gy)) { renderHud(); } } }
      else if (drag.moved) { cam.x = drag.cx + dx / cam.z; cam.y = drag.cy + dy / cam.z; }
    });
    const endPtr = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (drag && !drag.moved) { const k = kkey(drag.gx, drag.gy); if (!painted.has(k)) { const ok = place(drag.gx, drag.gy); if (ok) { renderHud(); if (tool === 'service' || tool === 'decor') { sel = [drag.gx, drag.gy]; } } } renderPanel(); } drag = null; if (!ptrs.size) hover = null; };
    canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
    canvas.addEventListener('wheel', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const z = clamp(cam.z * (e.deltaY < 0 ? 1.1 : 0.9), 0.4, 2.2); cam.x = mx / z - (mx / cam.z - cam.x); cam.y = my / z - (my / cam.z - cam.y); cam.z = z; }, { passive: false });
    window.addEventListener('resize', () => { if (visible) { size(); fitCamera(); } });
    setInterval(() => { if (visible) { tick(); renderHud(); } }, 60000);
    return { show, refresh: () => { if (visible) { lastA = null; dirtyG = dirtyB = true; renderHud(); renderPanel(); } },
      _tap: (x, y) => { const ok = place(x, y); renderHud(); renderPanel(); return ok; }, _tool: (t, s) => { tool = t; sub = s || null; renderPanel(); }, _sel: (x, y) => { sel = [x, y]; renderPanel(); }, _analyze: () => lastA || analyze(get().city, get().vitality),
      _advance: h => { const c = get().city; for (const k in c.tiles) if (c.tiles[k].g) c.tiles[k].g -= h * HOUR; if (c.lastTax.t) c.lastTax.t -= h * HOUR; tick(); renderHud(); renderPanel(); }, _peak: n => { get().city.peakPop = { v: n, t: now() }; lastA = null; tick(); renderHud(); renderPanel(); } };
  }

  return { ZONES, SERVICES, DECOR, MILES, norm, merge, emptyCity, gritSpent, bucks, analyze, population, cityTitle, fmt, mount };
})();
