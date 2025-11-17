'use strict';

/* ================== Imports & setup ================== */
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

/* ---------------- SECURITY / BASIC ------------------ */
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

/* --------------------- CORS FIX ---------------------- */
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-TG-INIT-DATA'],
  exposedHeaders: ['Content-Type'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-TG-INIT-DATA');
  res.status(204).end();
});

/* ===================================================== */
/* ================ DATABASE BOOTSTRAP ================== */
/* ===================================================== */

let db;
let migrate = () => {};

async function loadDb() {
  try { ({ db, migrate } = require('./db')); return; }
  catch (e1) {
    try {
      const mod = await import(pathToFileURL(path.resolve(__dirname, './db.js')).href);
      db = mod.db || (mod.default && mod.default.db);
      migrate = mod.migrate || (mod.default && mod.default.migrate) || (() => {});
      if (db) return;
    } catch (e2) {}
  }

  const Database = require('better-sqlite3');
  const file = process.env.SQLITE_PATH || path.resolve(__dirname, '../data.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  db = new Database(file);
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      tg_user_id TEXT PRIMARY KEY,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'staff'
    );

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
      category TEXT,
      supplier_id INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS requisitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS requisition_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requisition_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty_requested REAL NOT NULL,
      FOREIGN KEY (requisition_id) REFERENCES requisitions(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requisition_id INTEGER NOT NULL,
      supplier_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (requisition_id) REFERENCES requisitions(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      qty_requested REAL NOT NULL,
      qty_final REAL NOT NULL,
      note TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT,
      entity_id INTEGER,
      action TEXT,
      user_id TEXT,
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/* ===================================================== */
/* ==================== SCHEMA FIX ===================== */
/* ===================================================== */

let REQ_USER_COL = 'user_id';
function ensureSchema() {
  const cols = db.prepare(`PRAGMA table_info('requisitions')`).all();
  const hasUserId = cols.some(c => c.name === 'user_id');
  const hasCreatedBy = cols.some(c => c.name === 'created_by');

  if (!hasUserId && !hasCreatedBy) {
    db.exec(`ALTER TABLE requisitions ADD COLUMN user_id TEXT;`);
    REQ_USER_COL = 'user_id';
  } else if (hasCreatedBy) {
    REQ_USER_COL = 'created_by';
  }
}

/* ===================================================== */
/* ==================== AUTH / TG ====================== */
/* ===================================================== */

const DEV_ALLOW_UNSAFE = String(process.env.DEV_ALLOW_UNSAFE || '').toLowerCase() === 'true';
const BOT_TOKEN = process.env.BOT_TOKEN || '';

function ensureUser(tgId, name, roleGuess = 'staff') {
  const get = db.prepare('SELECT tg_user_id, name, role FROM users WHERE tg_user_id = ?');
  let u = get.get(tgId);
  if (!u) {
    db.prepare('INSERT INTO users (tg_user_id, name, role) VALUES (?,?,?)')
      .run(tgId, name || '', roleGuess);
    u = get.get(tgId);
  }
  return u;
}

function verifyTelegramInitData(initData, botToken) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { ok: false, error: 'No hash' };

    const pairs = [];
    params.forEach((v, k) => { if (k !== 'hash') pairs.push(`${k}=${v}`); });
    pairs.sort();

    const check = pairs.join('\n');
    const key = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calc = crypto.createHmac('sha256', key).update(check).digest('hex');

    if (calc !== hash) return { ok: false, error: 'Bad hash' };

    return { ok: true, user: params.get('user') ? JSON.parse(params.get('user')) : null };

  } catch {
    return { ok: false, error: 'Invalid initData' };
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

function verifyInitData(req) {
  if (DEV_ALLOW_UNSAFE)
    return { ok: true, user: { id: 'dev', name: 'Dev User' } };

  if (!BOT_TOKEN)
    return { ok: false, error: 'Missing BOT_TOKEN' };

  const initData = pickInitData(req);
  if (!initData)
    return { ok: false, error: 'Missing initData' };

  return verifyTelegramInitData(initData, BOT_TOKEN);
}

function authMiddleware(req, res, next) {
  const v = verifyInitData(req);
  if (!v.ok)
    return res.status(401).json({ ok: false, error: v.error });

  const admins = String(process.env.ADMIN_TG_IDS || '').split(',').map(s => s.trim());
  const role = admins.includes(String(v.user.id)) ? 'admin' : 'staff';

  req.user = ensureUser(String(v.user.id), v.user.first_name || '', role);
  next();
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ ok: false, error: 'admin only' });
  next();
}

/* ===================================================== */
/* ==================== CATALOG API ==================== */
/* ===================================================== */

function registerCatalogRoutes(app) {

  /* -------- SUPPLIERS ---------- */

  app.get('/api/admin/suppliers', authMiddleware, adminOnly, (_req, res) => {
    try {
      const rows = db.prepare(`
        SELECT * FROM suppliers
        ORDER BY active DESC, name
      `).all();
      res.json({ ok: true, suppliers: rows });
    } catch (e) {
      res.status(500).json({ ok:false, error:String(e.message) });
    }
  });

  app.post('/api/admin/suppliers', authMiddleware, adminOnly, (req, res) => {
    try {
      const { name, contact_note='' } = req.body || {};
      if (!name || name.trim().length < 2)
        throw new Error('Название поставщика слишком короткое');

      const r = db.prepare(`
        INSERT INTO suppliers (name, contact_note, active)
        VALUES (?,?,1)
      `).run(name.trim(), contact_note);

      const row = db.prepare(`SELECT * FROM suppliers WHERE id=?`).get(r.lastInsertRowid);
      res.json({ ok: true, supplier: row });

    } catch (e) {
      res.status(400).json({ ok:false, error:String(e.message) });
    }
  });

  app.patch('/api/admin/suppliers/:id', authMiddleware, adminOnly, (req, res) => {
    try {
      const sid = Number(req.params.id);
      if (!Number.isFinite(sid)) throw new Error('bad id');

      const sup = db.prepare('SELECT * FROM suppliers WHERE id=?').get(sid);
      if (!sup) throw new Error('not found');

      const { name, contact_note, active } = req.body || {};

      const newName = name != null ? name.trim() : sup.name;
      if (newName.length < 2) throw new Error('Название слишком короткое');

      const newNote = contact_note != null ? contact_note : sup.contact_note;
      const newActive = active != null ? (active ? 1 : 0) : sup.active;

      db.prepare(`
        UPDATE suppliers SET name=?, contact_note=?, active=? WHERE id=?
      `).run(newName, newNote, newActive, sid);

      const row = db.prepare('SELECT * FROM suppliers WHERE id=?').get(sid);
      res.json({ ok:true, supplier:row });

    } catch (e) {
      res.status(400).json({ ok:false, error:String(e.message) });
    }
  });

  app.delete('/api/admin/suppliers/:id', authMiddleware, adminOnly, (req, res) => {
    try {
      const sid = Number(req.params.id);
      if (!Number.isFinite(sid)) throw new Error('bad id');

      const trx = db.transaction(id => {
        const prods = db.prepare(`SELECT id FROM products WHERE supplier_id=?`).all(id).map(x=>x.id);
        if (prods.length) {
          const qm = prods.map(()=>'?').join(',');
          db.prepare(`DELETE FROM requisition_items WHERE product_id IN (${qm})`).run(...prods);
          db.prepare(`DELETE FROM order_items WHERE product_id IN (${qm})`).run(...prods);
          db.prepare(`DELETE FROM products WHERE id IN (${qm})`).run(...prods);
        }

        const orders = db.prepare(`SELECT id FROM orders WHERE supplier_id=?`).all(id).map(x=>x.id);
        if (orders.length) {
          const qm = orders.map(()=>'?').join(',');
          db.prepare(`DELETE FROM order_items WHERE order_id IN (${qm})`).run(...orders);
          db.prepare(`DELETE FROM orders WHERE id IN (${qm})`).run(...orders);
        }

        db.prepare(`DELETE FROM suppliers WHERE id=?`).run(id);
      });

      trx(sid);
      res.json({ ok:true });

    } catch (e) {
      res.status(400).json({ ok:false, error:String(e.message) });
    }
  });

  /* -------- PRODUCTS ---------- */

  app.get('/api/admin/products', authMiddleware, adminOnly, (req,res)=>{
    try {
      const rows = db.prepare(`
        SELECT p.*, s.name AS supplier_name
        FROM products p
        JOIN suppliers s ON s.id = p.supplier_id
        ORDER BY p.active DESC, p.name
      `).all();
      res.json({ ok:true, products:rows });
    } catch(e){
      res.status(500).json({ ok:false, error:String(e.message) });
    }
  });

  app.post('/api/admin/products', authMiddleware, adminOnly, (req,res)=>{
    try {
      const { name, unit, category='Общее', supplier_id } = req.body || {};

      if (!name || name.trim().length < 2) throw new Error('Название товара слишком короткое');
      if (!unit) throw new Error('Ед. изм. обязательна');

      const sid = Number(supplier_id);
      if (!Number.isFinite(sid)) throw new Error('Некорректный supplier_id');

      const sup = db.prepare('SELECT id, active FROM suppliers WHERE id=?').get(sid);
      if (!sup) throw new Error('Поставщик не найден');
      if (sup.active === 0) throw new Error('Поставщик деактивирован');

      const r = db.prepare(`
        INSERT INTO products (name,unit,category,supplier_id,active)
        VALUES (?,?,?,?,1)
      `).run(name.trim(), unit.trim(), category.trim(), sid);

      const row = db.prepare(`SELECT * FROM products WHERE id=?`).get(r.lastInsertRowid);
      res.json({ ok:true, product:row });

    } catch(e){
      res.status(400).json({ ok:false, error:String(e.message) });
    }
  });

  app.patch('/api/admin/products/:id', authMiddleware, adminOnly, (req,res)=>{
    try {
      const pid = Number(req.params.id);
      if (!Number.isFinite(pid)) throw new Error('bad id');

      const prod = db.prepare(`SELECT * FROM products WHERE id=?`).get(pid);
      if (!prod) throw new Error('not found');

      const { name, unit, category, supplier_id, active } = req.body || {};

      const newName = name != null ? name.trim() : prod.name;
      if (newName.length < 2) throw new Error('Название слишком короткое');

      const newUnit = unit != null ? unit.trim() : prod.unit;
      const newCategory = category != null ? category.trim() : (prod.category || 'Общее');

      const newSupplier = supplier_id != null ? Number(supplier_id) : prod.supplier_id;
      if (!Number.isFinite(newSupplier)) throw new Error('bad supplier');

      const sup = db.prepare(`SELECT id FROM suppliers WHERE id=?`).get(newSupplier);
      if (!sup) throw new Error('Поставщик не найден');

      const newActive = active != null ? (active ? 1 : 0) : prod.active;

      db.prepare(`
        UPDATE products
        SET name=?, unit=?, category=?, supplier_id=?, active=?
        WHERE id=?
      `).run(newName, newUnit, newCategory, newSupplier, newActive, pid);

      const row = db.prepare(`SELECT * FROM products WHERE id=?`).get(pid);
      res.json({ ok:true, product:row });

    } catch(e){
      res.status(400).json({ ok:false, error:String(e.message) });
    }
  });

  app.delete('/api/admin/products/:id', authMiddleware, adminOnly, (req,res)=>{
    try {
      const pid = Number(req.params.id);
      if (!Number.isFinite(pid)) throw new Error('bad id');

      const trx = db.transaction(id=>{
        db.prepare(`DELETE FROM order_items WHERE product_id=?`).run(id);
        db.prepare(`DELETE FROM requisition_items WHERE product_id=?`).run(id);
        db.prepare(`DELETE FROM products WHERE id=?`).run(id);
      });

      trx(pid);
      res.json({ ok:true });

    } catch(e){
      res.status(400).json({ ok:false, error:String(e.message) });
    }
  });

  /* ------ Public Products for staff ------ */

  app.get('/api/products', authMiddleware, (req,res)=>{
    try {
      const rows = db.prepare(`
        SELECT p.id, p.name, p.unit, p.category,
               p.supplier_id, s.name AS supplier_name
        FROM products p
        JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.active = 1
        ORDER BY p.name
      `).all();
      res.json({ ok:true, products:rows });
    } catch (e){
      res.status(500).json({ ok:false, error:String(e.message) });
    }
  });

}

/* ===================================================== */
/* =================== REQUISITIONS ==================== */
/* ===================================================== */

function registerRequisitionRoutes(app) {

  app.post('/api/requisitions', authMiddleware, (req,res)=>{
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length===0)
      return res.status(400).json({ ok:false, error:'items required' });

    const trx = db.transaction(()=>{
      const col = REQ_USER_COL;

      const rReq = db.prepare(`
        INSERT INTO requisitions (${col},status)
        VALUES (?, 'created')
      `).run(req.user.tg_user_id);

      const reqId = Number(rReq.lastInsertRowid);

      const insReqItem = db.prepare(`INSERT INTO requisition_items (requisition_id,product_id,qty_requested) VALUES (?,?,?)`);
      const getProd = db.prepare(`SELECT id,supplier_id FROM products WHERE id=? AND active=1`);
      const insOrder = db.prepare(`INSERT INTO orders (requisition_id,supplier_id,status) VALUES (?, ?, 'draft')`);
      const insOrderItem = db.prepare(`INSERT INTO order_items (order_id,product_id,qty_requested,qty_final) VALUES (?,?,?,?)`);

      const orders = new Map();

      for(const it of items){
        const pid = Number(it.product_id);
        const qty = Number(it.qty);
        if (!Number.isFinite(pid) || !(qty>0))
          throw new Error('Bad item');

        const prod = getProd.get(pid);
        if (!prod) throw new Error(`Product ${pid} not found`);

        insReqItem.run(reqId, pid, qty);

        let oid = orders.get(prod.supplier_id);
        if (!oid){
          const r = insOrder.run(reqId, prod.supplier_id);
          oid = Number(r.lastInsertRowid);
          orders.set(prod.supplier_id, oid);
        }

        insOrderItem.run(oid, pid, qty, qty);
      }

      db.prepare(`UPDATE requisitions SET status='processed' WHERE id=?`).run(reqId);
      return reqId;
    });

    try {
      const id = trx();
      res.json({ ok:true, requisition_id:id });
    } catch(e){
      res.status(400).json({ ok:false, error:String(e.message) });
    }
  });

  app.get('/api/admin/requisitions', authMiddleware, adminOnly, (req,res)=>{
    try {
      const rows = db.prepare(`
        SELECT r.id, r.created_at, u.name AS user_name
        FROM requisitions r
        LEFT JOIN users u ON u.tg_user_id = r.${REQ_USER_COL}
        ORDER BY r.id DESC
        LIMIT 200
      `).all();
      res.json({ ok:true, requisitions:rows });
    } catch(e){
      res.status(500).json({ ok:false, error:String(e.message) });
    }
  });

  app.get('/api/admin/requisitions/:id', authMiddleware, adminOnly, (req,res)=>{
    try {
      const id = Number(req.params.id);

      const orders = db.prepare(`
        SELECT o.id AS order_id,
               s.id AS supplier_id,
               s.name AS supplier_name
        FROM orders o
        JOIN suppliers s ON s.id = o.supplier_id
        WHERE o.requisition_id=?
        ORDER BY s.name
      `).all(id);

      const items = db.prepare(`
        SELECT p.name AS product_name, p.unit,
               oi.qty_requested, oi.qty_final, oi.note
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id=?
        ORDER BY p.name
      `);

      res.json({
        ok:true,
        orders:orders.map(o=>({
          order_id:o.order_id,
          supplier:{ id:o.supplier_id, name:o.supplier_name },
          items:items.all(o.order_id)
        }))
      });

    } catch(e){
      res.status(500).json({ ok:false, error:String(e.message) });
    }
  });

}

/* ===================================================== */
/* ===================== /api/me ======================== */
/* ===================================================== */

app.get('/api/me', authMiddleware, (req,res)=>{
  res.json({
    ok:true,
    user:{
      id:req.user.tg_user_id,
      name:req.user.name,
      role:req.user.role
    }
  });
});

/* ===================================================== */
/* ===================== STATIC ========================= */
/* ===================================================== */
/*
  ВАЖНО: статика ДОЛЖНА БЫТЬ В САМОМ НИЗУ,
  чтобы не перехватывать маршруты /api
*/

const publicDir = path.join(__dirname, 'public');

app.use(express.static(publicDir));

app.get('/', (req,res)=> res.sendFile(path.join(publicDir, 'index.html')));
app.get(['/admin','/admin.html'], (req,res)=> res.sendFile(path.join(publicDir,'admin.html')));
app.get(['/staff','/staff.html'], (req,res)=> res.sendFile(path.join(publicDir,'staff.html')));

app.get('/favicon.ico', (_req,res)=> res.status(204).end());

/* ===================================================== */
/* ====================== START ========================= */
/* ===================================================== */

(async function start(){
  try{
    await loadDb();
    try { migrate(); } catch{}
    ensureSchema();
    registerCatalogRoutes(app);
    registerRequisitionRoutes(app);
    const port = Number(process.env.PORT || 8080);
    app.listen(port, ()=> console.log('API listening on', port));
  } catch(err){
    console.error('Fatal start error:', err);
    process.exit(1);
  }
})();
