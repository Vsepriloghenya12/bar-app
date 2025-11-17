(() => {
  'use strict';
  const API_BASE = location.origin;

  function getInitData() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg?.initData) return tg.initData;
    if (tg?.initDataUnsafe) {
      try {
        const p = new URLSearchParams();
        const u = tg.initDataUnsafe;
        if (u.query_id) p.set('query_id', u.query_id);
        if (u.user) p.set('user', JSON.stringify(u.user));
        if (u.start_param) p.set('start_param', u.start_param);
        if (u.auth_date) p.set('auth_date', String(u.auth_date));
        if (u.hash) p.set('hash', u.hash);
        if (p.get('hash')) return p.toString();
      } catch {}
    }
    if (location.hash.includes('tgWebAppData=')) {
      try {
        const h = new URLSearchParams(location.hash.slice(1));
        const raw = h.get('tgWebAppData');
        if (raw) return decodeURIComponent(raw);
      } catch {}
    }
    return '';
  }
  const TG_INIT = getInitData();

  async function api(path, { method='GET', body } = {}) {
    const url = new URL(API_BASE + path);
    const m = method.toUpperCase();

    if (m === 'POST' || m === 'PATCH') {
      const res = await fetch(url, {
        method: m,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(body||{}), initData: TG_INIT })
      });
      const j = await res.json().catch(()=>({}));
      if (!res.ok || j?.ok === false) throw new Error(j?.error || res.statusText);
      return j;
    }

    if (TG_INIT) url.searchParams.set('initData', encodeURIComponent(TG_INIT));
    const res = await fetch(url, { method: m, headers: { 'Content-Type': 'application/json' } });
    const j = await res.json().catch(()=>({}));
    if (!res.ok || j?.ok === false) throw new Error(j?.error || res.statusText);
    return j;
  }

  const $ = s => document.querySelector(s);
  function el(t, a={}, ...c){
    const e=document.createElement(t);
    for(const[k,v] of Object.entries(a)){
      if(k==='className')e.className=v;
      else if(k==='html')e.innerHTML=v;
      else e.setAttribute(k,v);
    }
    for(const x of c){
      e.appendChild(typeof x==='string'?document.createTextNode(x):x);
    }
    return e;
  }
  const btn=(t,on)=>{
    const b=el('button',{className:'btn',type:'button'},t);
    if(on) b.addEventListener('click',on);
    return b;
  };

  const boxWarn = document.getElementById('warning');
  const boxSup  = document.getElementById('suppliers');
  const boxProd = document.getElementById('products');
  const boxReq  = document.getElementById('requisitions');

  /* ================= Suppliers ================== */

  async function loadSuppliers() {
    const data = await api('/api/admin/suppliers');
    boxSup.innerHTML = '';
    (data.suppliers||[]).forEach(s=>{
      const row = el('div',{className:'card spaced'},
        el('div',{}, `#${s.id} — ${s.name}`),
        s.contact_note ? el('div',{className:'muted'}, s.contact_note) : '',
        btn('Изменить', ()=> editSupplier(s)),
        btn('Удалить', async ()=>{
          if (!confirm(`Удалить поставщика "${s.name}"?`)) return;
          try{
            await api(`/api/admin/suppliers/${s.id}`, {method:'DELETE'});
            await loadSuppliers();
            await loadProducts();
          } catch(e){ alert(e.message); }
        })
      );
      boxSup.appendChild(row);
    });
  }

  async function editSupplier(s) {
    const name = prompt('Название поставщика:', s.name);
    if (!name) return;

    const contact_note = prompt('Комментарий:', s.contact_note || '');
    const active = confirm('Поставщик активен? (OK = Да)');

    try {
      await api(`/api/admin/suppliers/${s.id}`, {
        method: 'PATCH',
        body: { name, contact_note, active }
      });
      await loadSuppliers();
    } catch(e) {
      alert(e.message);
    }
  }

  /* ================= Products ================== */

  async function loadProducts() {
    const data = await api('/api/admin/products');
    boxProd.innerHTML = '';
    (data.products||[]).forEach(p=>{
      const row = el('div',{className:'card spaced'},
        el('div',{}, `#${p.id} — ${p.name} (${p.unit}), пост.: ${p.supplier_name}`),
        p.category ? el('div',{className:'muted'}, `Категория: ${p.category}`) : '',
        btn('Изменить', ()=> editProduct(p)),
        btn('Удалить', async ()=>{
          if (!confirm(`Удалить товар "${p.name}"?`)) return;
          try{
            await api(`/api/admin/products/${p.id}`, {method:'DELETE'});
            await loadProducts();
          } catch(e){ alert(e.message); }
        })
      );
      boxProd.appendChild(row);
    });
  }

  async function editProduct(p) {
    const name = prompt('Название товара:', p.name);
    if (!name) return;

    const unit = prompt('Ед. изм.:', p.unit);
    if (!unit) return;

    const category = prompt('Категория:', p.category || 'Общее');

    const supplier_id = Number(prompt('ID поставщика:', p.supplier_id));
    if (!Number.isFinite(supplier_id)) {
      alert('Неверный ID поставщика');
      return;
    }

    const active = confirm('Товар активен? (OK = Да)');

    try {
      await api(`/api/admin/products/${p.id}`, {
        method: 'PATCH',
        body: { name, unit, category, supplier_id, active }
      });
      await loadProducts();
    } catch (e) {
      alert(e.message);
    }
  }

  /* ================= Requisitions ================== */

  async function loadRequisitions() {
    const data = await api('/api/admin/requisitions');
    boxReq.innerHTML = '';
    (data.requisitions||[]).forEach(r=>{
      const row = el('div',{className:'card spaced'},
        el('div',{}, `#${r.id} — ${r.user_name || 'сотрудник'} — ${r.created_at || ''}`),
        btn('Открыть', async ()=>{
          try{
            const det = await api(`/api/admin/requisitions/${r.id}`);
            const orders = det.orders || [];
            alert(
              orders.length
                ? orders.map(o => `• ${o.supplier.name}\n` + o.items.map(i => `  - ${i.product_name}: ${i.qty_final} ${i.unit||''}`).join('\n')).join('\n\n')
                : 'Пусто'
            );
          }catch(e){ alert(e.message); }
        })
      );
      boxReq.appendChild(row);
    });
  }

  /* ================= Boot ================== */

  async function boot(){
    if (!TG_INIT) {
      boxWarn.style.display='block';
      boxWarn.innerHTML = `<b>Ошибка: Missing initData</b><br/>Откройте админку через WebApp.`;
      return;
    }

    $('#btnAddSup')?.addEventListener('click', async ()=>{
      const name = $('#supName').value.trim();
      const note = $('#supNote').value.trim();
      if (name.length < 2) return alert('Название слишком короткое');
      try{
        await api('/api/admin/suppliers',{method:'POST',body:{name,contact_note:note}});
        $('#supName').value=''; $('#supNote').value='';
        await loadSuppliers();
      }catch(e){ alert(e.message); }
    });

    $('#btnAddProd')?.addEventListener('click', async ()=>{
      const name = $('#prodName').value.trim();
      const unit = $('#prodUnit').value.trim();
      const category = $('#prodCategory').value.trim() || 'Общее';
      const supplier_id = Number($('#prodSupplierId').value);
      if (name.length < 2) return alert('Название слишком короткое');
      if (!unit) return alert('Ед. изм. обязательна');
      if (!Number.isFinite(supplier_id)) return alert('Неверный ID поставщика');
      try{
        await api('/api/admin/products',{method:'POST',body:{name,unit,category,supplier_id}});
        $('#prodName').value=''; $('#prodUnit').value='';
        $('#prodCategory').value=''; $('#prodSupplierId').value='';
        await loadProducts();
      }catch(e){ alert(e.message); }
    });

    await Promise.all([loadSuppliers(), loadProducts(), loadRequisitions()]);
  }

  try{ window.Telegram?.WebApp?.ready?.(); }catch{}
  boot().catch(e=>alert('Ошибка загрузки: '+e.message));

})();
