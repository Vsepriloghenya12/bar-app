/* ========= ADMIN PANEL SCRIPT ========= */

const API = (url, method='GET', data=null) =>
  fetch(url, {
    method,
    headers: { "Content-Type":"application/json" },
    body: data ? JSON.stringify(data) : null,
  }).then(r => r.json());

/* ========= LOAD SUPPLIERS ========= */

async function loadSuppliers() {
  const r = await API('/api/admin/suppliers');
  if (!r.ok) return;

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
          <button onclick="editSupplier(${s.id})">Ред.</button>
          <button onclick="deleteSupplier(${s.id})">Удал</button>
        </div>
      </div>
    `;

    box.appendChild(div);
  });
}

/* ========= ADD SUPPLIER ========= */
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

/* ========= EDIT SUPPLIER ========= */
async function editSupplier(id) {
  const name = prompt("Новое название:");
  if (!name) return;

  const note = prompt("Новая заметка (или Enter):", "");

  const r = await API(`/api/admin/suppliers/${id}`, 'PATCH', {
    name,
    contact_note: note
  });

  if (!r.ok) return alert(r.error);

  loadSuppliers();
  loadProductFormSuppliers();
}

/* ========= DELETE SUPPLIER ========= */
async function deleteSupplier(id) {
  if (!confirm("Удалить поставщика?")) return;

  const r = await API(`/api/admin/suppliers/${id}`, 'DELETE');
  if (!r.ok) return alert(r.error);

  loadSuppliers();
  loadProductFormSuppliers();
}


/* ===========================================================
   CATEGORIES
   =========================================================== */

async function loadCategories() {
  const r = await API('/api/admin/categories');
  if (!r.ok) return;

  const sel = document.getElementById("prod-category");
  sel.innerHTML = "";

  r.categories.forEach(cat => {
    const o = document.createElement("option");
    o.value = cat;
    o.textContent = cat;
    sel.appendChild(o);
  });

  const o2 = document.createElement("option");
  o2.value = "__new";
  o2.textContent = "— новая категория —";
  sel.appendChild(o2);
}


/* ===========================================================
   PRODUCTS
   =========================================================== */

async function loadProducts() {
  const r = await API('/api/admin/products');
  if (!r.ok) return;

  const box = document.getElementById('products');
  box.innerHTML = "";

  // группируем по категориям → поставщикам
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
        <div style="margin-top:4px;color:#aaa;font-size:12px;">
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

/* ========= PRODUCT FORM SUPPLIER SELECT ========= */
async function loadProductFormSuppliers() {
  const r = await API('/api/admin/suppliers');
  if (!r.ok) return;

  const sel = document.getElementById("prod-supplier");
  sel.innerHTML = "";

  r.suppliers.forEach(s => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    sel.appendChild(o);
  });
}

/* ========= ADD PRODUCT ========= */
async function addProduct() {
  const name = document.getElementById("prod-name").value.trim();
  const unit = document.getElementById("prod-unit").value.trim();

  const category = (() => {
    const sel = document.getElementById("prod-category");
    const custom = document.getElementById("prod-category-new").value.trim();
    if (sel.value === "__new" && custom) return custom;
    return sel.value;
  })();

  const supplier_id = Number(document.getElementById("prod-supplier").value);

  if (!name) return alert("Введите название");
  if (!unit) return alert("Введите ед. изм.");

  const r = await API('/api/admin/products', 'POST', {
    name, unit, category, supplier_id
  });

  if (!r.ok) return alert(r.error);

  document.getElementById("prod-name").value = "";
  document.getElementById("prod-unit").value = "";
  document.getElementById("prod-category-new").value = "";

  loadProducts();
  loadCategories();
}

/* ========= EDIT PRODUCT ========= */
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

/* ========= DELETE PRODUCT ========= */
async function deleteProduct(id) {
  if (!confirm("Удалить товар?")) return;

  const r = await API(`/api/admin/products/${id}`, 'DELETE');
  if (!r.ok) return alert(r.error);

  loadProducts();
  loadCategories();
}

/* ========= ALT SUPPLIERS ========= */
async function editAlt(id) {
  const sid = prompt("ID альтернативного поставщика:");
  if (!sid) return;

  const r = await API(`/api/admin/products/${id}/alternatives`, 'POST', {
    supplier_id: Number(sid)
  });

  if (!r.ok) return alert(r.error);

  alert("Добавлено!");
}

/* ========= Accordion ========= */
function toggleAccordion(el) {
  const body = el.nextElementSibling;
  const arrow = el.querySelector(".arrow");

  if (body.style.display === "none") {
    body.style.display = "block";
    arrow.textContent = "▼";
  } else {
    body.style.display = "none";
    arrow.textContent = "▶";
  }
}

/* ========= INIT ========= */
loadSuppliers();
loadProductFormSuppliers();
loadCategories();
loadProducts();
