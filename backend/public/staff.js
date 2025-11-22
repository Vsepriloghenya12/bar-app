(() => {
  'use strict';

  /* =========================
     Helpers
  ========================== */
  const API_BASE = location.origin;

  function getInitData() {
    const tg = window.Telegram && window.Telegram.WebApp;

    // 1) Стандартный путь
    if (tg && typeof tg.initData === 'string' && tg.initData) {
      return tg.initData;
    }

    // 2) initDataUnsafe → собираем сами
    if (tg && tg.initDataUnsafe && typeof tg.initDataUnsafe === 'object') {
      try {
        const u = tg.initDataUnsafe;
        const p = new URLSearchParams();
        if (u.query_id) p.set('query_id', u.query_id);
        if (u.user) p.set('user', JSON.stringify(u.user));
        if (u.start_param) p.set('start_param', u.start_param);
        if (u.auth_date) p.set('auth_date', String(u.auth_date));
        if (u.hash) p.set('hash', u.hash);
        return p.toString();
      } catch (e) {
        console.warn('initDataUnsafe parse error', e);
      }
    }

    // 3) fallback – пусто (если PWA / DEV_ALLOW_UNSAFE)
    return '';
  }

  async function api(path, { method = 'GET', body = null } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const initData = getInitData();
    if (initData) headers['X-TG-INIT-DATA'] = initData;

    const res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) {
      throw new Error(json?.error || res.statusText || 'Ошибка запроса');
    }
    return json;
  }

  /* =========================
     DOM
  ========================== */
  const formBox   = document.getElementById('form');
  const recoBox   = document.getElementById('reco');
  const btnReco   = document.getElementById('btnReco');
  const btnSubmit = document.getElementById('btnSubmit');
  const resultBox = document.getElementById('result');

  // контейнер для активных заявок (добавляем под формой)
  const activeBox = document.createElement('div');
  activeBox.id = 'active-orders';
  activeBox.style.marginTop = '1rem';
  formBox.insertAdjacentElement('afterend', activeBox);

  // product_id → input element
  const inputByPid = new Map();

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);

    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'for') el.htmlFor = v;
      else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v);
      } else if (v !== undefined && v !== null) {
        el.setAttribute(k, v);
      }
    }

    for (const ch of children) {
      if (ch == null) continue;
      if (typeof ch === 'string') el.appendChild(document.createTextNode(ch));
      else el.appendChild(ch);
    }

    return el;
  }

  /* =========================
     Рендер товаров по категориям
  ========================== */
  function renderGroups(products) {
    const byCat = new Map();

    for (const p of products) {
      const cat = (p.category || 'Без категории').trim();
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(p);
    }

    // сортировка продуктов в категориях
    for (const arr of byCat.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }

    const categories = Array.from(byCat.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], 'ru')
    );

    const acc = h('div', { class: 'accordion' });
    inputByPid.clear();

    for (const [cat, items] of categories) {
      const details = h('details', { open: true });
      const summary = h('summary', {}, cat);
      const body = h('div', { class: 'group-body' });

      for (const p of items) {
        const nameText = p.unit ? `${p.name} (${p.unit})` : p.name;

        const qtyInput = h('input', {
          type: 'number',
          min: '0',
          step: 'any',
          inputmode: 'decimal',
          'aria-label': `Количество ${p.name}`,
        });

        inputByPid.set(p.id, qtyInput);

        const row = h(
          'div',
          { class: 'item-row' },
          h('div', { class: 'item-name', title: p.name }, nameText),
          h('div', { class: 'item-qty' }, qtyInput)
        );

        body.appendChild(row);
      }

      details.appendChild(summary);
      details.appendChild(body);
      acc.appendChild(details);
    }

    formBox.innerHTML = '';
    formBox.appendChild(acc);
  }

  /* =========================
     Активные заявки (pending заказы)
  ========================== */

  function renderActiveOrders(data) {
    activeBox.innerHTML = '';

    const orders = data?.orders || [];
    if (!orders.length) {
      return; // просто пусто, без карточки
    }

    const card = h('div', { class: 'card' },
      h('h3', {}, 'Активные заявки')
    );

    orders.forEach(group => {
      // group: { supplier_id, supplier_name, items: [...] }
      const det = h('details', { open: false });
      const sum = h(
        'summary',
        {},
        group.supplier_name || `Поставщик #${group.supplier_id}`
      );

      const list = h('div', { class: 'list' });
      (group.items || []).forEach(it => {
        list.appendChild(
          h(
            'div',
            {},
            `${it.name} — ${it.qty} ${it.unit || ''}`.trim()
          )
        );
      });

      const btnDone = h(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            if (!confirm('Отметить поставку как пришедшую?')) return;
            try {
              await api(`/api/my-orders/${group.supplier_id}/delivered`, {
                method: 'POST',
              });
              await loadActiveOrders();
            } catch (e) {
              alert('Ошибка: ' + e.message);
            }
          },
        },
        'Пришло'
      );

      det.appendChild(sum);
      det.appendChild(list);
      det.appendChild(btnDone);
      card.appendChild(det);
    });

    activeBox.appendChild(card);
  }

  async function loadActiveOrders() {
    try {
      const data = await api('/api/my-orders');
      renderActiveOrders(data);
    } catch (e) {
      console.warn('Ошибка загрузки активных заявок:', e.message);
    }
  }

  /* =========================
     Загрузка товаров
  ========================== */
  async function loadProducts() {
    formBox.innerHTML = '<div class="card">Загрузка товаров…</div>';
    const { products } = await api('/api/products');
    renderGroups(products || []);
  }

  /* =========================
     Заявка (отправка)
  ========================== */
  btnSubmit.addEventListener('click', async () => {
    try {
      btnSubmit.disabled = true;

      const items = [];
      inputByPid.forEach((inp, pid) => {
        const qty = Number(inp.value);
        if (qty > 0) {
          items.push({ product_id: pid, qty });
        }
      });

      if (!items.length) {
        alert('Введите количество хотя бы для одного товара');
        return;
      }

      const res = await api('/api/requisitions', {
        method: 'POST',
        body: { items },
      });

      resultBox.style.display = '';
      resultBox.innerHTML =
        `<b>Заявка создана.</b><br/>Номер: ${res.requisition_id ?? res.id ?? '(см. админ-панель)'}`;

      // очистка полей
      inputByPid.forEach(inp => {
        inp.value = '';
      });

      // обновить активные заявки
      await loadActiveOrders();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      alert('Ошибка: ' + e.message);
    } finally {
      btnSubmit.disabled = false;
    }
  });

  /* =========================
     Рекомендации (заглушка)
  ========================== */
  btnReco.addEventListener('click', () => {
    recoBox.innerHTML =
      '<div class="card">Рекомендации пока не настроены.</div>';
  });

  /* =========================
     Init
  ========================== */
  try {
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
  } catch (_) {}

  (async () => {
    try {
      await loadProducts();
      await loadActiveOrders();
    } catch (e) {
      formBox.innerHTML =
        '<div class="card error">Ошибка загрузки: ' + e.message + '</div>';
    }
  })();
})();
