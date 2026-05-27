const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

/**
 * NGTeco Cloud Biometric Service
 * 
 * NGTeco smart devices (CR series, etc.) are cloud-only — they sync attendance
 * data to the NGTeco Office cloud platform (office.ngteco.com) rather than
 * exposing a local TCP/UDP port.
 * 
 * This service handles importing attendance data exported from the NGTeco
 * Office portal (CSV or Excel format) into the local database.
 */
class BiometricService {

  /**
   * Parse an exported attendance file (CSV or Excel) from NGTeco Office.
   * 
   * NGTeco exports typically contain columns like:
   *   - Employee ID / User ID / ID
   *   - Employee Name / Name
   *   - Date
   *   - Clock-In / Check-In / Time In
   *   - Clock-Out / Check-Out / Time Out
   *   
   * Some exports have one row per punch (with a single timestamp),
   * others have one row per day (with in/out columns).
   * 
   * @param {string} filePath - Absolute path to the CSV/XLSX file
   * @returns {{success: boolean, data?: Array, message?: string, headers?: string[]}}
   */
  parseAttendanceFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, message: `File not found: ${filePath}` };
      }

      const ext = path.extname(filePath).toLowerCase();
      let rows = [];
      let isTimecardFormat = false;
      let timecardResult = null;

      if (ext === '.csv' || ext === '.dat') {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Check for Timecard Report format before standard CSV parsing
        if (this._isTimecardReport(content)) {
          isTimecardFormat = true;
          timecardResult = this._parseTimecardCSV(content);
        } else {
          rows = this._parseCSV(content);
        }
      } else if (ext === '.xlsx' || ext === '.xls') {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        // Check for Timecard Report format in Excel too
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (rawRows.length > 0 && String(rawRows[0][0] || '').trim().toLowerCase().startsWith('timecard')) {
          isTimecardFormat = true;
          timecardResult = this._parseTimecardExcel(rawRows);
        } else {
          rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        }
      } else {
        return { success: false, message: `Unsupported file format: ${ext}. Use .csv, .xlsx, .xls or .dat` };
      }

      // If Timecard Report format was detected, return its result directly
      if (isTimecardFormat) {
        if (!timecardResult || !timecardResult.success) {
          return timecardResult || { success: false, message: 'Failed to parse Timecard Report.' };
        }
        console.log(`[BiometricService] Timecard Report: ${timecardResult.data.length} records for employee "${timecardResult.employeeName}".`);
        return timecardResult;
      }

      if (rows.length === 0) {
        return { success: false, message: 'File is empty or has no data rows.' };
      }

      const headers = Object.keys(rows[0]);
      console.log('[BiometricService] Parsed file headers:', headers);
      console.log('[BiometricService] First row sample:', JSON.stringify(rows[0]));
      console.log('[BiometricService] Total rows:', rows.length);

      // Try to auto-detect column mapping
      const mapping = this._detectColumnMapping(headers);
      console.log('[BiometricService] Auto-detected mapping:', JSON.stringify(mapping));

      // Parse rows into normalized attendance records
      const records = this._normalizeRecords(rows, mapping);
      console.log(`[BiometricService] Normalized ${records.length} attendance record(s).`);

      return {
        success: true,
        data: records,
        headers,
        mapping,
        rawRowCount: rows.length,
        message: `Parsed ${records.length} attendance record(s) from ${rows.length} row(s).`
      };
    } catch (err) {
      console.error('[BiometricService] Parse error:', err);
      return { success: false, message: `Failed to parse file: ${err.message}` };
    }
  }

  /**
   * Preview the raw data from a file (first 10 rows) for user confirmation.
   */
  previewFile(filePath) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      let rows = [];
      let isTimecardFormat = false;
      let timecardResult = null;

      if (ext === '.csv' || ext === '.dat') {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (this._isTimecardReport(content)) {
          isTimecardFormat = true;
          timecardResult = this._parseTimecardCSV(content);
        } else {
          rows = this._parseCSV(content);
        }
      } else if (ext === '.xlsx' || ext === '.xls') {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (rawRows.length > 0 && String(rawRows[0][0] || '').trim().toLowerCase().startsWith('timecard')) {
          isTimecardFormat = true;
          timecardResult = this._parseTimecardExcel(rawRows);
        } else {
          rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        }
      }

      // For Timecard Report format, build a friendly preview
      if (isTimecardFormat && timecardResult && timecardResult.success) {
        const previewHeaders = ['Employee', 'Date', 'Time', 'Type'];
        const previewRows = timecardResult.data.slice(0, 10).map(r => ({
          'Employee': r.name || r.employeeId,
          'Date': r.logTime ? r.logTime.substring(0, 10) : '',
          'Time': r.logTime ? r.logTime.substring(11) : '',
          'Type': r.logType
        }));
        return {
          success: true,
          headers: previewHeaders,
          preview: previewRows,
          totalRows: timecardResult.data.length,
          mapping: { employeeId: null, name: 'Employee', date: 'Date', timeIn: null, timeOut: null, timestamp: null, state: null },
          isTimecardFormat: true,
          employeeName: timecardResult.employeeName,
          employeeCount: timecardResult.employeeCount || 1,
          payPeriod: timecardResult.payPeriod
        };
      }

      const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      const preview = rows.slice(0, 10);
      const mapping = headers.length > 0 ? this._detectColumnMapping(headers) : {};

      return {
        success: true,
        headers,
        preview,
        totalRows: rows.length,
        mapping
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // ─── Timecard Report Format ─────────────────────────────────

  /**
   * Detect whether a CSV content is a Timecard Report format.
   * These files start with "Timecard Report" in the first cell.
   */
  _isTimecardReport(content) {
    const firstLine = content.split(/\r?\n/)[0] || '';
    return firstLine.trim().toLowerCase().startsWith('timecard');
  }

  /**
   * Parse a Timecard Report CSV file.
   * 
   * Format:
   *   Row 1: "Timecard Report"
   *   Row 2: (empty)
   *   Row 3: "Pay Period", "", "", "", "08/01/24-08/31/24"
   *   Row 4: "Employee", "", "", "", "Ivy Jane"
   *   Row 5: Column headers - Day, Date, IN, OUT, Work Time, Daily Total, Note
   *   Row 6+: Data rows
   * 
   * Data pattern:
   *   - First row of a date: has day name (THU), date (08/01/2024), IN time, OUT time, Work Time
   *   - Second row (optional): continuation with PM IN, PM OUT, PM Work Time, Daily Total
   *   - Some rows may only have partial data (e.g., "Missing OUT", "Missing IN")
   */
  _parseTimecardCSV(content) {
    try {
      const lines = content.split(/\r?\n/);
      console.log(`[Timecard] Total lines in file: ${lines.length}`);

      // Auto-detect delimiter from a line that has data
      let delimiter = ',';
      const sampleLine = lines.find(l => l.trim() && l.includes(',')) || '';
      if (sampleLine.includes('\t') && sampleLine.split('\t').length > sampleLine.split(',').length) {
        delimiter = '\t';
      } else if (sampleLine.includes(';') && sampleLine.split(';').length > sampleLine.split(',').length) {
        delimiter = ';';
      }

      // Parse all lines into arrays of values
      const allRows = lines.map(l => this._splitCSVLine(l, delimiter).map(v => v.trim()));

      // ── Split the file into employee sections ──
      // Each section starts with a "Timecard Report" or "Employee" line,
      // followed by a header row with "Date, IN, OUT", then data rows.
      const sections = [];
      let currentSection = null;

      for (let i = 0; i < allRows.length; i++) {
        const row = allRows[i];
        const firstCell = (row[0] || '').toLowerCase();

        // Detect start of a new section — "Timecard Report" is always a section start
        if (firstCell.startsWith('timecard')) {
          currentSection = { startIdx: i, employeeName: '', payPeriod: '', headerRowIdx: -1, colIdx: null };
          sections.push(currentSection);
          continue;
        }

        // "Employee" line: if we already have a section with data, start a new one
        if (firstCell.startsWith('employee') || firstCell === 'employee') {
          const empName = row.find((v, idx) => idx > 0 && v.trim()) || '';

          if (!currentSection) {
            // No section yet — create one
            currentSection = { startIdx: i, employeeName: empName, payPeriod: '', headerRowIdx: -1, colIdx: null };
            sections.push(currentSection);
          } else if (currentSection.headerRowIdx !== -1) {
            // Current section already has a header (and thus data) — this is a NEW employee
            currentSection = { startIdx: i, employeeName: empName, payPeriod: currentSection.payPeriod, headerRowIdx: -1, colIdx: null };
            sections.push(currentSection);
          } else {
            // Current section hasn't started data yet — just update the name
            currentSection.employeeName = empName;
          }
          continue;
        }

        if (!currentSection) continue;

        // Extract pay period metadata
        if (firstCell.startsWith('pay period') || firstCell === 'pay period') {
          currentSection.payPeriod = row.find((v, idx) => idx > 0 && v.trim()) || '';
          continue;
        }

        // Detect header row (Date, IN, OUT) within this section
        if (currentSection.headerRowIdx === -1) {
          const rowLower = row.map(c => c.toLowerCase());
          const hasDate = rowLower.some(c => c === 'date');
          const hasIn = rowLower.some(c => c === 'in' || c === 'time in');
          const hasOut = rowLower.some(c => c === 'out' || c === 'time out');
          if (hasDate && hasIn && hasOut) {
            currentSection.headerRowIdx = i;
            currentSection.colIdx = {
              day: -1,
              date: rowLower.findIndex(c => c === 'date'),
              timeIn: rowLower.findIndex(c => c === 'in' || c === 'time in'),
              timeOut: rowLower.findIndex(c => c === 'out' || c === 'time out'),
              note: rowLower.findIndex(c => c === 'note' || c === 'notes')
            };
            currentSection.colIdx.day = rowLower.findIndex(c => /^(day|dow)$/i.test(c));
            if (currentSection.colIdx.day === -1) currentSection.colIdx.day = 0;
          }
        }
      }

      console.log(`[Timecard] Found ${sections.length} employee section(s)`);

      // ── Determine end index for each section ──
      for (let s = 0; s < sections.length; s++) {
        sections[s].endIdx = (s + 1 < sections.length) ? sections[s + 1].startIdx : allRows.length;
      }

      // ── Parse data for each section ──
      const allRecords = [];
      const employeeNames = [];
      let payPeriod = '';

      for (const section of sections) {
        if (section.headerRowIdx === -1 || !section.colIdx) {
          console.log(`[Timecard] Skipping section for "${section.employeeName}" — no header row found`);
          continue;
        }

        const { colIdx, employeeName, endIdx, headerRowIdx } = section;
        if (employeeName) employeeNames.push(employeeName);
        if (section.payPeriod) payPeriod = section.payPeriod;

        console.log(`[Timecard] Processing section: "${employeeName}" (rows ${headerRowIdx + 1}-${endIdx - 1})`);

        // Validate column indices against actual data
        const sampleStart = headerRowIdx + 1;
        const sampleRows = allRows.slice(sampleStart, Math.min(sampleStart + 10, endIdx))
          .filter(r => r.length > 1 && !r.every(c => !c));

        if (sampleRows.length > 0) {
          // Validate date column
          const dateTestVal = sampleRows[0][colIdx.date] || '';
          if (!this._parseTimecardDate(dateTestVal)) {
            for (let c = 0; c < sampleRows[0].length; c++) {
              const testVal = sampleRows[0][c] || '';
              if (testVal && this._parseTimecardDate(testVal)) {
                colIdx.day = colIdx.date;
                colIdx.date = c;
                break;
              }
            }
          }
        }

        // Parse data rows for this section
        let currentDate = null;
        for (let i = headerRowIdx + 1; i < endIdx; i++) {
          const row = allRows[i];
          if (row.length < 2 || row.every(c => !c)) continue;

          const firstCell = (row[0] || '').toLowerCase();
          // Stop if we hit another section marker (safety check)
          if (firstCell.startsWith('timecard')) break;

          const dateCell = colIdx.date >= 0 ? (row[colIdx.date] || '') : '';
          const inCell = colIdx.timeIn >= 0 ? (row[colIdx.timeIn] || '') : '';
          const outCell = colIdx.timeOut >= 0 ? (row[colIdx.timeOut] || '') : '';

          const isPrimaryRow = !!dateCell;

          if (dateCell) {
            const parsed = this._parseTimecardDate(dateCell);
            if (parsed) currentDate = parsed;
          }

          if (!inCell && !outCell) continue;
          if (!currentDate) continue;

          let parsedIn = inCell ? this._parseTime(inCell) : null;
          let parsedOut = outCell ? this._parseTime(outCell) : null;

          // AM/PM adjustment
          if (!isPrimaryRow) {
            parsedIn = this._adjustTimecardPM(parsedIn);
            parsedOut = this._adjustTimecardPM(parsedOut);
          } else {
            if (parsedIn && parsedOut) {
              const inMins = this._timeToMinutes(parsedIn);
              const outMins = this._timeToMinutes(parsedOut);
              if (outMins < inMins) {
                parsedOut = this._adjustTimecardPM(parsedOut);
              }
            }
          }

          if (parsedIn) {
            allRecords.push({
              employeeId: '',
              name: employeeName,
              logTime: `${currentDate} ${parsedIn}`,
              logType: 'Check-in'
            });
          }
          if (parsedOut) {
            allRecords.push({
              employeeId: '',
              name: employeeName,
              logTime: `${currentDate} ${parsedOut}`,
              logType: 'Check-out'
            });
          }
        }
      }

      const uniqueEmployees = [...new Set(employeeNames)];
      console.log(`[Timecard] Parsing complete: ${allRecords.length} records for ${uniqueEmployees.length} employee(s): ${uniqueEmployees.join(', ')}`);

      const headers = ['Employee', 'Date', 'Time', 'Type'];
      return {
        success: true,
        data: allRecords,
        headers,
        mapping: { employeeId: null, name: 'Employee', date: 'Date', timeIn: null, timeOut: null, timestamp: null, state: null },
        rawRowCount: allRows.length,
        employeeName: uniqueEmployees.join(', '),
        employeeCount: uniqueEmployees.length,
        payPeriod,
        isTimecardFormat: true,
        message: `Timecard Report: Parsed ${allRecords.length} record(s) for ${uniqueEmployees.length} employee(s).`
      };
    } catch (err) {
      console.error('[Timecard] Parse error:', err);
      return { success: false, message: `Failed to parse Timecard Report: ${err.message}` };
    }
  }

  /**
   * Parse a Timecard Report from Excel raw rows (array of arrays).
   */
  _parseTimecardExcel(rawRows) {
    // Convert Excel raw rows back into CSV-like content for reuse
    const csvContent = rawRows.map(row => row.map(cell => {
      const s = String(cell === undefined || cell === null ? '' : cell);
      // Quote cells that contain commas
      if (s.includes(',')) return `"${s}"`;
      return s;
    }).join(',')).join('\n');
    return this._parseTimecardCSV(csvContent);
  }

  /**
   * Parse a date from Timecard Report format.
   * Handles: MM/DD/YYYY, MM/DD/YY, YYYY-MM-DD
   */
  _parseTimecardDate(val) {
    if (!val) return null;
    const s = String(val).trim();

    // MM/DD/YYYY
    let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }

    // MM/DD/YY (2-digit year)
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
    if (m) {
      const yy = parseInt(m[3]);
      const fullYear = yy >= 50 ? 1900 + yy : 2000 + yy;
      return `${fullYear}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }

    // YYYY-MM-DD
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
      return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    }

    // Fallback to the existing _parseDate method
    return this._parseDate(val);
  }

  /**
   * Adjust a time value for PM context in Timecard Reports.
   * If the hour is < 12, adds 12 to convert to 24-hour PM format.
   * E.g., "04:27:00" → "16:27:00", "12:34:00" → "12:34:00" (unchanged)
   */
  _adjustTimecardPM(timeStr) {
    if (!timeStr) return null;
    const m = timeStr.match(/^(\d{2}):(\d{2}):(\d{2})$/);
    if (!m) return timeStr;
    let hours = parseInt(m[1]);
    if (hours < 12) {
      hours += 12;
    }
    return `${String(hours).padStart(2, '0')}:${m[2]}:${m[3]}`;
  }

  /**
   * Convert a HH:MM:SS time string to total minutes for comparison.
   */
  _timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
  }

  // ─── Internal Helpers ───────────────────────────────────────

  /**
   * Parse CSV/DAT content. Supports comma, tab, and semicolon delimiters.
   */
  _parseCSV(content) {
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];

    // Auto-detect delimiter: try tab, semicolon, comma
    const firstLine = lines[0];
    let delimiter = ',';
    if (firstLine.includes('\t') && firstLine.split('\t').length > firstLine.split(',').length) {
      delimiter = '\t';
    } else if (firstLine.includes(';') && firstLine.split(';').length > firstLine.split(',').length) {
      delimiter = ';';
    }

    const headers = this._splitCSVLine(lines[0], delimiter);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this._splitCSVLine(lines[i], delimiter);
      if (values.length === 0) continue;
      const row = {};
      headers.forEach((h, idx) => {
        row[h.trim()] = (values[idx] || '').trim();
      });
      rows.push(row);
    }
    return rows;
  }

  _splitCSVLine(line, delimiter = ',') {
    if (delimiter === '\t' || delimiter === ';') {
      return line.split(delimiter);
    }
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === delimiter && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  /**
   * Auto-detect which columns map to which fields based on header names.
   */
  _detectColumnMapping(headers) {
    const mapping = { employeeId: null, name: null, date: null, timeIn: null, timeOut: null, timestamp: null, state: null };
    const lower = headers.map(h => h.toLowerCase().trim());

    // Employee ID detection
    const idPatterns = ['employee id', 'employeeid', 'emp id', 'empid', 'user id', 'userid', 'id', 'no', 'number', 'biometric id', 'badge'];
    for (const pat of idPatterns) {
      const idx = lower.findIndex(h => h === pat || h.includes(pat));
      if (idx !== -1) { mapping.employeeId = headers[idx]; break; }
    }

    // Name detection
    const namePatterns = ['employee name', 'employeename', 'name', 'full name', 'staff name', 'person'];
    for (const pat of namePatterns) {
      const idx = lower.findIndex(h => h === pat || h.includes(pat));
      if (idx !== -1 && headers[idx] !== mapping.employeeId) { mapping.name = headers[idx]; break; }
    }

    // Date detection
    const datePatterns = ['date', 'attendance date', 'att date', 'punch date', 'day'];
    for (const pat of datePatterns) {
      const idx = lower.findIndex(h => h === pat || h.includes(pat));
      if (idx !== -1) { mapping.date = headers[idx]; break; }
    }

    // Time In detection
    const inPatterns = ['clock-in', 'clockin', 'clock in', 'time in', 'timein', 'check-in', 'checkin', 'check in', 'punch in', 'first in', 'in time', 'start'];
    for (const pat of inPatterns) {
      const idx = lower.findIndex(h => h === pat || h.includes(pat));
      if (idx !== -1) { mapping.timeIn = headers[idx]; break; }
    }

    // Time Out detection  
    const outPatterns = ['clock-out', 'clockout', 'clock out', 'time out', 'timeout', 'check-out', 'checkout', 'check out', 'punch out', 'last out', 'out time', 'end'];
    for (const pat of outPatterns) {
      const idx = lower.findIndex(h => h === pat || h.includes(pat));
      if (idx !== -1) { mapping.timeOut = headers[idx]; break; }
    }

    // Single timestamp format detection (one row per punch — common in USB exports)
    const tsPatterns = ['time', 'timestamp', 'punch time', 'record time', 'datetime', 'date time'];
    for (const pat of tsPatterns) {
      const idx = lower.findIndex(h => h === pat || h === pat.replace(' ', ''));
      if (idx !== -1 && headers[idx] !== mapping.date && headers[idx] !== mapping.timeIn && headers[idx] !== mapping.timeOut) {
        mapping.timestamp = headers[idx];
        break;
      }
    }

    // State / Log Type detection (USB exports often have a 'State' or 'Type' column)
    const statePatterns = ['state', 'type', 'status', 'att state', 'log type', 'in/out', 'inout', 'direction'];
    for (const pat of statePatterns) {
      const idx = lower.findIndex(h => h === pat || h.includes(pat));
      if (idx !== -1 && headers[idx] !== mapping.employeeId && headers[idx] !== mapping.name && headers[idx] !== mapping.date) {
        mapping.state = headers[idx];
        break;
      }
    }

    return mapping;
  }

  /**
   * Normalize parsed rows into standardized attendance log records.
   * Handles both formats:
   *   - One row per day (with timeIn/timeOut columns)
   *   - One row per punch (with a single timestamp)
   *   - USB device exports (with state/type column for in/out)
   */
  _normalizeRecords(rows, mapping) {
    const records = [];

    for (const row of rows) {
      const employeeId = mapping.employeeId ? String(row[mapping.employeeId] || '').trim() : '';

      if (!employeeId) continue;

      // Determine log type from State column if available (common in USB exports)
      let logTypeFromState = null;
      if (mapping.state && row[mapping.state] !== undefined) {
        const stateVal = String(row[mapping.state]).trim().toLowerCase();
        // Common state values: 0=Check-in, 1=Check-out, or text values
        if (stateVal === '0' || stateVal === 'in' || stateVal === 'check-in' || stateVal === 'checkin' || stateVal === 'clock-in' || stateVal === 'clockin' || stateVal === 'c/in') {
          logTypeFromState = 'Check-in';
        } else if (stateVal === '1' || stateVal === 'out' || stateVal === 'check-out' || stateVal === 'checkout' || stateVal === 'clock-out' || stateVal === 'clockout' || stateVal === 'c/out') {
          logTypeFromState = 'Check-out';
        }
      }

      // Format A: Separate date + timeIn/timeOut columns (one row = one day)
      if (mapping.date && (mapping.timeIn || mapping.timeOut)) {
        const dateVal = this._parseDate(row[mapping.date]);
        if (!dateVal) continue;

        if (mapping.timeIn && row[mapping.timeIn]) {
          const timeIn = this._parseTime(row[mapping.timeIn]);
          if (timeIn) {
            records.push({
              employeeId,
              name: mapping.name ? row[mapping.name] : '',
              logTime: `${dateVal} ${timeIn}`,
              logType: 'Check-in'
            });
          }
        }

        if (mapping.timeOut && row[mapping.timeOut]) {
          const timeOut = this._parseTime(row[mapping.timeOut]);
          if (timeOut) {
            records.push({
              employeeId,
              name: mapping.name ? row[mapping.name] : '',
              logTime: `${dateVal} ${timeOut}`,
              logType: 'Check-out'
            });
          }
        }
      }
      // Format B: Single timestamp column (one row = one punch)
      else if (mapping.timestamp) {
        const ts = row[mapping.timestamp];
        if (!ts) continue;
        const parsed = this._parseDateTime(ts);
        if (!parsed) continue;

        records.push({
          employeeId,
          name: mapping.name ? row[mapping.name] : '',
          logTime: parsed,
          logType: logTypeFromState || 'Check-in' // Use state if available, else classified later during sync
        });
      }
      // Format C: Date column has full datetime
      else if (mapping.date) {
        const ts = row[mapping.date];
        if (!ts) continue;
        const parsed = this._parseDateTime(ts);
        if (!parsed) continue;

        records.push({
          employeeId,
          name: mapping.name ? row[mapping.name] : '',
          logTime: parsed,
          logType: logTypeFromState || 'Check-in'
        });
      }
    }

    return records;
  }

  /**
   * Parse a date string into YYYY-MM-DD format.
   */
  _parseDate(val) {
    if (!val) return null;
    const s = String(val).trim();

    // Try YYYY-MM-DD
    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

    // Try MM/DD/YYYY or DD/MM/YYYY
    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (m) {
      // Assume MM/DD/YYYY (US format, common in NGTeco)
      return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }

    // Try Excel serial number
    if (/^\d{5}$/.test(s)) {
      const date = new Date((parseInt(s) - 25569) * 86400 * 1000);
      if (!isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }

    return null;
  }

  /**
   * Parse a time string into HH:MM:SS format.
   */
  _parseTime(val) {
    if (!val) return null;
    const s = String(val).trim();

    // HH:MM:SS or HH:MM
    let m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      let hours = parseInt(m[1]);
      const mins = m[2];
      const secs = m[3] || '00';

      // Handle AM/PM
      if (/pm/i.test(s) && hours < 12) hours += 12;
      if (/am/i.test(s) && hours === 12) hours = 0;

      return `${String(hours).padStart(2, '0')}:${mins}:${secs}`;
    }

    // Excel decimal time (e.g., 0.354166... = 8:30 AM)
    const num = parseFloat(s);
    if (!isNaN(num) && num >= 0 && num < 1) {
      const totalMins = Math.round(num * 1440);
      const h = Math.floor(totalMins / 60);
      const min = totalMins % 60;
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
    }

    return null;
  }

  /**
   * Parse a full datetime string into YYYY-MM-DD HH:MM:SS format.
   */
  _parseDateTime(val) {
    if (!val) return null;
    const s = String(val).trim();

    // YYYY-MM-DD HH:MM:SS
    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')} ${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}`;
    }

    // MM/DD/YYYY HH:MM:SS
    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      let hours = parseInt(m[4]);
      if (/pm/i.test(s) && hours < 12) hours += 12;
      if (/am/i.test(s) && hours === 12) hours = 0;
      return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')} ${String(hours).padStart(2, '0')}:${m[5]}:${m[6] || '00'}`;
    }

    // Try native Date parsing as fallback
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 19).replace('T', ' ');
    }

    return null;
  }
}

module.exports = new BiometricService();
