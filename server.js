/* ============================================================
   RaePOS License Server — zero dependencies (Node.js built-ins)
   - Serves the POS app + admin panel
   - Activation codes (trial / subscription / lifetime)
   - Heartbeat monitoring: who is accessing, last seen
   - Revocation & expiry enforcement
   Run:  node server.js   (http://localhost:3000, admin at /admin)
   ============================================================ */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "licenses.json");

/* ---------- storage with self-healing auto-restore ---------- */
const FRESH_DB = () => ({ adminPassword: process.env.ADMIN_PASSWORD || "admin123", codes: [] });

function tryRestoreFromSnapshot(reason){
  // returns restored db or null
  try{
    const files = fs.readdirSync(backupDir()).filter(f => f.startsWith("backup-")).sort().reverse();
    for (const f of files){
      try{
        const snap = JSON.parse(fs.readFileSync(path.join(backupDir(), f), "utf8"));
        if (snap && snap.db && Array.isArray(snap.db.codes) && snap.db.codes.length){
          console.error("[SELF-HEAL] " + reason + " -> restoring from snapshot: " + f);
          fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(DATA_FILE, JSON.stringify(snap.db, null, 2));
          Object.entries(snap.sales || {}).forEach(([id, arr]) => fs.writeFileSync(salesFile(id), JSON.stringify(arr)));
          Object.entries(snap.orders || {}).forEach(([id, arr]) => fs.writeFileSync(ordersFile(id), JSON.stringify(arr)));
          return Object.assign(FRESH_DB(), snap.db);
        }
      }catch(e){ /* try next snapshot */ }
    }
  }catch(e){ /* no backups dir */ }
  return null;
}

let db = FRESH_DB();
if (fs.existsSync(DATA_FILE)) {
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch(e){ parsed = tryRestoreFromSnapshot("licenses.json is corrupted"); }
  if (parsed){
    db = Object.assign(db, parsed);
    // file parsed but has ZERO codes while snapshots contain codes -> data was wiped, heal it
    if (!Array.isArray(db.codes) || db.codes.length === 0){
      const healed = tryRestoreFromSnapshot("licenses.json is empty");
      if (healed) db = healed;
    }
  }
} else {
  const healed = tryRestoreFromSnapshot("licenses.json is missing");
  if (healed) db = healed;
}
function save() { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
save();

/* ---------- helpers ---------- */
const MIME = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript", ".json":"application/json",
  ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".svg":"image/svg+xml", ".ico":"image/x-icon", ".txt":"text/plain" };

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(body);
}
function readBody(req, max) {
  const limit = max || 1e6; // default 1 MB; restore uploads use more
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", c => { buf += c; if (buf.length > limit) req.destroy(); });
    req.on("end", () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
function genCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no confusing 0/O/1/I/L
  const grp = n => Array.from(crypto.randomBytes(n)).map(b => chars[b % chars.length]).join("");
  return `NOVA-${grp(4)}-${grp(4)}-${grp(4)}`;
}
function statusOf(c) {
  if (c.revoked) return "revoked";
  if (!c.activatedAt) return "not_activated";
  if (c.type !== "lifetime" && c.expiresAt && Date.now() > c.expiresAt) return "expired";
  return "active";
}
function salesFile(id){ return path.join(DATA_DIR, "sales_" + id + ".json"); }
function ordersFile(id){ return path.join(DATA_DIR, "orders_" + id + ".json"); }
function readOrdersFile(id){
  try { return JSON.parse(fs.readFileSync(ordersFile(id), "utf8")); } catch (e) { return []; }
}
function readSales(id){
  try { return JSON.parse(fs.readFileSync(salesFile(id), "utf8")); } catch (e) { return []; }
}
function pubCode(c) {
  const s = readSales(c.id);
  return { id: c.id, code: c.code, type: c.type, days: c.days, note: c.note || "",
    storeName: c.storeName || "", ownerName: c.ownerName || "", phone: c.phone || "",
    activatedAt: c.activatedAt || null, expiresAt: c.expiresAt || null,
    createdAt: c.createdAt, lastSeen: c.lastSeen || null, checkIns: c.checkIns || 0,
    lastSync: c.lastSync || null, salesCount: s.length,
    salesTotal: s.reduce((a, x) => a + (x.refunded ? 0 : x.total), 0),
    revoked: !!c.revoked, status: statusOf(c) };
}

/* ---------- automatic server-side backups ---------- */
function backupDir(){ return path.join(DATA_DIR, "backups"); }
function autoBackup(reason){
  try{
    fs.mkdirSync(backupDir(), { recursive: true });
    const out = { app:"RaePOS", version:1, exportedAt:new Date().toISOString(), reason: reason||"change",
      db, sales:{}, orders:{} };
    db.codes.forEach(c => {
      const s = readSales(c.id); if (s.length) out.sales[c.id] = s;
      const o = readOrdersFile(c.id); if (o.length) out.orders[c.id] = o;
    });
    const d = new Date();
    const pad = n => String(n).padStart(2,"0");
    const name = `backup-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
    fs.writeFileSync(path.join(backupDir(), name), JSON.stringify(out));
    // keep only the latest 50 snapshots
    const files = fs.readdirSync(backupDir()).filter(f=>f.startsWith("backup-")).sort();
    while (files.length > 50) fs.unlinkSync(path.join(backupDir(), files.shift()));
    return name;
  }catch(e){ console.error("autoBackup failed:", e.message); return null; }
}

/* ---------- admin sessions (in-memory, 12h) ---------- */
const sessions = new Map();
function newToken() { const t = crypto.randomBytes(24).toString("hex"); sessions.set(t, Date.now() + 12 * 3600e3); return t; }
function authorized(req) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  return t && sessions.get(t) > Date.now();
}

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  const route = url.pathname;

  if (req.method === "OPTIONS") return send(res, 200, { ok: true });

  /* --- POS endpoints --- */
  if (route === "/api/activate" && req.method === "POST") {
    const b = await readBody(req);
    const code = String(b.code || "").trim().toUpperCase();
    const c = db.codes.find(x => x.code === code);
    if (!c) return send(res, 404, { ok: false, error: "Invalid activation code. Contact support." });
    if (c.revoked) return send(res, 403, { ok: false, error: "This license has been REVOKED. Contact support.", status: "revoked" });
    if (!c.activatedAt) {
      c.activatedAt = Date.now();
      if (c.type !== "lifetime") c.expiresAt = c.activatedAt + (c.days || 30) * 864e5;
    }
    if (statusOf(c) === "expired")
      return send(res, 403, { ok: false, error: "This license has EXPIRED on " + new Date(c.expiresAt).toLocaleDateString() + ". Renew to continue.", status: "expired" });
    c.storeName = String(b.storeName || "").trim() || c.storeName;
    c.ownerName = String(b.ownerName || "").trim() || c.ownerName;
    c.phone = String(b.phone || "").trim() || c.phone;
    c.lastSeen = Date.now(); c.checkIns = (c.checkIns || 0) + 1;
    save();
    if (!c.hadFirstActivation) { c.hadFirstActivation = true; save(); autoBackup("activation:" + c.code); }
    return send(res, 200, { ok: true, license: { code: c.code, type: c.type, expiresAt: c.expiresAt || null, storeName: c.storeName } });
  }

  if (route === "/api/heartbeat" && req.method === "POST") {
    const b = await readBody(req);
    const c = db.codes.find(x => x.code === String(b.code || "").trim().toUpperCase());
    if (!c) return send(res, 404, { ok: false, status: "invalid", error: "License not found on server." });
    const st = statusOf(c);
    if (st === "revoked") return send(res, 403, { ok: false, status: "revoked", error: "Access revoked by provider." });
    if (st === "expired") return send(res, 403, { ok: false, status: "expired", expiresAt: c.expiresAt, error: "License expired." });
    c.lastSeen = Date.now(); c.checkIns = (c.checkIns || 0) + 1;
    save();
    return send(res, 200, { ok: true, status: "active", expiresAt: c.expiresAt || null });
  }

  /* POS sales sync (auto-backup to your server) */
  if (route === "/api/sync" && req.method === "POST") {
    const b = await readBody(req);
    const c = db.codes.find(x => x.code === String(b.code || "").trim().toUpperCase());
    if (!c) return send(res, 404, { ok: false, error: "License not found." });
    if (c.revoked) return send(res, 403, { ok: false, error: "Revoked." });
    const arr = readSales(c.id);
    const ids = new Set(arr.map(s => s.id));
    (Array.isArray(b.sales) ? b.sales : []).forEach(s => {
      if (s && s.id && !ids.has(s.id))
        arr.push({ id: s.id, date: s.date, total: +s.total || 0, payment: s.payment || "", refunded: !!s.refunded });
    });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(salesFile(c.id), JSON.stringify(arr));
    c.lastSync = Date.now(); save();
    return send(res, 200, { ok: true, count: arr.length });
  }

  /* ---------- ONLINE STORE ---------- */
  function ordersFile(id){ return path.join(DATA_DIR, "orders_" + id + ".json"); }
  function readOrders(id){
    try { return JSON.parse(fs.readFileSync(ordersFile(id), "utf8")); } catch (e) { return []; }
  }
  function writeOrders(id, arr){ fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(ordersFile(id), JSON.stringify(arr)); }

  // POS publishes its product catalog + store info
  if (route === "/api/catalog" && req.method === "POST") {
    const b = await readBody(req, 20e6); // products may carry compressed photos
    const c = db.codes.find(x => x.code === String(b.code || "").trim().toUpperCase());
    if (!c) return send(res, 404, { ok: false, error: "License not found." });
    if (c.revoked) return send(res, 403, { ok: false, error: "Revoked." });
    c.catalog = {
      online: !!b.online, updatedAt: Date.now(),
      store: { name: String((b.store||{}).name||"Store"), logo: (b.store||{}).logo || "",
               address: String((b.store||{}).address||""), phone: String((b.store||{}).phone||""),
               gcash: String((b.store||{}).gcash||""), gcashName: String((b.store||{}).gcashName||""),
               qr: (b.store||{}).qr || "",
               theme: String((b.store||{}).theme||"sketchy").slice(0,20),
               font: String((b.store||{}).font||"doodle").slice(0,20),
               messenger: String((b.store||{}).messenger||"").slice(0,200),
               deliveryFee: Math.max(0, +((b.store||{}).deliveryFee) || 0) },
      products: (Array.isArray(b.products) ? b.products : []).slice(0, 500).map(p => ({
        name: String(p.name||"").slice(0,80), price: Math.max(0, +p.price || 0),
        emoji: String(p.emoji||"📦").slice(0,8), stock: Math.max(0, parseInt(p.stock,10) || 0),
        img: String(p.img||"").slice(0, 300000)
      }))
    };
    save();
    return send(res, 200, { ok: true });
  }

  // public: track a single order (must be checked BEFORE the storefront route)
  const track = url.pathname.match(/^\/api\/shop\/([A-Za-z0-9-]+)\/order\/([A-Za-z0-9]+)$/);
  if (track && req.method === "GET") {
    const c = db.codes.find(x => x.code === decodeURIComponent(track[1]).trim().toUpperCase());
    if (!c) return send(res, 404, { ok: false, error: "Store not found." });
    const o = readOrders(c.id).find(x => x.id === track[2].toUpperCase());
    if (!o) return send(res, 404, { ok: false, error: "Order not found." });
    const st = c.catalog ? c.catalog.store : {};
    return send(res, 200, { ok: true,
      store: { name: st.name || "Store", phone: st.phone || "", logo: st.logo || "" },
      order: { id: o.id, ts: o.ts, items: o.items, itemsTotal: o.itemsTotal, fee: o.fee,
               total: o.total, payment: o.payment, status: o.status, customerName: o.customer.name } });
  }

  // public: storefront data
  if (url.pathname.startsWith("/api/shop/") && req.method === "GET") {
    const code = decodeURIComponent(url.pathname.split("/")[3] || "").trim().toUpperCase();
    const c = db.codes.find(x => x.code === code);
    if (!c || !c.catalog) return send(res, 404, { ok: false, error: "Store not found." });
    if (c.revoked) return send(res, 403, { ok: false, error: "Store unavailable." });
    if (!c.catalog.online) return send(res, 503, { ok: false, error: "offline" });
    return send(res, 200, { ok: true, store: c.catalog.store, products: c.catalog.products.filter(p=>p.stock>0) });
  }

  // public: place an order
  if (url.pathname.startsWith("/api/shop/") && url.pathname.endsWith("/order") && req.method === "POST") {
    const code = decodeURIComponent(url.pathname.split("/")[3] || "").trim().toUpperCase();
    const c = db.codes.find(x => x.code === code);
    if (!c || !c.catalog || c.revoked) return send(res, 404, { ok: false, error: "Store not found." });
    if (!c.catalog.online) return send(res, 503, { ok: false, error: "This store is closed right now." });
    const b = await readBody(req);
    const cust = b.customer || {};
    if (!String(cust.name||"").trim() || !String(cust.phone||"").trim() || !String(cust.address||"").trim())
      return send(res, 400, { ok: false, error: "Name, phone and delivery address are required." });
    // rebuild the order from catalog prices (never trust client prices)
    const items = [];
    let total = 0;
    (Array.isArray(b.items) ? b.items : []).slice(0, 100).forEach(i => {
      const p = c.catalog.products.find(x => x.name === i.name);
      const qty = Math.max(1, Math.min(999, parseInt(i.qty, 10) || 0));
      if (p && qty > 0 && qty <= p.stock) { items.push({ name: p.name, qty, price: p.price }); total += p.price * qty; }
    });
    if (!items.length) return send(res, 400, { ok: false, error: "Your cart is empty or items went out of stock." });
    const fee = Math.max(0, +(c.catalog.store.deliveryFee) || 0);
    const itemsTotal = Math.round(total*100)/100;
    const order = { id: "O" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase(),
      ts: Date.now(), customer: { name: String(cust.name).slice(0,60), phone: String(cust.phone).slice(0,20),
        address: String(cust.address).slice(0,200), notes: String(cust.notes||"").slice(0,200) },
      items, itemsTotal, fee, total: Math.round((itemsTotal + fee)*100)/100,
      payment: b.payment === "GCash" ? "GCash" : "COD",
      ref: String(b.ref||"").slice(0,40), status: "new" };
    const arr = readOrders(c.id); arr.unshift(order);
    writeOrders(c.id, arr.slice(0, 500));
    return send(res, 200, { ok: true, orderId: order.id, total: order.total });
  }

  // POS: list online orders
  if (route === "/api/orders" && req.method === "POST") {
    const b = await readBody(req);
    const c = db.codes.find(x => x.code === String(b.code || "").trim().toUpperCase());
    if (!c) return send(res, 404, { ok: false, error: "License not found." });
    return send(res, 200, { ok: true, orders: readOrders(c.id).slice(0, 100) });
  }

  // POS: update an order (accept / reject / deliver / complete)
  if (route === "/api/orderupdate" && req.method === "POST") {
    const b = await readBody(req);
    const c = db.codes.find(x => x.code === String(b.code || "").trim().toUpperCase());
    if (!c) return send(res, 404, { ok: false, error: "License not found." });
    const arr = readOrders(c.id);
    const o = arr.find(x => x.id === b.orderId);
    if (!o) return send(res, 404, { ok: false, error: "Order not found." });
    const map = { accept:"preparing", reject:"rejected", deliver:"delivering", complete:"done" };
    if (!map[b.action]) return send(res, 400, { ok: false, error: "Unknown action" });
    o.status = map[b.action];
    writeOrders(c.id, arr);
    return send(res, 200, { ok: true, order: o });
  }

  /* --- admin endpoints --- */
  if (route === "/api/admin/login" && req.method === "POST") {
    const b = await readBody(req);
    if (String(b.password || "") !== db.adminPassword) return send(res, 401, { ok: false, error: "Wrong password" });
    return send(res, 200, { ok: true, token: newToken() });
  }
  if (route.startsWith("/api/admin/") && !authorized(req))
    return send(res, 401, { ok: false, error: "Unauthorized" });

  if (route === "/api/admin/codes" && req.method === "GET")
    return send(res, 200, { ok: true, codes: db.codes.map(pubCode) });

  if (route === "/api/admin/create" && req.method === "POST") {
    const b = await readBody(req);
    const type = b.type === "lifetime" ? "lifetime" : "subscription";
    const days = Math.max(1, Math.min(3650, parseInt(b.days, 10) || 30));
    const code = { id: crypto.randomBytes(8).toString("hex"), code: genCode(), type, days,
      note: String(b.note || "").trim(), createdAt: Date.now(), activatedAt: null,
      expiresAt: null, lastSeen: null, checkIns: 0, revoked: false };
    db.codes.unshift(code); save(); autoBackup("code-created");
    return send(res, 200, { ok: true, code: pubCode(code) });
  }

  if (route === "/api/admin/update" && req.method === "POST") {
    const b = await readBody(req);
    const c = db.codes.find(x => x.id === b.id);
    if (!c) return send(res, 404, { ok: false, error: "Not found" });
    if (b.action === "revoke") c.revoked = true;
    else if (b.action === "restore") c.revoked = false;
    else if (b.action === "delete") {
      try { fs.unlinkSync(salesFile(c.id)); } catch (e) {}
      db.codes = db.codes.filter(x => x.id !== b.id); save(); return send(res, 200, { ok: true });
    }
    else if (b.action === "extend") { // extend/renew: adds days from now (or from expiry if still active)
      const add = Math.max(1, parseInt(b.days, 10) || 30);
      const base = (c.expiresAt && c.expiresAt > Date.now()) ? c.expiresAt : Date.now();
      c.expiresAt = base + add * 864e5; c.type = c.type === "lifetime" ? "lifetime" : "subscription";
      if (c.type === "lifetime") c.expiresAt = null;
    }
    else if (b.action === "make_lifetime") { c.type = "lifetime"; c.expiresAt = null; }
    else return send(res, 400, { ok: false, error: "Unknown action" });
    save(); autoBackup("code-" + b.action);
    return send(res, 200, { ok: true, code: pubCode(c) });
  }

  if (route === "/api/admin/password" && req.method === "POST") {
    const b = await readBody(req);
    if (String(b.current) !== db.adminPassword) return send(res, 403, { ok: false, error: "Current password is wrong" });
    if (!String(b.next || "").trim() || String(b.next).length < 6) return send(res, 400, { ok: false, error: "New password must be at least 6 characters" });
    db.adminPassword = String(b.next); save();
    return send(res, 200, { ok: true });
  }

  /* full backup: licenses + every client's sales/orders */
  if (route === "/api/admin/backup" && req.method === "GET") {
    const out = { app: "RaePOS", version: 1, exportedAt: new Date().toISOString(),
      db, sales: {}, orders: {} };
    db.codes.forEach(c => {
      const s = readSales(c.id); if (s.length) out.sales[c.id] = s;
      const o = readOrders(c.id); if (o.length) out.orders[c.id] = o;
    });
    db.lastBackupAt = Date.now(); save();
    return send(res, 200, out);
  }

  /* list automatic snapshots */
  if (route === "/api/admin/backups" && req.method === "GET") {
    let files = [];
    try { files = fs.readdirSync(backupDir()).filter(f=>f.startsWith("backup-")).sort().reverse(); } catch(e){}
    const list = files.map(f => {
      let st = { size: 0 };
      try { st = fs.statSync(path.join(backupDir(), f)); } catch(e){}
      return { name: f, size: st.size, at: st.mtimeMs || 0 };
    });
    return send(res, 200, { ok: true, backups: list.slice(0, 50),
      lastBackupAt: db.lastBackupAt || null,
      activationsSinceBackup: db.codes.filter(c => c.activatedAt && (!db.lastBackupAt || c.activatedAt > db.lastBackupAt)).length });
  }

  /* download one automatic snapshot */
  if (route === "/api/admin/backupfile" && req.method === "POST") {
    const b = await readBody(req);
    const name = String(b.name || "");
    if (!/^backup-[\w.-]+\.json$/.test(name)) return send(res, 400, { ok: false, error: "Bad file name" });
    const fp = path.join(backupDir(), name);
    if (!fs.existsSync(fp)) return send(res, 404, { ok: false, error: "Snapshot not found" });
    return send(res, 200, { ok: true, name, content: JSON.parse(fs.readFileSync(fp, "utf8")) });
  }

  /* restore a backup (overwrites everything) */
  if (route === "/api/admin/restore" && req.method === "POST") {
    const b = await readBody(req, 30e6);
    if (!b || !b.db || !Array.isArray(b.db.codes)) return send(res, 400, { ok: false, error: "This is not a valid RaePOS backup file." });
    db = b.db; save();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let files = 0;
    Object.entries(b.sales || {}).forEach(([id, arr]) => { if (Array.isArray(arr)) { fs.writeFileSync(salesFile(id), JSON.stringify(arr)); files++; } });
    Object.entries(b.orders || {}).forEach(([id, arr]) => { if (Array.isArray(arr)) { fs.writeFileSync(ordersFile(id), JSON.stringify(arr)); files++; } });
    return send(res, 200, { ok: true, codes: db.codes.length, files });
  }

  /* device migration: old device uploads its store, new device downloads it */
  if (route === "/api/transfer" && req.method === "POST") {
    const b = await readBody(req, 25e6);
    const c = db.codes.find(x => x.code === String(b.code || "").trim().toUpperCase());
    if (!c) return send(res, 404, { ok: false, error: "License not found." });
    if (c.revoked) return send(res, 403, { ok: false, error: "Revoked." });
    if (!Array.isArray(b.products)) return send(res, 400, { ok: false, error: "No products in upload." });
    c.transfer = { savedAt: Date.now(), products: b.products.slice(0, 1000), settings: b.settings || {} };
    save();
    return send(res, 200, { ok: true, count: c.transfer.products.length });
  }
  if (route === "/api/transfer/get" && req.method === "POST") {
    const b = await readBody(req);
    const c = db.codes.find(x => x.code === String(b.code || "").trim().toUpperCase());
    if (!c) return send(res, 404, { ok: false, error: "License not found." });
    if (c.revoked) return send(res, 403, { ok: false, error: "Revoked." });
    if (!c.transfer) return send(res, 404, { ok: false, error: "No data uploaded from the old device yet." });
    return send(res, 200, { ok: true, savedAt: c.transfer.savedAt, products: c.transfer.products, settings: c.transfer.settings });
  }

  return send(res, 404, { ok: false, error: "Unknown endpoint" });
}

/* ---------- static files ---------- */
function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("404 Not Found"); }
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    let p = decodeURIComponent(url.pathname);
    if (p === "/" ) p = "/index.html";
    if (p === "/admin") p = "/admin.html";
    if (p === "/shop" || p.startsWith("/shop/")) p = "/shop.html"; // public storefront
    if (p === "/buy") p = "/buy.html"; // public pricing page
    if (p === "/preview") p = "/ui-preview.html"; // style preview
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT) || file.startsWith(DATA_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
    serveFile(res, file);
  } catch (e) {
    send(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, () => {
  console.log("RaePOS License Server running:");
  console.log("  POS app : http://localhost:" + PORT);
  console.log("  Admin   : http://localhost:" + PORT + "/admin");
  console.log("  Admin password: " + (process.env.ADMIN_PASSWORD ? "(from env)" : "admin123  — CHANGE IT in the admin panel!"));
});
