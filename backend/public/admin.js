(() => {
  'use strict';

  const API = location.origin;

  const $ = s => document.querySelector(s);
  const el = (tag, attrs={}, ...children) => {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v])=>{
      if (k==='onclick') e.addEventListener('click',v)
      else if (k==='html') e.innerHTML=v;
      else e.setAttribute(k,v);
    });
    children.forEach(c=> e.appendChild(typeof c==='string'?document.createTextNode(c):c));
    return e;
  };

  function initData() {
    const tg = window.Telegram?.WebApp;
    if (tg?.initData) return tg.initData;
    if (tg?.initDataUnsafe) {
      const p = new URLSearchParams();
      const u = tg.initDataUnsafe;
      if (u.query_id) p.set('query_id',u.query_id);
      if (u.user) p.set('user', JSON.stringify(u.user));
      if (u.auth_date) p.set('auth_date',u.auth_date);
      if (u.hash) p.set('hash',u.hash);
      return p.toString();
    }
    return '';
  }

  const INIT = initData();

  async function api(path, opts={}) {
    const o = {
      method: opts.method||'GET',
      headers: {
        'Content-Type':'application/json',
        'X-TG-INIT-DATA': INIT
      }
    };
    if (opts.body) o.body = JSON.stringify(opts.body);

    const r = await fetch(API+path, o);
    const j = await r.json().catch(()=>({}));
    if (!r.ok || j.ok===false) throw new Error(j.error||'API error');
    return j;
  }

  /* LOAD SUPPLIERS LIST */
  async function loadSuppliers() {
    const data = await api('/api/admin/suppliers');
    const box = $('#suppliers');
    box.innerHTML = '';
    data.suppliers.forEach(s=>{
      box.appendChild(el('div', {class:'card'},
        el('div',{}, `#${s.id} — ${s.name}`),
        s.contact_note ? el('div',{class:'muted'}, s.contact_note) : ''
      ));
    });
  }

  /* LOAD PRODUCTS */
  async function loadProducts() {
    const data = await api('/api/admin/products');
    const box = $('#products');
    box.innerHTML = '';

    data.products.forEach(p=>{
      box.appendChild(el('div',{class:'card'},
        el('div',{}, `${p.name} (${p.unit})`),
        el('div',{class:'muted'}, `Категория: ${p.category}`),
        el('button',{class:'btn',onclick:()=>openModal(p)},'Редактировать')
      ));
    });
  }

  /* LOAD REQUISITIONS */
  async function loadRequisitions() {
    const data = await api('/api/admin/requisitions');
    const box = $('#requisitions');
    box.innerHTML = '';

    data.requisitions.forEach(r=>{
      box.appendChild(el('div',{class:'card'},
        el('div',{}, `#${r.id} — ${r.user_name||'сотрудник'}`),
        el('div',{class:'muted'}, r.created_at),
        el('button',{class:'btn',onclick:()=>openReq(r.id)},'Открыть')
      ));
    });
  }

  /* OPEN requisition */
  async function openReq(id) {
    const data = await api(`/api/admin/requisitions/${id}`);
    const box = $('#reqView');
    box.innerHTML = '';

    data.orders.forEach(o=>{
      const items = o.items.map(i=>{
        const alt = i.alternatives?.length
          ? `Альтернативы: ${i.alternatives.join(', ')}`
          : '';
        return `${i.product_name} — ${i.qty_requested} ${i.unit} ${alt}`;
      }).join('<br>');

      box.appendChild(el('div',{class:'card'},
        el('div',{}, `Поставщик: ${o.supplier_name}`),
        el('div',{html:items})
      ));
    });
  }

  /* =============== MODAL =============== */

  const modal = $('#prodModal');
  const mName = $('#mName');
  const mUnit = $('#mUnit');
  const mCat  = $('#mCat');
  let CURRENT_PRODUCT = null;

  const primaryBox = $('#primarySupplier');
  const altBox = $('#altSuppliers');

  function closeModal() {
    modal.classList.remove('show');
  }
  $('#mCancel').addEventListener('click', closeModal);

  async function openModal(p) {
    CURRENT_PRODUCT = p;

    mName.value = p.name;
    mUnit.value = p.unit;
    mCat.value  = p.category;

    await loadProductSuppliers(p.id);

    modal.classList.add('show');
  }

  async function loadProductSuppliers(pid) {
    const data = await api(`/api/admin/products/${pid}/suppliers`);
    const list = data.suppliers;

    primaryBox.innerHTML = 'Нет';
    altBox.innerHTML = '';

    if (list.length === 0) {
      primaryBox.innerHTML = 'Нет';
      return;
    }

    // первый = основной
    const primary = list[0];
    primaryBox.innerHTML = '';
    primaryBox.appendChild(el('div',{class:'supplier-row'},
      el('span',{}, primary.name),
      el('span',{class:'link-btn',onclick:()=>removeSupplier(pid, primary.supplier_id)},'удалить')
    ));

    // альтернативы
    for (let i=1;i<list.length;i++) {
      const s = list[i];
      altBox.appendChild(el('div',{class:'supplier-row'},
        el('span',{}, s.name),
        el('span',{class:'link-btn',onclick:()=>removeSupplier(pid,s.supplier_id)},'удалить')
      ));
    }
  }

  async function removeSupplier(pid, sid) {
    await api(`/api/admin/products/${pid}/suppliers/${sid}`, { method:'DELETE' });
    await loadProductSuppliers(pid);
  }

  $('#btnAddSupplier').addEventListener('click', async ()=>{
    // нужно загрузить всех поставщиков
    const all = await api('/api/admin/suppliers');
    const data = await api(`/api/admin/products/${CURRENT_PRODUCT.id}/suppliers`);
    const used = new Set(data.suppliers.map(x=>x.supplier_id));

    const choices = all.suppliers.filter(s=>!used.has(s.id));
    if (choices.length === 0) return alert('Все поставщики уже добавлены');

    // простой выбор через prompt
    const txt = choices.map(s=>`${s.id} — ${s.name}`).join('\n');
    const id = prompt(`Выберите ID поставщика:\n${txt}`);
    const sid = Number(id);
    if (!choices.find(c=>c.id===sid)) return;

    await api(`/api/admin/products/${CURRENT_PRODUCT.id}/suppliers`, {
      method:'POST', body:{ supplier_id:sid }
    });

    await loadProductSuppliers(CURRENT_PRODUCT.id);
  });

  $('#mSave').addEventListener('click', async ()=>{
    const name = mName.value.trim();
    const unit = mUnit.value.trim();
    const cat  = mCat.value.trim();

    await api(`/api/admin/products/${CURRENT_PRODUCT.id}`, {
      method:'PATCH',
      body:{ name, unit, category:cat }
    });

    closeModal();
    loadProducts();
  });

  /* =============== ADD NEW PRODUCT =============== */

  $('#btnAddProd').addEventListener('click', async ()=>{
    const name = $('#prodName').value.trim();
    const unit = $('#prodUnit').value.trim();
    const cat  = $('#prodCategory').value.trim() || 'Общее';

    if (!name) return alert('Название?');
    if (!unit) return alert('Ед. изм.?');

    await api('/api/admin/products', {
      method:'POST',
      body:{ name, unit, category:cat }
    });

    $('#prodName').value='';
    $('#prodUnit').value='';
    $('#prodCategory').value='';

    loadProducts();
  });

  /* =============== ADD SUPPLIER =============== */

  $('#btnAddSup').addEventListener('click', async ()=>{
    const name = $('#supName').value.trim();
    const note = $('#supNote').value.trim();

    if (!name) return alert('Название?');
    await api('/api/admin/suppliers',{
      method:'POST',
      body:{ name, contact_note:note }
    });

    $('#supName').value='';
    $('#supNote').value='';

    loadSuppliers();
  });

  /* INIT */
  (async function boot(){
    try { window.Telegram?.WebApp?.ready(); } catch {}
    await loadSuppliers();
    await loadProducts();
    await loadRequisitions();
  })();

})();
