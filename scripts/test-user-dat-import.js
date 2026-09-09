/**
 * Standalone test for the ZKTeco binary user.dat import.
 *
 * Verifies:
 *   1. isUserDatFile() detects the binary user database (and rejects text files)
 *   2. parseUserDat() extracts the expected users (165 from the reference file)
 *   3. The upsert logic used by 'import-zkteco-users' in main.js:
 *      - adds new teachers from device users
 *      - syncs the name of an existing teacher with a stale name
 *      - leaves teachers whose ID is not on the device untouched
 *
 * Run: node scripts/test-user-dat-import.js [path-to-user.dat]
 *
 * Note: better-sqlite3 in this repo is compiled for Electron's Node ABI, so it
 * cannot load under the system Node. The upsert section therefore runs against
 * a minimal in-memory stand-in for the three prepared statements used by
 * upsertUsersFromUserDat() in src/main/main.js — keep the two in sync.
 */
const path = require('path');
const fs = require('fs');
const biometricService = require('../src/main/biometricsService');

const datPath = process.argv[2] || path.join(__dirname, '..', 'user.dat');

let failures = 0;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${extra ? ' — ' + extra : ''}`);
  }
}

// ── 1. Detection ──────────────────────────────────────────────
console.log('\n[1] isUserDatFile detection');
check('detects binary user.dat', biometricService.isUserDatFile(datPath));

const tmpCsv = path.join(require('os').tmpdir(), `not-user-dat-${Date.now()}.dat`);
fs.writeFileSync(tmpCsv, 'Employee ID,Name,Date,Time\n1,Test Person,2026-01-01,08:00:00\n');
check('rejects a text CSV saved as .dat', !biometricService.isUserDatFile(tmpCsv));
fs.unlinkSync(tmpCsv);

// ── 2. Parsing ────────────────────────────────────────────────
console.log('\n[2] parseUserDat');
const parsed = biometricService.parseUserDat(datPath);
check('parse succeeds', parsed.success, parsed.message);
const users = parsed.users || [];
check('expected user count (165)', users.length === 165, `got ${users.length}`);
check('capacity is 300 slots', parsed.capacity === 300, `got ${parsed.capacity}`);

const byId = {};
users.forEach(u => { byId[u.biometricId] = u.name; });
check('all biometric IDs numeric & unique', users.every(u => Number.isInteger(u.biometricId) && u.biometricId > 0) && Object.keys(byId).length === users.length);
check('names are printable text', users.every(u => /^[\x20-\x7E]+$/.test(u.name)));
check('sample user 11 is BONIEL', byId[11] === 'BONIEL, GERALDINE V.', `got "${byId[11]}"`);
check('sample user 42 is MADELO', byId[42] === 'MADELO, LUCILLE H.', `got "${byId[42]}"`);

// ── 3. Upsert (mirrors upsertUsersFromUserDat in main.js) ─────
console.log('\n[3] upsert into Teachers (in-memory mock DB)');

// Teachers table rows (id auto-increment like SQLite)
const teacherRows = [];
let nextId = 1;
function insertTeacher(name, bioId) {
  teacherRows.push({ id: nextId++, name, biometric_id: bioId, status: 'active' });
}
insertTeacher('OLD STALE NAME', 11);   // existing teacher with a STALE name on a device ID
insertTeacher('NOT ON DEVICE', 999);   // teacher NOT on the device

// Minimal stand-ins for the prepared statements used by the real upsert
const findTeacherStmt = { get: (bioId) => teacherRows.find(t => t.biometric_id === bioId) || undefined };
const insertTeacherStmt = { run: (name, bioId) => insertTeacher(name, bioId) };
const updateNameStmt = { run: (name, id) => { const t = teacherRows.find(t => t.id === id); if (t) t.name = name; } };
const db = { transaction: (fn) => fn };   // tx() just runs the callback synchronously

let added = 0, updated = 0;
const addedNames = [], updatedNames = [];
const tx = db.transaction(() => {
  for (const u of users) {
    const existing = findTeacherStmt.get(u.biometricId);
    if (existing) {
      if (existing.name !== u.name) {
        updateNameStmt.run(u.name, existing.id);
        updated++;
        updatedNames.push(`${u.name} (was "${existing.name}")`);
      }
    } else {
      insertTeacherStmt.run(u.name, u.biometricId);
      added++;
      addedNames.push(`${u.name} (ID: ${u.biometricId})`);
    }
  }
});
tx();

const skipped = users.length - added - updated;
check(`added = 164 (165 users − 1 existing)`, added === 164, `got ${added}`);
check('updated = 1 (stale name synced)', updated === 1, `got ${updated}`);
check('skipped = 0', skipped === 0, `got ${skipped}`);
check('stale name replaced on device', findTeacherStmt.get(11).name === 'BONIEL, GERALDINE V.', `got "${findTeacherStmt.get(11).name}"`);
check('teacher not on device is untouched', findTeacherStmt.get(999).name === 'NOT ON DEVICE');
const total = teacherRows.length;
check(`total teachers = 166 (2 seeded + 164 added)`, total === 166, `got ${total}`);
const newStatus = teacherRows.find(t => t.biometric_id === 42);
check('inserted teachers are active', newStatus && newStatus.status === 'active');

// ── 4. Preview payload ────────────────────────────────────────
console.log('\n[4] preview payload (_previewUserDat via previewFile)');
const pv = biometricService.previewFile(datPath);
check('preview succeeds', pv.success);
check('preview flags isUserDat', pv.isUserDat === true);
check('preview headers are Name/Biometric ID', pv.headers && pv.headers[0] === 'Name' && pv.headers[1] === 'Biometric ID');
check('preview shows up to 10 rows', Array.isArray(pv.preview) && pv.preview.length === 10);
check('totalRows = 165', pv.totalRows === 165, `got ${pv.totalRows}`);

console.log('\n──────────────────────────────');
if (failures === 0) {
  console.log('ALL CHECKS PASSED ✅');
} else {
  console.error(`${failures} CHECK(S) FAILED ❌`);
  process.exit(1);
}
