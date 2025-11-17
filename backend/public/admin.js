const API = location.origin;
const $ = s => document.querySelector(s);

function getInit() {
  return new URLSearchParams(location.search).get("initData") || "";
}

async function api(url, method="GET", data=null){
  const headers = {
    "Content-Type":"application/json",
    "X-TG-INIT-DATA": getInit()
  };

  const opt = { method, headers };
  if (data) opt.body = JSON.stringify(data);

  const r = await fetch(url, opt);
  const j = await r.json().catch(()=>null);

  if (!r.ok || !j?.ok) throw new Error(j?.error || "Ошибка");
  return j;
}

/* ======================== SUPPLIERS ======================== */

async function loadSuppliers(){
  const box = $("#suppliers");
  box.innerHTML = "Загрузка...";

  const { suppliers } = await api("/api/admin/suppliers");

  box.innerHTML = suppliers.map(s => `
    <div class="card">
      <b>${s.id}</b> — ${s.name}<br>
      Примечание: ${s.contact_note || "-"}<br>
      Статус: ${s.active ? "Активен" : "Не активен"}

      <div class="actions-row">
        <button onclick="editSupplier(${s.id})">Ред</button>
        <button onclick="deleteSupplier(${s.id})">Удалить</button>
      </div>
    </div>
  `).join("");
}

async function editSupplier(id){
  const name = prompt("Название:");
  if (!name) return;

  const note = prompt("Примечание:") || "";
  const active = confirm("Активен?") ? 1 : 0;

  await api(`/api/admin/suppliers/${id}`, "PATCH", {
    name, contact_note: note, active
  });

  loadSuppliers();
}

async function deleteSupplier(id){
  if (!confirm("Удалить поставщика?")) return;
  await api(`/api/admin/suppliers/${id}`, "DELETE");
  loadSuppliers();
}

$("#sup_add").onclick = async ()=>{
  const name = $("#sup_name").value.trim();
  const note = $("#sup_note").value.trim();

  if (!name) return alert("Введите название");

  await api("/api/admin/suppliers","POST",{ name, contact_note: note });

  $("#sup_name").value = "";
  $("#sup_note").value = "";
  loadSuppliers();
};

/* ======================== PRODUCTS ======================== */

async function loadProducts(){
  const box = $("#products");
  box.innerHTML = "Загрузка...";

  const { products } = await api("/api/admin/products");

  box.innerHTML = products.map(p => `
    <div class="card">
      <b>${p.id}</b> — ${p.name}<br>
      ${p.unit}, ${p.category}<br>
      Поставщик: ${p.supplier_id} (${p.supplier_name})<br>

      <div class="actions-row">
        <button onclick="editProduct(${p.id})">Ред</button>
        <button onclick="deleteProduct(${p.id})">Удалить</button>
        <button onclick="editAlts(${p.id})">Alt</button>
      </div>
    </div>
  `).join("");
}

async function editProduct(id){
  const name = prompt("Название:");
  if (!name) return;

  const unit = prompt("Ед. изм:") || "";
  const category = prompt("Категория:", "Общее") || "Общее";
  const supplier_id = Number(prompt("ID поставщика:"));
  const active = confirm("Активен?") ? 1 : 0;

  await api(`/api/admin/products/${id}`, "PATCH", {
    name, unit, category, supplier_id, active
  });

  loadProducts();
}

async function deleteProduct(id){
  if (!confirm("Удалить товар?")) return;
  await api(`/api/admin/products/${id}`, "DELETE");
  loadProducts();
}

$("#p_add").onclick = async ()=>{
  const name = $("#p_name").value.trim();
  const unit = $("#p_unit").value.trim();
  const category = $("#p_cat").value.trim() || "Общее";
  const supplier_id = Number($("#p_sup").value);

  if (!name || !unit || !supplier_id){
    return alert("Заполните поля");
  }

  await api("/api/admin/products","POST",{ name, unit, category, supplier_id });

  $("#p_name").value = "";
  $("#p_unit").value = "";
  $("#p_cat").value = "";
  $("#p_sup").value = "";

  loadProducts();
};

/* ============= ALTERNATIVE SUPPLIERS ============= */

async function editAlts(pid){
  const { alternatives } = await api(`/api/admin/products/${pid}/alternatives`);
  const list = alternatives.map(a => `${a.supplier_id} — ${a.name}`).join("\n");

  const choice = prompt(
    `Альтернативные:\n${list}\n\n` +
    `Введите ID чтобы добавить\n` +
    `или -ID чтобы удалить`
  );

  if (!choice) return;

  if (choice.startsWith("-")){
    await api(`/api/admin/products/${pid}/alternatives/${Number(choice.slice(1))}`, "DELETE");
  } else {
    await api(`/api/admin/products/${pid}/alternatives`,"POST",{ supplier_id: Number(choice) });
  }

  alert("Готово");
}

/* INIT */
loadSuppliers();
loadProducts();
