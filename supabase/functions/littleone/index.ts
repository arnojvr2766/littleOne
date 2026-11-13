// The Little List API. One function, action chosen by ?action=.
// Auth: a shared family passcode (LITTLEONE_PASSCODE secret) is exchanged for
// a signed token that the browser keeps. All data access uses the service role.
import { createClient } from "npm:@supabase/supabase-js@2";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PASSCODE = (Deno.env.get("LITTLEONE_PASSCODE") ?? "").trim();
const db = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = "littleone";
const TOKEN_DAYS = 400;
const MAX_UPLOAD = 10 * 1024 * 1024;
const FILE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf", "text/plain": "txt",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-ll-token, x-ll-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function hmac(message: string) {
  // Key depends on the passcode, so changing the passcode signs everyone out.
  const key = await crypto.subtle.importKey("raw", enc.encode(SERVICE_KEY + "|" + PASSCODE), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function makeToken() {
  const exp = String(Date.now() + TOKEN_DAYS * 86400_000);
  return exp + "." + (await hmac("token:" + exp));
}
async function validToken(token: string | null) {
  if (!token || !PASSCODE) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return same(sig, await hmac("token:" + exp));
}

// ---- Daily price check ----
// Called by a scheduled database job, without the passcode. That is safe because it
// reads nothing back out: it only re-reads prices from the shops below, at most once
// every 30 minutes, and replies with counts.
// Only these shops are fetched, so a pasted link can never point the server elsewhere.
const WATCH_HOSTS = new Set(["www.preciouscargo.co.za", "preciouscargo.co.za", "www.noola.co.za", "noola.co.za", "www.chelino.co.za", "chelino.co.za", "mopani.co.za", "www.ormsdirect.co.za"]);
const UA = "Mozilla/5.0 (compatible; TheLittleList-PriceCheck/1.0; personal baby planner)";
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return n > 0 ? n : 0; };
function metaContent(html: string, prop: string) {
  const i = html.indexOf(prop);
  if (i < 0) return "";
  const tag = html.slice(Math.max(0, html.lastIndexOf("<", i)), html.indexOf(">", i) + 1);
  return (tag.match(/content=["']([^"']+)/) || [])[1] ?? "";
}
function readPage(html: string) {
  let price = num(metaContent(html, "og:price:amount")) || num(metaContent(html, "product:price:amount"));
  const avail: string[] = [];
  let at = 0;
  while ((at = html.indexOf("application/ld+json", at)) >= 0) {
    const start = html.indexOf(">", at) + 1, end = html.indexOf("</script>", start);
    at = end < 0 ? html.length : end;
    const raw = end < 0 ? "" : html.slice(start, end);
    if (!raw.includes("Product")) continue;
    try {
      const parsed = JSON.parse(raw);
      for (const node of [].concat(parsed["@graph"] ?? parsed) as any[]) {
        if (!String(node?.["@type"]).includes("Product")) continue;
        for (const o of [].concat(node.offers ?? []).flatMap((x: any) => x.offers ?? [x]) as any[]) {
          if (!price) price = num(o.price);
          if (o.availability) avail.push(String(o.availability));
        }
      }
    } catch { /* ignore malformed blocks */ }
  }
  const stock = avail.some((a) => a.includes("InStock")) ? "in" : avail.length ? "out" : "";
  return { price, stock };
}
async function pricewatch(req: Request) {
  const { limit = 12 } = await req.json().catch(() => ({}));
  const { data: last } = await db.from("ll_entries").select("updated_at").eq("id", "pricewatch").maybeSingle();
  if (last && Date.now() - new Date(last.updated_at).getTime() < 30 * 60_000) return json({ error: "Checked recently. Try again later." }, 429);
  const stamp = { id: "pricewatch", kind: "system", data: {}, updated_at: new Date().toISOString(), updated_by: "pricewatch" };
  const { error: sErr } = await db.from("ll_entries").upsert(stamp);
  if (sErr) throw sErr;
  const { data, error } = await db.from("ll_entries").select("id, data").eq("kind", "product").is("deleted_at", null);
  if (error) throw error;
  const today = new Date().toISOString().slice(0, 10);
  const watchable = (o: any) => { try { const u = new URL(o.link); return u.protocol === "https:" && WATCH_HOSTS.has(u.hostname); } catch { return false; } };
  const due = data.filter((e) => (e.data.offers ?? []).some(watchable))
    .sort((a, b) => String(a.data.watchedAt ?? "").localeCompare(String(b.data.watchedAt ?? ""))).slice(0, Math.min(Number(limit) || 12, 40));
  const report: any[] = [];
  for (const e of due) {
    const d = e.data, seen: string[] = [];
    let anyIn = false, checked = 0;
    for (const o of d.offers) {
      if (!watchable(o)) continue;
      try {
        const res = await fetch(o.link, { headers: { "User-Agent": UA, "Accept-Language": "en-ZA,en" }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) { report.push({ id: e.id, shop: o.shop, error: res.status }); continue; }
        const { price, stock } = readPage(await res.text());
        if (!price) { report.push({ id: e.id, shop: o.shop, error: "no price found" }); continue; }
        checked++;
        if (price < o.price) { o.dropFrom = Math.max(o.dropFrom ?? 0, o.price); o.dropAt = today; }
        else if (price > o.price) { delete o.dropFrom; delete o.dropAt; }
        if (price !== o.price) report.push({ id: e.id, shop: o.shop, was: o.price, now: price });
        o.price = price;
        if (o.old && o.old <= price) delete o.old;
        if (stock) { o.stock = stock; anyIn ||= stock === "in"; seen.push((stock === "in" ? "In stock at " : "Out of stock at ") + o.shop); }
      } catch (err) { report.push({ id: e.id, shop: o.shop, error: String(err).slice(0, 80) }); }
    }
    d.watchedAt = new Date().toISOString();
    if (checked) {
      d.checked = today;
      if (seen.length) { d.stock = anyIn ? "in" : "out"; d.specs = { ...(d.specs ?? {}), Availability: seen.join(". ") + ". Checked automatically." }; }
    }
    const { error: uErr } = await db.from("ll_entries").update({ data: d, updated_by: "pricewatch" }).eq("id", e.id);
    if (uErr) throw uErr;
  }
  console.log("pricewatch", JSON.stringify(report));
  return json({ checked: due.length, changed: report.filter((r) => r.now).length, failed: report.filter((r) => r.error).length });
}

async function unlock(req: Request) {
  if (!PASSCODE) return json({ error: "The family passcode has not been set up yet." }, 503);
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const ipHash = await hmac("ip:" + ip);
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await db.from("ll_auth_failures").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("at", since);
  if ((count ?? 0) >= 8) return json({ error: "Too many wrong tries. Wait 15 minutes and try again." }, 429);
  const { passcode } = await req.json().catch(() => ({}));
  const ok = typeof passcode === "string" && same(await hmac("pc:" + passcode.trim()), await hmac("pc:" + PASSCODE));
  if (!ok) {
    await db.from("ll_auth_failures").insert({ ip_hash: ipHash });
    return json({ error: "That passcode is not right." }, 401);
  }
  return json({ token: await makeToken() });
}

function filePaths(data: any): string[] {
  const out: string[] = [];
  if (typeof data?.photo === "string") out.push(data.photo);
  if (Array.isArray(data?.files)) for (const f of data.files) if (typeof f?.path === "string") out.push(f.path);
  return out;
}

async function list() {
  const { data, error } = await db.from("ll_entries")
    .select("id, kind, data, created_by, updated_by, created_at, updated_at")
    .is("deleted_at", null).order("created_at");
  if (error) throw error;
  const paths = [...new Set(data.flatMap((e) => filePaths(e.data)))];
  const urls: Record<string, string> = {};
  if (paths.length) {
    const { data: signed, error: sErr } = await db.storage.from(BUCKET).createSignedUrls(paths, 7 * 86400);
    if (sErr) throw sErr;
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }
  return json({ entries: data, urls });
}

async function save(req: Request, name: string) {
  const { entry } = await req.json().catch(() => ({}));
  const { id, kind, data } = entry ?? {};
  if (typeof id !== "string" || !/^[\w-]{1,64}$/.test(id)) return json({ error: "Bad id" }, 400);
  if (typeof kind !== "string" || !/^[a-z]{1,20}$/.test(kind)) return json({ error: "Bad kind" }, 400);
  if (!data || typeof data !== "object" || Array.isArray(data) || JSON.stringify(data).length > 60_000) return json({ error: "Bad data" }, 400);
  const cols = "id, kind, data, created_by, updated_by, created_at, updated_at";
  const now = new Date().toISOString();
  const upd = await db.from("ll_entries").update({ kind, data, updated_by: name, updated_at: now, deleted_at: null }).eq("id", id).select(cols);
  if (upd.error) throw upd.error;
  if (upd.data.length) return json({ entry: upd.data[0] });
  const ins = await db.from("ll_entries").insert({ id, kind, data, created_by: name, updated_by: name }).select(cols).single();
  if (ins.error) throw ins.error;
  return json({ entry: ins.data });
}

async function remove(req: Request, name: string) {
  const { id } = await req.json().catch(() => ({}));
  if (typeof id !== "string") return json({ error: "Bad id" }, 400);
  const { error } = await db.from("ll_entries").update({ deleted_at: new Date().toISOString(), updated_by: name }).eq("id", id);
  if (error) throw error;
  return json({ ok: true });
}

async function upload(req: Request) {
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = FILE_TYPES[type];
  if (!ext) return json({ error: "That file type is not supported. Use a photo, a PDF or a text file." }, 415);
  const body = await req.arrayBuffer();
  if (!body.byteLength || body.byteLength > MAX_UPLOAD) return json({ error: "That file is too large (10 MB limit)." }, 413);
  const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, body, { contentType: type });
  if (error) throw error;
  const { data: signed, error: sErr } = await db.storage.from(BUCKET).createSignedUrl(path, 7 * 86400);
  if (sErr) throw sErr;
  return json({ path, url: signed.signedUrl, type, size: body.byteLength });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const action = new URL(req.url).searchParams.get("action");
  try {
    if (action === "unlock") return await unlock(req);
    if (action === "pricewatch") return await pricewatch(req);
    if (!(await validToken(req.headers.get("x-ll-token")))) return json({ error: "Locked" }, 401);
    const name = decodeURIComponent(req.headers.get("x-ll-name") ?? "").slice(0, 40) || "Someone";
    if (action === "list") return await list();
    if (action === "save") return await save(req, name);
    if (action === "delete") return await remove(req, name);
    if (action === "upload") return await upload(req);
    return json({ error: "Unknown action" }, 404);
  } catch (err) {
    console.error(action, err);
    return json({ error: "Something went wrong on the server." }, 500);
  }
});
