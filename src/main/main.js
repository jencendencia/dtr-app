const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const bcrypt = require('bcryptjs');
const { autoUpdater } = require('electron-updater');
const { db } = require('../db/connection');
const biometricService = require('./biometricsService');
const zktecoService = require('./zktecoService');

// ─── Auto Updater ────────────────────────────────────────────
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdateStatus(status, data) {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.send('update-status', { status, data });
}

autoUpdater.on('checking-for-update', () => {
  sendUpdateStatus('checking');
});

autoUpdater.on('update-available', (info) => {
  sendUpdateStatus('available', info);
});

autoUpdater.on('update-not-available', (info) => {
  sendUpdateStatus('not-available', info);
});

autoUpdater.on('download-progress', (progress) => {
  sendUpdateStatus('downloading', progress);
});

autoUpdater.on('update-downloaded', (info) => {
  sendUpdateStatus('downloaded', info);
});

autoUpdater.on('error', (err) => {
  sendUpdateStatus('error', err.message);
});

ipcMain.handle('check-for-updates', async () => {
  try {
    autoUpdater.checkForUpdates();
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('install-update', async () => {
  autoUpdater.quitAndInstall();
  return { success: true };
});

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

// ─── Teacher Management (Add / Delete / Enroll to Device) ───

ipcMain.handle('add-teacher', async (event, teacher) => {
  try {
    const { name, biometric_id, device_role } = teacher;
    if (!name || !name.trim()) {
      return { success: false, message: 'Teacher name is required.' };
    }
    const bioId = parseInt(biometric_id);
    if (!bioId || bioId <= 0) {
      return { success: false, message: 'Valid Biometric ID is required.' };
    }
    const role = parseInt(device_role) || 0;
    const result = db.prepare('INSERT INTO Teachers (name, biometric_id, device_role) VALUES (?, ?, ?)').run(name.trim(), bioId, role);
    logActivity(currentSessionUser, 'Add Teacher', `Added teacher "${name.trim()}" (Biometric ID: ${bioId}, Role: ${role === 1 ? 'Admin' : 'User'})`);
    return { success: true, id: result.lastInsertRowid };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, message: 'A teacher with this Biometric ID already exists.' };
    }
    console.error('Error adding teacher:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('update-teacher', async (event, teacherId, updates) => {
  try {
    const { name, biometric_id, device_role } = updates;
    if (!name || !name.trim()) {
      return { success: false, message: 'Teacher name is required.' };
    }
    const bioId = parseInt(biometric_id);
    if (!bioId || bioId <= 0) {
      return { success: false, message: 'Valid Biometric ID is required.' };
    }
    const role = parseInt(device_role) || 0;

    // Check if another teacher already has this biometric_id
    const existing = db.prepare('SELECT id, name FROM Teachers WHERE biometric_id = ? AND id != ?').get(bioId, teacherId);
    if (existing) {
      return { success: false, message: `Biometric ID ${bioId} is already used by "${existing.name}".` };
    }

    const oldTeacher = db.prepare('SELECT name, biometric_id, device_role FROM Teachers WHERE id = ?').get(teacherId);
    if (!oldTeacher) {
      return { success: false, message: 'Teacher not found.' };
    }

    db.prepare('UPDATE Teachers SET name = ?, biometric_id = ?, device_role = ? WHERE id = ?').run(name.trim(), bioId, role, teacherId);
    logActivity(currentSessionUser, 'Update Teacher', `Updated teacher "${oldTeacher.name}" → "${name.trim()}" (Bio: ${oldTeacher.biometric_id} → ${bioId}, Role: ${role === 1 ? 'Admin' : 'User'})`);
    return { success: true };
  } catch (err) {
    console.error('Error updating teacher:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('delete-teacher', async (event, teacherId) => {
  try {
    const teacher = db.prepare('SELECT name FROM Teachers WHERE id = ?').get(teacherId);
    if (!teacher) {
      return { success: false, message: 'Teacher not found.' };
    }
    db.prepare('DELETE FROM AttendanceLogs WHERE teacher_id = ?').run(teacherId);
    db.prepare('DELETE FROM TeacherTimeSchedule WHERE teacher_id = ?').run(teacherId);
    db.prepare('DELETE FROM Teachers WHERE id = ?').run(teacherId);
    logActivity(currentSessionUser, 'Delete Teacher', `Deleted teacher "${teacher.name}"`);
    return { success: true };
  } catch (err) {
    console.error('Error deleting teacher:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('enroll-teacher-to-device', async (event, teacherId) => {
  try {
    if (!zktecoService.isConnected()) {
      return { success: false, message: 'Not connected to a device. Connect first.' };
    }
    const teacher = db.prepare('SELECT id, name, biometric_id, device_role FROM Teachers WHERE id = ?').get(teacherId);
    if (!teacher) {
      return { success: false, message: 'Teacher not found in database.' };
    }
    const result = await zktecoService.setUser(teacher.id, teacher.biometric_id, teacher.name, '', teacher.device_role || 0, 0);
    if (result.success) {
      logActivity(currentSessionUser, 'Enroll Teacher to Device', `Enrolled "${teacher.name}" (Bio ID: ${teacher.biometric_id}) to device`);
    }
    return result;
  } catch (err) {
    console.error('Error enrolling teacher to device:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('enroll-all-teachers-to-device', async () => {
  try {
    if (!zktecoService.isConnected()) {
      return { success: false, message: 'Not connected to a device. Connect first.' };
    }
    const teachers = db.prepare('SELECT id, name, biometric_id, device_role FROM Teachers WHERE status = ? ORDER BY name ASC').all('active');
    if (teachers.length === 0) {
      return { success: true, message: 'No active teachers to enroll.', enrolled: 0, failed: 0 };
    }

    let enrolled = 0;
    let failed = 0;
    const errors = [];

    for (const t of teachers) {
      const result = await zktecoService.setUser(t.id, t.biometric_id, t.name, '', t.device_role || 0, 0);
      if (result.success) {
        enrolled++;
      } else {
        failed++;
        errors.push(`${t.name}: ${result.message}`);
      }
    }

    logActivity(currentSessionUser, 'Enroll All Teachers to Device', `Enrolled ${enrolled}/${teachers.length} teacher(s) to device. ${failed} failed.`);
    return {
      success: true,
      message: `Enrolled ${enrolled} teacher(s) to device. ${failed > 0 ? failed + ' failed.' : ''}`,
      enrolled,
      failed,
      errors
    };
  } catch (err) {
    console.error('Error enrolling all teachers:', err);
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

// ─── ZKTeco Device Management ───────────────────────────────

ipcMain.handle('get-devices', async () => {
  try {
    const rows = db.prepare('SELECT * FROM BiometricDevices ORDER BY created_at DESC').all();
    return rows;
  } catch (err) {
    console.error('Error fetching devices:', err);
    return [];
  }
});

ipcMain.handle('add-device', async (event, device) => {
  try {
    const { name, serial_number, ip_address, port, device_type } = device;
    const result = db.prepare(
      'INSERT INTO BiometricDevices (name, serial_number, ip_address, port, device_type) VALUES (?, ?, ?, ?, ?)'
    ).run(name, serial_number || null, ip_address, port || 4370, device_type || 'zkteco');
    logActivity(currentSessionUser, 'Add Device', `Added device "${name}" (IP: ${ip_address}, Serial: ${serial_number || 'N/A'})`);
    return { success: true, id: result.lastInsertRowid };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, message: 'A device with this serial number already exists.' };
    }
    console.error('Error adding device:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('update-device', async (event, deviceId, device) => {
  try {
    const { name, serial_number, ip_address, port, device_type, status } = device;
    db.prepare(
      'UPDATE BiometricDevices SET name = ?, serial_number = ?, ip_address = ?, port = ?, device_type = ?, status = ? WHERE id = ?'
    ).run(name, serial_number || null, ip_address, port || 4370, device_type || 'zkteco', status || 'active', deviceId);
    logActivity(currentSessionUser, 'Update Device', `Updated device ID ${deviceId} "${name}"`);
    return { success: true };
  } catch (err) {
    console.error('Error updating device:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('delete-device', async (event, deviceId) => {
  try {
    const row = db.prepare('SELECT name FROM BiometricDevices WHERE id = ?').get(deviceId);
    db.prepare('DELETE FROM BiometricDevices WHERE id = ?').run(deviceId);
    if (row) {
      logActivity(currentSessionUser, 'Delete Device', `Deleted device "${row.name}" (ID: ${deviceId})`);
    }
    return { success: true };
  } catch (err) {
    console.error('Error deleting device:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('connect-device', async (event, ip, port) => {
  try {
    const result = await zktecoService.connect(ip, port);
    if (result.success) {
      logActivity(currentSessionUser, 'Connect Device', `Connected to device at ${ip}:${port}`);
    }
    return result;
  } catch (err) {
    console.error('Error connecting to device:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('disconnect-device', async () => {
  try {
    await zktecoService.disconnect();
    logActivity(currentSessionUser, 'Disconnect Device', 'Disconnected from ZKTeco device');
    return { success: true };
  } catch (err) {
    console.error('Error disconnecting:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('get-device-status', async () => {
  return zktecoService.getStatus();
});

ipcMain.handle('get-device-users', async () => {
  return zktecoService.getUsers();
});

ipcMain.handle('sync-device-attendance', async () => {
  try {
    // First, fetch user names from the device
    const deviceUsersResult = await zktecoService.getUsers();
    const deviceUserMap = {}; // userId → name
    if (deviceUsersResult.success && deviceUsersResult.data) {
      for (const u of deviceUsersResult.data) {
        if (u.userId && u.name) {
          deviceUserMap[String(u.userId)] = u.name;
        }
      }
      console.log(`[Zkteco Sync] Loaded ${Object.keys(deviceUserMap).length} user(s) from device:`, deviceUserMap);
    }

    const result = await zktecoService.getAttendanceLogs();
    if (!result.success) return result;

    const records = result.data || [];
    if (records.length === 0) {
      return { success: true, message: 'No attendance records on device.', synced: 0 };
    }

    // Attach device user names to records
    for (const record of records) {
      if (!record.name && deviceUserMap[record.employeeId]) {
        record.name = deviceUserMap[record.employeeId];
      }
    }

    // Build lookup maps from database
    const teachers = db.prepare('SELECT id, name, biometric_id FROM Teachers').all();
    const biometricMap = {};
    const nameMap = {};
    const nameList = [];
    teachers.forEach(t => {
      biometricMap[String(t.biometric_id)] = t.id;
      const normalized = normalizeName(t.name);
      nameMap[normalized] = t.id;
      nameList.push({ name: t.name, normalized, id: t.id });
    });

    let insertedCount = 0;
    let skippedCount = 0;
    let autoCreatedTeachers = new Set();
    const autoCreatedMap = {};
    const maxBioRow = db.prepare('SELECT COALESCE(MAX(biometric_id), 0) as maxId FROM Teachers').get();
    let nextBiometricId = (maxBioRow?.maxId || 0) + 1;

    const insertTeacherStmt = db.prepare('INSERT INTO Teachers (name, biometric_id) VALUES (?, ?)');
    const checkExistingStmt = db.prepare('SELECT id FROM AttendanceLogs WHERE teacher_id = ? AND log_time = ?');
    const insertLogStmt = db.prepare('INSERT INTO AttendanceLogs (teacher_id, log_time, log_type) VALUES (?, ?, ?)');

    const importTransaction = db.transaction(() => {
      for (const record of records) {
        console.log(`[Zkteco Sync] Processing record: employeeId="${record.employeeId}", logTime="${record.logTime}", logType="${record.logType}"`);

        let teacherId = biometricMap[record.employeeId];
        if (!teacherId && record.name) {
          teacherId = fuzzyMatchTeacher(record.name, nameMap, nameList);
        }

        // Auto-create teacher if not found
        if (!teacherId && record.employeeId) {
          // Try to parse employeeId as a number for biometric_id
          const bioId = parseInt(record.employeeId);
          const cleanName = record.name || `Employee ${record.employeeId}`;

          if (!isNaN(bioId) && bioId > 0) {
            // Try the parsed ID first
            try {
              const insertResult = insertTeacherStmt.run(cleanName, bioId);
              teacherId = insertResult.lastInsertRowid;
              autoCreatedMap[record.employeeId] = teacherId;
              autoCreatedTeachers.add(cleanName);
              biometricMap[String(bioId)] = teacherId;
              biometricMap[record.employeeId] = teacherId;
              console.log(`[Zkteco Sync] Auto-created teacher: "${cleanName}" (Biometric: ${bioId})`);
            } catch (createErr) {
              // UNIQUE constraint — biometric_id already exists, try next available ID
              if (createErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                console.log(`[Zkteco Sync] Biometric ID ${bioId} already exists, trying next available ID`);
                let nextId = nextBiometricId;
                while (true) {
                  try {
                    const insertResult = insertTeacherStmt.run(cleanName, nextId);
                    teacherId = insertResult.lastInsertRowid;
                    autoCreatedMap[record.employeeId] = teacherId;
                    autoCreatedTeachers.add(cleanName);
                    biometricMap[String(nextId)] = teacherId;
                    biometricMap[record.employeeId] = teacherId;
                    nextBiometricId = nextId + 1;
                    console.log(`[Zkteco Sync] Auto-created teacher: "${cleanName}" (Biometric: ${nextId})`);
                    break;
                  } catch (retryErr) {
                    if (retryErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                      nextId++;
                      if (nextId > 999999) {
                        console.error(`[Zkteco Sync] No available biometric ID for "${cleanName}"`);
                        break;
                      }
                      continue;
                    }
                    console.error(`[Zkteco Sync] Failed to auto-create teacher "${cleanName}":`, retryErr.message);
                    break;
                  }
                }
              } else {
                console.error(`[Zkteco Sync] Failed to auto-create teacher "${cleanName}":`, createErr.message);
              }
            }
          } else {
            // employeeId is not a valid number — use next available biometric_id
            console.log(`[Zkteco Sync] employeeId "${record.employeeId}" is not a valid number, using next available ID`);
            try {
              const insertResult = insertTeacherStmt.run(cleanName, nextBiometricId);
              teacherId = insertResult.lastInsertRowid;
              autoCreatedMap[record.employeeId] = teacherId;
              autoCreatedTeachers.add(cleanName);
              biometricMap[String(nextBiometricId)] = teacherId;
              biometricMap[record.employeeId] = teacherId;
              console.log(`[Zkteco Sync] Auto-created teacher: "${cleanName}" (Biometric: ${nextBiometricId})`);
              nextBiometricId++;
            } catch (createErr) {
              console.error(`[Zkteco Sync] Failed to auto-create teacher "${cleanName}":`, createErr.message);
            }
          }
        }

        if (!teacherId) {
          console.log(`[Zkteco Sync] No teacher match for employeeId="${record.employeeId}", skipping`);
          skippedCount++;
          continue;
        }

        const logTime = record.logTime;
        if (!logTime) {
          skippedCount++;
          continue;
        }

        const existing = checkExistingStmt.get(teacherId, logTime);
        if (existing) {
          skippedCount++;
          continue;
        }

        insertLogStmt.run(teacherId, logTime, record.logType);
        insertedCount++;
      }
    });

    importTransaction();

    // Update last_sync for all ZKTeco devices
    db.prepare("UPDATE BiometricDevices SET last_sync = datetime('now', 'localtime') WHERE device_type = 'zkteco'").run();

    const autoCreatedList = [...autoCreatedTeachers];
    let summary = `Synced ${insertedCount} new record(s) from device. Skipped ${skippedCount} duplicate(s).`;
    if (autoCreatedList.length > 0) {
      summary += ` Auto-created ${autoCreatedList.length} teacher(s): ${autoCreatedList.join(', ')}.`;
    }
    console.log('[Zkteco Sync]', summary);
    logActivity(currentSessionUser, 'Sync Device', summary);
    return { success: true, message: summary, synced: insertedCount, skipped: skippedCount, autoCreated: autoCreatedList.length, autoCreatedNames: autoCreatedList };
  } catch (err) {
    console.error('[Zkteco Sync] Error:', err);
    return { success: false, message: err.message };
  }
});

// ─── Clear Device Sync Data ─────────────────────────────────
ipcMain.handle('clear-device-sync-data', async () => {
  try {
    // Get all teachers and their attendance log counts
    const allTeachers = db.prepare("SELECT id, name, biometric_id FROM Teachers").all();
    
    if (allTeachers.length === 0) {
      return { success: true, message: 'No teachers found to clear.', cleared: 0 };
    }

    const teacherIds = allTeachers.map(t => t.id);
    const placeholders = teacherIds.map(() => '?').join(',');
    
    // Delete all attendance logs
    const logResult = db.prepare(`DELETE FROM AttendanceLogs WHERE teacher_id IN (${placeholders})`).run(...teacherIds);
    
    // Delete all teachers
    db.prepare(`DELETE FROM Teachers WHERE id IN (${placeholders})`).run(...teacherIds);
    
    logActivity(currentSessionUser, 'Clear Device Data', `Cleared ${allTeachers.length} teacher(s) and ${logResult.changes} attendance log(s)`);
    return { success: true, message: `Cleared ${allTeachers.length} teacher(s) and ${logResult.changes} attendance log(s). You can now re-sync.`, cleared: allTeachers.length };
  } catch (err) {
    console.error('Error clearing device sync data:', err);
    return { success: false, message: err.message };
  }
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

// ─── Holidays / Class Suspensions ────────────────────────────

ipcMain.handle('get-holidays', async (event, month, year) => {
  try {
    if (month && year) {
      const monthStr = String(month).padStart(2, '0');
      const startDate = `${year}-${monthStr}-01`;
      // Calculate last day of month
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      const endDate = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
      const rows = db.prepare('SELECT * FROM Holidays WHERE date >= ? AND date <= ? ORDER BY date ASC').all(startDate, endDate);
      return rows;
    }
    const rows = db.prepare('SELECT * FROM Holidays ORDER BY date ASC').all();
    return rows;
  } catch (err) {
    console.error('Error fetching holidays:', err);
    return [];
  }
});

ipcMain.handle('add-holiday', async (event, holiday) => {
  try {
    const { date, type, description, is_half_day, half_day_period } = holiday;
    db.prepare(`
      INSERT INTO Holidays (date, type, description, is_half_day, half_day_period)
      VALUES (?, ?, ?, ?, ?)
    `).run(date, type, description || '', is_half_day ? 1 : 0, is_half_day ? half_day_period : null);
    logActivity(currentSessionUser, 'Add Holiday', `Added ${type} on ${date}${is_half_day ? ' (half-day ' + half_day_period + ')' : ''}${description ? ': ' + description : ''}`);
    return { success: true };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { success: false, message: 'A holiday/suspension already exists for this date.' };
    }
    console.error('Error adding holiday:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('delete-holiday', async (event, id) => {
  try {
    const row = db.prepare('SELECT date, type FROM Holidays WHERE id = ?').get(id);
    db.prepare('DELETE FROM Holidays WHERE id = ?').run(id);
    if (row) {
      logActivity(currentSessionUser, 'Delete Holiday', `Deleted ${row.type} on ${row.date}`);
    }
    return { success: true };
  } catch (err) {
    console.error('Error deleting holiday:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('get-holidays-for-dtr', async (event, month, year) => {
  try {
    const monthStr = String(month).padStart(2, '0');
    const startDate = `${year}-${monthStr}-01`;
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    const endDate = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
    const rows = db.prepare('SELECT date, type, is_half_day, half_day_period FROM Holidays WHERE date >= ? AND date <= ? ORDER BY date ASC').all(startDate, endDate);
    // Return as a map: { '2026-06-15': { type: 'holiday', is_half_day: 0, half_day_period: null }, ... }
    const holidayMap = {};
    rows.forEach(r => {
      holidayMap[r.date] = {
        type: r.type,
        is_half_day: r.is_half_day,
        half_day_period: r.half_day_period
      };
    });
    return holidayMap;
  } catch (err) {
    console.error('Error fetching holidays for DTR:', err);
    return {};
  }
});

// ─── License / Activation ────────────────────────────────────

const LICENSE_SERVER = 'https://dtr-license-server.jencendencia.workers.dev';
const LICENSE_FILE = path.join(app.getPath('userData'), 'license.json');

function getMachineId() {
  const hash = crypto.createHash('sha256');
  hash.update(os.hostname());
  hash.update(os.userInfo().username);
  hash.update(os.platform());
  hash.update(os.arch());
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
        hash.update(iface.mac);
        break;
      }
    }
    break;
  }
  return hash.digest('hex').substring(0, 16);
}

function getStoredLicense() {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      return JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf-8'));
    }
  } catch (_) {}
  return null;
}

function saveLicense(data) {
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(data, null, 2));
}

ipcMain.handle('check-license', async () => {
  const stored = getStoredLicense();
  if (!stored || !stored.licenseKey || !stored.activatedAt) {
    return { activated: false };
  }
  return { activated: true, licenseKey: stored.licenseKey, machineId: getMachineId() };
});

ipcMain.handle('activate-license', async (event, licenseKey) => {
  try {
    const machineId = getMachineId();
    const response = await fetch(`${LICENSE_SERVER}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: licenseKey.trim().toUpperCase(), machineId })
    });
    const result = await response.json();

    if (result.valid) {
      saveLicense({
        licenseKey: licenseKey.trim().toUpperCase(),
        machineId,
        activatedAt: new Date().toISOString()
      });
    }

    return result;
  } catch (err) {
    return { valid: false, message: 'Cannot reach activation server. Check your internet connection.' };
  }
});

ipcMain.handle('get-machine-id', async () => {
  return getMachineId();
});

// ─── Print DTR ──────────────────────────────────────────────

ipcMain.handle('get-app-version', async () => {
  return app.getVersion();
});

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
