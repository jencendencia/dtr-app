const Zkteco = require('zkteco-js');

class ZktecoService {
  constructor() {
    this.device = null;
    this.connected = false;
    this.deviceInfo = null;
  }

  /**
   * Connect to a ZKTeco device via TCP/IP.
   * @param {string} ip - Device IP address
   * @param {number} port - Device port (default 4370)
   * @param {number} timeout - Connection timeout in ms (default 5000)
   * @returns {{success: boolean, info?: object, message?: string}}
   */
  async connect(ip, port = 4370, timeout = 5000) {
    try {
      // Disconnect any existing connection first
      if (this.device) {
        try { await this.device.disconnect(); } catch (_) {}
        this.device = null;
        this.connected = false;
      }

      this.device = new Zkteco(ip, port, 5200, timeout);
      await this.device.createSocket();
      this.connected = true;

      // Get device info
      const info = await this.device.getInfo();
      this.deviceInfo = {
        ip,
        port,
        userCount: info.userCounts || 0,
        attendanceCount: info.logCounts || 0,
        attendanceCapacity: info.logCapacity || 0
      };

      // Try to get device name/version
      try {
        this.deviceInfo.deviceName = await this.device.getDeviceName();
      } catch (_) {}
      try {
        this.deviceInfo.version = await this.device.getDeviceVersion();
      } catch (_) {}

      console.log(`[ZktecoService] Connected to device at ${ip}:${port}`, this.deviceInfo);
      return { success: true, info: this.deviceInfo };
    } catch (err) {
      console.error('[ZktecoService] Connection error:', err);
      this.connected = false;
      this.device = null;
      return { success: false, message: `Connection failed: ${err.message}` };
    }
  }

  /**
   * Disconnect from the current device.
   */
  async disconnect() {
    try {
      if (this.device) {
        await this.device.disconnect();
      }
    } catch (_) {}
    this.device = null;
    this.connected = false;
    this.deviceInfo = null;
    console.log('[ZktecoService] Disconnected');
  }

  /**
   * Check if currently connected to a device.
   */
  isConnected() {
    return this.connected && this.device !== null;
  }

  /**
   * Get device info (must be connected).
   */
  getDeviceInfo() {
    return this.deviceInfo;
  }

  /**
   * Retrieve all attendance logs from the device.
   * @returns {{success: boolean, data?: Array, message?: string}}
   */
  async getAttendanceLogs() {
    if (!this.isConnected()) {
      return { success: false, message: 'Not connected to any device.' };
    }

    try {
      const response = await this.device.getAttendances();
      const rawLogs = response.data || [];
      console.log(`[ZktecoService] Retrieved ${rawLogs.length} raw attendance log(s)`);
      if (rawLogs.length > 0) {
        console.log(`[ZktecoService] Sample raw record:`, JSON.stringify(rawLogs[0]));
      }

      // Normalize logs into our format
      const records = [];
      for (const log of rawLogs) {
        // zkteco-js decodeRecordData40 returns:
        // { sn, user_id, record_time, type, state }
        // record_time is a Date.toString() string, type: 0=check-in, 1=check-out
        let logTime = '';

        if (log.record_time) {
          // record_time is a Date.toString() like "Mon Jul 21 2026 08:30:00 GMT+0800 (Philippine Standard Time)"
          // We need to preserve the LOCAL time, not convert to UTC
          const parsed = new Date(log.record_time);
          if (!isNaN(parsed.getTime())) {
            // Use local time components to avoid timezone conversion
            const year = parsed.getFullYear();
            const month = String(parsed.getMonth() + 1).padStart(2, '0');
            const day = String(parsed.getDate()).padStart(2, '0');
            const hours = String(parsed.getHours()).padStart(2, '0');
            const minutes = String(parsed.getMinutes()).padStart(2, '0');
            const seconds = String(parsed.getSeconds()).padStart(2, '0');
            logTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
          } else {
            // Try parsing as-is
            logTime = String(log.record_time);
          }
        }

        if (!logTime) continue;

        // Determine log type: type 0 = check-in, type 1 = check-out
        let logType = 'Check-in';
        if (log.type === 1) {
          logType = 'Check-out';
        } else if (log.type !== 0) {
          // Fallback: classify by time of day
          const timeMatch = logTime.match(/(\d{2}):(\d{2})/);
          if (timeMatch) {
            const mins = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
            logType = mins < 720 ? 'Check-in' : 'Check-out';
          }
        }

        records.push({
          employeeId: String(log.user_id || ''),
          logTime: logTime,
          logType: logType,
          state: log.state
        });
      }
      if (records.length > 0) {
        console.log(`[ZktecoService] Sample parsed record:`, JSON.stringify(records[0]));
      }

      console.log(`[ZktecoService] Parsed ${records.length} attendance record(s)`);
      return { success: true, data: records, message: `Retrieved ${records.length} record(s) from device.` };
    } catch (err) {
      console.error('[ZktecoService] Get attendance error:', err);
      return { success: false, message: `Failed to retrieve logs: ${err.message}` };
    }
  }

  /**
   * Retrieve all users registered on the device.
   * @returns {{success: boolean, data?: Array, message?: string}}
   */
  async getUsers() {
    if (!this.isConnected()) {
      return { success: false, message: 'Not connected to any device.' };
    }

    try {
      const response = await this.device.getUsers();
      const users = response.data || [];
      console.log(`[ZktecoService] Retrieved ${users.length} user(s) from device`);
      return { success: true, data: users, message: `Retrieved ${users.length} user(s).` };
    } catch (err) {
      console.error('[ZktecoService] Get users error:', err);
      return { success: false, message: `Failed to retrieve users: ${err.message}` };
    }
  }

  /**
   * Add or update a user on the device.
   * @param {number} uid - Internal device record ID (1-3000)
   * @param {string} userid - User-facing ID (max 9 chars)
   * @param {string} name - Display name (max 24 chars)
   * @param {string} password - Device password (max 8 chars)
   * @param {number} role - 0=normal, 1=admin
   * @param {number} cardno - Card number
   * @returns {{success: boolean, message?: string}}
   */
  async setUser(uid, userid, name, password = '', role = 0, cardno = 0) {
    if (!this.isConnected()) {
      return { success: false, message: 'Not connected to any device.' };
    }

    try {
      await this.device.setUser(uid, String(userid), String(name).substring(0, 24), String(password).substring(0, 8), role, cardno);
      console.log(`[ZktecoService] Set user: uid=${uid}, userid=${userid}, name=${name}`);
      return { success: true, message: `User "${name}" enrolled on device.` };
    } catch (err) {
      console.error('[ZktecoService] Set user error:', err);
      return { success: false, message: `Failed to enroll user: ${err.message}` };
    }
  }

  /**
   * Delete a user from the device.
   * @param {number} uid - Internal device record ID (1-3000)
   * @returns {{success: boolean, message?: string}}
   */
  async deleteUser(uid) {
    if (!this.isConnected()) {
      return { success: false, message: 'Not connected to any device.' };
    }

    try {
      await this.device.deleteUser(uid);
      console.log(`[ZktecoService] Deleted user: uid=${uid}`);
      return { success: true, message: `User removed from device.` };
    } catch (err) {
      console.error('[ZktecoService] Delete user error:', err);
      return { success: false, message: `Failed to delete user: ${err.message}` };
    }
  }

  /**
   * Clear all attendance logs from the device.
   * @returns {{success: boolean, message?: string}}
   */
  async clearAttendanceLog() {
    if (!this.isConnected()) {
      return { success: false, message: 'Not connected to any device.' };
    }

    try {
      await this.device.clearAttendanceLog();
      console.log('[ZktecoService] Cleared attendance logs from device');
      return { success: true, message: 'Attendance logs cleared from device.' };
    } catch (err) {
      console.error('[ZktecoService] Clear attendance log error:', err);
      return { success: false, message: `Failed to clear logs: ${err.message}` };
    }
  }

  /**
   * Get device status/info.
   */
  async getStatus() {
    if (!this.isConnected()) {
      return { connected: false };
    }

    try {
      const info = await this.device.getInfo();
      return {
        connected: true,
        ...this.deviceInfo,
        ...info
      };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }
}

module.exports = new ZktecoService();
