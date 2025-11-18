// staff.js — РАБОЧАЯ ВЕРСИЯ с аккордеоном по категориям (исправлено 18.11.2025)

const API = location.origin;
let PRODUCTS = [];        // все товары из базы
let DISABLED = new Set(); // товары, которые уже в активных заказах (нельзя заказать повторно)
let cart = new Map();     // корзина: product_id → количество

// ==== Вспомогательные ====
function $(s) { return document.querySelector(s); }
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

// ==== Загрузка всего сразу ====
async function loadEverything() {
  try {
    const [prodRes, ordersRes] = await Promise.all([
      api("/api/products"),
      api("/api/my-orders")
    ]);

    PRODUCTS = prodRes.products || [];

    // Какие товары уже заказаны → отключим их
    DISABLED = new Set();
    (ordersRes.orders || []).forEach(group => {
      group.items.forEach(item => DISABLED.add(item.product_id));
    });

    renderCategories();
    renderActiveOrders(ordersRes.orders || []);
    updateTotal();
  } catch (e) {
    alert("Не удалось загрузить данные: " + e.message);
  }
}

// ==== Отрисовка категорий и товаров ====
function renderCategories() {
  const box = $("#category-list");
  const searchText = $("#search").value.toLowerCase().trim();

  // Группируем по категориям
  const groups = {};
  PRODUCTS.forEach(p => {
    const cat = p.category || "Без категории";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  });

  let html = "";

  // Сортируем категории по алфавиту
  Object.keys(groups).sort().forEach(cat => {
    let items = groups[cat];

    // Фильтр по поиску
    if (searchText) {
      items = items.filter(p => p.name.toLowerCase().includes(searchText));
    }

    // Если после фильтра ничего нет — пропускаем категорию
    if (items.length === 0) return;

    html += `
      <div class="category-accordion">
        <div class="accordion-header" onclick="toggleAccordion(this)">
          <span>${cat} <small style="color:#aaa">(${items.length})</small></span>
          <span class="arrow">▶</span>
        </div>
        <div class="accordion-body">
          ${items.map(p => renderProductCard(p)).join("")}
        </div>
      </div>
    `;
  });

  if (!html) {
    html = `<div style="text-align:center;color:#999;padding:30px 0;">
              ${searchText ? "Ничего не найдено по запросу «" + $("#search").value + "»" : "Нет товаров"}
            </div>`;
  }

  box.innerHTML = html;
}

// Одна карточка товара
function renderProductCard(p) {
  const isDisabled = DISABLED.has(p.id);
  const qty = cart.get(p.id) || 0;

  if (isDisabled) {
    return `
      <div class="product-card disabled">
        <div class="product-info">
          <b>${p.name}</b> (${p.unit})
          <small>${p.category || "—"}</small>
        </div>
        <div style="color:#ff6b6b;font-weight:bold;">Уже в заказе</div>
      </div>
    `;
  }

  return `
    <div class="product-card" data-id="${p.id}">
      <div class="product-info">
        <b>${p.name}</b> (${p.unit})
        <small>${p.category || "—"}</small>
      </div>
      <div class="qty-controls">
        <button onclick="changeQty(${p.id}, -1)">–</button>
        <span class="qty-number">${qty}</span>
        <button onclick="changeQty(${p.id}, 1)">+</button>
      </div>
    </div>
  `;
}

// ==== + и – ====
function changeQty(id, delta) {
  const curr = cart.get(id) || 0;
  const newQty = Math.max(0, curr + delta);

  if (newQty === 0) cart.delete(id);
  else cart.set(id, newQty);

  // Перерисовываем только эту карточку
  const card = document.querySelector(`.product-card[data-id="${id}"]`);
  if (card) {
    const product = PRODUCTS.find(p => p.id === id);
    card.outerHTML = renderProductCard(product);
  }

  updateTotal();
}

function updateTotal() {
  let total = 0;
  cart.forEach(q => total += q);
  $("#total-items").textContent = total;
}

// ==== Аккордеон (теперь работает идеально) ====
function toggleAccordion(header) {
  const body = header.nextElementSibling;
  const arrow = header.querySelector(".arrow");

  if (body.classList.contains("open")) {
    body.classList.remove("open");
    arrow.textContent = "▶";
  } else {
    body.classList.add("open");
    arrow.textContent = "▼";
  }
}

// ==== Поиск в реальном времени ====
$("#search").addEventListener("input", () => renderCategories());

// ==== Отправка заявки ====
$("#send-btn").onclick = async () => {
  if (cart.size === 0) return alert("Вы ничего не выбрали");

  const items = Array.from(cart.entries()).map(([product_id, qty]) => ({
    product_id,
    qty
  }));

  try {
    await api("/api/requisitions", "POST", { items });
    alert("Заявка успешно отправлена!");
    cart.clear();
    updateTotal();
    loadEverything(); // обновим список и активные заказы
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
      <div style="margin-top:12px;">
        <button onclick="delivered(${g.supplier_id})" style="background:#4caf50;padding:10px 16px;">
          Заказ пришёл ✓
        </button>
      </div>
    </div>
  `).join("");
}

async function delivered(supplier_id) {
  if (!confirm("Отметить заказ как полученный?")) return;
  try {
    await api(`/api/my-orders/${supplier_id}/delivered`, "POST");
    loadEverything();
  } catch (e) {
    alert("Ошибка: " + e.message);
  }
}

// ==== Старт ====
if (window.Telegram?.WebApp) {
  Telegram.WebApp.ready();
  Telegram.WebApp.expand();
}

// Первая загрузка
loadEverything();