import * as DB from "./db.js";
import { APP_NAME } from "./firebase-config.js";

// ================= constants =================
const DAYS = ["الأحد","الاتنين","التلات","الأربع","الخميس","الجمعة","السبت"];
const WEEK_ORDER = [6,0,1,2,3,4,5];
const MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
const ROLES = ["قائد تسبيح","صوت (فوكال)","كيبورد","جيتار","باص","درامز","كمان","عود","صوت وهندسة","داتا شو","تاني"];
const HCATS = ["تسبيح (سريعة)","عبادة (هادية)","افتتاحية","ختام","مناسبات","أطفال"];
const PLAN_ST = { planned:{n:"متخطط لها",c:""}, doing:{n:"شغالين عليها",c:"gold"}, done:{n:"خلصت ✓",c:"green"} };
const FB_TYPES = { suggestion:"💡 اقتراح", complaint:"⚠️ شكوى", other:"✉️ رسالة" };
const FB_ST = { new:{n:"جديد",c:"gold"}, seen:{n:"اتشاف",c:""}, done:{n:"اتحل ✓",c:"green"} };

// ================= helpers =================
const $ = s => document.querySelector(s);
function el(tag, a, ...kids) {
  const e = document.createElement(tag);
  if (a) for (const k in a) { const v = a[k]; if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "text") e.textContent = v; else e.setAttribute(k, v === true ? "" : v); }
  for (const c of kids.flat()) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}
function toast(t) { const x = $("#toast"); x.textContent = t; x.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => x.classList.remove("on"), 2000); }
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
function parseYmd(s) { if (typeof s !== "string") return null; const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null; }
function today() { const d = new Date(); d.setHours(12, 0, 0, 0); return d; }
function fmtDate(s, withDay) { const d = parseYmd(s); if (!d) return ""; return (withDay ? DAYS[d.getDay()] + " " : "") + d.getDate() + " " + MONTHS[d.getMonth()]; }
function fmtTime(hm) { if (!hm || typeof hm !== "string") return ""; const [h, m] = hm.split(":").map(Number); return (((h + 11) % 12) + 1) + ":" + pad(m || 0) + (h >= 12 ? " م" : " ص"); }
function ago(ts) { const s = Math.max(0, (Date.now() - (ts || 0)) / 1000); if (s < 3600) return "من " + Math.max(1, Math.round(s / 60)) + " دقيقة"; if (s < 86400) return "من " + Math.round(s / 3600) + " ساعة"; const d = Math.round(s / 86400); return d === 1 ? "امبارح" : "من " + d + " يوم"; }
const str = (v, n) => typeof v === "string" ? v.slice(0, n || 300) : "";
function initials(n) { n = str(n, 40).trim(); return n ? n.split(/\s+/).slice(0, 2).map(w => w[0]).join("") : "؟"; }
const daysBetween = (a, b) => Math.round((b - a) / 864e5);
const countTrue = o => Object.values(o || {}).filter(Boolean).length;
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("اتنسخ ✅ الصقيه في الواتساب"); }
  catch (e) { openSheet(el("h2", { text: "انسخي النص ده" }), el("textarea", { class: "input", style: "height:220px", text })); }
}
function waShare(text) { return "https://wa.me/?text=" + encodeURIComponent(text); }

// ================= state =================
const S = {
  user: null, profile: null, team: null, me: null, users: [],
  roster: [], hymns: [], sessions: [], recurring: [], events: [],
  prayers: [], ideas: [], plan: [], feedback: [],
  view: "home", meetType: null, meetDate: null, meetTab: "att", togTab: "prayers",
  planYear: today().getFullYear(), hymnQ: "", teamQ: "", unsubs: []
};
const isAdmin = () => !!(S.me && S.me.role === "admin");
const T = p => "teams/" + S.team.id + "/" + p;
const rosterById = id => S.roster.find(m => m.id === id);
const hymnById = id => S.hymns.find(h => h.id === id);
const recById = id => S.recurring.find(r => r.id === id);
const userById = uid => S.users.find(u => u.id === uid);
const activeRoster = () => S.roster.filter(m => m.active !== false).sort((a, b) => str(a.name).localeCompare(str(b.name), "ar"));
let pendingName = "";
const myName = () => (S.me && S.me.name) || (S.user && S.user.name) || pendingName || "";

async function w(fn, ok) {
  try { await fn(); if (ok) toast(ok); return true; }
  catch (e) { console.error(e); toast(String(e && e.code || "").includes("permission") ? "مش مسموح لك تعمل كده" : "ما اتحفظش — اتأكدي من النت وجربي تاني"); return false; }
}

// ================= auth screens =================
const AUTH_ERR = {
  "auth/invalid-email": "الإيميل مش مكتوب صح", "auth/user-not-found": "مفيش حساب بالإيميل ده",
  "auth/wrong-password": "الباسورد غلط", "auth/invalid-credential": "الإيميل أو الباسورد غلط",
  "auth/email-already-in-use": "الإيميل ده عليه حساب بالفعل — جربي تسجلي دخول",
  "auth/weak-password": "الباسورد لازم يكون 6 حروف أو أرقام على الأقل",
  "auth/too-many-requests": "محاولات كتير — استني شوية وجربي تاني",
  "auth/popup-closed-by-user": "اتقفلت نافذة جوجل قبل ما تكمل",
  "auth/network-request-failed": "مفيش نت"
};
const authErr = e => AUTH_ERR[e && e.code] || "حصلت مشكلة، جربي تاني";

function screen(...kids) { $("#root").replaceChildren(el("div", { class: "screen" }, ...kids)); }

function showSetupNeeded() {
  screen(el("div", { class: "logo", text: "⚙️" }), el("h1", { text: "محتاجين نوصّل Firebase" }),
    el("p", { class: "lead", text: "افتحي ملف firebase-config.js وحطي فيه بيانات مشروع Firebase بتاعك (الخطوات في دليل التشغيل)." }));
}

function showAuth(mode) {
  mode = mode || "login";
  const name = el("input", { class: "input", placeholder: "اسمك", autocomplete: "name" });
  const email = el("input", { class: "input", type: "email", placeholder: "الإيميل", dir: "ltr", autocomplete: "email" });
  const pw = el("input", { class: "input", type: "password", placeholder: "الباسورد", dir: "ltr", autocomplete: mode === "login" ? "current-password" : "new-password" });
  const err = el("div", { class: "err" });
  const btn = el("button", { class: "btn", text: mode === "login" ? "دخول" : "اعمل حساب" });
  const go = async () => {
    err.textContent = ""; btn.disabled = true;
    try {
      if (mode === "login") await DB.signIn(email.value.trim(), pw.value);
      else { if (!name.value.trim()) { err.textContent = "اكتبي اسمك"; btn.disabled = false; return; } pendingName = name.value.trim(); await DB.signUp(email.value.trim(), pw.value, name.value.trim()); }
    } catch (e) { err.textContent = authErr(e); btn.disabled = false; }
  };
  btn.addEventListener("click", go);
  pw.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  screen(
    el("div", { class: "logo", text: "🎶" }), el("h1", { text: APP_NAME }),
    el("p", { class: "lead", text: mode === "login" ? "أهلاً بيك تاني 👋" : "اعمل حساب جديد في دقيقة" }),
    mode === "signup" ? name : null, mode === "signup" ? el("div", { style: "height:8px" }) : null,
    email, el("div", { style: "height:8px" }), pw, btn, err,
    el("div", { class: "or", text: "أو" }),
    el("button", { class: "gbtn", onclick: async () => { try { await DB.google(); } catch (e) { err.textContent = authErr(e); } } }, el("b", { style: "color:#4285F4", text: "G" }), "الدخول بحساب جوجل"),
    el("div", { style: "text-align:center;margin-top:16px;display:flex;flex-direction:column;gap:10px" },
      el("button", { class: "link", text: mode === "login" ? "معندكش حساب؟ اعمل حساب جديد" : "عندك حساب؟ سجّل دخول", onclick: () => showAuth(mode === "login" ? "signup" : "login") }),
      mode === "login" ? el("button", { class: "link", text: "نسيت الباسورد", onclick: async () => {
        if (!email.value.trim()) { err.textContent = "اكتبي الإيميل الأول"; return; }
        try { await DB.resetPassword(email.value.trim()); err.style.color = "var(--green)"; err.textContent = "بعتنالك إيميل تغيّري منه الباسورد"; } catch (e) { err.textContent = authErr(e); }
      } }) : null)
  );
}

function genCode() { const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }

function showOnboarding() {
  const nm = el("input", { class: "input", placeholder: "اسمك زي ما هيظهر للفريق", value: myName() });
  const team = el("input", { class: "input", placeholder: "اسم الفريق (مثلاً: فريق تسبيح كنيسة …)" });
  const code = el("input", { class: "input", placeholder: "كود الفريق", dir: "ltr", style: "text-transform:uppercase;letter-spacing:4px;text-align:center;font-weight:800" });
  const err = el("div", { class: "err" });
  const create = async () => {
    err.textContent = ""; const n = nm.value.trim(), t = team.value.trim();
    if (!n) { err.textContent = "اكتبي اسمك"; return; } if (!t) { err.textContent = "اكتبي اسم الفريق"; return; }
    const uid = S.user.uid; const tid = DB.newId("teams"); const jc = genCode();
    try {
      await DB.set("teams/" + tid, { name: t.slice(0, 60), ownerUid: uid, code: jc, createdAt: Date.now() });
      await DB.set("teams/" + tid + "/users/" + uid, { name: n.slice(0, 40), role: "admin", joinedAt: Date.now() });
      await DB.set("joinCodes/" + jc, { teamId: tid });
      await DB.set("profiles/" + uid, { name: n.slice(0, 40), teamId: tid });
      await loadProfile();
    } catch (e) { console.error(e); err.textContent = "ما قدرناش نعمل الفريق، جربي تاني"; }
  };
  const join = async () => {
    err.textContent = ""; const n = nm.value.trim(), c = code.value.trim().toUpperCase();
    if (!n) { err.textContent = "اكتبي اسمك"; return; } if (c.length < 4) { err.textContent = "اكتبي كود الفريق"; return; }
    try {
      const j = await DB.get("joinCodes/" + c);
      if (!j || !j.teamId) { err.textContent = "الكود ده مش صح — اسألي قائد الفريق"; return; }
      await DB.set("teams/" + j.teamId + "/users/" + S.user.uid, { name: n.slice(0, 40), role: "member", code: c, joinedAt: Date.now() });
      await DB.set("profiles/" + S.user.uid, { name: n.slice(0, 40), teamId: j.teamId });
      await loadProfile();
    } catch (e) { console.error(e); err.textContent = "ما قدرناش ندخلك الفريق، اتأكدي من الكود"; }
  };
  screen(el("div", { class: "logo", text: "👋" }), el("h1", { text: "أهلاً!" }), el("p", { class: "lead", text: "خطوة أخيرة: ادخلي فريقك أو اعملي فريق جديد" }),
    el("label", { class: "f", text: "اسمك" }), nm,
    el("div", { class: "card", style: "margin-top:14px" }, el("b", { text: "🔑 عندي كود فريق" }), el("div", { class: "muted", style: "font-size:13px;margin-bottom:8px", text: "القائد هيبعتلك الكود" }), code, el("button", { class: "btn", onclick: join, text: "ادخل الفريق" })),
    el("div", { class: "card" }, el("b", { text: "✨ أنا قائد وعايز أعمل فريق جديد" }), el("div", { style: "height:8px" }), team, el("button", { class: "btn ghost", onclick: create, text: "اعمل الفريق" })),
    err, el("button", { class: "link", style: "margin:8px auto 0", text: "تسجيل خروج", onclick: () => DB.signOut() }),
    el("button", { class: "link", style: "margin:10px auto 0;color:var(--muted)", text: "مسح حسابي", onclick: async () => {
      try { try { await DB.del("profiles/" + S.user.uid); } catch (e) {} await DB.deleteAccount(); }
      catch (e) { err.textContent = e && e.code === "auth/requires-recent-login" ? "سجّل خروج وادخل تاني وبعدين امسح الحساب" : "ما قدرناش نمسح الحساب"; }
    } }));
}

// ================= boot =================
function stopListeners() { S.unsubs.forEach(u => { try { u(); } catch (e) {} }); S.unsubs = []; }

async function loadProfile() {
  stopListeners();
  let p = null; try { p = await DB.get("profiles/" + S.user.uid); } catch (e) {}
  S.profile = p;
  if (!p || !p.teamId) { showOnboarding(); return; }
  let me = null, team = null;
  try { me = await DB.get("teams/" + p.teamId + "/users/" + S.user.uid); team = me ? await DB.get("teams/" + p.teamId) : null; } catch (e) {}
  if (!me || !team) { showOnboarding(); return; }
  S.team = team; S.me = me; startApp();
}

function startApp() {
  buildShell();
  const L = (key, path, opts) => S.unsubs.push(DB.listen(T(path), opts || null, d => { S[key] = d; render(); }, e => console.error(key, e)));
  S.unsubs.push(DB.listenDoc(T("users/" + S.user.uid), d => { if (!d) { loadProfile(); return; } S.me = d; render(); }));
  S.unsubs.push(DB.listenDoc("teams/" + S.team.id, d => { if (d) { S.team = d; render(); } }));
  L("users", "users"); L("roster", "roster"); L("hymns", "hymns");
  L("sessions", "sessions", { orderBy: ["date", "desc"], limit: 400 });
  L("recurring", "recurring"); L("events", "events", { orderBy: ["date", "asc"], limit: 500 });
  L("prayers", "prayers", { orderBy: ["ts", "desc"], limit: 200 });
  L("ideas", "ideas", { orderBy: ["ts", "desc"], limit: 300 });
  L("plan", "plan");
  // feedback: admins see all, members only their own (security rules enforce this too)
  if (isAdmin()) L("feedback", "feedback", { orderBy: ["ts", "desc"], limit: 300 });
  else S.unsubs.push(DB.listen(T("feedback"), { where: ["by", "==", S.user.uid] }, d => { S.feedback = d.sort((a, b) => (b.ts || 0) - (a.ts || 0)); render(); }));
}

function resetState() {
  stopListeners();
  Object.assign(S, { profile: null, team: null, me: null, users: [], roster: [], hymns: [], sessions: [], recurring: [], events: [],
    prayers: [], ideas: [], plan: [], feedback: [], view: "home", meetType: null, meetDate: null, meetTab: "att", togTab: "prayers" });
}
DB.onAuth(u => {
  if (!u || !S.user || S.user.uid !== u.uid) resetState();
  S.user = u;
  if (!DB.configured) { showSetupNeeded(); return; }
  if (!u) { stopListeners(); showAuth("login"); return; }
  loadProfile();
});

// ================= shell =================
function buildShell() {
  $("#root").replaceChildren(
    el("div", { class: "app" },
      el("header", null, el("h1", null, el("span", { id: "teamName" }), el("small", { id: "sub" })),
        el("button", { class: "hdr-btn", title: "الفريق", onclick: () => go("team"), text: "👥" }),
        el("button", { class: "hdr-btn", title: "الإعدادات", onclick: () => go("settings"), text: "⚙️" })),
      el("main", null, ...["home", "meet", "hymns", "tog", "cal", "team", "settings"].map(v => el("section", { class: "view", id: "v-" + v }))),
      el("button", { class: "fab", id: "fab", "aria-label": "إضافة", text: "+", onclick: fabClick }),
      el("nav", { class: "tabs" }, el("div", { class: "in" },
        ...[["home", "🏠", "الرئيسية"], ["meet", "✅", "الحضور"], ["tog", "🙏", "مع بعض"], ["hymns", "🎵", "الترانيم"], ["cal", "📅", "الجدول"]]
          .map(([v, i, n]) => el("button", { "data-v": v, onclick: () => go(v) }, el("span", { class: "ic", text: i }), n))))));
  go(S.view);
}
function go(v) {
  S.view = v;
  document.querySelectorAll(".view").forEach(x => x.classList.toggle("on", x.id === "v-" + v));
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  window.scrollTo(0, 0); render();
}
function render() {
  if (!S.team || !$("#v-home")) return;
  document.body.classList.toggle("ro", !isAdmin());
  $("#teamName").textContent = "🎶 " + str(S.team.name, 40);
  const titles = { home: "الرئيسية", meet: "الحضور والترانيم", hymns: "مكتبة الترانيم", tog: "مع بعض", cal: "الجدول والمناسبات", team: "أعضاء الفريق", settings: "الإعدادات" };
  $("#sub").textContent = titles[S.view];
  ({ home: renderHome, meet: renderMeet, hymns: renderHymns, tog: renderTog, cal: renderCal, team: renderTeam, settings: renderSettings })[S.view]();
  const fabOn = (["hymns", "team", "cal"].includes(S.view) && isAdmin()) || (S.view === "tog" && (S.togTab !== "plan" || isAdmin()));
  $("#fab").classList.toggle("on", fabOn);
}
function fabClick() {
  if (S.view === "hymns") hymnSheet(); else if (S.view === "team") memberSheet(); else if (S.view === "cal") eventSheet();
  else if (S.view === "tog") ({ prayers: prayerSheet, ideas: ideaSheet, plan: planSheet, feedback: feedbackSheet })[S.togTab]();
}

// ================= domain helpers =================
function occurrences(r, back, fwd) {
  const out = []; const t = today(); const day = Number(r.day);
  const d = new Date(t); d.setDate(t.getDate() - ((t.getDay() - day + 7) % 7));
  for (let i = back; i >= 1; i--) { const x = new Date(d); x.setDate(d.getDate() - 7 * i); out.push(ymd(x)); }
  out.push(ymd(d)); for (let i = 1; i <= fwd; i++) { const x = new Date(d); x.setDate(d.getDate() + 7 * i); out.push(ymd(x)); }
  return out.filter(s => (!r.from || s >= r.from) && (!r.to || s <= r.to));
}
function nextOcc(r) { const t = ymd(today()); return occurrences(r, 0, 6).find(s => s >= t); }
const sessionId = (date, recId) => date + "_" + recId;
const sessionOf = (date, recId) => S.sessions.find(s => s.id === sessionId(date, recId));
function nextBirthday(m) {
  const d = parseYmd(m.bday); if (!d) return null; const t = today();
  const n = new Date(t.getFullYear(), d.getMonth(), d.getDate(), 12); if (n < t) n.setFullYear(t.getFullYear() + 1);
  return { date: n, days: daysBetween(t, n), age: d.getFullYear() > 1900 ? n.getFullYear() - d.getFullYear() : null };
}
async function saveSession(date, recId, patch) {
  const id = sessionId(date, recId); const ex = sessionOf(date, recId);
  if (ex) return w(() => DB.update(T("sessions/" + id), patch));
  // first write for this date: expand dotted keys into a full document
  const body = { date, rec: recId, present: {}, setlist: [], note: "" };
  for (const k in patch) { if (k.startsWith("present.")) body.present[k.slice(8)] = patch[k]; else body[k] = patch[k]; }
  return w(() => DB.set(T("sessions/" + id), body));
}

// ================= HOME =================
function renderHome() {
  const V = $("#v-home"); V.replaceChildren();
  const bd = S.roster.map(m => ({ m, b: nextBirthday(m) })).filter(x => x.b).sort((a, b) => a.b.days - b.b.days);
  bd.filter(x => x.b.days === 0).forEach(x => V.append(el("div", { class: "bday-today" }, "🎂 النهارده عيد ميلاد " + str(x.m.name, 40) + "! كل سنة وهو/هي طيب/ة 🎉")));
  const nexts = S.recurring.map(r => ({ r, d: nextOcc(r) })).filter(x => x.d).sort((a, b) => (a.d + (a.r.time || "")).localeCompare(b.d + (b.r.time || "")));
  if (nexts.length) {
    const { r, d } = nexts[0]; const s = sessionOf(d, r.id);
    const n = s ? Object.values(s.present || {}).filter(v => v === "p" || v === "l").length : 0;
    V.append(el("div", { class: "hero" }, el("div", { class: "k", text: d === ymd(today()) ? "النهارده" : "الميعاد الجاي" }), el("h2", { text: str(r.title, 60) }),
      el("div", { class: "meta", text: fmtDate(d, true) + (r.time ? " · " + fmtTime(r.time) : "") + (r.place ? " · " + str(r.place, 60) : "") }),
      el("div", { class: "stats" }, el("div", null, el("b", { text: String(s && Array.isArray(s.setlist) ? s.setlist.length : 0) }), "ترنيمة"),
        el("div", null, el("b", { text: String(n) }), "حاضر"), el("div", null, el("b", { text: String(activeRoster().length) }), "في الفريق")),
      el("button", { onclick: () => { S.meetType = r.id; S.meetDate = d; S.meetTab = "songs"; go("meet"); }, text: isAdmin() ? "اختاري الترانيم وسجّلي الحضور ←" : "شوف الترانيم ←" })));
  } else V.append(el("div", { class: "card" }, el("div", { class: "empty" }, el("span", { class: "big", text: "📅" }),
    isAdmin() ? "ابدأي بإضافة المواعيد الثابتة (اجتماع الجمعة، التدريب) من تبويب الجدول" : "القائد لسه ما ضافش المواعيد")));

  // prayers snippet
  const open = S.prayers.filter(p => !p.answered);
  V.append(el("div", { class: "sec" }, "🙏 طلبات صلاة", el("span", { class: "tag", text: String(open.length) }), el("span", { class: "sp" }),
    el("button", { class: "btn sm ghost", onclick: () => { S.togTab = "prayers"; go("tog"); }, text: "الكل" })));
  const cp = el("div", { class: "card" });
  if (!open.length) cp.append(el("div", { class: "empty", text: "مفيش طلبات صلاة. أي حد يقدر يضيف طلب من «مع بعض»" }));
  open.slice(0, 3).forEach(p => cp.append(prayerRow(p, true))); V.append(cp);

  // this month plan
  const t = today(); const mPlan = S.plan.filter(p => +p.year === t.getFullYear() && +p.month === t.getMonth() + 1);
  if (mPlan.length) {
    V.append(el("div", { class: "sec" }, "📆 خطة شهر " + MONTHS[t.getMonth()]));
    const c = el("div", { class: "card" }); mPlan.forEach(p => c.append(planRow(p))); V.append(c);
  }
  V.append(el("div", { class: "sec" }, "🎂 أعياد ميلاد قريبة"));
  const up = bd.filter(x => x.b.days <= 45); const c1 = el("div", { class: "card" });
  if (!up.length) c1.append(el("div", { class: "empty", text: S.roster.length ? "مفيش أعياد ميلاد في الـ 45 يوم الجايين" : "ضيفي أعضاء الفريق من زرار 👥 فوق" }));
  up.slice(0, 8).forEach(x => c1.append(el("div", { class: "row" }, el("div", { class: "av", text: initials(x.m.name) }),
    el("div", { class: "main" }, el("b", { text: str(x.m.name, 40) }), el("small", { text: x.b.date.getDate() + " " + MONTHS[x.b.date.getMonth()] + (x.b.age ? " · هيكمل " + x.b.age : "") })),
    el("span", { class: "tag " + (x.b.days === 0 ? "gold" : x.b.days <= 7 ? "green" : ""), text: x.b.days === 0 ? "النهارده 🎉" : x.b.days === 1 ? "بكرة" : "بعد " + x.b.days + " يوم" }))));
  V.append(c1);
  V.append(el("div", { class: "sec" }, "⭐ إيفينتات جاية"));
  const ts = ymd(today()); const evs = S.events.filter(e => str(e.date) >= ts).slice(0, 5); const c2 = el("div", { class: "card" });
  if (!evs.length) c2.append(el("div", { class: "empty", text: "مفيش إيفينتات جاية" }));
  evs.forEach(e => c2.append(eventRow(e))); V.append(c2);
}
function eventRow(e) {
  const d = parseYmd(e.date);
  return el("div", { class: "row", onclick: () => isAdmin() && eventSheet(e) }, el("div", { class: "ev-date" }, el("b", { text: d ? String(d.getDate()) : "?" }), el("small", { text: d ? MONTHS[d.getMonth()] : "" })),
    el("div", { class: "main" }, el("b", { text: str(e.title, 80) }), el("small", { text: [d ? DAYS[d.getDay()] : "", fmtTime(e.time), str(e.place, 60)].filter(Boolean).join(" · ") }), e.note ? el("small", { text: str(e.note, 200) }) : null));
}

// ================= MEETINGS =================
function renderMeet() {
  const V = $("#v-meet"); V.replaceChildren();
  if (!S.recurring.length) { V.append(el("div", { class: "card" }, el("div", { class: "empty" }, el("span", { class: "big", text: "✅" }), isAdmin() ? "ضيفي الأول المواعيد الثابتة (اجتماع الجمعة، التدريب) من تبويب الجدول" : "القائد لسه ما ضافش المواعيد"))); return; }
  if (!recById(S.meetType)) S.meetType = S.recurring.slice().sort((a, b) => (nextOcc(a) || "z").localeCompare(nextOcc(b) || "z"))[0].id;
  const r = recById(S.meetType);
  const tc = el("div", { class: "chips" }); S.recurring.forEach(x => tc.append(el("button", { class: "chip" + (x.id === S.meetType ? " on" : ""), text: str(x.title, 40), onclick: () => { S.meetType = x.id; S.meetDate = null; renderMeet(); } }))); V.append(tc);
  const occ = occurrences(r, 8, 3); const nx = nextOcc(r); const t = ymd(today());
  if (!S.meetDate || (!occ.includes(S.meetDate) && !sessionOf(S.meetDate, r.id))) {
    const past = occ.filter(s => s <= t);
    S.meetDate = past.length && daysBetween(parseYmd(past[past.length - 1]), today()) <= 1 ? past[past.length - 1] : (nx || occ[occ.length - 1]);
  }
  const dc = el("div", { class: "chips" });
  occ.slice().reverse().forEach(s => dc.append(el("button", { class: "chip" + (s === S.meetDate ? " on" : "") + (s === nx ? " next" : ""), onclick: () => { S.meetDate = s; renderMeet(); } }, fmtDate(s) + (s === t ? " (النهارده)" : "") + (sessionOf(s, r.id) ? " ✓" : ""))));
  V.append(dc);
  const tabs = isAdmin() ? [["att", "الحضور"], ["songs", "الترانيم"], ["stats", "نسبة الحضور"]] : [["songs", "الترانيم"], ["att", "الحضور"]];
  if (!tabs.some(x => x[0] === S.meetTab)) S.meetTab = tabs[0][0];
  V.append(el("div", { class: "seg" }, ...tabs.map(([k, n]) => el("button", { class: S.meetTab === k ? "on" : "", text: n, onclick: () => { S.meetTab = k; renderMeet(); } }))));
  const s = sessionOf(S.meetDate, r.id) || { present: {}, setlist: [] };
  if (S.meetTab === "att") renderAtt(V, r, s); else if (S.meetTab === "songs") renderSetlist(V, r, s); else renderStats(V, r);
}
function renderAtt(V, r, s) {
  const ms = activeRoster(); const pr = s.present || {}; const cnt = k => ms.filter(m => pr[m.id] === k).length;
  V.append(el("div", { class: "sumbar" }, el("div", null, el("b", { text: String(cnt("p")) }), "حاضر"), el("div", null, el("b", { text: String(cnt("l")) }), "متأخر"),
    el("div", null, el("b", { text: String(cnt("a")) }), "غايب"), el("div", null, el("b", { text: String(ms.length - cnt("p") - cnt("l") - cnt("a")) }), "لسه")));
  const c = el("div", { class: "card" });
  if (!ms.length) c.append(el("div", { class: "empty", text: "ضيفي أعضاء الفريق الأول من زرار 👥 فوق" }));
  ms.forEach(m => {
    const v = pr[m.id]; const set = k => { if (!isAdmin()) return; const o = {}; o["present." + m.id] = v === k ? "" : k; saveSession(S.meetDate, r.id, o); };
    c.append(el("div", { class: "att" }, el("div", { class: "av", text: initials(m.name) }), el("div", { class: "nm" }, str(m.name, 40), el("small", { text: str(m.role, 30) })),
      el("div", { class: "tog" }, el("button", { class: "p" + (v === "p" ? " on" : ""), onclick: () => set("p"), text: "✓" }), el("button", { class: "l" + (v === "l" ? " on" : ""), onclick: () => set("l"), text: "⏰" }), el("button", { class: "a" + (v === "a" ? " on" : ""), onclick: () => set("a"), text: "✗" }))));
  });
  V.append(c);
  if (ms.length && isAdmin()) V.append(el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
    el("button", { class: "btn ghost sm", onclick: () => { const o = {}; ms.forEach(m => { if (!pr[m.id]) o["present." + m.id] = "p"; }); if (Object.keys(o).length) saveSession(S.meetDate, r.id, o); toast("الكل حاضر ✓"); }, text: "✓ الباقي كلهم حضروا" }),
    el("button", { class: "btn gold sm", onclick: () => copy(attText(r, s)), text: "📋 انسخي الحضور للواتساب" })));
}
function attText(r, s) {
  const ms = activeRoster(); const pr = s.present || {}; const by = k => ms.filter(m => pr[m.id] === k).map(m => "• " + m.name).join("\n") || "—";
  return "✅ حضور " + r.title + " — " + fmtDate(S.meetDate, true) + "\n\nحاضر:\n" + by("p") + "\n\nمتأخر:\n" + by("l") + "\n\nغايب:\n" + by("a");
}
function renderSetlist(V, r, s) {
  const list = (Array.isArray(s.setlist) ? s.setlist : []).filter(id => hymnById(id)); const c = el("div", { class: "card" });
  if (!list.length) c.append(el("div", { class: "empty" }, el("span", { class: "big", text: "🎵" }), "لسه مفيش ترانيم متختارة لـ " + fmtDate(S.meetDate, true)));
  const saveList = l => saveSession(S.meetDate, r.id, { setlist: l });
  list.forEach((id, i) => {
    const h = hymnById(id);
    c.append(el("div", { class: "song" }, el("span", { class: "n", text: String(i + 1) }),
      el("div", { class: "main" }, str(h.title, 80), el("small", { text: [h.key ? "المقام: " + str(h.key, 20) : "", str(h.cat, 30)].filter(Boolean).join(" · ") })),
      h.link && /^https?:\/\//.test(h.link) ? el("a", { href: h.link, target: "_blank", rel: "noopener", class: "icon-btn", text: "▶️" }) : null,
      el("button", { class: "icon-btn admin-only", onclick: () => { if (i > 0) { const l = list.slice(); [l[i - 1], l[i]] = [l[i], l[i - 1]]; saveList(l); } }, text: "▲" }),
      el("button", { class: "icon-btn admin-only", onclick: () => { if (i < list.length - 1) { const l = list.slice(); [l[i + 1], l[i]] = [l[i], l[i + 1]]; saveList(l); } }, text: "▼" }),
      el("button", { class: "icon-btn admin-only", onclick: () => saveList(list.filter(x => x !== id)), text: "✕" })));
  });
  V.append(c);
  const txt = () => "🎶 ترانيم " + r.title + " — " + fmtDate(S.meetDate, true) + "\n\n" + list.map((id, i) => { const h = hymnById(id); return (i + 1) + ". " + h.title + (h.key ? " (" + h.key + ")" : ""); }).join("\n");
  V.append(el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
    isAdmin() ? el("button", { class: "btn", onclick: () => pickHymns(list, saveList), text: "+ اختاري ترانيم" }) : null,
    list.length ? el("button", { class: "btn gold", onclick: () => copy(txt()), text: "📋 انسخ الليستة" }) : null));
}
function pickHymns(current, save) {
  const sel = current.slice(); const q = el("input", { class: "input", placeholder: "🔍 دوّري على ترنيمة…" }); const box = el("div", { class: "pick-list" });
  const draw = () => {
    box.replaceChildren(); const qq = q.value.trim();
    const hs = S.hymns.filter(h => !qq || str(h.title).includes(qq)).sort((a, b) => str(a.title).localeCompare(str(b.title), "ar"));
    if (!hs.length) box.append(el("div", { class: "empty", text: S.hymns.length ? "مفيش نتيجة" : "المكتبة فاضية — ضيفي ترانيم من تبويب الترانيم" }));
    hs.forEach(h => box.append(el("button", { class: sel.includes(h.id) ? "on" : "", onclick: () => { const i = sel.indexOf(h.id); i >= 0 ? sel.splice(i, 1) : sel.push(h.id); draw(); } }, sel.includes(h.id) ? "✓ " : "○ ", str(h.title, 80))));
  };
  q.addEventListener("input", draw); draw();
  openSheet(el("h2", { text: "🎵 اختاري الترانيم" }), q, box, el("div", { class: "acts" }, el("button", { class: "btn", onclick: () => { closeSheet(); save(sel); }, text: "تمام" }), el("button", { class: "btn ghost", onclick: () => { closeSheet(); hymnSheet(); }, text: "+ ترنيمة جديدة" })));
}
function renderStats(V, r) {
  const t = ymd(today()); const sess = S.sessions.filter(s => s.rec === r.id && str(s.date) <= t).slice(0, 12);
  V.append(el("div", { class: "muted", style: "font-size:13px;margin:0 4px 8px", text: "آخر " + sess.length + " مرة اتسجل فيها حضور لـ " + str(r.title, 40) }));
  const c = el("div", { class: "card" });
  if (!sess.length) c.append(el("div", { class: "empty", text: "لسه مفيش حضور متسجل" }));
  else activeRoster().map(m => { const tot = sess.filter(s => s.present && s.present[m.id]).length; const came = sess.filter(s => s.present && (s.present[m.id] === "p" || s.present[m.id] === "l")).length; return { m, tot, came, pc: tot ? Math.round(came * 100 / tot) : null }; })
    .sort((a, b) => (b.pc ?? -1) - (a.pc ?? -1)).forEach(x => c.append(el("div", { class: "row" }, el("div", { class: "av", text: initials(x.m.name) }),
      el("div", { class: "main" }, el("b", { text: str(x.m.name, 40) }), el("small", { text: x.tot ? "حضر " + x.came + " من " + x.tot : "مفيش تسجيل" })),
      el("div", { class: "bar" }, el("i", { style: "width:" + (x.pc || 0) + "%;background:" + ((x.pc ?? 0) >= 75 ? "var(--green)" : (x.pc ?? 0) >= 50 ? "var(--gold)" : "var(--red)") })),
      el("b", { style: "width:42px;text-align:left", text: x.pc == null ? "—" : x.pc + "%" }))));
  V.append(c);
}

// ================= TOGETHER (prayers, ideas, plan, feedback) =================
function renderTog() {
  const V = $("#v-tog"); V.replaceChildren();
  const fbNew = isAdmin() ? S.feedback.filter(f => f.status === "new").length : 0;
  V.append(el("div", { class: "seg" }, ...[["prayers", "🙏 صلاة"], ["ideas", "💡 أفكار"], ["plan", "📆 الخطة"], ["feedback", "📮 اقتراحات" + (fbNew ? " (" + fbNew + ")" : "")]]
    .map(([k, n]) => el("button", { class: S.togTab === k ? "on" : "", text: n, onclick: () => { S.togTab = k; render(); } }))));
  ({ prayers: renderPrayers, ideas: renderIdeas, plan: renderPlan, feedback: renderFeedback })[S.togTab](V);
}
// --- prayers
function prayerRow(p, compact) {
  const mine = p.by === S.user.uid; const prayed = !!(p.praying && p.praying[S.user.uid]); const n = countTrue(p.praying);
  const who = p.anon ? "طلب من غير اسم" : str((userById(p.by) || {}).name || p.byName, 40) || "حد من الفريق";
  return el("div", { class: "row", style: "align-items:flex-start" },
    el("div", { class: "av", style: "background:" + (p.answered ? "var(--green-soft)" : "var(--pri-soft)"), text: p.answered ? "✨" : "🙏" }),
    el("div", { class: "main" }, el("b", { style: "font-weight:700;white-space:pre-wrap", text: str(p.text, compact ? 140 : 1000) + (compact && str(p.text, 1000).length > 140 ? "…" : "") }),
      el("small", { text: who + " · " + ago(p.ts) + (p.answered ? " · اتسجابت 🙌" : "") })),
    el("div", { style: "display:flex;flex-direction:column;gap:4px;align-items:flex-end" },
      el("button", { class: "vote" + (prayed ? " on" : ""), onclick: () => { const o = {}; o["praying." + S.user.uid] = !prayed; w(() => DB.update(T("prayers/" + p.id), o), prayed ? null : "ربنا يسمع 🙏"); } }, prayed ? "❤️" : "🤍", " ", String(n)),
      !compact && (mine || isAdmin()) ? el("button", { class: "icon-btn", onclick: () => prayerSheet(p), text: "⋯" }) : null));
}
function renderPrayers(V) {
  const open = S.prayers.filter(p => !p.answered), ans = S.prayers.filter(p => p.answered);
  V.append(el("div", { class: "muted", style: "font-size:13px;margin:0 4px 8px", text: "اكتب طلبك والفريق كله يصلي معاك. دوس 🤍 لما تصلي لطلب." }));
  const c = el("div", { class: "card" });
  if (!open.length) c.append(el("div", { class: "empty" }, el("span", { class: "big", text: "🙏" }), "مفيش طلبات دلوقتي — دوس + وضيف طلبك"));
  open.forEach(p => c.append(prayerRow(p))); V.append(c);
  if (ans.length) { V.append(el("div", { class: "sec" }, "✨ صلوات اتسجابت")); const c2 = el("div", { class: "card" }); ans.slice(0, 30).forEach(p => c2.append(prayerRow(p))); V.append(c2); }
}
function prayerSheet(p) {
  const isNew = !p; p = p || { text: "", anon: false };
  const text = el("textarea", { class: "input", style: "height:110px", placeholder: "اكتب طلب الصلاة…", maxlength: "1000", text: str(p.text, 1000) });
  const anon = el("input", { type: "checkbox" }); anon.checked = !!p.anon;
  const save = async () => { const t = text.value.trim(); if (!t) { text.focus(); return; } closeSheet();
    if (isNew) await w(() => DB.add(T("prayers"), { text: t.slice(0, 1000), anon: anon.checked, by: S.user.uid, byName: myName(), praying: {}, answered: false, ts: Date.now() }), "اتضاف طلبك 🙏");
    else await w(() => DB.update(T("prayers/" + p.id), { text: t.slice(0, 1000), anon: anon.checked }), "اتحفظ"); };
  openSheet(el("h2", { text: isNew ? "🙏 طلب صلاة" : "✏️ طلب الصلاة" }), text,
    el("label", { style: "display:flex;gap:8px;align-items:center;margin-top:10px;font-weight:700" }, anon, "من غير ما يظهر اسمي"),
    el("div", { class: "acts" }, el("button", { class: "btn", onclick: save, text: "حفظ" }),
      !isNew ? el("button", { class: "btn gold", onclick: () => { closeSheet(); w(() => DB.update(T("prayers/" + p.id), { answered: !p.answered }), p.answered ? null : "مجد لاسمه 🙌"); }, text: p.answered ? "رجّعها" : "✨ اتسجابت" }) : null,
      !isNew ? el("button", { class: "btn ghost", onclick: () => confirmSheet("تمسح الطلب؟", () => w(() => DB.del(T("prayers/" + p.id)), "اتمسح")), text: "🗑" }) : el("button", { class: "btn ghost", onclick: closeSheet, text: "إلغاء" })));
  if (isNew) setTimeout(() => text.focus(), 50);
}
// --- ideas
function renderIdeas(V) {
  V.append(el("div", { class: "muted", style: "font-size:13px;margin:0 4px 8px", text: "أي حاجة ممكن نعملها كفريق: خدمة، رحلة، ترنيمة جديدة، تدريب… صوّتوا للي عاجباكم 👍" }));
  const items = S.ideas.filter(i => !i.inPlan).map(i => Object.assign({ n: countTrue(i.votes) }, i)).sort((a, b) => b.n - a.n || (b.ts || 0) - (a.ts || 0));
  const moved = S.ideas.filter(i => i.inPlan);
  const c = el("div", { class: "card" });
  if (!items.length) c.append(el("div", { class: "empty" }, el("span", { class: "big", text: "💡" }), "مفيش أفكار لسه — دوس + واقترح حاجة نعملها"));
  items.forEach(i => {
    const voted = !!(i.votes && i.votes[S.user.uid]);
    c.append(el("div", { class: "row", style: "align-items:flex-start" },
      el("div", { class: "main" }, el("b", { text: str(i.title, 100) }), i.details ? el("small", { style: "white-space:pre-wrap", text: str(i.details, 500) }) : null,
        el("small", { text: "اقتراح " + (str((userById(i.by) || {}).name || i.byName, 40) || "حد") + " · " + ago(i.ts) })),
      el("div", { style: "display:flex;flex-direction:column;gap:4px;align-items:flex-end" },
        el("button", { class: "vote" + (voted ? " on" : ""), onclick: () => { const o = {}; o["votes." + S.user.uid] = !voted; w(() => DB.update(T("ideas/" + i.id), o)); } }, voted ? "👍" : "👍🏻", " ", String(i.n)),
        isAdmin() ? el("button", { class: "pick", onclick: () => ideaToPlan(i), text: "→ للخطة" }) : null,
        (i.by === S.user.uid || isAdmin()) ? el("button", { class: "icon-btn", onclick: () => ideaSheet(i), text: "⋯" }) : null)));
  });
  V.append(c);
  if (moved.length) { V.append(el("div", { class: "sec muted" }, "✅ أفكار اتحطت في الخطة")); const c2 = el("div", { class: "card", style: "opacity:.8" }); moved.forEach(i => c2.append(el("div", { class: "row" }, el("div", { class: "main" }, el("b", { text: str(i.title, 100) }), el("small", { text: countTrue(i.votes) + " صوت" }))))); V.append(c2); }
}
function ideaSheet(i) {
  const isNew = !i; i = i || { title: "", details: "" };
  const title = el("input", { class: "input", value: str(i.title, 100), placeholder: "الفكرة باختصار", maxlength: "100" });
  const details = el("textarea", { class: "input", style: "height:90px", placeholder: "تفاصيل (اختياري)", text: str(i.details, 500) });
  const save = async () => { const t = title.value.trim(); if (!t) { title.focus(); return; } closeSheet();
    if (isNew) await w(() => DB.add(T("ideas"), { title: t.slice(0, 100), details: details.value.trim().slice(0, 500), by: S.user.uid, byName: myName(), votes: { [S.user.uid]: true }, inPlan: false, ts: Date.now() }), "اتضافت الفكرة 💡");
    else await w(() => DB.update(T("ideas/" + i.id), { title: t.slice(0, 100), details: details.value.trim().slice(0, 500) }), "اتحفظت"); };
  openSheet(el("h2", { text: isNew ? "💡 فكرة جديدة" : "✏️ الفكرة" }), title, el("div", { style: "height:8px" }), details,
    el("div", { class: "acts" }, el("button", { class: "btn", onclick: save, text: "حفظ" }),
      isNew ? el("button", { class: "btn ghost", onclick: closeSheet, text: "إلغاء" }) : el("button", { class: "btn ghost", onclick: () => confirmSheet("تمسح الفكرة؟", () => w(() => DB.del(T("ideas/" + i.id)), "اتمسحت")), text: "🗑 مسح" })));
  if (isNew) setTimeout(() => title.focus(), 50);
}
function ideaToPlan(i) { planSheet(null, { title: i.title, notes: i.details || "" }, async () => { await w(() => DB.update(T("ideas/" + i.id), { inPlan: true })); }); }
// --- yearly plan
function planRow(p) {
  const st = PLAN_ST[p.status] || PLAN_ST.planned;
  return el("div", { class: "row", onclick: () => isAdmin() && planSheet(p) },
    el("div", { class: "main" }, el("b", { text: str(p.title, 100) }), p.notes ? el("small", { style: "white-space:pre-wrap", text: str(p.notes, 400) }) : null, p.owner ? el("small", { text: "المسؤول: " + str(p.owner, 40) }) : null),
    el("span", { class: "tag " + st.c, text: st.n }));
}
function renderPlan(V) {
  const yc = el("div", { class: "chips" }); const y0 = today().getFullYear();
  [y0 - 1, y0, y0 + 1].forEach(y => yc.append(el("button", { class: "chip" + (y === S.planYear ? " on" : ""), text: "خطة " + y, onclick: () => { S.planYear = y; render(); } }))); V.append(yc);
  const items = S.plan.filter(p => +p.year === S.planYear);
  const done = items.filter(p => p.status === "done").length;
  V.append(el("div", { class: "sumbar" }, el("div", null, el("b", { text: String(items.length) }), "في الخطة"), el("div", null, el("b", { text: String(items.filter(p => p.status === "doing").length) }), "شغالين"), el("div", null, el("b", { text: String(done) }), "خلصت"),
    el("div", null, el("b", { text: items.length ? Math.round(done * 100 / items.length) + "%" : "—" }), "إنجاز")));
  const cm = today().getMonth() + 1;
  for (let m = 1; m <= 12; m++) {
    const list = items.filter(p => +p.month === m);
    if (!list.length && !isAdmin()) continue;
    const cur = S.planYear === y0 && m === cm;
    V.append(el("div", { class: "sec" }, MONTHS[m - 1], cur ? el("span", { class: "tag gold", text: "الشهر ده" }) : null, el("span", { class: "sp" }),
      isAdmin() ? el("button", { class: "btn sm ghost", onclick: () => planSheet(null, { month: m }), text: "+" }) : null));
    const c = el("div", { class: "card", style: cur ? "outline:2px solid var(--gold)" : "" });
    if (!list.length) c.append(el("div", { class: "muted", style: "font-size:13px", text: "مفيش حاجة متخططة" }));
    list.forEach(p => c.append(planRow(p))); V.append(c);
  }
  if (!items.length && !isAdmin()) V.append(el("div", { class: "card" }, el("div", { class: "empty", text: "القائد لسه ما حطش خطة للسنة دي" })));
}
function planSheet(p, preset, after) {
  const isNew = !p; p = p || Object.assign({ title: "", month: today().getMonth() + 1, year: S.planYear, status: "planned", owner: "", notes: "" }, preset || {});
  const title = el("input", { class: "input", value: str(p.title, 100), placeholder: "مثلاً: حفلة الكريسماس، يوم خلوة، تعليم ترانيم جديدة", maxlength: "100" });
  const month = el("select", { class: "input" }); MONTHS.forEach((n, i) => month.append(el("option", { value: String(i + 1), selected: +p.month === i + 1, text: n })));
  const year = el("input", { class: "input", type: "number", value: String(p.year || S.planYear), dir: "ltr" });
  const status = el("select", { class: "input" }); Object.keys(PLAN_ST).forEach(k => status.append(el("option", { value: k, selected: p.status === k, text: PLAN_ST[k].n })));
  const owner = el("input", { class: "input", value: str(p.owner, 40), placeholder: "مين المسؤول؟ (اختياري)" });
  const notes = el("textarea", { class: "input", style: "height:80px", placeholder: "تفاصيل", text: str(p.notes, 400) });
  const save = async () => { const t = title.value.trim(); if (!t) { title.focus(); return; } closeSheet();
    const body = { title: t.slice(0, 100), month: +month.value, year: +year.value || S.planYear, status: status.value, owner: owner.value.trim().slice(0, 40), notes: notes.value.trim().slice(0, 400), ts: p.ts || Date.now() };
    if (isNew) { const ok = await w(() => DB.add(T("plan"), body), "اتضاف للخطة 📆"); if (ok && after) after(); }
    else await w(() => DB.set(T("plan/" + p.id), body), "اتحفظ"); };
  openSheet(el("h2", { text: isNew ? "📆 حاجة جديدة في الخطة" : "✏️ تعديل" }), el("label", { class: "f", text: "إيه هي؟" }), title,
    el("div", { class: "grid2" }, el("div", null, el("label", { class: "f", text: "الشهر" }), month), el("div", null, el("label", { class: "f", text: "السنة" }), year)),
    el("div", { class: "grid2" }, el("div", null, el("label", { class: "f", text: "الحالة" }), status), el("div", null, el("label", { class: "f", text: "المسؤول" }), owner)),
    el("label", { class: "f", text: "تفاصيل" }), notes,
    el("div", { class: "acts" }, el("button", { class: "btn", onclick: save, text: "حفظ" }),
      isNew ? el("button", { class: "btn ghost", onclick: closeSheet, text: "إلغاء" }) : el("button", { class: "btn ghost", onclick: () => confirmSheet("تمسحي \"" + str(p.title, 60) + "\" من الخطة؟", () => w(() => DB.del(T("plan/" + p.id)), "اتمسح")), text: "🗑 مسح" })));
  if (isNew && !p.title) setTimeout(() => title.focus(), 50);
}
// --- feedback (suggestions & complaints)
function renderFeedback(V) {
  V.append(el("div", { class: "muted", style: "font-size:13px;margin:0 4px 8px", text: isAdmin() ? "الاقتراحات والشكاوى اللي الفريق بعتها — محدش يشوفها غير القادة واللي كتبها." : "اكتب اقتراحك أو شكوتك بحرية — محدش هيشوفها غير قادة الفريق." }));
  const c = el("div", { class: "card" });
  if (!S.feedback.length) c.append(el("div", { class: "empty" }, el("span", { class: "big", text: "📮" }), isAdmin() ? "مفيش رسايل لسه" : "دوس + واكتب اقتراحك أو شكوتك"));
  S.feedback.forEach(f => {
    const st = FB_ST[f.status] || FB_ST.new;
    const who = f.anon ? "من غير اسم" : str((userById(f.by) || {}).name || f.byName, 40) || "عضو";
    c.append(el("div", { class: "row", style: "align-items:flex-start", onclick: () => feedbackView(f) },
      el("div", { class: "main" }, el("b", { text: (FB_TYPES[f.type] || FB_TYPES.other) }), el("small", { style: "white-space:pre-wrap;color:var(--ink)", text: str(f.text, 160) + (str(f.text, 2000).length > 160 ? "…" : "") }),
        el("small", { text: (isAdmin() ? who + " · " : "") + ago(f.ts) }), f.reply ? el("small", { style: "color:var(--pri)", text: "↩️ رد القائد: " + str(f.reply, 120) }) : null),
      el("span", { class: "tag " + st.c, text: st.n })));
  });
  V.append(c);
}
function feedbackSheet() {
  let type = "suggestion";
  const tb = el("div", { class: "who-pick" }); const drawT = () => { tb.replaceChildren(); Object.keys(FB_TYPES).forEach(k => tb.append(el("button", { type: "button", class: k === type ? "on" : "", text: FB_TYPES[k], onclick: () => { type = k; drawT(); } }))); }; drawT();
  const text = el("textarea", { class: "input", style: "height:130px", placeholder: "اكتب هنا…", maxlength: "2000" });
  const anon = el("input", { type: "checkbox" });
  const save = async () => { const t = text.value.trim(); if (!t) { text.focus(); return; } closeSheet();
    await w(() => DB.add(T("feedback"), { type, text: t.slice(0, 2000), anon: anon.checked, by: S.user.uid, byName: anon.checked ? "" : myName(), status: "new", reply: "", ts: Date.now() }), "اتبعتت للقادة ✅"); };
  openSheet(el("h2", { text: "📮 اقتراح أو شكوى" }), tb, el("div", { style: "height:10px" }), text,
    el("label", { style: "display:flex;gap:8px;align-items:center;margin-top:10px;font-weight:700" }, anon, "ما تظهرش اسمي للقادة"),
    el("div", { class: "acts" }, el("button", { class: "btn", onclick: save, text: "ابعت" }), el("button", { class: "btn ghost", onclick: closeSheet, text: "إلغاء" })));
  setTimeout(() => text.focus(), 50);
}
function feedbackView(f) {
  const reply = el("textarea", { class: "input", style: "height:80px", placeholder: "اكتب رد (هيظهر للي بعت)", text: str(f.reply, 1000) });
  const mine = f.by === S.user.uid;
  openSheet(el("h2", { text: FB_TYPES[f.type] || FB_TYPES.other }), el("div", { class: "card", style: "white-space:pre-wrap", text: str(f.text, 2000) }),
    isAdmin() ? el("div", null, el("label", { class: "f", text: "الرد" }), reply,
      el("div", { class: "acts" }, el("button", { class: "btn", onclick: () => { closeSheet(); w(() => DB.update(T("feedback/" + f.id), { reply: reply.value.trim().slice(0, 1000), status: f.status === "new" ? "seen" : f.status }), "اتحفظ الرد"); }, text: "حفظ الرد" }),
        el("button", { class: "btn gold", onclick: () => { closeSheet(); w(() => DB.update(T("feedback/" + f.id), { status: f.status === "done" ? "seen" : "done" })); }, text: f.status === "done" ? "رجّعها" : "✓ اتحلت" })))
      : (f.reply ? el("div", { class: "card", style: "background:var(--pri-soft)" }, el("b", { text: "↩️ رد القائد" }), el("div", { style: "white-space:pre-wrap", text: str(f.reply, 1000) })) : el("div", { class: "muted", text: "لسه مفيش رد" })),
    el("div", { class: "acts" }, (isAdmin() || mine) ? el("button", { class: "btn ghost", onclick: () => confirmSheet("تمسح الرسالة؟", () => w(() => DB.del(T("feedback/" + f.id)), "اتمسحت")), text: "🗑 مسح" }) : null,
      el("button", { class: "btn ghost", onclick: closeSheet, text: "قفل" })));
  if (isAdmin() && f.status === "new") w(() => DB.update(T("feedback/" + f.id), { status: "seen" }));
}

// ================= HYMNS =================
function renderHymns() {
  const V = $("#v-hymns"); V.replaceChildren();
  const q = el("input", { class: "input search", placeholder: "🔍 دوّري على ترنيمة…", value: S.hymnQ }); q.addEventListener("input", () => { S.hymnQ = q.value; drawList(); }); V.append(q);
  const holder = el("div"); V.append(holder);
  function drawList() {
    holder.replaceChildren(); const qq = S.hymnQ.trim();
    const used = {}; S.sessions.forEach(s => (Array.isArray(s.setlist) ? s.setlist : []).forEach(id => { if (!used[id] || used[id] < s.date) used[id] = s.date; }));
    const hs = S.hymns.filter(h => !qq || str(h.title).includes(qq) || str(h.cat).includes(qq));
    if (!hs.length) { holder.append(el("div", { class: "card" }, el("div", { class: "empty" }, el("span", { class: "big", text: "🎵" }), S.hymns.length ? "مفيش نتيجة" : (isAdmin() ? "المكتبة فاضية. دوسي + وضيفي ترانيم الفريق" : "المكتبة فاضية")))); return; }
    const groups = {}; hs.forEach(h => { const k = str(h.cat) || "من غير تصنيف"; (groups[k] = groups[k] || []).push(h); });
    Object.keys(groups).sort().forEach(k => {
      holder.append(el("div", { class: "sec" }, k, el("span", { class: "tag", text: String(groups[k].length) })));
      const c = el("div", { class: "card" });
      groups[k].sort((a, b) => str(a.title).localeCompare(str(b.title), "ar")).forEach(h => c.append(el("div", { class: "row", onclick: () => isAdmin() ? hymnSheet(h) : (h.notes && openSheet(el("h2", { text: h.title }), el("div", { style: "white-space:pre-wrap", text: str(h.notes, 600) }))) },
        el("div", { class: "main" }, el("b", { text: str(h.title, 80) }), el("small", { text: [h.key ? "المقام: " + str(h.key, 20) : "", used[h.id] ? "آخر مرة: " + fmtDate(used[h.id]) : "لسه ما اترنمتش"].filter(Boolean).join(" · ") })),
        h.link && /^https?:\/\//.test(h.link) ? el("a", { href: h.link, target: "_blank", rel: "noopener", class: "icon-btn", onclick: e => e.stopPropagation(), text: "▶️" }) : null)));
      holder.append(c);
    });
  }
  drawList();
}
function hymnSheet(h) {
  const isNew = !h; h = h || { title: "", key: "", cat: HCATS[0], link: "", notes: "" };
  const title = el("input", { class: "input", value: str(h.title, 80), placeholder: "اسم الترنيمة", maxlength: "80" });
  const key = el("input", { class: "input", value: str(h.key, 20), placeholder: "مثلاً: Do / Re مينور", maxlength: "20" });
  const cat = el("select", { class: "input" }); HCATS.forEach(c => cat.append(el("option", { value: c, selected: h.cat === c, text: c })));
  const link = el("input", { class: "input", value: str(h.link, 300), placeholder: "لينك يوتيوب أو الكلمات (اختياري)", dir: "ltr" });
  const notes = el("textarea", { class: "input", style: "height:80px", placeholder: "ملاحظات", text: str(h.notes, 600) });
  const save = async () => { const t = title.value.trim(); if (!t) { title.focus(); return; } closeSheet();
    const body = { title: t.slice(0, 80), key: key.value.trim().slice(0, 20), cat: cat.value, link: link.value.trim().slice(0, 300), notes: notes.value.trim().slice(0, 600), ts: h.ts || Date.now() };
    if (isNew) await w(() => DB.add(T("hymns"), body), "اتضافت 🎵"); else await w(() => DB.set(T("hymns/" + h.id), body), "اتحفظت"); };
  openSheet(el("h2", { text: isNew ? "🎵 ترنيمة جديدة" : "✏️ تعديل الترنيمة" }), el("label", { class: "f", text: "الاسم" }), title,
    el("div", { class: "grid2" }, el("div", null, el("label", { class: "f", text: "المقام" }), key), el("div", null, el("label", { class: "f", text: "النوع" }), cat)),
    el("label", { class: "f", text: "لينك" }), link, el("label", { class: "f", text: "ملاحظات" }), notes,
    el("div", { class: "acts" }, el("button", { class: "btn", onclick: save, text: "حفظ" }), isNew ? el("button", { class: "btn ghost", onclick: closeSheet, text: "إلغاء" }) :
      el("button", { class: "btn ghost", onclick: () => confirmSheet("تمسحي \"" + str(h.title, 60) + "\"؟", () => w(() => DB.del(T("hymns/" + h.id)), "اتمسحت")), text: "🗑 مسح" })));
  if (isNew) setTimeout(() => title.focus(), 50);
}

// ================= TEAM (roster) =================
function renderTeam() {
  const V = $("#v-team"); V.replaceChildren();
  const q = el("input", { class: "input search", placeholder: "🔍 دوّري على اسم…", value: S.teamQ }); q.addEventListener("input", () => { S.teamQ = q.value; draw(); }); V.append(q);
  const holder = el("div"); V.append(holder);
  function draw() {
    holder.replaceChildren(); const qq = S.teamQ.trim();
    const act = activeRoster().filter(m => !qq || str(m.name).includes(qq) || str(m.role).includes(qq)); const inact = S.roster.filter(m => m.active === false);
    holder.append(el("div", { class: "sec" }, "👥 الفريق", el("span", { class: "tag", text: String(act.length) })));
    const c = el("div", { class: "card" });
    if (!act.length) c.append(el("div", { class: "empty" }, el("span", { class: "big", text: "👥" }), S.roster.length ? "مفيش نتيجة" : (isAdmin() ? "دوسي + وضيفي أعضاء الفريق وتواريخ ميلادهم" : "القائد لسه ما ضافش الأعضاء")));
    act.forEach(m => c.append(memberRow(m))); holder.append(c);
    if (inact.length && isAdmin()) { holder.append(el("div", { class: "sec muted" }, "مش منتظمين حالياً")); const c2 = el("div", { class: "card" }); inact.forEach(m => c2.append(memberRow(m))); holder.append(c2); }
    if (S.roster.length) holder.append(el("button", { class: "btn gold sm", onclick: () => {
      const ms = S.roster.map(m => ({ m, b: nextBirthday(m) })).filter(x => x.b).sort((a, b) => a.b.date.getMonth() - b.b.date.getMonth() || a.b.date.getDate() - b.b.date.getDate());
      copy("🎂 أعياد ميلاد " + S.team.name + "\n\n" + ms.map(x => "• " + x.m.name + " — " + x.b.date.getDate() + " " + MONTHS[x.b.date.getMonth()]).join("\n"));
    }, text: "📋 انسخ ليستة أعياد الميلاد" }));
  }
  draw();
}
function waNumber(p) { let d = str(p, 20).replace(/\D/g, ""); if (d.startsWith("00")) d = d.slice(2); if (d.startsWith("0")) d = "2" + d; return d; }
function memberRow(m) {
  const b = nextBirthday(m);
  return el("div", { class: "row", onclick: () => isAdmin() && memberSheet(m) }, el("div", { class: "av", text: initials(m.name) }),
    el("div", { class: "main" }, el("b", { text: str(m.name, 40) }), el("small", { text: [str(m.role, 30), b ? "🎂 " + b.date.getDate() + " " + MONTHS[b.date.getMonth()] : ""].filter(Boolean).join(" · ") })),
    b && b.days <= 7 ? el("span", { class: "tag gold", text: b.days === 0 ? "النهارده 🎉" : "بعد " + b.days + " يوم" }) : null,
    m.phone && isAdmin() ? el("a", { href: "https://wa.me/" + waNumber(m.phone), target: "_blank", rel: "noopener", class: "icon-btn", onclick: e => e.stopPropagation(), text: "💬" }) : null);
}
function memberSheet(m) {
  const isNew = !m; m = m || { name: "", role: ROLES[1], phone: "", bday: "", active: true, note: "" };
  const name = el("input", { class: "input", value: str(m.name, 40), placeholder: "الاسم", maxlength: "40" });
  const role = el("select", { class: "input" }); ROLES.forEach(r => role.append(el("option", { value: r, selected: m.role === r, text: r })));
  const phone = el("input", { class: "input", type: "tel", value: str(m.phone, 20), placeholder: "01xxxxxxxxx", dir: "ltr" });
  const bday = el("input", { class: "input", type: "date", value: str(m.bday, 10) });
  const active = el("select", { class: "input" }, el("option", { value: "1", selected: m.active !== false, text: "منتظم" }), el("option", { value: "0", selected: m.active === false, text: "مش منتظم حالياً" }));
  const note = el("input", { class: "input", value: str(m.note, 200), placeholder: "ملاحظة (اختياري)" });
  const save = async () => { const n = name.value.trim(); if (!n) { name.focus(); return; } closeSheet();
    const body = { name: n.slice(0, 40), role: role.value, phone: phone.value.trim().slice(0, 20), bday: bday.value || "", active: active.value === "1", note: note.value.trim().slice(0, 200), ts: m.ts || Date.now() };
    if (isNew) await w(() => DB.add(T("roster"), body), "اتضاف " + n + " 👏"); else await w(() => DB.set(T("roster/" + m.id), body), "اتحفظ"); };
  openSheet(el("h2", { text: isNew ? "👤 عضو جديد" : "✏️ " + str(m.name, 40) }), el("label", { class: "f", text: "الاسم" }), name,
    el("div", { class: "grid2" }, el("div", null, el("label", { class: "f", text: "دوره في الفريق" }), role), el("div", null, el("label", { class: "f", text: "الحالة" }), active)),
    el("div", { class: "grid2" }, el("div", null, el("label", { class: "f", text: "تاريخ الميلاد" }), bday), el("div", null, el("label", { class: "f", text: "الموبايل" }), phone)),
    el("label", { class: "f", text: "ملاحظة" }), note,
    el("div", { class: "acts" }, el("button", { class: "btn", onclick: save, text: "حفظ" }), isNew ? el("button", { class: "btn ghost", onclick: closeSheet, text: "إلغاء" }) :
      el("button", { class: "btn ghost", onclick: () => confirmSheet("تمسحي " + str(m.name, 40) + "؟ (الأفضل تخليه \"مش منتظم\" عشان سجل الحضور)", () => w(() => DB.del(T("roster/" + m.id)), "اتمسح")), text: "🗑 مسح" })));
  if (isNew) setTimeout(() => name.focus(), 50);
}

// ================= CALENDAR =================
function renderCal() {
  const V = $("#v-cal"); V.replaceChildren();
  V.append(el("div", { class: "sec" }, "🔁 مواعيد ثابتة كل أسبوع", el("span", { class: "sp" }), isAdmin() ? el("button", { class: "btn sm ghost", onclick: () => recSheet(), text: "+ ميعاد ثابت" }) : null));
  const c = el("div", { class: "card" });
  if (!S.recurring.length) {
    c.append(el("div", { class: "empty", text: isAdmin() ? "ضيفي المواعيد اللي بتتكرر طول السنة" : "مفيش مواعيد ثابتة لسه" }));
    if (isAdmin()) c.append(el("div", { style: "display:flex;gap:8px;justify-content:center;flex-wrap:wrap" },
      el("button", { class: "btn sm", onclick: () => recSheet({ title: "اجتماع الجمعة", day: 5, time: "19:00", place: "" }, true), text: "+ اجتماع الجمعة" }),
      el("button", { class: "btn sm", onclick: () => recSheet({ title: "التدريب", day: 3, time: "19:00", place: "" }, true), text: "+ التدريب" })));
  }
  S.recurring.slice().sort((a, b) => WEEK_ORDER.indexOf(+a.day) - WEEK_ORDER.indexOf(+b.day) || str(a.time).localeCompare(str(b.time))).forEach(r => c.append(el("div", { class: "row", onclick: () => isAdmin() && recSheet(r) },
    el("div", { class: "ev-date", style: "background:var(--pri-soft);color:var(--pri)" }, el("small", { text: "كل" }), el("b", { style: "font-size:13px", text: DAYS[+r.day] || "" })),
    el("div", { class: "main" }, el("b", { text: str(r.title, 60) }), el("small", { text: [fmtTime(r.time), r.end ? "لـ " + fmtTime(r.end) : "", str(r.place, 60)].filter(Boolean).join(" · ") }),
      el("small", { text: "الجاي: " + (nextOcc(r) ? fmtDate(nextOcc(r), true) : "—") })))));
  V.append(c);
  V.append(el("div", { class: "sec" }, "⭐ إيفينتات ومناسبات", el("span", { class: "sp" }), isAdmin() ? el("button", { class: "btn sm ghost", onclick: () => eventSheet(), text: "+ إيفينت" }) : null));
  const t = ymd(today()); const up = S.events.filter(e => str(e.date) >= t), past = S.events.filter(e => str(e.date) < t).reverse();
  const c2 = el("div", { class: "card" }); if (!up.length) c2.append(el("div", { class: "empty", text: "مفيش إيفينتات جاية (مؤتمر، حفلة، رحلة، خدمة عيد…)" }));
  let lastM = ""; up.forEach(e => { const d = parseYmd(e.date); const mk = d ? MONTHS[d.getMonth()] + " " + d.getFullYear() : ""; if (mk !== lastM) { lastM = mk; c2.append(el("div", { class: "tag gold", style: "margin:8px 0 2px", text: mk })); } c2.append(eventRow(e)); });
  V.append(c2);
  if (past.length) { V.append(el("div", { class: "sec muted" }, "اللي فات")); const c3 = el("div", { class: "card", style: "opacity:.75" }); past.slice(0, 10).forEach(e => c3.append(eventRow(e))); V.append(c3); }
}
function recSheet(r, prefill) {
  const isNew = !r || prefill; r = r || { title: "", day: 5, time: "19:00", end: "", place: "", from: "", to: "" };
  const title = el("input", { class: "input", value: str(r.title, 60), placeholder: "مثلاً: اجتماع الجمعة", maxlength: "60" });
  const day = el("select", { class: "input" }); WEEK_ORDER.forEach(i => day.append(el("option", { value: String(i), selected: +r.day === i, text: DAYS[i] })));
  const time = el("input", { class: "input", type: "time", value: r.time || "" }), end = el("input", { class: "input", type: "time", value: r.end || "" });
  const place = el("input", { class: "input", value: str(r.place, 60), placeholder: "المكان (اختياري)" });
  const from = el("input", { class: "input", type: "date", value: r.from || "" }), to = el("input", { class: "input", type: "date", value: r.to || "" });
  const save = async () => { const t = title.value.trim(); if (!t) { title.focus(); return; } closeSheet();
    const body = { title: t.slice(0, 60), day: +day.value, time: time.value || "", end: end.value || "", place: place.value.trim().slice(0, 60), from: from.value || "", to: to.value || "", ts: r.ts || Date.now() };
    if (isNew) await w(() => DB.add(T("recurring"), body), "اتضاف للجدول ✅"); else await w(() => DB.set(T("recurring/" + r.id), body), "اتحفظ"); };
  openSheet(el("h2", { text: isNew ? "🔁 ميعاد ثابت" : "✏️ تعديل الميعاد" }), el("label", { class: "f", text: "اسمه" }), title,
    el("div", { class: "grid2" }, el("div", null, el("label", { class: "f", text: "كل يوم" }), day), el("div", null, el("label", { class: "f", text: "المكان" }), place)),
    el("div", { class: "grid2" }, el("div", null, el("label", { class: "f", text: "من الساعة" }), time), el("div", null, el("label", { class: "f", text: "لحد الساعة" }), end)),
    el("div", { class: "grid2" }, el("div", null, el("label", { class: "f", text: "بيبدأ من (اختياري)" }), from), el("div", null, el("label", { class: "f", text: "لحد (اختياري)" }), to)),
    el("div", { class: "acts" }, el("button", { class: "btn", onclick: save, text: "حفظ" }), isNew ? el("button", { class: "btn ghost", onclick: closeSheet, text: "إلغاء" }) :
      el("button", { class: "btn ghost", onclick: () => confirmSheet("تمسحي \"" + str(r.title, 60) + "\"؟ سجلات الحضور القديمة هتفضل محفوظة.", () => w(() => DB.del(T("recurring/" + r.id)), "اتمسح")), text: "🗑 مسح" })));
}
function eventSheet(e) {
  const isNew = !e; e = e || { title: "", date: ymd(today()), time: "", place: "", note: "" };
  const title = el("input", { class: "input", value: str(e.title, 80), placeholder: "مثلاً: حفلة الكريسماس، مؤتمر، رحلة", maxlength: "80" });
  const date = el("input", { class: "input", type: "date", value: str(e.date, 10) }), time = el("input", { class: "input", type: "time", value: e.time || "" });
  const place = el("input", { class: "input", value: str(e.place, 60), placeholder: "المكان" });
  const note = el("textarea", { class: "input", style: "height:70px", placeholder: "تفاصيل", text: str(e.note, 400) });
  const save = async () => { const t = title.value.trim(); if (!t) { title.focus(); return; } if (!date.value) { date.focus(); return; } closeSheet();
    const body = { title: t.slice(0, 80), date: date.value, time: time.value || "", place: place.value.trim().slice(0, 60), note: note.value.trim().slice(0, 400), ts: e.ts || Date.now() };
    if (isNew) await w(() => DB.add(T("events"), body), "اتضاف ⭐"); else await w(() => DB.set(T("events/" + e.id), body), "اتحفظ"); };
  openSheet(el("h2", { text: isNew ? "⭐ إيفينت جديد" : "✏️ تعديل الإيفينت" }), el("label", { class: "f", text: "اسمه" }), title,
    el("div", { class: "grid2" }, el("div", null, el("label", { class: "f", text: "التاريخ" }), date), el("div", null, el("label", { class: "f", text: "الساعة" }), time)),
    el("label", { class: "f", text: "المكان" }), place, el("label", { class: "f", text: "تفاصيل" }), note,
    el("div", { class: "acts" }, el("button", { class: "btn", onclick: save, text: "حفظ" }), isNew ? el("button", { class: "btn ghost", onclick: closeSheet, text: "إلغاء" }) :
      el("button", { class: "btn ghost", onclick: () => confirmSheet("تمسحي \"" + str(e.title, 60) + "\"؟", () => w(() => DB.del(T("events/" + e.id)), "اتمسح")), text: "🗑 مسح" })));
  if (isNew) setTimeout(() => title.focus(), 50);
}

// ================= SETTINGS =================
function renderSettings() {
  const V = $("#v-settings"); V.replaceChildren();
  const code = str(S.team.code, 12);
  if (isAdmin()) {
    const inviteText = "انضم لفريق " + S.team.name + " على أبلكيشن " + APP_NAME + " 🎶\nكود الفريق: " + code + "\n" + location.origin + location.pathname;
    V.append(el("div", { class: "sec" }, "🔑 كود الفريق"),
      el("div", { class: "card" }, el("div", { class: "muted", style: "font-size:13px;margin-bottom:8px", text: "ابعتي الكود ده للأعضاء عشان يدخلوا الفريق من موبايلاتهم" }), el("div", { class: "code-box", text: code }),
        el("div", { style: "display:flex;gap:8px;margin-top:10px" }, el("button", { class: "btn sm", onclick: () => copy(inviteText), text: "📋 نسخ الدعوة" }),
          el("a", { class: "btn sm gold", href: waShare(inviteText), target: "_blank", rel: "noopener", style: "text-decoration:none", text: "💬 ابعت على واتساب" }))));
  }
  V.append(el("div", { class: "sec" }, "📱 مين داخل الأبلكيشن", el("span", { class: "tag", text: String(S.users.length) })));
  const c = el("div", { class: "card" });
  S.users.slice().sort((a, b) => (a.role === "admin" ? 0 : 1) - (b.role === "admin" ? 0 : 1)).forEach(u => {
    const isOwner = u.id === S.team.ownerUid, isMe = u.id === S.user.uid;
    c.append(el("div", { class: "row" }, el("div", { class: "av", text: initials(u.name) }),
      el("div", { class: "main" }, el("b", { text: str(u.name, 40) + (isMe ? " (إنت)" : "") }), el("small", { text: isOwner ? "صاحب الفريق" : u.role === "admin" ? "قائد" : "عضو" })),
      isAdmin() && !isOwner && !isMe ? el("button", { class: "btn sm ghost", onclick: () => w(() => DB.update(T("users/" + u.id), { role: u.role === "admin" ? "member" : "admin" }), "اتغيرت الصلاحية"), text: u.role === "admin" ? "خليه عضو" : "خليه قائد" }) : null,
      isAdmin() && !isOwner && !isMe ? el("button", { class: "icon-btn", onclick: () => confirmSheet("تشيل " + str(u.name, 40) + " من الأبلكيشن؟", () => w(() => DB.del(T("users/" + u.id)), "اتشال")), text: "✕" }) : null));
  });
  V.append(c);
  V.append(el("div", { class: "sec" }, "👤 حسابي"),
    el("div", { class: "card" }, el("div", { class: "row" }, el("div", { class: "main" }, el("b", { text: myName() }), el("small", { text: S.user.email || "" }))),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px" },
        el("button", { class: "btn sm ghost", onclick: renameSheet, text: "✏️ غيّر اسمي" }),
        el("button", { class: "btn sm ghost", onclick: () => confirmSheet("تسجيل خروج؟", () => DB.signOut()), text: "🚪 تسجيل خروج" }),
        el("button", { class: "btn sm ghost", style: "color:var(--red)", onclick: deleteAccountSheet, text: "مسح حسابي" }))),
    el("div", { style: "text-align:center;margin-top:10px" }, el("a", { class: "link", href: "privacy.html", target: "_blank", rel: "noopener", text: "سياسة الخصوصية" })));
  if (isAdmin() && S.team.ownerUid === S.user.uid) V.append(el("button", { class: "btn sm ghost", style: "margin-top:4px", onclick: renameTeamSheet, text: "✏️ غيّر اسم الفريق" }));
}
function deleteAccountSheet() {
  const owner = S.team && S.team.ownerUid === S.user.uid;
  openSheet(el("h2", { text: "مسح حسابك نهائياً؟" }),
    el("div", { class: "muted", text: owner
      ? "إنت صاحب الفريق. لو مسحت حسابك، بيانات الفريق هتفضل موجودة للقادة التانيين. الأفضل تخلي حد تاني قائد الأول من نفس الصفحة."
      : "هيتمسح حسابك وهتخرج من الفريق. طلبات الصلاة والأفكار اللي كتبتها هتفضل من غير اسمك." }),
    el("div", { class: "acts" },
      el("button", { class: "btn", style: "background:var(--red)", onclick: async () => {
        closeSheet();
        try {
          try { await DB.del(T("users/" + S.user.uid)); } catch (e) {}
          try { await DB.del("profiles/" + S.user.uid); } catch (e) {}
          await DB.deleteAccount(); toast("اتمسح حسابك");
        } catch (e) {
          if (e && e.code === "auth/requires-recent-login") { toast("سجّل خروج وادخل تاني وبعدين امسح الحساب"); }
          else toast("ما قدرناش نمسح الحساب، جرب تاني");
        }
      }, text: "أيوه، امسح" }),
      el("button", { class: "btn ghost", onclick: closeSheet, text: "لأ" })));
}
function renameSheet() {
  const n = el("input", { class: "input", value: myName(), maxlength: "40" });
  openSheet(el("h2", { text: "اسمك" }), n, el("div", { class: "acts" }, el("button", { class: "btn", onclick: async () => { const v = n.value.trim(); if (!v) return; closeSheet();
    await w(() => DB.update(T("users/" + S.user.uid), { name: v.slice(0, 40) })); await w(() => DB.update("profiles/" + S.user.uid, { name: v.slice(0, 40) }), "اتغير"); }, text: "حفظ" })));
}
function renameTeamSheet() {
  const n = el("input", { class: "input", value: str(S.team.name, 60), maxlength: "60" });
  openSheet(el("h2", { text: "اسم الفريق" }), n, el("div", { class: "acts" }, el("button", { class: "btn", onclick: async () => { const v = n.value.trim(); if (!v) return; closeSheet(); await w(() => DB.update("teams/" + S.team.id, { name: v.slice(0, 60) }), "اتغير"); }, text: "حفظ" })));
}

// ================= sheets =================
function openSheet(...k) { $("#sheet").replaceChildren(...k); $("#sheetBg").classList.add("on"); }
function closeSheet() { $("#sheetBg").classList.remove("on"); }
$("#sheetBg").addEventListener("click", e => { if (e.target.id === "sheetBg") closeSheet(); });
function confirmSheet(q, fn) { openSheet(el("h2", { text: q }), el("div", { class: "acts" }, el("button", { class: "btn", onclick: () => { closeSheet(); fn(); }, text: "أيوه" }), el("button", { class: "btn ghost", onclick: closeSheet, text: "لأ" }))); }
