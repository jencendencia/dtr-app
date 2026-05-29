const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

function seed() {
  // Seed into Electron's userData folder (where the app reads at runtime)
  const os = require('os');
  const appDataPath = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const electronDbPath = path.join(appDataPath, 'biometric-dtr-app', 'biometric_dtr.db');

  // Ensure the directory exists
  const electronDbDir = path.dirname(electronDbPath);
  if (!fs.existsSync(electronDbDir)) {
    fs.mkdirSync(electronDbDir, { recursive: true });
  }

  const dbPath = electronDbPath;
  console.log('Seeding database at:', dbPath);

  // Remove existing database to start fresh
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('Removed existing database.');
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  console.log('Creating tables...');

  db.exec(`
    CREATE TABLE Teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      biometric_id INTEGER UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.exec(`
    CREATE TABLE AttendanceLogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      log_time TEXT NOT NULL,
      log_type TEXT NOT NULL CHECK(log_type IN ('Check-in', 'Check-out')),
      FOREIGN KEY (teacher_id) REFERENCES Teachers(id)
    )
  `);

  db.exec(`
    CREATE TABLE Users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  db.exec(`
    CREATE TABLE TimeSchedule (
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

  console.log('Inserting mock teachers...');
  const insertTeacher = db.prepare('INSERT INTO Teachers (id, name, biometric_id) VALUES (?, ?, ?)');
  const insertTeacherMany = db.transaction((teachers) => {
    for (const t of teachers) insertTeacher.run(t.id, t.name, t.biometricId);
  });

  insertTeacherMany([
    { id: 1, name: 'Jane Doe', biometricId: 101 },
    { id: 2, name: 'John Smith', biometricId: 102 },
    { id: 3, name: 'Maria Santos', biometricId: 103 },
    { id: 4, name: 'Carlos Rivera', biometricId: 104 }
  ]);

  // Default admin user (password: admin123)
  console.log('Creating default admin user...');
  const hashedPassword = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO Users (username, password, role) VALUES (?, ?, ?)').run('admin', hashedPassword, 'admin');

  // Default time schedule
  console.log('Setting default time schedule...');
  db.prepare(`
    INSERT INTO TimeSchedule (id, am_time_in, am_time_in_end, am_time_out_start, am_time_out, pm_time_in, pm_time_in_end, pm_time_out_start, pm_time_out)
    VALUES (1, '07:00:00', '08:00:00', '12:00:00', '12:20:00', '12:35:00', '13:00:00', '17:00:00', '18:00:00')
  `).run();

  console.log('Generating mock attendance logs for June 2026...');
  const insertLog = db.prepare('INSERT INTO AttendanceLogs (teacher_id, log_time, log_type) VALUES (?, ?, ?)');
  const insertLogs = db.transaction((logs) => {
    for (const log of logs) insertLog.run(log[0], log[1], log[2]);
  });

  const logs = [];
  for (let day = 1; day <= 30; day++) {
    const dateStr = `2026-06-${day.toString().padStart(2, '0')}`;
    const dateObj = new Date(2026, 5, day); // June = 5
    const dow = dateObj.getDay();
    const isWeekend = dow === 0 || dow === 6;

    if (isWeekend) continue;

    // Teacher 1 - Jane Doe: Punctual
    logs.push([1, `${dateStr} 07:15:00`, 'Check-in']);
    logs.push([1, `${dateStr} 12:10:00`, 'Check-out']);
    logs.push([1, `${dateStr} 12:40:00`, 'Check-in']);
    logs.push([1, `${dateStr} 18:05:00`, 'Check-out']);

    // Teacher 2 - John Smith: Late
    logs.push([2, `${dateStr} 08:05:00`, 'Check-in']);
    logs.push([2, `${dateStr} 12:05:00`, 'Check-out']);
    logs.push([2, `${dateStr} 13:10:00`, 'Check-in']);
    logs.push([2, `${dateStr} 17:55:00`, 'Check-out']);

    // Teacher 3 - Maria Santos: Undertime
    logs.push([3, `${dateStr} 07:50:00`, 'Check-in']);
    logs.push([3, `${dateStr} 11:50:00`, 'Check-out']);
    logs.push([3, `${dateStr} 12:55:00`, 'Check-in']);
    logs.push([3, `${dateStr} 17:30:00`, 'Check-out']);
  }

  insertLogs(logs);

  console.log('Seeding complete!');
  console.log('Default admin login — username: admin, password: admin123');
  console.log('Database file:', dbPath);

  db.close();
}

seed();
