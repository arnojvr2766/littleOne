/* LittleOne: our shared baby planner.
   Everything is an "entry" ({id, kind, data}) stored through one small API:
   'product' = an option to compare, 'item' = checklist row, 'idea' = note/photo, 'settings' = budget. */
(() => {
const API = (window.LL_CONFIG || {}).api || 'api';
const VERSION = self.LL_VERSION || { version: 'dev', build: '' };
const groupNames = ['Before birth', 'Research now', 'Wait and see', 'Later in year one'];

const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {} }
};
let token = store.get('ll-token');
let entries = [], urls = {};
try { const c = JSON.parse(store.get('ll-cache')); if (c) { entries = c.entries || []; urls = c.urls || {} } } catch {}
const selected = new Set();
let favouritesOnly = false, specialsOnly = false, category = store.get('ll-cat') || 'all', pending = [], stale = false, lastSync = 0, offline = false;

const $ = s => document.querySelector(s);
const view = $('#view'), dlg = $('#dialog');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = v => 'R' + Number(v).toLocaleString('en-ZA', { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2 }).replace(/ /g, ' ');
const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
const link = (url, label) => safeUrl(url) ? '<a class="action" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' ↗</a>' : '';
const newId = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const when = iso => new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const longDate = d => new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
const ofKind = k => entries.filter(e => e.kind === k);
const byId = id => entries.find(e => e.id === id);
const sel = (attr, v) => '[' + attr + '="' + CSS.escape(v) + '"]';
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const ICON = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/></svg>',
  shop: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1.2 11.5H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/></svg>',
  ideas: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/></svg>',
  budget: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M16 14.5h2"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  clip: '<svg viewBox="0 0 24 24"><path d="M20 11.5 12.4 19a5 5 0 0 1-7.1-7.1l8-8a3.4 3.4 0 0 1 4.8 4.8l-7.9 7.9a1.7 1.7 0 0 1-2.4-2.4l7.2-7.2"/></svg>',
  cmp: '<svg viewBox="0 0 24 24"><path d="M7 4v16M17 4v16"/><path d="M3 8h8M13 16h8"/></svg>'
};
const TABS = [['home', 'Home'], ['shop', 'Shop'], ['list', 'Checklist'], ['ideas', 'Ideas'], ['budget', 'Budget']];

function announce(msg) { const n = $('#notice'); n.textContent = msg; clearTimeout(announce.timer); announce.timer = setTimeout(() => n.textContent = '', 3500) }

/* ---------- API ---------- */
async function call(action, body, raw) {
  let res;
  try {
    res = await fetch(API + '?action=' + action, {
      method: 'POST',
      headers: { 'Content-Type': raw ? raw.type : 'application/json', ...(token ? { 'x-ll-token': token } : {}) },
      body: raw || JSON.stringify(body || {})
    });
  } catch { offline = true; status(); throw Error('Could not reach LittleOne. Check your connection.') }
  offline = false;
  const out = await res.json().catch(() => ({}));
  if (res.status === 401 && action !== 'unlock') { lock(); throw Error('Please enter the passcode again.') }
  if (!res.ok) throw Error(out.error || 'Something went wrong. Please try again.');
  return out;
}
function cache() { store.set('ll-cache', JSON.stringify({ entries, urls })) }
function busy() {
  const a = document.activeElement;
  return dlg.open || pending.length || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.value);
}
async function sync(force) {
  if (!token) return;
  try {
    const out = await call('list');
    entries = out.entries; urls = out.urls || {}; lastSync = Date.now(); cache(); status();
    if (force || !busy()) render(); else stale = true;
  } catch (e) { status(); if (force) announce(e.message) }
}
function status() {
  const d = $('#syncdot'); d.className = 'syncdot' + (!token ? ' idle' : offline ? ' off' : lastSync ? '' : ' idle');
  d.title = offline ? 'Offline: showing the last saved copy' : lastSync ? 'Synced ' + new Date(lastSync).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '';
}
// Optimistic write: update the screen first, then save; re-sync if saving fails.
async function put(entry) {
  const now = new Date().toISOString(), old = byId(entry.id);
  const local = { created_at: now, ...old, ...entry, updated_at: now };
  if (old) entries[entries.indexOf(old)] = local; else entries.push(local);
  cache();
  try { await call('save', { entry: { id: entry.id, kind: entry.kind, data: entry.data } }); lastSync = Date.now(); status() }
  catch (e) { announce(e.message + ' Your last change was not saved.'); sync(true) }
}
async function removeEntry(id) {
  entries = entries.filter(e => e.id !== id); selected.delete(id); cache();
  try { await call('delete', { id }) } catch (e) { announce(e.message); sync(true) }
}
function lock() { token = null; store.set('ll-token', null); store.set('ll-cache', null); entries = []; urls = {}; if (dlg.open) dlg.close(); render() }

/* ---------- Photos ---------- */
async function prepare(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file), max = 2000, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5e6 && !/hei[cf]/.test(file.type)) return file;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return (await new Promise(r => c.toBlob(r, 'image/jpeg', .85))) || file;
  } catch { return file }
}
async function uploadFile(file) {
  const blob = await prepare(file);
  const out = await call('upload', null, blob.type ? blob : new Blob([blob], { type: 'application/octet-stream' }));
  urls[out.path] = out.url;
  return { path: out.path, name: file.name || 'Pasted image', type: out.type, size: out.size };
}

/* ---------- Options (products) ---------- */
const products = () => ofKind('product');
const photoOf = p => p.data.photo ? urls[p.data.photo] : p.data.image;
const title = p => [p.data.brand, p.data.name].filter(Boolean).join(' ');
const lowest = p => [...(p.data.offers || [])].sort((a, b) => a.price - b.price)[0];
const deviceId = store.get('ll-device') || (() => { const v = newId(); store.set('ll-device', v); return v })();
const drop = o => o && o.dropFrom > o.price ? o.dropFrom - o.price : 0;
const priceOf = p => p.data.status === 'bought' && p.data.paid > 0 ? p.data.paid : (lowest(p)?.price || 0);
const categories = () => [...new Set(products().map(p => p.data.category).filter(Boolean))].sort();
const inCat = c => products().filter(p => p.data.category === c);
const catStatus = c => { const ps = inCat(c); return ps.some(p => p.data.status === 'bought') ? 'Bought' : ps.some(p => p.data.status === 'chosen') ? 'Decided' : ps.some(p => p.data.fav) ? 'Shortlisted' : 'Researching' };
const pill = st => '<span class="pill ' + st.toLowerCase() + '">' + st + '</span>';
const stockTag = d => d.stock === 'in' ? '<span class="stock in">In stock</span>' : d.stock === 'out' ? '<span class="stock out">Out of stock</span>' : d.stock === 'unknown' ? '<span class="stock">Stock unconfirmed</span>' : '';
const specOrder = ['Style', 'Good for running', 'Heart rate', 'Oxygen level', 'Breathing movement', 'Sleep tracking', 'Camera', 'Worn on baby', 'Medical status', 'Availability', 'Pram weight', 'Folded size', 'Fold', 'Newborn walks', 'Suitable for', 'Includes', 'Type', 'Standard'];
const rank = k => { const i = specOrder.indexOf(k); return i < 0 ? 99 : i };
const specKeys = ps => [...new Set(ps.flatMap(p => Object.keys(p.data.specs || {})))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
const stockRank = d => ({ in: 0, unknown: 1, out: 2 }[d.stock] ?? 1);
const specials = () => products().flatMap(p => (p.data.offers || []).map(o => [p, o])).filter(([, o]) => o.old > o.price || drop(o));

function imageTag(p, cls = '') {
  const src = photoOf(p);
  return src ? '<img class="' + cls + '" src="' + esc(src) + '" alt="' + esc(title(p)) + '" loading="lazy">' : '<span class="noPhoto ' + cls + '" aria-hidden="true">' + esc((p.data.name || '?')[0].toUpperCase()) + '</span>';
}
function quickBar(p) {
  const d = p.data, id = esc(p.id), likes = d.likes || [], mine = likes.includes(deviceId), notes = (d.notes || []).length, st = d.status, cmp = selected.has(p.id);
  return '<div class="quick">' +
    '<button class="qbtn' + (mine ? ' on' : '') + '" aria-pressed="' + mine + '" data-like="' + id + '" aria-label="' + (mine ? 'Unlike ' : 'Like ') + esc(d.name) + '">👍' + (likes.length ? '<span>' + likes.length + '</span>' : '') + '</button>' +
    '<button class="qbtn" data-notes="' + id + '" aria-label="Notes on ' + esc(d.name) + '">💬' + (notes ? '<span>' + notes + '</span>' : '') + '</button>' +
    '<button class="qbtn cmp' + (cmp ? ' on' : '') + '" aria-pressed="' + cmp + '" data-compare="' + id + '" aria-label="Compare ' + esc(d.name) + '">' + ICON.cmp + '</button>' +
    (st === 'bought' ? '<button class="qbtn on wide" data-details="' + id + '">✓ Bought</button>'
      : '<button class="qbtn wide' + (st === 'chosen' ? ' on' : '') + '" aria-pressed="' + (st === 'chosen') + '" data-quickpick="' + id + '">★ ' + (st === 'chosen' ? 'Buying' : 'Buy') + '</button>') +
    '</div>';
}
function card(p, showCat) {
  const d = p.data, o = lowest(p), fav = !!d.fav, save = o && o.old > o.price;
  return '<article class="card' + (d.status ? ' picked' : '') + '"><div class="photo">' + imageTag(p) +
    (drop(o) ? '<span class="sale">↓ ' + money(drop(o)) + '</span>' : save ? '<span class="sale">Save ' + money(o.old - o.price) + '</span>' : '') +
    (d.status ? '<span class="pick">' + (d.status === 'bought' ? '✓' : '★') + '</span>' : '') +
    '<button class="fav ' + (fav ? 'on' : '') + '" aria-label="Shortlist ' + esc(d.name) + '" aria-pressed="' + fav + '" data-fav="' + esc(p.id) + '">' + (fav ? '♥' : '♡') + '</button></div>' +
    '<div class="cardBody"><button class="cardTap" data-details="' + esc(p.id) + '" aria-label="Details for ' + esc(title(p)) + '">' +
    (showCat ? '<span class="catTag">' + esc(d.category) + '</span>' : '') +
    '<span class="brandName">' + esc(d.brand) + '</span><h3>' + esc(d.name) + '</h3><p class="feature">' + esc(d.feature) + '</p>' +
    '<div class="priceline">' + (o ? '<span class="price">' + money(o.price) + '</span>' + (save ? '<del>' + money(o.old) + '</del>' : '') : '<span class="small">No price yet</span>') + stockTag(d) + '</div></button>' +
    quickBar(p) + '</div></article>';
}

/* ---------- Screens ---------- */
function head(t, sub) { return '<div class="screenHead"><div><h1>' + t + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div></div>' }

function home() {
  const items = ofKind('item'), done = items.filter(x => x.data.done).length, cats = categories(), all = products();
  const planned = all.filter(p => p.data.status).reduce((t, p) => t + priceOf(p), 0);
  const order = { Researching: 0, Shortlisted: 1, Decided: 2, Bought: 3 };
  const open = cats.map(c => [c, catStatus(c)]).sort((a, b) => order[a[1]] - order[b[1]]);
  const deals = specials().sort((a, b) => (drop(b[1]) || b[1].old - b[1].price) - (drop(a[1]) || a[1].old - a[1].price)).slice(0, 3);
  const nextItems = items.filter(x => !x.data.done).sort((a, b) => a.data.group - b.data.group).slice(0, 3);
  const decided = open.filter(([, s]) => s === 'Decided' || s === 'Bought').length;
  const showInstall = !standalone() && store.get('ll-install-hidden') !== '1';
  return '<div class="home"><div class="hello"><div><h1>Getting ready for baby</h1><p>' + decided + ' of ' + cats.length + ' big decisions made · ' + done + ' of ' + items.length + ' things ready</p></div></div>' +
    '<div><div class="stats">' +
      '<a class="stat" href="#list"><small>Checklist</small><strong>' + done + '/' + items.length + '</strong><div class="bar"><i style="width:' + (items.length ? Math.round(done / items.length * 100) : 0) + '%"></i></div></a>' +
      '<a class="stat" href="#budget"><small>Planned</small><strong>' + money(planned) + '</strong></a>' +
      '<a class="stat" href="#ideas"><small>Ideas</small><strong>' + ofKind('idea').filter(x => !x.data.filed).length + '</strong></a>' +
    '</div>' +
    (showInstall ? '<div class="install"><img src="assets/icon-180.png" alt=""><div><strong>Add LittleOne to your home screen</strong>' + (/iphone|ipad/i.test(navigator.userAgent) ? 'In Safari, tap Share, then “Add to Home Screen”.' : deferredInstall ? '<button class="textbtn" id="installBtn">Install the app</button>' : 'Use your browser menu: “Install app” or “Add to Home screen”.') + '</div><button id="hideInstall" aria-label="Hide">×</button></div>' : '') +
    '<div class="section"><h2>Decisions <a href="#shop">See all</a></h2><div class="group">' +
      open.map(([c, s]) => { const ps = inCat(c); return '<button class="row" data-gocat="' + esc(c) + '"><span class="rtitle">' + esc(c) + '<small>' + ps.length + ' option' + (ps.length === 1 ? '' : 's') + (ps.filter(p => p.data.fav).length ? ' · ' + ps.filter(p => p.data.fav).length + ' shortlisted' : '') + '</small></span>' + pill(s) + ICON.chev + '</button>' }).join('') +
    '</div></div></div>' +
    '<div><div class="section"><h2>Next on the checklist <a href="#list">Open</a></h2><div class="group">' +
      (nextItems.length ? nextItems.map(x => '<label class="listRow"><input type="checkbox" data-done="' + esc(x.id) + '"><span><strong>' + esc(x.data.name) + '</strong><small>' + esc(groupNames[x.data.group] || '') + '</small></span></label>').join('') : '<p class="empty">Everything on the list is ready.</p>') +
    '</div></div>' +
    (deals.length ? '<div class="section"><h2>Specials <a href="#offers">All offers</a></h2><div class="group">' + deals.map(([p, o]) => '<button class="row" data-details="' + esc(p.id) + '">' + (photoOf(p) ? '<img src="' + esc(photoOf(p)) + '" alt="">' : '') + '<span class="rtitle">' + esc(title(p)) + '<small>' + esc(o.shop) + ' · ' + (drop(o) ? 'dropped ' + money(drop(o)) : 'save ' + money(o.old - o.price)) + '</small></span><span class="price">' + money(o.price) + '</span></button>').join('') + '</div></div>' : '') +
    '</div></div>';
}

function shopTabs(active) {
  return '<div class="segment" role="tablist"><a href="#shop"' + (active === 'shop' ? ' aria-current="page"' : '') + '>Options</a><a href="#offers"' + (active === 'offers' ? ' aria-current="page"' : '') + '>Offers' + (specials().length ? ' · ' + specials().length + ' specials' : '') + '</a></div>';
}
function shop() {
  const cats = categories(); if (category !== 'all' && !cats.includes(category)) category = 'all';
  const all = products(), favs = all.filter(p => p.data.fav && (category === 'all' || p.data.category === category)).length;
  const list = all.filter(p => (category === 'all' || p.data.category === category) && (!favouritesOnly || p.data.fav))
    .sort((a, b) => (a.data.category || '').localeCompare(b.data.category || '') || !!b.data.status - !!a.data.status || (b.data.specs?.Style === 'Jogging pram') - (a.data.specs?.Style === 'Jogging pram') || stockRank(a.data) - stockRank(b.data) || (lowest(a)?.price ?? 1e9) - (lowest(b)?.price ?? 1e9));
  return head('Shop', 'Compare options, like them, and pick the one you’re buying.') + shopTabs('shop') +
    '<div class="chips" role="group" aria-label="Categories"><button class="chip' + (category === 'all' ? ' active' : '') + '" data-cat="all">All</button>' +
      cats.map(c => '<button class="chip' + (category === c ? ' active' : '') + '" data-cat="' + esc(c) + '"><i class="dot ' + catStatus(c).toLowerCase() + '"></i>' + esc(c) + '</button>').join('') + '</div>' +
    '<div class="catHead"><h2>' + esc(category === 'all' ? 'Everything' : category) + '</h2>' + (category !== 'all' ? pill(catStatus(category)) : '') +
      '<button class="chip' + (favouritesOnly ? ' active' : '') + '" data-filter aria-pressed="' + favouritesOnly + '">♡ Shortlist ' + favs + '</button></div>' +
    (list.length ? '<div class="grid">' + list.map(p => card(p, category === 'all')).join('') + '</div>'
      : '<p class="empty">' + (favouritesOnly ? 'Tap ♡ on an option to shortlist it.' : 'Nothing here yet. Tap + to add the first option.') + '</p>') +
    compareBar();
}
function compareBar() {
  for (const id of [...selected]) if (!byId(id)) selected.delete(id);
  document.body.classList.toggle('has-compare', selected.size > 0 && route() === 'shop');
  return selected.size ? '<div class="comparebar"><span>' + selected.size + ' to compare</span><span><button class="ghost" style="background:none;border:0;color:#fff;min-height:40px" id="clearCompare">Clear</button><button class="primary" id="compareBtn"' + (selected.size < 2 ? ' disabled' : '') + '>Compare</button></span></div>' : '';
}
function offerRow(p, o, thumb = true) {
  const save = o.old > o.price;
  return '<div class="offerRow">' + (thumb ? imageTag(p, 'thumb') : '') + '<div class="info"><strong>' + esc(thumb ? title(p) : o.shop) + '</strong><small>' + (thumb ? esc(o.shop) : o.stock === 'out' ? 'Out of stock' : 'Shop listing') + (save ? ' · Save ' + money(o.old - o.price) : '') + (drop(o) ? ' · ↓ ' + money(drop(o)) + (o.dropAt ? ' on ' + longDate(o.dropAt) : '') : '') + '</small></div><div class="priceCell"><span class="price">' + money(o.price) + '</span>' + (save ? '<del>' + money(o.old) + '</del>' : '') + '</div>' + link(o.link, 'Shop') + '</div>';
}
function offers() {
  const list = products().flatMap(p => (p.data.offers || []).map(o => [p, o])).filter(([, o]) => !specialsOnly || o.old > o.price || drop(o)).sort((a, b) => a[1].price - b[1].price);
  return head('Shop', 'Every saved shop price, cheapest first.') + shopTabs('offers') +
    '<div class="chips"><button class="chip' + (!specialsOnly ? ' active' : '') + '" data-offers="all">All prices</button><button class="chip' + (specialsOnly ? ' active' : '') + '" data-offers="sale">Specials and drops</button></div>' +
    (list.length ? list.map(([p, o]) => offerRow(p, o)).join('') : '<p class="empty">No offers to show.</p>') +
    '<p class="hint">Prices are re-checked automatically each morning where the shop allows it. A special is the shop’s own “was” price; ↓ is a drop since our last check.</p>';
}

function detail(id) {
  const p = byId(id); if (!p) return; const d = p.data, specs = specKeys([p]).map(k => [k, d.specs[k]]);
  openDialog(title(p), (photoOf(p) ? '<div class="detailPhoto">' + imageTag(p) + '</div>' : '') + quickBar(p) + '<p style="margin-top:12px">' + esc(d.feature) + '</p>' +
    (specs.length ? '<dl>' + specs.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' : '') +
    link(d.source, 'Product page') + '<h3>Shop prices</h3>' +
    ((d.offers || []).length ? d.offers.map(o => offerRow(p, o, false)).join('') : '<p class="small">No shop prices saved yet.</p>') +
    '<p class="hint">' + (d.checked ? 'Prices checked ' + longDate(d.checked) + '. ' : '') + 'Confirm the local model and accessories with the shop.</p>' +
    decisionBlock(p) + notesBlock(p) +
    '<div class="formActions"><button class="ghost" data-edit="' + esc(p.id) + '">Edit</button><button class="ghost danger" data-remove="' + esc(p.id) + '">Remove</button></div>');
  dlg.dataset.sheet = 'detail:' + id;
}
function decisionBlock(p) {
  const d = p.data, id = esc(p.id);
  return '<div class="decide"><h3>Our decision</h3>' +
    (d.status === 'bought' ? '<p>✓ Bought' + (priceOf(p) ? ' for ' + money(priceOf(p)) : '') + '.</p><div class="formActions"><button class="ghost" data-status="" data-id="' + id + '">Undo</button></div>'
      : (d.status === 'chosen' ? '<p>★ This is the one we’re buying.</p>' : '<p class="small">Still deciding. Picking it adds it to the budget.</p>') +
        '<div class="formActions">' + (d.status === 'chosen' ? '' : '<button class="primary" data-status="chosen" data-id="' + id + '">We’re buying this</button>') + '<button class="ghost" data-showbuy>Mark as bought</button>' + (d.status === 'chosen' ? '<button class="ghost" data-status="" data-id="' + id + '">Undo</button>' : '') + '</div>' +
        '<form id="boughtForm" class="inlineForm hidden" data-id="' + id + '"><label class="field">What we paid (R)<input name="paid" type="number" inputmode="decimal" min="0" step="0.01" required value="' + esc(lowest(p)?.price ?? '') + '"></label><button class="primary">Save</button></form>') + '</div>';
}
function notesBlock(p, bare) {
  const d = p.data, id = esc(p.id), likes = d.likes || [], mine = likes.includes(deviceId);
  return '<div class="decide"' + (bare ? ' style="margin-top:0"' : '') + '>' + (bare ? '' : '<h3>What we think</h3>') + '<div class="formActions" style="margin-top:0"><button class="ghost' + (mine ? ' on' : '') + '" aria-pressed="' + mine + '" data-like="' + id + '">👍 ' + (mine ? 'You like this' : 'I like this') + '</button><span class="small">' + (likes.length ? likes.length + ' of us like' + (likes.length === 1 ? 's' : '') + ' it' : 'No likes yet') + '</span></div>' +
    (d.notes || []).map((n, i) => '<div class="note"><span><span class="noteText">' + esc(n.text) + '</span><small>' + when(n.at) + '</small></span><button class="rowDel" data-delnote="' + i + '" data-id="' + id + '" aria-label="Remove note">×</button></div>').join('') +
    '<form id="noteForm" class="inlineForm" data-id="' + id + '"><input name="note" aria-label="Add a note" placeholder="Add a note…" maxlength="300" required enterkeyhint="send"><button class="primary">Add</button></form></div>';
}
function notesSheet(id) {
  const p = byId(id); if (!p) return;
  openDialog('Notes · ' + title(p), notesBlock(p, true));
  dlg.dataset.sheet = 'notes:' + id;
  setTimeout(() => $('#noteForm input')?.focus(), 60);
}
function refreshSheet(id) {
  const s = dlg.dataset.sheet || '';
  if (s === 'notes:' + id) notesSheet(id); else if (s === 'detail:' + id) { const y = dlg.scrollTop; detail(id); dlg.scrollTop = y }
}
function patch(id, change) {
  const p = byId(id); if (!p) return;
  const done = put({ ...p, data: { ...p.data, ...change } });
  if (dlg.open) { stale = true; refreshSheet(id) } else rerenderKeep();
  return done;
}
function setStatus(id, status, paid) {
  const p = byId(id); if (!p) return;
  // Only one "the one we're buying" per category.
  if (status === 'chosen') for (const o of inCat(p.data.category)) if (o.id !== id && o.data.status === 'chosen') put({ ...o, data: { ...o.data, status: undefined } });
  patch(id, { status: status || undefined, paid: status === 'bought' ? paid : undefined });
  announce(status === 'bought' ? 'Marked as bought' : status === 'chosen' ? '★ Added to the budget' : 'Decision cleared');
}
function comparison() {
  const ps = products().filter(p => selected.has(p.id)), keys = specKeys(ps);
  const row = (label, field) => '<tr><th scope="row">' + esc(label) + '</th>' + ps.map(p => '<td>' + field(p) + '</td>').join('') + '</tr>';
  openDialog('Side by side', '<div class="tableWrap" tabindex="0" aria-label="Comparison, scroll sideways"><table class="comparison"><thead><tr><th scope="col"></th>' + ps.map(p => '<th scope="col">' + esc(title(p)) + '</th>').join('') + '</tr></thead><tbody>' +
    (ps.some(photoOf) ? row('', p => photoOf(p) ? imageTag(p, 'cmpPhoto') : '') : '') + row('Lowest price', p => lowest(p) ? '<b>' + money(lowest(p).price) + '</b>' : '–') + keys.map(k => row(k, p => esc(p.data.specs?.[k] ?? '–'))).join('') +
    row('Summary', p => esc(p.data.feature)) + (ps.some(p => (p.data.notes || []).length || (p.data.likes || []).length) ? row('What we think', p => ((p.data.likes || []).length ? '👍 ' + p.data.likes.length + '<br>' : '') + (p.data.notes || []).map(n => esc(n.text)).join('<br>')) : '') +
    row('Shops', p => (p.data.offers || []).map(o => safeUrl(o.link) ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(o.link) + '">' + esc(o.shop) + ' · ' + money(o.price) + '</a>' : esc(o.shop) + ' · ' + money(o.price)).join('<br>') || '–') +
    '</tbody></table></div>' + (ps.every(p => /pram/i.test(p.data.category || '')) ? '<p class="callout">In-store check: each of you fold the pram and lift it into the RAV4, then check the boot space left for groceries.</p>' : ''));
}
function offerInputs(o = {}) {
  return '<div class="offerInputs"><input name="shop" placeholder="Shop" aria-label="Shop" value="' + esc(o.shop) + '"><input name="price" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Price (R)" aria-label="Price in rand" value="' + esc(o.price) + '"><input name="old" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Was (R)" aria-label="Previous price in rand" value="' + esc(o.old) + '"><input name="link" type="url" placeholder="Link to listing" aria-label="Link to listing" value="' + esc(o.link) + '"></div>';
}
function productForm(id, pre) {
  const p = id ? byId(id) : null, d = p?.data || pre || {};
  const specs = Object.entries(d.specs || {}).map(([k, v]) => k + ': ' + v).join('\n');
  openDialog(p ? 'Edit option' : 'New option', '<form id="productForm" data-id="' + esc(id || '') + '" data-photo="' + esc(pre?.photo || '') + '" data-idea="' + esc(pre?.idea || '') + '"><div class="formGrid">' +
    '<label class="field">Name<input name="name" required maxlength="80" value="' + esc(d.name) + '"></label>' +
    '<label class="field">Brand<input name="brand" maxlength="60" value="' + esc(d.brand) + '"></label>' +
    '<label class="field wide">Category<input name="category" list="catList" maxlength="40" placeholder="e.g. Prams, Car seats, Monitors" value="' + esc(d.category ?? (category === 'all' ? '' : category)) + '"><datalist id="catList">' + categories().map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></label>' +
    '<label class="field wide">What stands out<textarea name="feature" maxlength="600">' + esc(d.feature) + '</textarea></label>' +
    '<label class="field wide">Specs <small>One per line, like “Weight: 11 kg”. Matching labels line up when comparing.</small><textarea name="specs" rows="4">' + esc(specs) + '</textarea></label>' +
    '<div class="field wide">Shop prices<div id="offerRows">' + [...(d.offers || []), {}].map(offerInputs).join('') + '</div><div><button type="button" class="textbtn" id="moreOffers">+ Another shop</button></div></div>' +
    '<label class="field">Product page link<input name="source" type="url" value="' + esc(d.source) + '"></label>' +
    '<label class="field">Photo <small>' + (photoOf(p || { data: {} }) || pre?.photo ? 'Choose a file to replace the photo.' : 'Optional.') + '</small><input name="photo" type="file" accept="image/*"></label>' +
    '</div><p class="error" role="alert"></p><div class="formActions"><button class="primary">' + (p ? 'Save changes' : 'Add option') + '</button><button type="button" class="ghost" data-cancel>Cancel</button></div></form>');
}
async function saveProduct(form) {
  const f = new FormData(form), old = form.dataset.id ? byId(form.dataset.id) : null, btn = form.querySelector('.primary'), err = form.querySelector('.error');
  const specs = {};
  for (const line of String(f.get('specs')).split('\n')) { const i = line.indexOf(':'); if (i > 0 && line.slice(i + 1).trim()) specs[line.slice(0, i).trim()] = line.slice(i + 1).trim() }
  const offerList = [...form.querySelectorAll('.offerInputs')].map(r => {
    const v = n => r.querySelector('[name=' + n + ']').value.trim();
    return { shop: v('shop'), price: Number(v('price')), ...(Number(v('old')) ? { old: Number(v('old')) } : {}), ...(v('link') ? { link: v('link') } : {}) };
  }).filter(o => o.shop && o.price > 0);
  const data = { ...(old?.data || { fav: false, ...(form.dataset.photo ? { photo: form.dataset.photo } : {}) }), name: f.get('name').trim(), brand: f.get('brand').trim(), category: f.get('category').trim() || 'Other', feature: f.get('feature').trim(), specs, offers: offerList, source: f.get('source').trim(), checked: new Date().toISOString().slice(0, 10) };
  btn.disabled = true; err.textContent = '';
  try {
    const file = f.get('photo');
    if (file && file.size) { data.photo = (await uploadFile(file)).path; delete data.image }
    dlg.close(); await put({ id: old?.id || newId(), kind: 'product', data });
    if (form.dataset.idea && byId(form.dataset.idea)) { const x = byId(form.dataset.idea); await put({ ...x, data: { ...x.data, filed: 'Shop' } }) }
    render(); announce(old ? 'Saved' : 'Added to Shop');
  } catch (e) { err.textContent = e.message; btn.disabled = false }
}

/* ---------- Checklist ---------- */
function checklist() {
  const items = ofKind('item'), done = items.filter(x => x.data.done).length;
  return head('Checklist', 'Tick what you’ve bought, borrowed or been given.') +
    '<div class="progress"><strong>' + done + ' of ' + items.length + '</strong> <span class="small">ready</span><div class="bar"><i style="width:' + (items.length ? Math.round(done / items.length * 100) : 0) + '%"></i></div></div>' +
    groupNames.map((g, i) => { const rows = items.filter(x => x.data.group === i).sort((a, b) => !!a.data.done - !!b.data.done); return rows.length ? '<div class="listgroup"><h3>' + g + '</h3><div class="group">' + rows.map(x => '<div class="listRow ' + (x.data.done ? 'done' : '') + '"><input type="checkbox" id="c-' + esc(x.id) + '" data-done="' + esc(x.id) + '" ' + (x.data.done ? 'checked' : '') + '><span><label for="c-' + esc(x.id) + '"><strong>' + esc(x.data.name) + '</strong></label>' + (x.data.note ? '<small>' + esc(x.data.note) + '</small>' : '') + '</span><button class="rowDel" data-remove="' + esc(x.id) + '" aria-label="Remove ' + esc(x.data.name) + '">×</button></div>').join('') + '</div></div>' : '' }).join('') +
    '<p class="hint">Tap + to add something. <a href="https://www.nhs.uk/best-start-in-life/pregnancy/preparing-for-labour-and-birth/what-to-buy-for-your-newborn-baby/" target="_blank" rel="noopener">Newborn essentials guide ↗</a></p>';
}
function itemForm() {
  openDialog('Add to the checklist', '<form class="newItem formGrid"><label class="field wide">What do you need?<input name="item" maxlength="90" required enterkeyhint="done"></label><label class="field wide">Note <small>Optional</small><input name="note" maxlength="200"></label><label class="field wide">When<select name="group">' + groupNames.map((g, i) => '<option value="' + i + '">' + g + '</option>').join('') + '</select></label><div class="formActions wide"><button class="primary">Add</button><button type="button" class="ghost" data-cancel>Cancel</button></div></form>');
  setTimeout(() => $('.newItem input')?.focus(), 60);
}

/* ---------- Ideas ---------- */
const linkify = t => esc(t).replace(/https?:\/\/[^\s<]+/g, u => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>');
function ideas() {
  const list = ofKind('idea').sort((a, b) => b.created_at.localeCompare(a.created_at));
  return head('Ideas', 'Screenshots, shop photos, links and notes. File them when you’re ready.') +
    '<form class="composer" id="composer"><textarea name="text" rows="3" maxlength="5000" aria-label="New idea" placeholder="Type or paste a note, a link or a photo…"></textarea><div class="thumbs" id="thumbs"></div><div class="composerBar"><label class="attach">' + ICON.clip + 'Photo<input type="file" id="pick" accept="image/*,application/pdf,text/plain" multiple hidden></label><button class="primary">Save</button></div><p class="error" role="alert"></p></form>' +
    (list.length ? '<div class="ideas">' + list.map(x => {
      const files = x.data.files || [], pics = files.filter(f => f.type.startsWith('image/') && urls[f.path]), docs = files.filter(f => !pics.includes(f));
      return '<article class="idea">' + (pics.length ? '<div class="ideaPics">' + pics.map(f => '<a href="' + esc(urls[f.path]) + '" target="_blank" rel="noopener"><img src="' + esc(urls[f.path]) + '" alt="' + esc(f.name) + '" loading="lazy"></a>').join('') + '</div>' : '') +
        (x.data.text ? '<p>' + linkify(x.data.text) + '</p>' : '') +
        docs.map(f => urls[f.path] ? link(urls[f.path], f.name) : '<span class="small">' + esc(f.name) + '</span>').join('') +
        (x.data.filed ? '<span class="pill decided">Filed to ' + esc(x.data.filed === 'Compare' ? 'Shop' : x.data.filed) + '</span>' : '<div class="ideaFile"><button class="ghost" data-tolist="' + esc(x.id) + '">→ Checklist</button><button class="ghost" data-tooption="' + esc(x.id) + '">→ Shop option</button></div>') +
        '<div class="ideaMeta"><span>' + when(x.created_at) + '</span><button class="textbtn" data-remove="' + esc(x.id) + '">Remove</button></div></article>';
    }).join('') + '</div>' : '<p class="empty" style="margin-top:14px">No ideas yet.</p>');
}
function ideaParts(x) {
  const text = (x.data.text || '').trim(), url = (text.match(/https?:\/\/\S+/) || [])[0] || '';
  const lines = text.replace(url, '').split('\n').map(l => l.trim()).filter(Boolean);
  return { first: lines[0] || '', rest: lines.slice(1).join(' '), url, photo: ((x.data.files || []).find(f => f.type.startsWith('image/')) || {}).path || '' };
}
function ideaToList(id) {
  const x = byId(id); if (!x) return; const i = ideaParts(x);
  put({ id: newId(), kind: 'item', data: { group: 1, name: (i.first || 'From an idea').slice(0, 90), note: [i.rest, i.url].filter(Boolean).join(' ').slice(0, 200), done: false } });
  put({ ...x, data: { ...x.data, filed: 'Checklist' } }); render(); announce('Added to the checklist');
}
function ideaToOption(id) {
  const x = byId(id); if (!x) return; const i = ideaParts(x);
  productForm(null, { name: i.first.slice(0, 80), feature: i.rest.slice(0, 600), source: i.url, photo: i.photo, idea: id });
}
function addPending(files) {
  for (const file of files) {
    if (file.size > 25e6) { announce('That file is too large.'); continue }
    pending.push({ file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : '' });
  }
  drawPending();
}
function drawPending() {
  const t = $('#thumbs'); if (!t) return;
  t.innerHTML = pending.map((p, i) => '<div class="thumb2">' + (p.url ? '<img src="' + p.url + '" alt="">' : esc(p.file.name)) + '<button type="button" data-unpend="' + i + '" aria-label="Remove attachment">×</button></div>').join('');
}
async function saveIdea(form) {
  const text = form.text.value.trim(), btn = form.querySelector('.primary'), err = form.querySelector('.error');
  if (!text && !pending.length) { err.textContent = 'Add a note or a photo first.'; return }
  btn.disabled = true; btn.textContent = pending.length ? 'Uploading…' : 'Saving…'; err.textContent = '';
  try {
    const files = []; for (const p of pending) files.push(await uploadFile(p.file));
    pending.forEach(p => p.url && URL.revokeObjectURL(p.url)); pending = [];
    await put({ id: newId(), kind: 'idea', data: { text, files } }); render(); announce('Idea saved');
  } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Save' }
}

/* ---------- Budget ---------- */
function budget() {
  const cats = categories(), all = products(), limit = Number(byId('settings')?.data.budget) || 0;
  const sum = st => all.filter(p => p.data.status === st).reduce((t, p) => t + priceOf(p), 0);
  const spent = sum('bought'), toPay = sum('chosen'), planned = spent + toPay;
  const tile = (label, value, cls = '') => '<div class="tile ' + cls + '"><small>' + label + '</small><strong>' + value + '</strong></div>';
  return head('Budget', 'What we’ve picked, what we’ve paid and what’s still open.') +
    '<div class="tiles">' + tile('Planned', money(planned)) + tile('Spent', money(spent)) + tile('Still to pay', money(toPay)) + (limit ? tile(limit - planned >= 0 ? 'Budget left' : 'Over budget', money(Math.abs(limit - planned)), limit - planned >= 0 ? '' : 'over') : '') + '</div>' +
    '<div class="section"><h2>By category</h2><div class="group">' + cats.map(c => {
      const ps = inCat(c), picked = ps.filter(p => p.data.status), prices = ps.map(p => lowest(p)?.price).filter(Boolean);
      return '<div class="budgetRow"><div class="budgetHead"><button class="textbtn" data-gocat="' + esc(c) + '">' + esc(c) + '</button>' + pill(catStatus(c)) + '</div>' +
        (picked.length ? picked.map(p => '<div class="budgetItem"><button class="textbtn" data-details="' + esc(p.id) + '">' + esc(title(p)) + '</button><span>' + (p.data.status === 'bought' ? 'Paid ' : '') + '<b>' + money(priceOf(p)) + '</b></span></div>').join('')
          : '<small>' + ps.length + ' option' + (ps.length === 1 ? '' : 's') + (prices.length ? ', ' + money(Math.min(...prices)) + ' to ' + money(Math.max(...prices)) : '') + '</small>') + '</div>';
    }).join('') + '</div></div>' +
    '<form id="budgetForm" class="inlineForm" style="margin-top:20px"><label class="field">Our total budget (R)<input name="budget" type="number" inputmode="numeric" min="0" step="1" placeholder="Optional" value="' + esc(limit || '') + '"></label><button class="primary">Save</button></form>' +
    '<p class="hint">Tap ★ Buy on an option to add it here. Planned uses the lowest saved shop price.</p>';
}

/* ---------- Settings / app info ---------- */
function settings() {
  const built = VERSION.build ? new Date(VERSION.build).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  openDialog('LittleOne', '<div class="settings"><div style="display:flex;gap:14px;align-items:center;margin-bottom:14px"><img src="assets/icon-180.png" alt="" width="64" height="64" style="border-radius:16px"><div><div class="ver">v' + esc(VERSION.version) + '</div><div class="small">Released ' + esc(built) + '</div></div></div>' +
    '<div class="group">' +
      '<div class="row"><span class="rtitle">Sync<small>' + (offline ? 'Offline, showing the last saved copy' : lastSync ? 'Up to date as of ' + new Date(lastSync).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : 'Not synced yet') + '</small></span><button class="action" id="syncNow">Sync now</button></div>' +
      '<div class="row"><span class="rtitle">Updates<small id="updState">' + (updateReady ? 'A new version is ready' : 'Checks automatically when you open the app') + '</small></span><button class="action" id="checkUpdate">' + (updateReady ? 'Update now' : 'Check') + '</button></div>' +
      '<div class="row"><span class="rtitle">Home screen<small>' + (standalone() ? 'Installed as an app on this device' : /iphone|ipad/i.test(navigator.userAgent) ? 'In Safari: Share → Add to Home Screen' : 'Browser menu → Install app') + '</small></span>' + (!standalone() && deferredInstall ? '<button class="action" id="installBtn">Install</button>' : '') + '</div>' +
    '</div>' +
    (token ? '<div class="formActions"><button class="ghost danger" id="lock">Lock this device</button></div>' : '') + '</div>');
}

/* ---------- Gate ---------- */
function gate() {
  return '<section class="gate"><img src="assets/logo-full.webp" alt="LittleOne"><p>Enter the family passcode once and this device stays signed in.</p><form id="gateForm"><label class="field">Family passcode<input name="passcode" type="password" required autocomplete="current-password" enterkeyhint="go"></label><p class="error" role="alert"></p><button class="primary">Open LittleOne</button></form><p class="small" style="margin-top:22px">v' + esc(VERSION.version) + '</p></section>';
}
async function unlock(form) {
  const btn = form.querySelector('.primary'), err = form.querySelector('.error');
  btn.disabled = true; err.textContent = '';
  try { token = (await call('unlock', { passcode: form.passcode.value })).token; store.set('ll-token', token); location.hash = '#home'; render(); sync(true) }
  catch (e) { err.textContent = e.message; btn.disabled = false }
}

/* ---------- Shell ---------- */
const ALIASES = { compare: 'shop', checklist: 'list' };
function route() { const h = location.hash.slice(1); const r = ALIASES[h] || h; return ['home', 'shop', 'offers', 'list', 'ideas', 'budget'].includes(r) ? r : 'home' }
function tabLinks() {
  const r = route(), cur = r === 'offers' ? 'shop' : r, n = ofKind('idea').filter(x => !x.data.filed).length;
  return TABS.map(([k, label]) => '<a href="#' + k + '"' + (cur === k ? ' aria-current="page"' : '') + '>' + ICON[k] + '<span>' + label + '</span>' + (k === 'ideas' && n ? '<b class="badge">' + n + '</b>' : '') + '</a>').join('');
}
function render() {
  stale = false; const key = route();
  document.body.classList.toggle('locked', !token); status();
  if (!token) { view.innerHTML = gate(); $('#tabbar').innerHTML = ''; $('#toptabs').innerHTML = ''; $('#fab').classList.add('hidden'); return }
  view.innerHTML = { home, shop, offers, list: checklist, ideas, budget }[key]();
  $('#tabbar').innerHTML = $('#toptabs').innerHTML = tabLinks();
  $('#fab').classList.toggle('hidden', !['shop', 'list', 'ideas'].includes(key));
  $('#fab').setAttribute('aria-label', key === 'shop' ? 'Add an option' : key === 'list' ? 'Add to the checklist' : 'New idea');
  if (key !== 'shop') document.body.classList.remove('has-compare');
  document.querySelector('.chips .active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  if (key === 'ideas') drawPending();
}
function rerenderKeep() { const y = scrollY; render(); scrollTo(0, y) }
function openDialog(label, body) { dlg.dataset.sheet = ''; $('#dialogLabel').textContent = label; $('#dialogBody').innerHTML = body; if (!dlg.open) dlg.showModal(); dlg.scrollTop = 0 }

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
  if (d.fav) { const p = byId(d.fav); patch(p.id, { fav: !p.data.fav }) }
  else if ('filter' in d) { favouritesOnly = !favouritesOnly; rerenderKeep() }
  else if (d.cat) { category = d.cat; store.set('ll-cat', category); render() }
  else if (d.offers) { specialsOnly = d.offers === 'sale'; render() }
  else if (d.compare) { selected.has(d.compare) ? selected.delete(d.compare) : selected.add(d.compare); if (dlg.open) refreshSheet(d.compare); rerenderKeep() }
  else if (d.details) detail(d.details);
  else if ('status' in d && d.id) setStatus(d.id, d.status);
  else if (d.notes) notesSheet(d.notes);
  else if (d.quickpick) { const p = byId(d.quickpick); setStatus(p.id, p.data.status === 'chosen' ? '' : 'chosen') }
  else if ('showbuy' in d) { $('#boughtForm').classList.remove('hidden'); $('#boughtForm input').focus() }
  else if (d.like) { const p = byId(d.like), l = p.data.likes || []; patch(d.like, { likes: l.includes(deviceId) ? l.filter(v => v !== deviceId) : [...l, deviceId] }) }
  else if (d.delnote) { const p = byId(d.id); patch(d.id, { notes: (p.data.notes || []).filter((_, i) => i !== Number(d.delnote)) }) }
  else if (d.tolist) ideaToList(d.tolist);
  else if (d.tooption) ideaToOption(d.tooption);
  else if (d.gocat) { category = d.gocat; store.set('ll-cat', category); favouritesOnly = false; if (dlg.open) dlg.close(); location.hash = '#shop'; render() }
  else if (d.edit) productForm(d.edit);
  else if (d.remove) { const x = byId(d.remove); if (x && confirm('Remove “' + (x.data.name || 'this idea') + '” for both of you?')) { if (dlg.open) dlg.close(); removeEntry(d.remove); rerenderKeep() } }
  else if (d.unpend) { const [p] = pending.splice(Number(d.unpend), 1); p.url && URL.revokeObjectURL(p.url); drawPending() }
  else if ('cancel' in d || b.id === 'close') dlg.close();
  else if (b.id === 'fab') { const r = route(); if (r === 'shop') productForm(); else if (r === 'list') itemForm(); else if (r === 'ideas') { scrollTo({ top: 0, behavior: 'smooth' }); $('#composer textarea')?.focus() } }
  else if (b.id === 'moreOffers') $('#offerRows').insertAdjacentHTML('beforeend', offerInputs());
  else if (b.id === 'compareBtn' && selected.size >= 2) comparison();
  else if (b.id === 'clearCompare') { selected.clear(); rerenderKeep() }
  else if (b.id === 'menu') settings();
  else if (b.id === 'syncNow') { sync(true).then(() => { if (dlg.open) settings() }) }
  else if (b.id === 'checkUpdate' || b.id === 'applyUpdate') checkForUpdate(true);
  else if (b.id === 'installBtn') { deferredInstall?.prompt(); deferredInstall = null }
  else if (b.id === 'hideInstall') { store.set('ll-install-hidden', '1'); rerenderKeep() }
  else if (b.id === 'lock') { if (confirm('Lock LittleOne on this device? You will need the passcode to open it again.')) lock() }
});
document.addEventListener('change', e => {
  const d = e.target.dataset;
  if (d.done) { const x = byId(d.done), done = e.target.checked; put({ ...x, data: { ...x.data, done } }); if (done) announce('✓ ' + x.data.name); setTimeout(rerenderKeep, done ? 350 : 0) }
  else if (e.target.id === 'pick') { addPending(e.target.files); e.target.value = '' }
});
document.addEventListener('submit', e => {
  e.preventDefault(); const form = e.target;
  if (form.id === 'gateForm') unlock(form);
  else if (form.id === 'productForm') saveProduct(form);
  else if (form.id === 'composer') saveIdea(form);
  else if (form.id === 'boughtForm') setStatus(form.dataset.id, 'bought', Number(form.paid.value) || undefined);
  else if (form.id === 'noteForm') { const t = form.note.value.trim(), p = byId(form.dataset.id); if (t && p) patch(p.id, { notes: [...(p.data.notes || []), { text: t, at: new Date().toISOString() }] }) }
  else if (form.id === 'budgetForm') { put({ id: 'settings', kind: 'settings', data: { ...(byId('settings')?.data || {}), budget: Number(form.budget.value) || 0 } }); render(); announce('Budget saved') }
  else if (form.matches('.newItem')) {
    const f = new FormData(form), name = f.get('item').trim(); if (!name) return;
    put({ id: newId(), kind: 'item', data: { group: Number(f.get('group')), name, note: f.get('note').trim(), done: false } }); dlg.close(); render(); announce('Added to the checklist');
  }
});
document.addEventListener('paste', e => {
  if (route() !== 'ideas' || !token || dlg.open) return;
  const files = [...(e.clipboardData?.files || [])]; if (!files.length) return;
  e.preventDefault(); addPending(files);
});
document.addEventListener('dragover', e => { const c = e.target.closest?.('#composer'); if (c) { e.preventDefault(); c.classList.add('drag') } });
document.addEventListener('dragleave', e => e.target.closest?.('#composer')?.classList.remove('drag'));
document.addEventListener('drop', e => { const c = e.target.closest?.('#composer'); if (!c) return; e.preventDefault(); c.classList.remove('drag'); addPending(e.dataTransfer.files) });
dlg.addEventListener('close', () => { dlg.dataset.sheet = ''; if (stale) rerenderKeep() });
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close() }); // tap the backdrop to close
addEventListener('hashchange', () => { if (dlg.open) dlg.close(); render(); scrollTo(0, 0) });
addEventListener('scroll', () => $('.appbar').classList.toggle('scrolled', scrollY > 4), { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { sync(); checkForUpdate() } });
setInterval(() => { if (!document.hidden) sync() }, 30000);

/* ---------- Install and updates ---------- */
let deferredInstall = null, updateReady = false, reg = null;
const openedAt = Date.now();
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (route() === 'home') rerenderKeep() });
function showUpdate(worker) {
  updateReady = true;
  // Straight after opening the app nothing is in progress, so update silently.
  if (Date.now() - openedAt < 8000 && !busy()) { worker.postMessage('skipWaiting'); return }
  $('#updatebar').classList.remove('hidden');
}
async function checkForUpdate(apply) {
  if (!reg) { if (apply) location.reload(); return }
  if (apply && reg.waiting) { reg.waiting.postMessage('skipWaiting'); return }
  try { await reg.update() } catch {}
  if (apply) {
    if (reg.waiting) reg.waiting.postMessage('skipWaiting');
    else if (reg.installing) announce('Downloading the update…');
    else { announce('You have the latest version (v' + VERSION.version + ')'); const s = $('#updState'); if (s) s.textContent = 'Up to date' }
  }
}
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  let reloading = false; const hadController = !!navigator.serviceWorker.controller;
  // Reload only when a new version takes over, not when the very first worker starts controlling the page.
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload() } });
  navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' }).then(r => {
    reg = r;
    if (r.waiting && navigator.serviceWorker.controller) showUpdate(r.waiting);
    r.addEventListener('updatefound', () => {
      const w = r.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w) });
    });
    setInterval(() => r.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(() => {});
}

render(); sync();
})();
