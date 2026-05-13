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

function getDayOfWeek(year, month, day) {
  const m = monthIndex[month];
  if (m === undefined) return -1;
  const d = new Date(parseInt(year), m, day);
  return d.getDay(); // 0=Sun, 6=Sat
}

function generateDTRHtml(name, month, year, logs = [], schedule = null) {
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
  const principalSignature = localStorage.getItem('principalSignature') || '';

  const logsByDay = {};
  logs.forEach(l => {
    // log_time is 'YYYY-MM-DD HH:MM:SS' string from DATE_FORMAT
    const d = parseInt(l.log_time.substring(8, 10));
    if (!logsByDay[d]) logsByDay[d] = [];
    logsByDay[d].push(l);
  });

  let rows = '';
  let totalUndertimeMins = 0;

  for (let i = 1; i <= 31; i++) {
    const dow = getDayOfWeek(year, month, i);
    const isSat = dow === 6;
    const isSun = dow === 0;
    const isWeekend = isSat || isSun;
    const dayLabel = isSat ? 'Sat' : (isSun ? 'Sun' : '');

    const dayLogs = logsByDay[i] || [];
    let amIn = '', amOut = '', pmIn = '', pmOut = '';
    let amInMins = null, amOutMins = null, pmInMins = null, pmOutMins = null;

    dayLogs.forEach(l => {
      // log_time is always 'YYYY-MM-DD HH:MM:SS' from DATE_FORMAT
      const timePart = l.log_time.substring(11); // 'HH:MM:SS'
      const [hours, minutes] = timePart.split(':').map(Number);
      const mins = hours * 60 + minutes;

      // Classify logs based on time of day
      if (mins < 660) { // Before 11:00 AM
        if (l.log_type === 'Check-in') { amIn = formatTime(l.log_time); amInMins = mins; }
      }
      
      if (mins >= 660 && mins < 750) { // 11:00 AM to 12:30 PM
        if (l.log_type === 'Check-out') { amOut = formatTime(l.log_time); amOutMins = mins; }
        else if (l.log_type === 'Check-in' && !amIn) { amIn = formatTime(l.log_time); amInMins = mins; }
      }

      if (mins >= 750 && mins < 900) { // 12:30 PM to 3:00 PM
        if (l.log_type === 'Check-in') { pmIn = formatTime(l.log_time); pmInMins = mins; }
        else if (l.log_type === 'Check-out' && !amOut) { amOut = formatTime(l.log_time); amOutMins = mins; }
      }

      if (mins >= 900) { // After 3:00 PM
        if (l.log_type === 'Check-out') { pmOut = formatTime(l.log_time); pmOutMins = mins; }
      }
    });

    // Calculate tardiness and undertime for this day
    let dailyUndertime = 0;
    if (!isWeekend && (amIn || amOut || pmIn || pmOut)) {
      // Rule 3: AM In exists, no AM Out, no PM In, but PM Out exists → absent whole day (8 hours)
      if (amInMins !== null && amOutMins === null && pmInMins === null && pmOutMins !== null) {
        dailyUndertime = 480; // 8 hours
      } else {
        // --- Morning ---
        if (amInMins !== null && amOutMins === null) {
          // Rule 1: Timed in AM but never timed out AM → absent morning (4 hours)
          dailyUndertime += 240;
        } else {
          // AM Tardiness: Late if after am_time_in_end (grace period)
          if (amInMins !== null && amInMins > sAmInEnd) {
            dailyUndertime += (amInMins - sAmInEnd);
          }
          // AM Undertime: Leaving before am_time_out_start
          if (amOutMins !== null && amOutMins < sAmOutStart) {
            dailyUndertime += (sAmOutStart - amOutMins);
          }
        }

        // --- Afternoon ---
        if (pmInMins !== null && pmOutMins === null) {
          // Rule 1: Timed in PM but never timed out PM → absent afternoon (4 hours)
          dailyUndertime += 240;
        } else {
          // PM Tardiness: Late if after pm_time_in_end (grace period)
          if (pmInMins !== null && pmInMins > sPmInEnd) {
            dailyUndertime += (pmInMins - sPmInEnd);
          }
          // PM Undertime: Leaving before pm_time_out_start
          if (pmOutMins !== null && pmOutMins < sPmOutStart) {
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

    const weekendStyle = isWeekend ? 'background:#f9fafb;color:#9ca3af;font-style:italic;' : '';
    const dayDisplay = `${i}`;
    const amInDisplay = dayLabel ? dayLabel : amIn;

    rows += `<tr style="${weekendStyle}"><td>${dayDisplay}</td><td>${amInDisplay}</td><td>${amOut}</td><td class="thick-col">${pmIn}</td><td class="thick-col">${pmOut}</td><td>${utHours}</td><td>${utMins}</td></tr>`;
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
          <span style="border-bottom:1px solid #000;width:120px;text-align:center;">${month}</span>
          <span>, 20</span>
          <span style="border-bottom:1px solid #000;width:40px;text-align:center;">${year.substring(2)}</span>
        </div>
      </div>
      <div class="info-grid" style="align-items:flex-start;">
        <div class="field" style="flex-direction:column;width:40%;">
          <span>Official hours of arrival</span>
          <span style="text-align:right;">and departure</span>
        </div>
        <div class="field" style="flex-direction:column;width:55%;">
          <div><span>Regular Days</span><span style="border-bottom:1px solid #000;display:inline-block;width:100px;"></span></div>
          <div><span>Saturdays</span><span style="border-bottom:1px solid #000;display:inline-block;width:115px;"></span></div>
        </div>
      </div>
      <table class="dtr-table">
        <thead>
          <tr><th rowspan="2">Days</th><th colspan="2">A. M.</th><th colspan="2" class="thick-col">P. M.</th><th colspan="2">UNDER TIME</th></tr>
          <tr><th>ARRIVAL</th><th>DEPAR-<br>TURE</th><th class="thick-col">ARRIVAL</th><th class="thick-col">DEPAR-<br>TURE</th><th>Hours</th><th>Minutes</th></tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="thick-top"><td style="text-align:left;font-weight:bold" colspan="5">TOTAL</td><td>${totalHStr}</td><td>${totalMStr}</td></tr>
        </tbody>
      </table>
      <div class="certify-text">I CERTIFY on my honor that the above is a true and correct report of the hours of work performed, record of which was made daily at the time of arrival and departure from office.</div>
      <div class="signature-line"></div>
      <div class="double-signature-line"></div>
      <div style="margin-top:30px;margin-left:auto;width:250px;text-align:center;position:relative;">
        ${principalSignature ? `<img src="${principalSignature}" style="max-height:60px;max-width:200px;position:absolute;bottom:20px;left:50%;transform:translateX(-50%);z-index:1;">` : ''}
        <div style="font-weight:bold;font-size:14px;position:relative;z-index:2;padding-bottom:2px;">${principalName}</div>
        <div class="in-charge-line" style="width:100%;">In-Charge</div>
      </div>
      <div class="instructions-text">(See Instructions on back)</div>
    </div>`;
}

module.exports = { generateDTRHtml, formatTime };
