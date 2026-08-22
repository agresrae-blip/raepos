/* ================= RaePOS — app logic ================= */
"use strict";

/* ---------- storage ---------- */
const DB = {
  get(k, d){ try{ const v = localStorage.getItem("novapos_"+k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ localStorage.setItem("novapos_"+k, JSON.stringify(v)); }
};

let products  = DB.get("products", null);
let sales     = DB.get("sales", []);
let settings  = DB.get("settings", {
  name:"My Store", address:"123 Main St.", phone:"0917 000 0000",
  cashier:"Cashier", vat:0, footer:"Thank you for shopping!", pin:"1234"
});
let cart = [];        // {id, name, price, cost, qty}
let discountPct = 0;  // 0/5/10/20
let payMethod = null; // selected at checkout
let editingId = null;
let shiftStart = DB.get("shiftStart", null);
let customers = DB.get("customers", []);
let suppliers = DB.get("suppliers", []);
let stockins  = DB.get("stockins", []);
const saveSuppliers = () => DB.set("suppliers", suppliers);
const saveStockins  = () => DB.set("stockins", stockins);
let held      = DB.get("held", []);       // parked orders
let shifts    = DB.get("shifts", []);
if(!Array.isArray(settings.cashiers)) settings.cashiers = [];
const saveCustomers = () => DB.set("customers", customers);
const saveHeld      = () => DB.set("held", held);
const saveShifts    = () => DB.set("shifts", shifts);

if(!products){ // seed demo catalog
  products = [
    {id:1,name:"San Mig Coffee 3in1",cat:"Beverages",price:12,cost:8,stock:50,low:10,barcode:"4800012345001",emoji:"☕"},
    {id:2,name:"Coke in Can 330ml",cat:"Beverages",price:45,cost:32,stock:40,low:8,barcode:"4800012345002",emoji:"🥤"},
    {id:3,name:"Bottled Water 500ml",cat:"Beverages",price:20,cost:10,stock:80,low:15,barcode:"4800012345003",emoji:"💧"},
    {id:4,name:"Instant Noodles",cat:"Pantry",price:25,cost:17,stock:60,low:12,barcode:"4800012345004",emoji:"🍜"},
    {id:5,name:"Canola Oil 1L",cat:"Pantry",price:120,cost:95,stock:15,low:5,barcode:"4800012345005",emoji:"🛢️"},
    {id:6,name:"Royal 250ml",cat:"Beverages",price:35,cost:24,stock:3,low:8,barcode:"4800012345006",emoji:"🥫"},
    {id:7,name:"Potato Chips",cat:"Snacks",price:60,cost:42,stock:25,low:6,barcode:"4800012345007",emoji:"🍟"},
    {id:8,name:"Choco Cookie",cat:"Snacks",price:25,cost:15,stock:4,low:10,barcode:"4800012345008",emoji:"🍪"},
    {id:9,name:"Toothpaste 100g",cat:"Personal Care",price:75,cost:52,stock:20,low:5,barcode:"4800012345009",emoji:"🪥"},
    {id:10,name:"Soap Bar",cat:"Personal Care",price:30,cost:19,stock:35,low:8,barcode:"4800012345010",emoji:"🧼"},
    {id:11,name:"Detergent 500g",cat:"Household",price:65,cost:45,stock:18,low:5,barcode:"4800012345011",emoji:"🧺"},
    {id:12,name:"Dishwashing Liquid",cat:"Household",price:55,cost:36,stock:2,low:6,barcode:"4800012345012",emoji:"🧽"}
  ];
  DB.set("products", products);
}
const EMOJIS = ["🛒","📦","🥤","☕","🍜","🍪","🍟","🧼","🪥","🧺","🧽","💧","🥫","🛢️","🍚","🥩","🥛","🍞","🍫","💊","🖊️","🔋"];
const saveProducts = () => DB.set("products", products);
const saveSales    = () => DB.set("sales", sales);
const saveSettings = () => DB.set("settings", settings);

/* ---------- helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const peso = n => "₱" + (Math.round(n*100)/100).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2});
const todayStr = () => new Date().toISOString().slice(0,10);
const uid = () => Date.now();
function toast(msg, err=false){
  const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", err); t.classList.remove("hidden");
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.add("hidden"), 2600);
}
const payEmoji = p => ({"Cash":"💵","GCash":"🔵","Maya":"🟢","GoTyme":"🟠","Bank Transfer":"🏦"}[p]||"💳");
function currentUser(){
  try { return JSON.parse(sessionStorage.getItem("novapos_user")) || {name:"Cashier", role:"cashier"}; }
  catch(e){ return {name:"Cashier", role:"cashier"}; }
}
const liveSales = () => sales.filter(s=>!s.refunded);

/* ---------- YOUR seller / support contacts (shown to clients) ---------- */
const SELLER = {
  name: "RaePOS",
  facebook : "https://www.facebook.com/share/1DCHtT9uqa/",  // your Facebook page
  messenger: "https://m.me/61577766005721",                  // your Messenger
  phone    : "0946 238 1740",                                // your contact number
  email    : ""                                               // optional — leave blank if none
};

/* ---------- licensing ---------- */
const GRACE_MS = 3 * 24 * 3600e3; // offline grace: POS keeps working 3 days without server
const licServer = () => {
  const saved = DB.get("server", "");
  return location.protocol.startsWith("http") ? (saved || location.origin) : saved;
};
async function licApi(path, body){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 8000);
  try{
    const res = await fetch(licServer().replace(/\/$/,"") + "/api/" + path, {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(body), signal: ctrl.signal
    });
    return await res.json();
  } finally { clearTimeout(t); }
}
function showOnly(id){
  ["loginScreen","activationScreen","blockedScreen"].forEach(s=>$("#"+s).classList.add("hidden"));
  $("#app").classList.add("hidden");
  if(id === "app"){ $("#app").classList.remove("hidden"); }
  else if(id) $("#"+id).classList.remove("hidden");
}
function contactRow(el, big){
  const c = SELLER;
  $(el).innerHTML = `
    <a href="${c.messenger}" target="_blank" rel="noopener">💬 Messenger</a>
    <a href="${c.facebook}" target="_blank" rel="noopener">📘 Facebook</a>
    <a href="tel:${c.phone.replace(/\s/g,"")}">📞 ${c.phone}</a>`;
}
function blockScreen(kind, extra){
  const map = {
    expired:      ["⏳ License Expired", "Your subscription has ended"+(extra?" on "+extra:"")+". Contact your supplier below to renew and get a new code."],
    revoked:      ["⛔ Access Revoked", "This copy of RaePOS was deactivated by the supplier. Contact us below if you think this is a mistake."],
    invalid:      ["⛔ License Not Found", "This activation code no longer exists on the server. Contact your supplier."],
    "cannot-verify": ["📡 Cannot Verify License", "The license server can't be reached and the last successful check was more than 3 days ago. Connect this device to the internet, or contact your supplier below."]
  };
  const [title,msg] = map[kind] || map["cannot-verify"];
  $("#blockTitle").textContent = title;
  $("#blockMsg").textContent = msg;
  contactRow("#blockContacts", true);
  showOnly("blockedScreen");
}
function licenseDaysLeft(){
  const lic = DB.get("license", null);
  if(!lic || lic.type === "lifetime") return Infinity;
  return Math.ceil(((lic.expiresAt||0) - Date.now()) / 864e5);
}
function renderLicenseChip(){
  const chip = $("#licenseChip"); const lic = DB.get("license", null);
  if(!lic){ chip.className="license-chip"; chip.textContent="No license"; return; }
  if(lic.type === "lifetime"){ chip.className="license-chip ok"; chip.textContent="💎 Lifetime License"; }
  else {
    const d = licenseDaysLeft();
    chip.className = "license-chip " + (d<=3 ? "warn" : "ok");
    chip.textContent = "⏳ " + (d>0 ? d+" day"+(d===1?"":"s")+" left · expires "+new Date(lic.expiresAt).toLocaleDateString("en-PH") : "EXPIRED — renew now");
  }
}
function renderLicenseSettings(){
  const lic = DB.get("license", null);
  $("#licenseInfo").innerHTML = lic
    ? `Code: <b>${lic.code}</b><br>Plan: <b>${lic.type==="lifetime"?"💎 Lifetime":"Subscription"}</b>` +
      (lic.type!=="lifetime" ? `<br>Expires: <b>${new Date(lic.expiresAt).toLocaleDateString("en-PH")}</b>` : "")
    : "No license on this device.";
  contactRow("#settingsContacts");
}
async function heartbeat(silent=true){
  const lic = DB.get("license", null);
  if(!lic) return;
  if(!silent) $("#checkOverlay").classList.remove("hidden");
  try{
    const r = await licApi("heartbeat", { code: lic.code });
    $("#checkOverlay").classList.add("hidden");
    if(r.ok){
      DB.set("lastCheck", Date.now());
      if(r.expiresAt) { lic.expiresAt = r.expiresAt; DB.set("license", lic); }
      renderLicenseChip();
      syncSales(); // backup sales whenever we can reach the server
      syncCatalog(); // keep online store catalog fresh
      pollOrders(false); // check for new online orders
    } else blockScreen(r.status, r.expiresAt ? new Date(r.expiresAt).toLocaleDateString("en-PH") : null);
  }catch(e){
    $("#checkOverlay").classList.add("hidden");
    if(!silent) toast("License server unreachable — offline mode", true);
    // offline: allow if last successful check within grace period
    if(Date.now() - (DB.get("lastCheck",0)||0) > GRACE_MS) blockScreen("cannot-verify");
  }
}
function startHeartbeat(){ clearInterval(window._hb); window._hb = setInterval(()=>heartbeat(true), 10 * 60e3); }

/* boot: activation → license check → login */
async function boot(){
  contactRow("#loginContacts"); contactRow("#actContacts");
  if(!licServer()) $("#actServerWrap").style.display = "block", $("#actServer").style.display = "block";
  $("#actServer").value = licServer() || "";
  const lic = DB.get("license", null);
  if(!lic){ showOnly("activationScreen"); return; }
  showOnly("loginScreen"); // show login behind the overlay
  $("#checkOverlay").classList.remove("hidden");
  await heartbeat(true);
  $("#checkOverlay").classList.add("hidden");
  // if heartbeat blocked the screen, stop here
  if(!$("#blockedScreen").classList.contains("hidden")) return;
  showOnly("loginScreen");
  if(sessionStorage.getItem("novapos_unlocked")==="1") showOnly("app");
  startHeartbeat();
}

/* activation form */
$("#actForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const btn = $("#actBtn"); btn.disabled = true; btn.textContent = "Activating…";
  $("#actError").textContent = "";
  const server = $("#actServer").value.trim();
  if(server) DB.set("server", server.replace(/\/$/,""));
  try{
    const r = await licApi("activate", {
      code: $("#actCode").value.trim().toUpperCase(),
      storeName: $("#actStore").value.trim(),
      ownerName: $("#actOwner").value.trim(),
      phone: $("#actPhone").value.trim()
    });
    if(r.ok){
      DB.set("license", { code:r.license.code, type:r.license.type, expiresAt:r.license.expiresAt, storeName:r.license.storeName });
      DB.set("lastCheck", Date.now());
      if(r.license.storeName && settings.name === "My Store"){ settings.name = r.license.storeName; saveSettings(); loadSettingsForm(); }
      toast("Activated! Welcome to RaePOS 🎉");
      showOnly("loginScreen"); startHeartbeat();
    } else {
      $("#actError").textContent = r.error || "Activation failed.";
      if(r.status === "revoked" || r.status === "expired") setTimeout(()=>blockScreen(r.status, null), 1200);
    }
  }catch(err){
    $("#actError").textContent = "Cannot reach license server. Check the Server URL / internet connection.";
  }
  btn.disabled = false; btn.textContent = "Activate ▸";
});
$("#retryBtn").onclick = async ()=>{
  // re-enter code path: go back to activation to re-validate
  showOnly("activationScreen");
  $("#actCode").value = (DB.get("license",{})||{}).code || "";
};

$("#loginForm").addEventListener("submit", e=>{
  e.preventDefault();
  const pin = $("#pinInput").value;
  let user = null;
  if(pin === settings.pin) user = { name:"Owner", role:"owner" };
  else {
    const c = (settings.cashiers||[]).find(c=>c.pin===pin);
    if(c) user = { name:c.name, role:"cashier" };
  }
  if(user){
    sessionStorage.setItem("novapos_unlocked","1");
    sessionStorage.setItem("novapos_user", JSON.stringify(user));
    $("#loginScreen").classList.add("hidden"); $("#app").classList.remove("hidden");
    $("#pinInput").value=""; $("#loginError").textContent="";
    shiftStart = shiftStart || Date.now(); DB.set("shiftStart", shiftStart); refreshFoot();
    startHeartbeat(); heartbeat(true); startOrderPolling();
  } else { $("#loginError").textContent = "Wrong PIN. Try again."; }
});
$("#logoutBtn").onclick = ()=>{ sessionStorage.removeItem("novapos_unlocked"); location.reload(); };
$("#themeBtn").onclick = ()=>{
  const el = document.documentElement;
  const next = el.dataset.mode === "dark" ? "light" : "dark";
  el.dataset.mode = next;
  try{ localStorage.setItem("raepos_theme", next); }catch(e){}
  toast(next === "dark" ? "Dark mode (chalkboard) on" : "Light mode (paper) on");
};

/* ---------- navigation ---------- */
$$("#nav .nav-btn").forEach(b => b.onclick = async ()=>{
  // Settings is owner-only: cashiers must authorize with the owner PIN
  if((b.dataset.page==="settings" || b.dataset.page==="stockin") && currentUser().role !== "owner"){
    if(!await ownerGate((b.dataset.page==="stockin" ? "Stock In is for the OWNER only" : "Settings is for the OWNER only") + " — enter the owner PIN")) return;
  }
  $$("#nav .nav-btn").forEach(x=>x.classList.remove("active")); b.classList.add("active");
  $$(".page").forEach(p=>p.classList.remove("active"));
  $("#page-"+b.dataset.page).classList.add("active");
  if(b.dataset.page==="dashboard") renderDashboard();
  if(b.dataset.page==="inventory") renderInventory();
  if(b.dataset.page==="stockin") renderStockIn();
  if(b.dataset.page==="sales") renderSales();
  if(b.dataset.page==="online"){ renderOnline(); pollOrders(true); }
  if(b.dataset.page==="reports") renderReports();
});

function refreshFoot(){
  $("#footCashier").textContent = currentUser().name;
  $("#footShift").textContent = new Date(shiftStart).toLocaleTimeString("en-PH",{hour:"2-digit",minute:"2-digit"});
  renderLicenseChip(); renderLicenseSettings();
}

/* ---------- DASHBOARD ---------- */
function renderDashboard(){
  $("#dashDate").textContent = new Date().toLocaleDateString("en-PH",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  const t = todayStr();
  const todays = sales.filter(s=>!s.refunded && s.date.startsWith(t));
  const total = todays.reduce((a,s)=>a+s.total,0);
  const items = todays.reduce((a,s)=>a+s.items.reduce((x,i)=>x+i.qty,0),0);
  $("#statSales").textContent = peso(total);
  $("#statTxCount").textContent = todays.length + " transactions";
  $("#statItems").textContent = items;
  $("#statAvg").textContent = peso(todays.length ? total/todays.length : 0);
  const low = products.filter(p=>p.stock<=p.low);
  $("#statLow").textContent = low.length;

  // payment mix
  const mix = {};
  todays.forEach(s=>mix[s.payment]=(mix[s.payment]||0)+s.total);
  const max = Math.max(...Object.values(mix),1);
  $("#payMix").innerHTML = Object.keys(mix).length
    ? Object.entries(mix).map(([k,v])=>`
      <div class="mix-row"><span>${payEmoji(k)} ${k}</span>
      <div class="mix-bar"><div class="mix-fill" style="width:${v/max*100}%"></div></div>
      <b style="text-align:right">${peso(v)}</b></div>`).join("")
    : `<p class="muted">No sales yet today.</p>`;

  // low stock
  $("#lowStockList").innerHTML = low.length
    ? low.map(p=>`<div class="low-item"><span>${p.emoji} ${p.name}</span><b class="bad">${p.stock} left</b></div>`).join("")
    : `<p class="muted">All stocked up 🎉</p>`;

  // top sellers
  const sold = {};
  liveSales().forEach(s=>s.items.forEach(i=>sold[i.name]=(sold[i.name]||0)+i.qty));
  const top = Object.entries(sold).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const tmax = Math.max(...top.map(t=>t[1]),1);
  $("#topSellers").innerHTML = top.length
    ? top.map(([n,q])=>`<div class="mix-row"><span>${n}</span>
       <div class="mix-bar"><div class="mix-fill" style="width:${q/tmax*100}%"></div></div>
       <b style="text-align:right">${q} sold</b></div>`).join("")
    : `<p class="muted">No sales recorded yet.</p>`;

  // low stock badge
  const badge = $("#lowStockBadge");
  if(low.length){ badge.textContent = low.length; badge.classList.remove("hidden"); } else badge.classList.add("hidden");
}

/* ---------- POS ---------- */
function renderProducts(){
  const q = $("#searchInput").value.toLowerCase().trim();
  const cat = $("#catFilter").value;
  const list = products.filter(p =>
    (!cat || p.cat===cat) &&
    (!q || p.name.toLowerCase().includes(q) || (p.barcode||"").includes(q))
  );
  $("#productGrid").innerHTML = list.length ? list.map(p=>`
    <div class="prod-card ${p.stock<=0?"oos":""}" data-id="${p.id}">
      <div class="prod-emoji">${p.img?`<img src="${p.img}" class="prod-img" alt="">`:(p.emoji||"📦")}</div>
      <h4>${p.name}</h4>
      <div class="prod-price">${peso(p.price)}</div>
      <div class="prod-stock ${p.stock<=0?"out":""}">${p.stock<=0?"OUT OF STOCK":p.stock+" in stock"}</div>
    </div>`).join("")
    : `<p class="muted" style="grid-column:1/-1;padding:30px;text-align:center">No products found.</p>`;
  $$("#productGrid .prod-card").forEach(c => c.onclick = ()=> addToCart(+c.dataset.id));
}
function refreshCats(){
  const cats = [...new Set(products.map(p=>p.cat))];
  const sel = $("#catFilter"); const cur = sel.value;
  sel.innerHTML = `<option value="">All Categories</option>` + cats.map(c=>`<option>${c}</option>`).join("");
  sel.value = cur;
  $("#catList").innerHTML = cats.map(c=>`<option value="${c}">`).join("");
}
function addToCart(id){
  const p = products.find(x=>x.id===id); if(!p || p.stock<=0) return;
  const line = cart.find(i=>i.id===id);
  if(line){ if(line.qty >= p.stock){ toast("Only "+p.stock+" in stock", true); return; } line.qty++; }
  else cart.push({id:p.id,name:p.name,price:p.price,cost:p.cost,qty:1});
  renderCart();
}
function renderCart(){
  const cl = $("#cartList");
  if(!cart.length){ cl.innerHTML = `<div class="cart-empty">Cart is empty.<br>Tap a product to add.</div>`; }
  else cl.innerHTML = cart.map(i=>`
    <div class="cart-item">
      <h5>${i.name}<br><small class="muted">${peso(i.price)} each</small></h5>
      <div class="qty-ctrl">
        <button data-act="minus" data-id="${i.id}">−</button>
        <b>${i.qty}</b>
        <button data-act="plus" data-id="${i.id}">＋</button>
      </div>
      <span></span><span class="line-total">${peso(i.price*i.qty)}</span>
    </div>`).join("");
  $$("#cartList button").forEach(b=>b.onclick=()=>{
    const line = cart.find(i=>i.id===+b.dataset.id); const p = products.find(x=>x.id===line.id);
    if(b.dataset.act==="plus"){ if(line.qty>=p.stock){toast("Stock limit reached",true);return;} line.qty++; }
    else { line.qty--; if(line.qty<=0) cart = cart.filter(i=>i.id!==line.id); }
    renderCart();
  });
  updateTotals();
}
function totals(){
  const sub = cart.reduce((a,i)=>a+i.price*i.qty,0);
  const disc = sub * discountPct/100;
  const vat = (sub-disc) * (settings.vat/100);
  return {sub, disc, vat, total: sub-disc+vat};
}
function updateTotals(){
  const t = totals();
  $("#sumSub").textContent = peso(t.sub);
  $("#sumDisc").textContent = "−"+peso(t.disc);
  $("#discRow").style.display = discountPct ? "flex" : "none";
  $("#discLabel").textContent = "Discount ("+discountPct+"%)";
  $("#vatRateLbl").textContent = settings.vat;
  $("#sumVat").textContent = peso(t.vat);
  $("#sumTotal").textContent = peso(t.total);
  $("#chargeBtn").disabled = !cart.length;
}
$("#searchInput").oninput = e=>{
  const v = e.target.value.trim();
  if(v.length >= 4){ // barcode scanner: exact match adds instantly
    const p = products.find(x=>x.barcode === v);
    if(p){ addToCart(p.id); e.target.value = ""; renderProducts(); return; }
  }
  renderProducts();
};
$("#catFilter").onchange = renderProducts;
$("#clearCartBtn").onclick = ()=>{ cart=[]; discountPct=0; syncChips(); renderCart(); };

/* ---------- hold / resume orders ---------- */
$("#holdBtn").onclick = async ()=>{
  if(!cart.length){ toast("Cart is empty", true); return; }
  const note = await inputModal("Hold this order — note (optional)", "e.g. Mang Jun / outside");
  if(note === null) return;
  held.push({ id:uid(), time:Date.now(), note, cart:[...cart], discountPct });
  cart=[]; discountPct=0; syncChips(); renderCart(); saveHeld(); renderHeldBadge();
  toast("Order held 📋");
};
$("#heldBtn").onclick = renderHeldModal;
function renderHeldBadge(){
  const b = $("#heldCount");
  if(held.length){ b.textContent = held.length; b.classList.remove("hidden"); } else b.classList.add("hidden");
}
function renderHeldModal(){
  $("#heldList").innerHTML = held.length ? held.map(h=>`
    <div class="cashier-row">
      <span>🕐 ${new Date(h.time).toLocaleTimeString("en-PH",{hour:"2-digit",minute:"2-digit"})} — ${h.note || h.cart.length+" item(s)"}<br>
      <small class="muted">${h.cart.map(i=>i.qty+"× "+i.name).join(", ")}</small></span>
      <span>
        <button class="btn-ghost sm" data-resume="${h.id}">▶ Resume</button>
        <button class="btn-ghost sm" data-drop="${h.id}">🗑</button>
      </span>
    </div>`).join("") : `<p class="muted">No held orders.</p>`;
  openModal("#heldModal");
  $$("#heldList [data-resume]").forEach(b=>b.onclick=()=>{
    if(cart.length){ toast("Finish or hold the current order first", true); return; }
    const h = held.find(x=>x.id===+b.dataset.resume);
    cart = h.cart; discountPct = h.discountPct || 0;
    held = held.filter(x=>x.id!==h.id); saveHeld(); renderHeldBadge();
    closeModals(); syncChips(); renderCart(); toast("Order resumed ▶");
  });
  $$("#heldList [data-drop]").forEach(b=>b.onclick=()=>{
    held = held.filter(x=>x.id!==+b.dataset.drop); saveHeld(); renderHeldBadge(); renderHeldModal();
  });
}
$$(".disc-btns .chip").forEach(c=>c.onclick=()=>{ discountPct = +c.dataset.disc; syncChips(); updateTotals(); });
function syncChips(){ $$(".disc-btns .chip").forEach(c=>c.classList.toggle("on", +c.dataset.disc===discountPct)); }

/* ---------- CHECKOUT ---------- */
$("#chargeBtn").onclick = ()=>{
  payMethod=null; $("#refInput").value=""; $("#senderInput").value=""; $("#tenderedInput").value="";
  $("#cashPanel").classList.add("hidden"); $("#ewalletPanel").classList.add("hidden");
  $$(".pay-btn").forEach(b=>b.classList.remove("sel"));
  $("#completeBtn").disabled = true; $("#coError").textContent="";
  openModal("#checkoutModal");
};
$$(".pay-btn").forEach(b=>b.onclick=()=>{
  $$(".pay-btn").forEach(x=>x.classList.remove("sel")); b.classList.add("sel");
  payMethod = b.dataset.pay;
  const isCash = payMethod==="Cash";
  $("#cashPanel").classList.toggle("hidden", !isCash);
  $("#ewalletPanel").classList.toggle("hidden", isCash);
  $("#ewTitle").textContent = payMethod+" — Payment Details";
  renderAcctInfo();
  validateCheckout();
});
/* show the store's linked account for the selected payment method */
function payAccount(method){
  const a = settings.payAccounts || {};
  if(method==="GCash")  return a.gcashNum  ? { label:"GCash",  num:a.gcashNum,  name:a.gcashName  || "" } : null;
  if(method==="Maya")   return a.mayaNum   ? { label:"Maya",   num:a.mayaNum,   name:a.mayaName   || "" } : null;
  if(method==="GoTyme") return a.gotymeNum ? { label:"GoTyme", num:a.gotymeNum, name:a.gotymeName || "" } : null;
  if(method==="Bank Transfer") return (a.bankNum || a.bankName) ? { label:a.bankName || "Bank", num:a.bankNum || "", name:a.bankAcct || "" } : null;
  return null;
}
function renderAcctInfo(){
  const box = $("#acctInfo");
  const a = payMethod && payMethod !== "Cash" ? payAccount(payMethod) : null;
  if(!a){ box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.classList.remove("hidden");
  box.innerHTML = `<b>Send payment to:</b><br>${a.label} ${a.num ? "— <b>"+a.num+"</b>" : ""}${a.name ? "<br>Account name: <b>"+a.name+"</b>" : ""}`;
}
$("#tenderedInput").oninput = ()=>{
  const t = totals(); const tendered = +$("#tenderedInput").value || 0;
  $("#changeOut").textContent = peso(Math.max(0, tendered - t.total));
  validateCheckout();
};
$("#refInput").oninput = validateCheckout;
$$("#cashPanel .chip[data-cash]").forEach(c=>c.onclick=()=>{
  $("#tenderedInput").value = c.dataset.cash; $("#tenderedInput").dispatchEvent(new Event("input"));
});
$("#exactBtn").onclick = ()=>{ $("#tenderedInput").value = totals().total.toFixed(2); $("#tenderedInput").dispatchEvent(new Event("input")); };

function validateCheckout(){
  let ok = !!payMethod;
  if(ok && payMethod==="Cash") ok = +$("#tenderedInput").value >= totals().total - 0.001;
  else if(ok) ok = $("#refInput").value.trim().length >= 4;
  $("#completeBtn").disabled = !ok;
}

$("#completeBtn").onclick = ()=>{
  const t = totals();
  const sale = {
    id: uid(),
    receipt: "R" + String(uid()).slice(-8),
    date: new Date().toISOString(),
    cashier: currentUser().name,
    customer: "",
    items: cart.map(i=>({name:i.name,qty:i.qty,price:i.price,cost:i.cost})),
    subtotal:t.sub, discount:t.disc, discountPct, vat:t.vat, total:t.total,
    payment: payMethod,
    tendered: payMethod==="Cash" ? +$("#tenderedInput").value : t.total,
    change: payMethod==="Cash" ? (+$("#tenderedInput").value - t.total) : 0,
    ref: payMethod==="Cash" ? "" : $("#refInput").value.trim(),
    sender: payMethod==="Cash" ? "" : $("#senderInput").value.trim()
  };
  // deduct stock
  cart.forEach(i=>{ const p = products.find(x=>x.id===i.id); if(p) p.stock = Math.max(0,p.stock - i.qty); });
  saveProducts();
  sales.push(sale); saveSales(); syncSales(); syncCatalog();
  cart=[]; discountPct=0; syncChips(); renderCart(); renderProducts(); renderDashboard();
  closeModals();
  showReceipt(sale);
};

/* ---------- RECEIPT ---------- */
function showReceipt(s){
  const rows = s.items.map(i=>`
    <tr><td>${i.name}<br>&nbsp;&nbsp;${i.qty} x ${peso(i.price)}</td><td style="text-align:right">${peso(i.qty*i.price)}</td></tr>`).join("");
  const acct = s.payment!=="Cash" ? payAccount(s.payment) : null;
  $("#receipt").innerHTML = `
    ${settings.logo?`<div class="rc"><img src="${settings.logo}" alt="logo"></div>`:""}
    <h2>${settings.name}</h2>
    <div class="rc">${settings.address}<br>${settings.phone}</div>
    <hr>
    <div>Receipt: ${s.receipt}</div>
    <div>Date: ${new Date(s.date).toLocaleString("en-PH")}</div>
    <div>Cashier: ${s.cashier}</div>
    ${s.online?`<hr><div><b>DELIVER TO:</b><br>${s.customer||""}${s.delivery?"<br>PHONE: "+(s.delivery.phone||"")+"<br>ADDR: "+(s.delivery.address||"")+(s.delivery.notes?"<br>NOTE: "+s.delivery.notes:""):""}</div>`:""}
    <hr>
    <table>${rows}</table>
    <hr>
    <table>
      <tr><td>Subtotal</td><td style="text-align:right">${peso(s.subtotal)}</td></tr>
      ${s.deliveryFee?`<tr><td>Delivery fee</td><td style="text-align:right">${peso(s.deliveryFee)}</td></tr>`:""}
      ${s.discount?`<tr><td>Discount ${s.discountPct}%</td><td style="text-align:right">−${peso(s.discount)}</td></tr>`:""}
      ${s.vat?`<tr><td>VAT</td><td style="text-align:right">${peso(s.vat)}</td></tr>`:""}
      <tr><td class="grand">TOTAL</td><td class="grand">${peso(s.total)}</td></tr>
      <tr><td>${payEmoji(s.payment)} ${s.payment}</td><td style="text-align:right">${peso(s.tendered)}</td></tr>
      ${s.payment==="Cash"?`<tr><td>Change</td><td style="text-align:right">${peso(s.change)}</td></tr>`
        :`<tr><td colspan="2">Ref#: ${s.ref}${s.sender?" / "+s.sender:""}</td></tr>`}
      ${acct?`<tr><td colspan="2">Paid to: ${acct.label}${acct.num?" "+acct.num:""}${acct.name?" — "+acct.name:""}</td></tr>`:""}
      ${s.refunded?`<tr><td colspan="2" class="grand">*** REFUNDED ***</td></tr>`:""}
    </table>
    <hr>
    <div class="rc">${settings.footer}<br>— ${settings.name} —</div>`;
  lastShownSale = s;
  openModal("#receiptModal");
}
let lastShownSale = null;
$("#printBtn").onclick = ()=>window.print();

/* ---------- Bluetooth thermal printer (ESC/POS, Android Chrome) ---------- */
const ESCPOS = {
  txt: s => Array.from(new TextEncoder().encode(s)),
  init: () => [0x1B, 0x40],
  center: () => [0x1B, 0x61, 0x01],
  left: () => [0x1B, 0x61, 0x00],
  big: on => [0x1B, 0x21, on ? 0x30 : 0x00],
  feed: n => [0x0A, ...Array(n-1).fill(0x0A)],
  cut: () => [0x1D, 0x56, 0x00]
};
function receiptLines(s){
  const W = 32;
  const P = n => "P" + (Math.round(n*100)/100).toFixed(2);
  const row = (l, r) => { l = String(l); r = String(r); return l.slice(0, W - r.length - 1) + " ".repeat(Math.max(1, W - l.length - r.length)) + r; };
  const rule = () => "-".repeat(W);
  const L = [];
  L.push({ c: true, big: true, t: settings.name });
  if(settings.address) L.push({ c: true, t: settings.address });
  if(settings.phone) L.push({ c: true, t: settings.phone });
  L.push({ t: rule() });
  L.push({ t: "Receipt: " + s.receipt });
  L.push({ t: new Date(s.date).toLocaleString("en-PH") });
  L.push({ t: "Cashier: " + s.cashier });
  if(s.online && s.customer){ L.push({ t: "DELIVER TO: " + s.customer }); if(s.delivery && s.delivery.address) L.push({ t: s.delivery.address.slice(0, W) }); }
  L.push({ t: rule() });
  s.items.forEach(i => {
    L.push({ t: i.name.slice(0, W) });
    L.push({ t: row("  " + i.qty + " x " + P(i.price), P(i.qty * i.price)) });
  });
  L.push({ t: rule() });
  L.push({ t: row("SUBTOTAL", P(s.subtotal)) });
  if(s.deliveryFee) L.push({ t: row("DELIVERY FEE", P(s.deliveryFee)) });
  if(s.discount) L.push({ t: row("DISCOUNT " + s.discountPct + "%", "-" + P(s.discount)) });
  if(s.vat) L.push({ t: row("VAT", P(s.vat)) });
  L.push({ t: row("TOTAL", P(s.total)), big: true });
  L.push({ t: row(s.payment, P(s.tendered)) });
  if(s.payment === "Cash") L.push({ t: row("CHANGE", P(s.change)) });
  else L.push({ t: "Ref#: " + (s.ref || "-") });
  L.push({ t: rule() });
  if(settings.footer) L.push({ c: true, t: settings.footer.slice(0, W) });
  L.push({ c: true, t: "** " + settings.name + " **" });
  if(s.refunded) L.push({ c: true, big: true, t: "* REFUNDED *" });
  return L;
}
$("#btPrintBtn").onclick = async ()=>{
  const s = lastShownSale;
  if(!s) return toast("Open a receipt first", true);
  if(!navigator.bluetooth) return toast("Bluetooth printing works on Android Chrome. On other devices use the Print button.", true);
  try{
    toast("Pick your thermal printer...");
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x18F0] }], optionalServices: [0x18F0] });
    toast("Connecting to " + (device.name || "printer") + "...");
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(0x18F0);
    const ch = await service.getCharacteristic(0x2AF1);
    let bytes = ESCPOS.init();
    receiptLines(s).forEach(ln => {
      bytes = bytes.concat(ln.c ? ESCPOS.center() : ESCPOS.left());
      if(ln.big) bytes = bytes.concat(ESCPOS.big(true));
      bytes = bytes.concat(ESCPOS.txt(ln.t + "\n"));
      if(ln.big) bytes = bytes.concat(ESCPOS.big(false));
    });
    bytes = bytes.concat(ESCPOS.center(), ESCPOS.feed(4), ESCPOS.cut());
    for(let i = 0; i < bytes.length; i += 100){
      await ch.writeValue(new Uint8Array(bytes.slice(i, i + 100)));
      await new Promise(r => setTimeout(r, 40));
    }
    toast("Receipt printed " + String.fromCodePoint(9989));
  }catch(e){
    toast(e.message && e.message.includes("cancel") ? "Cancelled" : "Printing failed: " + (e.message || "check printer"), true);
  }
};

/* ---------- INVENTORY ---------- */
function renderInventory(){
  const q = $("#invSearch").value.toLowerCase();
  $("#invBody").innerHTML = products
    .filter(p=>!q || p.name.toLowerCase().includes(q) || p.cat.toLowerCase().includes(q))
    .map(p=>{
      const cls = p.stock<=0?"bad":p.stock<=p.low?"warn":"ok";
      const lbl = p.stock<=0?"Out":p.stock<=p.low?"Low":"In Stock";
      return `<tr>
        <td>${p.emoji||"📦"} <b>${p.name}</b></td>
        <td>${p.cat}</td><td>${peso(p.price)}</td><td class="muted">${peso(p.cost)}</td>
        <td><span class="pill ${cls}">${p.stock} — ${lbl}</span></td>
        <td class="muted">${p.barcode||"—"}</td>
        <td><button class="btn-ghost sm" data-edit="${p.id}">✏️ Edit</button>
            <button class="btn-ghost sm" data-del="${p.id}">🗑</button></td>
      </tr>`;}).join("");
  $$("#invBody [data-edit]").forEach(b=>b.onclick=()=>openProductModal(+b.dataset.edit));
  $$("#invBody [data-del]").forEach(b=>b.onclick=async ()=>{
    const p = products.find(x=>x.id===+b.dataset.del);
    if(currentUser().role !== "owner" && !await ownerGate(`Deleting "${p.name}" requires the OWNER PIN`)) return;
    if(confirm(`Delete "${p.name}" from inventory?`)){
      products = products.filter(x=>x.id!==p.id); saveProducts(); syncCatalog();
      renderInventory(); renderProducts(); refreshCats(); renderDashboard(); toast("Product deleted");
    }
  });
}
$("#invSearch").oninput = renderInventory;

/* ---------- STOCK IN (receiving & supplier ledger) ---------- */
function renderStockIn(){
  const owed = suppliers.reduce((a,s)=>a+Math.max(0, (s.total||0)-(s.paid||0)), 0);
  $("#siOwed").textContent = peso(owed);
  $("#siSuppCount").textContent = suppliers.length + " suppliers";
  $("#siCount").textContent = stockins.length;
  $("#suppList").innerHTML = suppliers.map(s=>`<option value="${s.name}">`).join("");
  $("#prodList2").innerHTML = products.map(p=>`<option value="${p.name}">`).join("");
  $("#suppBody").innerHTML = suppliers.length ? suppliers.map(s=>{
    const bal = (s.total||0) - (s.paid||0);
    return `<div class="cashier-row">
      <span>🚚 ${s.name}<br><small class="muted">bought ${peso(s.total||0)} · paid ${peso(s.paid||0)}</small></span>
      <span><span class="pill ${bal>0?"warn":"ok"}">${bal>0?peso(bal)+" owed":"paid"}</span>
        <button class="btn-primary sm" data-spay="${s.id}">💵 Pay</button></span>
    </div>`;
  }).join("") : `<p class="muted">No suppliers yet — record your first delivery on the left.</p>`;
  $$("#suppBody [data-spay]").forEach(b=>b.onclick=async ()=>{
    const s = suppliers.find(x=>x.id===+b.dataset.spay);
    const v = await inputModal(`Payment to ${s.name} — balance ${peso((s.total||0)-(s.paid||0))}`, "Amount paid");
    if(v === null) return;
    const amt = parseFloat(v);
    if(!(amt > 0)){ toast("Enter a valid amount", true); return; }
    const applied = Math.min(amt, (s.total||0)-(s.paid||0));
    s.paid = (s.paid||0) + applied;
    (s.history=s.history||[]).unshift({ date:Date.now(), type:"bayad", amount:applied });
    saveSuppliers(); renderStockIn();
    toast(`Paid ${s.name} ${peso(applied)} ${String.fromCodePoint(9989)}`);
  });
  $("#siHistory").innerHTML = stockins.length ? stockins.slice(0,15).map(h=>`
    <div class="cashier-row">
      <span>${new Date(h.date).toLocaleString("en-PH")} — <b>${h.qty}x ${h.product}</b> from ${h.supplier}</span>
      <b>${peso(h.total)}${h.paid < h.total ? ` <span class="pill warn">owed ${peso(h.total-h.paid)}</span>` : ' <span class="pill ok">paid</span>'}</b>
    </div>`).join("") : `<p class="muted">No stock-ins recorded yet.</p>`;
}
$("#siQty").oninput = $("#siCost").oninput = ()=>{
  $("#siTotal").value = peso(((+$("#siQty").value)||0) * ((+$("#siCost").value)||0));
};
$("#siSaveBtn").onclick = async ()=>{
  if(currentUser().role !== "owner" && !await ownerGate("Recording stock-in requires the OWNER PIN")) return;
  const pname = $("#siProduct").value.trim();
  const p = products.find(x=>x.name.toLowerCase() === pname.toLowerCase());
  if(!p) return toast("Choose a product from your inventory (add it first if new)", true);
  const qty = parseInt($("#siQty").value), cost = parseFloat($("#siCost").value);
  if(!(qty > 0) || !(cost >= 0)) return toast("Enter quantity and unit cost", true);
  const total = Math.round(qty * cost * 100) / 100;
  const paid = Math.min(Math.max(0, parseFloat($("#siPaid").value) || 0), total);
  const sname = $("#siSupplier").value.trim() || "Walk-in";
  let s = suppliers.find(x=>x.name.toLowerCase() === sname.toLowerCase());
  if(!s){ s = { id:uid(), name:sname, total:0, paid:0, history:[] }; suppliers.push(s); }
  s.total += total; s.paid += paid;
  s.history.unshift({ date:Date.now(), type:"delivery", amount:total, paid, note:`${qty}x ${p.name}` });
  p.stock += qty; if(cost > 0) p.cost = cost; // latest unit cost = true cost for profit reports
  stockins.unshift({ date:Date.now(), supplier:s.name, product:p.name, qty, cost, total, paid });
  saveSuppliers(); saveStockins(); saveProducts(); syncCatalog();
  renderStockIn(); renderProducts(); renderInventory(); renderDashboard();
  $("#siQty").value = ""; $("#siCost").value = ""; $("#siPaid").value = "0"; $("#siTotal").value = "";
  toast(`Stock-in saved: ${qty}x ${p.name} ${String.fromCodePoint(9989)}`);
};

/* ---------- CSV import / export of products ---------- */
function csvCell(v){ return '"' + String(v == null ? "" : v).replace(/"/g,'""') + '"'; }
$("#exportInvBtn").onclick = ()=>{
  const NL = String.fromCharCode(10);
  let csv = "name,category,price,cost,stock,low,barcode" + NL;
  products.forEach(p => { csv += [p.name, p.cat, p.price, p.cost||0, p.stock, p.low||0, p.barcode||""].map(csvCell).join(",") + NL; });
  download("raepos-products-" + todayStr() + ".csv", csv, "text/csv");
  toast(products.length + " products exported");
};
function parseCSV(text){
  const NL = String.fromCharCode(10), CR = String.fromCharCode(13);
  const rows = []; let row = [], cell = "", inQ = false;
  for(let i = 0; i < text.length; i++){
    const ch = text[i];
    if(inQ){
      if(ch === '"'){ if(text[i+1] === '"'){ cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else {
      if(ch === '"') inQ = true;
      else if(ch === ","){ row.push(cell); cell = ""; }
      else if(ch === NL || ch === CR){ if(ch === CR && text[i+1] === NL) i++; row.push(cell); cell = ""; if(row.some(c=>c !== "")) rows.push(row); row = []; }
      else cell += ch;
    }
  }
  row.push(cell); if(row.some(c=>c !== "")) rows.push(row);
  return rows;
}
$("#importInvBtn").onclick = ()=> $("#importInvFile").click();
$("#importInvFile").addEventListener("change", async e=>{
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if(!f) return;
  if(currentUser().role !== "owner" && !await ownerGate("Importing products requires the OWNER PIN")) return;
  try{
    const rows = parseCSV(await f.text());
    if(rows.length < 2){ toast("The CSV file is empty", true); return; }
    const head = rows[0].map(h=>h.trim().toLowerCase());
    const iName = head.indexOf("name"), iCat = head.indexOf("category"), iPrice = head.indexOf("price"),
          iCost = head.indexOf("cost"), iStock = head.indexOf("stock"), iLow = head.indexOf("low"),
          iBar = head.indexOf("barcode");
    if(iName < 0 || iPrice < 0){ toast("CSV needs 'name' and 'price' columns", true); return; }
    let added = 0, updated = 0;
    rows.slice(1).forEach(r=>{
      const name = (r[iName]||"").trim(); if(!name) return;
      const price = parseFloat(r[iPrice]) || 0; if(price <= 0) return;
      const existing = products.find(p=>p.name.toLowerCase() === name.toLowerCase());
      const info = {
        cat: iCat >= 0 ? (r[iCat]||"Misc").trim() : "Misc",
        price, cost: iCost >= 0 ? (parseFloat(r[iCost])||0) : 0,
        stock: iStock >= 0 ? (parseInt(r[iStock])||0) : 0,
        low: iLow >= 0 ? (parseInt(r[iLow])||5) : 5,
        barcode: iBar >= 0 ? (r[iBar]||"").trim() : ""
      };
      if(existing){ Object.assign(existing, info); updated++; }
      else { products.push(Object.assign({ id:uid(), name, emoji:EMOJIS[Math.floor(Math.random()*EMOJIS.length)] }, info)); added++; }
    });
    if(!added && !updated){ toast("Nothing imported — check the file", true); return; }
    saveProducts(); syncCatalog(); refreshCats();
    renderInventory(); renderProducts(); renderDashboard();
    toast("Imported: " + added + " new, " + updated + " updated");
  }catch(err){ toast("Could not read that CSV file", true); }
});

/* ---------- move to a new device ---------- */
$("#transferUpBtn").onclick = async ()=>{
  if(currentUser().role !== "owner" && !await ownerGate("Uploading for transfer requires the OWNER PIN")) return;
  const lic = DB.get("license", null);
  if(!lic) return toast("No license on this device", true);
  const btn = $("#transferUpBtn"); btn.disabled = true; btn.textContent = "Uploading…";
  try{
    const r = await licApi("transfer", { code: lic.code, products, settings });
    if(r.ok) toast("Uploaded " + r.count + " products! On the new device: Settings > Load Data");
    else toast(r.error || "Upload failed", true);
  }catch(e){ toast("Connection problem", true); }
  btn.disabled = false; btn.textContent = "Upload My Data for Transfer";
};
$("#transferDownBtn").onclick = async ()=>{
  if(currentUser().role !== "owner" && !await ownerGate("Loading from your old device requires the OWNER PIN")) return;
  const lic = DB.get("license", null);
  if(!lic) return toast("No license on this device", true);
  if(!confirm("Replace THIS device's products and store settings with the data from your old device? Current data will be overwritten.")) return;
  try{
    const r = await licApi("transfer/get", { code: lic.code });
    if(!r.ok) return toast(r.error || "Nothing found", true);
    products = r.products; saveProducts();
    if(r.settings && Object.keys(r.settings).length){ Object.assign(settings, r.settings); saveSettings(); }
    toast("Data loaded — reloading…");
    setTimeout(()=>location.reload(), 1200);
  }catch(e){ toast("Connection problem", true); }
};
$("#addProductBtn").onclick = ()=>openProductModal(null);

let pmImgData = "";
function renderPmImg(){
  $("#pmImgBox").innerHTML = pmImgData ? `<img src="${pmImgData}" alt="">` : "🖼️";
}
function openProductModal(id){
  editingId = id;
  const p = id ? products.find(x=>x.id===id) : null;
  $("#pmTitle").textContent = p ? "Edit Product" : "Add Product";
  $("#pmName").value = p?p.name:""; $("#pmCat").value = p?p.cat:"";
  $("#pmBarcode").value = p?p.barcode||"":"";
  $("#pmPrice").value = p?p.price:""; $("#pmCost").value = p?p.cost||0:"";
  $("#pmStock").value = p?p.stock:0; $("#pmLow").value = p?p.low||5:5;
  pmImgData = p ? (p.img||"") : "";
  renderPmImg();
  openModal("#productModal");
}
$("#pmImg").addEventListener("change", e=>{
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  fileToDataUrl(f, dataUrl=>{ pmImgData = dataUrl; renderPmImg(); e.target.value=""; }, 220);
});
$("#pmImgRemove").onclick = ()=>{ pmImgData = ""; renderPmImg(); };
$("#pmSave").onclick = ()=>{
  const name = $("#pmName").value.trim(), cat = $("#pmCat").value.trim(),
        price = +$("#pmPrice").value, stock = +$("#pmStock").value;
  if(!name || !cat || !(price>0) || isNaN(stock)){ toast("Fill in name, category, price and stock", true); return; }
  if(editingId){
    Object.assign(products.find(x=>x.id===editingId), {
      name, cat, price, cost:+$("#pmCost").value||0, stock,
      low:+$("#pmLow").value||0, barcode:$("#pmBarcode").value.trim(), img:pmImgData
    });
    toast("Product updated");
  } else {
    products.push({ id:uid(), name, cat, price, cost:+$("#pmCost").value||0, stock,
      low:+$("#pmLow").value||0, barcode:$("#pmBarcode").value.trim(), img:pmImgData,
      emoji:EMOJIS[Math.floor(Math.random()*EMOJIS.length)] });
    toast("Product added");
  }
  saveProducts(); closeModals(); syncCatalog();
  renderInventory(); renderProducts(); refreshCats(); renderDashboard();
};

/* ---------- SALES HISTORY ---------- */
function renderSales(from, to){
  const f = from || $("#salesFrom").value, t = to || $("#salesTo").value;
  const list = sales.filter(s=>{
    const d = s.date.slice(0,10);
    return (!f || d>=f) && (!t || d<=t);
  }).slice().reverse();
  $("#salesBody").innerHTML = list.length ? list.map(s=>`
    <tr>
      <td><b>${s.receipt}</b></td>
      <td>${new Date(s.date).toLocaleString("en-PH")}</td>
      <td>${s.items.reduce((a,i)=>a+i.qty,0)} items</td>
      <td>${s.refunded?'<span class="pill bad">REFUNDED</span>':`<span class="pill pay">${payEmoji(s.payment)} ${s.payment}</span>`}</td>
      <td>${s.discountPct? s.discountPct+"%":"—"}</td>
      <td><b>${peso(s.total)}</b></td>
      <td><button class="btn-ghost sm" data-view="${s.id}">🧾 View</button>
          ${!s.refunded?`<button class="btn-danger sm" data-refund="${s.id}">↩</button>`:""}
          <button class="btn-danger sm" data-delsale="${s.id}">🗑</button></td>
    </tr>`).join("")
    : `<tr><td colspan="7" class="muted" style="text-align:center;padding:30px">No sales in this range.</td></tr>`;
  $$("#salesBody [data-view]").forEach(b=>b.onclick=()=>showReceipt(sales.find(s=>s.id===+b.dataset.view)));
  $$("#salesBody [data-delsale]").forEach(b=>b.onclick=async ()=>{
    const s = sales.find(x=>x.id===+b.dataset.delsale);
    if(!s) return;
    if(!confirm(`PERMANENTLY DELETE receipt ${s.receipt} (${peso(s.total)})?
This erases the record. Use the refund button if you only want to reverse it.`)) return;
    if(!await ownerGate("Deleting a sales record requires the OWNER PIN")) return;
    sales = sales.filter(x=>x.id!==s.id); saveSales();
    DB.set("syncedIds", DB.get("syncedIds",[]).filter(i=>i!==s.id));
    renderSales(); renderDashboard(); syncSales();
    toast("Sales record deleted");
  });
  $$("#salesBody [data-refund]").forEach(b=>b.onclick=async ()=>{
    const s = sales.find(x=>x.id===+b.dataset.refund);
    if(!s || s.refunded) return;
    if(!confirm(`Refund receipt ${s.receipt} (${peso(s.total)})? Items return to stock.`)) return;
    refundSale(s.id);
  });
}
async function refundSale(id){
  if(!await ownerGate("Refunding a sale requires the OWNER PIN")) return;
  const s = sales.find(x=>x.id===id);
  if(!s || s.refunded) return;
  s.refunded = true; s.refundDate = Date.now();
  s.items.forEach(i=>{ const p = products.find(x=>x.name===i.name); if(p) p.stock += i.qty; });
  saveSales(); saveProducts();
  DB.set("syncedIds", DB.get("syncedIds",[]).filter(i=>i!==s.id)); // resync the change
  renderSales(); renderProducts(); renderDashboard(); syncSales(); syncCatalog();
  toast("Sale refunded — stock returned ↩");
}
$("#salesFilterBtn").onclick = ()=>renderSales();
$("#salesTodayBtn").onclick = ()=>{ $("#salesFrom").value = todayStr(); $("#salesTo").value = todayStr(); renderSales(); };

/* ---------- REPORTS ---------- */
function renderReports(){
  const ls = liveSales();
  const total = ls.reduce((a,s)=>a+s.total,0);
  const profit = ls.reduce((a,s)=>a+s.items.reduce((x,i)=>x+(i.price-(i.cost||0))*i.qty,0),0);
  const invVal = products.reduce((a,p)=>a+(p.cost||0)*p.stock,0);
  $("#repTotal").textContent = peso(total);
  $("#repCount").textContent = ls.length + " transactions";
  $("#repProfit").textContent = peso(profit);
  $("#repInvValue").textContent = peso(invVal);
  $("#repProdCount").textContent = products.length;

  const mix = {}; ls.forEach(s=>mix[s.payment]=(mix[s.payment]||0)+s.total);
  const mx = Math.max(...Object.values(mix),1);
  $("#repPayMix").innerHTML = Object.keys(mix).length
    ? Object.entries(mix).map(([k,v])=>`<div class="mix-row"><span>${payEmoji(k)} ${k}</span>
      <div class="mix-bar"><div class="mix-fill" style="width:${v/mx*100}%"></div></div>
      <b style="text-align:right">${peso(v)}</b></div>`).join("")
    : `<p class="muted">No sales yet.</p>`;

  const days = [];
  for(let i=6;i>=0;i--){ const d = new Date(); d.setDate(d.getDate()-i);
    const ds = d.toISOString().slice(0,10);
    days.push([ds, liveSales().filter(s=>s.date.startsWith(ds)).reduce((a,s)=>a+s.total,0)]);
  }
  const dm = Math.max(...days.map(d=>d[1]),1);
  $("#repDaily").innerHTML = days.map(([d,v])=>`<div class="mix-row">
    <span>${new Date(d+"T12:00").toLocaleDateString("en-PH",{month:"short",day:"numeric"})}</span>
    <div class="mix-bar"><div class="mix-fill" style="width:${v/dm*100}%"></div></div>
    <b style="text-align:right">${peso(v)}</b></div>`).join("");
}
$("#exportCsvBtn").onclick = ()=>{
  let csv = "Receipt,Date,Cashier,Payment,Customer,Reference,Discount %,Subtotal,Discount,VAT,Total,Refunded\n";
  sales.forEach(s=>{ csv += [s.receipt,s.date,s.cashier,s.payment,s.customer||"",s.ref,s.discountPct,s.subtotal,s.discount,s.vat,s.total,s.refunded?"YES":""]
    .map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")+"\n"; });
  download("novapos-sales.csv", csv, "text/csv");
};
$("#exportJsonBtn").onclick = ()=>{
  download("novapos-backup.json", JSON.stringify({products,sales,settings},null,2), "application/json");
};
function download(name, content, type){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content],{type}));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
  toast("Download started");
}

/* ---------- SETTINGS ---------- */
function loadSettingsForm(){
  $("#setName").value=settings.name; $("#setAddress").value=settings.address;
  $("#setPhone").value=settings.phone; $("#setCashier").value=settings.cashier;
  $("#setVat").value=settings.vat; $("#setFooter").value=settings.footer;
  const a = settings.payAccounts || {};
  $("#setGcashNum").value=a.gcashNum||"";  $("#setGcashName").value=a.gcashName||"";
  $("#setMayaNum").value=a.mayaNum||"";    $("#setMayaName").value=a.mayaName||"";
  $("#setGotymeNum").value=a.gotymeNum||"";$("#setGotymeName").value=a.gotymeName||"";
  $("#setBankName").value=a.bankName||"";  $("#setBankNum").value=a.bankNum||""; $("#setBankAcct").value=a.bankAcct||"";
}
$("#saveSettingsBtn").onclick = ()=>{
  Object.assign(settings,{
    name:$("#setName").value.trim()||"My Store", address:$("#setAddress").value.trim(),
    phone:$("#setPhone").value.trim(), cashier:$("#setCashier").value.trim()||"Cashier",
    vat:+$("#setVat").value||0, footer:$("#setFooter").value.trim()
  });
  settings.payAccounts = {
    gcashNum:$("#setGcashNum").value.trim(),  gcashName:$("#setGcashName").value.trim(),
    mayaNum:$("#setMayaNum").value.trim(),    mayaName:$("#setMayaName").value.trim(),
    gotymeNum:$("#setGotymeNum").value.trim(),gotymeName:$("#setGotymeName").value.trim(),
    bankName:$("#setBankName").value.trim(),  bankNum:$("#setBankNum").value.trim(), bankAcct:$("#setBankAcct").value.trim()
  };
  saveSettings(); refreshFoot(); loadSettingsForm(); updateTotals(); syncCatalog(); toast("Settings saved");
};
$("#savePinBtn").onclick = async ()=>{
  if(!await ownerGate("Changing the Owner PIN requires the OWNER PIN")) return;
  const p = $("#setPin").value.trim();
  if(!/^\d{4,6}$/.test(p)){ toast("PIN must be 4–6 digits", true); return; }
  settings.pin = p; saveSettings(); $("#setPin").value=""; toast("PIN changed");
};
$("#resetAllBtn").onclick = async ()=>{
  if(!await ownerGate("Resetting ALL DATA requires the OWNER PIN")) return;
  if(confirm("This will ERASE ALL products, sales and settings. Continue?") &&
     confirm("Are you 100% sure? This cannot be undone.")){
    Object.keys(localStorage).filter(k=>k.startsWith("novapos_")).forEach(k=>localStorage.removeItem(k));
    location.reload();
  }
};

/* ---------- store logo (client-editable) ---------- */
function applyLogo(){
  const src = settings.logo || "";
  $(".brand-mark").innerHTML = src ? `<img src="${src}" alt="logo">` : "◆";
  $(".login-logo").innerHTML = src ? `<img src="${src}" alt="logo">` : "◆";
  $("#logoBox").innerHTML    = src ? `<img src="${src}" alt="logo">` : "◆";
}
$("#setLogo").addEventListener("change", e=>{
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  if(!f.type.startsWith("image/")){ toast("Please choose an image file", true); return; }
  const rd = new FileReader();
  rd.onload = ()=>{
    const img = new Image();
    img.onload = ()=>{
      // shrink to max 300px so it fits comfortably in local storage
      const MAX = 300, sc = Math.min(1, MAX / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(img.width * sc));
      cv.height = Math.max(1, Math.round(img.height * sc));
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      settings.logo = cv.toDataURL(f.type === "image/png" ? "image/png" : "image/jpeg", 0.85);
      saveSettings(); applyLogo();
      toast("Logo saved — it will print on receipts 🖼️");
      e.target.value = "";
    };
    img.onerror = ()=>toast("Could not read that image", true);
    img.src = rd.result;
  };
  rd.onerror = ()=>toast("Could not open that file", true);
  rd.readAsDataURL(f);
});
$("#removeLogoBtn").onclick = ()=>{ settings.logo = ""; saveSettings(); applyLogo(); toast("Logo removed"); };

$("#deactivateBtn").onclick = async ()=>{
  if(!await ownerGate("Deactivating the license requires the OWNER PIN")) return;
  if(confirm("Remove the license from this device? You'll need the activation code again to use the POS.")){
    DB.set("license", null); location.reload();
  }
};

/* ---------- Z-READING / CLOSE SHIFT ---------- */
const shiftSales = () => sales.filter(s=>!s.refunded && new Date(s.date).getTime() >= shiftStart);
const shiftRefunds = () => sales.filter(s=>s.refunded && s.refundDate >= shiftStart);
$("#zBtn").onclick = ()=>{ buildZ(false); openModal("#zModal"); };
function buildZ(final){
  const ss = shiftSales(), rs = shiftRefunds();
  const byPay = {}; ss.forEach(s=>byPay[s.payment]=(byPay[s.payment]||0)+s.total);
  const byCashier = {}; ss.forEach(s=>byCashier[s.cashier]=(byCashier[s.cashier]||0)+s.total);
  const gross = ss.reduce((a,s)=>a+s.total,0);
  const refunded = rs.reduce((a,s)=>a+s.total,0);
  $("#zReport").innerHTML = `
    ${settings.logo?`<div class="rc"><img src="${settings.logo}" alt="logo"></div>`:""}
    <h2>${settings.name}</h2>
    <div class="rc">Z-READING ${final?"— SHIFT CLOSED":""}</div>
    <hr>
    <div>Shift start: ${new Date(shiftStart).toLocaleString("en-PH")}</div>
    <div>Printed&nbsp;&nbsp;: ${new Date().toLocaleString("en-PH")}</div>
    <hr>
    <table>
      ${Object.entries(byPay).map(([k,v])=>`<tr><td>${payEmoji(k)} ${k}</td><td style="text-align:right">${peso(v)}</td></tr>`).join("")}
      <tr><td>Gross sales (${ss.length} tx)</td><td style="text-align:right">${peso(gross)}</td></tr>
      <tr><td>Refunds (${rs.length})</td><td style="text-align:right">−${peso(refunded)}</td></tr>
      <tr><td class="grand">NET SALES</td><td class="grand">${peso(gross - refunded)}</td></tr>
      ${byPay.Cash?`<tr><td><b>Expected cash in drawer</b></td><td style="text-align:right"><b>${peso(byPay.Cash)}</b></td></tr>`:""}
    </table>
    <hr>
    <table>${Object.entries(byCashier).map(([c,v])=>`<tr><td>Cashier: ${c}</td><td style="text-align:right">${peso(v)}</td></tr>`).join("")}</table>
    <hr>
    <div class="rc">${settings.footer}<br>— ${settings.name} —</div>`;
}
$("#zPrintBtn").onclick = ()=>window.print();
$("#zCloseShiftBtn").onclick = async ()=>{
  if(!await ownerGate("Closing the shift requires the OWNER PIN")) return;
  buildZ(true);
  shifts.push({ id:uid(), start:shiftStart, end:Date.now() });
  shiftStart = Date.now(); DB.set("shiftStart", shiftStart);
  saveShifts(); refreshFoot();
  toast("Shift closed — new shift started ✅");
};

/* ---------- sales sync to license server (auto-backup) ---------- */
function syncSales(){
  const lic = DB.get("license", null);
  if(!lic || !licServer()) return;
  const synced = DB.get("syncedIds", []);
  const unsynced = sales.filter(s=>!synced.includes(s.id));
  if(!unsynced.length) return;
  licApi("sync", { code: lic.code, sales: unsynced.map(s=>({id:s.id, date:s.date, total:s.total, payment:s.payment, refunded:!!s.refunded})) })
    .then(r=>{ if(r.ok) DB.set("syncedIds", sales.map(s=>s.id)); })
    .catch(()=>{/* offline — retried on next sale/check */});
}

/* ---------- online store & delivery ---------- */
let onlineOrders = [];
function shopLink(){
  const lic = DB.get("license", null);
  return lic && licServer() ? licServer().replace(/\/$/,"") + "/shop/" + lic.code : "";
}
function syncCatalog(){
  const lic = DB.get("license", null);
  if(!lic || !licServer()) return;
  const a = settings.payAccounts || {};
  licApi("catalog", {
    code: lic.code,
    online: !!settings.onlineStore,
    products: products.filter(p=>p.stock>0).map(p=>({name:p.name, price:p.price, emoji:p.emoji||"📦", stock:p.stock, img:p.img||""})),
    store: { name:settings.name, logo:settings.logo||"", address:settings.address, phone:settings.phone,
             gcash:a.gcashNum||"", gcashName:a.gcashName||"", qr:settings.qr||"", deliveryFee:settings.deliveryFee||0 }
  }).catch(()=>{});
}
function renderOnline(){
  $("#shopLink").value = shopLink();
  $("#feeInput").value = settings.deliveryFee || 0;
  const on = !!settings.onlineStore;
  $("#onlineStatus").innerHTML = on
    ? '🟢 <b style="color:var(--ok)">ONLINE</b> — customers can order from your link right now.'
    : '⚪ <b>OFFLINE</b> — your online store link shows "closed".';
  const btn = $("#onlineToggleBtn");
  btn.textContent = on ? "🔴 Go Offline" : "🟢 Go Online";
  btn.className = on ? "btn-danger btn-block" : "btn-primary btn-block";
}
$("#onlineToggleBtn").onclick = async ()=>{
  if(currentUser().role !== "owner" && !await ownerGate("Going online/offline requires the OWNER PIN")) return;
  settings.onlineStore = !settings.onlineStore;
  saveSettings(); renderOnline(); syncCatalog();
  toast(settings.onlineStore ? "You're ONLINE — orders can come in 🌐" : "Store is now offline");
};
$("#copyLinkBtn").onclick = ()=>{
  if(!shopLink()) return toast("No license / server link yet", true);
  navigator.clipboard.writeText(shopLink()).then(()=>toast("Store link copied — share it! 📋"));
};
$("#saveFeeBtn").onclick = async ()=>{
  if(currentUser().role !== "owner" && !await ownerGate("Changing the delivery fee requires the OWNER PIN")) return;
  const v = $("#feeInput").value;
  if(v === "" || isNaN(+v) || +v < 0){ toast("Enter a valid fee (0 for free delivery)", true); return; }
  settings.deliveryFee = Math.round(+v * 100) / 100;
  saveSettings(); syncCatalog();
  toast(settings.deliveryFee ? "Delivery fee set to " + peso(settings.deliveryFee) : "Free delivery set");
};
async function pollOrders(silent=true){
  const lic = DB.get("license", null);
  if(!lic || !licServer()) return;
  try{
    const r = await licApi("orders", { code: lic.code });
    if(!r.ok) return;
    onlineOrders = r.orders || [];
    // notify about unseen new orders
    const seen = DB.get("seenOrderIds", []);
    onlineOrders.filter(o=>o.status==="new" && !seen.includes(o.id)).forEach(o=>{
      if(!silent) toast(`🌐 New online order ${o.id} — ${peso(o.total)}!`);
      seen.push(o.id);
    });
    if(onlineOrders.length) DB.set("seenOrderIds", seen.slice(-200));
    renderOrders();
  }catch(e){}
}
function renderOrders(){
  const badge = $("#ordersBadge");
  const news = onlineOrders.filter(o=>o.status==="new").length;
  if(news){ badge.textContent = news; badge.classList.remove("hidden"); } else badge.classList.add("hidden");
  const label = { new:"🆕 NEW", preparing:"👨‍🍳 Preparing", delivering:"🛵 Out for delivery", done:"✅ Delivered", rejected:"❌ Rejected" };
  const pillCls = { new:"ok", preparing:"warn", delivering:"warn", done:"ok", rejected:"bad" };
  $("#ordersList").innerHTML = onlineOrders.length ? onlineOrders.map(o=>`
    <div class="order-card ${o.status==="new"?"new":""}">
      <div class="order-head">
        <span><b>${o.id}</b> · ${new Date(o.ts).toLocaleString("en-PH")}</span>
        <span class="pill ${pillCls[o.status]||""}">${label[o.status]||o.status}</span>
      </div>
      <div class="order-items">${o.items.map(i=>`${i.qty}× ${i.name} — ${peso(i.qty*i.price)}`).join("<br>")}
        <br><b>Total: ${peso(o.total)}${o.fee?` (incl. ${peso(o.fee)} delivery)`: ""} · ${o.payment==="GCash"?"🔵 GCash"+(o.ref?" ref "+o.ref:""):"💵 COD"}</b></div>
      <div class="order-addr">👤 ${o.customer.name} · 📞 ${o.customer.phone}<br>📍 ${o.customer.address}${o.customer.notes?"<br>📝 "+o.customer.notes:""}</div>
      <button class="btn-ghost sm" data-track="${o.id}">🔗 Copy Track Link</button>
      ${o.status==="new"?`
        <button class="btn-primary sm" data-ord="accept" data-oid="${o.id}">✔ Accept</button>
        <button class="btn-danger sm" data-ord="reject" data-oid="${o.id}">✖ Reject</button>`:""}
      ${o.status==="preparing"?`<button class="btn-primary sm" data-ord="deliver" data-oid="${o.id}">🛵 Out for Delivery</button>`:""}
      ${o.status==="delivering"?`<button class="btn-primary sm" data-ord="complete" data-oid="${o.id}">✅ Delivered &amp; Paid</button>`:""}
    </div>`).join("")
    : `<p class="muted">No online orders yet.</p>`;
  $$("#ordersList [data-ord]").forEach(b=>b.onclick=()=>orderAction(b.dataset.oid, b.dataset.ord));
  $$("#ordersList [data-track]").forEach(b=>b.onclick=()=>{
    const url = shopLink() + "/order/" + b.dataset.track;
    if(!url.includes("/shop/")) return toast("No server link yet", true);
    navigator.clipboard.writeText(url).then(()=>toast("Track link copied — send it to " + b.dataset.track + " 🔗"));
  });
}
async function orderAction(oid, action){
  const lic = DB.get("license", null);
  if(!lic) return;
  if(action==="reject" && !confirm(`Reject order ${oid}?`)) return;
  try{
    const r = await licApi("orderupdate", { code: lic.code, orderId: oid, action });
    if(!r.ok){ toast(r.error || "Order update failed", true); return; }
    if(action==="accept"){
      const o = onlineOrders.find(x=>x.id===oid);
      if(o){
        // warn owner if stock can't cover every item (e.g. two customers bought the last stock)
        const shortage = o.items
          .map(i=>({name:i.name, need:i.qty, have:(products.find(p=>p.name===i.name)||{stock:0}).stock}))
          .filter(x=>x.have < x.need);
        if(shortage.length){
          const NL = String.fromCharCode(10);
          const msg = "Not enough stock:" + NL + shortage.map(s=>s.name+": need "+s.need+", have "+s.have).join(", ") + NL + NL + "Accept anyway (stock will show 0)?";
          if(!confirm(msg)) return;
        }
        const sale = {
          id: uid(), receipt: "R" + String(uid()).slice(-8), date: new Date().toISOString(),
          cashier: "Online Order", customer: o.customer.name,
          items: o.items.map(i=>({name:i.name, qty:i.qty, price:i.price, cost:(products.find(p=>p.name===i.name)||{}).cost||0})),
          subtotal: o.itemsTotal != null ? o.itemsTotal : o.total - (o.fee||0), discount:0, discountPct:0, vat:0,
          deliveryFee: o.fee || 0, total: o.total,
          payment: o.payment==="GCash" ? "GCash" : "Cash",
          tendered:o.total, change:0, ref:o.ref||"", sender:o.customer.phone,
          online:true, delivery:{ phone:o.customer.phone, address:o.customer.address, notes:o.customer.notes }
        };
        o.items.forEach(i=>{ const p = products.find(x=>x.name===i.name); if(p) p.stock = Math.max(0, p.stock - i.qty); });
        sales.push(sale); saveSales(); saveProducts(); syncSales(); syncCatalog(); renderDashboard();
        toast(`Order ${oid} accepted — recorded as ${sale.receipt} 🧾`);
      }
    } else if(action==="complete") toast(`Order ${oid} delivered ✅`);
    else if(action==="reject") toast(`Order ${oid} rejected`);
    pollOrders(true);
  }catch(e){ toast("Connection problem", true); }
}
function startOrderPolling(){ clearInterval(window._op); window._op = setInterval(()=>pollOrders(true), 45e3); }

/* ---------- owner gate & generic input modal ---------- */
function ownerGate(msg){
  return new Promise(res=>{
    $("#gateMsg").textContent = msg || "This action requires the owner's PIN.";
    $("#gatePin").value = "";
    openModal("#gateModal");
    setTimeout(()=>$("#gatePin").focus(), 50);
    const cleanup = ()=>{ document.removeEventListener("keydown", onKey); };
    const onKey = e => { if(e.key==="Escape"){ cleanup(); closeModals(); res(false); } };
    document.addEventListener("keydown", onKey);
    $("#gateOk").onclick = ()=>{
      if($("#gatePin").value === settings.pin){ cleanup(); closeModals(); res(true); }
      else { toast("Wrong owner PIN", true); $("#gatePin").value=""; }
    };
    $("#gateCancel").onclick = ()=>{ cleanup(); closeModals(); res(false); };
  });
}
function inputModal(title, placeholder){
  return new Promise(res=>{
    $("#imTitle").textContent = title || "";
    const inp = $("#imInput"); inp.value = ""; inp.placeholder = placeholder || "";
    openModal("#inputModal");
    setTimeout(()=>inp.focus(), 50);
    const cleanup = ()=>{ document.removeEventListener("keydown", onKey); };
    const onKey = e => { if(e.key==="Enter"){ const v = inp.value.trim(); cleanup(); closeModals(); res(v); } };
    document.addEventListener("keydown", onKey);
    $("#imOk").onclick = ()=>{ const v = inp.value.trim(); cleanup(); closeModals(); res(v); };
    $("#imCancel").onclick = ()=>{ cleanup(); closeModals(); res(null); };
  });
}

/* ---------- store QR ---------- */
function fileToDataUrl(file, cb, max){
  if(!file.type.startsWith("image/")){ toast("Please choose an image file", true); return; }
  const rd = new FileReader();
  rd.onload = ()=>{
    const img = new Image();
    img.onload = ()=>{
      const MAX = max || 500, sc = Math.min(1, MAX / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(img.width * sc));
      cv.height = Math.max(1, Math.round(img.height * sc));
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      cb(cv.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.85));
    };
    img.onerror = ()=>toast("Could not read that image", true);
    img.src = rd.result;
  };
  rd.onerror = ()=>toast("Could not open that file", true);
  rd.readAsDataURL(file);
}
function applyQr(){
  $("#qrBox").innerHTML = settings.qr ? `<img src="${settings.qr}" alt="qr">` : "QR";
}
$("#setQr").addEventListener("change", e=>{
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  fileToDataUrl(f, dataUrl=>{
    settings.qr = dataUrl; saveSettings(); applyQr();
    toast("Payment QR saved — shows at checkout 📷");
    e.target.value = "";
  });
});
$("#removeQrBtn").onclick = ()=>{ settings.qr = ""; saveSettings(); applyQr(); toast("QR removed"); };
$("#qrDoneBtn").onclick = ()=> $("#qrModal").classList.add("hidden"); // close ONLY the QR, keep checkout open
$("#showQrBtn").onclick = ()=>{
  $("#qrImg").innerHTML = settings.qr
    ? `<img src="${settings.qr}" alt="pay QR">`
    : `<p class="muted">No payment QR uploaded yet. Add it in Settings → Branding.</p>`;
  openModal("#qrModal");
};

/* ---------- cashiers ---------- */
function renderCashiers(){
  $("#cashierList").innerHTML = (settings.cashiers||[]).length
    ? settings.cashiers.map((c,i)=>`<div class="cashier-row"><span>🧑‍💼 ${c.name} <small>PIN ••••</small></span>
        <button class="btn-ghost sm" data-csdel="${i}">Remove</button></div>`).join("")
    : `<p class="muted">No extra cashiers yet.</p>`;
  $$("#cashierList [data-csdel]").forEach(b=>b.onclick=()=>{
    settings.cashiers.splice(+b.dataset.csdel, 1); saveSettings(); renderCashiers(); toast("Cashier removed");
  });
}
$("#addCashierBtn").onclick = ()=>{
  const name = $("#csName").value.trim(), pin = $("#csPin").value.trim();
  if(!name || !/^\d{4,6}$/.test(pin)){ toast("Enter a cashier name and a 4–6 digit PIN", true); return; }
  if(pin === settings.pin){ toast("That PIN is already the Owner PIN", true); return; }
  settings.cashiers.push({ name, pin });
  saveSettings(); renderCashiers();
  $("#csName").value=""; $("#csPin").value="";
  toast("Cashier added — they can now log in with their PIN");
};

/* ---------- barcode camera scanner ---------- */
let qrScanner = null, qrLibLoading = null;
function stopScanner(){
  if(qrScanner){ try { qrScanner.stop().then(()=>qrScanner.clear()).catch(()=>{}); } catch(e){} qrScanner = null; }
}
$("#scanBarcodeBtn").onclick = async ()=>{
  openModal("#scanModal");
  try{
    if(!window.Html5Qrcode){
      if(!qrLibLoading){
        qrLibLoading = new Promise((res, rej)=>{
          const s = document.createElement("script");
          s.src = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
          s.onload = res; s.onerror = rej; document.head.appendChild(s);
        });
      }
      await qrLibLoading;
    }
    qrScanner = new Html5Qrcode("scanReader");
    await qrScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 150 } },
      decoded => {
        $("#pmBarcode").value = decoded;
        stopScanner(); closeModals();
        toast("Barcode captured: " + decoded);
      },
      ()=>{/* no code in frame yet */});
  }catch(e){
    $("#scanReader").innerHTML = "";
    toast("Camera not available — type the barcode instead", true);
  }
};

/* ---------- modals ---------- */
function openModal(sel){ $(sel).classList.remove("hidden"); }
function closeModals(){ stopScanner(); $$(".modal").forEach(m=>m.classList.add("hidden")); }
$$("[data-close]").forEach(b=>b.onclick=closeModals);
$$(".modal").forEach(m=>m.addEventListener("click", e=>{ if(e.target===m) closeModals(); }));
document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeModals(); });

/* ---------- installable app (PWA) ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", ()=> navigator.serviceWorker.register("/sw.js").catch(()=>{}));
}

/* ---------- init ---------- */
if(!shiftStart){ shiftStart = Date.now(); DB.set("shiftStart", shiftStart); }
refreshCats(); renderProducts(); renderCart(); renderDashboard(); renderCashiers();
loadSettingsForm(); refreshFoot(); applyLogo(); applyQr(); renderHeldBadge(); renderOnline();
boot();
