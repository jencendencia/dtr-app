/**
 * One-off import: registers the Granding FA210 in the app database and pulls
 * its attendance logs through the app's own zktecoService (legacy protocol),
 * matching records to teachers the same way sync-device-attendance does.
 *
 * The app must be CLOSED while this runs (SQLite lock).
 *
 * Run: node scripts/import-granding.js [--auto-create]
 *   --auto-create  create placeholder teachers for unmatched IDs
 *                  (default: skip unmatched and report them)
 */
const { DatabaseSync } = require('node:sqlite');
const zktecoService = require('../src/main/zktecoService');

const DB_PATH = 'C:/Users/Admin/AppData/Roaming/biometric-dtr-app/biometric_dtr.db';
const HOST = process.env.ZK_HOST || '192.168.2.38';
const PORT = parseInt(process.env.ZK_PORT || '4370', 10);
const SERIAL = '3324202160161';
const AUTO_CREATE = process.argv.includes('--auto-create');

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function isPlausibleName(s) {
  return typeof s === 'string' && s.length >= 3 && /[a-zA-Z]/.test(s);
}
function idVariants(rawId) {
  const variants = new Set();
  const s = String(rawId == null ? '' : rawId).trim();
  if (!s) return variants;
  variants.add(s);
  const stripped = s.replace(/^0+/, '');
  if (stripped) variants.add(stripped);
  if (/^\d+$/.test(s)) {
    const num = parseInt(s, 10);
    variants.add(String(num));
    for (let width = 2; width <= 9; width++) variants.add(String(num).padStart(width, '0'));
  }
  return variants;
}

async function main() {
  const db = new DatabaseSync(DB_PATH);

  // ── 0. Same migration the app performs on start: allow 'granding' ──
  const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'BiometricDevices'").get();
  if (tableSql && tableSql.sql && !tableSql.sql.includes("'granding'")) {
    console.log('Migrating BiometricDevices to allow the granding device type...');
    db.exec(`
      ALTER TABLE BiometricDevices RENAME TO BiometricDevices_old;
      CREATE TABLE BiometricDevices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        serial_number TEXT UNIQUE,
        ip_address TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 4370,
        device_type TEXT NOT NULL DEFAULT 'zkteco' CHECK(device_type IN ('zkteco', 'ngteco', 'granding')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
        last_sync TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      INSERT INTO BiometricDevices (id, name, serial_number, ip_address, port, device_type, status, last_sync, created_at)
        SELECT id, name, serial_number, ip_address, port, device_type, status, last_sync, created_at FROM BiometricDevices_old;
      DROP TABLE BiometricDevices_old;
    `);
    console.log('Migration done.');
  }

  // ── 1. Register the device (upsert by serial) ──────────────────
  const existing = db.prepare('SELECT id FROM BiometricDevices WHERE serial_number = ? OR ip_address = ?').get(SERIAL, HOST);
  let deviceId;
  if (existing) {
    deviceId = existing.id;
    db.prepare("UPDATE BiometricDevices SET name = ?, ip_address = ?, port = ?, device_type = 'granding', status = 'active' WHERE id = ?")
      .run('Granding FA210', HOST, PORT, deviceId);
    console.log(`Device row updated (id ${deviceId})`);
  } else {
    const res = db.prepare(
      "INSERT INTO BiometricDevices (name, serial_number, ip_address, port, device_type, status) VALUES (?, ?, ?, ?, 'granding', 'active')"
    ).run('Granding FA210', SERIAL, HOST, PORT);
    deviceId = Number(res.lastInsertRowid);
    console.log(`Device registered (id ${deviceId})`);
  }

  // ── 2. Connect and pull users + logs ───────────────────────────
  const conn = await zktecoService.connect(HOST, PORT, 5000, 'granding');
  if (!conn.success) {
    console.error('❌ Connect failed:', conn.message);
    process.exit(1);
  }
  console.log('✅ Connected:', JSON.stringify(conn.info));

  const usersRes = await zktecoService.getUsers();
  const deviceUsers = usersRes.success ? usersRes.data || [] : [];
  const deviceUserMap = {};
  const deviceUsersByNormName = {};
  for (const u of deviceUsers) {
    const rawId = u.userId != null ? String(u.userId) : '';
    const name = String(u.name || '').trim();
    if (rawId && name) for (const v of idVariants(rawId)) if (!deviceUserMap[v]) deviceUserMap[v] = name;
    if (name) deviceUsersByNormName[normalizeName(name)] = u;
  }
  console.log(`👥 Device users: ${deviceUsers.length}`);

  const logsRes = await zktecoService.getAttendanceLogs();
  if (!logsRes.success) {
    console.error('❌ Logs failed:', logsRes.message);
    process.exit(1);
  }
  const records = logsRes.data || [];
  console.log(`🕒 Records from device: ${records.length}`);

  // Attach device user names to records (same as sync does)
  for (const record of records) {
    const empId = String(record.employeeId || '').trim();
    if (!record.name && deviceUserMap[empId]) record.name = deviceUserMap[empId];
    if (!record.name && empId && isPlausibleName(empId)) record.name = empId;
  }

  // ── 3. Match to teachers (same maps the sync handler builds) ──
  const teachers = db.prepare('SELECT id, name, biometric_id FROM Teachers').all();
  const biometricMap = {};
  const nameMap = {};
  const nameList = [];
  const teacherById = {};
  for (const t of teachers) {
    for (const v of idVariants(String(t.biometric_id))) biometricMap[v] = t.id;
    teacherById[t.id] = t;
    const normalized = normalizeName(t.name);
    nameMap[normalized] = t.id;
    nameList.push({ name: t.name, normalized, id: t.id });
  }

  const checkExisting = db.prepare('SELECT id FROM AttendanceLogs WHERE teacher_id = ? AND log_time = ?');
  const insertLog = db.prepare('INSERT INTO AttendanceLogs (teacher_id, log_time, log_type) VALUES (?, ?, ?)');
  const insertTeacher = db.prepare('INSERT INTO Teachers (name, biometric_id) VALUES (?, ?)');

  const maxBio = db.prepare('SELECT COALESCE(MAX(biometric_id), 0) m FROM Teachers').get().m;
  let nextBioId = maxBio + 1;

  let inserted = 0, duplicates = 0, unmatched = 0, created = 0;
  const unmatchedIds = new Map();
  const createdNames = new Set();
  const insertMany = db.transaction ? null : null; // node:sqlite has no transaction helper; insert directly

  for (const record of records) {
    const empId = String(record.employeeId || '').trim();
    let teacherId = biometricMap[empId];
    if (!teacherId && record.name) {
      const norm = normalizeName(record.name);
      teacherId = nameMap[norm];
      if (!teacherId) {
        // Fuzzy contains-match (same as sync's fallback)
        for (const item of nameList) {
          if (item.normalized.includes(norm) || norm.includes(item.normalized)) { teacherId = item.id; break; }
        }
      }
    }

    if (!teacherId && AUTO_CREATE && empId && /^\d+$/.test(empId)) {
      const bioId = parseInt(empId, 10);
      try {
        const r = insertTeacher.run(`Employee ${bioId}`, bioId);
        teacherId = Number(r.lastInsertRowid);
        createdNames.add(`Employee ${bioId}`);
        for (const v of idVariants(String(bioId))) biometricMap[v] = teacherId;
        created++;
      } catch (_) {
        // UNIQUE collision — find a free id
        let candidate = nextBioId;
        while (true) {
          candidate++;
          try {
            const r = insertTeacher.run(`Employee ${bioId}`, candidate);
            teacherId = Number(r.lastInsertRowid);
            createdNames.add(`Employee ${bioId}`);
            for (const v of idVariants(String(candidate))) biometricMap[v] = teacherId;
            created++;
            break;
          } catch (_) {}
        }
      }
    }

    if (!teacherId) {
      unmatched++;
      const key = empId + (record.name ? ` (${record.name})` : '');
      unmatchedIds.set(key, (unmatchedIds.get(key) || 0) + 1);
      continue;
    }

    if (checkExisting.get(teacherId, record.logTime)) { duplicates++; continue; }
    insertLog.run(teacherId, record.logTime, record.logType);
    inserted++;
  }

  db.prepare("UPDATE BiometricDevices SET last_sync = datetime('now', 'localtime') WHERE id = ?").run(deviceId);

  console.log(`\n── Import summary ──`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Duplicates skipped: ${duplicates}`);
  console.log(`Teachers auto-created: ${created}${created ? ' (' + [...createdNames].slice(0, 10).join(', ') + (createdNames.size > 10 ? ', …' : '') + ')' : ''}`);
  console.log(`Unmatched (skipped): ${unmatched}`);
  if (unmatchedIds.size) {
    console.log('Unmatched breakdown:', JSON.stringify([...unmatchedIds.entries()].slice(0, 20)));
  }

  await zktecoService.disconnect();
  db.close();
  console.log('✅ Done');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  try { await zktecoService.disconnect(); } catch (_) {}
  process.exit(1);
});
