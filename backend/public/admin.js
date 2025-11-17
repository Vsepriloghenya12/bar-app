const API = location.origin;
const $ = s => document.querySelector(s);

async function api(url, method="GET", data=null){
  const opt = { method, headers:{ "Content-Type":"application/json" } };
  if (data) opt.body = JSON.stringify(data);

  const r = await fetch(url, opt);
  const j = await r.json().catch(()=>null);

  if (!r.ok || !j?.ok){
    throw new Error(j?.error || "Ошибка");
  }
  return j;
}

/* ------------------------- SUPPLIERS ------------------------- */

async function loadSuppliers(){
  const box = $("#suppliers");
  box.innerHTML = "Загрузка...";

  const { suppliers } = await api("/api/admin/suppliers");

  box.innerHTML = suppliers.map(s => `
    <div class="card">
      <b>${s.id}</b> — ${s.name}
      <br>Примечание: ${s.contact_note || "-"}
      <br>Активен: ${s.active ? "да" : "нет"}
      <br>
      <button onclick="editSupplier(${s.id})">Ред.</button>
      <button onclick="deleteSupplier(${s.id})">Удалить</button>
    </div>
  `).join("");
}

async function deleteSupplier(id){
  if (!confirm("Удалить поставщика?")) return;
  await api(`/api/admin/suppliers/${id}`, "DELETE");
  await loadSuppliers();
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

/* create supplier */
$("#sup_add").onclick = async ()=>{
  const name = $("#sup_name").value.trim();
  const note = $("#sup_note").value.trim();

  if (!name) return alert("Введите название");

  try{
    await api("/api/admin/suppliers", "POST", {
      name, contact_note: note
    });
    $("#sup_name").value="";
    $("#sup_note").value="";
    loadSuppliers();

  }catch(e){
    alert(e.message);
  }
};

/* ------------------------- PRODUCTS ------------------------- */

async function loadProducts(){
  const box = $("#products");
  box.innerHTML = "Загрузка...";

  const { products } = await api("/api/admin/products");

  box.innerHTML = products.map(p => `
    <div class="card">
      <b>${p.id}</b> — ${p.name}
      <br>${p.unit}, ${p.category}
      <br>Поставщик: ${p.supplier_id} (${p.supplier_name})
      <br>Активен: ${p.active ? "да" : "нет"}
      <br>

      <button onclick="editProduct(${p.id})">Ред.</button>
      <button onclick="deleteProduct(${p.id})">Удалить</button>
      <button onclick="editAlts(${p.id})">Альтернативные</button>
    </div>
  `).join("");
}

async function deleteProduct(id){
  if (!confirm("Удалить товар?")) return;
  await api(`/api/admin/products/${id}`, "DELETE");
  loadProducts();
}

async function editProduct(id){
  const name = prompt("Название:");
  if (!name) return;

  const unit = prompt("Ед. изм:");
  if (!unit) return;

  const category = prompt("Категория:") || "Общее";
  const supplier_id = Number(prompt("ID поставщика:"));
  if (!supplier_id) return;

  const active = confirm("Активен?") ? 1 : 0;

  await api(`/api/admin/products/${id}`, "PATCH", {
    name, unit, category, supplier_id, active
  });

  loadProducts();
}

/* Add product */
$("#p_add").onclick = async ()=>{
  const name = $("#p_name").value.trim();
  const unit = $("#p_unit").value.trim();
  const category = $("#p_cat").value.trim();
  const supplier_id = Number($("#p_sup").value);

  if (!name || !unit || !supplier_id){
    return alert("Заполните все поля.");
  }

  try{
    await api("/api/admin/products","POST",{
      name, unit, category, supplier_id
    });

    $("#p_name").value="";
    $("#p_unit").value="";
    $("#p_cat").value="Общее";
    $("#p_sup").value="";

    loadProducts();
  }catch(e){
    alert(e.message);
  }
};

/* ---------------- ALTERNATIVE SUPPLIERS ---------------- */

async function editAlts(pid){
  const { alternatives } = await api(`/api/admin/products/${pid}/alternatives`);

  const list = alternatives.map(a=>`${a.supplier_id} — ${a.name}`).join("\n");

  const choice = prompt(
    `Альтернативные поставщики:\n${list}\n\n` +
    `1. Ввести ID поставщика чтобы ДОБАВИТЬ\n` +
    `2. Или ввести "-ID" чтобы УДАЛИТЬ`
  );

  if (!choice) return;

  if (choice.startsWith("-")){
    const id = Number(choice.slice(1));
    if (id) await api(`/api/admin/products/${pid}/alternatives/${id}`, "DELETE");
  }
  else {
    const id = Number(choice);
    if (id) await api(`/api/admin/products/${pid}/alternatives`, "POST", { supplier_id:id });
  }

  alert("Готово");
}

/* -------------------------------------------------- */
/* INIT */
/* -------------------------------------------------- */

loadSuppliers();
loadProducts();
