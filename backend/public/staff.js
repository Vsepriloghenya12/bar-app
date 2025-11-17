const API = location.origin;
const $ = s => document.querySelector(s);

function getInit(){
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

  if (!r.ok || !j?.ok){
    throw new Error(j?.error || "Ошибка");
  }
  return j;
}

/* ---------------- PRODUCTS ---------------- */

let PRODUCTS = [];
let DISABLED = new Set();

async function loadProducts(){
  const box = $("#products");
  box.innerHTML = "Загрузка...";

  const { products } = await api("/api/products");
  PRODUCTS = products;

  renderProducts();
}

function renderProducts(){
  const box = $("#products");

  box.innerHTML = PRODUCTS.map(p=>{
    const dis = DISABLED.has(p.id);

    return `
      <div class="card ${dis?'disabled':''}">
        <b>${p.name}</b> (${p.unit})<br>
        <small>${p.category}</small><br>

        ${dis 
          ? `<div class="warn">Уже заказан</div>`
          : `<input type="number" min="0" id="qty_${p.id}" placeholder="Кол-во" class="qty-input">`
        }
      </div>
    `;
  }).join("");
}

/* ---------------- SEND REQUISITION ---------------- */

$("#send").onclick = async ()=>{
  const items = [];

  PRODUCTS.forEach(p=>{
    if (DISABLED.has(p.id)) return;

    const el = $(`#qty_${p.id}`);
    if (!el) return;

    const val = Number(el.value);
    if (val > 0){
      items.push({ product_id:p.id, qty:val });
    }
  });

  if (!items.length) return alert("Выберите товары");

  try{
    await api("/api/requisitions","POST",{ items });
    alert("Заявка отправлена!");

    loadProducts();
    loadOrders();

    document.querySelectorAll(".qty-input").forEach(i=>i.value="");

  }catch(e){
    alert(e.message);
  }
};

/* ---------------- ACTIVE ORDERS ---------------- */

async function loadOrders(){
  const box = $("#orders");
  box.innerHTML = "Загрузка...";

  const { orders } = await api("/api/my-orders");

  DISABLED = new Set();
  orders.forEach(g => g.items.forEach(it=> DISABLED.add(it.product_id)));

  renderProducts();

  if (!orders.length){
    box.innerHTML = "<div class='muted'>Нет активных заказов</div>";
    return;
  }

  box.innerHTML = orders.map(g=>`
    <div class="card">
      <h3>${g.supplier_name}</h3>
      ${g.items.map(it=>`${it.name} — ${it.qty} ${it.unit}`).join("<br>")}
      <br>
      <button class="main-btn small-btn" onclick="delivered(${g.supplier_id})">
        Заказ пришёл
      </button>
    </div>
  `).join("");
}

async function delivered(supplier){
  try{
    await api(`/api/my-orders/${supplier}/delivered`, "POST");
    loadOrders();
    loadProducts();
  }catch(e){
    alert(e.message);
  }
}

/* INIT */
loadProducts();
loadOrders();
