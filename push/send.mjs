// Sends due reminders as Web Push. Runs on a GitHub Actions cron (see .github/workflows/push.yml).
// Reads the app's sync Gist (raw, unlisted URL) — never prints its contents.
import webpush from 'web-push';

const { GIST_RAW, VAPID_PUBLIC, VAPID_PRIVATE, WINDOW_MIN = '15' } = process.env;
if (!GIST_RAW || !VAPID_PUBLIC || !VAPID_PRIVATE) { console.log('missing config'); process.exit(0); }
webpush.setVapidDetails('mailto:martin@optimumedia.com', VAPID_PUBLIC, VAPID_PRIVATE);

const DEFAULTS = {
  first:  { t: '07:00', title: 'First move', body: 'The first move you set last night. Go.' },
  gym:    { t: '08:25', title: 'Gym window in 5', body: 'Boys dropped off at 08:30 — nobody needs you until 10:00.' },
  lunch:  { t: '12:55', title: 'Protein + pulse', body: 'Lunch protein hit, then the two-tap midday pulse.' },
  stop:   { t: '19:55', title: 'Hard stop in 5', body: 'Laptop closed at 20:00. Tonight is booked.' },
  close:  { t: '22:25', title: 'Close the day', body: 'Two minutes: best move, one line, tomorrow’s first move.' },
  bday:   { t: '07:30', title: '🎂 Birthday today', body: '' },
};

const res = await fetch(GIST_RAW + (GIST_RAW.includes('?') ? '&' : '?') + 't=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
if (!res.ok) { console.log('gist fetch failed', res.status); process.exit(0); }
const state = await res.json();
const subs = Object.values(state.push || {}).filter(p => p && p.sub && p.sub.endpoint);
if (!subs.length) { console.log('no subscriptions'); process.exit(0); }
const tz = subs.map(p => p.tz).find(Boolean) || 'Europe/Zagreb';
const prefs = state.remind || {};

// local time in the user's zone
const now = new Date();
const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', month: '2-digit', day: '2-digit', hour12: false }).formatToParts(now);
const get = t => parts.find(p => p.type === t).value;
const nowMin = (+get('hour') % 24) * 60 + +get('minute');
const md = `${get('month')}-${get('day')}`;
const win = +WINDOW_MIN;
const inWindow = hhmm => { const [h, m] = hhmm.split(':').map(Number); const d = h * 60 + m - nowMin; return d >= -Math.floor(win / 2) && d < Math.ceil(win / 2); };

const due = [];
for (const [id, def] of Object.entries(DEFAULTS)) {
  const pref = prefs[id] || {};
  if (pref.on === false) continue;
  if (id === 'bday') {
    const names = Object.values(state.friends || {}).filter(f => f && !f.gone && f.bday && f.bday.slice(5) === md).map(f => f.name);
    if (names.length && inWindow(def.t)) due.push({ tag: 'bday', title: def.title, body: `${names.join(' & ')} — call, don’t text.` });
    continue;
  }
  const t = /^\d{2}:\d{2}$/.test(pref.t || '') ? pref.t : def.t;
  if (inWindow(t)) due.push({ tag: id, title: def.title, body: def.body });
}
if (!due.length) { console.log('nothing due at', get('hour') + ':' + get('minute'), tz); process.exit(0); }

let sent = 0, gone = 0;
for (const p of subs) for (const n of due) {
  try { await webpush.sendNotification(p.sub, JSON.stringify({ title: n.title, body: n.body, tag: n.tag }), { TTL: 600 }); sent++; }
  catch (e) { if (e.statusCode === 404 || e.statusCode === 410) gone++; else console.log('push error', e.statusCode || e.message); }
}
console.log(`sent ${sent}, expired ${gone}, due: ${due.map(d => d.tag).join(',')}`);
