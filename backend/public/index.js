(function(){
  'use strict';

  const API = location.origin;
  const diag = document.getElementById('diag');

  function log(s){
    if (diag) diag.textContent += (diag.textContent ? '\n' : '') + s;
  }

  function getInitData(){
    const tg = window.Telegram?.WebApp;

    if (tg?.initData) return tg.initData;

    if (tg?.initDataUnsafe) {
      try {
        const p = new URLSearchParams();
        const u = tg.initDataUnsafe;
        if (u.query_id) p.set("query_id", u.query_id);
        if (u.user) p.set("user", JSON.stringify(u.user));
        if (u.auth_date) p.set("auth_date", String(u.auth_date));
        if (u.hash) p.set("hash", u.hash);
        return p.toString();
      } catch {}
    }
    return "";
  }

  async function whoAmI(init){
    const r = await fetch(API + '/api/me', {
      method: 'GET',
      headers: {
        'X-TG-INIT-DATA': init
      }
    });
    const j = await r.json().catch(()=>({}));
    if (!r.ok || j?.ok === false) throw new Error(j?.error || r.statusText);
    return j.user;
  }

  async function main(){
    window.Telegram?.WebApp?.ready?.();

    log("SDK: true");
    log("hash: " + (location.hash ? "есть" : "нет"));

    const init = getInitData();
    log("initData: " + (init ? "получено" : "пусто"));

    if (init){
      try{
        const u = await whoAmI(init);  // <— БЕЗ ENCODE
        location.replace(u.role === 'admin' ? '/admin' : '/staff');
        return;
      } catch(e){
        log("Ошибка с initData: " + e.message);
      }
    }

    // режим DEV_ALLOW_UNSAFE
    try{
      const u = await whoAmI("");
      location.replace(u.role === 'admin' ? '/admin' : '/staff');
    } catch(e){
      log("Без initData: " + e.message);
      log("Откройте через кнопку WebApp в боте или включите DEV_ALLOW_UNSAFE=true.");
    }
  }

  main();
})();
