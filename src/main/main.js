const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/connection');
const biometricService = require('./biometricsService');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.webContents.openDevTools();
}

// ─── Authentication ──────────────────────────────────────────

ipcMain.handle('login', async (event, username, password) => {
  try {
    console.log('Login attempt for user:', username);
    const [rows] = await pool.query('SELECT * FROM Users WHERE username = ?', [username]);
    if (rows.length === 0) {
      console.log('User not found:', username);
      return { success: false, message: 'Invalid username or password.' };
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.log('Password mismatch for user:', username);
      return { success: false, message: 'Invalid username or password.' };
    }
    console.log('Login successful for user:', username);
    return { success: true, user: { id: user.id, username: user.username, role: user.role } };
  } catch (err) {
    console.error('Login error:', err);
    return { success: false, message: 'Login failed. Check database connection.' };
  }
});

// ─── Teachers ────────────────────────────────────────────────

ipcMain.handle('get-teachers', async () => {
  try {
    const [rows] = await pool.query('SELECT * FROM Teachers ORDER BY name ASC');
    return rows;
  } catch (err) {
    console.error('Error fetching teachers:', err);
    return [];
  }
});

// ─── Attendance ──────────────────────────────────────────────

ipcMain.handle('get-attendance', async (event, teacherId, month, year) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, DATE_FORMAT(log_time, '%Y-%m-%d %H:%i:%s') as log_time, log_type 
      FROM AttendanceLogs 
      WHERE teacher_id = ? 
        AND MONTH(log_time) = ? 
        AND YEAR(log_time) = ?
      ORDER BY log_time ASC
    `, [teacherId, month, year]);
    return rows;
  } catch (err) {
    console.error('Error fetching attendance:', err);
    return [];
  }
});

ipcMain.handle('search-teachers', async (event, query) => {
  try {
    const [rows] = await pool.query(`
      SELECT * FROM Teachers 
      WHERE name LIKE ? OR biometric_id LIKE ?
      ORDER BY name ASC
    `, [`%${query}%`, `%${query}%`]);
    return rows;
  } catch (err) {
    console.error('Error searching teachers:', err);
    return [];
  }
});

ipcMain.handle('get-teacher-logs', async (event, teacherId, days) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, DATE_FORMAT(log_time, '%Y-%m-%d %H:%i:%s') as log_time, log_type 
      FROM AttendanceLogs 
      WHERE teacher_id = ? AND log_time >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY log_time DESC
    `, [teacherId, days]);
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
    
    // Get current log to get the date - use DATE_FORMAT to ensure string format
    const [logRows] = await pool.query('SELECT DATE_FORMAT(log_time, \'%Y-%m-%d %H:%i:%s\') as log_time FROM AttendanceLogs WHERE id = ?', [logId]);
    if (logRows.length === 0) {
      console.log('Log not found:', logId);
      return { success: false, message: 'Log not found' };
    }
    
    const currentLogTime = logRows[0].log_time;
    console.log('Current log_time from DB:', currentLogTime);
    
    // Extract date portion (YYYY-MM-DD) from the formatted string
    const dateStr = currentLogTime.substring(0, 10);
    
    // Construct new datetime: YYYY-MM-DD HH:MM:SS
    const newDateTime = dateStr + ' ' + hours.padStart(2, '0') + ':' + minutes.padStart(2, '0') + ':00';
    console.log('New datetime string:', newDateTime);
    
    const result = await pool.query('UPDATE AttendanceLogs SET log_time = ? WHERE id = ?', [newDateTime, logId]);
    console.log('Update result - affected rows:', result[0].affectedRows);
    
    // Verify the update actually happened
    const [updatedRows] = await pool.query('SELECT log_time FROM AttendanceLogs WHERE id = ?', [logId]);
    console.log('Verified new log_time:', updatedRows[0].log_time);
    
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
    
    const result = await pool.query(
      'INSERT INTO AttendanceLogs (teacher_id, log_time, log_type) VALUES (?, ?, ?)',
      [teacherId, newDateTime, logType]
    );
    
    console.log('Create result - inserted row ID:', result[0].insertId);
    return { success: true, message: 'Log created successfully', logId: result[0].insertId };
  } catch (err) {
    console.error('Error creating attendance log:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('delete-attendance-log', async (event, logId) => {
  try {
    await pool.query('DELETE FROM AttendanceLogs WHERE id = ?', [logId]);
    return { success: true, message: 'Log deleted successfully' };
  } catch (err) {
    console.error('Error deleting attendance log:', err);
    return { success: false, message: err.message };
  }
});

// ─── Time Schedule ───────────────────────────────────────────

ipcMain.handle('get-time-schedule', async () => {
  try {
    const [rows] = await pool.query('SELECT * FROM TimeSchedule WHERE id = 1');
    if (rows.length === 0) {
      // Return defaults if no row exists
      return {
        am_time_in: '07:00', am_time_in_end: '08:00',
        am_time_out_start: '12:00', am_time_out: '12:20',
        pm_time_in: '12:35', pm_time_in_end: '13:00',
        pm_time_out_start: '17:00', pm_time_out: '18:00'
      };
    }
    const row = rows[0];
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
    await pool.query(`
      INSERT INTO TimeSchedule (id, am_time_in, am_time_in_end, am_time_out_start, am_time_out, pm_time_in, pm_time_in_end, pm_time_out_start, pm_time_out) 
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        am_time_in = VALUES(am_time_in),
        am_time_in_end = VALUES(am_time_in_end),
        am_time_out_start = VALUES(am_time_out_start),
        am_time_out = VALUES(am_time_out),
        pm_time_in = VALUES(pm_time_in),
        pm_time_in_end = VALUES(pm_time_in_end),
        pm_time_out_start = VALUES(pm_time_out_start),
        pm_time_out = VALUES(pm_time_out)
    `, [am_time_in, am_time_in_end, am_time_out_start, am_time_out, pm_time_in, pm_time_in_end, pm_time_out_start, pm_time_out]);
    return { success: true };
  } catch (err) {
    console.error('Error saving time schedule:', err);
    return { success: false, message: err.message };
  }
});

// ─── User Management ────────────────────────────────────────

ipcMain.handle('get-users', async () => {
  try {
    const [rows] = await pool.query('SELECT id, username, role, created_at FROM Users ORDER BY created_at ASC');
    return rows;
  } catch (err) {
    console.error('Error fetching users:', err);
    return [];
  }
});

ipcMain.handle('add-user', async (event, username, password, role) => {
  try {
    const hashed = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO Users (username, password, role) VALUES (?, ?, ?)', [username, hashed, role]);
    return { success: true };
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return { success: false, message: 'Username already exists.' };
    }
    console.error('Error adding user:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('change-password', async (event, userId, currentPassword, newPassword) => {
  try {
    const [rows] = await pool.query('SELECT password FROM Users WHERE id = ?', [userId]);
    if (rows.length === 0) {
      return { success: false, message: 'User not found.' };
    }
    const match = await bcrypt.compare(currentPassword, rows[0].password);
    if (!match) {
      return { success: false, message: 'Current password is incorrect.' };
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE Users SET password = ? WHERE id = ?', [hashed, userId]);
    return { success: true };
  } catch (err) {
    console.error('Error changing password:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('delete-user', async (event, userId) => {
  try {
    await pool.query('DELETE FROM Users WHERE id = ?', [userId]);
    return { success: true };
  } catch (err) {
    console.error('Error deleting user:', err);
    return { success: false, message: err.message };
  }
});

// ─── Biometric Device ───────────────────────────────────────

ipcMain.handle('connect-biometric', async (event, type, ip) => {
  try {
    const result = await biometricService.connect(type, ip);
    return result;
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('sync-logs', async () => {
  try {
    const logs = await biometricService.fetchLogs();
    
    if (logs.length > 0) {
      const insertValues = logs.map(l => {
        const teacher_id = l.biometric_id === 101 ? 1 : (l.biometric_id === 102 ? 2 : 0);
        return [teacher_id, new Date(l.log_time), l.log_type];
      });
      const valid = insertValues.filter(v => v[0] !== 0);
      if (valid.length > 0) {
        await pool.query('INSERT INTO AttendanceLogs (teacher_id, log_time, log_type) VALUES ?', [valid]);
      }
    }
    return { success: true, message: `Synced ${logs.length} logs successfully!` };
  } catch (err) {
    return { success: false, message: err.message };
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
