(() => {
  'use strict';

  const API = location.origin;

  const $ = sel => document.querySelector(sel);
  const el = (tag, attrs={}, ...children) => {
    const e = document.createElement(tag);
    for (let [k,v] of Object.entries(attrs)) {
      if (k === "onclick") e.addEventListener("click", v);
      else if (k === "html") e.innerHTML = v;
      else e.setAttribute(k, v);
    }
    children.forEach(c => e.appendChild(
      typeof c === "string" ? document.createTextNode(c) : c
    ));
    return e;
  };

  /* ================= INIT DATA ================ */

  function getInitData() {
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
  const INIT = getInitData();

  async function api(path, opts={}) {
    const o = {
      method: opts.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "X-TG-INIT-DATA": INIT
      }
    };
    if (opts.body) o.body = JSON.stringify(opts.body);
    const r = await fetch(API + path, o);
    const j = await r.json().catch(()=>({ ok:false, error:"Bad JSON" }));
    if (!r.ok || j.ok === false) throw new Error(j.error || "API error");
    return j;
  }


  /* ================= DATA HOLDERS ================ */

  let SUPPLIERS = [];
  let PRODUCTS = [];

  let currentProductId = null;


  /* ================= LOAD SUPPLIERS ================ */

  async function loadSuppliers() {
    const data = await api('/api/admin/suppliers');
    SUPPLIERS = data.suppliers;

    // Заполняем выпадающий список для создания товара
    const sel = $("#newProductSupplier");
    sel.innerHTML = `<option value="">Основной поставщик...</option>`;
    SUPPLIERS.forEach(s => {
      const opt = el("option", { value: s.id }, s.name);
      sel.appendChild(opt);
    });
  }


  /* ================= LOAD PRODUCTS ================ */

  async function loadProducts() {
    const data = await api('/api/admin/products');
    PRODUCTS = data.products;

    renderProductsList();
  }


  function renderProductsList() {
    const box = $("#productsList");
    box.innerHTML = "";

    PRODUCTS.forEach(p => {
      const card = el("div", { class:"card" },
        el("div", { class:"bold" }, `${p.name} (${p.unit})`),
        el("div", {}, `Категория: ${p.category}`),
        el("div", {}, `Основной поставщик: ${p.supplier_name}`),

        el("div", { class:"row", style:"margin-top:10px;" },
          el("button", {
            class:"btn btn-primary",
            onclick:()=> openEditModal(p.id)
          }, "Редактировать"),

          el("button", {
            class:"btn btn-secondary",
            style:"margin-left:8px;",
            onclick:()=> deleteProduct(p.id)
          }, "Удалить")
        )
      );
      box.appendChild(card);
    });
  }


  /* ================= ADD SUPPLIER ================ */

  $("#btnAddSupplier").addEventListener("click", async ()=>{
    const name = $("#newSupplierName").value.trim();
    const note = $("#newSupplierNote").value.trim();

    if (name.length < 2) {
      alert("Название слишком короткое");
      return;
    }

    try {
      await api('/api/admin/suppliers', {
        method:"POST",
        body:{ name, contact_note:note }
      });

      $("#newSupplierName").value = "";
      $("#newSupplierNote").value = "";

      await loadSuppliers();
      await loadProducts();
    } catch(e) {
      alert("Ошибка: " + e.message);
    }
  });


  /* ================= ADD PRODUCT ================ */

  $("#btnAddProduct").addEventListener("click", async ()=>{
    const name = $("#newProductName").value.trim();
    const unit = $("#newProductUnit").value.trim();
    const category = $("#newProductCategory").value.trim() || "Общее";
    const supplier_id = Number($("#newProductSupplier").value);

    if (name.length < 2) return alert("Слишком короткое название");
    if (!unit) return alert("Ед. изм. обязательна");
    if (!supplier_id) return alert("Выберите основного поставщика");

    try {
      await api('/api/admin/products', {
        method:"POST",
        body:{ name, unit, category, supplier_id }
      });

      $("#newProductName").value = "";
      $("#newProductUnit").value = "";
      $("#newProductCategory").value = "";
      $("#newProductSupplier").value = "";

      await loadProducts();
    } catch(e) {
      alert("Ошибка: " + e.message);
    }
  });


  /* ================= EDIT PRODUCT MODAL ================ */

  async function openEditModal(id) {
    currentProductId = id;

    const p = PRODUCTS.find(x => x.id === id);
    if (!p) return;

    $("#editName").value = p.name;
    $("#editUnit").value = p.unit;
    $("#editCategory").value = p.category;

    // Загружаем список всех поставщиков в выпадающий список
    const select = $("#editSupplier");
    select.innerHTML = "";
    SUPPLIERS.forEach(s => {
      const opt = el("option", { value:s.id }, s.name);
      if (s.id === p.supplier_id) opt.selected = true;
      select.appendChild(opt);
    });

    // Загружаем альтернативные поставщики
    await loadAlternatives(id);

    $("#editModal").classList.remove("hidden");
  }


  $("#btnCloseModal").addEventListener("click", ()=>{
    currentProductId = null;
    $("#editModal").classList.add("hidden");
  });


  /* ================= LOAD ALTERNATIVES ================ */

  async function loadAlternatives(productId) {
    const data = await api(`/api/admin/products/${productId}/alternatives`);
    const list = $("#altSuppliersList");
    list.innerHTML = "";

    if (data.alternatives.length === 0) {
      list.innerHTML = `<div class="muted">Нет альтернативных поставщиков</div>`;
      return;
    }

    data.alternatives.forEach(a => {
      const row = el("div", { class:"row", style:"margin:4px 0;" },
        el("div", {}, a.name),
        el("button", {
          class:"btn btn-secondary",
          style:"margin-left:auto;",
          onclick:()=> removeAlternative(productId, a.supplier_id)
        }, "Удалить")
      );

      list.appendChild(row);
    });
  }


  /* ================= ADD ALTERNATIVE ================= */

  $("#btnAddAltSupplier").addEventListener("click", async ()=>{
    if (!currentProductId) return;

    // Показываем список доступных поставщиков
    const ids = SUPPLIERS.map(s => `${s.id} — ${s.name}`).join("\n");
    const answer = prompt(
      "Введите ID альтернативного поставщика:\n\n" + ids,
      ""
    );
    if (!answer) return;

    const sid = Number(answer);
    if (!sid) return alert("Некорректный ID");

    try {
      await api(`/api/admin/products/${currentProductId}/alternatives`, {
        method:"POST",
        body:{ supplier_id: sid }
      });

      await loadAlternatives(currentProductId);
    } catch(e) {
      alert("Ошибка: " + e.message);
    }
  });


  /* ================= REMOVE ALTERNATIVE =============== */

  async function removeAlternative(productId, supplierId) {
    try {
      await api(`/api/admin/products/${productId}/alternatives/${supplierId}`, {
        method:"DELETE"
      });
      await loadAlternatives(productId);
    } catch(e) {
      alert("Ошибка: " + e.message);
    }
  }


  /* ================= SAVE PRODUCT ================= */

  $("#btnSaveProduct").addEventListener("click", async ()=>{
    if (!currentProductId) return;

    const name = $("#editName").value.trim();
    const unit = $("#editUnit").value.trim();
    const category = $("#editCategory").value.trim();
    const supplier_id = Number($("#editSupplier").value);

    try {
      await api(`/api/admin/products/${currentProductId}`, {
        method:"PATCH",
        body:{ name, unit, category, supplier_id }
      });

      $("#editModal").classList.add("hidden");

      await loadProducts();
    } catch(e) {
      alert("Ошибка: " + e.message);
    }
  });


  /* ================= DELETE PRODUCT ================= */

  async function deleteProduct(id) {
    if (!confirm("Удалить товар?")) return;

    try {
      await api(`/api/admin/products/${id}`, { method:"DELETE" });
      await loadProducts();
    } catch(e) {
      alert("Ошибка: " + e.message);
    }
  }


  /* ================= INIT ================= */

  (async ()=>{
    try { window.Telegram?.WebApp?.ready(); } catch {}
    await loadSuppliers();
    await loadProducts();
  })();

})();
