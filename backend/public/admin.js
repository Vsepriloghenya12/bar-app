(() => {
  'use strict';

  const API_BASE = location.origin;

  /* ========== initData из Telegram WebApp ========== */

  function getInitData() {
    const tg = window.Telegram?.WebApp;

    if (tg?.initData && tg.initData.trim() !== '') return tg.initData;

    if (tg?.initDataUnsafe && typeof tg.initDataUnsafe === 'object') {
      try {
        const p = new URLSearchParams();
        const u = tg.initDataUnsafe;
        if (u.query_id) p.set('query_id', u.query_id);
        if (u.user) p.set('user', JSON.stringify(u.user));
        if (u.auth_date) p.set('auth_date', String(u.auth_date));
        if (u.hash) p.set('hash', u.hash);
        if (p.get('hash')) return p.toString();
      } catch {}
    }

    return '';
  }

  const TG_INIT = getInitData();

  /* ========== API helper ========== */

  async function api(path, { method = 'GET', body } = {}) {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-TG-INIT-DATA': TG_INIT || ''
      }
    };

    if (method !== 'GET' && method !== 'DELETE') {
      opts.body = JSON.stringify(body || {});
    }

    const res = await fetch(API_BASE + path, opts);
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.ok === false) {
      throw new Error(j.error || res.statusText);
    }
    return j;
  }

  /* ========== DOM helpers ========== */

  const $ = s => document.querySelector(s);
  const el = (tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'onclick') e.addEventListener('click', v);
      else e.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  };

  /* ========== Модальное редактирование товара ========== */

  const modal       = $('#prodModal');
  const mName       = $('#mProdName');
  const mUnit       = $('#mProdUnit');
  const mCategory   = $('#mProdCategory');
  const mSupplier   = $('#mProdSupplier');
  const mActive     = $('#mProdActive');
  const mSave       = $('#mSave');
  const mCancel     = $('#mCancel');

  let CURRENT_PRODUCT = null;
  let SUPPLIERS_CACHE = [];

  function closeModal() {
    modal.classList.remove('show');
    CURRENT_PRODUCT = null;
  }

  mCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  async function openProductModal(product) {
    CURRENT_PRODUCT = product;

    // гарантируем свежий список поставщиков
    if (!SUPPLIERS_CACHE.length) {
      await loadSuppliers(true);
    }

    // заполняем поля
    mName.value = product.name || '';
    mUnit.value = product.unit || '';
    mCategory.value = product.category || 'Общее';
    mActive.checked = product.active === 1;

    // заполняем select поставщиков
    mSupplier.innerHTML = '';
    SUPPLIERS_CACHE.forEach(s => {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.name;
      if (s.id === product.supplier_id) opt.selected = true;
      mSupplier.appendChild(opt);
    });

    if (!mSupplier.value && SUPPLIERS_CACHE[0]) {
      mSupplier.value = String(SUPPLIERS_CACHE[0].id);
    }

    modal.classList.add('show');
  }

  mSave.addEventListener('click', async () => {
    if (!CURRENT_PRODUCT) return;

    const name = mName.value.trim();
    const unit = mUnit.value.trim();
    const category = mCategory.value.trim() || 'Общее';
    const supplier_id = Number(mSupplier.value);
    const active = mActive.checked;

    if (name.length < 2) return alert('Название слишком короткое');
    if (!unit) return alert('Ед. изм. обязательна');
    if (!Number.isFinite(supplier_id)) return alert('Некорректный поставщик');

    try {
      await api(`/api/admin/products/${CURRENT_PRODUCT.id}`, {
        method: 'PATCH',
        body: { name, unit, category, supplier_id, active }
      });

      closeModal();
      await loadProducts();

    } catch (e) {
      alert(e.message);
    }
  });

  /* ========== Поставщики ========== */

  async function loadSuppliers(onlyCache = false) {
    const data = await api('/api/admin/suppliers');
    SUPPLIERS_CACHE = data.suppliers || [];

    if (onlyCache) return;

    const box = $('#suppliers');
    box.innerHTML = '';

    SUPPLIERS_CACHE.forEach(s => {
      box.appendChild(
        el('div', { className: 'card spaced' },
          el('div', {}, `#${s.id} — ${s.name}`),
          s.contact_note ? el('div', { className: 'muted' }, s.contact_note) : '',
          el('button', {
            className: 'btn',
            type: 'button',
            onclick: () => editSupplier(s)
          }, 'Изменить'),
          el('button', {
            className: 'btn btn-secondary',
            type: 'button',
            onclick: () => deleteSupplier(s.id, s.name)
          }, 'Удалить')
        )
      );
    });
  }

  async function editSupplier(s) {
    const name = prompt('Название поставщика:', s.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) return alert('Название слишком короткое');

    const note = prompt('Комментарий:', s.contact_note || '') ?? '';
    const active = confirm('Поставщик активен?');

    try {
      await api(`/api/admin/suppliers/${s.id}`, {
        method: 'PATCH',
        body: { name: trimmed, contact_note: note, active }
      });

      await loadSuppliers();
      await loadProducts();

    } catch (e) {
      alert(e.message);
    }
  }

  async function deleteSupplier(id, name) {
    if (!confirm(`Удалить поставщика "${name}" с товарами и историей?`)) return;
    try {
      await api(`/api/admin/suppliers/${id}`, { method: 'DELETE' });
      await loadSuppliers();
      await loadProducts();
    } catch (e) {
      alert(e.message);
    }
  }

  /* ========== Товары ========== */

  async function loadProducts() {
    const data = await api('/api/admin/products');
    const box = $('#products');
    box.innerHTML = '';

    (data.products || []).forEach(p => {
      box.appendChild(
        el('div', { className: 'card spaced' },
          el('div', {}, `#${p.id} — ${p.name} (${p.unit})`),
          el('div', { className: 'muted' }, `Категория: ${p.category || 'Общее'}`),
          el('div', { className: 'muted' }, `Поставщик: ${p.supplier_name}`),
          el('button', {
            className: 'btn',
            type: 'button',
            onclick: () => openProductModal(p)
          }, 'Изменить'),
          el('button', {
            className: 'btn btn-secondary',
            type: 'button',
            onclick: () => deleteProduct(p.id, p.name)
          }, 'Удалить')
        )
      );
    });
  }

  async function deleteProduct(id, name) {
    if (!confirm(`Удалить товар "${name}"?`)) return;
    try {
      await api(`/api/admin/products/${id}`, { method: 'DELETE' });
      await loadProducts();
    } catch (e) {
      alert(e.message);
    }
  }

  /* ========== Заявки ========== */

  async function loadRequisitions() {
    const data = await api('/api/admin/requisitions');
    const box = $('#requisitions');
    box.innerHTML = '';

    (data.requisitions || []).forEach(r => {
      box.appendChild(
        el('div', { className: 'card spaced' },
          el('div', {}, `#${r.id} — ${r.user_name || 'сотрудник'}`),
          el('div', { className: 'muted' }, r.created_at),
          el('button', {
            className: 'btn',
            type: 'button',
            onclick: () => openRequisition(r.id)
          }, 'Открыть')
        )
      );
    });
  }

  async function openRequisition(id) {
    try {
      const d = await api(`/api/admin/requisitions/${id}`);
      const text = (d.orders || [])
        .map(o =>
          `• ${o.supplier.name}\n` +
          o.items.map(i => `  - ${i.product_name}: ${i.qty_final} ${i.unit || ''}`).join('\n')
        )
        .join('\n\n') || 'Пусто';
      alert(text);
    } catch (e) {
      alert(e.message);
    }
  }

  /* ========== Добавление новых поставщиков/товаров ========== */

  $('#btnAddSup')?.addEventListener('click', async () => {
    const name = $('#supName').value.trim();
    const note = $('#supNote').value.trim();

    if (name.length < 2) return alert('Название слишком короткое');

    try {
      await api('/api/admin/suppliers', {
        method: 'POST',
        body: { name, contact_note: note }
      });

      $('#supName').value = '';
      $('#supNote').value = '';

      await loadSuppliers();
    } catch (e) {
      alert(e.message);
    }
  });

  $('#btnAddProd')?.addEventListener('click', async () => {
    const name = $('#prodName').value.trim();
    const unit = $('#prodUnit').value.trim();
    const category = $('#prodCategory').value.trim() || 'Общее';
    const supplier_id = Number($('#prodSupplierId').value);

    if (name.length < 2) return alert('Название слишком короткое');
    if (!unit) return alert('Ед. изм. обязательна');
    if (!Number.isFinite(supplier_id)) return alert('Некорректный supplier_id');

    try {
      await api('/api/admin/products', {
        method: 'POST',
        body: { name, unit, category, supplier_id }
      });

      $('#prodName').value = '';
      $('#prodUnit').value = '';
      $('#prodCategory').value = '';
      $('#prodSupplierId').value = '';

      await loadProducts();
    } catch (e) {
      alert(e.message);
    }
  });

  /* ========== Старт ========== */

  async function boot() {
    try { window.Telegram?.WebApp?.ready(); } catch {}

    if (!TG_INIT) {
      const w = $('#warning');
      w.style.display = 'block';
      w.textContent = 'initData не найден. Откройте админку через кнопку WebApp в боте.';
      return;
    }

    await loadSuppliers();
    await loadProducts();
    await loadRequisitions();
  }

  boot().catch(e => {
    const w = $('#warning');
    w.style.display = 'block';
    w.textContent = 'Ошибка инициализации: ' + (e.message || e);
  });

})();
