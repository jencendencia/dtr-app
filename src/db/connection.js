const mysql = require('mysql2/promise');

// Use default xampp/wamp credentials for local dev
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'joel',
  database: 'biometric_dtr',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('Successfully connected to MySQL database: biometric_dtr');
    connection.release();
    return true;
  } catch (error) {
    console.error('Failed to connect to MySQL database:', error.message);
    return false;
  }
}

module.exports = { pool, testConnection };
