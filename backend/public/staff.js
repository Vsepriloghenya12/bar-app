(() => {
  'use strict';

  const API = location.origin;

  const $ = s => document.querySelector(s);
  const el = (tag, attrs={}, ...children) => {
    const e = document.createElement(tag);
    for (let [k,v] of Object.entries(attrs)) {
      if (k === "onclick") e.addEventListener("click", v);
      else if (k === "html") e.innerHTML = v;
      else e.setAttribute(k, v);
    }
    children.forEach(c => e.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return e;
  };

  /* ======================================================
      INIT DATA
  ====================================================== */
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

  /* ======================================================
      LOAD PRODUCTS
  ====================================================== */

  let PRODUCTS = [];
  let DISABLED_PRODUCTS = new Set();

  async function loadProducts() {
    const data = await api('/api/products');
    PRODUCTS = data.products;

    renderProducts();
  }

  function renderProducts() {
    const box = $("#productList");
    box.innerHTML = "";

    PRODUCTS.forEach(p => {
      const disabled = DISABLED_PRODUCTS.has(p.id);

      const row = el("div", { class:"card" },
        el("div", {}, `${p.name} (${p.unit})`),
        el("input", {
          type:"number",
          min:"0",
          placeholder:"Кол-во",
          id:`qty_${p.id}`,
          disabled: disabled ? "true" : null,
          class: disabled ? "disabled-input" : ""
        })
      );

      if (disabled) {
        row.classList.add("disabled-card");
      }

      box.appendChild(row);
    });
  }

  /* ======================================================
      SEND REQUISITION
  ====================================================== */

  $("#btnSend").addEventListener("click", async () => {
    try {
      const items = [];

      PRODUCTS.forEach(p => {
        const el = $(`#qty_${p.id}`);
        if (!el) return;
        const qty = Number(el.value);
        if (qty > 0) {
          items.push({ product_id: p.id, qty });
        }
      });

      if (items.length === 0) {
        alert("Вы не указали товары.");
        return;
      }

      $("#btnSend").disabled = true;

      await api("/api/requisitions", {
        method:"POST",
        body:{ items }
      });

      alert("Заявка отправлена!");

      // очистить поля
      PRODUCTS.forEach(p => {
        const el = $(`#qty_${p.id}`);
        if (el) el.value = "";
      });

      await loadActiveOrders();
      await loadProducts();
    } catch(e) {
      alert("Ошибка: " + e.message);
    } finally {
      $("#btnSend").disabled = false;
    }
  });

  /* ======================================================
      ACTIVE ORDERS
  ====================================================== */

  async function loadActiveOrders() {
    const data = await api("/api/my-orders");
    const orders = data.orders;

    // Собираем список product_id, которые находятся в активных заявках
    DISABLED_PRODUCTS = new Set();
    orders.forEach(o => {
      o.items.forEach(it => DISABLED_PRODUCTS.add(it.product_id));
    });

    renderProducts();
    renderActiveOrders(orders);
  }

  function renderActiveOrders(orders) {
    const box = $("#activeOrders");
    box.innerHTML = "";

    if (orders.length === 0) {
      box.innerHTML = "<div class='muted'>Нет активных заявок</div>";
      return;
    }

    orders.forEach(o => {
      const itemsHtml = o.items
        .map(it => `• ${it.name} — ${it.qty} ${it.unit}`)
        .join("<br>");

      const card = el("div", { class:"card" },
        el("div", { class:"bold" }, `📦 ${o.supplier_name}`),
        el("div", { html: itemsHtml, style:"margin:8px 0;" }),
        el("button", {
          class:"btn",
          onclick:()=> markDelivered(o.supplier_id)
        }, "Получено")
      );

      box.appendChild(card);
    });
  }

  async function markDelivered(supplierId) {
    try {
      await api(`/api/my-orders/${supplierId}/delivered`, { method:"POST" });

      await loadActiveOrders();
      await loadProducts();
    } catch(e) {
      alert("Ошибка: " + e.message);
    }
  }

  /* ======================================================
      INIT
  ====================================================== */

  (async () => {
    try { window.Telegram?.WebApp?.ready(); } catch {}
    await loadActiveOrders();
    await loadProducts();
  })();

})();
