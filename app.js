/* Sahayak PWA — thin client over the Sahayak backend (same origin). */
const $ = id => document.getElementById(id);
const money = n => "₹" + Math.round(n).toLocaleString("en-IN");
const fmtDate = iso => { if (!iso) return null; const d = new Date(iso + "T00:00:00"); return isNaN(d) ? iso : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }); };
const today = () => new Date().toISOString().slice(0, 10);

// ---------- identity (SSO replaces this in phase 2) ----------
const rep = { name: localStorage.getItem("rep.name") || "", id: localStorage.getItem("rep.id") || "" };
function headers(json) {
  const h = { "x-tenant-id": "pilot", "x-rep-id": rep.id, "x-rep-name": rep.name };
  if (json) h["content-type"] = "application/json";
  return h;
}
async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: headers(true), body: JSON.stringify(body) } : { headers: headers(false) });
  if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).error || m; } catch (_) {} throw new Error(m); }
  return r.json();
}
async function post(path) { const r = await fetch(path, { method: "POST", headers: headers(false) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }

function showApp() {
  $("login").hidden = true; $("shell").hidden = false;
  $("who").textContent = `${rep.name} · ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
  loadBrief(); flushQueue();
}
if (rep.id) showApp();
$("login-go").onclick = () => {
  const n = $("name").value.trim(); if (!n) return;
  rep.name = n; rep.id = n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  localStorage.setItem("rep.name", rep.name); localStorage.setItem("rep.id", rep.id);
  showApp();
};

// ---------- tabs ----------
document.querySelectorAll("nav [role=tab]").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav [role=tab]").forEach(x => x.setAttribute("aria-selected", x === b));
  document.querySelectorAll("main > section").forEach(s => s.hidden = s.id !== b.dataset.tab);
  if (b.dataset.tab === "brief") loadBrief();
});

// ---------- speech ----------
let lang = "en-IN";
document.querySelectorAll(".lang button").forEach(b => b.onclick = () => { lang = b.dataset.lang; document.querySelectorAll(".lang button").forEach(x => x.setAttribute("aria-pressed", x === b)); });
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const mic = $("mic"), note = $("mic-note"), ta = $("transcript");
let rec = null, heard = "";
if (!SR) { mic.disabled = true; note.textContent = "Voice needs Chrome. Type below instead."; }
function startRec() {
  if (!SR || rec) return;
  rec = new SR(); rec.lang = lang; rec.continuous = true; rec.interimResults = true; heard = "";
  rec.onresult = e => { let s = ""; for (const r of e.results) s += r[0].transcript + " "; heard = s.trim(); ta.value = heard; };
  rec.onerror = e => { note.textContent = e.error === "not-allowed" ? "Microphone permission is off. Allow it in Chrome settings, or type below." : "Couldn't hear that — try again or type below."; stopRec(); };
  rec.onend = () => { rec = null; mic.classList.remove("live"); mic.textContent = "Hold to talk"; if (heard) note.textContent = "Got it. Check the text, then log the visit."; };
  try { rec.start(); mic.classList.add("live"); mic.textContent = "Listening…"; note.textContent = "Speak now. Release when done."; if (navigator.vibrate) navigator.vibrate(20); } catch (_) { rec = null; }
}
function stopRec() { if (rec) { try { rec.stop(); } catch (_) {} } }
mic.addEventListener("pointerdown", e => { e.preventDefault(); startRec(); });
["pointerup", "pointerleave", "pointercancel"].forEach(ev => mic.addEventListener(ev, stopRec));

// ---------- offline queue ----------
const QKEY = "sahayak.queue";
const queue = () => JSON.parse(localStorage.getItem(QKEY) || "[]");
function showQueue() { const q = queue(); $("queue").hidden = q.length === 0; $("queue").textContent = q.length ? `${q.length} visit${q.length > 1 ? "s" : ""} saved offline — will upload when you have signal.` : ""; }
async function flushQueue() {
  const q = queue(); if (!q.length || !navigator.onLine) return;
  const left = [];
  for (const t of q) { try { await api("/visits/draft", { transcript: `${t.text} (recorded ${t.at})` }); } catch (_) { left.push(t); } }
  localStorage.setItem(QKEY, JSON.stringify(left)); showQueue();
}
window.addEventListener("online", flushQueue); showQueue();

// ---------- capture ----------
const step = n => [1, 2, 3].forEach(i => $("cap-step" + i).hidden = i !== n);
let current = null;

$("extract").onclick = async () => {
  const text = ta.value.trim(); $("cap-err").hidden = true;
  if (!text) { $("cap-err").textContent = "Say or type what happened at the visit first."; $("cap-err").hidden = false; return; }
  if (!navigator.onLine) { localStorage.setItem(QKEY, JSON.stringify([...queue(), { text, at: new Date().toLocaleString("en-IN") }])); ta.value = ""; showQueue(); return; }
  $("said").textContent = text; $("extracted").hidden = true; $("thinking").hidden = false; $("ex-err").hidden = true; step(2);
  try { current = await api("/visits/draft", { transcript: text }); render(current); }
  catch (e) { $("thinking").hidden = true; $("ex-err").textContent = "Couldn't read that visit (" + e.message + "). Try again."; $("ex-err").hidden = false; }
};

function render(d) {
  $("thinking").hidden = true; $("extracted").hidden = false;
  const ex = d.extraction, facts = $("facts"); facts.innerHTML = "";
  const add = (k, v) => { if (v) facts.insertAdjacentHTML("beforeend", `<dt>${k}</dt><dd>${v}</dd>`); };
  add("Dealer", ex.dealer + (d.dealer ? "" : ' <span class="flag">not on beat</span>'));
  add("Delivery", fmtDate(ex.delivery_date)); add("Next visit", fmtDate(ex.next_visit_date)); add("Notes", ex.other_notes);
  const tb = $("lines").querySelector("tbody"); tb.innerHTML = "";
  d.lines.forEach(l => tb.insertAdjacentHTML("beforeend", `<tr><td>${l.name}${l.shortStock !== undefined ? ' <span class="flag">stock ' + l.shortStock + "</span>" : ""}</td><td class="n">${l.qty}</td><td class="n">${l.rate}</td><td class="n">${l.amount.toLocaleString("en-IN")}</td></tr>`));
  $("lines").hidden = d.lines.length === 0;
  if (d.lines.length) tb.insertAdjacentHTML("beforeend", `<tr><td colspan="3"><b>Order value</b></td><td class="n"><b>${d.total.toLocaleString("en-IN")}</b></td></tr>`);
  const iss = $("issues"); iss.innerHTML = "";
  if (ex.complaint) iss.insertAdjacentHTML("beforeend", `<p><span class="flag">Complaint</span> ${ex.complaint}</p>`);
  d.warnings.forEach(w => iss.insertAdjacentHTML("beforeend", `<p class="muted">${w}</p>`));
  $("confirm-q").textContent = ex.confirm_question || "Confirm?";
}
$("redo").onclick = async () => { if (current) post(`/visits/${current.visitId}/discard`).catch(() => {}); step(1); };
$("confirm").onclick = async () => {
  $("confirm").disabled = true;
  try {
    const c = await post(`/visits/${current.visitId}/confirm`);
    const o = c.order;
    $("so-title").textContent = o ? "Sales order created" : "No order this visit";
    $("so-line").textContent = o ? `${o.orderNo} · ${money(o.total)} · ${o.status === "draft" ? "draft, awaiting credit clearance" : "approved"}` : "Visit note only";
    $("so-stamp").textContent = o && o.status === "draft" ? "Draft" : "Done";
    $("crm-line").textContent = c.visit.summary;
    $("complaint-sys").hidden = !c.complaintRaised; if (c.complaintRaised) $("complaint-line").textContent = c.visit.complaint;
    $("next-line").textContent = c.nextVisit ? `${fmtDate(c.nextVisit)} · added to your beat plan` : "Not set";
    $("wa-to").textContent = `To ${c.visit.dealerName}${c.whatsapp.to ? " · " + c.whatsapp.to : " · no number on file"}`;
    $("wa-msg").textContent = c.whatsapp.body || "";
    $("wa-send").disabled = !c.whatsapp.to; $("wa-skip").disabled = false; $("wa-status").hidden = true;
    current.confirmed = c; step(3);
  } catch (e) { $("ex-err").textContent = "Couldn't confirm (" + e.message + ")."; $("ex-err").hidden = false; }
  finally { $("confirm").disabled = false; }
};
$("wa-send").onclick = async () => {
  const c = current.confirmed; $("wa-send").disabled = true; $("wa-skip").disabled = true;
  try { const r = await api("/whatsapp/send", { to: c.whatsapp.to, body: $("wa-msg").textContent, visitId: current.visitId });
    $("wa-status").textContent = r.sent ? "Sent from the company number." : "WhatsApp isn't connected on this server yet — message logged, not sent."; }
  catch (e) { $("wa-status").textContent = "Couldn't send (" + e.message + ")."; }
  $("wa-status").hidden = false;
};
$("wa-skip").onclick = () => { $("wa-send").disabled = true; $("wa-skip").disabled = true; };
$("again").onclick = () => { ta.value = ""; current = null; step(1); };

// ---------- ask ----------
const ASKS = ["25mm pipe ka stock?", "Malwa Hardware ka outstanding aur kitne din overdue?", "CPVC 20mm available hai?", "Kaun se dealer overdue hain?"];
ASKS.forEach(t => { const b = document.createElement("button"); b.textContent = t; b.onclick = () => { $("ask-q").value = t; askGo(); }; $("ask-chips").appendChild(b); });
async function askGo() {
  const q = $("ask-q").value.trim(); if (!q) return;
  $("ask-err").hidden = true; $("ask-a").textContent = ""; $("ask-thinking").hidden = false;
  try { $("ask-a").textContent = (await api("/ask", { question: q })).answer; }
  catch (e) { $("ask-err").textContent = "Couldn't answer (" + e.message + ")."; $("ask-err").hidden = false; }
  finally { $("ask-thinking").hidden = true; }
}
$("ask-go").onclick = askGo;

// ---------- brief ----------
let briefLoaded = "";
async function loadBrief() {
  if (briefLoaded === today()) return refreshToday();
  $("brief-date").textContent = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  $("brief-thinking").hidden = false; $("brief-text").textContent = "";
  try {
    const b = await api("/brief");
    $("brief-text").textContent = b.text;
    const dues = $("dues"); dues.innerHTML = "";
    b.collect.forEach(d => dues.insertAdjacentHTML("beforeend", `<tr><td>${d.name}<br><span class="muted">${d.overdueDays} days overdue</span></td><td class="n">${money(d.overdue)}</td></tr>`));
    if (!b.collect.length) dues.innerHTML = `<tr><td class="muted">Nothing overdue on your beat.</td></tr>`;
    briefLoaded = today();
  } catch (e) { $("brief-text").textContent = "Couldn't load your briefing (" + e.message + ")."; }
  finally { $("brief-thinking").hidden = true; }
  refreshToday();
}
async function refreshToday() {
  try {
    const r = await api("/rollup"); const t = $("today"); t.innerHTML = "";
    r.items.forEach(v => t.insertAdjacentHTML("beforeend", `<tr><td>${v.dealerName}<br><span class="muted">${v.orderNo ? v.orderNo : "no order"}${v.complaint ? " · complaint" : ""}</span></td><td class="n">${v.orderTotal ? money(v.orderTotal) : ""}</td></tr>`));
    $("today-empty").hidden = r.items.length > 0;
  } catch (_) {}
}

// ---------- install + service worker ----------
let deferred = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; $("install").hidden = false; });
$("install-go").onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $("install").hidden = true; };
window.addEventListener("appinstalled", () => { $("install").hidden = true; });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

fetch("/health").then(r => r.json()).then(h => { $("foot").textContent = `Connected to ${h.connector === "mock" ? "sample data" : h.connector.toUpperCase()}${h.whatsapp ? " · WhatsApp on" : ""}`; }).catch(() => { $("foot").textContent = "Server unreachable"; });
