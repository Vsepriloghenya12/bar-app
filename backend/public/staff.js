// staff.js — с ручным вводом количества + всё остальное работает как раньше

const API = location.origin;
let PRODUCTS = [];
let DISABLED = new Set();
let cart = new Map();     // product_id → количество

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

// === Загрузка данных ===
async function loadEverything() {
  try {
    const [prodRes, ordersRes] = await Promise.all([
      api("/api/products"),
      api("/api/my-orders")
    ]);

    PRODUCTS = prodRes.products || [];

    DISABLED = new Set();
    (ordersRes.orders || []).forEach(group => {
      group.items.forEach(item => DISABLED.add(item.product_id));
    });

    renderCategories();
    renderActiveOrders(ordersRes.orders || []);
    updateTotal();
  } catch (e) {
    alert("Ошибка загрузки: " + e.message);
  }
}

// === Отрисовка категорий ===
function renderCategories() {
  const box = $("#category-list");
  const searchText = $("#search").value.toLowerCase().trim();

  const groups = {};
  PRODUCTS.forEach(p => {
    const cat = p.category || "Без категории";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  });

  let html = "";

  Object.keys(groups).sort().forEach(cat => {
    let items = groups[cat];
    if (searchText) {
      items = items.filter(p => p.name.toLowerCase().includes(searchText));
    }
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
              ${searchText ? `Ничего не найдено по «${$("#search").value}»` : "Нет товаров"}
            </div>`;
  }

  box.innerHTML = html;
}

// === Карточка товара (теперь с ручным вводом) ===
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
        
        <!-- Кликабельная цифра → превращается в input -->
        <span class="qty-number" onclick="startManualEdit(this, ${p.id})">${qty || 0}</span>
        
        <button onclick="changeQty(${p.id}, 1)">+</button>
      </div>
    </div>
  `;
}

// === Ручной ввод количества ===
function startManualEdit(spanEl, productId) {
  const currentQty = cart.get(productId) || 0;

  // Создаём input на месте цифры
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.value = currentQty;
  input.style.width = "50px";
  input.style.textAlign = "center";
  input.style.background = "#333";
  input.style.color = "white";
  input.style.border = "1px solid #ff8080";
  input.style.borderRadius = "6px";
  input.style.fontSize = "16px";

  // Заменяем span на input
  spanEl.parentNode.replaceChild(input, spanEl);

  // Фокус и выделение
  input.focus();
  input.select();

  // Сохраняем при потере фокуса или Enter
  const save = () => {
    let val = Number(input.value);
    if (isNaN(val) || val < 0) val = 0;
    if (val === 0) cart.delete(productId);
    else cart.set(productId, val);

    // Возвращаем обратно span
    const newSpan = document.createElement("span");
    newSpan.className = "qty-number";
    newSpan.textContent = val || 0;
    newSpan.onclick = () => startManualEdit(newSpan, productId);

    input.parentNode.replaceChild(newSpan, input);

    updateTotal();
  };

  input.onblur = save;
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      input.blur();
    }
  };
}

// === + и – (по 1 штуке) ===
function changeQty(id, delta) {
  const curr = cart.get(id) || 0;
  const newQty = Math.max(0, curr + delta);

  if (newQty === 0) cart.delete(id);
  else cart.set(id, newQty);

  // Обновляем только эту карточку
  const product = PRODUCTS.find(p => p.id === id);
  const card = document.querySelector(`.product-card[data-id="${id}"]`);
  if (card) {
    card.outerHTML = renderProductCard(product);
  }

  updateTotal();
}

// === Обновление счётчика в кнопке ===
function updateTotal() {
  let total = 0;
  cart.forEach(q => total += q);
  $("#total-items").textContent = total;
}

// === Аккордеон ===
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

// === Поиск ===
$("#search").addEventListener("input", () => renderCategories());

// === Отправка заявки ===
$("#send-btn").onclick = async () => {
  if (cart.size === 0) return alert("Вы ничего не выбрали");

  const items = Array.from(cart.entries()).map(([product_id, qty]) => ({
    product_id,
    qty
  }));

  try {
    await api("/api/requisitions", "POST", { items });
    alert("Заявка отправлена!");
    cart.clear();
    updateTotal();
    loadEverything();
    $("#search").value = "";
  } catch (e) {
    alert("Ошибка: " + e.message);
  }
};

// === Активные заказы ===
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

async function delivered(id) {
  if (!confirm("Отметить как получено?")) return;
  await api(`/api/my-orders/${id}/delivered`, "POST");
  loadEverything();
}

// === Старт ===
if (window.Telegram?.WebApp) {
  Telegram.WebApp.ready();
  Telegram.WebApp.expand();
}

loadEverything();