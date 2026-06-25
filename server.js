'use strict';
const express  = require('express');
const session  = require('express-session');
const bcrypt   = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const path     = require('path');
const fs       = require('fs');

// ─── Database setup ───────────────────────────────────────────────────────────
// DB_PATH env var lets Railway (or any host) point to a persistent volume
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'gg-data.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA foreign_keys=ON');

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS migrations (
    name TEXT PRIMARY KEY,
    ran_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    data    TEXT NOT NULL,
    expires INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    name          TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'client',
    color         TEXT    NOT NULL DEFAULT '#C9A84C',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS budget (
    client_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    weekly_income REAL   NOT NULL DEFAULT 0,
    fixed_pct    REAL    NOT NULL DEFAULT 50,
    wants_pct    REAL    NOT NULL DEFAULT 25,
    savings_pct  REAL    NOT NULL DEFAULT 10,
    debt_pct     REAL    NOT NULL DEFAULT 15
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    description TEXT   NOT NULL,
    amount     REAL    NOT NULL,
    category   TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS fixed_expenses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    amount     REAL    NOT NULL,
    due_day    TEXT    NOT NULL DEFAULT '1st',
    paid       INTEGER NOT NULL DEFAULT 0,
    paid_date  TEXT
  );

  CREATE TABLE IF NOT EXISTS debts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    type       TEXT    NOT NULL DEFAULT 'Debt',
    balance    REAL    NOT NULL,
    paid       REAL    NOT NULL DEFAULT 0,
    min_payment REAL   NOT NULL DEFAULT 0,
    paid_off   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS debt_payments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    debt_id      INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
    client_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount       REAL    NOT NULL,
    payment_type TEXT    NOT NULL DEFAULT 'custom',
    paid_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS savings_goals (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT    NOT NULL,
    goal_amount    REAL    NOT NULL,
    current_amount REAL    NOT NULL DEFAULT 0,
    weekly_contrib REAL    NOT NULL DEFAULT 0,
    complete       INTEGER NOT NULL DEFAULT 0,
    is_emergency   INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS streaks (
    client_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    logged_streak   INTEGER NOT NULL DEFAULT 0,
    on_track_streak INTEGER NOT NULL DEFAULT 0,
    last_log_date   TEXT
  );
`);

// ─── Seed data ────────────────────────────────────────────────────────────────
function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count > 0) return;

  const coachHash  = bcrypt.hashSync('coach123', 10);
  const clientHash = bcrypt.hashSync('client123', 10);

  const coachId = db.prepare(
    `INSERT INTO users (username, password_hash, name, role, color) VALUES (?,?,?,?,?)`
  ).run('coach', coachHash, 'Gustavo & Greys', 'coach', '#C9A84C').lastInsertRowid;

  const clientId = db.prepare(
    `INSERT INTO users (username, password_hash, name, role, color) VALUES (?,?,?,?,?)`
  ).run('maria', clientHash, 'Maria', 'client', '#C97A2A').lastInsertRowid;

  db.prepare(`INSERT INTO budget (client_id, weekly_income, fixed_pct, wants_pct, savings_pct, debt_pct)
              VALUES (?,?,?,?,?,?)`).run(clientId, 1200, 50, 25, 10, 15);

  // Fixed expenses
  const fe = db.prepare(`INSERT INTO fixed_expenses (client_id, name, amount, due_day, paid) VALUES (?,?,?,?,?)`);
  fe.run(clientId, 'Mortgage',     950,  '1st',  1);
  fe.run(clientId, 'Electric Bill',120,  '10th', 0);
  fe.run(clientId, 'Car Payment',  385,  '15th', 1);
  fe.run(clientId, 'Phone Bill',   85,   '20th', 0);
  fe.run(clientId, 'Water Bill',   55,   '25th', 0);

  // Debts
  const de = db.prepare(`INSERT INTO debts (client_id, name, type, balance, paid, min_payment) VALUES (?,?,?,?,?,?)`);
  de.run(clientId, 'Store Card',    'Credit Card',   480,   320,  25);
  de.run(clientId, 'Medical Bill',  'Medical',       850,   200,  50);
  de.run(clientId, 'Personal Loan', 'Personal Loan', 2400,  600,  100);
  de.run(clientId, 'Car Loan',      'Auto Loan',     8500,  3200, 285);
  de.run(clientId, 'Student Loan',  'Student Loan',  14200, 1800, 180);

  // Emergency fund + savings goals
  const sg = db.prepare(`INSERT INTO savings_goals (client_id, name, goal_amount, current_amount, weekly_contrib, is_emergency) VALUES (?,?,?,?,?,?)`);
  sg.run(clientId, 'Emergency Fund', 1000, 320,  25, 1);
  sg.run(clientId, 'Vacation Fund',  2000, 450,  50, 0);
  sg.run(clientId, 'Car Down Payment', 5000, 1200, 100, 0);

  // Seed some expenses for this week
  const ex = db.prepare(`INSERT INTO expenses (client_id, description, amount, category, created_at) VALUES (?,?,?,?,datetime('now','localtime',?))`);
  ex.run(clientId, 'Coffee Shop',         6.75,   'wants',   '-1 days');
  ex.run(clientId, 'Savings Transfer',    64.00,  'savings', '-1 days');
  ex.run(clientId, 'Credit Card Payment', 149.00, 'debt',    '-1 days');
  ex.run(clientId, 'Mortgage',            950.00, 'fixed',   '-2 days');
  ex.run(clientId, 'Car Payment',         385.00, 'fixed',   '-2 days');
  ex.run(clientId, 'Target Shopping',     87.50,  'wants',   '0 days');

  // Streaks
  db.prepare(`INSERT INTO streaks (client_id, logged_streak, on_track_streak, last_log_date) VALUES (?,?,?,date('now','localtime'))`)
    .run(clientId, 7, 5);

  // Coach → client welcome message
  const msg = db.prepare(`INSERT INTO messages (from_id, to_id, text, created_at) VALUES (?,?,?,datetime('now','localtime',?))`);
  msg.run(coachId, clientId, "Welcome to G&G! 🌟 I'm so excited to coach you on your journey to financial freedom. Log your expenses every day and don't hesitate to message me anytime.", '-2 days');
  msg.run(coachId, clientId, 'Great job logging daily Maria! Watch the Wants spending this week 👀', '-1 days');
  msg.run(clientId, coachId, 'Thank you! The daily log really helps me stay aware.', '-1 days');

  console.log('✅ Seed data created');
  console.log('   Coach login:  username=coach    password=coach123');
  console.log('   Client login: username=maria    password=client123');
}

// ─── Migrations (safe to run multiple times) ──────────────────────────────────
try { db.exec("ALTER TABLE budget ADD COLUMN income_amount REAL DEFAULT 0"); } catch(e) {}
try { db.exec("ALTER TABLE budget ADD COLUMN income_frequency TEXT DEFAULT 'weekly'"); } catch(e) {}
try { db.exec("ALTER TABLE expenses ADD COLUMN goal_id INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE expenses ADD COLUMN debt_id INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE fixed_expenses ADD COLUMN paid_month TEXT"); } catch(e) {}
// ─── Column migrations (idempotent ALTER TABLE) ───────────────────────────────
(function runColumnMigrations() {
  const add = (table, col, def) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch(e) { /* already exists */ }
  };
  add('messages', 'is_read',       'INTEGER NOT NULL DEFAULT 0');
  add('users',    'last_active',   'TEXT');
  add('budget',   'income_amount', 'REAL');
  add('budget',   'income_frequency', "TEXT NOT NULL DEFAULT 'weekly'");
})();

// One-time cleanup: remove expenses that were auto-posted when marking fixed bills as paid
try {
  const alreadyRan = db.prepare("SELECT 1 FROM migrations WHERE name='cleanup_fixed_autopost'").get();
  if (!alreadyRan) {
    db.exec(`
      DELETE FROM expenses
      WHERE category = 'fixed'
      AND EXISTS (
        SELECT 1 FROM fixed_expenses fe
        WHERE fe.client_id = expenses.client_id
        AND fe.name = expenses.description
      )
    `);
    db.exec("INSERT INTO migrations (name) VALUES ('cleanup_fixed_autopost')");
    console.log('✅ Cleaned up auto-posted fixed expense entries (one-time migration done)');
  }
} catch(e) { console.log('Migration note:', e.message); }
try { db.exec(`
  CREATE TABLE IF NOT EXISTS paychecks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount     REAL    NOT NULL,
    pay_date   TEXT    NOT NULL DEFAULT (date('now','localtime')),
    source     TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  )
`); } catch(e) {}

seedIfEmpty();

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── SQLite-backed session store (survives server restarts / Render sleep) ────
const SessionStore = session.Store;
class SQLiteSessionStore extends SessionStore {
  get(sid, cb) {
    try {
      const row = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (Date.now() > row.expires) {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      return cb(null, JSON.parse(row.data));
    } catch(e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const expires = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      db.prepare(`INSERT INTO sessions (sid, data, expires) VALUES (?,?,?)
        ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires=excluded.expires`)
        .run(sid, JSON.stringify(sess), expires);
      cb(null);
    } catch(e) { cb(e); }
  }
  destroy(sid, cb) {
    try { db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); cb(null); }
    catch(e) { cb(e); }
  }
  touch(sid, sess, cb) {
    try {
      const expires = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
      db.prepare('UPDATE sessions SET expires=? WHERE sid=?').run(expires, sid);
      cb(null);
    } catch(e) { cb(e); }
  }
}
// Clean up expired sessions on startup
try { db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()); } catch(e) {}

// Sessions stored in SQLite so they survive restarts / Render sleep cycles
app.use(session({
  store: new SQLiteSessionStore(),
  secret: 'gg-wealth-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
function requireCoach(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.role !== 'coach') return res.status(403).json({ error: 'Coach only' });
  next();
}

// Helper: get client_id — coaches can specify a clientId query param
function getClientId(req) {
  if (req.session.role === 'coach' && req.query.clientId) {
    return parseInt(req.query.clientId);
  }
  return req.session.userId;
}

// ─── Auth routes ─────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });

  const match = bcrypt.compareSync(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid username or password' });

  req.session.userId = user.id;
  req.session.role   = user.role;
  req.session.name   = user.name;

  // Stamp last_active on every login
  db.prepare("UPDATE users SET last_active = datetime('now','localtime') WHERE id = ?").run(user.id);

  res.json({
    id:   user.id,
    name: user.name,
    role: user.role,
    redirect: user.role === 'coach' ? '/gg-coach-dashboard.html' : '/gg-home.html'
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, name, role, color FROM users WHERE id = ?').get(req.session.userId);
  res.json(user);
});

// ─── Budget ───────────────────────────────────────────────────────────────────
app.get('/api/budget', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  let b = db.prepare('SELECT * FROM budget WHERE client_id = ?').get(clientId);
  if (!b) {
    db.prepare('INSERT INTO budget (client_id) VALUES (?)').run(clientId);
    b = db.prepare('SELECT * FROM budget WHERE client_id = ?').get(clientId);
  }
  res.json(b);
});

app.put('/api/budget', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const { weekly_income, income_amount, income_frequency, fixed_pct, wants_pct, savings_pct, debt_pct } = req.body;

  // Convert entered amount to weekly equivalent
  let weeklyIncome = parseFloat(weekly_income) || 0;
  let rawAmount    = parseFloat(income_amount)  || weeklyIncome;
  let freq         = income_frequency || 'weekly';

  if (income_amount != null) {
    const amt = parseFloat(income_amount) || 0;
    rawAmount = amt;
    if (freq === 'biweekly')  weeklyIncome = amt / 2;
    else if (freq === 'monthly') weeklyIncome = (amt * 12) / 52;
    else weeklyIncome = amt; // weekly
  }

  db.prepare(`
    INSERT INTO budget (client_id, weekly_income, income_amount, income_frequency, fixed_pct, wants_pct, savings_pct, debt_pct)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(client_id) DO UPDATE SET
      weekly_income    = excluded.weekly_income,
      income_amount    = excluded.income_amount,
      income_frequency = excluded.income_frequency,
      fixed_pct        = excluded.fixed_pct,
      wants_pct        = excluded.wants_pct,
      savings_pct      = excluded.savings_pct,
      debt_pct         = excluded.debt_pct
  `).run(clientId,
    weeklyIncome,
    rawAmount,
    freq,
    fixed_pct   ?? 50,
    wants_pct   ?? 25,
    savings_pct ?? 10,
    debt_pct    ?? 15
  );
  res.json({ ok: true });
});

// ─── Paychecks ────────────────────────────────────────────────────────────────
app.get('/api/paychecks', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const { month } = req.query; // optional YYYY-MM filter
  const prefix = month || new Date().toISOString().slice(0, 7); // default current month
  const rows = db.prepare(
    `SELECT * FROM paychecks WHERE client_id = ? AND pay_date LIKE ? ORDER BY pay_date DESC`
  ).all(clientId, prefix + '%');
  res.json(rows);
});

app.post('/api/paychecks', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const { amount, pay_date, source } = req.body;
  if (!amount || isNaN(parseFloat(amount))) return res.status(400).json({ error: 'Invalid amount' });
  const r = db.prepare(
    `INSERT INTO paychecks (client_id, amount, pay_date, source) VALUES (?,?,?,?)`
  ).run(clientId, parseFloat(amount), pay_date || new Date().toISOString().slice(0, 10), source || '');
  res.json({ id: r.lastInsertRowid, ok: true });
});

app.delete('/api/paychecks/:id', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const r = db.prepare('DELETE FROM paychecks WHERE id = ? AND client_id = ?').run(req.params.id, clientId);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ─── Expenses ─────────────────────────────────────────────────────────────────
app.get('/api/expenses', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const { since, until } = req.query;
  let sql = 'SELECT * FROM expenses WHERE client_id = ?';
  const params = [clientId];
  if (since) { sql += ' AND date(created_at) >= ?'; params.push(since); }
  if (until) { sql += ' AND date(created_at) <= ?'; params.push(until); }
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/expenses', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const { description, amount, category, goal_id, debt_id } = req.body;
  if (!description || !amount || !category) return res.status(400).json({ error: 'Missing fields' });
  const amt = parseFloat(amount);

  const r = db.prepare(
    `INSERT INTO expenses (client_id, description, amount, category, goal_id, debt_id) VALUES (?,?,?,?,?,?)`
  ).run(clientId, description, amt, category, goal_id || null, debt_id || null);

  // ── Auto-update savings goal ──────────────────────────────────────────────
  if (category === 'savings') {
    let gid = goal_id;
    if (!gid) {
      const goals = db.prepare(
        'SELECT * FROM savings_goals WHERE client_id = ? AND complete = 0'
      ).all(clientId);
      const desc = (description || '').toLowerCase();
      const match = goals.find(g =>
        desc.includes(g.name.toLowerCase()) || g.name.toLowerCase().includes(desc)
      );
      if (match) gid = match.id;
      else {
        const ef = goals.find(g => g.is_emergency);
        gid = (ef || goals[0])?.id;
      }
    }
    if (gid) {
      const g = db.prepare(
        'SELECT * FROM savings_goals WHERE id = ? AND client_id = ?'
      ).get(gid, clientId);
      if (g) {
        const newAmt = g.current_amount + amt;
        db.prepare(
          'UPDATE savings_goals SET current_amount = ?, complete = ? WHERE id = ?'
        ).run(newAmt, newAmt >= g.goal_amount ? 1 : 0, g.id);
      }
    }
  }

  // ── Auto-update debt balance ───────────────────────────────────────────────
  if (category === 'debt') {
    let did = debt_id;
    if (!did) {
      const debts = db.prepare(
        'SELECT * FROM debts WHERE client_id = ? AND paid_off = 0'
      ).all(clientId);
      const desc = (description || '').toLowerCase();
      const match = debts.find(d =>
        desc.includes(d.name.toLowerCase()) || d.name.toLowerCase().includes(desc)
      );
      if (match) did = match.id;
      else {
        // Snowball: smallest remaining balance first
        const sorted = debts.slice().sort((a,b) => (a.balance-a.paid)-(b.balance-b.paid));
        did = sorted[0]?.id;
      }
    }
    if (did) {
      const d = db.prepare(
        'SELECT * FROM debts WHERE id = ? AND client_id = ?'
      ).get(did, clientId);
      if (d) {
        const newPaid = d.paid + amt;
        db.prepare(
          'UPDATE debts SET paid = ?, paid_off = ? WHERE id = ?'
        ).run(newPaid, newPaid >= d.balance ? 1 : 0, d.id);
      }
    }
  }

  updateStreak(clientId);
  res.json({ id: r.lastInsertRowid, ok: true });
});

app.delete('/api/expenses/:id', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  // Read before deleting so we can reverse any auto-updates
  const exp = db.prepare('SELECT * FROM expenses WHERE id = ? AND client_id = ?').get(req.params.id, clientId);
  if (!exp) return res.status(404).json({ error: 'Not found' });

  // Reverse savings goal balance if this expense incremented it
  if (exp.category === 'savings' && exp.goal_id) {
    db.prepare('UPDATE savings_goals SET current_amount = MAX(0, current_amount - ?), complete = 0 WHERE id = ? AND client_id = ?')
      .run(exp.amount, exp.goal_id, clientId);
  } else if (exp.category === 'savings' && !exp.goal_id) {
    // Was auto-matched — try to find the goal it would have gone to and reverse it
    const goals = db.prepare('SELECT * FROM savings_goals WHERE client_id = ? ORDER BY is_emergency DESC, id ASC').all(clientId);
    const desc  = (exp.description || '').toLowerCase();
    const match = goals.find(g => desc.includes(g.name.toLowerCase()) || g.name.toLowerCase().includes(desc))
                || goals.find(g => g.is_emergency) || goals[0];
    if (match) {
      db.prepare('UPDATE savings_goals SET current_amount = MAX(0, current_amount - ?), complete = 0 WHERE id = ?')
        .run(exp.amount, match.id);
    }
  }

  // Reverse debt paid balance if this expense incremented it
  if (exp.category === 'debt' && exp.debt_id) {
    db.prepare('UPDATE debts SET paid = MAX(0, paid - ?), paid_off = 0 WHERE id = ? AND client_id = ?')
      .run(exp.amount, exp.debt_id, clientId);
  } else if (exp.category === 'debt' && !exp.debt_id) {
    // Was auto-matched — reverse the snowball target
    const debts  = db.prepare('SELECT * FROM debts WHERE client_id = ? AND paid_off = 0').all(clientId);
    const desc   = (exp.description || '').toLowerCase();
    const match  = debts.find(d => desc.includes(d.name.toLowerCase()) || d.name.toLowerCase().includes(desc))
                || debts.slice().sort((a,b) => (a.balance-a.paid)-(b.balance-b.paid))[0];
    if (match) {
      db.prepare('UPDATE debts SET paid = MAX(0, paid - ?), paid_off = 0 WHERE id = ?')
        .run(exp.amount, match.id);
    }
  }

  db.prepare('DELETE FROM expenses WHERE id = ? AND client_id = ?').run(req.params.id, clientId);
  res.json({ ok: true });
});

// ─── Fixed expenses ───────────────────────────────────────────────────────────
app.get('/api/fixed', requireAuth, (req, res) => {
  const clientId   = getClientId(req);
  const thisMonth  = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const rows = db.prepare('SELECT * FROM fixed_expenses WHERE client_id = ? ORDER BY id').all(clientId);
  // is_paid = true only if paid this calendar month
  res.json(rows.map(r => ({ ...r, is_paid: r.paid_month === thisMonth ? 1 : 0 })));
});

app.post('/api/fixed', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const { name, amount, due_day } = req.body;
  if (!name || !amount) return res.status(400).json({ error: 'Missing fields' });
  const r = db.prepare(
    `INSERT INTO fixed_expenses (client_id, name, amount, due_day) VALUES (?,?,?,?)`
  ).run(clientId, name, parseFloat(amount), due_day || '1st');
  res.json({ id: r.lastInsertRowid, ok: true });
});

app.put('/api/fixed/:id', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const { name, amount, due_day, paid } = req.body;
  const existing = db.prepare('SELECT * FROM fixed_expenses WHERE id = ? AND client_id = ?').get(req.params.id, clientId);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const thisMonth   = new Date().toISOString().slice(0, 7);
  const newPaidMonth = paid != null
    ? (paid ? thisMonth : null)
    : existing.paid_month;

  db.prepare(`
    UPDATE fixed_expenses SET name=?, amount=?, due_day=?, paid=?, paid_date=?, paid_month=?
    WHERE id = ? AND client_id = ?
  `).run(
    name    ?? existing.name,
    amount  != null ? parseFloat(amount) : existing.amount,
    due_day ?? existing.due_day,
    paid    != null ? (paid ? 1 : 0) : existing.paid,
    paid    != null ? (paid ? new Date().toISOString() : null) : existing.paid_date,
    newPaidMonth,
    req.params.id, clientId
  );

  // Streak update on pay (bills panel is separate from expense log)
  if (paid) updateStreak(clientId);

  res.json({ ok: true });
});

app.delete('/api/fixed/:id', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  db.prepare('DELETE FROM fixed_expenses WHERE id = ? AND client_id = ?').run(req.params.id, clientId);
  res.json({ ok: true });
});

// ─── Debts ────────────────────────────────────────────────────────────────────
app.get('/api/debts', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  res.json(db.prepare('SELECT * FROM debts WHERE client_id = ? ORDER BY (balance - paid) ASC, paid_off ASC').all(clientId));
});

app.post('/api/debts', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const { name, type, balance, paid, min_payment } = req.body;
  if (!name || !balance) return res.status(400).json({ error: 'Missing fields' });
  const r = db.prepare(
    `INSERT INTO debts (client_id, name, type, balance, paid, min_payment) VALUES (?,?,?,?,?,?)`
  ).run(clientId, name, type || 'Debt', parseFloat(balance), parseFloat(paid) || 0, parseFloat(min_payment) || 0);
  res.json({ id: r.lastInsertRowid, ok: true });
});

app.put('/api/debts/:id', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const { name, type, balance, paid, min_payment } = req.body;
  const existing = db.prepare('SELECT * FROM debts WHERE id = ? AND client_id = ?').get(req.params.id, clientId);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const newPaid    = paid    != null ? parseFloat(paid)    : existing.paid;
  const newBalance = balance != null ? parseFloat(balance) : existing.balance;
  const paidOff    = newPaid >= newBalance ? 1 : 0;

  db.prepare(`
    UPDATE debts SET name=?, type=?, balance=?, paid=?, min_payment=?, paid_off=?
    WHERE id = ? AND client_id = ?
  `).run(
    name ?? existing.name,
    type ?? existing.type,
    newBalance,
    newPaid,
    min_payment != null ? parseFloat(min_payment) : existing.min_payment,
    paidOff,
    req.params.id, clientId
  );
  res.json({ ok: true, paid_off: !!paidOff });
});

app.delete('/api/debts/:id', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  db.prepare('DELETE FROM debts WHERE id = ? AND client_id = ?').run(req.params.id, clientId);
  res.json({ ok: true });
});

// Log a payment (records history, updates paid amount)
app.post('/api/debts/:id/payments', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const existing = db.prepare('SELECT * FROM debts WHERE id = ? AND client_id = ?').get(req.params.id, clientId);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const amount = parseFloat(req.body.amount);
  const payment_type = req.body.payment_type || 'custom';
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const newPaid  = Math.min(existing.balance, existing.paid + amount);
  const paidOff  = newPaid >= existing.balance ? 1 : 0;
  db.prepare('UPDATE debts SET paid = ?, paid_off = ? WHERE id = ? AND client_id = ?').run(newPaid, paidOff, req.params.id, clientId);
  db.prepare('INSERT INTO debt_payments (debt_id, client_id, amount, payment_type) VALUES (?,?,?,?)').run(req.params.id, clientId, amount, payment_type);
  res.json({ ok: true, paid_off: !!paidOff, new_paid: newPaid });
});

// Get payment history for a debt
app.get('/api/debts/:id/payments', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const rows = db.prepare('SELECT * FROM debt_payments WHERE debt_id = ? AND client_id = ? ORDER BY paid_at DESC').all(req.params.id, clientId);
  res.json(rows);
});

// Reverse (delete) a single payment
app.delete('/api/debt_payments/:id', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const payment = db.prepare('SELECT * FROM debt_payments WHERE id = ? AND client_id = ?').get(req.params.id, clientId);
  if (!payment) return res.status(404).json({ error: 'Not found' });
  const debt = db.prepare('SELECT * FROM debts WHERE id = ? AND client_id = ?').get(payment.debt_id, clientId);
  if (!debt) return res.status(404).json({ error: 'Debt not found' });
  const newPaid = Math.max(0, debt.paid - payment.amount);
  const paidOff = newPaid >= debt.balance ? 1 : 0;
  db.prepare('UPDATE debts SET paid = ?, paid_off = ? WHERE id = ?').run(newPaid, paidOff, payment.debt_id);
  db.prepare('DELETE FROM debt_payments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Savings goals ────────────────────────────────────────────────────────────
app.get('/api/savings', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  res.json(db.prepare('SELECT * FROM savings_goals WHERE client_id = ? ORDER BY is_emergency DESC, id ASC').all(clientId));
});

app.post('/api/savings', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const { name, goal_amount, current_amount, weekly_contrib, is_emergency } = req.body;
  if (!name || !goal_amount) return res.status(400).json({ error: 'Missing fields' });
  const r = db.prepare(
    `INSERT INTO savings_goals (client_id, name, goal_amount, current_amount, weekly_contrib, is_emergency) VALUES (?,?,?,?,?,?)`
  ).run(clientId, name, parseFloat(goal_amount), parseFloat(current_amount) || 0, parseFloat(weekly_contrib) || 0, is_emergency ? 1 : 0);
  res.json({ id: r.lastInsertRowid, ok: true });
});

app.put('/api/savings/:id', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const { name, goal_amount, current_amount, weekly_contrib } = req.body;
  const existing = db.prepare('SELECT * FROM savings_goals WHERE id = ? AND client_id = ?').get(req.params.id, clientId);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const newCurrent = current_amount != null ? parseFloat(current_amount) : existing.current_amount;
  const newGoal    = goal_amount    != null ? parseFloat(goal_amount)    : existing.goal_amount;
  const complete   = newCurrent >= newGoal ? 1 : 0;

  db.prepare(`
    UPDATE savings_goals SET name=?, goal_amount=?, current_amount=?, weekly_contrib=?, complete=?
    WHERE id = ? AND client_id = ?
  `).run(
    name           ?? existing.name,
    newGoal,
    newCurrent,
    weekly_contrib != null ? parseFloat(weekly_contrib) : existing.weekly_contrib,
    complete,
    req.params.id, clientId
  );
  res.json({ ok: true, complete: !!complete });
});

app.delete('/api/savings/:id', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  db.prepare('DELETE FROM savings_goals WHERE id = ? AND client_id = ?').run(req.params.id, clientId);
  res.json({ ok: true });
});

// ─── Messages ─────────────────────────────────────────────────────────────────
app.get('/api/messages', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { clientId } = req.query;

  let otherId;
  if (req.session.role === 'coach') {
    otherId = parseInt(clientId);
  } else {
    // Client: find their coach (first coach user)
    const coach = db.prepare("SELECT id FROM users WHERE role = 'coach' LIMIT 1").get();
    otherId = coach ? coach.id : null;
  }
  if (!otherId) return res.json([]);

  const msgs = db.prepare(`
    SELECT m.*, u.name as sender_name, u.role as sender_role
    FROM messages m JOIN users u ON u.id = m.from_id
    WHERE (m.from_id = ? AND m.to_id = ?)
       OR (m.from_id = ? AND m.to_id = ?)
    ORDER BY m.created_at ASC
  `).all(userId, otherId, otherId, userId);

  res.json(msgs);
});

app.post('/api/messages', requireAuth, (req, res) => {
  const fromId = req.session.userId;
  const { text } = req.body;
  const clientId = req.body.clientId || req.query.clientId;  // support both body and query-string
  if (!text?.trim()) return res.status(400).json({ error: 'Empty message' });

  let toId;
  if (req.session.role === 'coach') {
    toId = parseInt(clientId);
  } else {
    const coach = db.prepare("SELECT id FROM users WHERE role = 'coach' LIMIT 1").get();
    toId = coach ? coach.id : null;
  }
  if (!toId) return res.status(400).json({ error: 'No recipient' });

  const r = db.prepare("INSERT INTO messages (from_id, to_id, text, created_at) VALUES (?,?,?,datetime('now','localtime'))").run(fromId, toId, text.trim());
  const msg = db.prepare(`
    SELECT m.*, u.name as sender_name, u.role as sender_role
    FROM messages m JOIN users u ON u.id = m.from_id WHERE m.id = ?
  `).get(r.lastInsertRowid);
  res.json(msg);
});

// Mark messages from a specific client (or to a specific client) as read
// Coach calls this when they open a client's detail view
app.put('/api/messages/read-all', requireCoach, (req, res) => {
  const { clientId } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  // Mark all messages sent by this client as read
  db.prepare('UPDATE messages SET is_read = 1 WHERE from_id = ? AND is_read = 0').run(parseInt(clientId));
  res.json({ ok: true });
});

// ─── Streaks ──────────────────────────────────────────────────────────────────
app.get('/api/streaks', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  let s = db.prepare('SELECT * FROM streaks WHERE client_id = ?').get(clientId);
  if (!s) {
    db.prepare('INSERT INTO streaks (client_id) VALUES (?)').run(clientId);
    s = db.prepare('SELECT * FROM streaks WHERE client_id = ?').get(clientId);
  }
  res.json(s);
});

function updateStreak(clientId) {
  const today = new Date().toISOString().slice(0,10);
  let s = db.prepare('SELECT * FROM streaks WHERE client_id = ?').get(clientId);

  // Determine if user is on-track: total spending this month ≤ monthly projected budget
  const budget     = db.prepare('SELECT * FROM budget WHERE client_id = ?').get(clientId);
  const monthStart = today.slice(0, 7) + '-01';
  const monthSpent = (db.prepare(
    'SELECT COALESCE(SUM(amount),0) as t FROM expenses WHERE client_id = ? AND date(created_at) >= ?'
  ).get(clientId, monthStart) || {}).t || 0;
  const rawAmt  = (budget && budget.income_amount) || (budget && budget.weekly_income) || 0;
  const freq    = (budget && budget.income_frequency) || 'weekly';
  const monthly = freq === 'monthly' ? rawAmt : freq === 'biweekly' ? rawAmt * 2.17 : rawAmt * 4.33;
  const onTrack = monthly > 0 && monthSpent <= monthly;

  if (!s) {
    db.prepare('INSERT INTO streaks (client_id, logged_streak, on_track_streak, last_log_date) VALUES (?,1,?,?)').run(clientId, onTrack ? 1 : 0, today);
    return;
  }
  if (s.last_log_date === today) {
    // Already logged today — just update on_track_streak status
    db.prepare('UPDATE streaks SET on_track_streak=? WHERE client_id=?').run(onTrack ? s.on_track_streak : 0, clientId);
    return;
  }
  const yesterday  = new Date(Date.now() - 86400000).toISOString().slice(0,10);
  const newLogged  = s.last_log_date === yesterday ? s.logged_streak + 1 : 1;
  const newOnTrack = onTrack ? (s.last_log_date === yesterday ? s.on_track_streak + 1 : 1) : 0;
  db.prepare('UPDATE streaks SET logged_streak=?, on_track_streak=?, last_log_date=? WHERE client_id=?')
    .run(newLogged, newOnTrack, today, clientId);
}

// ─── Coach: clients list ──────────────────────────────────────────────────────
app.get('/api/coach/clients', requireCoach, (req, res) => {
  const clients = db.prepare("SELECT id, username, name, color, last_active FROM users WHERE role = 'client' ORDER BY name").all();

  const result = clients.map(c => {
    const budget  = db.prepare('SELECT * FROM budget WHERE client_id = ?').get(c.id) || { weekly_income: 0, fixed_pct: 50, wants_pct: 25, savings_pct: 10, debt_pct: 15 };
    const streaks = db.prepare('SELECT * FROM streaks WHERE client_id = ?').get(c.id) || { logged_streak: 0, on_track_streak: 0 };

    // Monthly projected income — same formula as client home page
    const rawAmt = budget.income_amount || budget.weekly_income || 0;
    const freq   = budget.income_frequency || 'weekly';
    const totalBudget = freq === 'monthly'   ? rawAmt
                      : freq === 'biweekly'  ? rawAmt * 2.17
                      :                        rawAmt * 4.33; // weekly default

    // Month-to-date expenses — same window as client home page
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);

    const expenses = db.prepare('SELECT * FROM expenses WHERE client_id = ? AND date(created_at) >= ?').all(c.id, monthStart);
    const totalSpent = expenses.reduce((s,e) => s+e.amount, 0);

    const spentBycat = { fixed: 0, wants: 0, savings: 0, debt: 0 };
    expenses.forEach(e => { if (spentBycat[e.category] != null) spentBycat[e.category] += e.amount; });

    const budgetByCat = {
      fixed:   (budget.fixed_pct   / 100) * totalBudget,
      wants:   (budget.wants_pct   / 100) * totalBudget,
      savings: (budget.savings_pct / 100) * totalBudget,
      debt:    (budget.debt_pct    / 100) * totalBudget,
    };

    let overCount = 0;
    Object.keys(spentBycat).forEach(k => { if (spentBycat[k] > budgetByCat[k]) overCount++; });

    const status = overCount >= 2 || totalSpent > totalBudget * 1.05 ? 'over'
                 : overCount === 1 || totalSpent > totalBudget * 0.9  ? 'risk'
                 : 'good';

    // Unread = any message from client that hasn't been marked read yet
    const unreadCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM messages WHERE from_id = ? AND is_read = 0'
    ).get(c.id).cnt;
    const unread = unreadCount > 0;

    const recentActivity = db.prepare(
      'SELECT * FROM expenses WHERE client_id = ? ORDER BY created_at DESC LIMIT 5'
    ).all(c.id);

    const notes = db.prepare(`
      SELECT m.*, u.role as sender_role FROM messages m
      JOIN users u ON u.id = m.from_id
      WHERE (from_id=? OR to_id=?)
      ORDER BY created_at DESC LIMIT 10
    `).all(c.id, c.id).reverse();

    const topDebt = db.prepare(
      'SELECT * FROM debts WHERE client_id = ? AND paid_off = 0 ORDER BY (balance-paid) ASC LIMIT 1'
    ).get(c.id);

    const totalSaved = db.prepare(
      'SELECT COALESCE(SUM(current_amount),0) as t FROM savings_goals WHERE client_id = ?'
    ).get(c.id).t;

    return {
      ...c,
      status,
      budget:      totalBudget,
      spent:       totalSpent,
      saved:       totalSaved,
      streak:      streaks.logged_streak,
      on_track:    streaks.on_track_streak,
      unread,
      unread_count: unreadCount,
      last_active: c.last_active || null,
      cats: [
        { n:'Fixed',   s: spentBycat.fixed,   b: budgetByCat.fixed,   c:'#C97A2A' },
        { n:'Wants',   s: spentBycat.wants,   b: budgetByCat.wants,   c:'#C8B48A' },
        { n:'Savings', s: spentBycat.savings, b: budgetByCat.savings, c:'#1A5C2E' },
        { n:'Debt',    s: spentBycat.debt,    b: budgetByCat.debt,    c:'#8B1A1A' },
      ],
      activity: recentActivity,
      notes,
      topDebt,
    };
  });

  res.json(result);
});

app.post('/api/coach/clients', requireCoach, (req, res) => {
  const { name, username, password, income_amount, income_frequency } = req.body;
  if (!name || !username || !password) return res.status(400).json({ error: 'Missing fields' });
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Username already taken' });
  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare(
    `INSERT INTO users (username, password_hash, name, role) VALUES (?,?,?,'client')`
  ).run(username.toLowerCase(), hash, name);

  // Save income if provided
  const amt  = parseFloat(income_amount) || 0;
  const freq = income_frequency || 'weekly';
  const weeklyEquiv = freq === 'monthly' ? (amt * 12) / 52
                    : freq === 'biweekly' ? amt / 2
                    : amt;
  db.prepare(`
    INSERT INTO budget (client_id, weekly_income, income_amount, income_frequency)
    VALUES (?, ?, ?, ?)
  `).run(r.lastInsertRowid, weeklyEquiv, amt, freq);

  db.prepare(`INSERT INTO savings_goals (client_id, name, goal_amount, current_amount, weekly_contrib, is_emergency) VALUES (?,'Emergency Fund',1000,0,25,1)`)
    .run(r.lastInsertRowid);
  res.json({ id: r.lastInsertRowid, ok: true });
});

app.delete('/api/coach/clients/:id', requireCoach, (req, res) => {
  db.prepare("DELETE FROM users WHERE id = ? AND role = 'client'").run(req.params.id);
  res.json({ ok: true });
});

// Reset a client's password (coach only)
app.put('/api/coach/clients/:id/password', requireCoach, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare("UPDATE users SET password_hash=? WHERE id=? AND role='client'").run(hash, req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Client not found' });
  res.json({ ok: true });
});

// Change own password (any logged-in user)
app.put('/api/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Missing fields' });
  if (new_password.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.session.userId);
  res.json({ ok: true });
});

// ─── Summary / analytics ──────────────────────────────────────────────────────
app.get('/api/summary', requireAuth, (req, res) => {
  const clientId = getClientId(req);
  const { period } = req.query; // 'week' | 'month' | 'quarter'

  const now = new Date();
  let since;
  if (period === 'month') {
    since = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
  } else if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    since = new Date(now.getFullYear(), q * 3, 1).toISOString().slice(0,10);
  } else {
    // week (default)
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay());
    since = d.toISOString().slice(0,10);
  }

  const expenses  = db.prepare('SELECT * FROM expenses WHERE client_id = ? AND date(created_at) >= ? ORDER BY created_at').all(clientId, since);
  const budget    = db.prepare('SELECT * FROM budget WHERE client_id = ?').get(clientId) || { weekly_income: 0, fixed_pct: 50, wants_pct: 25, savings_pct: 10, debt_pct: 15 };
  const streaks   = db.prepare('SELECT * FROM streaks WHERE client_id = ?').get(clientId) || { logged_streak: 0, on_track_streak: 0 };
  const debts     = db.prepare('SELECT * FROM debts WHERE client_id = ?').all(clientId);
  const savings   = db.prepare('SELECT * FROM savings_goals WHERE client_id = ?').all(clientId);

  res.json({ expenses, budget, streaks, debts, savings, since });
});

// ─── Root redirect ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.session.userId) {
    return res.redirect(req.session.role === 'coach' ? '/gg-coach-dashboard.html' : '/gg-home.html');
  }
  res.redirect('/gg-login.html');
});

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  // Find local network IP so phones on same WiFi can connect
  const os   = require('os');
  const nets = os.networkInterfaces();
  let localIP = null;
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) { localIP = addr.address; break; }
    }
    if (localIP) break;
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🟡  G&G Wealth Management');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  💻  Local:   http://localhost:${PORT}`);
  if (localIP) {
    console.log(`  📱  Network: http://${localIP}:${PORT}  ← use this on your phone`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});
