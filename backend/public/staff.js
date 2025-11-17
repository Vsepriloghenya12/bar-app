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

/* ===================================================== */
/* PRODUCTS LIST (only active) */
/* ===================================================== */

let PRODUCTS = [];
let DISABLED_PRODUCT_IDS = new Set(); // товары, которые уже есть в pending

async function loadProducts(){
  const box = $("#products");
  box.innerHTML = "Загрузка...";

  const { products } = await api("/api/products");
  PRODUCTS = products;

  renderProducts();
}

function renderProducts(){
  const box = $("#products");

  box.innerHTML = PRODUCTS.map(p => {
    const disabled = DISABLED_PRODUCT_IDS.has(p.id);

    return `
      <div class="card product-card ${disabled ? 'disabled' : ''}">
        <b>${p.name}</b> (${p.unit})
        <br><small>${p.category}</small>

        ${disabled 
          ? `<div class="warn">Уже в активном заказе</div>`
          : `<input type="number" 
                     min="0" 
                     placeholder="Кол-во" 
                     id="qty_${p.id}" 
                     class="qty-input">`
        }
      </div>
    `;
  }).join("");
}

/* ===================================================== */
/* SEND REQUISITION */
/* ===================================================== */

$("#send").onclick = async ()=>{
  const items = [];

  PRODUCTS.forEach(p=>{
    if (DISABLED_PRODUCT_IDS.has(p.id)) return;

    const el = $(`#qty_${p.id}`);
    if (!el) return;

    const val = Number(el.value);
    if (val > 0){
      items.push({
        product_id: p.id,
        qty: val
      });
    }
  });

  if (!items.length){
    alert("Выберите товары перед отправкой.");
    return;
  }

  try{
    await api("/api/requisitions","POST",{ items });
    alert("Заявка отправлена!");
    await loadProducts();
    await loadOrders();

    // очистить поля
    document.querySelectorAll(".qty-input").forEach(e=> e.value="");

  }catch(e){
    alert(e.message);
  }
};

/* ===================================================== */
/* LOAD ACTIVE ORDERS */
/* ===================================================== */

async function loadOrders(){
  const box = $("#orders");
  box.innerHTML = "Загрузка...";

  const { orders } = await api("/api/my-orders");

  // отключаем товары, которые находятся в pending заказах
  DISABLED_PRODUCT_IDS = new Set();
  orders.forEach(group=>{
    group.items.forEach(it=> DISABLED_PRODUCT_IDS.add(it.product_id));
  });

  renderProducts(); // обновляем список с disabled-товарами

  if (orders.length === 0){
    box.innerHTML = "<div class='muted'>Нет активных заказов</div>";
    return;
  }

  box.innerHTML = orders.map(group => `
    <div class="card">
      <h3>${group.supplier_name}</h3>
      ${group.items.map(it => `
        <div>
          ${it.name} — ${it.qty} ${it.unit}
        </div>
      `).join("")}

      <button onclick="markDelivered(${group.supplier_id})"
              class="main-btn small-btn"
      >Заказ пришёл</button>
    </div>
  `).join("");
}

async function markDelivered(supplier_id){
  try{
    await api(`/api/my-orders/${supplier_id}/delivered`, "POST");
    await loadOrders();
    await loadProducts();
  }catch(e){
    alert(e.message);
  }
}

/* ===================================================== */
/* INIT */
/* ===================================================== */

loadProducts();
loadOrders();
