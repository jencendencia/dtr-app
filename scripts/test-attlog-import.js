/**
 * Test: standard ZKTeco attlog.dat attendance import.
 * Uses the real reference file SNG8243000051_attlog.dat when present.
 *
 * Run: node scripts/test-attlog-import.js
 * The type-aware dedup section mirrors the logic in the
 * 'import-attendance-file' handler in src/main/main.js — keep in sync.
 */
const path = require('path');
const fs = require('fs');
const biometricService = require('../src/main/biometricsService');

const datPath = path.join(__dirname, '..', 'SNG8243000051_attlog.dat');

let failures = 0;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${extra ? ' — ' + extra : ''}`);
  }
}

// ── 1. Detection & parsing of the real file ──────────────────
console.log('\n[1] Real attlog.dat parse');
const content = fs.readFileSync(datPath, 'utf-8');
check('file detected as ZKTeco AttLog', biometricService._isZktecoAttlog(content));

const result = biometricService.parseAttendanceFile(datPath);
check('parseAttendanceFile succeeds', result.success, result.message);
check('flags isAttlogFormat', result.isAttlogFormat === true);

const records = result.data || [];
console.log(`  → ${records.length} records, ${result.employeeCount} employees, ${result.duplicateRows} dup rows collapsed, ${result.skippedRows} skipped rows`);

// File starts 2026-09-01; sample from the file: "123  2026-09-01 06:00:13  1  0  1  0"
const first = records[0];
check('first record is ID 123 @ 06:00:13', first && first.employeeId === '123' && first.logTime === '2026-09-01 06:00:13', JSON.stringify(first));
check('first record punch=0 → Check-in', first.logType === 'Check-in', first.logType);
const noonOut = records.find(r => r.employeeId === '123' && r.logTime === '2026-09-01 12:43:44');
check('ID 123 12:43:44 punch=0 → Check-in (re-entry)', noonOut && noonOut.logType === 'Check-in', noonOut && noonOut.logType);
const pmOut = records.find(r => r.employeeId === '123' && r.logTime === '2026-09-01 18:14:35');
check('ID 123 18:14:35 punch=1 → Check-out', pmOut && pmOut.logType === 'Check-out', pmOut && pmOut.logType);
const ids = new Set(records.map(r => r.employeeId));
check('leading-zero-safe IDs (no "0123")', ![...ids].some(id => /^0\d+$/.test(id)));
check('IDs match user.dat biometric IDs', [...ids].every(id => /^\d+$/.test(id)));

// ── 2. Preview payload ───────────────────────────────────────
console.log('\n[2] Preview payload');
const pv = biometricService.previewFile(datPath);
check('preview succeeds', pv.success);
check('flags isAttlogFormat', pv.isAttlogFormat === true);
check('preview headers ID/Date/Time/Type', pv.headers && pv.headers[0] === 'Biometric ID' && pv.headers[3] === 'Punch Type');
check('preview shows 10 rows', Array.isArray(pv.preview) && pv.preview.length === 10);
check('totalRows = parsed count', pv.totalRows === records.length, `got ${pv.totalRows} vs ${records.length}`);

// ── 3. Type-aware dedup (mirrors main.js) ────────────────────
console.log('\n[3] Type-aware dedup (10-min window per punch type)');
const DEDUP_WINDOW_MS = 10 * 60 * 1000;
const byEmployee = {};
for (const r of records) {
  const key = r.employeeId || r.name || '';
  if (!byEmployee[key]) byEmployee[key] = [];
  byEmployee[key].push(r);
}
const dedupedRecords = [];
let filteredCount = 0;
for (const empId of Object.keys(byEmployee)) {
  const empRecords = byEmployee[empId];
  empRecords.sort((a, b) => (a.logTime < b.logTime ? -1 : a.logTime > b.logTime ? 1 : 0));
  const lastKeptByType = {};
  for (const rec of empRecords) {
    const recTime = new Date(rec.logTime.replace(' ', 'T')).getTime();
    const typeKey = rec.logType === 'Check-in' || rec.logType === 'Check-out' ? rec.logType : '';
    const lastKeptTime = lastKeptByType[typeKey];
    if (lastKeptTime !== undefined && !isNaN(recTime) && !isNaN(lastKeptTime) && (recTime - lastKeptTime) < DEDUP_WINDOW_MS) {
      filteredCount++;
      continue;
    }
    dedupedRecords.push(rec);
    lastKeptByType[typeKey] = isNaN(recTime) ? undefined : recTime;
  }
}
console.log(`  → ${records.length} parsed → ${dedupedRecords.length} kept, ${filteredCount} filtered`);
check('dedup reduces record count', dedupedRecords.length < records.length);
check('filtered count matches kept diff', filteredCount === records.length - dedupedRecords.length);

// Critical: ID 67 on 09-02 out@12:31:16 then in@12:31:35 (19s apart) — the old
// type-blind dedup dropped the re-entry in-punch; the new per-type one keeps both.
const reEntry = records.filter(r => r.employeeId === '67' && r.logTime.startsWith('2026-09-02 12:31')).sort((a, b) => a.logTime.localeCompare(b.logTime));
check('ID 67 has out 12:31:16 (punch=1)', reEntry.some(r => r.logTime === '2026-09-02 12:31:16' && r.logType === 'Check-out'));
check('ID 67 has in 12:31:35 (punch=0)', reEntry.some(r => r.logTime === '2026-09-02 12:31:35' && r.logType === 'Check-in'));
const reEntryKept = dedupedRecords.filter(r => r.employeeId === '67' && (r.logTime === '2026-09-02 12:31:16' || r.logTime === '2026-09-02 12:31:35'));
check('both 12:31 punches SURVIVE dedup (out + re-entry in)', reEntryKept.length === 2, `kept ${reEntryKept.length}`);

// Double-tap: ID 123 @ 06:00:13 and 06:00:15 (2s apart, same type) — keep first only
const doubleTaps = dedupedRecords.filter(r => r.employeeId === '123' && r.logTime.startsWith('2026-09-01 06:0'));
const times = doubleTaps.map(r => r.logTime);
check('ID 123 double-tap collapses to first scan', times.includes('2026-09-01 06:00:13') && !times.includes('2026-09-01 06:00:15'), times.join(', '));

console.log('\n──────────────────────────────');
if (failures === 0) {
  console.log('ALL CHECKS PASSED ✅');
} else {
  console.error(`${failures} CHECK(S) FAILED ❌`);
  process.exit(1);
}
