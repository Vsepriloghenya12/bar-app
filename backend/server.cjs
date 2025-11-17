'use strict';

const dns = require('dns');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cors = require('cors');
const dotenv = require('dotenv');

dns.setDefaultResultOrder?.('ipv4first');
dotenv.config({ override: true });

const app = express();

/* ---------------- SECURITY ---------------- */
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

/* ---------------- CORS ---------------- */
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','X-TG-INIT-DATA']
}));

app.options('*', (req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, X-TG-INIT-DATA');
  res.status(204).end();
});

/* ===================================================== */
/* ==================== DATABASE ======================== */
/* ===================================================== */

let db;
let migrate = () => {};

async function loadDb() {
  try { ({ db, migrate } = require('./db')); return; }
  catch (e) {}

  const Database = require('better-sqlite3');
  const file = process.env.SQLITE_PATH || path.resolve(__dirname, '../data.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  db = new Database(file);
  db.pragma('foreign_keys = ON');

  /* === НОВАЯ СХЕМА ТАБЛИЦ === */
  db.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      contact_note TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      unit TEXT NOT NULL,
      category TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    /* МНОГО ПОСТАВЩИКОВ НА ОДИН ТОВАР */
    CREATE TABLE IF NOT EXISTS product_suppliers (
      product_id INTEGER NOT NULL,
      supplier_id INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(product_id, supplier_id),
      FOREIGN KEY(product_id) REFERENCES products(id),
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      tg_user_id TEXT PRIMARY KEY,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'staff'
    );

    CREATE TABLE IF NOT EXISTS requisitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS requisition_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requisition_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty_requested REAL NOT NULL,
      FOREIGN KEY(requisition_id) REFERENCES requisitions(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    /* orders теперь имеют статус */
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requisition_id INTEGER NOT NULL,
      supplier_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', 
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(requisition_id) REFERENCES requisitions(id),
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty_requested REAL NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    );
  `);
}
/* ===================================================== */
/* ==================== AUTH =========================== */
/* ===================================================== */

const DEV = String(process.env.DEV_ALLOW_UNSAFE||'').toLowerCase()==='true';
const BOT_TOKEN = process.env.BOT_TOKEN || '';

function verifyTelegramInitData(initData, botToken) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { ok:false, error:'No hash' };

    const pairs=[];
    params.forEach((v,k)=>{
      if (k!=='hash') pairs.push(`${k}=${v}`);
    });
    pairs.sort();

    const check = pairs.join('\n');
    const secret = crypto.createHmac('sha256','WebAppData')
      .update(botToken)
      .digest();
    const calc = crypto.createHmac('sha256', secret)
      .update(check)
      .digest('hex');

    if (calc !== hash) return { ok:false, error:'Bad hash' };

    const user = params.get('user')
      ? JSON.parse(params.get('user'))
      : null;

    return { ok:true, user };

  } catch {
    return { ok:false, error:'Invalid initData' };
  }
}

function pickInitData(req) {
  return (
    req.header('X-TG-INIT-DATA') ||
    req.body?.initData ||
    req.query?.initData ||
    ''
  );
}

function ensureUser(id,name,roleGuess) {
  let u = db.prepare(`SELECT * FROM users WHERE tg_user_id=?`).get(id);
  if (!u) {
    db.prepare(`
      INSERT INTO users (tg_user_id, name, role)
      VALUES (?,?,?)
    `).run(id,name||'',roleGuess);

    u = db.prepare(`SELECT * FROM users WHERE tg_user_id=?`).get(id);
  }
  return u;
}

function auth(req,res,next) {
  if (DEV) {
    req.user = ensureUser('dev','Dev User','admin');
    return next();
  }

  if (!BOT_TOKEN)
    return res.status(401).json({ ok:false, error:'Missing BOT_TOKEN' });

  const init = pickInitData(req);
  if (!init)
    return res.status(401).json({ ok:false, error:'Missing initData' });

  const v = verifyTelegramInitData(init, BOT_TOKEN);
  if (!v.ok)
    return res.status(401).json({ ok:false, error:v.error });

  const id = String(v.user.id);
  const admins = String(process.env.ADMIN_TG_IDS||'')
    .split(',')
    .map(s=>s.trim());

  const role = admins.includes(id) ? 'admin' : 'staff';

  req.user = ensureUser(id, v.user.first_name || '', role);
  next();
}

function admin(req,res,next) {
  if (req.user.role !== 'admin')
    return res.status(403).json({ ok:false, error:'admin only' });
  next();
}

/* ===================================================== */
/* ==================== HELPERS ========================= */
/* ===================================================== */

function getSuppliersForProduct(productId) {
  return db.prepare(`
    SELECT ps.supplier_id, s.name, ps.sort_order
    FROM product_suppliers ps
    JOIN suppliers s ON s.id = ps.supplier_id
    WHERE ps.product_id=?
    ORDER BY ps.sort_order ASC
  `).all(productId);
}

function getPrimarySupplier(productId) {
  return db.prepare(`
    SELECT supplier_id
    FROM product_suppliers
    WHERE product_id=?
    ORDER BY sort_order ASC
    LIMIT 1
  `).get(productId);
}

/* ===================================================== */
/* ==================== SUPPLIERS ======================= */
/* ===================================================== */

app.get('/api/admin/suppliers', auth, admin, (req,res)=>{
  const rows = db.prepare(`
    SELECT * FROM suppliers
    ORDER BY active DESC, name
  `).all();
  res.json({ ok:true, suppliers:rows });
});

app.post('/api/admin/suppliers', auth, admin, (req,res)=>{
  const { name, contact_note='' } = req.body||{};
  if (!name || name.trim().length<2)
    return res.status(400).json({ ok:false, error:'Name too short' });

  const r = db.prepare(`
    INSERT INTO suppliers (name, contact_note, active)
    VALUES (?,?,1)
  `).run(name.trim(), contact_note);

  const row = db.prepare(`SELECT * FROM suppliers WHERE id=?`)
    .get(r.lastInsertRowid);

  res.json({ ok:true, supplier:row });
});
/* ===================================================== */
/* ====================== PRODUCTS ====================== */
/* ===================================================== */

app.get('/api/admin/products', auth, admin, (req,res)=>{
  const rows = db.prepare(`
    SELECT * FROM products
    ORDER BY active DESC, name
  `).all();
  res.json({ ok:true, products:rows });
});

app.post('/api/admin/products', auth, admin, (req,res)=>{
  const { name, unit, category='Общее' } = req.body||{};

  if (!name || name.trim().length < 2)
    return res.status(400).json({ ok:false, error:'Название слишком короткое' });

  if (!unit)
    return res.status(400).json({ ok:false, error:'Ед. изм. обязательна' });

  const r = db.prepare(`
    INSERT INTO products (name, unit, category, active)
    VALUES (?,?,?,1)
  `).run(name.trim(), unit.trim(), category.trim());

  const row = db.prepare(`SELECT * FROM products WHERE id=?`)
    .get(r.lastInsertRowid);

  res.json({ ok:true, product:row });
});

app.patch('/api/admin/products/:id', auth, admin, (req,res)=>{
  const pid = Number(req.params.id);
  const p = db.prepare(`SELECT * FROM products WHERE id=?`).get(pid);

  if (!p) return res.status(404).json({ ok:false, error:'Товар не найден' });

  const { name, unit, category, active } = req.body||{};

  const newName = name!=null ? name.trim() : p.name;
  const newUnit = unit!=null ? unit.trim() : p.unit;
  const newCat  = category!=null ? category.trim() : p.category;
  const newActive = active!=null ? (active?1:0) : p.active;

  if (newName.length < 2)
    return res.status(400).json({ ok:false, error:'Название слишком короткое' });

  if (!newUnit)
    return res.status(400).json({ ok:false, error:'Ед. изм. обязательна' });

  db.prepare(`
    UPDATE products
    SET name=?, unit=?, category=?, active=?
    WHERE id=?
  `).run(newName, newUnit, newCat, newActive, pid);

  const updated = db.prepare(`SELECT * FROM products WHERE id=?`).get(pid);
  res.json({ ok:true, product:updated });
});

/* ===================================================== */
/* ========== PRODUCT → SUPPLIERS (многие-ко-многим) ===== */
/* ===================================================== */

app.get('/api/admin/products/:id/suppliers', auth, admin, (req,res)=>{
  const pid = Number(req.params.id);
  const rows = getSuppliersForProduct(pid);
  res.json({ ok:true, suppliers:rows });
});

app.post('/api/admin/products/:id/suppliers', auth, admin, (req,res)=>{
  const pid = Number(req.params.id);
  const sid = Number(req.body?.supplier_id);

  if (!Number.isFinite(sid))
    return res.status(400).json({ ok:false, error:'Некорректный supplier_id' });

  db.prepare(`
    INSERT OR IGNORE INTO product_suppliers (product_id, supplier_id, sort_order)
    VALUES (?,?,999)
  `).run(pid,sid);

  const list = getSuppliersForProduct(pid);
  if (list.length === 1) {
    db.prepare(`
      UPDATE product_suppliers SET sort_order=1
      WHERE product_id=? AND supplier_id=?
    `).run(pid,sid);
  }

  res.json({ ok:true });
});

app.delete('/api/admin/products/:id/suppliers/:sid', auth, admin, (req,res)=>{
  const pid = Number(req.params.id);
  const sid = Number(req.params.sid);

  db.prepare(`
    DELETE FROM product_suppliers
    WHERE product_id=? AND supplier_id=?
  `).run(pid,sid);

  const rows = getSuppliersForProduct(pid);
  rows.forEach((r,i)=>{
    db.prepare(`
      UPDATE product_suppliers SET sort_order=?
      WHERE product_id=? AND supplier_id=?
    `).run(i+1,pid,r.supplier_id);
  });

  res.json({ ok:true });
});

app.post('/api/admin/products/:id/set-primary/:sid', auth, admin, (req,res)=>{
  const pid = Number(req.params.id);
  const sid = Number(req.params.sid);

  const rows = getSuppliersForProduct(pid);

  rows.forEach(r=>{
    const newOrder = (r.supplier_id===sid ? 1 : r.sort_order+1);
    db.prepare(`
      UPDATE product_suppliers SET sort_order=?
      WHERE product_id=? AND supplier_id=?
    `).run(newOrder,pid,r.supplier_id);
  });

  res.json({ ok:true });
});
/* ===================================================== */
/* ==================== REQUISITIONS ==================== */
/* ===================================================== */

app.post('/api/requisitions', auth, (req,res)=>{
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok:false, error:'items required' });

  const trx = db.transaction(() => {
    const rReq = db.prepare(`
      INSERT INTO requisitions (user_id)
      VALUES (?)
    `).run(req.user.tg_user_id);

    const reqId = Number(rReq.lastInsertRowid);

    const insItem = db.prepare(`
      INSERT INTO requisition_items (requisition_id, product_id, qty_requested)
      VALUES (?,?,?)
    `);

    const insOrder = db.prepare(`
      INSERT INTO orders (requisition_id, supplier_id, status)
      VALUES (?,?, 'pending')
    `);

    const insOrdItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, qty_requested)
      VALUES (?,?,?)
    `);

    const orderMap = new Map();

    for (const it of items) {
      const pid = Number(it.product_id);
      const qty = Number(it.qty);

      if (!Number.isFinite(pid) || !(qty > 0))
        throw new Error('Bad item');

      const primary = getPrimarySupplier(pid);
      if (!primary)
        throw new Error(`Товар ID ${pid} не имеет ни одного поставщика`);

      const supplierId = primary.supplier_id;

      insItem.run(reqId, pid, qty);

      let orderId = orderMap.get(supplierId);
      if (!orderId) {
        const r = insOrder.run(reqId, supplierId);
        orderId = Number(r.lastInsertRowid);
        orderMap.set(supplierId, orderId);
      }

      insOrdItem.run(orderId, pid, qty);
    }

    return reqId;
  });

  try {
    const rid = trx();
    res.json({ ok:true, requisition_id:rid });
  } catch (e) {
    res.status(400).json({ ok:false, error:String(e.message) });
  }
});


/* ===================================================== */
/* ================ ADMIN VIEW OF REQUISITIONS ========= */
/* ===================================================== */

app.get('/api/admin/requisitions', auth, admin, (req,res)=>{
  const rows = db.prepare(`
    SELECT r.id, r.created_at, u.name AS user_name
    FROM requisitions r
    LEFT JOIN users u ON u.tg_user_id = r.user_id
    ORDER BY r.id DESC
    LIMIT 200
  `).all();

  res.json({ ok:true, requisitions:rows });
});

app.get('/api/admin/requisitions/:id', auth, admin, (req,res)=>{
  const id = Number(req.params.id);

  const orders = db.prepare(`
    SELECT o.id AS order_id,
           o.supplier_id,
           s.name AS supplier_name
    FROM orders o
    JOIN suppliers s ON s.id = o.supplier_id
    WHERE o.requisition_id=?
    ORDER BY s.name
  `).all(id);

  const itemsStmt = db.prepare(`
    SELECT oi.product_id, p.name AS product_name, p.unit, oi.qty_requested
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id=?
    ORDER BY p.name
  `);

  const result = orders.map(o => {
    const items = itemsStmt.all(o.order_id).map(it => {
      const alternatives = db.prepare(`
        SELECT s.name
        FROM product_suppliers ps
        JOIN suppliers s ON s.id=ps.supplier_id
        WHERE ps.product_id=? AND ps.supplier_id != ?
        ORDER BY ps.sort_order
      `).all(it.product_id, o.supplier_id);

      return {
        ...it,
        alternatives: alternatives.map(a => a.name)
      };
    });

    return { ...o, items };
  });

  res.json({ ok:true, orders:result });
});

/* ===================================================== */
/* ================ STAFF: ACTIVE MY-ORDERS ============= */
/* ===================================================== */

app.get('/api/my-orders', auth, (req,res)=>{
  const rows = db.prepare(`
    SELECT 
      o.id AS order_id,
      o.supplier_id,
      s.name AS supplier_name,
      o.status,
      ri.id AS ri_id,
      ri.product_id,
      p.name AS product_name,
      p.unit,
      oi.qty_requested
    FROM orders o
    JOIN suppliers s ON s.id=o.supplier_id
    JOIN order_items oi ON oi.order_id=o.id
    JOIN products p ON p.id=oi.product_id
    JOIN requisition_items ri ON ri.product_id=p.id 
    WHERE o.status='pending'
    ORDER BY s.name, p.name
  `).all();

  // Группировка по поставщику
  const map = new Map();

  for (const r of rows) {
    if (!map.has(r.supplier_id)) {
      map.set(r.supplier_id, {
        supplier_id: r.supplier_id,
        supplier_name: r.supplier_name,
        items: []
      });
    }
    map.get(r.supplier_id).items.push({
      product_id: r.product_id,
      name: r.product_name,
      unit: r.unit,
      qty: r.qty_requested
    });
  }

  res.json({ ok:true, orders: Array.from(map.values()) });
});

/* ===================================================== */
/* =========== STAFF: MARK ORDER AS DELIVERED =========== */
/* ===================================================== */

app.post('/api/my-orders/:supplier_id/delivered', auth, (req,res)=>{
  const sid = Number(req.params.supplier_id);
  if (!Number.isFinite(sid))
    return res.status(400).json({ ok:false, error:'bad supplier id' });

  db.prepare(`
    UPDATE orders SET status='delivered'
    WHERE supplier_id=? AND status='pending'
  `).run(sid);

  res.json({ ok:true });
});


/* ===================================================== */
/* ===================== STATIC ==========================*/
/* ===================================================== */

const publicDir = path.join(__dirname,'public');
app.use(express.static(publicDir));

app.get('/', (req,res)=> res.sendFile(path.join(publicDir,'index.html')));
app.get(['/admin','/admin.html'], (req,res)=> res.sendFile(path.join(publicDir,'admin.html')));
app.get(['/staff','/staff.html'], (req,res)=> res.sendFile(path.join(publicDir,'staff.html')));
app.get('/favicon.ico', (_req,res)=> res.status(204).end());


/* ===================================================== */
/* ====================== START ==========================*/
/* ===================================================== */

(async function start(){
  try{
    await loadDb();
    try { migrate(); } catch{}
    const port = Number(process.env.PORT || 8080);
    app.listen(port, ()=> console.log('API listening on', port));
  } catch(err){
    console.error('Fatal start error:', err);
    process.exit(1);
  }
})();
