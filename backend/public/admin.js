/* ============================================
   OWNER PANEL
   ============================================ */

function tg() {
  return window.Telegram?.WebApp?.initData || "";
}

async function API(url, method = "GET", data = null) {
  const r = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-TG-INIT-DATA": tg()
    },
    body: data ? JSON.stringify(data) : null
  });

  return r.json().catch(() => ({ ok: false, error: "Invalid JSON" }));
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

function requisitionStatus(orders = []) {
  if (!orders.length) return "pending";
  if (orders.every((order) => order.status === "delivered")) return "delivered";
  if (orders.some((order) => order.status === "ordered" || order.status === "delivered")) return "ordered";
  return "pending";
}

function toggleAccordion(el) {
  if (!el?.classList.contains("accordion-header")) return;
  const body = el.nextElementSibling;
  const arrow = el.querySelector(".arrow");
  const holder = el.closest(".accordion, .card");
  const isHidden = body.style.display === "none" || !body.style.display;
  body.style.display = isHidden ? "block" : "none";
  holder?.classList.toggle("is-open", isHidden);
  if (arrow) arrow.textContent = isHidden ? "▼" : "▶";
}

function switchAdminTab(tab) {
  const catalog = document.getElementById("page-catalog");
  const requisitions = document.getElementById("page-requisitions");
  const tabCatalog = document.getElementById("tab-catalog");
  const tabRequisitions = document.getElementById("tab-requisitions");

  const isCatalog = tab === "catalog";
  catalog.classList.toggle("hidden", !isCatalog);
  requisitions.classList.toggle("hidden", isCatalog);
  tabCatalog.classList.toggle("active", isCatalog);
  tabRequisitions.classList.toggle("active", !isCatalog);

  if (!isCatalog) loadOwnerRequisitions();
}

/* =====================================================
   SUPPLIERS
   ===================================================== */

async function loadSuppliers() {
  const r = await API("/api/admin/suppliers");
  if (!r.ok) return console.warn("loadSuppliers:", r.error);

  const box = document.getElementById("suppliers");
  box.innerHTML = "";

  r.suppliers.forEach((s) => {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="accordion-header" onclick="toggleAccordion(this)">
        <span class="accordion-title"><span>${escapeHtml(s.name)}</span><small>ID: ${s.id}</small></span>
        <span class="arrow">▶</span>
      </div>
      <div class="accordion-body" style="display:none">
        <div><b>Контакт:</b> ${escapeHtml(s.contact_note || "—")}</div>
        <div class="actions-row">
          <button onclick="editSupplier(${s.id}, '${escapeHtml(s.name)}', '${escapeHtml(s.contact_note || "")}')">Ред</button>
          <button onclick="deleteSupplier(${s.id})">Удал</button>
        </div>
      </div>
    `;
    box.appendChild(div);
  });
}

async function addSupplier() {
  const name = document.getElementById("sup-name").value.trim();
  const note = document.getElementById("sup-note").value.trim();
  if (!name) return alert("Введите название");

  const r = await API("/api/admin/suppliers", "POST", {
    name,
    contact_note: note
  });
  if (!r.ok) return alert(r.error);

  document.getElementById("sup-name").value = "";
  document.getElementById("sup-note").value = "";

  await Promise.all([loadSuppliers(), loadProductFormSuppliers()]);
}

async function editSupplier(id, currentName = "", currentNote = "") {
  const name = prompt("Новое название:", currentName);
  if (!name) return;

  const note = prompt("Новая заметка:", currentNote);
  const r = await API(`/api/admin/suppliers/${id}`, "PATCH", {
    name,
    contact_note: note || ""
  });
  if (!r.ok) return alert(r.error);

  await Promise.all([loadSuppliers(), loadProductFormSuppliers()]);
}

async function deleteSupplier(id) {
  if (!confirm("Удалить поставщика?")) return;

  const r = await API(`/api/admin/suppliers/${id}`, "DELETE");
  if (!r.ok) return alert(r.error);

  await Promise.all([loadSuppliers(), loadProductFormSuppliers(), loadProducts()]);
}

/* =====================================================
   CATEGORIES
   ===================================================== */

async function loadCategories() {
  const r = await API("/api/admin/categories");
  if (!r.ok) return console.warn("loadCategories:", r.error);

  const sel = document.getElementById("prod-category");
  sel.innerHTML = "";

  r.categories.forEach((cat) => {
    const o = document.createElement("option");
    o.value = cat;
    o.textContent = cat;
    sel.appendChild(o);
  });

  const o2 = document.createElement("option");
  o2.value = "__new";
  o2.textContent = "— новая категория —";
  sel.appendChild(o2);

  if (!r.categories.length) sel.value = "__new";
}

/* =====================================================
   PRODUCTS
   ===================================================== */

async function loadProducts() {
  const r = await API("/api/admin/products");
  if (!r.ok) return console.warn("loadProducts:", r.error);

  const box = document.getElementById("products");
  box.innerHTML = "";

  const groups = {};
  r.products.forEach((p) => {
    const key = p.category || "Без категории";
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });

  Object.entries(groups).forEach(([category, items]) => {
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.innerHTML = `
      <div class="accordion-header" onclick="toggleAccordion(this)">
        <span class="accordion-title"><span><b>${escapeHtml(category)}</b></span><small>${items.length} позиций</small></span>
        <span class="arrow">▶</span>
      </div>
      <div class="accordion-body" style="display:none"></div>
    `;

    const body = wrap.querySelector(".accordion-body");

    items.forEach((p) => {
      const block = document.createElement("div");
      block.className = "card";
      block.innerHTML = `
        <div><b>${escapeHtml(p.name)}</b> (${escapeHtml(p.unit)})</div>
        <div class="muted-text">Поставщик: ${escapeHtml(p.supplier_name)}</div>
        <div class="actions-row">
          <button onclick="editProduct(${p.id}, '${escapeHtml(p.name)}', '${escapeHtml(p.unit)}', '${escapeHtml(p.category)}', ${p.supplier_id})">Ред</button>
          <button onclick="deleteProduct(${p.id})">Удал</button>
          <button onclick="editAlt(${p.id})">Alt</button>
        </div>
      `;
      body.appendChild(block);
    });

    box.appendChild(wrap);
  });
}

async function loadProductFormSuppliers() {
  const r = await API("/api/admin/suppliers");
  if (!r.ok) return console.warn("loadProductFormSuppliers:", r.error);

  const sel = document.getElementById("prod-supplier");
  sel.innerHTML = "";

  r.suppliers.forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    sel.appendChild(o);
  });
}

async function addProduct() {
  const name = document.getElementById("prod-name").value.trim();
  const unit = document.getElementById("prod-unit").value.trim();

  const category = (() => {
    const sel = document.getElementById("prod-category");
    const custom = document.getElementById("prod-category-new").value.trim();
    if (custom) return custom;
    if (sel && sel.value && sel.value !== "__new") return sel.value;
    return "";
  })();

  const supplier_id = Number(document.getElementById("prod-supplier").value);

  if (!name) return alert("Введите название");
  if (!unit) return alert("Введите ед. изм.");
  if (!category) return alert("Категория обязательна");
  if (!supplier_id) return alert("Выберите поставщика");

  const r = await API("/api/admin/products", "POST", {
    name,
    unit,
    category,
    supplier_id
  });
  if (!r.ok) return alert(r.error);

  document.getElementById("prod-name").value = "";
  document.getElementById("prod-unit").value = "";
  document.getElementById("prod-category-new").value = "";

  await Promise.all([loadProducts(), loadCategories()]);
}

async function editProduct(id, currentName = "", currentUnit = "", currentCategory = "", currentSupplierId = 0) {
  const name = prompt("Название:", currentName);
  if (!name) return;

  const unit = prompt("Ед. изм.:", currentUnit);
  if (!unit) return;

  const category = prompt("Категория:", currentCategory);
  if (!category) return;

  const supplier = prompt("ID основного поставщика:", String(currentSupplierId || ""));
  if (!supplier) return;

  const r = await API(`/api/admin/products/${id}`, "PATCH", {
    name,
    unit,
    category,
    supplier_id: Number(supplier)
  });
  if (!r.ok) return alert(r.error);

  await Promise.all([loadProducts(), loadCategories(), loadProductFormSuppliers()]);
}

async function deleteProduct(id) {
  if (!confirm("Удалить товар?")) return;

  const r = await API(`/api/admin/products/${id}`, "DELETE");
  if (!r.ok) return alert(r.error);

  await Promise.all([loadProducts(), loadCategories()]);
}

/* =====================================================
   ALT SUPPLIERS
   ===================================================== */

async function editAlt(productId) {
  const name = prompt("Введите НАЗВАНИЕ поставщика:");
  if (!name) return;

  const suppliers = await API("/api/admin/suppliers");
  if (!suppliers.ok) return alert("Ошибка загрузки поставщиков");

  const supplier = suppliers.suppliers.find(
    (s) => s.name.toLowerCase() === name.trim().toLowerCase()
  );

  if (!supplier) return alert("Поставщик не найден!");

  const r = await API(`/api/admin/products/${productId}/alternatives`, "POST", {
    supplier_id: supplier.id
  });
  if (!r.ok) return alert(r.error);

  alert(`Добавлен альтернативный поставщик: ${supplier.name}`);
}

/* =====================================================
   OWNER REQUISITIONS
   ===================================================== */

async function loadOwnerRequisitions() {
  const r = await API("/api/admin/requisitions");
  if (!r.ok) return console.warn("loadOwnerRequisitions:", r.error);

  const box = document.getElementById("requisitions");
  box.innerHTML = "";

  if (!r.requisitions?.length) {
    box.innerHTML = `<div class="card empty-state muted-text">Заявок за последний месяц пока нет</div>`;
    return;
  }

  r.requisitions.forEach((reqItem) => {
    const wrap = document.createElement("div");
    wrap.className = "card requisition-card";

    const reqStatus = requisitionStatus(reqItem.orders);

    const supplierBlocks = reqItem.orders.map((order) => {
      const itemsHtml = order.items.map((it) => `
        <div class="order-item">
          <span>${escapeHtml(it.name)}</span>
          <span>${escapeHtml(it.qty)} ${escapeHtml(it.unit || "")}</span>
        </div>
      `).join("");

      const canMarkOrdered = order.status === "pending";

      return `
        <div class="supplier-order-card">
          <div class="order-head">
            <div>
              <b>${escapeHtml(order.supplier_name)}</b>
              <div class="muted-text">Поставщик ID: ${order.supplier_id}</div>
            </div>
            <div class="order-head-actions">
              <span class="status-badge ${escapeHtml(order.status)}">${statusLabel(order.status)}</span>
              <button class="mini-btn" ${canMarkOrdered ? "" : "disabled"} onclick="markOrdered(${order.order_id})">
                ${canMarkOrdered ? "Заказал" : "Отмечено"}
              </button>
            </div>
          </div>
          <div class="order-items-list">${itemsHtml}</div>
        </div>
      `;
    }).join("");

    wrap.innerHTML = `
      <div class="accordion-header requisition-summary" onclick="toggleAccordion(this)">
        <div class="requisition-summary-main">
          <div class="requisition-title-row">
            <b>Заявка #${reqItem.requisition_id}</b>
            <span class="status-badge ${reqStatus}">${statusLabel(reqStatus)}</span>
          </div>
          <div class="requisition-subline">
            ${escapeHtml(reqItem.user_name || reqItem.user_id || "Сотрудник")} · ${escapeHtml(reqItem.created_at || "")}
          </div>
        </div>
        <span class="arrow">▶</span>
      </div>
      <div class="accordion-body" style="display:none">
        <div class="meta-row">
          <span>Дата: ${escapeHtml(reqItem.created_at || "")}</span>
          <span>Поставщиков: ${reqItem.orders.length}</span>
        </div>
        ${supplierBlocks}
      </div>
    `;

    box.appendChild(wrap);
  });
}

async function markOrdered(orderId) {
  const r = await API(`/api/admin/orders/${orderId}/ordered`, "POST");
  if (!r.ok) return alert(r.error || "Не удалось отметить заказ");
  await loadOwnerRequisitions();
}

/* =====================================================
   INIT
   ===================================================== */

loadSuppliers();
loadCategories();
loadProductFormSuppliers();
loadProducts();
loadOwnerRequisitions();
