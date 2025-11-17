(function(){
  const diag = document.getElementById("diag");
  const API = location.origin;

  function log(t){
    diag.textContent += t + "\n";
  }

  function getInitData(){
    const tg = window.Telegram?.WebApp;
    if (tg?.initData) return tg.initData;

    if (tg?.initDataUnsafe){
      try{
        const p = new URLSearchParams();
        if (tg.initDataUnsafe.query_id) p.set("query_id", tg.initDataUnsafe.query_id);
        if (tg.initDataUnsafe.user) p.set("user", JSON.stringify(tg.initDataUnsafe.user));
        if (tg.initDataUnsafe.auth_date) p.set("auth_date", tg.initDataUnsafe.auth_date);
        if (tg.initDataUnsafe.hash) p.set("hash", tg.initDataUnsafe.hash);
        return p.toString();
      }catch{}
    }

    return "";
  }

  async function loadUser(init){
    const url = new URL(API + "/api/me");
    if (init) url.searchParams.set("initData", init);

    const r = await fetch(url);
    const j = await r.json().catch(()=>null);

    if (!r.ok || !j?.ok){
      throw new Error(j?.error || "Auth error");
    }
    return j.user;
  }

  async function start(){
    log("SDK: " + !!window.Telegram?.WebApp);

    const init = getInitData();
    log("initData: " + (init ? "есть" : "пусто"));

    try{
      const u = await loadUser(init);
      log("role = " + u.role);
      location.replace(u.role === "admin" ? "/admin" : "/staff");
    }catch(e){
      log("Ошибка: " + e.message);

      try{
        const u = await loadUser("");
        location.replace(u.role === "admin" ? "/admin" : "/staff");
      }catch(e2){
        log("Фатальная ошибка авторизации");
      }
    }
  }

  start();
})();
