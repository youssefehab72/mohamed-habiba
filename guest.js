// Guest page: piece number → names → question or note → write / voice / photo → send.
(function () {
  const { t, QUESTIONS } = I18N;
  const CFG = window.PUZZLE_CONFIG || {};
  const TOTAL = Math.max(1, parseInt(CFG.TOTAL_PIECES, 10) || 60);
  const FRAME = Math.max(0, parseInt(CFG.FRAME_SIZE, 10) || 0);
  const frameOf = (n) => (FRAME && TOTAL > FRAME ? Math.ceil(n / FRAME) : 0);
  const MAX_SEC = Math.max(10, parseInt(CFG.MAX_VOICE_SECONDS, 10) || 90);
  const $ = (id) => document.getElementById(id);

  const st = {
    step: 1, piece: null, pieceState: null, side: null, kind: "question", qIndex: 0, deck: [],
    audio: null, photo: null, uploads: {}, sending: false, lastSent: null,
  };

  // ---------- helpers ----------
  const show = (el, on) => { el.hidden = !on; };
  const shake = (el) => { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); };
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const baseType = (type) => (type || "").split(";")[0].trim() || "application/octet-stream";

  const shuffled = (arr) => {
    const d = arr.slice();
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  };
  const idsFor = (side, exclude) => QUESTIONS.map((q, i) => (q.side === side && i !== exclude ? i : -1)).filter((i) => i >= 0);
  // The deck is popped from the end: a guest from one side gets their side's questions first, then the "both" ones.
  function newDeck(exclude) {
    if (st.side === "bride" || st.side === "groom") return shuffled(idsFor("both", exclude)).concat(shuffled(idsFor(st.side, exclude)));
    return shuffled(QUESTIONS.map((_, i) => i).filter((i) => i !== exclude));
  }
  // Question groups shown in "See all questions", in order.
  const groupOrder = () => (st.side === "bride" ? ["bride", "both"] : st.side === "groom" ? ["groom", "both"] : ["both", "bride", "groom"]);
  st.deck = newDeck(-1);
  st.qIndex = st.deck.pop();

  // ---------- language ----------
  $("langBtn").onclick = () => I18N.setLang(I18N.lang === "ar" ? "en" : "ar");
  document.addEventListener("langchange", renderDynamic);

  function renderDynamic() {
    $("s1label").textContent = t("stepOf", { i: 1 });
    $("s2label").textContent = t("stepOf", { i: 2 });
    $("s3label").textContent = t("stepOf", { i: 3 });
    $("maxVoice").textContent = t("optional") + " · " + t("maxVoice", { s: MAX_SEC });
    renderSuggest();
    $("s3title").textContent = st.kind === "question" ? t("step3TitleQ") : t("step3TitleNote");
    renderQuestion(false);
    renderPieceStatus();
    renderProgress();
    if (st.lastSent) renderDone();
    if (st.pendingPiece) $("pendingText").textContent = t("pendingFound", { n: st.pendingPiece });
  }

  // ---------- progress ----------
  let filled = null;
  async function loadProgress() {
    try { filled = await API.filledCount(); renderProgress(); } catch (e) { /* offline is fine */ }
  }
  function renderProgress() {
    if (filled == null) return;
    show($("progress"), true);
    $("progressText").textContent = t("filled", { n: filled, total: TOTAL });
    $("progressFill").style.width = Math.min(100, (filled / TOTAL) * 100) + "%";
  }

  // ---------- suggestion: "try to find piece N" ----------
  let suggested = null;
  async function loadSuggestion() {
    try { suggested = await API.suggestPiece(TOTAL); } catch (e) { suggested = null; }
    renderSuggest();
  }
  function renderSuggest() {
    const ok = Number.isInteger(suggested) && suggested >= 1;
    show($("suggest"), ok);
    if (!ok) return;
    $("suggestText").textContent = t("suggestText", { n: suggested });
    $("suggestUse").textContent = t("suggestUse", { n: suggested });
  }
  $("suggestUse").onclick = () => {
    if (!Number.isInteger(suggested)) return;
    const el = $("piece"); el.value = suggested; el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  // ---------- how it works ----------
  const openHelp = () => { show($("help"), true); document.body.style.overflow = "hidden"; };
  const closeHelp = () => { show($("help"), false); document.body.style.overflow = ""; };
  $("helpBtn").onclick = openHelp; $("helpClose").onclick = closeHelp; $("helpOk").onclick = closeHelp;
  $("help").addEventListener("click", (e) => { if (e.target === $("help")) closeHelp(); });

  // ---------- steps ----------
  function go(step) {
    st.step = step;
    show($("step1"), step === 1); show($("step2"), step === 2); show($("step3"), step === 3);
    show($("doneCard"), step === 4); show($("dots"), step < 4);
    [...$("dots").children].forEach((d, i) => d.classList.toggle("on", i === step - 1));
    if (step === 3) {
      $("s3title").textContent = st.kind === "question" ? t("step3TitleQ") : t("step3TitleNote");
      show($("miniQ"), st.kind === "question");
      renderQuestion(false);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- step 1: piece + names ----------
  let checkSeq = 0, checkTimer;
  function setPieceState(s) { st.pieceState = s; renderPieceStatus(); }
  function renderPieceStatus() {
    const el = $("pieceStatus"), s = st.pieceState;
    el.className = "status";
    if (!s) { el.textContent = ""; return; }
    if (s === "checking") el.textContent = t("checking");
    else if (s === "ok") { const f = frameOf(st.piece); el.textContent = f ? t("availableFrame", { n: st.piece, f }) : t("available", { n: st.piece }); el.classList.add("ok"); }
    else if (s === "taken") { el.textContent = t("taken", { n: st.piece }); el.classList.add("bad"); }
    else if (s === "range") { el.textContent = t("outOfRange", { total: TOTAL }); el.classList.add("bad"); }
    else if (s === "unknown") el.textContent = "";
  }
  async function checkPiece() {
    const n = st.piece;
    if (!n) { setPieceState(null); return null; }
    if (n < 1 || n > TOTAL) { setPieceState("range"); return "range"; }
    const seq = ++checkSeq;
    setPieceState("checking");
    try {
      const taken = await API.pieceTaken(n);
      if (seq !== checkSeq) return st.pieceState;
      setPieceState(taken ? "taken" : "ok");
    } catch (e) {
      if (seq === checkSeq) setPieceState("unknown"); // offline: the server double-checks on send
    }
    return st.pieceState;
  }
  $("piece").addEventListener("input", (e) => {
    const n = I18N.parseNum(e.target.value);
    st.piece = Number.isFinite(n) ? n : null;
    if (st.piece != null && String(st.piece) !== e.target.value) e.target.value = st.piece;
    if (st.piece == null) e.target.value = "";
    $("s1err").textContent = "";
    clearTimeout(checkTimer);
    checkTimer = setTimeout(checkPiece, 350);
  });
  $("partnerAdd").onclick = () => { show($("partnerWrap"), true); show($("partnerAdd"), false); $("partner").focus(); };
  $("partnerRemove").onclick = () => { $("partner").value = ""; show($("partnerWrap"), false); show($("partnerAdd"), true); };

  function setSide(side) {
    const changed = st.side !== side;
    st.side = side;
    document.querySelectorAll(".side-opt").forEach((b) => b.setAttribute("aria-pressed", b.dataset.side === side));
    if (changed) { st.deck = newDeck(-1); st.qIndex = st.deck.pop(); renderQuestion(false); }
    $("s1err").textContent = "";
  }
  document.querySelectorAll(".side-opt").forEach((b) => { b.onclick = () => setSide(b.dataset.side); });

  $("s1next").onclick = async () => {
    const err = $("s1err");
    err.textContent = "";
    if (!st.piece) { err.textContent = t("needPiece"); shake($("piece")); $("piece").focus(); return; }
    let s = st.pieceState;
    if (s !== "ok" && s !== "unknown") { clearTimeout(checkTimer); s = await checkPiece(); }
    if (s === "range" || s === "taken") { shake($("piece")); return; }
    if (!$("name").value.trim()) { err.textContent = t("needName"); shake($("name")); $("name").focus(); return; }
    if (!st.side) { err.textContent = t("needSide"); shake($("sides")); return; }
    go(2);
  };

  // ---------- step 2: question or note ----------
  function setKind(k) {
    st.kind = k;
    $("modeQ").setAttribute("aria-pressed", k === "question");
    $("modeN").setAttribute("aria-pressed", k === "note");
    show($("qcard"), k === "question");
  }
  $("modeQ").onclick = () => setKind("question");
  $("modeN").onclick = () => setKind("note");

  function questionText() { return I18N.qText(QUESTIONS[st.qIndex]); }
  function renderQuestion(animate) {
    const q = QUESTIONS[st.qIndex];
    $("qcat").textContent = t("cat_" + q.cat);
    $("qtext").textContent = questionText();
    $("miniQtext").textContent = questionText();
    if (animate) { const el = $("qtext"); el.classList.remove("swap"); void el.offsetWidth; el.classList.add("swap"); }
  }
  $("shuffle").onclick = () => {
    if (!st.deck.length) st.deck = newDeck(st.qIndex);
    st.qIndex = st.deck.pop();
    setKind("question");
    renderQuestion(true);
  };

  function openSheet() {
    const body = $("sheetBody");
    body.innerHTML = "";
    groupOrder().forEach((side) => {
      const h = document.createElement("div");
      h.className = "sheet-cat"; h.textContent = t("grp_" + side);
      body.appendChild(h);
      QUESTIONS.forEach((q, i) => {
        if (q.side !== side) return;
        const b = document.createElement("button");
        b.className = "qopt";
        const c = document.createElement("span"); c.className = "cat"; c.textContent = t("cat_" + q.cat);
        const tx = document.createElement("span"); tx.style.display = "block"; tx.textContent = I18N.qText(q);
        b.append(c, tx);
        b.setAttribute("aria-pressed", i === st.qIndex);
        b.onclick = () => { st.qIndex = i; setKind("question"); renderQuestion(true); closeSheet(); };
        body.appendChild(b);
      });
    });
    show($("sheet"), true);
    document.body.style.overflow = "hidden";
    const sel = body.querySelector('[aria-pressed="true"]');
    if (sel) sel.scrollIntoView({ block: "center" });
  }
  function closeSheet() { show($("sheet"), false); document.body.style.overflow = ""; }
  $("seeAll").onclick = openSheet;
  $("changeQ").onclick = openSheet;
  $("sheetClose").onclick = closeSheet;
  $("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) closeSheet(); });

  $("s2back").onclick = () => go(1);
  $("s2next").onclick = () => go(3);
  $("s3back").onclick = () => go(2);

  // ---------- voice note ----------
  let rec, recStream, recChunks = [], recTimer, recStart, actx, raf;
  const meter = $("meter");
  for (let i = 0; i < 22; i++) meter.appendChild(document.createElement("i"));

  function recErr(msg) { $("recErr").textContent = msg || ""; }
  function recView(v) { show($("recIdle"), v === "idle"); show($("recLive"), v === "live"); show($("recDone"), v === "done"); }

  async function startRec() {
    recErr("");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { recErr(t("micDenied")); return; }
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { recErr(t("micDenied")); return; }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
      .find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m));
    try {
      rec = new MediaRecorder(recStream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
    } catch (e) { rec = new MediaRecorder(recStream); }
    recChunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    rec.onstop = () => {
      const type = rec.mimeType || mime || "audio/webm";
      const blob = new Blob(recChunks, { type });
      const secs = (Date.now() - recStart) / 1000;
      stopStream();
      if (secs < 1 || !blob.size) { recView("idle"); return; }
      setAudio(blob, type);
    };
    rec.start(1000);
    recStart = Date.now();
    recView("live");
    tick();
    recTimer = setInterval(tick, 250);
    startMeter(recStream);
  }
  function tick() {
    const s = (Date.now() - recStart) / 1000;
    $("recTime").textContent = `${fmt(s)} / ${fmt(MAX_SEC)}`;
    if (s >= MAX_SEC) stopRec();
  }
  function stopRec() { if (rec && rec.state !== "inactive") rec.stop(); clearInterval(recTimer); }
  function stopStream() {
    clearInterval(recTimer); cancelAnimationFrame(raf);
    if (recStream) recStream.getTracks().forEach((tr) => tr.stop());
    if (actx) { actx.close().catch(() => {}); actx = null; }
  }
  function startMeter(stream) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      const an = actx.createAnalyser(); an.fftSize = 512;
      actx.createMediaStreamSource(stream).connect(an);
      const data = new Uint8Array(an.fftSize), bars = [...meter.children], hist = new Array(bars.length).fill(0);
      let last = 0;
      const loop = (ts) => {
        raf = requestAnimationFrame(loop);
        if (ts - last < 70) return; last = ts;
        an.getByteTimeDomainData(data);
        let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        hist.shift(); hist.push(Math.min(1, Math.sqrt(sum / data.length) * 4));
        bars.forEach((b, i) => { b.style.height = 4 + hist[i] * 22 + "px"; });
      };
      raf = requestAnimationFrame(loop);
    } catch (e) {}
  }
  function setAudio(blob, type) {
    st.audio = blob ? { blob, type } : null;
    st.uploads.audio = null;
    const a = $("recAudio");
    if (a.dataset.url) URL.revokeObjectURL(a.dataset.url);
    if (blob) { a.dataset.url = URL.createObjectURL(blob); a.src = a.dataset.url; recView("done"); }
    else { a.removeAttribute("src"); a.dataset.url = ""; recView("idle"); }
  }
  $("recStart").onclick = startRec;
  $("recStop").onclick = stopRec;
  $("recAgain").onclick = () => { setAudio(null); startRec(); };
  $("recDel").onclick = () => setAudio(null);

  // ---------- photo (live camera only) ----------
  let camStream, facing = "user";
  function photoErr(msg) { $("photoErr").textContent = msg || ""; }

  async function openCam() {
    photoErr("");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return $("photoFallback").click();
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false,
      });
    } catch (e) {
      if (e && e.name === "NotAllowedError") { photoErr(t("camDenied")); return; }
      return $("photoFallback").click();
    }
    const v = $("camVideo");
    v.srcObject = camStream;
    v.classList.toggle("mirror", facing === "user");
    show($("cam"), true);
    document.body.style.overflow = "hidden";
    try { await v.play(); } catch (e) {}
  }
  function closeCam() {
    if (camStream) camStream.getTracks().forEach((tr) => tr.stop());
    camStream = null;
    show($("cam"), false);
    document.body.style.overflow = "";
  }
  function toJpeg(source, w, h, mirror) {
    const max = 1600, k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const ctx = c.getContext("2d");
    if (mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.86));
  }
  $("camShoot").onclick = async () => {
    const v = $("camVideo");
    if (!v.videoWidth) return;
    const f = document.createElement("div"); f.className = "flash"; document.body.appendChild(f);
    setTimeout(() => f.remove(), 400);
    const blob = await toJpeg(v, v.videoWidth, v.videoHeight, facing === "user");
    closeCam();
    if (blob) setPhoto(blob);
  };
  $("camFlip").onclick = async () => { facing = facing === "user" ? "environment" : "user"; closeCam(); openCam(); };
  $("camCancel").onclick = closeCam;

  // Fallback for phones without in-page camera: opens the camera app; gallery photos are refused.
  $("photoFallback").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (Date.now() - file.lastModified > 15 * 60 * 1000) { photoErr(t("oldPhoto")); return; }
    try {
      const bmp = await createImageBitmap(file);
      setPhoto(await toJpeg(bmp, bmp.width, bmp.height, false));
    } catch (err) {
      const img = new Image();
      img.onload = async () => setPhoto(await toJpeg(img, img.naturalWidth, img.naturalHeight, false));
      img.src = URL.createObjectURL(file);
    }
  });

  function setPhoto(blob) {
    st.photo = blob ? { blob, type: "image/jpeg" } : null;
    st.uploads.photo = null;
    const img = $("photoImg");
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    if (blob) { img.dataset.url = URL.createObjectURL(blob); img.src = img.dataset.url; }
    else { img.removeAttribute("src"); img.dataset.url = ""; }
    show($("photoIdle"), !blob); show($("photoDone"), !!blob);
  }
  $("photoStart").onclick = openCam;
  $("photoAgain").onclick = openCam;
  $("photoDel").onclick = () => setPhoto(null);

  // ---------- send ----------
  function buildPayload() {
    return {
      piece: st.piece,
      guest_name: $("name").value.trim(),
      partner_name: $("partner").value.trim() || null,
      side: st.side,
      kind: st.kind,
      qIndex: st.qIndex,
      question: st.kind === "question" ? questionText() : null,
      message: $("message").value.trim() || null,
      lang: I18N.lang,
      audio: st.audio, photo: st.photo, uploads: st.uploads,
    };
  }

  function sendingUI(on, text, frac) {
    show($("sendState"), on);
    show($("s3actions"), !on);
    if (text != null) $("sendText").textContent = text;
    if (frac != null) $("sendBar").style.width = Math.round(frac * 100) + "%";
  }

  let autoRetry, retries = 0, current = null;
  async function doSend(p) {
    if (st.sending) return;
    st.sending = true; current = p;
    clearTimeout(autoRetry);
    show($("retryBtn"), false);
    $("s3err").textContent = "";
    sendingUI(true, t("sending"), 0.05);
    const parts = (p.audio && !p.uploads.audio ? 1 : 0) + (p.photo && !p.uploads.photo ? 1 : 0) + 1;
    let done = 0;
    const step = (f) => sendingUI(true, null, (done + f) / parts);
    try {
      if (p.audio && !p.uploads.audio) {
        sendingUI(true, t("upVoice"));
        const path = API.uuid() + "." + API.extFor(p.audio.type);
        p.uploads.audio = await API.upload(path, p.audio.blob, baseType(p.audio.type), step);
        done++; await API.idb.set("pending", p);
      }
      if (p.photo && !p.uploads.photo) {
        sendingUI(true, t("upPhoto"));
        const path = API.uuid() + ".jpg";
        p.uploads.photo = await API.upload(path, p.photo.blob, "image/jpeg", step);
        done++; await API.idb.set("pending", p);
      }
      sendingUI(true, t("saving"), (parts - 0.5) / parts);
      const r = await API.submit({
        piece: p.piece, guest_name: p.guest_name, partner_name: p.partner_name, side: p.side, kind: p.kind,
        question: p.question, message: p.message, audio_path: p.uploads.audio || null,
        photo_path: p.uploads.photo || null, lang: p.lang,
      });
      st.sending = false;
      if (r && r.ok) {
        retries = 0;
        await API.idb.del("pending");
        st.pendingPiece = null; show($("pendingCard"), false);
        sendingUI(false, "", 0);
        st.lastSent = { name: p.guest_name, partner: p.partner_name, piece: p.piece };
        if (filled != null) filled++;
        renderProgress(); renderDone(); go(4);
        loadProgress();
        return;
      }
      if (r && r.error === "taken") {
        sendingUI(false);
        st.uploads = p.uploads;   // keep anything already uploaded
        go(1);
        setPieceState("taken");
        shake($("piece"));
        return;
      }
      throw Object.assign(new Error((r && r.error) || "invalid"), { server: true, status: 400 });
    } catch (e) {
      st.sending = false;
      console.warn("send failed", e);
      const permanent = e.server && e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status);
      sendingUI(true, permanent ? `${t("failed")} (${e.message})` : t("failed"));
      show($("retryBtn"), true);
      if (!permanent && retries < 6) {
        retries++;
        autoRetry = setTimeout(() => doSend(current), Math.min(30000, 4000 * retries));
      }
    }
  }
  window.addEventListener("online", () => { if (current && !st.sending && $("retryBtn").hidden === false) doSend(current); });
  $("retryBtn").onclick = () => { retries = 0; doSend(current); };

  $("send").onclick = async () => {
    const p = buildPayload();
    if (!p.message && !p.audio && !p.photo) { $("s3err").textContent = t("needSomething"); shake($("send")); return; }
    if (rec && rec.state === "recording") stopRec();
    await API.idb.set("pending", p);
    retries = 0;
    doSend(p);
  };

  // ---------- done ----------
  function renderDone() {
    const s = st.lastSent; if (!s) return;
    const who = s.partner ? `${s.name} & ${s.partner}` : s.name;
    $("doneNum").textContent = I18N.num(s.piece);
    $("doneNum").classList.toggle("long", String(s.piece).length >= 3);
    $("doneTitle").textContent = t("doneTitle", { name: I18N.lang === "ar" && s.partner ? `${s.name} و${s.partner}` : who });
    const f = frameOf(s.piece);
    $("doneBody").textContent = f ? t("doneBodyFrame", { n: s.piece, f }) : t("doneBody", { n: s.piece });
  }
  $("again").onclick = () => {
    st.lastSent = null; st.piece = null; st.pieceState = null; st.uploads = {}; current = null;
    $("piece").value = ""; $("name").value = ""; $("message").value = "";
    $("partnerRemove").onclick();
    setAudio(null); setPhoto(null); setKind("question");
    st.side = null;
    document.querySelectorAll(".side-opt").forEach((b) => b.setAttribute("aria-pressed", "false"));
    st.deck = newDeck(-1);
    st.qIndex = st.deck.pop();
    renderDynamic(); go(1);
    loadSuggestion(); loadProgress();
  };

  // ---------- unsent message from before ----------
  async function checkPending() {
    const p = await API.idb.get("pending");
    if (!p || !p.piece) return;
    st.pendingPiece = p.piece;
    $("pendingText").textContent = t("pendingFound", { n: p.piece });
    show($("pendingCard"), true);
    $("pendingSend").onclick = () => {
      show($("pendingCard"), false);
      restore(p); go(3); doSend(buildPayload());
    };
    $("pendingDiscard").onclick = async () => { await API.idb.del("pending"); st.pendingPiece = null; show($("pendingCard"), false); };
  }
  function restore(p) {
    st.piece = p.piece; $("piece").value = p.piece; setPieceState(null);
    $("name").value = p.guest_name || "";
    if (p.partner_name) { $("partner").value = p.partner_name; show($("partnerWrap"), true); show($("partnerAdd"), false); }
    if (p.side) setSide(p.side);
    if (Number.isInteger(p.qIndex) && QUESTIONS[p.qIndex]) st.qIndex = p.qIndex;
    setKind(p.kind || "question");
    $("message").value = p.message || "";
    if (p.audio) setAudio(p.audio.blob, p.audio.type);
    if (p.photo) setPhoto(p.photo.blob);
    st.uploads = p.uploads || {};
  }

  // ---------- start ----------
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|musical_ly|TikTok|Twitter/i.test(navigator.userAgent)) show($("inAppNote"), true);
  show($("demoNote"), API.DEMO);
  I18N.applyLang();
  setKind("question");
  recView("idle");
  renderDynamic();
  go(1);
  loadProgress();
  loadSuggestion();
  checkPending();
})();
