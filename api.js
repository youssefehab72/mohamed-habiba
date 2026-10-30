// Talks to Supabase (or to a local demo store when no Supabase details are set).
(function () {
  const CFG = window.PUZZLE_CONFIG || {};
  const URL_ = (CFG.SUPABASE_URL || "").replace(/\/+$/, "");
  const KEY = CFG.SUPABASE_KEY || "";
  const DEMO = !URL_ || !KEY;
  const BUCKET = "memories";

  // ---------- tiny IndexedDB helper (pending messages + demo media) ----------
  const idb = (() => {
    let dbp;
    function db() {
      if (!dbp) dbp = new Promise((res, rej) => {
        const r = indexedDB.open("puzzle-memories", 1);
        r.onupgradeneeded = () => { r.result.createObjectStore("kv"); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return dbp;
    }
    async function op(mode, fn) {
      const d = await db();
      return new Promise((res, rej) => {
        const tx = d.transaction("kv", mode);
        const req = fn(tx.objectStore("kv"));
        tx.oncomplete = () => res(req && req.result);
        tx.onerror = () => rej(tx.error);
      });
    }
    return {
      get: (k) => op("readonly", (s) => s.get(k)).catch(() => undefined),
      set: (k, v) => op("readwrite", (s) => s.put(v, k)).catch(() => undefined),
      del: (k) => op("readwrite", (s) => s.delete(k)).catch(() => undefined),
    };
  })();

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function extFor(type) {
    const t = (type || "").split(";")[0].trim();
    return ({ "audio/webm": "webm", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/ogg": "ogg",
      "audio/mpeg": "mp3", "audio/wav": "wav", "image/jpeg": "jpg", "image/png": "png" })[t] || (t.startsWith("image/") ? "jpg" : "webm");
  }

  // ---------- Supabase over plain HTTPS ----------
  function headers(extra) {
    const h = Object.assign({ apikey: KEY }, extra || {});
    if (!KEY.startsWith("sb_")) h.Authorization = "Bearer " + KEY; // legacy anon key is a JWT
    return h;
  }

  async function rpc(name, args, timeoutMs = 20000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
        method: "POST", signal: ctl.signal,
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify(args || {}),
      });
      const text = await r.text();
      let body; try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
      if (!r.ok) {
        const err = new Error((body && body.message) || `HTTP ${r.status}`);
        err.status = r.status; err.code = body && body.code; err.server = true;
        throw err;
      }
      return body;
    } finally { clearTimeout(timer); }
  }

  function uploadXHR(path, blob, contentType, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("POST", `${URL_}/storage/v1/object/${BUCKET}/${path}`);
      const h = headers({ "Content-Type": contentType, "x-upsert": "false", "cache-control": "max-age=31536000" });
      for (const k in h) x.setRequestHeader(k, h[k]);
      x.timeout = 120000;
      x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) return resolve(path);
        const err = new Error(`Upload failed (${x.status}): ${x.responseText.slice(0, 200)}`);
        err.status = x.status; err.server = true;
        // 409 = a file with this name already exists, which means an earlier try got through.
        if (x.status === 409 || /already exists|Duplicate/i.test(x.responseText)) return resolve(path);
        reject(err);
      };
      x.onerror = () => reject(new Error("network"));
      x.ontimeout = () => reject(new Error("timeout"));
      x.send(blob);
    });
  }

  // ---------- demo store (localStorage + IndexedDB) ----------
  const DEMO_KEY = "puzzle-demo-entries";
  const demoAll = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || "[]"); } catch (e) { return []; } };
  const demoSave = (rows) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(rows)); } catch (e) {} };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const DEMO_PASS = "demo";

  const real = {
    pieceTaken: (n) => rpc("piece_taken", { p_piece: n }),
    filledCount: () => rpc("filled_count"),
    suggestPiece: (total) => rpc("suggest_piece", { p_total: total }),
    upload: (path, blob, type, onProgress) => uploadXHR(path, blob, type, onProgress),
    submit: (e) => rpc("submit_memory", {
      p_piece: e.piece, p_guest_name: e.guest_name, p_partner_name: e.partner_name || null, p_side: e.side || null,
      p_kind: e.kind, p_question: e.question || null, p_message: e.message || null,
      p_audio_path: e.audio_path || null, p_photo_path: e.photo_path || null, p_lang: e.lang,
    }, 30000),
    coupleOk: (p) => rpc("couple_ok", { p_pass: p }),
    coupleList: (p) => rpc("couple_list", { p_pass: p }),
    coupleMove: (p, from, to) => rpc("couple_move", { p_pass: p, p_from: from, p_to: to }),
    coupleRemove: (p, n) => rpc("couple_remove", { p_pass: p, p_piece: n }),
    mediaUrl: async (path) => `${URL_}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(path)}`,
  };

  const demo = {
    pieceTaken: async (n) => { await wait(150); return demoAll().some((r) => r.piece === n); },
    filledCount: async () => demoAll().length,
    suggestPiece: async (total) => {
      const taken = new Set(demoAll().map((r) => r.piece)); const free = [];
      for (let i = 1; i <= total && free.length < 5; i++) if (!taken.has(i)) free.push(i);
      return free.length ? free[Math.floor(Math.random() * free.length)] : null;
    },
    upload: async (path, blob, type, onProgress) => {
      for (let i = 1; i <= 5; i++) { await wait(120); onProgress && onProgress(i / 5); }
      await idb.set("media:" + path, blob);
      return path;
    },
    submit: async (e) => {
      await wait(300);
      const rows = demoAll();
      if (rows.some((r) => r.piece === e.piece)) return { ok: false, error: "taken" };
      rows.push(Object.assign({}, e, { created_at: new Date().toISOString() }));
      demoSave(rows);
      return { ok: true };
    },
    coupleOk: async (p) => { await wait(200); return p === DEMO_PASS; },
    coupleList: async (p) => {
      if (p !== DEMO_PASS) { const err = new Error("wrong passcode"); err.code = "28P01"; err.server = true; throw err; }
      return demoAll().sort((a, b) => a.piece - b.piece);
    },
    coupleMove: async (p, from, to) => {
      const rows = demoAll();
      if (rows.some((r) => r.piece === to)) return { ok: false, error: "taken" };
      const r = rows.find((r) => r.piece === from); if (!r) return { ok: false, error: "missing" };
      r.piece = to; demoSave(rows); return { ok: true };
    },
    coupleRemove: async (p, n) => { demoSave(demoAll().filter((r) => r.piece !== n)); return { ok: true }; },
    mediaUrl: async (path) => { const b = await idb.get("media:" + path); return b ? URL.createObjectURL(b) : ""; },
  };

  window.API = Object.assign({ DEMO, idb, uuid, extFor, DEMO_PASS }, DEMO ? demo : real);
})();
