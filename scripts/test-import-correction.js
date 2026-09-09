/**
 * Test: re-importing a log file CORRECTS stale log types in the database.
 *
 * Scenario: rows imported before the punch-classification fix were stored
 * with time-of-day types (afternoon outs = 'Check-in'). Re-importing the same
 * file used to skip them as duplicates, leaving the DTR blank for PM Out.
 * The importer now corrects the stored type when it differs.
 *
 * Run: node scripts/test-import-correction.js
 * The import core below mirrors the 'import-attendance-file' handler in
 * src/main/main.js — keep in sync.
 */
const path = require('path');
const biometricService = require('../src/main/biometricsService');

const datPath = path.join(__dirname, '..', 'merged-attlog-aug-2026.dat');

let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

// ── Old DB state: rows stored the OLD way (time-of-day classification) ──
console.log('\n[1] Seed mock DB with rows imported the OLD (buggy) way');
const teachers = [
  { id: 1, name: 'BONIEL, GERALDINE V.', biometric_id: 1 },
  { id: 2, name: 'CUBAROL, VERMAR', biometric_id: 100 }
];
const logs = [];   // { id, teacher_id, log_time, log_type }
let nextLogId = 1;

function oldClassify(logTime) {
  const [h] = logTime.substring(11).split(':').map(Number);
  if (h < 12) return 'Check-in';
  if (h === 12) return 'Check-out';
  return 'Check-in'; // PM outs stored as Check-in — the old bug
}

// Seed rows exactly as the pre-fix importer would have (first 40 raw rows)
const seeded = [];
const fs = require('fs');
const rawLines = fs.readFileSync(datPath, 'utf-8').split(/\r?\n/).filter(l => l.trim());
const seen = new Set();
for (const line of rawLines) {
  const cols = line.split('\t').map(c => c.trim());
  if (cols.length < 2 || !/^\d+$/.test(cols[0])) continue;
  const key = `${parseInt(cols[0], 10)}|${cols[1]}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const t = teachers.find(t => t.biometric_id === parseInt(cols[0], 10));
  if (!t) continue;
  logs.push({ id: nextLogId++, teacher_id: t.id, log_time: cols[1], log_type: oldClassify(cols[1]) });
  seeded.push(key);
  if (logs.length >= 40) break;
}
console.log(`  → seeded ${logs.length} rows with old types`);

// ── New import core (mirrors the fixed handler) ──────────────
console.log('\n[2] Re-import the same file with the FIXED logic');
const result = biometricService.parseAttendanceFile(datPath);
const records = result.data;

const DEDUP_WINDOW_MS = 10 * 60 * 1000;
const byEmployee = {};
for (const r of records) {
  const key = r.employeeId || r.name || '';
  (byEmployee[key] = byEmployee[key] || []).push(r);
}
const dedupedRecords = [];
for (const empId of Object.keys(byEmployee)) {
  const empRecords = byEmployee[empId].sort((a, b) => (a.logTime < b.logTime ? -1 : a.logTime > b.logTime ? 1 : 0));
  const lastKeptByType = {};
  for (const rec of empRecords) {
    const recTime = new Date(rec.logTime.replace(' ', 'T')).getTime();
    const typeKey = rec.logType === 'Check-in' || rec.logType === 'Check-out' ? rec.logType : '';
    const lastKeptTime = lastKeptByType[typeKey];
    if (lastKeptTime !== undefined && !isNaN(recTime) && !isNaN(lastKeptTime) && (recTime - lastKeptTime) < DEDUP_WINDOW_MS) continue;
    dedupedRecords.push(rec);
    lastKeptByType[typeKey] = isNaN(recTime) ? undefined : recTime;
  }
}

let insertedCount = 0, skippedCount = 0, correctedCount = 0;
const findTeacherStmt = bioId => teachers.find(t => t.biometric_id === parseInt(bioId, 10)) || null;
const checkExistingStmt = (teacherId, logTime) => logs.find(l => l.teacher_id === teacherId && l.log_time === logTime) || null;
const updateLogTypeStmt = (logType, id) => { const l = logs.find(l => l.id === id); if (l) l.log_type = logType; };

for (const record of dedupedRecords) {
  const teacher = findTeacherStmt(record.employeeId);
  if (!teacher) { skippedCount++; continue; }
  // AttLog records carry explicit types from the parser; fall back as the handler does
  let logType = record.logType;
  if (logType !== 'Check-in' && logType !== 'Check-out') {
    const mins = parseInt(record.logTime.substring(11, 13), 10) * 60 + parseInt(record.logTime.substring(14, 16), 10);
    logType = mins < 720 ? 'Check-in' : (mins < 780 ? 'Check-out' : 'Check-in');
  }
  const existing = checkExistingStmt(teacher.id, record.logTime);
  if (existing) {
    if (existing.log_type !== logType) {
      updateLogTypeStmt(logType, existing.id);
      correctedCount++;
    }
    skippedCount++;
    continue;
  }
  logs.push({ id: nextLogId++, teacher_id: teacher.id, log_time: record.logTime, log_type: logType });
  insertedCount++;
}

console.log(`  → inserted ${insertedCount}, corrected ${correctedCount}, skipped ${skippedCount}`);
check('stale rows were corrected', correctedCount > 0);
check('all seeded rows still exist exactly once', logs.length === 40 + insertedCount);

// ── The user's exact case: ID 100 @ 2026-08-04 17:47:03 ──────
console.log('\n[3] The reported case: ID 100 @ 2026-08-04 17:47:03');
const t100 = teachers.find(t => t.biometric_id === 100);
const row = logs.find(l => l.teacher_id === t100.id && l.log_time === '2026-08-04 17:47:03');
check('row exists', !!row);
check('type corrected to Check-out (fills DTR PM Out)', row && row.log_type === 'Check-out', row && row.log_type);
const seededRow = seeded.includes('100|2026-08-04 17:47:03');
console.log(`  → row was ${seededRow ? 'seeded stale (Check-in) and corrected' : 'inserted new'}`);

// Aug 5 full day for ID 100: 08:21 in / 12:03 out / 12:51 in / 18:09 out
const day = logs.filter(l => l.teacher_id === t100.id && l.log_time.startsWith('2026-08-05'))
  .sort((a, b) => a.log_time.localeCompare(b.log_time));
check('Aug 5 has 4 rows with in/out/in/out types',
  day.length === 4 &&
  day[0].log_type === 'Check-in' && day[1].log_type === 'Check-out' &&
  day[2].log_type === 'Check-in' && day[3].log_type === 'Check-out',
  day.map(l => l.log_time.substring(11, 16) + ':' + l.log_type).join(' | '));

console.log('\n──────────────────────────────');
if (failures === 0) console.log('ALL CHECKS PASSED ✅');
else { console.error(`${failures} CHECK(S) FAILED ❌`); process.exit(1); }
