(function () {
  'use strict';

  const API_BASE = location.origin;
  const diag = document.getElementById('diag');

  function log(s) {
    if (!diag) return;
    diag.textContent += (diag.textContent ? '\n' : '') + s;
  }

  /* ====================== Получение initData ====================== */
  function getInitData() {
    const tg = window.Telegram && window.Telegram.WebApp;

    // 1) Нормальный initData (МОЖЕТ быть пустым строкой)
    if (tg && typeof tg.initData === 'string' && tg.initData.trim() !== '') {
      return tg.initData;
    }

    // 2) initDataUnsafe
    if (tg && tg.initDataUnsafe && typeof tg.initDataUnsafe === 'object') {
      try {
        const p = new URLSearchParams();

        if (tg.initDataUnsafe.query_id) p.set('query_id', tg.initDataUnsafe.query_id);
        if (tg.initDataUnsafe.user) p.set('user', JSON.stringify(tg.initDataUnsafe.user));
        if (tg.initDataUnsafe.start_param) p.set('start_param', tg.initDataUnsafe.start_param);
        if (tg.initDataUnsafe.auth_date) p.set('auth_date', String(tg.initDataUnsafe.auth_date));
        if (tg.initDataUnsafe.hash) p.set('hash', tg.initDataUnsafe.hash);

        if (p.get('hash')) return p.toString();
      } catch (e) {}
    }

    // 3) tgWebAppData в хеше URL (Telegram Desktop)
    if (location.hash.includes('tgWebAppData=')) {
      try {
        const h = new URLSearchParams(location.hash.slice(1));
        const raw = h.get('tgWebAppData');
        if (raw) return decodeURIComponent(raw);
      } catch (e) {}
    }

    return '';
  }

  /* ====================== API вызов /api/me ====================== */
  async function whoAmI(initData) {
    const res = await fetch(API_BASE + '/api/me', {
      method: 'GET',
      headers: {
        'X-TG-INIT-DATA': initData,
        'Content-Type': 'application/json'
      }
    });

    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.ok === false) throw new Error(j.error || res.statusText);
    return j.user;
  }

  /* =========================== MAIN ============================== */

  async function main() {
    try {
      window.Telegram?.WebApp?.ready?.();
    } catch {}

    log('SDK: ' + (!!window.Telegram?.WebApp));
    log('hash: ' + (location.hash ? 'есть' : 'пусто'));

    const init = getInitData();
    log('initData: ' + (init ? 'получено' : 'пусто'));

    /* ---- ПЕРВАЯ ПОПЫТКА: c initData ---- */
    if (init) {
      try {
        const u = await whoAmI(init);
        location.replace(u?.role === 'admin' ? '/admin' : '/staff');
        return;
      } catch (e) {
        log('Ошибка с initData: ' + (e?.message || e));
      }
    }

    /* ---- ВТОРАЯ ПОПЫТКА: без initData (DEV_ALLOW_UNSAFE=true) ---- */
    try {
      const u = await whoAmI('');
      location.replace(u?.role === 'admin' ? '/admin' : '/staff');
      return;
    } catch (e) {
      log('Без initData: ' + (e?.message || e));
      log('Откройте через кнопку WebApp в боте или включите DEV_ALLOW_UNSAFE=true.');
    }
  }

  main().catch(e => log('Фатальная ошибка: ' + (e?.message || e)));

})();
