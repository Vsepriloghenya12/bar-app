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

    /* ОСНОВНОЙ ПОСТАВЩИК ХРАНИМ ЗДЕСЬ */
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      unit TEXT NOT NULL,
      category TEXT NOT NULL,
      supplier_id INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
    );

    /* АЛЬТЕРНАТИВНЫЕ ПОСТАВЩИКИ */
    CREATE TABLE IF NOT EXISTS product_alternatives (
      product_id INTEGER NOT NULL,
      supplier_id INTEGER NOT NULL,
      PRIMARY KEY (product_id, supplier_id),
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
      status TEXT NOT NULL DEFAULT 'pending',  /* pending / delivered */
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

    const checkStr = pairs.join('\n');

    const secret = crypto
      .createHmac('sha256','WebAppData')
      .update(botToken)
      .digest();

    const calc = crypto
      .createHmac('sha256', secret)
      .update(checkStr)
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

  const userId = String(v.user.id);
  const admins = String(process.env.ADMIN_TG_IDS||'')
    .split(',')
    .map(s=>s.trim());

  const role = admins.includes(userId) ? 'admin' : 'staff';

  req.user = ensureUser(userId, v.user.first_name || '', role);
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

function getAlternativesForProduct(pid) {
  return db.prepare(`
    SELECT pa.supplier_id, s.name
    FROM product_alternatives pa
    JOIN suppliers s ON s.id = pa.supplier_id
    WHERE pa.product_id=?
    ORDER BY s.name
  `).all(pid);
}

/* ===================================================== */
/* ==================== SUPPLIERS ======================= */
/* ===================================================== */

app.get('/api/me', auth, (req,res)=>{
  console.log("DEBUG /api/me req.user =", req.user);

  res.json({
    ok:true,
    user:{
      id:req.user.tg_user_id,
      name:req.user.name,
      role:req.user.role
    }
  });
});

app.post('/api/admin/suppliers', auth, admin, (req,res)=>{
  try {
    console.log("SUPPLIER POST BODY =", req.body);

    const { name, contact_note = '' } = req.body || {};

    if (!name || name.trim().length < 2)
      return res.status(400).json({ ok:false, error:'Название короткое' });

    const r = db.prepare(`
      INSERT INTO suppliers (name, contact_note, active)
      VALUES (?,?,1)
    `).run(name.trim(), contact_note.trim());

    const row = db.prepare(`SELECT * FROM suppliers WHERE id=?`)
      .get(r.lastInsertRowid);

    return res.json({ ok:true, supplier: row });

  } catch(e) {
    console.error("SUPPLIER ADD ERROR:", e);
    return res.status(500).json({ ok:false, error:String(e.message || e) });
  }
});

/* ===================================================== */
/* ====================== PRODUCTS ====================== */
/* ===================================================== */

app.get('/api/admin/products', auth, admin, (req,res)=>{
  const rows = db.prepare(`
    SELECT p.*, s.name AS supplier_name
    FROM products p
    JOIN suppliers s ON s.id = p.supplier_id
    ORDER BY p.active DESC, p.name
  `).all();

  res.json({ ok:true, products: rows });
});

app.post('/api/admin/products', auth, admin, (req,res)=>{
  const { name, unit, category='Общее', supplier_id } = req.body || {};

  if (!name || name.trim().length < 2)
    return res.status(400).json({ ok:false, error:'Название слишком короткое' });

  if (!unit)
    return res.status(400).json({ ok:false, error:'Ед. изм. обязательна' });

  const sid = Number(supplier_id);
  if (!Number.isFinite(sid))
    return res.status(400).json({ ok:false, error:'Основной поставщик обязателен' });

  const sup = db.prepare(`SELECT id FROM suppliers WHERE id=?`).get(sid);
  if (!sup)
    return res.status(400).json({ ok:false, error:'Поставщик не найден' });

  const r = db.prepare(`
    INSERT INTO products (name,unit,category,supplier_id,active)
    VALUES (?,?,?,?,1)
  `).run(name.trim(), unit.trim(), category.trim(), sid);

  const row = db.prepare(`SELECT * FROM products WHERE id=?`)
    .get(r.lastInsertRowid);

  res.json({ ok:true, product: row });
});

app.patch('/api/admin/products/:id', auth, admin, (req,res)=>{
  const pid = Number(req.params.id);
  const p = db.prepare(`SELECT * FROM products WHERE id=?`).get(pid);

  if (!p) return res.status(404).json({ ok:false, error:'Товар не найден' });

  const { name, unit, category, supplier_id, active } = req.body || {};

  const newName = name!=null ? name.trim() : p.name;
  const newUnit = unit!=null ? unit.trim() : p.unit;
  const newCat  = category!=null ? category.trim() : p.category;
  const newSup  = supplier_id!=null ? Number(supplier_id) : p.supplier_id;
  const newAct  = active!=null ? (active?1:0) : p.active;

  if (!newName || newName.length < 2)
    return res.status(400).json({ ok:false, error:'Название слишком короткое' });

  if (!newUnit)
    return res.status(400).json({ ok:false, error:'Ед. изм. обязательна' });

  const sup = db.prepare(`SELECT id FROM suppliers WHERE id=?`).get(newSup);
  if (!sup)
    return res.status(400).json({ ok:false, error:'Поставщик не найден' });

  db.prepare(`
    UPDATE products
    SET name=?, unit=?, category=?, supplier_id=?, active=?
    WHERE id=?
  `).run(newName,newUnit,newCat,newSup,newAct,pid);

  const updated = db.prepare(`SELECT * FROM products WHERE id=?`).get(pid);
  res.json({ ok:true, product: updated });
});


/* ===================================================== */
/* ========== PRODUCT → ALTERNATIVE SUPPLIERS =========== */
/* ===================================================== */

app.get('/api/admin/products/:id/alternatives', auth, admin, (req,res)=>{
  const pid = Number(req.params.id);
  const rows = getAlternativesForProduct(pid);
  res.json({ ok:true, alternatives: rows });
});

app.post('/api/admin/products/:id/alternatives', auth, admin, (req,res)=>{
  const pid = Number(req.params.id);
  const sid = Number(req.body?.supplier_id);

  if (!Number.isFinite(pid) || !Number.isFinite(sid))
    return res.status(400).json({ ok:false, error:'bad id' });

  const exists = db.prepare(`
    SELECT 1 FROM suppliers WHERE id=?
  `).get(sid);

  if (!exists)
    return res.status(400).json({ ok:false, error:'Поставщик не найден' });

  db.prepare(`
    INSERT OR IGNORE INTO product_alternatives (product_id,supplier_id)
    VALUES (?,?)
  `).run(pid,sid);

  res.json({ ok:true });
});

app.delete('/api/admin/products/:id/alternatives/:sid', auth, admin, (req,res)=>{
  const pid = Number(req.params.id);
  const sid = Number(req.params.sid);

  db.prepare(`
    DELETE FROM product_alternatives
    WHERE product_id=? AND supplier_id=?
  `).run(pid,sid);

  res.json({ ok:true });
});
/* ===================================================== */
/* ======== PUBLIC PRODUCTS FOR STAFF (СПИСОК) ========= */
/* ===================================================== */

app.get('/api/products', auth, (req,res)=>{
  const rows = db.prepare(`
    SELECT id, name, unit, category, supplier_id, active
    FROM products
    WHERE active = 1
    ORDER BY name
  `).all();

  res.json({ ok:true, products: rows });
});


/* ===================================================== */
/* ================= CREATE REQUISITION ================= */
/* ===================================================== */

app.post('/api/requisitions', auth, (req,res)=>{
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok:false, error:'items required' });

  const trx = db.transaction(() => {

    // создаём заявку
    const rReq = db.prepare(`
      INSERT INTO requisitions (user_id)
      VALUES (?)
    `).run(req.user.tg_user_id);

    const reqId = Number(rReq.lastInsertRowid);

    const insReqItem = db.prepare(`
      INSERT INTO requisition_items (requisition_id,product_id,qty_requested)
      VALUES (?,?,?)
    `);

    const insOrder = db.prepare(`
      INSERT INTO orders (requisition_id,supplier_id,status)
      VALUES (?,?, 'pending')
    `);

    const insOrderItem = db.prepare(`
      INSERT INTO order_items (order_id,product_id,qty_requested)
      VALUES (?,?,?)
    `);

    const orderMap = new Map();

    for (const it of items) {
      const pid = Number(it.product_id);
      const qty = Number(it.qty);
      if (!Number.isFinite(pid) || !(qty > 0))
        throw new Error('Bad item');

      // определяем ОСНОВНОГО поставщика
      const prod = db.prepare(`
        SELECT supplier_id FROM products WHERE id=?
      `).get(pid);

      if (!prod)
        throw new Error(`Продукт ${pid} не найден`);

      const supplierId = prod.supplier_id;

      // добавляем строку в requisition_items
      insReqItem.run(reqId, pid, qty);

      // создаём order для поставщика, если его ещё нет
      let orderId = orderMap.get(supplierId);
      if (!orderId) {
        const rO = insOrder.run(reqId, supplierId);
        orderId = Number(rO.lastInsertRowid);
        orderMap.set(supplierId, orderId);
      }

      // добавляем товар в order_items
      insOrderItem.run(orderId, pid, qty);
    }

    return reqId;
  });

  try {
    const id = trx();
    res.json({ ok:true, requisition_id:id });
  } catch(e) {
    res.status(400).json({ ok:false, error:String(e.message) });
  }
});


/* ===================================================== */
/* ================= ADMIN: VIEW REQUISITION ============ */
/* ===================================================== */

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
    JOIN products p ON p.id=oi.product_id
    WHERE oi.order_id=?
    ORDER BY p.name
  `);

  const result = orders.map(o => {
    const items = itemsStmt.all(o.order_id).map(it => {
      // альтернативные поставщики
      const alt = db.prepare(`
        SELECT s.name
        FROM product_alternatives pa
        JOIN suppliers s ON s.id = pa.supplier_id
        WHERE pa.product_id=? 
      `).all(it.product_id);

      return {
        ...it,
        alternatives: alt.map(a=>a.name)
      };
    });

    return { ...o, items };
  });

  res.json({ ok:true, orders:result });
});
/* ===================================================== */
/* ================ STAFF: ACTIVE ORDERS ================ */
/* ===================================================== */

app.get('/api/my-orders', auth, (req,res)=>{
  const rows = db.prepare(`
    SELECT 
      o.id AS order_id,
      o.supplier_id,
      s.name AS supplier_name,
      o.status,
      p.id AS product_id,
      p.name AS product_name,
      p.unit AS unit,
      oi.qty_requested AS qty
    FROM orders o
    JOIN suppliers s ON s.id=o.supplier_id
    JOIN order_items oi ON oi.order_id=o.id
    JOIN products p ON p.id=oi.product_id
    WHERE o.status='pending'
    ORDER BY s.name, p.name
  `).all();

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
      qty: r.qty
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
    UPDATE orders
    SET status='delivered'
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
