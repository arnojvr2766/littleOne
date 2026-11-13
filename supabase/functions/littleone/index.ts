// The Little List API. One function, action chosen by ?action=.
// Auth: a shared family passcode (LITTLEONE_PASSCODE secret) is exchanged for
// a signed token that the browser keeps. All data access uses the service role.
import { createClient } from "npm:@supabase/supabase-js@2";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PASSCODE = (Deno.env.get("LITTLEONE_PASSCODE") ?? "").trim();
const db = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = "littleone";
const TOKEN_DAYS = 90;
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
