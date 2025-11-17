/* ============================================
   ADMIN PANEL — FULL WORKING VERSION
   ============================================ */

/* === Telegram InitData === */
function tg() {
  return (window.Telegram?.WebApp?.initData || "");
}

/* === Unified API Wrapper with initData === */
async function API(url, method = 'GET', data = null) {
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

/* =====================================================
   SUPPLIERS
   ===================================================== */

async function loadSuppliers() {
  const r = await API('/api/admin/suppliers');
  if (!r.ok) return console.warn("loadSuppliers:", r.error);

  const box = document.getElementById('suppliers');
  box.innerHTML = "";

  r.suppliers.forEach(s => {
    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
      <div class="accordion-header" onclick="toggleAccordion(this)">
        <span>${s.name}</span>
        <span class="arrow">▶</span>
      </div>

      <div class="accordion-body" style="display:none">
        <div><b>Контакт:</b> ${s.contact_note || '—'}</div>

        <div class="actions-row">
          <button onclick="editSupplier(${s.id})">Ред</button>
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

  const r = await API('/api/admin/suppliers', 'POST', {
    name,
    contact_note: note
  });

  if (!r.ok) return alert(r.error);

  document.getElementById("sup-name").value = "";
  document.getElementById("sup-note").value = "";

  loadSuppliers();
  loadProductFormSuppliers();
}

async function editSupplier(id) {
  const name = prompt("Новое название:");
  if (!name) return;

  const note = prompt("Новая заметка:", "");

  const r = await API(`/api/admin/suppliers/${id}`, 'PATCH', {
    name,
    contact_note: note
  });

  if (!r.ok) return alert(r.error);

  loadSuppliers();
  loadProductFormSuppliers();
}

async function deleteSupplier(id) {
  if (!confirm("Удалить поставщика?")) return;

  const r = await API(`/api/admin/suppliers/${id}`, 'DELETE');
  if (!r.ok) return alert(r.error);

  loadSuppliers();
  loadProductFormSuppliers();
}


/* =====================================================
   CATEGORIES
   ===================================================== */

async function loadCategories() {
  const r = await API('/api/admin/categories');
  if (!r.ok) {
    console.warn("loadCategories:", r.error);
    return;
  }

  const sel = document.getElementById("prod-category");
  sel.innerHTML = "";

  // существующие категории
  r.categories.forEach(cat => {
    const o = document.createElement("option");
    o.value = cat;
    o.textContent = cat;
    sel.appendChild(o);
  });

  // пункт "новая категория"
  const o2 = document.createElement("option");
  o2.value = "__new";
  o2.textContent = "— новая категория —";
  sel.appendChild(o2);

  // по умолчанию, если нет категорий — выберется "__new"
  if (!r.categories.length) {
    sel.value = "__new";
  }
}


/* =====================================================
   PRODUCTS
   ===================================================== */

async function loadProducts() {
  const r = await API('/api/admin/products');
  if (!r.ok) return console.warn("loadProducts:", r.error);

  const box = document.getElementById('products');
  box.innerHTML = "";

  const groups = {};
  r.products.forEach(p => {
    if (!groups[p.category]) groups[p.category] = [];
    groups[p.category].push(p);
  });

  Object.entries(groups).forEach(([category, items]) => {
    const wrap = document.createElement("div");
    wrap.className = "card";

    wrap.innerHTML = `
      <div class="accordion-header" onclick="toggleAccordion(this)">
        <span><b>${category}</b></span>
        <span class="arrow">▶</span>
      </div>
      <div class="accordion-body" style="display:none"></div>
    `;

    const body = wrap.querySelector('.accordion-body');

    items.forEach(p => {
      const block = document.createElement("div");
      block.className = "card";

      block.innerHTML = `
        <div><b>${p.name}</b> (${p.unit})</div>
        <div style="font-size:12px;margin-top:4px;color:#999">
          Поставщик: ${p.supplier_name}
        </div>

        <div class="actions-row">
          <button onclick="editProduct(${p.id})">Ред</button>
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
  const r = await API('/api/admin/suppliers');
  if (!r.ok) return console.warn("loadProductFormSuppliers:", r.error);

  const sel = document.getElementById("prod-supplier");
  sel.innerHTML = "";

  r.suppliers.forEach(s => {
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

    // если пользователь ввёл текст — всегда используем его
    if (custom) return custom;

    // иначе пытаемся взять выбранное значение из селекта
    if (sel && sel.value && sel.value !== "__new") return sel.value;

    return "";
  })();

  const supplier_id = Number(document.getElementById("prod-supplier").value);

  if (!name) return alert("Введите название");
  if (!unit) return alert("Введите ед. изм.");
  if (!category) return alert("Категория обязательна");
  if (!supplier_id) return alert("Выберите поставщика");

  const r = await API('/api/admin/products', 'POST', {
    name,
    unit,
    category,
    supplier_id
  });

  if (!r.ok) return alert(r.error);

  document.getElementById("prod-name").value = "";
  document.getElementById("prod-unit").value = "";
  document.getElementById("prod-category-new").value = "";

  loadProducts();
  loadCategories();
}

async function editProduct(id) {
  const name = prompt("Название:");
  if (!name) return;

  const unit = prompt("Ед. изм.:");
  if (!unit) return;

  const category = prompt("Категория:");
  if (!category) return;

  const supplier = prompt("ID основного поставщика:");
  if (!supplier) return;

  const r = await API(`/api/admin/products/${id}`, 'PATCH', {
    name,
    unit,
    category,
    supplier_id: Number(supplier)
  });

  if (!r.ok) return alert(r.error);

  loadProducts();
  loadCategories();
  loadProductFormSuppliers();
}

async function deleteProduct(id) {
  if (!confirm("Удалить товар?")) return;

  const r = await API(`/api/admin/products/${id}`, 'DELETE');
  if (!r.ok) return alert(r.error);

  loadProducts();
  loadCategories();
}

async function editAlt(id) {
  const sid = prompt("ID альтернативного поставщика:");
  if (!sid) return;

  const r = await API(`/api/admin/products/${id}/alternatives`, 'POST', {
    supplier_id: Number(sid)
  });

  if (!r.ok) return alert(r.error);

  alert("Добавлено!");
}


/* =====================================================
   ACCORDION
   ===================================================== */

function toggleAccordion(el) {
  const body = el.nextElementSibling;
  const arrow = el.querySelector('.arrow');

  if (body.style.display === "none") {
    body.style.display = "block";
    arrow.textContent = "▼";
  } else {
    body.style.display = "none";
    arrow.textContent = "▶";
  }
}


/* =====================================================
   INIT
   ===================================================== */

loadSuppliers();
loadCategories();
loadProductFormSuppliers();
loadProducts();
