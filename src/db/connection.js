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
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  )
`);

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

console.log('SQLite database ready:', dbPath);

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
