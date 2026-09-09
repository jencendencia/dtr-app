/**
 * Regression test: DTR afternoon-only days.
 *
 * Case (real data, teacher biometric 154, 2026-08-17): no morning punches at
 * all — first scan is a 12:06 PM Check-in, then 12:33 PM Check-out, 5:21 PM
 * Check-out. The old DTR logic backfilled the 12:33 Check-out into AM
 * Departure, fabricating a morning and inflating undertime (8h06 instead of 4h).
 *
 * Fix: a Check-out in the 12:30–3:00 band backfills AM Departure ONLY when an
 * AM In exists (morning actually attended). Otherwise it stays PM only.
 *
 * Run: node scripts/test-dtr-afternoon-only.js
 */
const { generateDTRHtml } = require('../src/renderer/dtrGenerator');

// dtrGenerator reads localStorage for principal info — stub it for Node
global.localStorage = { getItem: () => null };

let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}

/** Extract the DTR row cells for a given day from generated HTML */
function dayRow(html, day) {
  const re = new RegExp(`<tr[^>]*><td>${day}</td><td([^>]*)>([^<]*)</td><td>([^<]*)</td><td class="thick-col">([^<]*)</td><td class="thick-col">([^<]*)</td><td>([^<]*)</td><td>([^<]*)</td></tr>`);
  const m = html.match(re);
  if (!m) return null;
  return { amIn: m[2], amOut: m[3], pmIn: m[4], pmOut: m[5], utH: m[6], utM: m[7] };
}

console.log('\n[1] ID 154 @ 2026-08-17 — afternoon-only day (the reported bug)');
const aug17 = [
  { log_type: 'Check-in',  log_time: '2026-08-17 12:06:13' },
  { log_type: 'Check-out', log_time: '2026-08-17 12:33:08' },
  { log_type: 'Check-out', log_time: '2026-08-17 17:21:23' },
];
const row17 = dayRow(generateDTRHtml('Test', 'August', '2026', aug17, null, {}), 17);
// Time-config rule: 12:00–12:30 is the AM CHECK-OUT window regardless of the
// stored in/out state — so 12:06 is the AM departure, 12:33 the PM arrival.
check('AM Departure = 12:06 (window is authoritative, not device state)', row17 && row17.amOut === '12:06', row17 && JSON.stringify(row17));
check('AM Arrival blank (no morning attendance)', row17 && row17.amIn === '', row17 && JSON.stringify(row17));
check('PM Arrival = 12:33 (first scan after the 12:30 boundary)', row17 && row17.pmIn === '12:33', row17 && row17.pmIn);
check('PM Departure = 5:21', row17 && row17.pmOut === '5:21', row17 && row17.pmOut);
check('Undertime = 4h00 (absent morning only)', row17 && row17.utH === '4' && row17.utM === '0', row17 && `${row17.utH}h${row17.utM}`);

console.log('\n[2] ID 154 @ 2026-08-18 — normal 4-punch day (must be unchanged)');
const aug18 = [
  { log_type: 'Check-in',  log_time: '2026-08-18 06:20:09' },
  { log_type: 'Check-out', log_time: '2026-08-18 12:04:54' },
  { log_type: 'Check-in',  log_time: '2026-08-18 12:40:59' },
  { log_type: 'Check-out', log_time: '2026-08-18 17:30:52' },
];
const row18 = dayRow(generateDTRHtml('Test', 'August', '2026', aug18, null, {}), 18);
check('AM In 6:20 · AM Out 12:04 · PM In 12:40 · PM Out 5:30',
  row18 && row18.amIn === '6:20' && row18.amOut === '12:04' && row18.pmIn === '12:40' && row18.pmOut === '5:30',
  row18 && JSON.stringify(row18));
check('No undertime', row18 && row18.utH === '' && row18.utM === '', row18 && `${row18.utH}h${row18.utM}`);

console.log('\n[3] Legitimate backfill preserved — morning attended, Check-out lands in PM band');
const backfill = [
  { log_type: 'Check-in',  log_time: '2026-08-20 08:00:00' },
  { log_type: 'Check-out', log_time: '2026-08-20 13:30:00' }, // forgot AM out, left after lunch
  { log_type: 'Check-in',  log_time: '2026-08-20 14:00:00' },
  { log_type: 'Check-out', log_time: '2026-08-20 17:00:00' },
];
const rowB = dayRow(generateDTRHtml('Test', 'August', '2026', backfill, null, {}), 20);
check('AM In 8:00, AM Out backfilled 1:30, PM In 2:00, PM Out 5:00',
  rowB && rowB.amIn === '8:00' && rowB.amOut === '1:30' && rowB.pmIn === '2:00' && rowB.pmOut === '5:00',
  rowB && JSON.stringify(rowB));

console.log('\n[4] Lunch pattern unchanged — Check-out 12:06 (AM band) still fills AM Out');
const lunch = [
  { log_type: 'Check-in',  log_time: '2026-08-21 07:50:44' },
  { log_type: 'Check-out', log_time: '2026-08-21 12:06:12' },
  { log_type: 'Check-in',  log_time: '2026-08-21 12:57:12' },
  { log_type: 'Check-out', log_time: '2026-08-21 17:24:56' },
];
const rowL = dayRow(generateDTRHtml('Test', 'August', '2026', lunch, null, {}), 21);
check('AM In 7:50 · AM Out 12:06 · PM In 12:57 · PM Out 5:24',
  rowL && rowL.amIn === '7:50' && rowL.amOut === '12:06' && rowL.pmIn === '12:57' && rowL.pmOut === '5:24',
  rowL && JSON.stringify(rowL));

console.log('\n[5] Half-day afternoon start — Check-in 13:00 only (no Check-out at all)');
const pmStart = [
  { log_type: 'Check-in',  log_time: '2026-08-24 13:00:00' },
  { log_type: 'Check-out', log_time: '2026-08-24 17:00:00' },
];
const rowP = dayRow(generateDTRHtml('Test', 'August', '2026', pmStart, null, {}), 24);
check('AM blank, PM In 1:00, PM Out 5:00, undertime 4h',
  rowP && rowP.amIn === '' && rowP.amOut === '' && rowP.pmIn === '1:00' && rowP.pmOut === '5:00' && rowP.utH === '4',
  rowP && JSON.stringify(rowP));

console.log('\n[6] Schedule-driven boundary — config Change must move the AM/PM split');
// User rule: "12:01 to 12:30 is AM check-out. 12:31 to 1pm is PM check-in"
// (matches stored config: am_time_out 12:20, pm_time_in 12:35 → boundary 12:30).
// With a DIFFERENT config (AM out 12:50, PM in 13:10 → boundary 13:00), the
// same scans must classify differently — proving bands follow Time Config.
const altSched = {
  am_time_in: '07:00', am_time_in_end: '08:00',
  am_time_out_start: '12:30', am_time_out: '12:50',
  pm_time_in: '13:10', pm_time_in_end: '13:40',
  pm_time_out_start: '17:00', pm_time_out: '18:00'
};
const scanDay = [
  { log_type: 'Check-in',  log_time: '2026-08-25 08:00:00' },
  { log_type: 'Check-out', log_time: '2026-08-25 12:55:00' }, // after default boundary (12:30)...
  { log_type: 'Check-in',  log_time: '2026-08-25 13:05:00' }, // ...but INSIDE alt AM-out window
  { log_type: 'Check-out', log_time: '2026-08-25 17:00:00' },
];
// With the real (default) schedule: 12:55 out closes the morning (missed AM
// scan-out backfill); 13:05 in is PM In (5 min late vs pm_time_in_end 13:00)
const rowD1 = dayRow(generateDTRHtml('Test', 'August', '2026', scanDay, null, {}), 25);
check('Default config: 12:55 out = AM Out (backfill), 13:05 in = PM In, 5m undertime',
  rowD1 && rowD1.amOut === '12:55' && rowD1.pmIn === '1:05' && rowD1.utH === '0' && rowD1.utM === '5', rowD1 && JSON.stringify(rowD1));
// With the alt schedule: 12:55 is inside 12:30–13:00 AM-out window → AM Out; 13:05 → PM In
const rowD2 = dayRow(generateDTRHtml('Test', 'August', '2026', scanDay, altSched, {}), 25);
check('Alt config (out until 12:50, PM in from 13:10): 12:55 is AM Out, 13:05 is PM In',
  rowD2 && rowD2.amOut === '12:55' && rowD2.pmIn === '1:05', rowD2 && JSON.stringify(rowD2));

// Boundary proof with CHECK-INS: 12:45 in + 13:20 in + 17:00 out.
// Default config (boundary 12:30): 12:45 in → PM In (first PM check-in wins).
// Alt config (boundary 13:00):    12:45 in → inside AM-out window (not an
// arrival), 13:20 in → PM In. Same scans, different slots — config-driven.
const checkinDay = [
  { log_type: 'Check-in',  log_time: '2026-08-26 08:00:00' },
  { log_type: 'Check-in',  log_time: '2026-08-26 12:45:00' },
  { log_type: 'Check-in',  log_time: '2026-08-26 13:20:00' },
  { log_type: 'Check-out', log_time: '2026-08-26 17:00:00' },
];
const rowD3 = dayRow(generateDTRHtml('Test', 'August', '2026', checkinDay, null, {}), 26);
check('Default config: 12:45 in = PM In (after 12:30 boundary)',
  rowD3 && rowD3.pmIn === '12:45', rowD3 && JSON.stringify(rowD3));
const rowD4 = dayRow(generateDTRHtml('Test', 'August', '2026', checkinDay, altSched, {}), 26);
check('Alt config: 12:45 in skipped (AM-out window), 13:20 in = PM In (boundary now 13:00)',
  rowD4 && rowD4.pmIn === '1:20', rowD4 && JSON.stringify(rowD4));

console.log('\n[7] Forgot to check in — first scan is a morning Check-out (kept, not dropped)');
const forgotIn = [
  { log_type: 'Check-out', log_time: '2026-08-27 11:01:00' },
  { log_type: 'Check-in',  log_time: '2026-08-27 12:40:00' },
  { log_type: 'Check-out', log_time: '2026-08-27 17:00:00' },
];
const rowF = dayRow(generateDTRHtml('Test', 'August', '2026', forgotIn, null, {}), 27);
check('AM Out 11:01 kept despite no AM In (forgot to check in)',
  rowF && rowF.amIn === '' && rowF.amOut === '11:01', rowF && JSON.stringify(rowF));
check('PM In 12:40 · PM Out 5:00', rowF && rowF.pmIn === '12:40' && rowF.pmOut === '5:00', rowF && JSON.stringify(rowF));
check('Undertime = 4h (absent arrival, departure present)', rowF && rowF.utH === '4' && rowF.utM === '0', rowF && `${rowF.utH}h${rowF.utM}`);

console.log('\n──────────────────────────────');
if (failures === 0) console.log('ALL CHECKS PASSED ✅');
else { console.error(`${failures} CHECK(S) FAILED ❌`); process.exit(1); }
