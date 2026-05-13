const mysql = require('mysql2/promise');

async function migrate() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'biometric_dtr',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  try {
    console.log('Checking if column exists...');
    const [rows] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'TimeSchedule' AND COLUMN_NAME = 'pm_time_out_start'
    `);

    if (rows.length > 0) {
      console.log('Column pm_time_out_start already exists.');
    } else {
      console.log('Adding pm_time_out_start column...');
      await pool.query(`
        ALTER TABLE TimeSchedule 
        ADD COLUMN pm_time_out_start TIME NOT NULL DEFAULT '17:00:00' AFTER pm_time_in_end
      `);
      console.log('✓ Column added successfully!');
    }

    // Also ensure the data is set if it's NULL
    await pool.query(`
      UPDATE TimeSchedule SET pm_time_out_start = '17:00:00' WHERE pm_time_out_start IS NULL
    `);

    console.log('Migration complete!');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
