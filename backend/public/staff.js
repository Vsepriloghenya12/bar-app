// staff.js — новый красивый с аккордеоном по категориям

const API = location.origin;
let PRODUCTS = [];        // все товары
let DISABLED = new Set(); // товары, которые уже в активных заказах
let cart = new Map();     // сколько сотрудник выбрал: product_id → количество

// ==== Вспомогательные функции ====
function $(s) { return document.querySelector(s); }
function $$(s) { return document.querySelectorAll(s); }

function getInit() {
  return new URLSearchParams(location.search).get("initData") || "";
}

async function api(url, method = "GET", data = null) {
  const headers = {
    "Content-Type": "application/json",
    "X-TG-INIT-DATA": getInit()
  };

  const opt = { method, headers };
  if (data) opt.body = JSON.stringify(data);

  const r = await fetch(url, opt);
  const j = await r.json();

  if (!r.ok || !j?.ok) throw new Error(j?.error || "Ошибка сети");
  return j;
}

// ==== Загрузка товаров и заказов ====
async function loadEverything() {
  try {
    const [prodRes, ordersRes] = await Promise.all([
      api("/api/products"),
      api("/api/my-orders")
    ]);

    PRODUCTS = prodRes.products;

    // Собираем, какие товары уже заказаны (чтобы отключить)
    DISABLED = new Set();
    ordersRes.orders.forEach(group => {
      group.items.forEach(item => DISABLED.add(item.product_id));
    });

    renderCategories();
    renderActiveOrders(ordersRes.orders);
    updateTotal();
  } catch (e) {
    alert("Ошибка загрузки: " + e.message);
  }
}

// ==== Рендер категорий с аккордеоном ====
function renderCategories() {
  const box = $("#category-list");
  const search = $("#search").value.toLowerCase().trim();

  // Группируем по категориям
  const groups = {};
  PRODUCTS.forEach(p => {
    if (!groups[p.category]) groups[p.category] = [];
    groups[p.category].push(p);
  });

  let html = "";

  Object.keys(groups).sort().forEach(cat => {
    const items = groups[cat];

    // Фильтр по поиску
    const filtered = search
      ? items.filter(p => p.name.toLowerCase().includes(search))
      : items;

    if (filtered.length === 0) return;

 Опять же, если хочешь — я сделаю так, чтобы категории тоже скрывались при пустом поиске.

    html += `
      <div class="category-accordion">
        <div class="accordion-header" onclick="toggle(this)">
          <span>${cat} (${filtered.length})</span>
          <span class="arrow">▶</span>
        </div>
        <div class="accordion-body">
          ${filtered.map(p => renderProduct(p)).join("")}
        </div>
      </div>
    `;
  });

  if (!html) html = `<div style="text-align:center;color:#888;padding:20px;">Товаров не найдено</div>`;
  box.innerHTML = html;
}

// Один товар
function renderProduct(p) {
  const disabled = DISABLED.has(p.id);
  const qty = cart.get(p.id) || 0;

  if (disabled) {
    return `
      <div class="product-card disabled">
        <div class="product-info">
          <b>${p.name}</b> (${p.unit})
          <small>${p.category}</small>
        </div>
        <div style="color:#ff8080;font-weight:bold;">Уже заказан</div>
      </div>
    `;
  }

  return `
    <div class="product-card" data-id="${p.id}">
      <div class="product-info">
        <b>${p.name}</b> (${p.unit})
        <small>${p.category}</small>
      </div>
      <div class="qty-controls">
        <button onclick="changeQty(${p.id}, -1)">–</button>
        <span>${qty}</span>
        <button onclick="changeQty(${p.id}, 1)">+</button>
      </div>
    </div>
  `;
}

// ==== Работа с количеством ====
function changeQty(id, delta) {
  const current = cart.get(id) || 0;
  const newQty = Math.max(0, current + delta);
  if (newQty === 0) cart.delete(id);
  else cart.set(id, newQty);

  // Перерисовываем только эту карточку
  const card = document.querySelector(`.product-card[data-id="${id}"]`);
  if (card) {
    const newCard = renderProduct(PRODUCTS.find(p => p.id === id));
    card.outerHTML = newCard;
  }

  updateTotal();
}

function updateTotal() {
  let total = 0;
  cart.forEach(q => total += q);
  $("#total-items").textContent = total;
}

// ==== Поиск в реальном времени ====
$("#search").addEventListener("input", () => renderCategories());

// ==== Аккордеон ====
function toggle(el) {
  const body = el.nextElementSibling;
  const arrow = el.querySelector(".arrow");
  if (body.classList.contains("open")) {
    body.classList.remove("open");
    arrow.textContent = "▶";
  } else {
    body.classList.add("open");
    arrow.textContent = "▼";
  }
}

// ==== Отправка заявки ====
$("#send-btn").onclick = async () => {
  if (cart.size === 0) return alert("Вы ничего не выбрали");

  const items = [];
  cart.forEach((qty, product_id) => {
    items.push({ product_id, qty });
  });

  try {
    await api("/api/requisitions", "POST", { items });
    alert("Заявка отправлена!");
    cart.clear();
    updateTotal();
    loadEverything(); // обновляем всё
    $("#search").value = "";
  } catch (e) {
    alert("Ошибка отправки: " + e.message);
  }
};

// ==== Активные заказы ====
function renderActiveOrders(orders) {
  const box = $("#active-orders");

  if (!orders || orders.length === 0) {
    box.innerHTML = "<div style='text-align:center;color:#888;padding:20px;'>Нет активных заказов</div>";
    return;
  }

  box.innerHTML = orders.map(g => `
    <div class="card">
      <h3>${g.supplier_name}</h3>
      ${g.items.map(it => `${it.name} — ${it.qty} ${it.unit}<br>`).join("")}
      <div style="margin-top:10px;">
        <button onclick="delivered(${g.supplier_id})" style="background:#4caf50;">
          Заказ пришёл ✓
        </button>
      </div>
    </div>
  `).join("");
}

async function delivered(supplier_id) {
  if (!confirm("Подтвердить получение заказа?")) return;
  await api(`/api/my-orders/${supplier_id}/delivered`, "POST");
  loadEverything();
}

// ==== Старт ====
if (window.Telegram?.WebApp) {
  Telegram.WebApp.ready();
  Telegram.WebApp.expand();
}

loadEverything();