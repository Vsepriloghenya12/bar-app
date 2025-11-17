(function () {
  'use strict';

  const API = location.origin;
  const diag = document.getElementById('diag');

  const log = msg => {
    if (!diag) return;
    diag.textContent += (diag.textContent ? "\n" : "") + msg;
  };

  /* =====================================================
     Получение initData из Telegram WebApp
  ===================================================== */
  function getInitData() {
    const tg = window.Telegram?.WebApp;

    // 1) Стандартный вариант
    if (tg?.initData && tg.initData.length > 0) {
      return tg.initData;
    }

    // 2) Через initDataUnsafe
    if (tg?.initDataUnsafe) {
      try {
        const u = tg.initDataUnsafe;
        const p = new URLSearchParams();

        if (u.query_id) p.set("query_id", u.query_id);
        if (u.user) p.set("user", JSON.stringify(u.user));
        if (u.auth_date) p.set("auth_date", String(u.auth_date));
        if (u.hash) p.set("hash", u.hash);

        const s = p.toString();
        if (s.includes("hash=")) return s;
      } catch (e) {}
    }

    // 3) Telegram Desktop в hash-фрагменте
    if (location.hash.includes("tgWebAppData=")) {
      try {
        const h = new URLSearchParams(location.hash.slice(1));
        const raw = h.get("tgWebAppData");
        if (raw) return decodeURIComponent(raw);
      } catch (e) {}
    }

    return "";
  }

  /* =====================================================
     Запрос /api/me
  ===================================================== */
  async function whoAmI(initData) {
    const r = await fetch(API + "/api/me", {
      method: "GET",
      headers: {
        "X-TG-INIT-DATA": initData
      }
    });

    const j = await r.json().catch(() => ({}));

    if (!r.ok || j.ok === false) {
      const err = j?.error || r.statusText || "Unknown error";
      throw new Error(err);
    }

    return j.user;
  }

  /* =====================================================
     ОСНОВНОЙ КОД
  ===================================================== */
  async function main() {
    window.Telegram?.WebApp?.ready?.();

    log("SDK: " + (!!window.Telegram?.WebApp));
    log("hash: " + (location.hash ? "есть" : "нет"));

    const init = getInitData();
    log("initData: " + (init ? "получено" : "пусто"));

    if (init) {
      try {
        const user = await whoAmI(init);
        location.replace(user.role === "admin" ? "/admin" : "/staff");
        return;
      } catch (e) {
        log("Ошибка с initData: " + e.message);
      }
    }

    // Попытка fallback — только если DEV_ALLOW_UNSAFE=true
    try {
      const user = await whoAmI("");
      location.replace(user.role === "admin" ? "/admin" : "/staff");
      return;
    } catch (e) {
      log("Без initData: " + e.message);
      log("Откройте через кнопку WebApp в боте или включите DEV_ALLOW_UNSAFE=true.");
    }
  }

  main();
})();
