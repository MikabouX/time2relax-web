// Cartes tarifaires de la concurrence : récupère les PDF publics des fournisseurs et les renvoie en un seul ZIP.
// Réservé aux administrateurs (t2r_is_admin). Seuls les sites des fournisseurs listés ci-dessous sont acceptés.
const HOSTS = ["totalenergies.be", "cdn.eneco.be", "files.boltenergie.be", "files.octaplus.be", "www.luminus.be", "luminus.be", "my.mega.be"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-cartes-ok, x-cartes-manquantes",
};

// CRC-32 pour le format ZIP
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(b: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// ZIP sans compression (les PDF sont déjà compressés)
function zip(files: { name: string; data: Uint8Array }[]) {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  for (const f of files) {
    const n = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true);
    h.setUint16(26, n.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), n, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true);
    c.setUint16(28, n.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), n);
    off += 30 + n.length + sz;
  }
  const cs = central.reduce((t, x) => t + x.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: "application/zip" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const auth = req.headers.get("Authorization") || "";
  const adm = await fetch(url + "/rest/v1/rpc/t2r_is_admin", { method: "POST", headers: { apikey: anon, Authorization: auth, "Content-Type": "application/json" }, body: "{}" });
  if (!adm.ok || (await adm.json()) !== true) return new Response("réservé aux administrateurs", { status: 403, headers: CORS });

  let list: { url: string; name: string }[] = [];
  try { list = (await req.json()).cartes || []; } catch { /* vide */ }
  list = list.filter((c) => { try { const u = new URL(c.url); return u.protocol === "https:" && HOSTS.includes(u.hostname); } catch { return false; } }).slice(0, 150);
  if (!list.length) return new Response("aucune carte", { status: 400, headers: CORS });

  const files: { name: string; data: Uint8Array }[] = [], miss: string[] = [];
  let i = 0;
  async function worker() {
    while (i < list.length) {
      const c = list[i++];
      try {
        const r = await fetch(c.url, { headers: { "User-Agent": "Mozilla/5.0 (Time2Relax simulateur)" }, signal: AbortSignal.timeout(20000) });
        const b = new Uint8Array(await r.arrayBuffer());
        if (r.ok && b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) files.push({ name: c.name.replace(/[\\/:*?"<>|]/g, "-"), data: b });
        else miss.push(c.name);
      } catch { miss.push(c.name); }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  if (miss.length) files.push({ name: "_manquantes.txt", data: new TextEncoder().encode("Cartes introuvables (adresse à corriger) :\n" + miss.join("\n") + "\n") });
  files.sort((a, b) => a.name.localeCompare(b.name));
  return new Response(zip(files), { headers: { ...CORS, "Content-Type": "application/zip", "x-cartes-ok": String(files.length - (miss.length ? 1 : 0)), "x-cartes-manquantes": String(miss.length) } });
});
