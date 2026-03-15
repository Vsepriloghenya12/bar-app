"use strict";

const API_BASE = location.origin;

async function API(path, method = "GET", data = null) {
  const opts = { method, headers: {} };
  const tg = window.Telegram?.WebApp;

  if (tg?.initData) opts.headers["X-TG-INIT-DATA"] = tg.initData;
  if (data) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(data);
  }

  const res = await fetch(API_BASE + path, opts);
  return await res.json().catch(() => ({}));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function statusLabel(status) {
  if (status === "ordered") return "Принята";
  if (status === "delivered") return "Приехала";
  return "Новая";
}

function renderProductsByCategory(products) {
  const container = document.getElementById("category-list");
  container.innerHTML = "";

  const map = new Map();
  for (const p of products) {
    const key = p.category || "Без категории";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  }

  for (const [category, items] of map.entries()) {
    const group = document.createElement("section");
    group.className = "group-block";

    const title = document.createElement("div");
    title.className = "group-title";
    title.innerHTML = `<span>${escapeHtml(category)}</span><small>${items.length} позиций</small>`;
    group.appendChild(title);

    items.forEach((p) => {
      const row = document.createElement("div");
      row.className = "list-row product-row";
      row.innerHTML = `
        <div class="row-main">
          <div class="row-title">${escapeHtml(p.name)}</div>
          <div class="row-sub">${escapeHtml(p.unit)}</div>
        </div>
        <input id="qty-${p.id}" type="number" min="0" placeholder="0" class="qty-input">
      `;
      group.appendChild(row);
    });

    container.appendChild(group);
  }
}

function loadProducts() {
  API("/api/products").then((r) => {
    if (!r.ok) return alert("Ошибка загрузки товаров");
    renderProductsByCategory(r.products);
  });
}

document.getElementById("send-btn").onclick = async () => {
  const qtyInputs = document.querySelectorAll("[id^='qty-']");
  const items = [];

  qtyInputs.forEach((input) => {
    const v = Number(input.value);
    if (v > 0) {
      const pid = Number(input.id.replace("qty-", ""));
      items.push({ product_id: pid, qty: v });
    }
  });

  if (items.length === 0) return alert("Выберите хотя бы один товар");

  const r = await API("/api/requisitions", "POST", { items });
  if (!r.ok) return alert(r.error);

  qtyInputs.forEach((input) => {
    input.value = "";
  });

  alert(`Заявка #${r.requisition_id} отправлена!`);
  loadActiveOrders();
};

function renderActiveOrders(requisitions) {
  const container = document.getElementById("active-orders");
  container.innerHTML = "";

  if (!requisitions || requisitions.length === 0) {
    container.innerHTML = "<div class='empty-state muted-text'>Активных заявок нет</div>";
    return;
  }

  requisitions.forEach((reqItem) => {
    const entry = document.createElement("div");
    entry.className = "req-entry is-open";

    const supplierRows = reqItem.orders.map((order) => {
      const itemsHtml = order.items.map((it) => `
        <div class="item-line">
          <span>${escapeHtml(it.name)}</span>
          <span>${escapeHtml(it.qty)} ${escapeHtml(it.unit || "")}</span>
        </div>
      `).join("");

      const isDelivered = order.status === "delivered";

      return `
        <div class="supplier-line">
          <div class="supplier-line-main">
            <div class="row-title">${escapeHtml(order.supplier_name)}</div>
            <div class="row-sub">Статус поставки</div>
          </div>
          <div class="row-actions">
            <span class="status-badge ${escapeHtml(order.status)}">${statusLabel(order.status)}</span>
            <button class="ghost-btn mini-btn" ${isDelivered ? "disabled" : ""} onclick="markDelivered(${order.order_id})">
              ${isDelivered ? "Получено" : "Отметить"}
            </button>
          </div>
        </div>
        ${itemsHtml}
      `;
    }).join("");

    entry.innerHTML = `
      <div class="req-summary static-summary">
        <div class="requisition-summary-main">
          <div class="requisition-title-row">
            <span class="row-title">Заявка #${reqItem.requisition_id}</span>
          </div>
          <div class="requisition-subline">${escapeHtml(reqItem.created_at || "")}</div>
        </div>
      </div>
      <div class="req-details staff-open-details">
        ${supplierRows}
      </div>
    `;

    container.appendChild(entry);
  });
}

async function loadActiveOrders() {
  const r = await API("/api/my-orders");
  if (!r.ok) return;
  renderActiveOrders(r.requisitions);
}

async function markDelivered(orderId) {
  const r = await API(`/api/my-orders/${orderId}/delivered`, "POST");
  if (!r.ok) return alert(r.error || "Не удалось отметить получение");
  loadActiveOrders();
}

loadProducts();
loadActiveOrders();
