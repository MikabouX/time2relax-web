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

  let list: { url: string; name: string }[] = [], pages: string[] = [];
  try { const j = await req.json(); list = j.cartes || []; pages = j.pages || []; } catch { /* vide */ }
  const pageMiss: string[] = [];
  if (pages.includes("mega")) {   // Mega : noms de fichiers imprévisibles, on lit la page des cartes tarifaires
    try {
      const h = await (await fetch("https://www.mega.be/fr/energie/cartes-tarifaires", { headers: { "User-Agent": "Mozilla/5.0 (Time2Relax simulateur)" }, signal: AbortSignal.timeout(20000) })).text();
      const found = [...new Set([...h.matchAll(/https:\/\/my\.mega\.be\/resources\/tarif\/[A-Za-z0-9._-]+\.pdf/g)].map((m) => m[0]))];
      const REG: Record<string, string> = { BX: "Bruxelles", VL: "Flandre", WL: "Wallonie" };
      for (const u of found) {
        const f = u.split("/").pop()!.replace(/\.pdf$/, ""), p = f.split("-");   // Mega-FR-EL-B2C-WL-112026-Smart2011-Fixed
        if (p[1] !== "FR") continue;
        let prod = p.slice(6).join(" ").replace(/\d{4}/g, "").replace(/\s+/g, " ").trim();
        prod = prod.replace(/ Fix$/, " Fixed").replace(/ Green$/, "").replace(/ Var$/, "");
        if (!/Fixed|Dynamic|Impact/.test(prod)) prod += " Flex";
        list.push({ url: u, name: ["Mega", prod + (p[2] === "NG" ? " gaz" : " élec"), REG[p[4]] || p[4], p[3] === "B2B" ? "Professionnels" : "Particuliers"].join(" - ") + ".pdf" });
      }
      if (!found.length) pageMiss.push("Mega : aucune carte trouvée sur mega.be/fr/energie/cartes-tarifaires (page à vérifier)");
    } catch { pageMiss.push("Mega : page mega.be/fr/energie/cartes-tarifaires injoignable"); }
  }
  if (pages.includes("bolt")) {   // Bolt : le numéro de version des cartes variables change, on lit la page des cartes tarifaires
    try {
      const h = await (await fetch("https://www.boltenergie.be/fr/listes-des-prix", { headers: { "User-Agent": "Mozilla/5.0 (Time2Relax simulateur)" }, signal: AbortSignal.timeout(20000) })).text();
      const found = [...new Set([...h.matchAll(/https:\/\/files\.boltenergie\.be\/pricelists\/(?:var|fix)\/[a-z_]+_fr_\d+\.pdf/g)].map((m) => m[0]))];
      const P: Record<string, string> = { bolt: "Variable", online: "Online", fix: "Fixe", plenty: "Plenty", plenty_online: "Plenty Online", plenty_fix: "Plenty Fixe" };
      for (const u of found) {
        const m = u.match(/\/([a-z_]+)_(res|pro)_(el|ng)_fr_\d+\.pdf$/); if (!m) continue;
        list = list.filter((c) => !c.url.includes("files.boltenergie.be/pricelists/fix/" + m[1] + "_" + m[2] + "_" + m[3] + "_fr_"));   // pas de doublon avec la liste de la page admin
        list.push({ url: u, name: ["Bolt", (P[m[1]] || m[1]) + (m[3] === "ng" ? " gaz" : " élec"), "Toutes", m[2] === "pro" ? "Professionnels" : "Particuliers"].join(" - ") + ".pdf" });
      }
      if (!found.length) pageMiss.push("Bolt : aucune carte trouvée sur boltenergie.be/fr/listes-des-prix (page à vérifier)");
    } catch { pageMiss.push("Bolt : page boltenergie.be/fr/listes-des-prix injoignable"); }
  }
  list = list.filter((c) => { try { const u = new URL(c.url); return u.protocol === "https:" && HOSTS.includes(u.hostname); } catch { return false; } }).slice(0, 250);
  if (!list.length && !pageMiss.length) return new Response("aucune carte", { status: 400, headers: CORS });

  const files: { name: string; data: Uint8Array }[] = [], miss: string[] = [...pageMiss];
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
  await Promise.all(Array.from({ length: 8 }, worker));
  if (miss.length) files.push({ name: "_manquantes.txt", data: new TextEncoder().encode("Cartes introuvables (adresse à corriger) :\n" + miss.join("\n") + "\n") });
  files.sort((a, b) => a.name.localeCompare(b.name));
  return new Response(zip(files), { headers: { ...CORS, "Content-Type": "application/zip", "x-cartes-ok": String(files.length - (miss.length ? 1 : 0)), "x-cartes-manquantes": String(miss.length) } });
});
