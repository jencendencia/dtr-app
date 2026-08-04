/**
 * Live end-to-end test of the app's ZKTeco sync pipeline.
 *
 * Uses the REAL zktecoService (with the patched 40-byte decoder and ZTCP
 * protocol fixes) to:
 *   1. Connect to the device
 *   2. Fetch the user list (getUsers — same call the sync handler makes)
 *   3. Fetch attendance logs (getAttendanceLogs — same call the sync handler makes)
 *   4. Replicate the sync-device-attendance matching logic against the local DB
 *      (read-only) and report which logs would be inserted / skipped / unmatched.
 *
 * NOTE: better-sqlite3 is built for Electron's Node (ABI 121), so this script
 * reads the DB with node:sqlite (read-only) instead. Run with:
 *   node --experimental-sqlite scripts/test-live-sync.js
 */
const { DatabaseSync } = require('node:sqlite');
const zktecoService = require('../src/main/zktecoService');

const DB_PATH = 'C:/Users/Admin/AppData/Roaming/biometric-dtr-app/biometric_dtr.db';
const HOST = process.env.ZK_HOST || '192.168.1.201';
const PORT = parseInt(process.env.ZK_PORT || '4370', 10);

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Same ID-variant expansion the sync handler uses for biometric matching. */
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
  // ── Step 1: connect ──────────────────────────────────────────────
  const conn = await zktecoService.connect(HOST, PORT);
  if (!conn.success) {
    console.error('❌ Connect failed:', conn.message);
    process.exit(1);
  }
  console.log('✅ Connected:', JSON.stringify(conn.info));

  // ── Step 2: user list (as sync does) ─────────────────────────────
  const usersRes = await zktecoService.getUsers();
  const deviceUsers = usersRes.success ? usersRes.data || [] : [];
  console.log(`\n👥 Device users: ${deviceUsers.length} (device reports ${usersRes.userCount})`);
  const deviceUserMap = {};
  for (const u of deviceUsers) {
    const rawId = u.userId != null ? String(u.userId) : (u.uid != null ? String(u.uid) : '');
    const name = String(u.name || '').trim();
    for (const v of idVariants(rawId)) if (!deviceUserMap[v]) deviceUserMap[v] = name;
  }
  console.log('Sample:', JSON.stringify(deviceUsers.slice(0, 3), null, 2));

  // ── Step 3: attendance logs (as sync does) ───────────────────────
  const logsRes = await zktecoService.getAttendanceLogs();
  const records = logsRes.success ? logsRes.data || [] : [];
  console.log(`\n🕒 Device attendance logs: ${records.length}`);
  console.log(JSON.stringify(records, null, 2));

  // ── Step 4: simulate sync matching against the local DB ──────────
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const teachers = db.prepare('SELECT id, name, biometric_id FROM Teachers').all();

  const biometricMap = {};
  const nameMap = {};
  const teacherById = {};
  for (const t of teachers) {
    for (const v of idVariants(String(t.biometric_id))) biometricMap[v] = t.id;
    teacherById[t.id] = t;
    const normalized = normalizeName(t.name);
    nameMap[normalized] = t.id;
  }

  // Attach device user names to records (as sync does)
  for (const record of records) {
    const empId = String(record.employeeId || '').trim();
    if (!record.name && deviceUserMap[empId]) record.name = deviceUserMap[empId];
    if (!record.name && empId && empId.length >= 3 && /[a-zA-Z]/.test(empId)) record.name = empId;
  }

  const checkExisting = db.prepare('SELECT id FROM AttendanceLogs WHERE teacher_id = ? AND log_time = ?');

  let inserted = 0, skipped = 0, unmatched = 0;
  const actions = [];
  for (const record of records) {
    const empId = String(record.employeeId || '').trim();
    let teacherId = biometricMap[empId];
    if (!teacherId && record.name) teacherId = nameMap[normalizeName(record.name)];
    if (!teacherId) {
      unmatched++;
      actions.push(`  ⚠️  UNMATCHED: employeeId="${empId}" name="${record.name || ''}" → no teacher`);
      continue;
    }
    const existing = checkExisting.get(teacherId, record.logTime);
    if (existing) {
      skipped++;
      actions.push(`  ⏭️  SKIP (duplicate): "${teacherById[teacherId].name}" @ ${record.logTime} (${record.logType})`);
      continue;
    }
    inserted++;
    actions.push(`  ✅ INSERT: "${teacherById[teacherId].name}" (bio ${teacherById[teacherId].biometric_id}) @ ${record.logTime} (${record.logType})`);
  }

  console.log('\n── Simulated sync result (against live DB) ──');
  actions.forEach(a => console.log(a));
  console.log(`\nTOTAL: ${inserted} would insert | ${skipped} duplicates | ${unmatched} unmatched`);

  // Joel Encendencia lookup
  const joel = teachers.find(t => /encendencia/i.test(t.name));
  console.log(`\n🎯 Joel Encendencia: ${joel ? JSON.stringify(joel) : 'NOT in DB'}`);

  db.close();
  await zktecoService.disconnect();
  console.log('\n✅ Disconnected');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
