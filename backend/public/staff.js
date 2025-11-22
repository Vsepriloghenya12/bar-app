// ==============================
// staff.js — восстановленная версия (вариант C)
// ==============================

(function () {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    try {
      tg.ready();
      tg.expand();
    } catch (_) {}
  }

  // -------------------------------------------------------
  // INIT DATA
  // -------------------------------------------------------
  function getInit() {
    const raw = tg?.initData;
    return raw || "";
  }

  async function api(path, options = {}) {
    const headers = options.headers || {};
    headers["X-TG-INIT-DATA"] = getInit();
    headers["Content-Type"] = "application/json";

    const res = await fetch(path, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) throw new Error(json?.error || "Error");

    return json;
  }

  // -------------------------------------------------------------------
  // GLOBAL STATE
  // -------------------------------------------------------------------
  let allProducts = [];
  let grouped = {};
  let collapsed = {}; // состояние категорий
  let searchTerm = "";

  // -------------------------------------------------------------------
  // DOM ELEMENTS
  // -------------------------------------------------------------------
  const form = document.querySelector("#form");
  const submitBtn = document.querySelector("#submit");
  const totalCounter = document.querySelector("#total-counter");
  const searchInput = document.querySelector("#search");
  const activeOrdersBox = document.querySelector("#active-orders");

  // -------------------------------------------------------------------
  // LOAD PRODUCTS
  // -------------------------------------------------------------------
  async function loadProducts() {
    const resp = await api("/api/products");
    allProducts = resp.products || [];
    groupByCategory();
    renderCategories();
    updateTotalItems();
  }

  // GROUP BY CATEGORY
  function groupByCategory() {
    grouped = {};

    for (const p of allProducts) {
      const cat = p.category || "Другое";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({ ...p, qty: 0 });
      if (!(cat in collapsed)) collapsed[cat] = false;
    }
  }

  // -------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------
  function renderCategories() {
    form.innerHTML = "";

    const terms = searchTerm.trim().toLowerCase();

    for (const category of Object.keys(grouped).sort()) {
      const block = document.createElement("div");
      block.className = "category-block";

      const catHeader = document.createElement("div");
      catHeader.className = "category-header";
      catHeader.textContent = category;

      catHeader.addEventListener("click", () => {
        collapsed[category] = !collapsed[category];
        renderCategories();
      });

      block.appendChild(catHeader);

      if (collapsed[category]) {
        const hiddenNote = document.createElement("div");
        hiddenNote.className = "category-collapsed";
        hiddenNote.textContent = "Свернуто";
        block.appendChild(hiddenNote);
        form.appendChild(block);
        continue;
      }

      const itemsWrap = document.createElement("div");
      itemsWrap.className = "items-wrap";

      for (const prod of grouped[category]) {
        // filter
        if (terms && !prod.name.toLowerCase().includes(terms)) continue;

        const item = document.createElement("div");
        item.className = "product-row";
        item.dataset.pid = prod.id;

        const name = document.createElement("div");
        name.className = "product-name";
        name.textContent = `${prod.name} (${prod.unit})`;

        const controls = document.createElement("div");
        controls.className = "product-controls";

        const minus = document.createElement("button");
        minus.className = "qty-btn minus";
        minus.textContent = "-";
        minus.addEventListener("click", () => changeQty(prod.id, -1));

        const input = document.createElement("input");
        input.className = "qty-input";
        input.type = "number";
        input.min = "0";
        input.value = prod.qty || 0;
        input.addEventListener("input", () => {
          let v = Number(input.value);
          if (isNaN(v) || v < 0) v = 0;
          prod.qty = v;
          updateTotalItems();
        });

        const plus = document.createElement("button");
        plus.className = "qty-btn plus";
        plus.textContent = "+";
        plus.addEventListener("click", () => changeQty(prod.id, +1));

        controls.appendChild(minus);
        controls.appendChild(input);
        controls.appendChild(plus);

        item.appendChild(name);
        item.appendChild(controls);
        itemsWrap.appendChild(item);
      }

      block.appendChild(itemsWrap);
      form.appendChild(block);
    }
  }

  // -------------------------------------------------------------------
  // CHANGE QTY
  // -------------------------------------------------------------------
  function changeQty(pid, delta) {
    for (const cat of Object.keys(grouped)) {
      for (const p of grouped[cat]) {
        if (p.id === pid) {
          p.qty = Math.max(0, (p.qty || 0) + delta);
        }
      }
    }
    renderCategories();
    updateTotalItems();
  }

  // -------------------------------------------------------------------
  // TOTAL
  // -------------------------------------------------------------------
  function updateTotalItems() {
    let sum = 0;
    for (const cat of Object.keys(grouped)) {
      for (const p of grouped[cat]) {
        sum += p.qty || 0;
      }
    }
    totalCounter.textContent = sum;
  }

  // -------------------------------------------------------------------
  // SUBMIT
  // -------------------------------------------------------------------
  async function submitRequest() {
    let items = [];
    for (const cat of Object.keys(grouped)) {
      for (const p of grouped[cat]) {
        if (p.qty > 0) {
          items.push({
            product_id: p.id,
            qty: p.qty,
          });
        }
      }
    }

    if (!items.length) {
      alert("Вы не выбрали ни одного товара");
      return;
    }

    submitBtn.disabled = true;

    try {
      const resp = await api("/api/requisitions", {
        method: "POST",
        body: { items },
      });
      alert("Заявка отправлена!");
      await loadProducts();
      await loadActiveOrders();
    } catch (e) {
      alert("Ошибка: " + e.message);
    }

    submitBtn.disabled = false;
  }

  submitBtn.addEventListener("click", submitRequest);

  // -------------------------------------------------------------------
  // SEARCH
  // -------------------------------------------------------------------
  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value;
    renderCategories();
  });

  // -------------------------------------------------------------------
  // LOAD ACTIVE ORDERS
  // -------------------------------------------------------------------
  async function loadActiveOrders() {
    activeOrdersBox.innerHTML = "";
    let resp;
    try {
      resp = await api("/api/my-orders");
    } catch {
      return;
    }

    const groups = resp.orders || [];
    if (!groups.length) {
      const txt = document.createElement("div");
      txt.className = "muted";
      txt.textContent = "Активных заказов нет.";
      activeOrdersBox.appendChild(txt);
      return;
    }

    for (const g of groups) {
      const block = document.createElement("div");
      block.className = "active-block";

      const title = document.createElement("div");
      title.className = "active-supplier";
      title.textContent = g.supplier_name;
      block.appendChild(title);

      const list = document.createElement("div");
      list.className = "active-items";

      for (const it of g.items) {
        const row = document.createElement("div");
        row.className = "active-row";
        row.textContent = `${it.name} — ${it.qty} ${it.unit}`;
        list.appendChild(row);
      }
      block.appendChild(list);

      const doneBtn = document.createElement("button");
      doneBtn.className = "done-order";
      doneBtn.textContent = "Заказ получен";
      doneBtn.addEventListener("click", () =>
        markDelivered(g.supplier_id)
      );

      block.appendChild(doneBtn);
      activeOrdersBox.appendChild(block);
    }
  }

  async function markDelivered(supplier_id) {
    try {
      await api(`/api/my-orders/${supplier_id}/delivered`, {
        method: "POST",
      });
      await loadActiveOrders();
      await loadProducts();
    } catch (e) {
      alert("Ошибка: " + e.message);
    }
  }

  // -------------------------------------------------------------------
  // RUN EVERYTHING
  // -------------------------------------------------------------------
  async function init() {
    try {
      await loadProducts();
      await loadActiveOrders();
    } catch (e) {
      console.error(e);
    }
  }

  init();
})();
