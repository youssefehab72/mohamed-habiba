// Couple's private page: passcode → open any piece by number, browse all, fix numbers, download everything.
(function () {
  const { t } = I18N;
  const CFG = window.PUZZLE_CONFIG || {};
  const TOTAL = Math.max(1, parseInt(CFG.TOTAL_PIECES, 10) || 60);
  const PASS_KEY = "puzzle-couple-pass";
  const $ = (id) => document.getElementById(id);
  const show = (el, on) => { el.hidden = !on; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let pass = null, rows = [], current = null;
  try { pass = localStorage.getItem(PASS_KEY); } catch (e) {}

  // ---------- language ----------
  $("langBtn").onclick = () => I18N.setLang(I18N.lang === "ar" ? "en" : "ar");
  document.addEventListener("langchange", () => { renderDemo(); renderProgress(); renderGrid(); if (current != null) renderMemory(current); });
  function renderDemo() {
    show($("demoNote"), API.DEMO);
    $("demoNote").textContent = t("demo") + (I18N.lang === "ar" ? " الباسورد: " : " Passcode: ") + API.DEMO_PASS;
  }

  // ---------- toast & modal ----------
  function toast(msg) {
    const d = el("div", "toast", msg); document.body.appendChild(d);
    setTimeout(() => d.remove(), 2600);
  }
  function modal(build) {
    const m = $("modal"); m.innerHTML = "";
    const close = () => show($("modalBack"), false);
    build(m, close);
    show($("modalBack"), true);
    const inp = m.querySelector("input"); if (inp) inp.focus();
  }
  $("modalBack").addEventListener("click", (e) => { if (e.target === $("modalBack")) show($("modalBack"), false); });

  // ---------- auth ----------
  function showLogin(msg) {
    show($("login"), true); show($("main"), false); show($("logout"), false); show($("progress"), false);
    $("loginErr").textContent = msg || "";
    $("pass").focus();
  }
  // Passcodes are not case-sensitive, and Arabic digits count as normal digits
  const normPass = (v) => String(v || "").trim().toLowerCase()
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  async function tryLogin() {
    const p = normPass($("pass").value);
    if (!p) return;
    $("loginBtn").disabled = true; $("loginErr").textContent = "";
    try {
      const ok = await API.coupleOk(p);
      if (!ok) { $("loginErr").textContent = t("cWrong"); return; }
      pass = p;
      try { localStorage.setItem(PASS_KEY, p); } catch (e) {}
      $("pass").value = "";
      await load(true);
    } catch (e) {
      show($("offline"), true);
    } finally { $("loginBtn").disabled = false; }
  }
  $("loginBtn").onclick = tryLogin;
  $("pass").addEventListener("keydown", (e) => { if (e.key === "Enter") tryLogin(); });
  $("logout").onclick = () => {
    try { localStorage.removeItem(PASS_KEY); } catch (e) {}
    pass = null; rows = []; current = null; $("memory").innerHTML = "";
    showLogin();
  };

  // ---------- data ----------
  async function load(first) {
    show($("offline"), false);
    try {
      rows = (await API.coupleList(pass)) || [];
    } catch (e) {
      if (e.code === "28P01" || /passcode/i.test(e.message)) {
        try { localStorage.removeItem(PASS_KEY); } catch (er) {}
        pass = null; showLogin(t("cWrong")); return;
      }
      show($("offline"), true);
      if (first) showLogin();
      return;
    }
    show($("login"), false); show($("main"), true); show($("logout"), true);
    renderProgress(); renderGrid();
    if (current != null) renderMemory(current);
  }
  $("refresh").onclick = () => load(false);

  function renderProgress() {
    if (!pass || !rows) return;
    show($("progress"), true);
    $("progressText").textContent = t("filled", { n: rows.length, total: TOTAL });
    $("progressFill").style.width = Math.min(100, (rows.length / TOTAL) * 100) + "%";
  }
  const byPiece = (n) => rows.find((r) => r.piece === n);

  // ---------- tabs ----------
  function tab(which) {
    $("tabOpen").setAttribute("aria-selected", which === "open");
    $("tabAll").setAttribute("aria-selected", which === "all");
    show($("viewOpen"), which === "open"); show($("viewAll"), which === "all");
  }
  $("tabOpen").onclick = () => tab("open");
  $("tabAll").onclick = () => tab("all");

  // ---------- open a piece ----------
  function openNum() {
    const n = I18N.parseNum($("num").value);
    if (!Number.isFinite(n)) { $("num").focus(); return; }
    renderMemory(n);
  }
  $("numGo").onclick = openNum;
  $("num").addEventListener("keydown", (e) => { if (e.key === "Enter") openNum(); });
  $("num").addEventListener("input", (e) => {
    const n = I18N.parseNum(e.target.value);
    e.target.value = Number.isFinite(n) ? n : "";
  });

  function renderMemory(n) {
    current = n;
    $("num").value = n;
    const box = $("memory"); box.innerHTML = "";
    const r = byPiece(n);
    const card = el("article", "card memory");
    const head = el("div", "m-num");
    head.innerHTML = '<svg viewBox="0 0 100 100" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M20 30H40C40 16 60 16 60 30H80V50C94 50 94 70 80 70V90H60C60 78 40 78 40 90H20V70C32 70 32 50 20 50Z"/></svg>';
    head.appendChild(document.createTextNode(t("cPiece", { n })));
    card.appendChild(head);

    if (!r) {
      card.appendChild(el("p", "hint", rows.length ? t("cEmpty", { n }) : t("cNone")));
    } else {
      const who = r.partner_name ? `${r.guest_name} ${I18N.lang === "ar" ? "و" : "& "}${r.partner_name}` : r.guest_name;
      const from = el("div", "m-from", who); from.dir = "auto"; card.appendChild(from);
      if (r.side) { const sc = el("span", "cat", t("cSide_" + r.side)); sc.style.marginBottom = "12px"; card.insertBefore(sc, from.nextSibling); card.insertBefore(el("div"), sc.nextSibling); }
      const q = el("div", "m-q");
      q.appendChild(el("small", null, r.kind === "question" ? "💬" : "💌 " + t("cNote")));
      if (r.kind === "question" && r.question) { const qs = el("span", null, r.question); qs.dir = "auto"; qs.style.display = "block"; q.appendChild(qs); }
      card.appendChild(q);
      if (r.message) {
        const m = el("p", "m-msg", r.message);
        m.dir = "auto";
        card.appendChild(m);
      }
      if (r.audio_path) {
        const a = el("audio"); a.controls = true; a.preload = "metadata";
        card.appendChild(a);
        API.mediaUrl(r.audio_path).then((u) => { a.src = u; });
      }
      if (r.photo_path) {
        const img = el("img", "m-photo"); img.alt = ""; img.loading = "lazy";
        card.insertBefore(img, card.querySelector(".m-q").nextSibling);
        API.mediaUrl(r.photo_path).then((u) => { img.src = u; });
      }
      if (r.created_at) {
        const d = new Date(r.created_at);
        card.appendChild(el("div", "m-time", d.toLocaleString(I18N.lang === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" })));
      }
      const tools = el("div", "tools");
      const mv = el("button", "btn btn-ghost btn-small", t("cMove")); mv.onclick = () => moveDialog(r.piece);
      const rm = el("button", "btn btn-ghost btn-small", t("cRemove")); rm.onclick = () => removeDialog(r.piece);
      tools.append(mv, rm);
      card.appendChild(tools);
    }

    // previous / next filled piece
    const nums = rows.map((x) => x.piece);
    const prev = [...nums].reverse().find((x) => x < n), next = nums.find((x) => x > n);
    if (prev != null || next != null) {
      const nav = el("div", "nav");
      const bp = el("button", "btn btn-ghost btn-small", (I18N.lang === "ar" ? "→ " : "← ") + t("cPrev"));
      const bn = el("button", "btn btn-ghost btn-small", t("cNext") + (I18N.lang === "ar" ? " ←" : " →"));
      bp.disabled = prev == null; bn.disabled = next == null;
      bp.onclick = () => renderMemory(prev); bn.onclick = () => renderMemory(next);
      nav.append(bp, bn);
      card.appendChild(nav);
    }
    box.appendChild(card);
  }

  // ---------- all pieces ----------
  function renderGrid() {
    const g = $("grid"); g.innerHTML = "";
    const max = Math.max(TOTAL, ...rows.map((r) => r.piece), 0);
    for (let i = 1; i <= max; i++) {
      const r = byPiece(i);
      const b = el("button", "cell" + (r ? " full" : ""), I18N.num(i));
      if (r) {
        const marks = (r.message ? "✎" : "") + (r.audio_path ? "♪" : "") + (r.photo_path ? "▣" : "");
        b.appendChild(el("span", "dot", marks));
        b.title = r.guest_name;
      }
      b.onclick = () => { tab("open"); renderMemory(i); };
      g.appendChild(b);
    }
  }

  // ---------- fix mistakes ----------
  function moveDialog(from) {
    modal((m, close) => {
      m.appendChild(el("p", null, t("cMoveTo")));
      const inp = el("input", "input piece-input"); inp.inputMode = "numeric"; inp.maxLength = 4;
      const err = el("div", "status bad");
      const bar = el("div", "actions");
      const cancel = el("button", "btn btn-ghost", t("cancel"));
      const save = el("button", "btn btn-primary", t("cSave"));
      cancel.onclick = close;
      save.onclick = async () => {
        const to = I18N.parseNum(inp.value);
        if (!Number.isFinite(to) || to < 1) { inp.focus(); return; }
        save.disabled = true;
        try {
          const r = await API.coupleMove(pass, from, to);
          if (r && r.ok) { close(); await load(false); renderMemory(to); toast(t("cMoved", { n: to })); }
          else err.textContent = r && r.error === "taken" ? t("cMoveTaken", { n: to }) : (r && r.error) || "error";
        } catch (e) { err.textContent = t("cOffline"); }
        finally { save.disabled = false; }
      };
      bar.append(cancel, save);
      m.append(inp, err, bar);
    });
  }
  function removeDialog(n) {
    modal((m, close) => {
      m.appendChild(el("p", null, t("cRemoveSure", { n })));
      const bar = el("div", "actions");
      const cancel = el("button", "btn btn-ghost", t("cancel"));
      const yes = el("button", "btn btn-primary", t("cYes"));
      cancel.onclick = close;
      yes.onclick = async () => {
        yes.disabled = true;
        try { await API.coupleRemove(pass, n); close(); await load(false); renderMemory(n); toast(t("cRemoved")); }
        catch (e) { toast(t("cOffline")); yes.disabled = false; }
      };
      bar.append(cancel, yes);
      m.appendChild(bar);
    });
  }

  // ---------- download everything ----------
  function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = () => res(window.JSZip); s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const pad = (n) => String(n).padStart(3, "0");
  const extOf = (p) => (p.split(".").pop() || "bin").toLowerCase();

  $("download").onclick = async () => {
    const btn = $("download"), status = $("dlStatus");
    btn.disabled = true;
    try {
      await load(false);
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      const media = zip.folder("media");
      const out = [], missing = [];
      const jobs = rows.filter((r) => r.audio_path || r.photo_path).length;
      let i = 0;
      for (const r of rows) {
        const item = Object.assign({}, r, { audio_file: null, photo_file: null });
        if (r.audio_path || r.photo_path) status.textContent = t("cPreparing", { i: ++i, n: jobs });
        for (const kind of ["audio", "photo"]) {
          const p = r[kind + "_path"]; if (!p) continue;
          let b = null;
          for (let attempt = 1; attempt <= 4 && !b; attempt++) {
            try {
              const res = await fetch(await API.mediaUrl(p), { cache: "no-store" });
              if (!res.ok) throw new Error("HTTP " + res.status);
              b = await res.blob();
            } catch (e) { console.warn("could not fetch", p, e); await new Promise((ok) => setTimeout(ok, 1500 * attempt)); }
          }
          if (b) {
            const name = `piece-${pad(r.piece)}-${kind === "audio" ? "voice" : "photo"}.${extOf(p)}`;
            media.file(name, b);
            item[kind + "_file"] = "media/" + name;
          } else { missing.push(r.piece); item[kind + "_missing"] = true; }
        }
        out.push(item);
      }
      zip.file("memories.json", JSON.stringify(out, null, 2));
      const cols = ["piece", "guest_name", "partner_name", "side", "kind", "question", "message", "audio_file", "photo_file", "created_at"];
      const csv = "﻿" + [cols.join(",")].concat(out.map((r) => cols.map((c) => `"${String(r[c] == null ? "" : r[c]).replace(/"/g, '""')}"`).join(","))).join("\r\n");
      zip.file("memories.csv", csv);
      zip.file("keepsake.html", keepsakeHtml(out));
      status.textContent = "…";
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "puzzle-memories.zip";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      status.textContent = missing.length ? t("cMissing", { list: [...new Set(missing)].join(", ") }) : "✓";
    } catch (e) {
      console.error(e); status.textContent = t("cOffline");
    } finally { btn.disabled = false; }
  };

  function sideLabel(side) {
    const N = CFG.NAMES || {}, n = (who, l) => (N[who] && N[who][l]) || "";
    return ({ bride: `${n("bride", "en")}'s side · من طرف ${n("bride", "ar")}`, groom: `${n("groom", "en")}'s side · من طرف ${n("groom", "ar")}`, both: "Knows both · يعرف الاتنين" })[side] || "";
  }
  function keepsakeHtml(items) {
    const names = esc((CFG.COUPLE && (CFG.COUPLE.en + " · " + CFG.COUPLE.ar)) || "");
    const cards = items.map((r) => `
<article>
  <div class="n">#${r.piece}</div>
  <h2>${esc(r.guest_name)}${r.partner_name ? " &amp; " + esc(r.partner_name) : ""}</h2>
  ${r.side ? `<p class="s">${esc(sideLabel(r.side))}</p>` : ""}
  ${r.kind === "question" && r.question ? `<p class="q">${esc(r.question)}</p>` : ""}
  ${r.photo_file ? `<img src="${esc(r.photo_file)}" alt="">` : ""}
  ${r.message ? `<p class="m" dir="auto">${esc(r.message)}</p>` : ""}
  ${r.audio_file ? `<audio controls src="${esc(r.audio_file)}"></audio>` : ""}
</article>`).join("\n");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Puzzle of Memories</title>
<style>body{margin:0;background:#f8f2ea;color:#2a1b1f;font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif}
main{max-width:720px;margin:0 auto;padding:24px 16px}h1{text-align:center;color:#9b3a4d;font-family:Georgia,serif}
article{background:#fffdfa;border:1px solid #e6d8cc;border-radius:16px;padding:18px;margin:0 0 16px;break-inside:avoid}
.n{color:#b48a3c;font-weight:700}h2{margin:4px 0 10px;color:#9b3a4d}.q{background:#f3e8d2;border-radius:10px;padding:8px 12px}
.m{white-space:pre-wrap;font-size:18px;line-height:1.7}img{max-width:100%;border-radius:12px}audio{width:100%}</style></head>
<body><main><h1>${names}</h1>${cards}</main></body></html>`;
  }

  // ---------- start ----------
  I18N.applyLang();
  renderDemo();
  if (pass) load(true); else showLogin();
})();
