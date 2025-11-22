"use strict";

/* ============================================================
    API helper
============================================================ */
async function api(path, method = "GET", data = null) {
    const opts = { method, headers: {} };

    // INIT DATA (Telegram / PWA fallback)
    const tg = window.Telegram?.WebApp;
    const init = tg?.initData || "";

    if (init) {
        opts.headers["X-TG-INIT-DATA"] = init;
    }

    if (data) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(data);
    }

    const res = await fetch(path, opts);
    return res.json().catch(() => ({ ok: false }));
}

/* ============================================================
    Загрузка товаров
============================================================ */
async function loadProducts() {
    const r = await api("/api/products");
    if (!r.ok) {
        document.getElementById("category-list").innerHTML =
            "<p class='muted'>Ошибка загрузки товаров</p>";
        return;
    }

    window.ALL_PRODUCTS = r.products;
    renderProductsByCategory(r.products);
}

/* ============================================================
    Рендер списка товаров по категориям
============================================================ */
function renderProductsByCategory(products) {
    const container = document.getElementById("category-list");
    container.innerHTML = "";

    const map = new Map();
    for (const p of products) {
        if (!map.has(p.category)) map.set(p.category, []);
        map.get(p.category).push(p);
    }

    for (const [category, items] of map.entries()) {
        const block = document.createElement("div");
        block.className = "accordion";

        const header = document.createElement("div");
        header.className = "accordion-header";
        header.innerHTML = `
            <span>${category}</span>
            <span class="arrow">▶</span>
        `;

        const body = document.createElement("div");
        body.className = "accordion-body";
        body.style.display = "none";

        header.onclick = () => {
            const isClosed = body.style.display === "none";
            body.style.display = isClosed ? "block" : "none";
            header.querySelector(".arrow").textContent = isClosed ? "▼" : "▶";
        };

        items.forEach(p => {
            const row = document.createElement("div");
            row.className = "product-row";

            row.innerHTML = `
                <span>${p.name} <span class="unit">(${p.unit})</span></span>
                <div class="qty-box">
                    <button class="qty-btn" data-minus="${p.id}">−</button>
                    <input id="qty-${p.id}" 
                           type="number" 
                           min="0"
                           class="qty-input"
                           inputmode="numeric">
                    <button class="qty-btn" data-plus="${p.id}">+</button>
                </div>
            `;

            body.appendChild(row);
        });

        block.appendChild(header);
        block.appendChild(body);
        container.appendChild(block);
    }
}

/* ============================================================
    Кнопки + / - для количества
============================================================ */
document.addEventListener("click", e => {
    if (e.target.matches("[data-plus]")) {
        const id = e.target.getAttribute("data-plus");
        const inp = document.getElementById(`qty-${id}`);
        inp.value = Number(inp.value || 0) + 1;
        updateTotalItems();
    }

    if (e.target.matches("[data-minus]")) {
        const id = e.target.getAttribute("data-minus");
        const inp = document.getElementById(`qty-${id}`);
        inp.value = Math.max(0, Number(inp.value || 0) - 1);
        updateTotalItems();
    }
});

/* ============================================================
    Ручной ввод количества — только цифры
============================================================ */
document.addEventListener("input", e => {
    if (e.target.classList.contains("qty-input")) {
        e.target.value = e.target.value.replace(/[^\d]/g, "");
        updateTotalItems();
    }
});

/* ============================================================
    Подсчёт количества товаров в кнопке
============================================================ */
function updateTotalItems() {
    let total = 0;
    document.querySelectorAll(".qty-input").forEach(inp => {
        total += Number(inp.value || 0);
    });
    document.getElementById("total-items").textContent = total;
}

/* ============================================================
    Поиск товаров
============================================================ */
document.getElementById("search")?.addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    const filtered = window.ALL_PRODUCTS.filter(p =>
        p.name.toLowerCase().includes(q)
    );
    renderProductsByCategory(filtered);
});

/* ============================================================
    Отправка заявки
============================================================ */
document.getElementById("send-btn").onclick = async () => {
    const items = [];

    document.querySelectorAll(".qty-input").forEach(inp => {
        const qty = Number(inp.value);
        if (qty > 0) {
            const id = Number(inp.id.replace("qty-", ""));
            items.push({ product_id: id, qty });
        }
    });

    if (items.length === 0) {
        return alert("Введите количество товаров");
    }

    const r = await api("/api/requisitions", "POST", { items });
    if (!r.ok) return alert("Ошибка: " + r.error);

    alert("Заявка отправлена!");

    updateTotalItems();
    loadActiveOrders();
    loadProducts(); // обновить товары
};

/* ============================================================
    Активные заказы
============================================================ */
async function loadActiveOrders() {
    const r = await api("/api/my-orders");
    const block = document.getElementById("active-orders");
    block.innerHTML = "";

    if (!r.ok || !r.orders.length) {
        block.innerHTML = "<p class='muted'>Активных заказов нет</p>";
        return;
    }

    r.orders.forEach(ord => {
        const div = document.createElement("div");
        div.className = "order-box";

        div.innerHTML = `
            <div class="order-head">
                <b>${ord.supplier_name}</b>
                <button class="delivered-btn" data-del="${ord.supplier_id}">
                    Пришло
                </button>
            </div>
        `;

        ord.items.forEach(it => {
            const row = document.createElement("div");
            row.className = "order-item";
            row.innerHTML = `${it.name} — ${it.qty} ${it.unit}`;
            div.appendChild(row);
        });

        block.appendChild(div);
    });
}

/* ============================================================
    Отметить поставку "Пришло"
============================================================ */
document.addEventListener("click", e => {
    if (e.target.matches("[data-del]")) {
        const sid = e.target.getAttribute("data-del");
        api(`/api/my-orders/${sid}/delivered`, "POST").then(r => {
            if (r.ok) loadActiveOrders();
        });
    }
});

/* ============================================================
    START
============================================================ */
loadProducts();
loadActiveOrders();
