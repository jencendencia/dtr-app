const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function seed() {
  const rootPool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: ''
  });

  try {
    console.log('Creating database if not exists...');
    await rootPool.query('CREATE DATABASE IF NOT EXISTS biometric_dtr');
    await rootPool.query('USE biometric_dtr');

    console.log('Dropping existing tables to refresh schema...');
    await rootPool.query('DROP TABLE IF EXISTS AttendanceLogs');
    await rootPool.query('DROP TABLE IF EXISTS Teachers');
    await rootPool.query('DROP TABLE IF EXISTS Users');
    await rootPool.query('DROP TABLE IF EXISTS TimeSchedule');

    console.log('Creating tables...');
    await rootPool.query(`
      CREATE TABLE Teachers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          biometric_id INT UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await rootPool.query(`
      CREATE TABLE AttendanceLogs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          teacher_id INT NOT NULL,
          log_time DATETIME NOT NULL,
          log_type ENUM('Check-in', 'Check-out') NOT NULL,
          FOREIGN KEY (teacher_id) REFERENCES Teachers(id)
      )
    `);

    await rootPool.query(`
      CREATE TABLE Users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          role ENUM('admin', 'user') DEFAULT 'user',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await rootPool.query(`
      CREATE TABLE TimeSchedule (
          id INT PRIMARY KEY DEFAULT 1,
          am_time_in TIME NOT NULL DEFAULT '07:00:00',
          am_time_in_end TIME NOT NULL DEFAULT '08:00:00',
          am_time_out_start TIME NOT NULL DEFAULT '12:00:00',
          am_time_out TIME NOT NULL DEFAULT '12:20:00',
          pm_time_in TIME NOT NULL DEFAULT '12:35:00',
          pm_time_in_end TIME NOT NULL DEFAULT '13:00:00',
          pm_time_out_start TIME NOT NULL DEFAULT '17:00:00',
          pm_time_out TIME NOT NULL DEFAULT '18:00:00',
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    console.log('Inserting mock teachers...');
    await rootPool.query(`
      INSERT INTO Teachers (id, name, biometric_id) VALUES 
      (1, 'Jane Doe', 101),
      (2, 'John Smith', 102),
      (3, 'Maria Santos', 103),
      (4, 'Carlos Rivera', 104)
    `);

    // Default admin user (password: admin123)
    console.log('Creating default admin user...');
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await rootPool.query(
      'INSERT INTO Users (username, password, role) VALUES (?, ?, ?)',
      ['admin', hashedPassword, 'admin']
    );

    // Default time schedule
    console.log('Setting default time schedule...');
    await rootPool.query(`
      INSERT INTO TimeSchedule (id, am_time_in, am_time_in_end, am_time_out_start, am_time_out, pm_time_in, pm_time_in_end, pm_time_out_start, pm_time_out) 
      VALUES (1, '07:00:00', '08:00:00', '12:00:00', '12:20:00', '12:35:00', '13:00:00', '17:00:00', '18:00:00')
    `)

    console.log('Generating mock attendance logs for June 2026...');
    const logs = [];
    for (let day = 1; day <= 30; day++) {
      const dateStr = `2026-06-${day.toString().padStart(2, '0')}`;
      const dateObj = new Date(2026, 5, day); // June = 5
      const dow = dateObj.getDay();
      const isWeekend = dow === 0 || dow === 6;

      if (isWeekend) continue;

      // Teacher 1 - Jane Doe: Punctual (Logs between start and end)
      logs.push([1, `${dateStr} 07:15:00`, 'Check-in']);
      logs.push([1, `${dateStr} 12:10:00`, 'Check-out']);
      logs.push([1, `${dateStr} 12:40:00`, 'Check-in']);
      logs.push([1, `${dateStr} 18:05:00`, 'Check-out']);

      // Teacher 2 - John Smith: Late (After grace)
      // AM Late (Target 8:00, Log 8:05 -> 5 mins late)
      logs.push([2, `${dateStr} 08:05:00`, 'Check-in']);
      logs.push([2, `${dateStr} 12:05:00`, 'Check-out']);
      // PM Late (Target 1:00 PM (13:00), Log 1:10 PM (13:10) -> 10 mins late)
      logs.push([2, `${dateStr} 13:10:00`, 'Check-in']);
      logs.push([2, `${dateStr} 17:55:00`, 'Check-out']);

      // Teacher 3 - Maria Santos: Undertime (Leaving early)
      logs.push([3, `${dateStr} 07:50:00`, 'Check-in']);
      // AM Early (Target 12:00, Log 11:50 -> 10 mins early)
      logs.push([3, `${dateStr} 11:50:00`, 'Check-out']);
      logs.push([3, `${dateStr} 12:55:00`, 'Check-in']);
      // PM Early (Target 18:00, Log 17:30 -> 30 mins early)
      logs.push([3, `${dateStr} 17:30:00`, 'Check-out']);
    }

    await rootPool.query('INSERT INTO AttendanceLogs (teacher_id, log_time, log_type) VALUES ?', [logs]);

    console.log('Seeding complete!');
    console.log('Default admin login — username: admin, password: admin123');
  } catch (err) {
    console.error('Error during seeding:', err);
  } finally {
    await rootPool.end();
  }
}

seed();
