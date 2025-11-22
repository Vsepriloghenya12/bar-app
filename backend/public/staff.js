"use strict";

const API_BASE = location.origin;

// Универсальный запрос
async function API(path, method = "GET", data = null) {
  const opts = { method, headers: {} };

  // Telegram initData
  const tg = window.Telegram?.WebApp;
  if (tg?.initData) {
    opts.headers["X-TG-INIT-DATA"] = tg.initData;
  }

  if (data) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(data);
  }

  const res = await fetch(API_BASE + path, opts);
  return await res.json().catch(() => ({}));
}

/* -------------------------------------------------- */
/* ЗАГРУЗКА ТОВАРОВ — ГРУППИРОВКА ПО КАТЕГОРИЯМ        */
/* -------------------------------------------------- */

function renderProductsByCategory(products) {
  const container = document.getElementById("category-list");
  container.innerHTML = "";

  const map = new Map();
  for (const p of products) {
    if (!map.has(p.category)) map.set(p.category, []);
    map.get(p.category).push(p);
  }

  for (const [category, items] of map.entries()) {
    const cat = document.createElement("div");
    cat.className = "accordion";

    const header = document.createElement("div");
    header.className = "accordion-header";
    header.innerHTML = `<span>${category}</span><span class="arrow">▶</span>`;

    const body = document.createElement("div");
    body.className = "accordion-body";
    body.style.display = "none";

    header.onclick = () => {
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "block" : "none";
      header.querySelector(".arrow").textContent = hidden ? "▼" : "▶";
    };

    // товары внутри категории
    items.forEach(p => {
      const row = document.createElement("div");
      row.className = "product-row";
      row.innerHTML = `
        <span>${p.name} <span class="unit">(${p.unit})</span></span>
        <input id="qty-${p.id}" type="number" min="0" placeholder="0" class="qty-input">
      `;
      body.appendChild(row);
    });

    cat.appendChild(header);
    cat.appendChild(body);
    container.appendChild(cat);
  }
}

// загрузка товаров
function loadProducts() {
  API("/api/products").then(r => {
    if (!r.ok) return alert("Ошибка загрузки товаров");
    renderProductsByCategory(r.products);
  });
}

/* -------------------------------------------------- */
/* ОТПРАВКА ЗАЯВКИ                                    */
/* -------------------------------------------------- */

document.getElementById("send-btn").onclick = async () => {
  const qtyInputs = document.querySelectorAll("[id^='qty-']");
  const items = [];

  qtyInputs.forEach(input => {
    const v = Number(input.value);
    if (v > 0) {
      const pid = Number(input.id.replace("qty-", ""));
      items.push({ product_id: pid, qty: v });
    }
  });

  if (items.length === 0)
    return alert("Выберите хотя бы один товар");

  const r = await API("/api/requisitions", "POST", { items });
  if (!r.ok) return alert(r.error);

  alert("Заявка отправлена!");
  loadActiveOrders();
};

/* -------------------------------------------------- */
/* АКТИВНЫЕ ЗАЯВКИ                                    */
/* -------------------------------------------------- */

function renderActiveOrders(data) {
  const container = document.getElementById("active-orders");
  container.innerHTML = "";

  if (!data || data.length === 0) {
    container.innerHTML = "<p class='muted'>Активных заявок нет</p>";
    return;
  }

  data.forEach(order => {
    const block = document.createElement("div");
    block.className = "order-block";

    block.innerHTML = `
      <div class="order-head">
        <b>${order.supplier_name}</b>
        <button class="mini-btn" onclick="markDelivered(${order.supplier_id})">Получено</button>
      </div>
    `;

    order.items.forEach(it => {
      const row = document.createElement("div");
      row.className = "order-item";
      row.innerHTML = `
        <span>${it.name}</span>
        <span>${it.qty} ${it.unit}</span>
      `;
      block.appendChild(row);
    });

    container.appendChild(block);
  });
}

async function loadActiveOrders() {
  const r = await API("/api/my-orders");
  if (!r.ok) return;
  renderActiveOrders(r.orders);
}

async function markDelivered(supplier_id) {
  const r = await API(`/api/my-orders/${supplier_id}/delivered`, "POST");
  if (!r.ok) return alert(r.error);
  loadActiveOrders();
}

/* -------------------------------------------------- */
/* СТАРТ                                              */
/* -------------------------------------------------- */

loadProducts();
loadActiveOrders();
