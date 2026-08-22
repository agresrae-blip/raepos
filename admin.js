/* ================= RaePOS — Admin Console logic ================= */
"use strict";
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let token = sessionStorage.getItem("novapos_admin_token") || null;
let codes = [];

function toast(msg, err=false){
  const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", err); t.classList.remove("hidden");
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.add("hidden"), 2600);
}
async function api(path, body, method){
  const res = await fetch("/api/" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(()=>({}));
  if (res.status === 401 && path.startsWith("admin")) { logout(); throw new Error("Session expired"); }
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/* ---------- login ---------- */
$("#adminLoginForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    const r = await api("admin/login", { password: $("#adminPass").value });
    token = r.token; sessionStorage.setItem("novapos_admin_token", token);
    enter();
  } catch (err) { $("#adminLoginErr").textContent = err.message; }
});
function enter(){
  $("#adminLogin").classList.add("hidden"); $("#adminApp").classList.remove("hidden");
  load(); clearInterval(window._poll); window._poll = setInterval(load, 30000);
}
function logout(){
  token = null; sessionStorage.removeItem("novapos_admin_token");
  clearInterval(window._poll);
  $("#adminApp").classList.add("hidden"); $("#adminLogin").classList.remove("hidden");
  $("#adminPass").value = ""; $("#adminLoginErr").textContent = "";
}
$("#adminLogout").onclick = logout;
$("#themeBtn").onclick = ()=>{
  const el = document.documentElement;
  const next = el.dataset.mode === "dark" ? "light" : "dark";
  el.dataset.mode = next;
  try{ localStorage.setItem("raepos_theme", next); }catch(e){}
};
if (token) enter(); // auto-resume

/* ---------- nav ---------- */
$$("#nav .nav-btn[data-page]").forEach(b => b.onclick = ()=>{
  $$("#nav .nav-btn").forEach(x=>x.classList.remove("active")); b.classList.add("active");
  $$(".page").forEach(p=>p.classList.remove("active"));
  $("#page-"+b.dataset.page).classList.add("active");
});

/* ---------- licenses table ---------- */
const ONLINE_MS = 10 * 60e3;
const dt = ts => ts ? new Date(ts).toLocaleString("en-PH",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}) : "—";
const dOnly = ts => ts ? new Date(ts).toLocaleDateString("en-PH",{year:"numeric",month:"short",day:"numeric"}) : "—";
function lastSeenLabel(c){
  if (!c.lastSeen) return '<span class="muted">never opened</span>';
  const ago = Date.now() - c.lastSeen;
  if (ago < ONLINE_MS) return '<span class="pill ok">● ONLINE</span> ' + dt(c.lastSeen);
  return dt(c.lastSeen);
}
async function load(){
  try { const r = await api("admin/codes"); codes = r.codes; render(); }
  catch (e) { toast(e.message, true); }
}
function render(){
  $("#stTotal").textContent  = codes.length;
  $("#stActive").textContent = codes.filter(c=>c.status==="active").length;
  $("#stOnline").textContent = codes.filter(c=>c.lastSeen && Date.now()-c.lastSeen < ONLINE_MS).length;
  $("#stDead").textContent   = codes.filter(c=>c.status==="expired"||c.status==="revoked").length;

  // expiring soon (active subscriptions within 5 days of expiry)
  const soon = codes.filter(c => c.status==="active" && c.type!=="lifetime" && c.expiresAt &&
    (c.expiresAt - Date.now()) < 5 * 864e5);
  $("#expiringPanel").classList.toggle("hidden", !soon.length);
  $("#expiringList").innerHTML = soon.map(c=>{
    const d = Math.ceil((c.expiresAt - Date.now()) / 864e5);
    return `<div class="cashier-row"><span><b>${c.code}</b> — ${c.storeName||c.note||"no store"}${c.phone?` · ${c.phone}`:""}</span>
      <span><span class="pill warn">${d<=0?"EXPIRED":d+" day"+(d===1?"":"s")+" left"}</span>
      <button class="btn-ghost sm" data-act="extend" data-id="${c.id}">＋30d</button></span></div>`;
  }).join("");
  $$("#expiringList [data-act]").forEach(b => b.onclick = async ()=>{
    try { await api("admin/update", { id: b.dataset.id, action: "extend", days: 30 }); toast("Extended +30 days"); load(); }
    catch (e) { toast(e.message, true); }
  });

  $("#codesBody").innerHTML = codes.length ? codes.map(c=>{
    const pill = { active:"ok", not_activated:"warn", expired:"bad", revoked:"bad" }[c.status];
    const label = { active:"Active", not_activated:"Not activated", expired:"EXPIRED", revoked:"REVOKED" }[c.status];
    const plan = c.type==="lifetime" ? "💎 Lifetime" : `⏳ ${c.days} days`;
    const expiry = c.type==="lifetime" ? "∞" : (c.expiresAt ? dOnly(c.expiresAt) : "starts on activation");
    return `<tr>
      <td><b>${c.code}</b>${c.note?`<br><small class="muted">${c.note}</small>`:""}</td>
      <td>${plan}</td>
      <td><span class="pill ${pill}">${label}</span></td>
      <td>${c.storeName||'<span class="muted">—</span>'}${c.ownerName?`<br><small class="muted">${c.ownerName}${c.phone?" · "+c.phone:""}</small>`:""}</td>
      <td>${c.activatedAt?dOnly(c.activatedAt):"—"}</td>
      <td>${expiry}</td>
      <td>${lastSeenLabel(c)}<br><small class="muted">${c.checkIns} check-ins</small></td>
      <td>${c.salesCount||0} sales<br><small class="muted">₱${(c.salesTotal||0).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}</small></td>
      <td style="white-space:nowrap">
        ${c.status==="expired"||c.status==="revoked"
          ? `<button class="btn-ghost sm" data-act="restore" data-id="${c.id}">✔ Restore</button>` : ""}
        ${c.type!=="lifetime" ? `<button class="btn-ghost sm" data-act="extend" data-id="${c.id}">＋30d</button>` : ""}
        ${c.status==="active"||c.status==="not_activated"
          ? `<button class="btn-danger sm" data-act="revoke" data-id="${c.id}">⛔ Revoke</button>` : ""}
        <button class="btn-ghost sm" data-act="delete" data-id="${c.id}">🗑</button>
      </td>
    </tr>`; }).join("")
    : `<tr><td colspan="9" class="muted" style="text-align:center;padding:30px">No codes yet — generate your first one.</td></tr>`;

  $$("#codesBody [data-act]").forEach(b => b.onclick = async ()=>{
    const id = b.dataset.id, act = b.dataset.act;
    const c = codes.find(x=>x.id===id);
    if (act === "delete" && !confirm(`Delete code ${c.code} permanently?\nThe client's POS will be locked immediately.`)) return;
    if (act === "revoke" && !confirm(`Revoke ${c.code} (${c.storeName||c.note||"no note"})?\nThe client's POS will lock on next check.`)) return;
    try {
      await api("admin/update", { id, action: act, days: 30 });
      toast(act==="revoke"?"Revoked — POS will lock":act==="restore"?"Access restored":act==="extend"?"Extended +30 days":"Deleted");
      load();
    } catch (e) { toast(e.message, true); }
  });
}

/* ---------- create code ---------- */
$("#newCodeBtn").onclick = ()=>{
  $("#cmType").value = "subscription"; $("#cmDays").value = 30; $("#cmNote").value = "";
  $("#cmDaysWrap").style.display = "block";
  $("#codeModal").classList.remove("hidden");
};
$("#cmType").onchange = ()=> $("#cmDaysWrap").style.display = $("#cmType").value==="lifetime" ? "none" : "block";
$$("#cmDaysWrap .chip").forEach(ch => ch.onclick = ()=> $("#cmDays").value = ch.dataset.days);
$("#cmCreate").onclick = async ()=>{
  try {
    const r = await api("admin/create", {
      type: $("#cmType").value,
      days: +$("#cmDays").value || 30,
      note: $("#cmNote").value
    });
    $("#codeModal").classList.add("hidden");
    $("#newCodeOut").textContent = r.code.code;
    $("#resultModal").classList.remove("hidden");
    load();
  } catch (e) { toast(e.message, true); }
};
$("#copyCodeBtn").onclick = ()=>{
  navigator.clipboard.writeText($("#newCodeOut").textContent).then(()=>toast("Copied to clipboard"));
};

/* ---------- password ---------- */
$("#pwSave").onclick = async ()=>{
  try {
    await api("admin/password", { current: $("#pwCur").value, next: $("#pwNew").value });
    $("#pwCur").value = ""; $("#pwNew").value = "";
    toast("Admin password updated");
  } catch (e) { toast(e.message, true); }
};

/* ---------- backup & restore ---------- */
$("#backupBtn").onclick = async ()=>{
  try{
    const r = await fetch("/api/admin/backup", { headers:{ Authorization: "Bearer " + token } });
    if (!r.ok) throw new Error("Download failed");
    const data = await r.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "raepos-backup-" + new Date().toISOString().slice(0,10) + ".json";
    a.click(); URL.revokeObjectURL(a.href);
    toast("Backup downloaded — keep it safe! " + (data.db.codes.length) + " codes included");
  }catch(e){ toast(e.message, true); }
};
$("#restoreBtn").onclick = async ()=>{
  const f = $("#restoreFile").files && $("#restoreFile").files[0];
  if(!f) return toast("Choose a backup file first", true);
  if(!confirm("Restoring will OVERWRITE all licenses and data currently on this server. Continue?")) return;
  try{
    const parsed = JSON.parse(await f.text());
    const r = await api("admin/restore", parsed);
    toast("Restored " + r.codes + " codes and " + (r.files||0) + " data files " + String.fromCodePoint(9989));
    load();
  }catch(e){ toast("Restore failed: " + e.message, true); }
};

/* ---------- modals ---------- */
$$("[data-close]").forEach(b => b.onclick = ()=> $$(".modal").forEach(m=>m.classList.add("hidden")));
$$(".modal").forEach(m => m.addEventListener("click", e => { if (e.target === m) m.classList.add("hidden"); }));
