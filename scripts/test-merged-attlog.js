/**
 * Test: merged 2-column ZKTeco attlog (id \t timestamp, NO punch byte).
 * Verifies that punches are classified by alternating in/out per day after
 * double-tap collapse, so the DTR's AM In / AM Out / PM In / PM Out slots
 * all fill — including PM Out (the bug: everything used to be 'Check-in').
 *
 * Run: node scripts/test-merged-attlog.js
 */
const path = require('path');
const fs = require('fs');
const biometricService = require('../src/main/biometricsService');
const { classifyDayLogs } = require('../src/renderer/dtrGenerator');

const datPath = path.join(__dirname, '..', 'merged-attlog-aug-2026.dat');

let failures = 0;
function check(label, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${extra ? ' — ' + extra : ''}`);
  }
}

// ── 1. Parse the real merged file ─────────────────────────────
console.log('\n[1] Parse merged-attlog-aug-2026.dat');
const result = biometricService.parseAttendanceFile(datPath);
check('parse succeeds', result.success, result.message);
const records = result.data || [];
console.log(`  → ${records.length} records (from 4201 raw rows), employeeCount=${result.employeeCount}`);
check('records parsed', records.length > 0);
check('every record has an explicit type', records.every(r => r.logType === 'Check-in' || r.logType === 'Check-out'));

// ── 2. ID 1 on Aug 3 (known day: 08:18, 12:28+35, 12:52, 17:25+41) ──
console.log('\n[2] ID 1 @ 2026-08-03 (in/lunch-out/lunch-in/out with double-taps)');
const aug3 = records.filter(r => r.employeeId === '1' && r.logTime.startsWith('2026-08-03'))
  .sort((a, b) => a.logTime.localeCompare(b.logTime));
const byTime = {};
aug3.forEach(r => { byTime[r.logTime] = r.logType; });
check('08:18:44 → Check-in', byTime['2026-08-03 08:18:44'] === 'Check-in', byTime['2026-08-03 08:18:44']);
check('12:28:35 double-tap collapsed', byTime['2026-08-03 12:28:35'] === undefined);
check('12:52:16 → Check-in (lunch return)', byTime['2026-08-03 12:52:16'] === 'Check-in', byTime['2026-08-03 12:52:16']);
check('17:25:38 → Check-out (PM Out)', byTime['2026-08-03 17:25:38'] === 'Check-out', byTime['2026-08-03 17:25:38']);
check('17:25:41 double-tap collapsed', byTime['2026-08-03 17:25:41'] === undefined);

// ── 3. Simulate the DTR generator's slot assignment ──────────
console.log('\n[3] DTR slot simulation (classifyDayLogs — the real app logic)');
function dtrSlots(dayRecords) {
  // Parser records use logTime/logType; the app passes DB rows (log_time/log_type)
  const adapted = dayRecords.map(r => ({ log_type: r.logType, log_time: r.logTime }));
  const s = classifyDayLogs(adapted, null);
  return { amIn: s.amInLog && s.amInLog.log_time, amOut: s.amOutLog && s.amOutLog.log_time,
           pmIn: s.pmInLog && s.pmInLog.log_time, pmOut: s.pmOutLog && s.pmOutLog.log_time };
}

// All days for ID 1: every full workday (4 punches) must fill all 4 slots
const id1Days = {};
records.filter(r => r.employeeId === '1').forEach(r => {
  const d = r.logTime.substring(0, 10);
  (id1Days[d] = id1Days[d] || []).push(r);
});
let fullDays = 0, filledDays = 0, pmOutFilled = 0;
for (const d of Object.keys(id1Days)) {
  const slots = dtrSlots(id1Days[d]);
  const punchCount = id1Days[d].length;
  if (punchCount >= 4) {
    fullDays++;
    if (slots.amIn && slots.amOut && slots.pmIn && slots.pmOut) filledDays++;
  }
  if (slots.pmOut) pmOutFilled++;
}
console.log(`  → ID 1: ${Object.keys(id1Days).length} day(s), ${fullDays} with 4+ punches, ${filledDays} fully filled, ${pmOutFilled} day(s) with PM Out`);
check('full workdays fill ALL four DTR slots', fullDays > 0 && filledDays === fullDays, `${filledDays}/${fullDays}`);
check('PM Out fills on work days (the original bug)', pmOutFilled > 0);

// Aug 3 specifically
const aug3Slots = dtrSlots(aug3);
check('Aug 3: PM Out = 17:25:38', aug3Slots.pmOut === '2026-08-03 17:25:38', JSON.stringify(aug3Slots));
check('Aug 3: all four slots filled', !!(aug3Slots.amIn && aug3Slots.amOut && aug3Slots.pmIn && aug3Slots.pmOut), JSON.stringify(aug3Slots));

// ── 4. Whole-file DTR coverage ────────────────────────────────
console.log('\n[4] Whole-file DTR coverage');
const allDays = {};
records.forEach(r => {
  const key = `${r.employeeId}|${r.logTime.substring(0, 10)}`;
  (allDays[key] = allDays[key] || []).push(r);
});
let daysWith4 = 0, daysAllSlots = 0, daysWithPmOut = 0;
for (const key of Object.keys(allDays)) {
  const slots = dtrSlots(allDays[key]);
  if (allDays[key].length >= 4) {
    daysWith4++;
    if (slots.amIn && slots.amOut && slots.pmIn && slots.pmOut) daysAllSlots++;
  }
  if (slots.pmOut) daysWithPmOut++;
}
console.log(`  → ${Object.keys(allDays).length} employee-days, ${daysWith4} with 4+ punches, ${daysAllSlots} fully filled, ${daysWithPmOut} with PM Out`);
// Not every 4-punch day fills all slots — that's data reality (forgotten
// punch-outs, teachers who left at lunch, sub-minute double-taps). The bug
// being tested is that PM slots CAN fill at all.
check('most 4-punch days fill all slots', daysWith4 > 0 && daysAllSlots / daysWith4 > 0.8, `${daysAllSlots}/${daysWith4}`);
check('PM Out fills across the file', daysWithPmOut > 100, `${daysWithPmOut} days`);

// ── 5. Odd-punch day handling ───────────────────────────────
console.log('\n[5] Odd-punch day handling (double/multiple scans per day)');
// The reported case: ID 100 @ 2026-08-12 = 12:28:59, 12:34:43, 17:41:25 + 17:41:33
// (double-tap). 3 punches → alternation gives in/out/in, but the final scan at
// 17:41 is in the PM-out window, so it flips to Check-out → DTR PM Out fills.
const day100 = records.filter(r => r.employeeId === '100' && r.logTime.startsWith('2026-08-12'))
  .sort((a, b) => a.logTime.localeCompare(b.logTime));
const t100 = {};
day100.forEach(r => { t100[r.logTime] = r.logType; });
check('17:41:33 double-tap collapsed', t100['2026-08-12 17:41:33'] === undefined);
check('12:28:59 → Check-in', t100['2026-08-12 12:28:59'] === 'Check-in', t100['2026-08-12 12:28:59']);
check('12:34:43 → Check-out', t100['2026-08-12 12:34:43'] === 'Check-out', t100['2026-08-12 12:34:43']);
check('17:41:25 final PM scan flipped to Check-out (DTR PM Out fills)', t100['2026-08-12 17:41:25'] === 'Check-out', t100['2026-08-12 17:41:25']);
const slots100 = dtrSlots(day100);
// Time-config rule: 12:00–12:30 is the AM check-out window — 12:28:59 lands in
// it → AM Out; 12:34:43 (after the boundary) → PM In; 17:41:25 → PM Out.
check('DTR slots: amOut=12:28:59, pmIn=12:34:43, pmOut=17:41:25',
  slots100.amOut === '2026-08-12 12:28:59' && slots100.pmIn === '2026-08-12 12:34:43' && slots100.pmOut === '2026-08-12 17:41:25',
  JSON.stringify(slots100));

// The 60s double-tap case: ID 100 @ 2026-08-27 = 07:50:44, 12:06:12 + 12:06:32
// (20s apart — beyond the old 10s window!), 12:57:12, 17:24:56 + 17:24:59.
// The surviving 12:06:32 used to shift alternation so PM In (12:57) got typed
// Check-out and vanished from the DTR.
const day27 = records.filter(r => r.employeeId === '100' && r.logTime.startsWith('2026-08-27'))
  .sort((a, b) => a.logTime.localeCompare(b.logTime));
const t27 = {};
day27.forEach(r => { t27[r.logTime] = r.logType; });
check('Aug 27: 12:06:32 (20s re-scan) collapsed', t27['2026-08-27 12:06:32'] === undefined);
check('Aug 27: 17:24:59 (3s re-scan) collapsed', t27['2026-08-27 17:24:59'] === undefined);
const slots27 = dtrSlots(day27);
check('Aug 27 DTR: all four slots fill (amIn 07:50, amOut 12:06, pmIn 12:57, pmOut 17:24)',
  slots27.amIn === '2026-08-27 07:50:44' && slots27.amOut === '2026-08-27 12:06:12' &&
  slots27.pmIn === '2026-08-27 12:57:12' && slots27.pmOut === '2026-08-27 17:24:56',
  JSON.stringify(slots27));

// General invariant: an odd day whose final punch is >= 17:00 must end
// Check-out; midday-ending odd days keep PM In (Check-in).
let flipped = 0, kept = 0;
for (const key of Object.keys(allDays)) {
  const recs = allDays[key];
  if (recs.length % 2 !== 1) continue;
  const last = recs.sort((a, b) => a.logTime.localeCompare(b.logTime))[recs.length - 1];
  const mins = parseInt(last.logTime.substring(11, 13), 10) * 60 + parseInt(last.logTime.substring(14, 16), 10);
  if (mins >= 17 * 60) {
    check(`odd day ${key}: late final scan is Check-out`, last.logType === 'Check-out', last.logType);
    flipped++;
  } else {
    kept++;
  }
  if (flipped + kept >= 20) break;   // sample is enough
}
console.log(`  → sampled odd days: ${flipped} with late final scan (flipped), ${kept} midday-ending (kept Check-in)`);

console.log('\n──────────────────────────────');
if (failures === 0) {
  console.log('ALL CHECKS PASSED ✅');
} else {
  console.error(`${failures} CHECK(S) FAILED ❌`);
  process.exit(1);
}
