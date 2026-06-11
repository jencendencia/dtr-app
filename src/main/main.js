const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db } = require('../db/connection');
const biometricService = require('./biometricsService');

let currentSessionUser = 'System';

function logActivity(username, action, details) {
  try {
    db.prepare('INSERT INTO UserActivityLogs (username, action, details) VALUES (?, ?, ?)').run(username || 'System', action, details);
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, '../../build/icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Hide the default menu bar in production
  Menu.setApplicationMenu(null);

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.maximize();
}

// ─── Authentication ──────────────────────────────────────────

ipcMain.handle('login', async (event, username, password) => {
  try {
    console.log('Login attempt for user:', username);
    const user = db.prepare('SELECT * FROM Users WHERE username = ?').get(username);
    if (!user) {
      console.log('User not found:', username);
      logActivity(username, 'Login Failed', `User not found: "${username}"`);
      return { success: false, message: 'Invalid username or password.' };
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.log('Password mismatch for user:', username);
      logActivity(username, 'Login Failed', `Incorrect password for user: "${username}"`);
      return { success: false, message: 'Invalid username or password.' };
    }
    console.log('Login successful for user:', username);
    currentSessionUser = username;
    logActivity(username, 'Login Success', `Logged in successfully`);
    return { success: true, user: { id: user.id, username: user.username, role: user.role } };
  } catch (err) {
    console.error('Login error:', err);
    logActivity(username, 'Login Error', `Login failed due to system error: ${err.message}`);
    return { success: false, message: 'Login failed. Check database connection.' };
  }
});

// ─── Teachers ────────────────────────────────────────────────

ipcMain.handle('get-teachers', async () => {
  try {
    const rows = db.prepare('SELECT * FROM Teachers ORDER BY name ASC').all();
    return rows;
  } catch (err) {
    console.error('Error fetching teachers:', err);
    return [];
  }
});

ipcMain.handle('get-active-teachers', async () => {
  try {
    const rows = db.prepare("SELECT * FROM Teachers WHERE status = 'active' ORDER BY name ASC").all();
    return rows;
  } catch (err) {
    console.error('Error fetching active teachers:', err);
    return [];
  }
});

ipcMain.handle('update-teacher-status', async (event, teacherId, status) => {
  try {
    if (status !== 'active' && status !== 'inactive') {
      return { success: false, message: 'Invalid status. Must be active or inactive.' };
    }
    const teacher = db.prepare('SELECT name FROM Teachers WHERE id = ?').get(teacherId);
    const teacherName = teacher ? teacher.name : `ID: ${teacherId}`;
    db.prepare('UPDATE Teachers SET status = ? WHERE id = ?').run(status, teacherId);
    logActivity(currentSessionUser, 'Update Teacher Status', `Set status of "${teacherName}" to "${status}"`);
    return { success: true };
  } catch (err) {
    console.error('Error updating teacher status:', err);
    return { success: false, message: err.message };
  }
});

// ─── Attendance ──────────────────────────────────────────────

ipcMain.handle('get-attendance', async (event, teacherId, month, year) => {
  try {
    const rows = db.prepare(`
      SELECT id, strftime('%Y-%m-%d %H:%M:%S', log_time) as log_time, log_type 
      FROM AttendanceLogs 
      WHERE teacher_id = ? 
        AND CAST(strftime('%m', log_time) AS INTEGER) = ? 
        AND CAST(strftime('%Y', log_time) AS INTEGER) = ?
      ORDER BY log_time ASC
    `).all(teacherId, month, year);
    return rows;
  } catch (err) {
    console.error('Error fetching attendance:', err);
    return [];
  }
});

ipcMain.handle('search-teachers', async (event, query) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM Teachers 
      WHERE name LIKE ? OR biometric_id LIKE ?
      ORDER BY name ASC
    `).all(`%${query}%`, `%${query}%`);
    return rows;
  } catch (err) {
    console.error('Error searching teachers:', err);
    return [];
  }
});

ipcMain.handle('get-teacher-logs', async (event, teacherId, days) => {
  try {
    const rows = db.prepare(`
      SELECT id, strftime('%Y-%m-%d %H:%M:%S', log_time) as log_time, log_type 
      FROM AttendanceLogs 
      WHERE teacher_id = ? AND log_time >= datetime('now', 'localtime', '-' || ? || ' days')
      ORDER BY log_time DESC
    `).all(teacherId, days);
    return rows;
  } catch (err) {
    console.error('Error fetching teacher logs:', err);
    return [];
  }
});

ipcMain.handle('update-attendance-time', async (event, logId, newTime) => {
  try {
    console.log('Updating log ID:', logId, 'with time:', newTime);
    
    // Parse time string (HH:MM) and create new datetime
    const [hours, minutes] = newTime.split(':');
    
    // Get current log to get the date
    const logRow = db.prepare("SELECT teacher_id, strftime('%Y-%m-%d %H:%M:%S', log_time) as log_time, log_type FROM AttendanceLogs WHERE id = ?").get(logId);
    if (!logRow) {
      console.log('Log not found:', logId);
      return { success: false, message: 'Log not found' };
    }
    
    const currentLogTime = logRow.log_time;
    console.log('Current log_time from DB:', currentLogTime);
    
    // Extract date portion (YYYY-MM-DD) from the formatted string
    const dateStr = currentLogTime.substring(0, 10);
    
    // Construct new datetime: YYYY-MM-DD HH:MM:SS
    const newDateTime = dateStr + ' ' + hours.padStart(2, '0') + ':' + minutes.padStart(2, '0') + ':00';
    console.log('New datetime string:', newDateTime);
    
    const result = db.prepare('UPDATE AttendanceLogs SET log_time = ? WHERE id = ?').run(newDateTime, logId);
    console.log('Update result - affected rows:', result.changes);
    
    // Verify the update actually happened
    const updatedRow = db.prepare('SELECT log_time FROM AttendanceLogs WHERE id = ?').get(logId);
    console.log('Verified new log_time:', updatedRow.log_time);
    
    // Log
    const teacher = db.prepare('SELECT name FROM Teachers WHERE id = ?').get(logRow.teacher_id);
    const teacherName = teacher ? teacher.name : `ID: ${logRow.teacher_id}`;
    logActivity(currentSessionUser, 'Edit Attendance Time', `Updated check-${logRow.log_type.toLowerCase() === 'check-in' ? 'in' : 'out'} time for "${teacherName}" on ${dateStr} from "${currentLogTime.substring(11, 16)}" to "${newTime}"`);
    
    return { success: true, message: 'Time updated successfully' };
  } catch (err) {
    console.error('Error updating attendance time:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('create-attendance-log', async (event, teacherId, day, newTime, logType, month, year) => {
  try {
    console.log('Creating new log - teacherId:', teacherId, 'day:', day, 'time:', newTime, 'type:', logType, 'month:', month, 'year:', year);
    
    // Use provided month/year or fallback to current date
    let dateStr;
    if (month && year) {
      const monthStr = String(month).padStart(2, '0');
      const dayStr = String(day).padStart(2, '0');
      dateStr = `${year}-${monthStr}-${dayStr}`;
      console.log('Using provided month/year:', dateStr);
    } else {
      // Fallback: use current date
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
      dateStr = `${currentYear}-${currentMonth}-${String(day).padStart(2, '0')}`;
      console.log('Using current date as fallback:', dateStr);
    }
    
    const [hours, minutes] = newTime.split(':');
    const newDateTime = dateStr + ' ' + hours.padStart(2, '0') + ':' + minutes.padStart(2, '0') + ':00';
    console.log('Creating log with datetime:', newDateTime);
    
    const result = db.prepare(
      'INSERT INTO AttendanceLogs (teacher_id, log_time, log_type) VALUES (?, ?, ?)'
    ).run(teacherId, newDateTime, logType);
    
    console.log('Create result - inserted row ID:', result.lastInsertRowid);
    
    // Log
    const teacher = db.prepare('SELECT name FROM Teachers WHERE id = ?').get(teacherId);
    const teacherName = teacher ? teacher.name : `ID: ${teacherId}`;
    logActivity(currentSessionUser, 'Create Attendance Log', `Added manually a "${logType}" log for "${teacherName}" on ${dateStr} at "${newTime}"`);

    return { success: true, message: 'Log created successfully', logId: result.lastInsertRowid };
  } catch (err) {
    console.error('Error creating attendance log:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('delete-attendance-log', async (event, logId) => {
  try {
    const logRow = db.prepare("SELECT teacher_id, strftime('%Y-%m-%d %H:%M:%S', log_time) as log_time, log_type FROM AttendanceLogs WHERE id = ?").get(logId);
    db.prepare('DELETE FROM AttendanceLogs WHERE id = ?').run(logId);
    
    if (logRow) {
      const teacher = db.prepare('SELECT name FROM Teachers WHERE id = ?').get(logRow.teacher_id);
      const teacherName = teacher ? teacher.name : `ID: ${logRow.teacher_id}`;
      logActivity(currentSessionUser, 'Delete Attendance Log', `Deleted "${logRow.log_type}" log of "${teacherName}" on ${logRow.log_time}`);
    }
    return { success: true, message: 'Log deleted successfully' };
  } catch (err) {
    console.error('Error deleting attendance log:', err);
    return { success: false, message: err.message };
  }
});

// ─── Time Schedule ───────────────────────────────────────────

ipcMain.handle('get-time-schedule', async () => {
  try {
    const row = db.prepare('SELECT * FROM TimeSchedule WHERE id = 1').get();
    if (!row) {
      // Return defaults if no row exists
      return {
        am_time_in: '07:00', am_time_in_end: '08:00',
        am_time_out_start: '12:00', am_time_out: '12:20',
        pm_time_in: '12:35', pm_time_in_end: '13:00',
        pm_time_out_start: '17:00', pm_time_out: '18:00'
      };
    }
    return {
      am_time_in: row.am_time_in.substring(0, 5),
      am_time_in_end: row.am_time_in_end.substring(0, 5),
      am_time_out_start: row.am_time_out_start.substring(0, 5),
      am_time_out: row.am_time_out.substring(0, 5),
      pm_time_in: row.pm_time_in.substring(0, 5),
      pm_time_in_end: row.pm_time_in_end.substring(0, 5),
      pm_time_out_start: row.pm_time_out_start ? row.pm_time_out_start.substring(0, 5) : '17:00',
      pm_time_out: row.pm_time_out.substring(0, 5)
    };
  } catch (err) {
    console.error('Error fetching time schedule:', err);
    return { am_time_in: '07:00', am_time_in_end: '08:00', am_time_out_start: '12:00', am_time_out: '12:20', pm_time_in: '12:35', pm_time_in_end: '13:00', pm_time_out_start: '17:00', pm_time_out: '18:00' };
  }
});

ipcMain.handle('save-time-schedule', async (event, schedule) => {
  try {
    const { am_time_in, am_time_in_end, am_time_out_start, am_time_out, pm_time_in, pm_time_in_end, pm_time_out_start, pm_time_out } = schedule;
    db.prepare(`
      INSERT INTO TimeSchedule (id, am_time_in, am_time_in_end, am_time_out_start, am_time_out, pm_time_in, pm_time_in_end, pm_time_out_start, pm_time_out) 
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET 
        am_time_in = excluded.am_time_in,
        am_time_in_end = excluded.am_time_in_end,
        am_time_out_start = excluded.am_time_out_start,
        am_time_out = excluded.am_time_out,
        pm_time_in = excluded.pm_time_in,
        pm_time_in_end = excluded.pm_time_in_end,
        pm_time_out_start = excluded.pm_time_out_start,
        pm_time_out = excluded.pm_time_out
    `).run(am_time_in, am_time_in_end, am_time_out_start, am_time_out, pm_time_in, pm_time_in_end, pm_time_out_start, pm_time_out);
    logActivity(currentSessionUser, 'Update Time Schedule', `Saved new time schedule. AM: ${am_time_in}-${am_time_in_end}, PM: ${pm_time_in}-${pm_time_in_end}`);
    return { success: true };
  } catch (err) {
    console.error('Error saving time schedule:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('get-teacher-time-schedule', async (event, teacherId) => {
  try {
    const row = db.prepare('SELECT * FROM TeacherTimeSchedule WHERE teacher_id = ?').get(teacherId);
    if (!row) return null;
    return {
      am_time_in: row.am_time_in.substring(0, 5),
      am_time_in_end: row.am_time_in_end.substring(0, 5),
      am_time_out_start: row.am_time_out_start.substring(0, 5),
      am_time_out: row.am_time_out.substring(0, 5),
      pm_time_in: row.pm_time_in.substring(0, 5),
      pm_time_in_end: row.pm_time_in_end.substring(0, 5),
      pm_time_out_start: row.pm_time_out_start ? row.pm_time_out_start.substring(0, 5) : '17:00',
      pm_time_out: row.pm_time_out.substring(0, 5)
    };
  } catch (err) {
    console.error('Error fetching teacher time schedule:', err);
    return null;
  }
});

ipcMain.handle('save-teacher-time-schedule', async (event, teacherId, schedule) => {
  try {
    const { am_time_in, am_time_in_end, am_time_out_start, am_time_out, pm_time_in, pm_time_in_end, pm_time_out_start, pm_time_out } = schedule;
    db.prepare(`
      INSERT INTO TeacherTimeSchedule (teacher_id, am_time_in, am_time_in_end, am_time_out_start, am_time_out, pm_time_in, pm_time_in_end, pm_time_out_start, pm_time_out) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(teacher_id) DO UPDATE SET 
        am_time_in = excluded.am_time_in,
        am_time_in_end = excluded.am_time_in_end,
        am_time_out_start = excluded.am_time_out_start,
        am_time_out = excluded.am_time_out,
        pm_time_in = excluded.pm_time_in,
        pm_time_in_end = excluded.pm_time_in_end,
        pm_time_out_start = excluded.pm_time_out_start,
        pm_time_out = excluded.pm_time_out
    `).run(teacherId, am_time_in, am_time_in_end, am_time_out_start, am_time_out, pm_time_in, pm_time_in_end, pm_time_out_start, pm_time_out);
    
    const teacher = db.prepare('SELECT name FROM Teachers WHERE id = ?').get(teacherId);
    const name = teacher ? teacher.name : `ID: ${teacherId}`;
    logActivity(currentSessionUser, 'Update Teacher Schedule', `Saved specific time schedule for "${name}". AM: ${am_time_in}-${am_time_in_end}, PM: ${pm_time_in}-${pm_time_in_end}`);
    return { success: true };
  } catch (err) {
    console.error('Error saving teacher time schedule:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('delete-teacher-time-schedule', async (event, teacherId) => {
  try {
    db.prepare('DELETE FROM TeacherTimeSchedule WHERE teacher_id = ?').run(teacherId);
    const teacher = db.prepare('SELECT name FROM Teachers WHERE id = ?').get(teacherId);
    const name = teacher ? teacher.name : `ID: ${teacherId}`;
    logActivity(currentSessionUser, 'Delete Teacher Schedule', `Removed specific time schedule for "${name}". Now falling back to global config.`);
    return { success: true };
  } catch (err) {
    console.error('Error deleting teacher time schedule:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('get-effective-schedule', async (event, teacherId) => {
  try {
    const row = db.prepare('SELECT * FROM TeacherTimeSchedule WHERE teacher_id = ?').get(teacherId);
    if (row) {
      return {
        am_time_in: row.am_time_in.substring(0, 5),
        am_time_in_end: row.am_time_in_end.substring(0, 5),
        am_time_out_start: row.am_time_out_start.substring(0, 5),
        am_time_out: row.am_time_out.substring(0, 5),
        pm_time_in: row.pm_time_in.substring(0, 5),
        pm_time_in_end: row.pm_time_in_end.substring(0, 5),
        pm_time_out_start: row.pm_time_out_start ? row.pm_time_out_start.substring(0, 5) : '17:00',
        pm_time_out: row.pm_time_out.substring(0, 5),
        is_custom: true
      };
    }
    
    // Fallback to global
    const globalRow = db.prepare('SELECT * FROM TimeSchedule WHERE id = 1').get();
    if (!globalRow) {
      return {
        am_time_in: '07:00', am_time_in_end: '08:00',
        am_time_out_start: '12:00', am_time_out: '12:20',
        pm_time_in: '12:35', pm_time_in_end: '13:00',
        pm_time_out_start: '17:00', pm_time_out: '18:00',
        is_custom: false
      };
    }
    return {
      am_time_in: globalRow.am_time_in.substring(0, 5),
      am_time_in_end: globalRow.am_time_in_end.substring(0, 5),
      am_time_out_start: globalRow.am_time_out_start.substring(0, 5),
      am_time_out: globalRow.am_time_out.substring(0, 5),
      pm_time_in: globalRow.pm_time_in.substring(0, 5),
      pm_time_in_end: globalRow.pm_time_in_end.substring(0, 5),
      pm_time_out_start: globalRow.pm_time_out_start ? globalRow.pm_time_out_start.substring(0, 5) : '17:00',
      pm_time_out: globalRow.pm_time_out.substring(0, 5),
      is_custom: false
    };
  } catch (err) {
    console.error('Error fetching effective schedule:', err);
    return { am_time_in: '07:00', am_time_in_end: '08:00', am_time_out_start: '12:00', am_time_out: '12:20', pm_time_in: '12:35', pm_time_in_end: '13:00', pm_time_out_start: '17:00', pm_time_out: '18:00', is_custom: false };
  }
});

// ─── User Management ────────────────────────────────────────

ipcMain.handle('get-users', async () => {
  try {
    const rows = db.prepare('SELECT id, username, role, created_at FROM Users ORDER BY created_at ASC').all();
    return rows;
  } catch (err) {
    console.error('Error fetching users:', err);
    return [];
  }
});

ipcMain.handle('add-user', async (event, username, password, role) => {
  try {
    const hashed = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO Users (username, password, role) VALUES (?, ?, ?)').run(username, hashed, role);
    logActivity(currentSessionUser, 'Add User', `Added new user: "${username}" with role: "${role}"`);
    return { success: true };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, message: 'Username already exists.' };
    }
    console.error('Error adding user:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('change-password', async (event, userId, currentPassword, newPassword) => {
  try {
    const user = db.prepare('SELECT username, password FROM Users WHERE id = ?').get(userId);
    if (!user) {
      return { success: false, message: 'User not found.' };
    }
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      return { success: false, message: 'Current password is incorrect.' };
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE Users SET password = ? WHERE id = ?').run(hashed, userId);
    logActivity(currentSessionUser, 'Change Password', `Changed password for user: "${user.username}"`);
    return { success: true };
  } catch (err) {
    console.error('Error changing password:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('delete-user', async (event, userId) => {
  try {
    const user = db.prepare('SELECT username FROM Users WHERE id = ?').get(userId);
    db.prepare('DELETE FROM Users WHERE id = ?').run(userId);
    if (user) {
      logActivity(currentSessionUser, 'Delete User', `Deleted user: "${user.username}"`);
    }
    return { success: true };
  } catch (err) {
    console.error('Error deleting user:', err);
    return { success: false, message: err.message };
  }
});

// ─── NGTeco Cloud Biometric Import ──────────────────────────

ipcMain.handle('open-ngteco-portal', async () => {
  shell.openExternal('https://office.ngteco.com');
  return { success: true };
});

ipcMain.handle('select-import-file', async (event, customTitle) => {
  const result = await dialog.showOpenDialog({
    title: customTitle || 'Select Attendance Export File',
    filters: [
      { name: 'Attendance Files', extensions: ['csv', 'xlsx', 'xls', 'dat'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, message: 'No file selected.' };
  }

  return { success: true, filePath: result.filePaths[0] };
});

ipcMain.handle('preview-import-file', async (event, filePath) => {
  try {
    return biometricService.previewFile(filePath);
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('import-attendance-file', async (event, filePath, columnMapping) => {
  try {
    // Parse the file
    const result = biometricService.parseAttendanceFile(filePath);
    if (!result.success) {
      return result;
    }

    const records = result.data || [];
    if (records.length === 0) {
      return { success: true, message: 'No attendance records found in file.', synced: 0 };
    }

    // ── Deduplicate repeated scans ──────────────────────────────
    // USB devices record every raw scan. If a user scans 2-3 times within
    // a short window, we keep only the first scan per window (10 minutes).
    const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

    // Group records by employee ID (or name if no ID — Timecard format)
    const byEmployee = {};
    for (const r of records) {
      const key = r.employeeId || r.name || '';
      if (!byEmployee[key]) byEmployee[key] = [];
      byEmployee[key].push(r);
    }

    // For each employee, sort by time and collapse scans within the window
    const dedupedRecords = [];
    let filteredCount = 0;
    for (const empId of Object.keys(byEmployee)) {
      const empRecords = byEmployee[empId];
      // Sort chronologically
      empRecords.sort((a, b) => {
        if (a.logTime < b.logTime) return -1;
        if (a.logTime > b.logTime) return 1;
        return 0;
      });

      let lastKeptTime = null;
      for (const rec of empRecords) {
        const recTime = new Date(rec.logTime.replace(' ', 'T')).getTime();
        if (lastKeptTime !== null && !isNaN(recTime) && !isNaN(lastKeptTime) && (recTime - lastKeptTime) < DEDUP_WINDOW_MS) {
          // This scan is within the window of the previous kept scan — skip it
          filteredCount++;
          continue;
        }
        dedupedRecords.push(rec);
        lastKeptTime = isNaN(recTime) ? null : recTime;
      }
    }

    console.log(`[Import] Dedup: ${records.length} raw → ${dedupedRecords.length} unique (${filteredCount} repeated scans filtered)`);

    // Build a mapping of biometric_id → teacher_id from the database
    const teachers = db.prepare('SELECT id, name, biometric_id FROM Teachers').all();
    const biometricMap = {};
    const nameMap = {};       // exact normalized name → teacher_id
    const nameList = [];      // list of {name, id} for fuzzy matching
    teachers.forEach(t => {
      biometricMap[String(t.biometric_id)] = t.id;
      const normalized = normalizeName(t.name);
      nameMap[normalized] = t.id;
      nameList.push({ name: t.name, normalized, id: t.id });
    });

    // Also try to get the time schedule for check-in/check-out classification
    let timeSchedule;
    try {
      timeSchedule = db.prepare('SELECT * FROM TimeSchedule WHERE id = 1').get();
    } catch (_) {}

    const amOutStart = timeSchedule ? timeToMinutesHelper(timeSchedule.am_time_out_start) : 720;
    const pmInEnd = timeSchedule ? timeToMinutesHelper(timeSchedule.pm_time_in_end) : 780;

    let insertedCount = 0;
    let skippedCount = 0;
    let autoCreatedTeachers = new Set();

    // Cache for auto-created teachers (name → teacher_id) to avoid repeated DB lookups
    const autoCreatedMap = {};

    // Get the next available biometric_id for auto-creating teachers
    const maxBioRow = db.prepare('SELECT COALESCE(MAX(biometric_id), 0) as maxId FROM Teachers').get();
    let nextBiometricId = (maxBioRow?.maxId || 0) + 1;

    // Prepare statements outside the loop for performance
    const insertTeacherStmt = db.prepare('INSERT INTO Teachers (name, biometric_id) VALUES (?, ?)');
    const checkExistingStmt = db.prepare('SELECT id FROM AttendanceLogs WHERE teacher_id = ? AND log_time = ?');
    const insertLogStmt = db.prepare('INSERT INTO AttendanceLogs (teacher_id, log_time, log_type) VALUES (?, ?, ?)');

    // Wrap all imports in a transaction for performance
    const importTransaction = db.transaction(() => {
      for (const record of dedupedRecords) {
        // Try to match by employee ID first, then by name (with fuzzy matching)
        let teacherId = biometricMap[record.employeeId];
        if (!teacherId && record.name) {
          teacherId = fuzzyMatchTeacher(record.name, nameMap, nameList);
        }

        // If still no match and we have a name, auto-create the teacher
        if (!teacherId && record.name) {
          const normalizedRecName = normalizeName(record.name);
          
          // Check if we already auto-created this teacher in this import session
          if (autoCreatedMap[normalizedRecName]) {
            teacherId = autoCreatedMap[normalizedRecName];
          } else {
            // Auto-create the teacher in the database
            const cleanName = record.name.replace(/\s+/g, ' ').trim();
            const bioId = nextBiometricId++;
            try {
              const insertResult = insertTeacherStmt.run(cleanName, bioId);
              teacherId = insertResult.lastInsertRowid;
              autoCreatedMap[normalizedRecName] = teacherId;
              autoCreatedTeachers.add(cleanName);

              // Also update our lookup maps for subsequent records
              biometricMap[String(bioId)] = teacherId;
              nameMap[normalizedRecName] = teacherId;
              nameList.push({ name: cleanName, normalized: normalizedRecName, id: teacherId });

              console.log(`[Import] Auto-created teacher: "${cleanName}" (ID: ${teacherId}, Biometric: ${bioId})`);
            } catch (createErr) {
              console.error(`[Import] Failed to auto-create teacher "${cleanName}":`, createErr.message);
              continue;
            }
          }
        }

        if (!teacherId) {
          skippedCount++;
          continue;
        }

        const logTime = record.logTime;
        if (!logTime) {
          skippedCount++;
          continue;
        }

        // Smart log type: if the file already set it, use it. Otherwise classify by time of day.
        let logType = record.logType;
        if (logType !== 'Check-in' && logType !== 'Check-out') {
          // Classify: parse HH:MM from logTime
          const timeMatch = logTime.match(/(\d{2}):(\d{2})/);
          if (timeMatch) {
            const mins = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
            // Before noon-ish = check-in AM, around noon = check-out AM, 
            // early afternoon = check-in PM, late afternoon = check-out PM
            if (mins < amOutStart) logType = 'Check-in';
            else if (mins < pmInEnd) logType = 'Check-out';
            else logType = 'Check-in'; // PM check-in
          } else {
            logType = 'Check-in';
          }
        }

        // Check for duplicate
        const existing = checkExistingStmt.get(teacherId, logTime);

        if (existing) {
          skippedCount++;
          continue;
        }

        insertLogStmt.run(teacherId, logTime, logType);
        insertedCount++;
      }
    });

    importTransaction();

    const autoCreatedList = [...autoCreatedTeachers];
    let summary = `Imported ${insertedCount} new record(s). Skipped ${skippedCount} duplicate(s).`;
    if (filteredCount > 0) {
      summary += ` Filtered ${filteredCount} repeated scan(s).`;
    }
    if (autoCreatedList.length > 0) {
      summary += ` Auto-created ${autoCreatedList.length} new teacher(s): ${autoCreatedList.join(', ')}.`;
    }
    console.log('[Import]', summary);
    logActivity(currentSessionUser, 'Import Attendance', `File: "${path.basename(filePath)}". ${summary}`);
    return { success: true, message: summary, synced: insertedCount, skipped: skippedCount, filtered: filteredCount, autoCreated: autoCreatedList.length, autoCreatedNames: autoCreatedList };
  } catch (err) {
    console.error('[Import] Error:', err);
    return { success: false, message: err.message };
  }
});

function timeToMinutesHelper(timeVal) {
  if (!timeVal) return 0;
  const s = typeof timeVal === 'string' ? timeVal : timeVal.toString();
  const parts = s.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
}

/**
 * Normalize a name for matching: lowercase, collapse whitespace, trim.
 */
function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Try to match a record name to a teacher using fuzzy matching.
 * 
 * Matching strategies (in order):
 * 1. Exact normalized match
 * 2. Match after removing middle initials (e.g., "R." or "R")
 * 3. Substring match (CSV name contains teacher name or vice versa)
 * 4. Match by first + last name only
 */
function fuzzyMatchTeacher(recordName, nameMap, nameList) {
  if (!recordName) return null;
  
  const normalized = normalizeName(recordName);
  
  // Strategy 1: Exact normalized match
  if (nameMap[normalized]) {
    return nameMap[normalized];
  }
  
  // Strategy 2: Remove middle initials (single letters followed by optional period)
  // "ivy jane r. galo" → "ivy jane galo"
  const noMiddle = normalized.replace(/\s+[a-z]\.?\s+/g, ' ').replace(/\s+/g, ' ').trim();
  if (noMiddle !== normalized && nameMap[noMiddle]) {
    return nameMap[noMiddle];
  }
  
  // Also try removing middle initials from DB teacher names
  for (const t of nameList) {
    const tNoMiddle = t.normalized.replace(/\s+[a-z]\.?\s+/g, ' ').replace(/\s+/g, ' ').trim();
    if (noMiddle === tNoMiddle || normalized === tNoMiddle) {
      return t.id;
    }
  }
  
  // Strategy 3: Substring match (one name contains the other)
  for (const t of nameList) {
    if (normalized.includes(t.normalized) || t.normalized.includes(normalized)) {
      return t.id;
    }
    // Also try with middle initials removed
    if (noMiddle.includes(t.normalized) || t.normalized.includes(noMiddle)) {
      return t.id;
    }
  }
  
  // Strategy 4: Match by first name + last name only
  const recordParts = normalized.split(' ');
  if (recordParts.length >= 2) {
    const firstName = recordParts[0];
    const lastName = recordParts[recordParts.length - 1];
    for (const t of nameList) {
      const tParts = t.normalized.split(' ');
      if (tParts.length >= 2) {
        const tFirst = tParts[0];
        const tLast = tParts[tParts.length - 1];
        if (firstName === tFirst && lastName === tLast) {
          return t.id;
        }
      }
    }
  }
  
  return null;
}

ipcMain.handle('get-activity-logs', async () => {
  try {
    const rows = db.prepare('SELECT * FROM UserActivityLogs ORDER BY created_at DESC LIMIT 1000').all();
    return rows;
  } catch (err) {
    console.error('Error fetching activity logs:', err);
    return [];
  }
});

// ─── Print DTR ──────────────────────────────────────────────

ipcMain.handle('print-dtr', async (event) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.webContents.print({
      silent: false,
      printBackground: true,
      color: true,
    }, (success, failureReason) => {
      if (!success) console.log('Print failed: ', failureReason);
    });
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  try {
    db.close();
  } catch (_) {}
});
