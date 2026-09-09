// DTR HTML generation module

const monthIndex = { "January": 0, "February": 1, "March": 2, "April": 3, "May": 4, "June": 5, "July": 6, "August": 7, "September": 8, "October": 9, "November": 10, "December": 11 };

function formatTime(dateStr) {
  if (!dateStr) return '';
  // dateStr is 'YYYY-MM-DD HH:MM:SS' from DATE_FORMAT
  const timePart = dateStr.substring(11); // 'HH:MM:SS'
  const [h, m] = timePart.split(':').map(Number);
  let hours = h % 12;
  hours = hours ? hours : 12;
  const minutes = m < 10 ? '0' + m : m;
  return `${hours}:${minutes}`;
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function toMinutesOrNull(timeStr) {
  if (!timeStr) return null;
  const parts = String(timeStr).split(':');
  if (parts.length < 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

const DEFAULT_SCHEDULE = {
  am_time_in: '07:00', am_time_in_end: '08:00',
  am_time_out_start: '12:00', am_time_out: '12:20',
  pm_time_in: '12:35', pm_time_in_end: '13:00',
  pm_time_out_start: '17:00', pm_time_out: '18:00'
};

/**
 * Assign a day's attendance logs to the four DTR slots using the Time
 * Schedule Configuration (Admin → Time Schedule Configuration modal) instead
 * of hard-coded clock times:
 *
 *   AM Arrival    : Check-in before am_time_out_start            (e.g. < 12:00)
 *   AM Departure  : ANY scan from am_time_out_start up to the lunch boundary
 *                   (e.g. 12:00–12:30) — "12:01 to 12:30 is check-out". The
 *                   stored in/out state is NOT consulted here: device states
 *                   get mis-toggled, the time window is authoritative.
 *   PM Arrival    : first scan after the lunch boundary up to pm_time_out_start
 *                   (e.g. 12:31–16:59) — "12:31 to 1:00 PM is PM check-in"
 *   PM Departure  : Check-out at/after pm_time_out_start        (e.g. ≥ 17:00)
 *   PM Departure  : Check-out at/after pm_time_out_start        (e.g. ≥ 17:00)
 *
 * The lunch boundary is the midpoint between am_time_out and pm_time_in,
 * rounded to the nearest 5 minutes (12:20 & 12:35 → 12:30).
 *
 * Edge cases:
 *  - A morning Check-out with no recorded AM Arrival is kept as the AM
 *    Departure — the teacher forgot to check in on arrival; the scan is NOT
 *    dropped from the DTR.
 *  - A Check-out inside the PM window backfills AM Departure when the morning
 *    was attended but no AM-out scan exists (forgot to scan out at lunch);
 *    if AM Departure is already filled it is an early PM Departure.
 *  - Arrivals keep their first scan; the PM departure keeps the last scan.
 *
 * Returns { amInLog, amOutLog, pmInLog, pmOutLog, amInMins, amOutMins, pmInMins, pmOutMins }.
 */
function classifyDayLogs(dayLogs, schedule) {
  const s = schedule || DEFAULT_SCHEDULE;
  const amOutStartRaw = toMinutesOrNull(s.am_time_out_start);
  const amOutEnd = toMinutesOrNull(s.am_time_out);
  const pmInStart = toMinutesOrNull(s.pm_time_in);
  const pmOutStartRaw = toMinutesOrNull(s.pm_time_out_start);
  const amOutStartM = amOutStartRaw !== null ? amOutStartRaw : 720;   // 12:00 fallback
  const pmOutStartM = pmOutStartRaw !== null ? pmOutStartRaw : 1020;  // 17:00 fallback

  let lunchBoundary;
  if (amOutEnd !== null && pmInStart !== null && pmInStart > amOutEnd) {
    lunchBoundary = Math.round((amOutEnd + pmInStart) / 10) * 5;
  } else {
    lunchBoundary = (amOutEnd !== null ? amOutEnd : 740) + 5;
  }

  const recs = (dayLogs || [])
    .map(l => {
      const tp = String(l.log_time || '');
      const mins = tp.length >= 16 ? toMinutesOrNull(tp.substring(11, 16)) : null;
      return { log: l, type: l.log_type, mins };
    })
    .filter(r => r.mins !== null && r.type)
    .sort((a, b) => String(a.log.log_time).localeCompare(String(b.log.log_time)));

  const out = { amInLog: null, amOutLog: null, pmInLog: null, pmOutLog: null,
                amInMins: null, amOutMins: null, pmInMins: null, pmOutMins: null };

  for (const r of recs) {
    if (r.mins < amOutStartM) {                      // morning (e.g. < 12:00)
      if (r.type === 'Check-in' && !out.amInLog) { out.amInLog = r.log; out.amInMins = r.mins; }
      else if (r.type === 'Check-out' && !out.amOutLog) {
        // A morning departure — even as the first scan of the day. No recorded
        // arrival means the teacher forgot to check in; the scan is kept.
        out.amOutLog = r.log; out.amOutMins = r.mins;
      }
    } else if (r.mins <= lunchBoundary) {            // AM check-out window (12:00–12:30)
      // "12:01 to 12:30 is check-out" — ANY scan in this window is the AM
      // departure, regardless of the stored in/out state (states get
      // mis-toggled on the device; the Time Config window is authoritative).
      if (!out.amOutLog) { out.amOutLog = r.log; out.amOutMins = r.mins; }
    } else if (r.mins < pmOutStartM) {               // PM window (12:31–16:59)
      if (r.type === 'Check-out' && out.amInMins !== null && out.amOutMins === null) {
        // Missed AM scan-out: this departure closes the morning session
        out.amOutLog = r.log; out.amOutMins = r.mins;
      } else if (!out.pmInLog) {
        // "12:31 to 1:00 PM is PM check-in" — the first scan in the window is
        // the PM arrival, regardless of stored state (later arrivals keep PM
        // In and are charged tardiness by the undertime calculation)
        out.pmInLog = r.log; out.pmInMins = r.mins;
      } else if (r.type === 'Check-out' && out.pmOutMins === null) {
        // Left before pm_time_out_start with the afternoon already started
        out.pmOutLog = r.log; out.pmOutMins = r.mins;
      }
    } else {                                         // from pm_time_out_start (≥ 17:00)
      if (r.type === 'Check-out') { out.pmOutLog = r.log; out.pmOutMins = r.mins; }
    }
  }
  return out;
}

function getDayOfWeek(year, month, day) {
  const m = monthIndex[month];
  if (m === undefined) return -1;
  const d = new Date(parseInt(year), m, day);
  return d.getDay(); // 0=Sun, 6=Sat
}

function generateDTRHtml(name, month, year, logs = [], schedule = null, holidays = {}) {
  // Use provided schedule or defaults
  const sched = schedule || { 
    am_time_in: '07:00', 
    am_time_in_end: '08:00',
    am_time_out_start: '12:00', 
    am_time_out: '12:20',
    pm_time_in: '12:35', 
    pm_time_in_end: '13:00',
    pm_time_out_start: '17:00',
    pm_time_out: '18:00' 
  };

  const sAmIn = timeToMinutes(sched.am_time_in);
  const sAmInEnd = timeToMinutes(sched.am_time_in_end);
  const sAmOutStart = timeToMinutes(sched.am_time_out_start);
  const sAmOut = timeToMinutes(sched.am_time_out);
  const sPmIn = timeToMinutes(sched.pm_time_in);
  const sPmInEnd = timeToMinutes(sched.pm_time_in_end);
  const sPmOutStart = timeToMinutes(sched.pm_time_out_start);
  const sPmOut = timeToMinutes(sched.pm_time_out);

  const principalName = localStorage.getItem('principalName') || '';
  const principalPosition = localStorage.getItem('principalPosition') || '';
  const principalSignature = localStorage.getItem('principalSignature') || '';

  const logsByDay = {};
  logs.forEach(l => {
    // log_time is 'YYYY-MM-DD HH:MM:SS' string from DATE_FORMAT
    const d = parseInt(l.log_time.substring(8, 10));
    if (!logsByDay[d]) logsByDay[d] = [];
    logsByDay[d].push(l);
  });

  // Build a date-keyed lookup for holidays
  // Month param is name like "June", convert to numeric month
  const monthNum = (monthIndex[month] !== undefined ? monthIndex[month] + 1 : 1).toString().padStart(2, '0');

  let rows = '';
  let totalUndertimeMins = 0;

  // Pre-compute training blocks for spanning entries
  const trainingBlocks = {};
  {
    let blockStart = 0;
    let blockDesc = '';
    for (let d = 1; d <= 31; d++) {
      const ds = `${year}-${monthNum}-${String(d).padStart(2, '0')}`;
      const h = holidays[ds];
      if (h && h.type === 'training') {
        const desc = h.description || 'Training';
        if (blockStart === 0 || desc !== blockDesc) {
          blockStart = d;
          blockDesc = desc;
        }
        trainingBlocks[d] = { start: blockStart, description: desc };
      } else {
        blockStart = 0;
        blockDesc = '';
      }
    }
    const blockSpans = {};
    for (let d = 1; d <= 31; d++) {
      if (trainingBlocks[d]) {
        const start = trainingBlocks[d].start;
        if (!blockSpans[start]) blockSpans[start] = 0;
        blockSpans[start]++;
      }
    }
    for (const start in blockSpans) {
      if (trainingBlocks[start]) trainingBlocks[start].span = blockSpans[start];
    }
  }

  for (let i = 1; i <= 31; i++) {
    const dow = getDayOfWeek(year, month, i);
    const isSat = dow === 6;
    const isSun = dow === 0;
    const isWeekend = isSat || isSun;
    // Check if this day is a holiday/suspension
    const dateStr = `${year}-${monthNum}-${String(i).padStart(2, '0')}`;
    const holiday = holidays[dateStr];
    const isHoliday = holiday && holiday.type === 'holiday';
    const isSuspension = holiday && holiday.type === 'suspension';
    const isTraining = holiday && holiday.type === 'training';
    const isHalfDay = holiday && holiday.is_half_day;
    const halfDayPeriod = holiday ? holiday.half_day_period : null;

    const dayLogs = logsByDay[i] || [];

    // Slot assignment driven by the Time Schedule Configuration
    // (Admin → Time Schedule Configuration) instead of hard-coded bands.
    const slots = classifyDayLogs(dayLogs, sched);
    let amIn = slots.amInLog ? formatTime(slots.amInLog.log_time) : '';
    let amOut = slots.amOutLog ? formatTime(slots.amOutLog.log_time) : '';
    let pmIn = slots.pmInLog ? formatTime(slots.pmInLog.log_time) : '';
    let pmOut = slots.pmOutLog ? formatTime(slots.pmOutLog.log_time) : '';
    let amInMins = slots.amInMins, amOutMins = slots.amOutMins;
    let pmInMins = slots.pmInMins, pmOutMins = slots.pmOutMins;

    // ─── Holiday / Suspension Display Logic ───────────────────
    let dayDisplay = `${i}`;

    let holidayStyle = '';
    let holidayCellLabel = '';

    if (isHoliday) {
      holidayCellLabel = holiday.description || 'Holiday';
      holidayStyle = 'font-style:italic;';
    } else if (isSuspension) {
      holidayCellLabel = holiday.description || 'Class Suspension';
      holidayStyle = 'font-style:italic;';
    } else if (isTraining) {
      const blockInfo = trainingBlocks[i];
      holidayCellLabel = blockInfo ? blockInfo.description : 'Training';
      holidayStyle = 'font-style:italic;';
    } else if (isSat) {
      holidayCellLabel = 'Saturday';
    } else if (isSun) {
      holidayCellLabel = 'Sunday';
    }

    // Calculate tardiness and undertime for this day
    let dailyUndertime = 0;

    // Full-day holiday/suspension: no undertime, span label across all columns
    if (isHoliday || (isSuspension && !isHalfDay)) {
      dailyUndertime = 0;
      amIn = '__COLSPAN__';
      amOut = ''; pmIn = ''; pmOut = '';
      amInMins = null; amOutMins = null;
      pmInMins = null; pmOutMins = null;
    }
    // Training: no undertime, spanning entry
    else if (isTraining) {
      dailyUndertime = 0;
      const blockInfo = trainingBlocks[i];
      const isFirstDay = blockInfo && blockInfo.start === i;
      const span = blockInfo ? blockInfo.span : 1;
      if (isFirstDay && span > 1) {
        amIn = `__SPAN_${span}__`;
        amOut = ''; pmIn = ''; pmOut = '';
      } else if (!isFirstDay) {
        amIn = '__SKIP__'; amOut = ''; pmIn = ''; pmOut = '';
      } else {
        amIn = '__COLSPAN__';
        amOut = ''; pmIn = ''; pmOut = '';
      }
      amInMins = null; amOutMins = null;
      pmInMins = null; pmOutMins = null;
    }
    // Half-day suspension: only one half is affected
    else if (isSuspension && isHalfDay) {
      if (halfDayPeriod === 'AM') {
        // AM is suspended — show label in AM cells
        amIn = holidayCellLabel;
        amOut = holidayCellLabel;
        amInMins = null; amOutMins = null;
      } else if (halfDayPeriod === 'PM') {
        // PM is suspended — show label in PM cells
        pmIn = holidayCellLabel;
        pmOut = holidayCellLabel;
        pmInMins = null; pmOutMins = null;
      }
      
      // Now calculate undertime only for the active half
      if (!isWeekend) {
        if (halfDayPeriod !== 'AM') {
          if (amInMins === null || amOutMins === null) {
            dailyUndertime += 240;
          } else {
            if (amInMins > sAmInEnd) dailyUndertime += (amInMins - sAmInEnd);
            if (amOutMins < sAmOutStart) dailyUndertime += (sAmOutStart - amOutMins);
          }
        }
        if (halfDayPeriod !== 'PM') {
          if (pmInMins === null || pmOutMins === null) {
            dailyUndertime += 240;
          } else {
            if (pmInMins > sPmInEnd) dailyUndertime += (pmInMins - sPmInEnd);
            if (pmOutMins < sPmOutStart) dailyUndertime += (sPmOutStart - pmOutMins);
          }
        }
      }
    }
    // Weekend: no undertime, span label across all columns
    else if (isWeekend) {
      dailyUndertime = 0;
      amIn = '__COLSPAN__';
      amOut = ''; pmIn = ''; pmOut = '';
      amInMins = null; amOutMins = null;
      pmInMins = null; pmOutMins = null;
    }
    // Normal day (not a holiday/suspension)
    else if (!isWeekend && (amIn || amOut || pmIn || pmOut)) {
      // Rule 3: AM In exists, no AM Out, no PM In, but PM Out exists → absent whole day (8 hours)
      if (amInMins !== null && amOutMins === null && pmInMins === null && pmOutMins !== null) {
        dailyUndertime = 480; // 8 hours
      } else {
        // --- Morning ---
        if (amInMins === null || amOutMins === null) {
          // Missing check-in, check-out, or both -> absent morning (4 hours)
          dailyUndertime += 240;
        } else {
          // AM Tardiness: Late if after am_time_in_end (grace period)
          if (amInMins > sAmInEnd) {
            dailyUndertime += (amInMins - sAmInEnd);
          }
          // AM Undertime: Leaving before am_time_out_start
          if (amOutMins < sAmOutStart) {
            dailyUndertime += (sAmOutStart - amOutMins);
          }
        }

        // --- Afternoon ---
        if (pmInMins === null || pmOutMins === null) {
          // Missing check-in, check-out, or both -> absent afternoon (4 hours)
          dailyUndertime += 240;
        } else {
          // PM Tardiness: Late if after pm_time_in_end (grace period)
          if (pmInMins > sPmInEnd) {
            dailyUndertime += (pmInMins - sPmInEnd);
          }
          // PM Undertime: Leaving before pm_time_out_start
          if (pmOutMins < sPmOutStart) {
            dailyUndertime += (sPmOutStart - pmOutMins);
          }
        }
      }
    }

    let utHours = '', utMins = '';
    if (dailyUndertime > 0) {
      utHours = Math.floor(dailyUndertime / 60).toString();
      utMins = (dailyUndertime % 60).toString();
      totalUndertimeMins += dailyUndertime;
    }

    const specialStyle = holidayStyle || '';

    if (amIn === '__SKIP__') {
      // Continuation of multi-day training: rowspan covers time+undertime columns
      rows += `<tr style="${specialStyle}"><td>${dayDisplay}</td></tr>`;
    } else if (amIn.startsWith('__SPAN_')) {
      // First day of multi-day training: rowspan + colspan across all time + undertime columns
      const span = parseInt(amIn.replace('__SPAN_', '').replace('__', ''));
      rows += `<tr style="${specialStyle}"><td>${dayDisplay}</td><td rowspan="${span}" colspan="6" style="vertical-align:middle;text-align:center;">${holidayCellLabel}</td></tr>`;
    } else if (amIn === '__COLSPAN__') {
      // Single day training or full-day holiday/suspension: colspan across all time + undertime columns
      rows += `<tr style="${specialStyle}"><td>${dayDisplay}</td><td colspan="6" style="text-align:center;">${holidayCellLabel}</td></tr>`;
    } else {
      rows += `<tr style="${specialStyle}"><td>${dayDisplay}</td><td>${amIn}</td><td>${amOut}</td><td class="thick-col">${pmIn}</td><td class="thick-col">${pmOut}</td><td>${utHours}</td><td>${utMins}</td></tr>`;
    }
  }

  const totalH = Math.floor(totalUndertimeMins / 60);
  const totalM = totalUndertimeMins % 60;
  const totalHStr = totalH > 0 ? totalH.toString() : '';
  const totalMStr = totalM > 0 ? totalM.toString() : '';

  return `
    <div class="dtr-printable-area">
      <div class="dtr-header">
        <div class="cs-form-label">Civil Service Form No. 48</div>
        <div class="dtr-title">DAILY TIME RECORD</div>
        <div class="dtr-title-underline"></div>
      </div>
      <div class="dtr-name-section">
        <div class="dtr-name-line" style="font-weight:bold;font-size:16px;padding-bottom:2px;">${name}</div>
        <span class="dtr-name-label">(Name)</span>
      </div>
      <div class="info-grid">
        <div class="field">
          <span>For the month of</span>
          <span style="border-bottom:1px dashed #000;width:120px;text-align:center;">${month}</span>
          <span>, 20</span>
          <span style="border-bottom:1px dashed #000;width:40px;text-align:center;">${year.substring(2)}</span>
        </div>
      </div>
      <div class="info-grid" style="align-items:flex-start;">
        <div class="field" style="flex-direction:column;width:40%;">
          <span>Official hours of arrival</span>
          <span style="text-align:right;">and departure</span>
        </div>
        <div class="field" style="flex-direction:column;width:55%;">
          <div><span>Regular Days</span><span style="border-bottom:1px dashed #000;display:inline-block;width:100px;"></span></div>
          <div><span>Saturdays</span><span style="border-bottom:1px dashed #000;display:inline-block;width:115px;"></span></div>
        </div>
      </div>
      <table class="dtr-table">
        <colgroup>
          <col style="width:12%">
          <col style="width:15%">
          <col style="width:15%">
          <col style="width:15%">
          <col style="width:15%">
          <col style="width:14%">
          <col style="width:14%">
        </colgroup>
        <thead>
          <tr><th rowspan="2">Days</th><th colspan="2" style="font-weight:bold;">A.M.</th><th colspan="2" class="thick-col" style="font-weight:bold;">P.M.</th><th colspan="2" style="font-weight:bold;">Undertime</th></tr>
          <tr><th>Arrival</th><th>Departure</th><th class="thick-col">Arrival</th><th class="thick-col">Departure</th><th>Hours</th><th>Minutes</th></tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="thick-top"><td style="text-align:left;font-weight:bold" colspan="5">TOTAL</td><td>${totalHStr}</td><td>${totalMStr}</td></tr>
        </tbody>
      </table>
      <div class="certify-text">I CERTIFY on my honor that the above is a true and correct report of the hours of work performed, record of which was made daily at the time of arrival and departure from office.</div>
      <div style="margin-top:5px;width:100%;text-align:center;">
        <div style="font-weight:bold;font-size:12px;text-transform:uppercase;">${name}</div>
        <div style="border-bottom:1px dashed #000;height:5px;width:100%;"></div>
      </div>
      <div style="text-align:left;font-size:12px;font-style:italic;margin-top:15px;margin-bottom:5px;">VERIFIED as to the prescribed office hours:</div>
      <div style="margin-top:25px;width:100%;text-align:center;position:relative;">
        ${principalSignature ? `<img src="${principalSignature}" style="max-height:60px;max-width:200px;position:absolute;bottom:20px;left:50%;transform:translateX(-50%);z-index:1;">` : ''}
        <div style="font-weight:bold;font-size:14px;position:relative;z-index:2;">${principalName}</div>
        <div class="in-charge-line" style="width:100%;">${principalPosition || 'In-Charge'}</div>
      </div>
      <div class="instructions-text">(See Instructions on back)</div>
    </div>`;
}

module.exports = { generateDTRHtml, formatTime, classifyDayLogs, DEFAULT_SCHEDULE };
