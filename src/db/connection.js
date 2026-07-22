const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Determine database path:
// In production (packaged), use Electron's userData folder.
// In development, store next to the app source for easy access.
let dbPath;
try {
  const { app } = require('electron');
  dbPath = path.join(app.getPath('userData'), 'biometric_dtr.db');
} catch (_) {
  // Fallback for scripts run outside Electron (e.g. seed.js via node)
  dbPath = path.join(__dirname, '..', '..', 'biometric_dtr.db');
}

// Ensure the directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Auto-create tables if they don't exist ──────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS Teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    biometric_id INTEGER UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    device_password TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  )
`);

// Migration: add status column to existing Teachers table if it doesn't exist
try {
  const colCheck = db.prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('Teachers') WHERE name = 'status'").get();
  if (colCheck.cnt === 0) {
    db.exec("ALTER TABLE Teachers ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive'))");
    console.log('Migration: added status column to Teachers table');
  }
} catch (_migrationErr) {
  // Column already exists or table not yet created — safe to ignore
}

// Migration: add device_password column to existing Teachers table if it doesn't exist
try {
  const devicePwCheck = db.prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('Teachers') WHERE name = 'device_password'").get();
  if (devicePwCheck.cnt === 0) {
    db.exec("ALTER TABLE Teachers ADD COLUMN device_password TEXT NOT NULL DEFAULT ''");
    console.log('Migration: added device_password column to Teachers table');
  }
} catch (_migrationErr) {
  // Column already exists or table not yet created — safe to ignore
}

db.exec(`
  CREATE TABLE IF NOT EXISTS AttendanceLogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    log_time TEXT NOT NULL,
    log_type TEXT NOT NULL CHECK(log_type IN ('Check-in', 'Check-out')),
    FOREIGN KEY (teacher_id) REFERENCES Teachers(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS Users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS TimeSchedule (
    id INTEGER PRIMARY KEY DEFAULT 1,
    am_time_in TEXT NOT NULL DEFAULT '07:00:00',
    am_time_in_end TEXT NOT NULL DEFAULT '08:00:00',
    am_time_out_start TEXT NOT NULL DEFAULT '12:00:00',
    am_time_out TEXT NOT NULL DEFAULT '12:20:00',
    pm_time_in TEXT NOT NULL DEFAULT '12:35:00',
    pm_time_in_end TEXT NOT NULL DEFAULT '13:00:00',
    pm_time_out_start TEXT NOT NULL DEFAULT '17:00:00',
    pm_time_out TEXT NOT NULL DEFAULT '18:00:00',
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS UserActivityLogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS Holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('holiday', 'suspension')),
      description TEXT DEFAULT '',
      is_half_day INTEGER NOT NULL DEFAULT 0,
      half_day_period TEXT CHECK(half_day_period IN ('AM', 'PM', NULL)),
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS BiometricDevices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      serial_number TEXT UNIQUE,
      ip_address TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 4370,
      device_type TEXT NOT NULL DEFAULT 'zkteco' CHECK(device_type IN ('zkteco', 'ngteco')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      last_sync TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS TeacherTimeSchedule (
      teacher_id INTEGER PRIMARY KEY,
      am_time_in TEXT NOT NULL DEFAULT '07:00:00',
      am_time_in_end TEXT NOT NULL DEFAULT '08:00:00',
      am_time_out_start TEXT NOT NULL DEFAULT '12:00:00',
      am_time_out TEXT NOT NULL DEFAULT '12:20:00',
      pm_time_in TEXT NOT NULL DEFAULT '12:35:00',
      pm_time_in_end TEXT NOT NULL DEFAULT '13:00:00',
      pm_time_out_start TEXT NOT NULL DEFAULT '17:00:00',
      pm_time_out TEXT NOT NULL DEFAULT '18:00:00',
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (teacher_id) REFERENCES Teachers(id) ON DELETE CASCADE
    )
  `);

  console.log('SQLite database ready:', dbPath);

// ─── First-run: auto-create default admin if no users exist ──

const userCount = db.prepare('SELECT COUNT(*) as count FROM Users').get();
if (userCount.count === 0) {
  const bcrypt = require('bcryptjs');
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO Users (username, password, role) VALUES (?, ?, ?)').run('admin', hashedPassword, 'admin');
  console.log('First run — created default admin user (username: admin, password: admin123)');
}

// ─── First-run: insert default time schedule if none exists ──

const schedCount = db.prepare('SELECT COUNT(*) as count FROM TimeSchedule').get();
if (schedCount.count === 0) {
  db.prepare(`
    INSERT INTO TimeSchedule (id, am_time_in, am_time_in_end, am_time_out_start, am_time_out, pm_time_in, pm_time_in_end, pm_time_out_start, pm_time_out)
    VALUES (1, '07:00:00', '08:00:00', '12:00:00', '12:20:00', '12:35:00', '13:00:00', '17:00:00', '18:00:00')
  `).run();
  console.log('First run — created default time schedule');
}

function testConnection() {
  try {
    db.prepare('SELECT 1').get();
    console.log('Successfully connected to SQLite database:', dbPath);
    return true;
  } catch (error) {
    console.error('Failed to connect to SQLite database:', error.message);
    return false;
  }
}

module.exports = { db, testConnection, dbPath };
