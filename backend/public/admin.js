(() => {
  'use strict';

  const API_BASE = location.origin;

  /* ================= INIT DATA ================= */

  function getInitData() {
    const tg = window.Telegram?.WebApp;

    if (tg?.initData) return tg.initData;

    if (tg?.initDataUnsafe) {
      try {
        const p = new URLSearchParams();
        if (tg.initDataUnsafe.query_id) p.set('query_id', tg.initDataUnsafe.query_id);
        if (tg.initDataUnsafe.user) p.set('user', JSON.stringify(tg.initDataUnsafe.user));
        if (tg.initDataUnsafe.auth_date) p.set('auth_date', String(tg.initDataUnsafe.auth_date));
        if (tg.initDataUnsafe.hash) p.set('hash', tg.initDataUnsafe.hash);
        if (p.get('hash')) return p.toString();
      } catch {}
    }

    return '';
  }

  const TG_INIT = getInitData();


  /* ================= API WRAPPER ================= */

  async function api(path, { method = 'GET', body } = {}) {
    const opts = {
      method,
      headers: {
        'X-TG-INIT-DATA': TG_INIT,
        'Content-Type': 'application/json'
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


  /* ================= DOM HELPERS ================= */

  const $ = s => document.querySelector(s);
  const el = (tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  };


  /* ================= MODAL ELEMENTS ================= */

  const modal = $('#prodModal');
  const mName = $('#mProdName');
  const mUnit = $('#mProdUnit');
  const mCategory = $('#mProdCategory');
  const mSupplier = $('#mProdSupplier');
  const mActive = $('#mProdActive');
  const mSave = $('#mSave');
  const mCancel = $('#mCancel');

  let CURRENT_PRODUCT = null;
  let SUPPLIERS_CACHE = [];


  function openModal(product) {
    CURRENT_PRODUCT = product;

    mName.value = product.name;
    mUnit.value = product.unit;
    mCategory.value = product.category || 'Общее';
    mActive.checked = product.active === 1;

    // заполняем список поставщиков
    mSupplier.innerHTML = '';
    SUPPLIERS_CACHE.forEach(s => {
      const opt = el('option', { value: s.id }, s.name);
      if (s.id === product.supplier_id) opt.selected = true;
      mSupplier.appendChild(opt);
    });

    modal.classList.add('show');
  }

  function closeModal() {
    modal.classList.remove('show');
    CURRENT_PRODUCT = null;
  }

  mCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal();
  });


  /* ================= SUPPLIERS ================= */

  async function loadSuppliers() {
    const data = await api('/api/admin/suppliers');
    SUPPLIERS_CACHE = data.suppliers || [];

    const box = $('#suppliers');
    box.innerHTML = '';

    SUPPLIERS_CACHE.forEach(s => {
      box.appendChild(el('div', { className: 'card spaced' },
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
      ));
    });
  }

  async function editSupplier(s) {
    const name = prompt('Название поставщика:', s.name);
    if (!name) return;

    const note = prompt('Комментарий:', s.contact_note || '');
    const active = confirm('Поставщик активен?');

    try {
      await api(`/api/admin/suppliers/${s.id}`, {
        method: 'PATCH',
        body: {
          name,
          contact_note: note,
          active
        }
      });

      await loadSuppliers();
      await loadProducts();

    } catch (e) {
      alert(e.message);
    }
  }

  async function deleteSupplier(id, name) {
    if (!confirm(`Удалить поставщика "${name}"?`)) return;

    try {
      await api(`/api/admin/suppliers/${id}`, { method: 'DELETE' });
      await loadSuppliers();
      await loadProducts();
    } catch (e) {
      alert(e.message);
    }
  }


  /* ================= PRODUCTS ================= */

  async function loadProducts() {
    const data = await api('/api/admin/products');
    const box = $('#products');
    box.innerHTML = '';

    (data.products || []).forEach(p => {
      const row = el('div', { className: 'card spaced' },
        el('div', {}, `#${p.id} — ${p.name} (${p.unit})`),
        el('div', { className: 'muted' }, `Категория: ${p.category || 'Общее'}`),
        el('div', { className: 'muted' }, `Поставщик: ${p.supplier_name}`),

        el('button', {
          className: 'btn',
          type: 'button',
          onclick: () => openModal(p)
        }, 'Изменить'),

        el('button', {
          className: 'btn btn-secondary',
          type: 'button',
          onclick: () => deleteProduct(p.id, p.name)
        }, 'Удалить')
      );

      box.appendChild(row);
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


  /* ================= SAVE PRODUCT (PATCH) ================= */

  mSave.addEventListener('click', async () => {
    if (!CURRENT_PRODUCT) return;

    const body = {
      name: mName.value.trim(),
      unit: mUnit.value.trim(),
      category: mCategory.value.trim(),
      supplier_id: Number(mSupplier.value),
      active: mActive.checked
    };

    try {
      await api(`/api/admin/products/${CURRENT_PRODUCT.id}`, {
        method: 'PATCH',
        body
      });

      closeModal();
      await loadProducts();

    } catch (e) {
      alert(e.message);
    }
  });


  /* ================= REQUISITIONS ================= */

  async function loadRequisitions() {
    const data = await api('/api/admin/requisitions');
    const box = $('#requisitions');
    box.innerHTML = '';

    (data.requisitions || []).forEach(r => {
      const row = el('div', { className: 'card spaced' },
        el('div', {}, `#${r.id} — ${r.user_name || 'сотрудник'}`),
        el('div', { className: 'muted' }, r.created_at),

        el('button', {
          className: 'btn',
          type: 'button',
          onclick: () => openReq(r.id)
        }, 'Открыть')
      );

      box.appendChild(row);
    });
  }

  async function openReq(id) {
    try {
      const d = await api(`/api/admin/requisitions/${id}`);

      alert(
        (d.orders || [])
          .map(o =>
            `• ${o.supplier.name}\n` +
            o.items.map(i => `  - ${i.product_name}: ${i.qty_final} ${i.unit}`).join('\n')
          )
          .join('\n\n') || 'Пусто'
      );

    } catch (e) {
      alert(e.message);
    }
  }


  /* ================= ADD NEW SUPPLIER / PRODUCT ================= */

  $('#btnAddSup')?.addEventListener('click', async () => {
    const name = $('#supName').value.trim();
    const note = $('#supNote').value.trim();

    if (!name) return alert('Введите название');

    try {
      await api('/api/admin/suppliers', {
        method: 'POST',
        body: { name, contact_note: note }
      });

      $('#supName').value = '';
      $('#supNote').value = '';

      await loadSuppliers();

    } catch (e) { alert(e.message); }
  });


  $('#btnAddProd')?.addEventListener('click', async () => {
    const name = $('#prodName').value.trim();
    const unit = $('#prodUnit').value.trim();
    const category = $('#prodCategory').value.trim() || 'Общее';
    const supplier_id = Number($('#prodSupplierId').value);

    if (!name) return alert('Введите название');
    if (!unit) return alert('Введите ед. изм');
    if (!Number.isFinite(supplier_id)) return alert('Введите ID поставщика');

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

    } catch (e) { alert(e.message); }
  });


  /* ================= BOOT ================= */

  async function boot() {
    if (!TG_INIT) {
      $('#warning').style.display = 'block';
      $('#warning').innerHTML = 'Ошибка: initData не найден. Откройте Mini App через Telegram.';
      return;
    }

    await loadSuppliers();
    await loadProducts();
    await loadRequisitions();
  }

  try {
    window.Telegram?.WebApp?.ready();
  } catch {}

  boot();

})();
