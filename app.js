/* The Little List: shared baby planner.
   Everything is an "entry" ({id, kind, data}) stored through one small API:
   kind 'item' = checklist row, 'product' = something to compare, 'idea' = note/photo. */
(() => {
const API = (window.LL_CONFIG || {}).api || 'api';
const groupNames = ['Before birth', 'Research now', 'Wait and see', 'Later in year one'];
const tones = ['#e6ebdf', '#e5e9e5', '#ede7de'];

const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {} }
};
let token = store.get('ll-token'), me = store.get('ll-name') || '';
let entries = [], urls = {};
try { const c = JSON.parse(store.get('ll-cache')); if (c) { entries = c.entries || []; urls = c.urls || {} } } catch {}
const selected = new Set();
let favouritesOnly = false, specialsOnly = false, category = 'all', pending = [], stale = false, lastSync = 0, offline = false;

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

function announce(msg) { const n = $('#notice'); n.textContent = msg; clearTimeout(announce.timer); announce.timer = setTimeout(() => n.textContent = '', 4300) }

/* ---------- API ---------- */
async function call(action, body, raw) {
  let res;
  try {
    res = await fetch(API + '?action=' + action, {
      method: 'POST',
      headers: { 'Content-Type': raw ? raw.type : 'application/json', ...(token ? { 'x-ll-token': token } : {}), 'x-ll-name': encodeURIComponent(me) },
      body: raw || JSON.stringify(body || {})
    });
  } catch { offline = true; status(); throw Error('Could not reach the planner. Check your connection.') }
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
  $('#sync').textContent = !token ? '' : offline ? 'Offline. Showing the last saved copy.' : lastSync ? 'Synced ' + new Date(lastSync).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '';
  $('#lock').classList.toggle('hidden', !token);
}
// Optimistic write: update the screen first, then save; re-sync if saving fails.
async function put(entry) {
  const now = new Date().toISOString(), old = byId(entry.id);
  const local = { created_by: me, created_at: now, ...old, ...entry, updated_by: me, updated_at: now };
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
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .85));
    return blob || file;
  } catch { return file }
}
async function uploadFile(file) {
  const blob = await prepare(file);
  const out = await call('upload', null, blob.type ? blob : new Blob([blob], { type: 'application/octet-stream' }));
  urls[out.path] = out.url;
  return { path: out.path, name: file.name || 'Pasted image', type: out.type, size: out.size };
}

/* ---------- Compare ---------- */
const products = () => ofKind('product');
const photoOf = p => p.data.photo ? urls[p.data.photo] : p.data.image;
const title = p => [p.data.brand, p.data.name].filter(Boolean).join(' ');
const lowest = p => [...(p.data.offers || [])].sort((a, b) => a.price - b.price)[0];
function imageTag(p, cls = '') {
  const src = photoOf(p);
  return src ? '<img class="' + cls + '" src="' + esc(src) + '" alt="' + esc(title(p)) + '" loading="lazy">' : '<span class="noPhoto ' + cls + '" aria-hidden="true">' + esc((p.data.name || '?')[0].toUpperCase()) + '</span>';
}
function card(p, i) {
  const d = p.data, o = lowest(p), fav = !!d.fav, save = o && o.old > o.price;
  return '<article class="card"><div class="photo" style="--tone:' + tones[i % 3] + '">' + imageTag(p) + (save ? '<span class="sale">Save ' + money(o.old - o.price) + '</span>' : '') +
    '<button class="fav ' + (fav ? 'on' : '') + '" aria-label="Shortlist ' + esc(d.name) + '" aria-pressed="' + fav + '" data-fav="' + esc(p.id) + '">' + (fav ? '♥' : '♡') + '</button></div><div class="cardBody">' +
    (category === 'all' && categories().length > 1 && d.category ? '<span class="catTag">' + esc(d.category) + '</span>' : '') +
    '<span class="brand">' + esc(d.brand) + '</span><h3>' + esc(d.name) + '</h3><p>' + esc(d.feature) + '</p><div class="priceline">' +
    (o ? '<span class="price">' + money(o.price) + '</span>' + (save ? '<del>' + money(o.old) + '</del>' : '') : '<span class="small">No price yet</span>') +
    '</div><div class="cardActions"><label class="checkLabel"><input type="checkbox" data-compare="' + esc(p.id) + '" ' + (selected.has(p.id) ? 'checked' : '') + '>Compare</label><button class="textbtn" data-details="' + esc(p.id) + '">Specs &amp; prices ↗</button></div></div></article>';
}
function categories() { return [...new Set(products().map(p => p.data.category).filter(Boolean))].sort() }
function compare() {
  const cats = categories(); if (category !== 'all' && !cats.includes(category)) category = 'all';
  const all = products(), favs = all.filter(p => p.data.fav).length;
  const chosen = all.filter(p => (category === 'all' || p.data.category === category) && (!favouritesOnly || p.data.fav))
    .sort((a, b) => (a.data.category || '').localeCompare(b.data.category || ''));
  return '<section class="section"><div class="sectionHead"><div><h2>' + esc(category === 'all' ? (cats.length === 1 ? cats[0] : 'The big purchases') : category) + '</h2><p>Compare the options side by side, with the price at each shop.</p></div><div class="controls">' +
    (cats.length > 1 ? '<button data-cat="all" class="' + (category === 'all' ? 'active' : '') + '">Everything</button>' + cats.map(c => '<button data-cat="' + esc(c) + '" class="' + (category === c ? 'active' : '') + '">' + esc(c) + '</button>').join('') : '') +
    '<button data-filter="saved" aria-pressed="' + favouritesOnly + '" class="' + (favouritesOnly ? 'active' : '') + '">♡ Shortlist (' + favs + ')</button><button class="primary" id="addProduct">+ Add an option</button></div></div><div class="grid">' +
    chosen.map((p, i) => card(p, i)).join('') + '</div>' +
    (!chosen.length ? '<p class="empty">' + (favouritesOnly ? 'Tap the heart on an option to add it to your shortlist.' : 'Nothing here yet. Add the first option to compare.') + '</p>' : '') +
    '<div class="comparebar"><span id="count"></span><button id="compareBtn" class="primary">Compare side by side →</button></div></section>';
}
function counter() {
  const b = $('#compareBtn'); if (!b) return;
  for (const id of [...selected]) if (!byId(id)) selected.delete(id);
  b.disabled = selected.size < 2;
  $('#count').textContent = selected.size ? selected.size + ' option' + (selected.size === 1 ? '' : 's') + ' selected' : 'Select at least two options';
}
function offerRow(p, o, thumb = true) {
  const save = o.old > o.price;
  return '<div class="offerRow">' + (thumb ? imageTag(p, 'thumb') : '') + '<div class="info"><strong>' + esc(thumb ? title(p) : o.shop) + '</strong><small>' + (thumb ? esc(o.shop) : 'Retailer listing') + (save ? ' · Save ' + money(o.old - o.price) : '') + '</small></div><div class="priceCell"><span class="price">' + money(o.price) + '</span>' + (save ? '<del>' + money(o.old) + '</del>' : '') + '</div>' + link(o.link, 'Visit shop') + '</div>';
}
function offers() {
  const list = products().flatMap(p => (p.data.offers || []).map(o => [p, o])).filter(([, o]) => !specialsOnly || o.old > o.price).sort((a, b) => a[1].price - b[1].price);
  return '<section class="section"><div class="sectionHead"><div><h2>Retailer offers</h2><p>Every shop price we have saved, cheapest first. Delivery and accessories may cost extra.</p></div><div class="controls"><button data-offers="all" class="' + (!specialsOnly ? 'active' : '') + '">All offers</button><button data-offers="sale" class="' + (specialsOnly ? 'active' : '') + '">Specials only</button></div></div>' +
    (list.length ? list.map(([p, o]) => offerRow(p, o)).join('') : '<p class="empty">No offers to show yet.</p>') +
    '<p class="hint">A special shows the shop’s advertised previous price. Open the listing to confirm today’s price, colour and stock.</p></section>';
}
function detail(id) {
  const p = byId(id); if (!p) return; const d = p.data, specs = Object.entries(d.specs || {});
  openDialog(title(p), '<p>' + esc(d.feature) + '</p>' + (specs.length ? '<dl>' + specs.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>' : '') +
    link(d.source, 'Product page') + '<h3 style="margin-top:23px">Shop prices</h3>' +
    ((d.offers || []).length ? d.offers.map(o => offerRow(p, o, false)).join('') : '<p class="small">No shop prices saved yet.</p>') +
    '<p class="hint">' + (d.checked ? 'Prices checked ' + longDate(d.checked) + '. ' : '') + 'Confirm the local model and required accessories with the shop.' + (p.created_by && p.created_by !== 'starter' ? ' Added by ' + esc(p.created_by) + '.' : '') + '</p>' +
    '<div class="formActions"><button class="ghost" data-edit="' + esc(p.id) + '">Edit</button><button class="ghost danger" data-remove="' + esc(p.id) + '">Remove</button></div>');
}
function comparison() {
  const ps = products().filter(p => selected.has(p.id));
  const keys = [...new Set(ps.flatMap(p => Object.keys(p.data.specs || {})))];
  const row = (label, field) => '<tr><th scope="row">' + esc(label) + '</th>' + ps.map(p => '<td>' + field(p) + '</td>').join('') + '</tr>';
  openDialog('Side-by-side comparison', '<div class="tableWrap" tabindex="0" aria-label="Comparison, scroll sideways on a phone"><table class="comparison"><thead><tr><th scope="col">Option</th>' + ps.map(p => '<th scope="col">' + esc(title(p)) + '</th>').join('') + '</tr></thead><tbody>' +
    row('Lowest listed price', p => lowest(p) ? money(lowest(p).price) : '–') + keys.map(k => row(k, p => esc(p.data.specs?.[k] ?? '–'))).join('') +
    row('Notes', p => esc(p.data.feature)) +
    row('Retailers', p => (p.data.offers || []).map(o => safeUrl(o.link) ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(o.link) + '">' + esc(o.shop) + ' · ' + money(o.price) + '</a>' : esc(o.shop) + ' · ' + money(o.price)).join('<br>') || '–') +
    '</tbody></table></div>' + (ps.every(p => /pram/i.test(p.data.category || '')) ? '<p class="callout">In-store check: have each of you fold and lift the pram into the RAV4. Check the boot space left for groceries.</p>' : ''));
}
function offerInputs(o = {}) {
  return '<div class="offerInputs"><input name="shop" placeholder="Shop" aria-label="Shop" value="' + esc(o.shop) + '"><input name="price" type="number" min="0" step="0.01" placeholder="Price (R)" aria-label="Price in rand" value="' + esc(o.price) + '"><input name="old" type="number" min="0" step="0.01" placeholder="Was (R)" aria-label="Previous price in rand" value="' + esc(o.old) + '"><input name="link" type="url" placeholder="Link to listing" aria-label="Link to listing" value="' + esc(o.link) + '"></div>';
}
function productForm(id) {
  const p = id ? byId(id) : null, d = p?.data || {};
  const specs = Object.entries(d.specs || {}).map(([k, v]) => k + ': ' + v).join('\n');
  openDialog(p ? 'Edit ' + title(p) : 'Add an option to compare', '<form id="productForm" data-id="' + esc(id || '') + '"><div class="formGrid">' +
    '<label class="field">Name<input name="name" required maxlength="80" value="' + esc(d.name) + '"></label>' +
    '<label class="field">Brand<input name="brand" maxlength="60" value="' + esc(d.brand) + '"></label>' +
    '<label class="field wide">Category<input name="category" list="catList" maxlength="40" placeholder="e.g. Car seats, Cots, Monitors" value="' + esc(d.category ?? (category === 'all' ? '' : category)) + '"><datalist id="catList">' + categories().map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></label>' +
    '<label class="field wide">What stands out<textarea name="feature" maxlength="600">' + esc(d.feature) + '</textarea></label>' +
    '<label class="field wide">Specs <small>One per line, like “Weight: 11 kg”. Matching labels line up in the comparison.</small><textarea name="specs" rows="4">' + esc(specs) + '</textarea></label>' +
    '<div class="field wide">Shop prices<div id="offerRows">' + [...(d.offers || []), {}].map(offerInputs).join('') + '</div><div><button type="button" class="textbtn" id="moreOffers">+ Another shop</button></div></div>' +
    '<label class="field">Product page link<input name="source" type="url" value="' + esc(d.source) + '"></label>' +
    '<label class="field">Photo <small>' + (photoOf(p || { data: {} }) ? 'Choose a file to replace the current photo.' : 'Optional.') + '</small><input name="photo" type="file" accept="image/*"></label>' +
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
  const data = { ...(old?.data || { fav: false }), name: f.get('name').trim(), brand: f.get('brand').trim(), category: f.get('category').trim() || 'Other', feature: f.get('feature').trim(), specs, offers: offerList, source: f.get('source').trim(), checked: new Date().toISOString().slice(0, 10) };
  btn.disabled = true; err.textContent = '';
  try {
    const file = f.get('photo');
    if (file && file.size) { data.photo = (await uploadFile(file)).path; delete data.image }
    dlg.close(); await put({ id: old?.id || newId(), kind: 'product', data }); render(); announce(old ? 'Saved' : 'Added to compare');
  } catch (e) { err.textContent = e.message; btn.disabled = false }
}

/* ---------- Checklist ---------- */
function checklist() {
  const items = ofKind('item');
  return '<section class="section"><div class="sectionHead"><div><h2>Our baby checklist</h2><p>Tick items you have bought, borrowed or received. Add anything your family still needs.</p></div><strong>' + items.filter(x => x.data.done).length + ' of ' + items.length + ' ready</strong></div>' +
    groupNames.map((g, i) => '<div class="listgroup"><h3>' + g + '</h3>' + items.filter(x => x.data.group === i).map(x => '<div class="listRow ' + (x.data.done ? 'done' : '') + '"><input type="checkbox" id="c-' + esc(x.id) + '" data-done="' + esc(x.id) + '" ' + (x.data.done ? 'checked' : '') + '><span><label for="c-' + esc(x.id) + '"><strong>' + esc(x.data.name) + '</strong></label><small>' + esc(x.data.note) + (x.data.done && x.data.doneBy ? (x.data.note ? ' · ' : '') + 'Ticked by ' + esc(x.data.doneBy) : '') + '</small></span><button class="rowDel" data-remove="' + esc(x.id) + '" aria-label="Remove ' + esc(x.data.name) + '">×</button></div>').join('') + '</div>').join('') +
    '<form class="newItem"><input name="item" aria-label="New item name" placeholder="Add an item to your list" maxlength="90" required><input name="note" aria-label="Note" placeholder="Note (optional)" maxlength="200"><select name="group" aria-label="When needed">' + groupNames.map((g, i) => '<option value="' + i + '">' + g + '</option>').join('') + '</select><button class="primary">Add item</button></form><p class="hint">Shared between both of you and saved automatically. &nbsp; <a href="https://www.nhs.uk/best-start-in-life/pregnancy/preparing-for-labour-and-birth/what-to-buy-for-your-newborn-baby/" target="_blank" rel="noopener">Newborn essentials guide ↗</a></p></section>';
}

/* ---------- Ideas ---------- */
const linkify = t => esc(t).replace(/https?:\/\/[^\s<]+/g, u => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>');
function ideas() {
  const list = ofKind('idea').sort((a, b) => b.created_at.localeCompare(a.created_at));
  return '<section class="section"><div class="sectionHead"><div><h2>Ideas</h2><p>Drop in anything worth remembering: a screenshot, a photo from a shop, a link or a note.</p></div></div>' +
    '<form class="composer" id="composer"><textarea name="text" rows="3" maxlength="5000" aria-label="Idea" placeholder="Type or paste a note, a link or a photo…"></textarea><div class="thumbs" id="thumbs"></div><div class="composerBar"><label class="ghost" style="cursor:pointer">Add photos or files<input type="file" id="pick" accept="image/*,application/pdf,text/plain" multiple hidden></label><span class="small">You can also paste or drag photos in.</span><button class="primary">Save idea</button></div><p class="error" role="alert"></p></form>' +
    (list.length ? '<div class="ideas">' + list.map(x => {
      const files = x.data.files || [], pics = files.filter(f => f.type.startsWith('image/') && urls[f.path]), docs = files.filter(f => !pics.includes(f));
      return '<article class="idea">' + (pics.length ? '<div class="ideaPics">' + pics.map(f => '<a href="' + esc(urls[f.path]) + '" target="_blank" rel="noopener"><img src="' + esc(urls[f.path]) + '" alt="' + esc(f.name) + '" loading="lazy"></a>').join('') + '</div>' : '') +
        (x.data.text ? '<p>' + linkify(x.data.text) + '</p>' : '') +
        docs.map(f => urls[f.path] ? link(urls[f.path], f.name) : '<span class="small">' + esc(f.name) + '</span>').join('') +
        '<div class="ideaMeta"><span>' + esc(x.created_by || '') + ' · ' + when(x.created_at) + '</span><button class="textbtn" data-remove="' + esc(x.id) + '">Remove</button></div></article>';
    }).join('') + '</div>' : '<p class="empty" style="margin-top:22px">No ideas yet. The first one is yours.</p>') + '</section>';
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
  } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Save idea' }
}

/* ---------- Gate ---------- */
function gate() {
  return '<section class="gate"><h2>Welcome</h2><p>This planner is just for the two of us. Enter the family passcode to open it on this device.</p><form id="gateForm"><label class="field">Your name<input name="name" required maxlength="30" autocomplete="given-name" value="' + esc(me) + '"></label><label class="field">Family passcode<input name="passcode" type="password" required autocomplete="current-password"></label><p class="error" role="alert"></p><button class="primary">Open our planner</button></form></section>';
}
async function unlock(form) {
  const btn = form.querySelector('.primary'), err = form.querySelector('.error');
  me = form.name.value.trim(); store.set('ll-name', me); btn.disabled = true; err.textContent = '';
  try { token = (await call('unlock', { passcode: form.passcode.value })).token; store.set('ll-token', token); render(); sync(true) }
  catch (e) { err.textContent = e.message; btn.disabled = false }
}

/* ---------- Shell ---------- */
function route() { const h = location.hash.slice(1); return ['offers', 'checklist', 'ideas'].includes(h) ? h : 'compare' }
function render() {
  stale = false; const key = route();
  $('#nav').classList.toggle('hidden', !token); status();
  if (!token) { $('.banner').classList.add('hidden'); view.innerHTML = gate(); return }
  view.innerHTML = key === 'offers' ? offers() : key === 'checklist' ? checklist() : key === 'ideas' ? ideas() : compare();
  document.querySelectorAll('nav a').forEach(a => { if (a.hash === '#' + key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current') });
  $('.banner').classList.toggle('hidden', key !== 'compare'); counter(); if (key === 'ideas') drawPending();
}
function openDialog(label, body) { $('#dialogLabel').textContent = label; $('#dialogBody').innerHTML = body; if (!dlg.open) dlg.showModal() }
function rerenderFocused(selector) { render(); document.querySelector(selector)?.focus({ preventScroll: true }) }
const sel = (attr, v) => '[' + attr + '="' + CSS.escape(v) + '"]';

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
  if (d.fav) { const p = byId(d.fav); put({ ...p, data: { ...p.data, fav: !p.data.fav } }); rerenderFocused(sel('data-fav', d.fav)) }
  else if (d.filter) { favouritesOnly = !favouritesOnly; rerenderFocused('[data-filter]') }
  else if (d.cat) { category = d.cat; rerenderFocused(sel('data-cat', d.cat)) }
  else if (d.offers) { specialsOnly = d.offers === 'sale'; rerenderFocused(sel('data-offers', d.offers)) }
  else if (d.details) detail(d.details);
  else if (d.edit) productForm(d.edit);
  else if (d.remove) { const x = byId(d.remove); if (x && confirm('Remove “' + (x.data.name || 'this idea') + '” for both of you?')) { if (dlg.open) dlg.close(); removeEntry(d.remove); render() } }
  else if (d.unpend) { const [p] = pending.splice(Number(d.unpend), 1); p.url && URL.revokeObjectURL(p.url); drawPending() }
  else if ('cancel' in d || b.id === 'close') dlg.close();
  else if (b.id === 'addProduct') productForm();
  else if (b.id === 'moreOffers') $('#offerRows').insertAdjacentHTML('beforeend', offerInputs());
  else if (b.id === 'compareBtn' && selected.size >= 2) comparison();
  else if (b.id === 'lock') { if (confirm('Lock the planner on this device? You will need the passcode to open it again.')) lock() }
});
document.addEventListener('change', e => {
  const d = e.target.dataset;
  if (d.compare) { if (e.target.checked) selected.add(d.compare); else selected.delete(d.compare); counter() }
  else if (d.done) { const x = byId(d.done), done = e.target.checked; put({ ...x, data: { ...x.data, done, doneBy: done ? me : undefined } }); rerenderFocused(sel('data-done', d.done)) }
  else if (e.target.id === 'pick') { addPending(e.target.files); e.target.value = '' }
});
document.addEventListener('submit', e => {
  e.preventDefault(); const form = e.target;
  if (form.id === 'gateForm') unlock(form);
  else if (form.id === 'productForm') saveProduct(form);
  else if (form.id === 'composer') saveIdea(form);
  else if (form.matches('.newItem')) {
    const f = new FormData(form), name = f.get('item').trim(); if (!name) return;
    put({ id: newId(), kind: 'item', data: { group: Number(f.get('group')), name, note: f.get('note').trim(), done: false } }); render(); announce('Added to your checklist');
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
dlg.addEventListener('close', () => { if (stale) render() });
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0) });
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync() });
setInterval(() => { if (!document.hidden) sync() }, 30000);
render(); sync();
})();
