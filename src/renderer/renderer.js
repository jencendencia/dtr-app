const { ipcRenderer } = require('electron');
const { generateDTRHtml } = require('./dtrGenerator');

let currentUser = null;
let timeSchedule = null;
let currentTeacherId = null;
let currentMonth = null;
let currentYear = null;

document.addEventListener('DOMContentLoaded', () => {
  applyBranding();
  setupLogin();
});

function applyBranding() {
  const schoolName = localStorage.getItem('schoolName') || '';
  const schoolLogo = localStorage.getItem('schoolLogo') || '';
  const titleText = schoolName ? `${schoolName} DTR System` : 'DTR System';

  const loginTitle = document.getElementById('login-title');
  const sidebarTitle = document.getElementById('sidebar-title');
  const loginLogo = document.getElementById('login-logo');
  const sidebarLogo = document.getElementById('sidebar-logo');
  const loginIconDefault = document.getElementById('login-icon-default');

  if (loginTitle) loginTitle.textContent = titleText;
  if (sidebarTitle) sidebarTitle.textContent = titleText;

  if (schoolLogo) {
    if (loginLogo) { loginLogo.src = schoolLogo; loginLogo.style.display = 'block'; }
    if (sidebarLogo) { sidebarLogo.src = schoolLogo; sidebarLogo.style.display = 'block'; }
    if (loginIconDefault) loginIconDefault.style.display = 'none';
  } else {
    if (loginLogo) loginLogo.style.display = 'none';
    if (sidebarLogo) sidebarLogo.style.display = 'none';
    if (loginIconDefault) loginIconDefault.style.display = '';
  }
}

// ─── LOGIN ──────────────────────────────────────────────────

function setupLogin() {
  const form = document.getElementById('login-form');
  const errEl = document.getElementById('login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');

    btn.disabled = true;
    btn.textContent = 'Signing in...';
    errEl.textContent = '';

    try {
      const res = await ipcRenderer.invoke('login', username, password);
      if (res.success) {
        currentUser = res.user;
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';
        document.getElementById('user-name').textContent = currentUser.username;
        document.getElementById('user-avatar').textContent = currentUser.username[0].toUpperCase();
        // Hide admin nav for non-admin users
        if (currentUser.role !== 'admin') {
          document.getElementById('nav-admin').style.display = 'none';
        }
        try {
          initApp();
        } catch (appErr) {
          console.error('App initialization error:', appErr);
          errEl.textContent = 'Error initializing app: ' + appErr.message;
          btn.disabled = false;
          btn.textContent = 'Sign In';
        }
      } else {
        errEl.textContent = res.message;
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    } catch (err) {
      console.error('Login error:', err);
      errEl.textContent = 'Login error: ' + err.message;
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}

// ─── APP INIT ───────────────────────────────────────────────

function initApp() {
  const mainContent = document.getElementById('main-content');
  const navBtns = document.querySelectorAll('.nav-btn');

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    currentUser = null;
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').textContent = '';
    document.getElementById('login-btn').disabled = false;
    document.getElementById('login-btn').textContent = 'Sign In';
  });

  // Cache views so switching tabs preserves state (e.g. generated DTR previews)
  const viewCache = {};
  const viewSetupDone = {};

  function showView(viewId) {
    // Hide all cached views
    Object.values(viewCache).forEach(el => el.style.display = 'none');

    // Create view if not cached yet
    if (!viewCache[viewId]) {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-view', viewId);
      if (viewId === 'dashboard') wrapper.innerHTML = getDashboardView();
      else if (viewId === 'dtr') wrapper.innerHTML = getDtrView();
      else if (viewId === 'search-teacher') wrapper.innerHTML = getSearchTeacherView();
      else if (viewId === 'admin') wrapper.innerHTML = getAdminView();
      else if (viewId === 'settings') wrapper.innerHTML = getSettingsView();
      mainContent.appendChild(wrapper);
      viewCache[viewId] = wrapper;
    }

    // Show the requested view
    viewCache[viewId].style.display = '';

    // Run setup only once per view
    if (!viewSetupDone[viewId]) {
      viewSetupDone[viewId] = true;
      if (viewId === 'dashboard') setupDashboardView();
      else if (viewId === 'dtr') setupDtrView();
      else if (viewId === 'search-teacher') setupSearchTeacherView();
      else if (viewId === 'admin') setupAdminView();
      else if (viewId === 'settings') setupSettingsView();
    }
  }

  showView('dashboard');

  navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      navBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const viewId = e.target.id.replace('nav-', '');
      showView(viewId);
    });
  });
}

// ─── VIEW TEMPLATES ─────────────────────────────────────────

function getDashboardView() {
  return `
    <div class="view-section active" id="dashboard-view">
      <div class="dashboard-header"><h1>Dashboard</h1><p>Welcome to the Biometric DTR System</p></div>
      <div class="card" style="margin-bottom:20px;">
        <h3>Connect Biometric Device</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:15px;">Select the brand/type of device you are using to connect.</p>
        <div style="display:flex;gap:10px;align-items:center;">
          <select id="device-type" style="padding:8px;border-radius:6px;border:1px solid var(--border);">
            <option value="zkteco">ZKTeco (Network)</option>
            <option value="secugen">SecuGen (USB)</option>
            <option value="digitalpersona">DigitalPersona (USB)</option>
          </select>
          <input type="text" id="device-ip" placeholder="IP Address (if network)" value="192.168.1.201" style="padding:8px;border-radius:6px;border:1px solid var(--border);width:180px;">
          <button id="btn-connect" style="padding:8px 16px;background:var(--accent);color:white;border:none;border-radius:6px;cursor:pointer;">Connect</button>
        </div>
        <p style="margin-top:15px;">Status: <span id="conn-status" style="color:red;font-weight:bold;">Disconnected</span></p>
      </div>
      <div class="card">
        <h3>Data Synchronization</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:15px;">Pull new attendance records and store them in the database.</p>
        <button id="btn-sync" style="padding:8px 16px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;" disabled>Sync Logs to Database</button>
        <p id="sync-status" style="margin-top:10px;color:var(--text-muted);font-size:14px;"></p>
      </div>
    </div>`;
}

function getDtrView() {
  return `
    <div class="view-section active" id="dtr-view">
      <div class="dashboard-header"><h1>Print DTR</h1><p>Generate and print Civil Service Form No. 48</p></div>
      <div class="card" style="margin-bottom:20px;display:flex;gap:10px;align-items:center;">
        <select id="teacher-select" style="padding:8px;border-radius:6px;border:1px solid var(--border);min-width:150px;"><option value="">Select Teacher</option></select>
        <input type="month" id="month-select" value="2026-06" style="padding:8px;border-radius:6px;border:1px solid var(--border);">
        <button id="btn-generate-dtr" style="padding:8px 16px;background:var(--accent);color:white;border:none;border-radius:6px;cursor:pointer;">Generate DTR</button>
        <button id="btn-generate-all" style="padding:8px 16px;background:#6366f1;color:white;border:none;border-radius:6px;cursor:pointer;">Print All</button>
        <button id="btn-print-dtr" style="padding:8px 16px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;margin-left:auto;">Print Document</button>
      </div>
      <div id="dtr-preview-container" style="background:#e5e7eb;padding:20px;border-radius:12px;overflow-y:auto;max-height:500px;display:flex;justify-content:center;">
        <div style="background:white;width:6.5in;height:9in;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-style:italic;">Select a teacher and month to generate preview</div>
      </div>
    </div>`;
}

function getSearchTeacherView() {
  return `
    <div class="view-section active" id="search-teacher-view">
      <div class="dashboard-header"><h1>Search Teacher</h1><p>Find and edit teacher attendance records</p></div>
      <div class="card" style="margin-bottom:20px;">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:15px;">
          <input type="text" id="teacher-search-input" placeholder="Search by teacher name or ID..." style="padding:8px;border-radius:6px;border:1px solid var(--border);flex:1;">
          <button id="btn-search-teacher" style="padding:8px 16px;background:var(--accent);color:white;border:none;border-radius:6px;cursor:pointer;">Search</button>
        </div>
        <div id="teacher-search-results" style="display:none;margin-bottom:15px;max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;">
          <!-- Results will be inserted here -->
        </div>
      </div>
      <div class="card" id="teacher-details-card" style="display:none;">
        <h3 id="teacher-details-name"></h3>
        <div style="margin-bottom:20px;padding:10px;background:#f3f4f6;border-radius:6px;">
          <p><strong>Biometric ID:</strong> <span id="teacher-details-biometric"></span></p>
          <p><strong>Date Created:</strong> <span id="teacher-details-created"></span></p>
        </div>
        <div style="margin-bottom:15px;display:flex;gap:10px;align-items:center;">
          <label for="search-month-select" style="font-weight:500;">View Month/Year:</label>
          <input type="month" id="search-month-select" value="2026-06" style="padding:8px;border-radius:6px;border:1px solid var(--border);">
          <button id="btn-refresh-logs" style="padding:8px 16px;background:var(--accent);color:white;border:none;border-radius:6px;cursor:pointer;">Refresh Logs</button>
        </div>
        <h4 style="margin-bottom:15px;">Attendance Records</h4>
        <div id="teacher-logs-container" style="max-height:400px;overflow-y:auto;">
          <!-- Logs will be inserted here -->
        </div>
      </div>
    </div>`;
}

function getAdminView() {
  return `
    <div class="view-section active" id="admin-view">
      <div class="dashboard-header"><h1>Admin</h1><p>Manage time schedule and system settings</p></div>
      <div class="card">
        <h3>Time Schedule Configuration</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:20px;">Set the official time-in and time-out windows. Teachers arriving after the grace period are marked late.</p>
        <div class="time-schedule-grid">
          <div class="time-schedule-card">
            <h4>🌅 Morning (A.M.)</h4>
            <p class="schedule-label">Before noon schedule</p>
            <div class="time-input-group">
              <div class="time-input-row"><label>Time In:</label><input type="time" id="sched-am-in" value="07:00"></div>
              <div class="time-input-row"><label>Grace Until:</label><input type="time" id="sched-am-in-end" value="08:00"></div>
              <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">Late if arrival is after grace time</p>
              <div class="time-input-row" style="margin-top:8px;"><label>Out From:</label><input type="time" id="sched-am-out-start" value="12:00"></div>
              <div class="time-input-row"><label>Out Until:</label><input type="time" id="sched-am-out" value="12:20"></div>
            </div>
          </div>
          <div class="time-schedule-card">
            <h4>🌇 Afternoon (P.M.)</h4>
            <p class="schedule-label">After noon schedule</p>
            <div class="time-input-group">
              <div class="time-input-row"><label>Time In:</label><input type="time" id="sched-pm-in" value="12:35"></div>
              <div class="time-input-row"><label>Grace Until:</label><input type="time" id="sched-pm-in-end" value="13:00"></div>
              <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">Late if arrival is after grace time</p>
              <div class="time-input-row" style="margin-top:8px;"><label>Out From:</label><input type="time" id="sched-pm-out-start" value="17:00"></div>
              <div class="time-input-row"><label>Out Until:</label><input type="time" id="sched-pm-out" value="18:00"></div>
            </div>
          </div>
        </div>
        <div style="margin-top:20px;display:flex;align-items:center;gap:12px;">
          <button class="btn-primary" id="btn-save-schedule">Save Schedule</button>
          <span class="status-msg" id="schedule-status"></span>
        </div>
      </div>
    </div>`;
}

function getSettingsView() {
  return `
    <div class="view-section active" id="settings-view">
      <div class="dashboard-header"><h1>Settings</h1><p>Configure app settings</p></div>
      <div class="card" style="margin-bottom:20px;">
        <h3>School Branding</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:15px;">Set the school name and logo. These will appear on the login screen and navigation bar.</p>
        <div style="display:flex;flex-direction:column;gap:10px;max-width:400px;">
          <label style="font-weight:500;font-size:14px;">School Name</label>
          <input type="text" id="school-name" placeholder="e.g. BNCHS" style="padding:8px;border-radius:6px;border:1px solid var(--border);">
          <label style="font-weight:500;font-size:14px;margin-top:10px;">Upload Logo</label>
          <input type="file" id="school-logo" accept="image/*" style="padding:8px;border-radius:6px;border:1px solid var(--border);">
          <div id="logo-preview" style="margin-top:5px;min-height:60px;border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;border-radius:6px;background:#f9fafb;"><span style="color:#9ca3af;font-size:12px;">No logo uploaded</span></div>
          <button class="btn-primary" id="btn-save-branding" style="align-self:flex-start;">Save Branding</button>
          <p class="status-msg" id="branding-status"></p>
        </div>
      </div>
      <div class="card" style="margin-bottom:20px;">
        <h3>Principal Information</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:15px;">Set the Principal's name and signature for the DTR.</p>
        <div style="display:flex;flex-direction:column;gap:10px;max-width:400px;">
          <label style="font-weight:500;font-size:14px;">Principal Name</label>
          <input type="text" id="principal-name" placeholder="e.g. JUAN DELA CRUZ, Ed.D." style="padding:8px;border-radius:6px;border:1px solid var(--border);">
          <label style="font-weight:500;font-size:14px;margin-top:10px;">Upload Signature</label>
          <input type="file" id="principal-signature" accept="image/*" style="padding:8px;border-radius:6px;border:1px solid var(--border);">
          <div id="signature-preview" style="margin-top:5px;min-height:60px;border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;border-radius:6px;background:#f9fafb;"><span style="color:#9ca3af;font-size:12px;">No signature uploaded</span></div>
          <button class="btn-primary" id="btn-save-principal" style="align-self:flex-start;">Save Principal Info</button>
          <p class="status-msg" id="principal-status"></p>
        </div>
      </div>
      <div class="card" style="margin-bottom:20px;">
        <h3>Change Password</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:15px;">Update your account password.</p>
        <div style="display:flex;flex-direction:column;gap:10px;max-width:400px;">
          <div class="form-group"><label>Current Password</label><input type="password" id="current-pw"></div>
          <div class="form-group"><label>New Password</label><input type="password" id="new-pw"></div>
          <div class="form-group"><label>Confirm New Password</label><input type="password" id="confirm-pw"></div>
          <button class="btn-primary" id="btn-change-pw" style="align-self:flex-start;">Change Password</button>
          <p class="status-msg" id="pw-status"></p>
        </div>
      </div>
      ${currentUser && currentUser.role === 'admin' ? `
      <div class="card">
        <h3>User Management</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:15px;">Add or remove users who can access the system.</p>
        <div class="form-row" style="margin-bottom:16px;">
          <div class="form-group"><label>Username</label><input type="text" id="new-username" placeholder="username"></div>
          <div class="form-group"><label>Password</label><input type="password" id="new-user-pw" placeholder="password"></div>
          <div class="form-group"><label>Role</label><select id="new-user-role"><option value="user">User</option><option value="admin">Admin</option></select></div>
          <button class="btn-success" id="btn-add-user" style="margin-bottom:1px;">Add User</button>
        </div>
        <p class="status-msg" id="user-mgmt-status"></p>
        <table class="users-table"><thead><tr><th>Username</th><th>Role</th><th>Created</th><th></th></tr></thead><tbody id="users-tbody"></tbody></table>
      </div>` : ''}
    </div>`;
}

// ─── VIEW SETUP FUNCTIONS ───────────────────────────────────

function setupDashboardView() {
  const btnConnect = document.getElementById('btn-connect');
  const connStatus = document.getElementById('conn-status');
  const btnSync = document.getElementById('btn-sync');
  const syncStatus = document.getElementById('sync-status');
  if (!btnConnect) return;

  btnConnect.addEventListener('click', async () => {
    btnConnect.disabled = true; btnConnect.innerText = 'Connecting...';
    connStatus.innerText = 'Attempting connection...'; connStatus.style.color = '#f59e0b';
    const res = await ipcRenderer.invoke('connect-biometric', document.getElementById('device-type').value, document.getElementById('device-ip').value);
    btnConnect.innerText = 'Connect'; btnConnect.disabled = false;
    if (res.success) { connStatus.innerText = 'Connected'; connStatus.style.color = '#10b981'; btnSync.disabled = false; }
    else { connStatus.innerText = 'Connection Failed: ' + res.message; connStatus.style.color = 'red'; btnSync.disabled = true; }
  });

  btnSync.addEventListener('click', async () => {
    btnSync.disabled = true; syncStatus.innerText = 'Fetching and parsing logs...';
    const res = await ipcRenderer.invoke('sync-logs');
    if (res.success) { syncStatus.innerText = res.message; syncStatus.style.color = '#10b981'; }
    else { syncStatus.innerText = 'Error: ' + res.message; syncStatus.style.color = 'red'; }
    btnSync.disabled = false;
  });
}

async function setupDtrView() {
  const container = document.getElementById('dtr-preview-container');
  const select = document.getElementById('teacher-select');
  const monthSelect = document.getElementById('month-select');
  const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // Load schedule
  timeSchedule = await ipcRenderer.invoke('get-time-schedule');

  const teachers = await ipcRenderer.invoke('get-teachers');
  select.innerHTML = '<option value="">Select Teacher</option>';
  teachers.forEach(t => { select.innerHTML += `<option value="${t.id}">${t.name}</option>`; });

  document.getElementById('btn-generate-dtr').addEventListener('click', async () => {
    const teacherId = select.value; const monthVal = monthSelect.value;
    if (!teacherId || !monthVal) return alert('Select teacher and month');
    const [year, month] = monthVal.split('-');
    // Fetch fresh time schedule before generating DTR
    const freshSchedule = await ipcRenderer.invoke('get-time-schedule');
    const logs = await ipcRenderer.invoke('get-attendance', parseInt(teacherId), parseInt(month), parseInt(year));
    container.innerHTML = generateDTRHtml(select.options[select.selectedIndex].text, monthNames[parseInt(month)], year, logs, freshSchedule);
  });

  document.getElementById('btn-generate-all').addEventListener('click', async () => {
    const monthVal = monthSelect.value;
    if (!monthVal) return alert('Select a month');
    const [year, month] = monthVal.split('-');
    // Fetch fresh time schedule before generating DTR
    const freshSchedule = await ipcRenderer.invoke('get-time-schedule');
    let allHtml = '';
    for (const t of teachers) {
      const logs = await ipcRenderer.invoke('get-attendance', t.id, parseInt(month), parseInt(year));
      allHtml += generateDTRHtml(t.name, monthNames[parseInt(month)], year, logs, freshSchedule);
    }
    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:40px;width:100%;">${allHtml}</div>`;
  });

  document.getElementById('btn-print-dtr').addEventListener('click', () => { ipcRenderer.invoke('print-dtr'); });
}

async function setupSearchTeacherView() {
  const searchInput = document.getElementById('teacher-search-input');
  const searchBtn = document.getElementById('btn-search-teacher');
  const resultsContainer = document.getElementById('teacher-search-results');
  const detailsCard = document.getElementById('teacher-details-card');
  const monthSelect = document.getElementById('search-month-select');
  const refreshBtn = document.getElementById('btn-refresh-logs');
  
  // Store current teacher ID for month changes
  let currentTeacherId = null;
  
  // Clone and replace button to remove all existing event listeners
  const newBtn = searchBtn.cloneNode(true);
  searchBtn.parentNode.replaceChild(newBtn, searchBtn);
  const freshBtn = document.getElementById('btn-search-teacher');
  
  freshBtn.addEventListener('click', async () => {
    const query = searchInput.value.trim();
    if (!query) {
      alert('Enter a search term');
      return;
    }
    
    console.log('Searching for:', query);
    const results = await ipcRenderer.invoke('search-teachers', query);
    console.log('Search results:', results);
    
    if (results.length === 0) {
      resultsContainer.innerHTML = '<div style="padding:10px;color:#6b7280;">No teachers found</div>';
      resultsContainer.style.display = 'block';
      detailsCard.style.display = 'none';
      return;
    }
    
    let html = '<div style="display:flex;flex-direction:column;">';
    results.forEach(t => {
      html += `<div style="padding:10px;border-bottom:1px solid #e5e7eb;cursor:pointer;" class="search-result-item" data-teacher-id="${t.id}" data-teacher-name="${t.name}" data-teacher-biometric="${t.biometric_id}" data-teacher-created="${t.created_at}">
        <strong>${t.name}</strong> (ID: ${t.biometric_id})
      </div>`;
    });
    html += '</div>';
    resultsContainer.innerHTML = html;
    resultsContainer.style.display = 'block';
    
    document.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', async () => {
        const teacherId = item.getAttribute('data-teacher-id');
        const teacherName = item.getAttribute('data-teacher-name');
        const biometricId = item.getAttribute('data-teacher-biometric');
        const createdAt = item.getAttribute('data-teacher-created');
        
        currentTeacherId = teacherId;
        
        document.getElementById('teacher-details-name').textContent = teacherName;
        document.getElementById('teacher-details-biometric').textContent = biometricId;
        document.getElementById('teacher-details-created').textContent = new Date(createdAt).toLocaleDateString();
        
        // Load logs for the selected month
        const monthVal = monthSelect.value;
        const [year, month] = monthVal.split('-');
        currentYear = parseInt(year);
        currentMonth = parseInt(month);
        const logs = await ipcRenderer.invoke('get-attendance', parseInt(teacherId), parseInt(month), parseInt(year));
        displayTeacherLogs(logs, teacherId);
        
        resultsContainer.style.display = 'none';
        detailsCard.style.display = 'block';
      });
    });
  });

  // Add handler for month changes
  const newRefreshBtn = refreshBtn.cloneNode(true);
  refreshBtn.parentNode.replaceChild(newRefreshBtn, refreshBtn);
  document.getElementById('btn-refresh-logs').addEventListener('click', async () => {
    if (!currentTeacherId) {
      alert('Please select a teacher first');
      return;
    }
    const monthVal = monthSelect.value;
    const [year, month] = monthVal.split('-');
    currentYear = parseInt(year);
    currentMonth = parseInt(month);
    const logs = await ipcRenderer.invoke('get-attendance', parseInt(currentTeacherId), parseInt(month), parseInt(year));
    displayTeacherLogs(logs, currentTeacherId);
  });
  
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') freshBtn.click();
  });
}

function displayTeacherLogs(logs, teacherId) {
  const logsContainer = document.getElementById('teacher-logs-container');
  if (logs.length === 0) {
    logsContainer.innerHTML = '<div style="padding:10px;color:#6b7280;">No logs found</div>';
    return;
  }
  
  // Load time schedule for calculation
  ipcRenderer.invoke('get-time-schedule').then(timeSchedule => {
    // Group logs by day - parse day directly from string to avoid timezone issues
    const logsByDay = {};
    logs.forEach(l => {
      // log_time is 'YYYY-MM-DD HH:MM:SS' string from DATE_FORMAT
      const d = parseInt(l.log_time.substring(8, 10));
      if (!logsByDay[d]) logsByDay[d] = [];
      logsByDay[d].push(l);
    });

    const sAmOutStart = timeToMinutes(timeSchedule.am_time_out_start);
    const sPmOutStart = timeToMinutes(timeSchedule.pm_time_out_start);

    const sAmInEnd = timeToMinutes(timeSchedule.am_time_in_end);
    const sPmInEnd = timeToMinutes(timeSchedule.pm_time_in_end);

    let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="background:#f3f4f6;"><th style="padding:8px;text-align:center;border:1px solid #e5e7eb;">Day</th><th style="padding:8px;text-align:center;border:1px solid #e5e7eb;">AM In</th><th style="padding:8px;text-align:center;border:1px solid #e5e7eb;">AM Out</th><th style="padding:8px;text-align:center;border:1px solid #e5e7eb;">PM In</th><th style="padding:8px;text-align:center;border:1px solid #e5e7eb;">PM Out</th><th style="padding:8px;text-align:center;border:1px solid #e5e7eb;">Undertime</th><th style="padding:8px;text-align:center;border:1px solid #e5e7eb;">Actions</th></tr></thead>';
    html += '<tbody>';

    // Process each day
    for (let i = 1; i <= 31; i++) {
      const dayLogs = logsByDay[i] || [];
      if (dayLogs.length === 0) continue;

      let amIn = '', amOut = '', pmIn = '', pmOut = '';
      let amInMins = null, amOutMins = null, pmInMins = null, pmOutMins = null;

      dayLogs.forEach(l => {
        // log_time is always 'YYYY-MM-DD HH:MM:SS' from DATE_FORMAT
        const timePart = l.log_time.substring(11); // 'HH:MM:SS'
        const [hours, minutes] = timePart.split(':').map(Number);
        const mins = hours * 60 + minutes;
        
        // Classification logic
        if (mins < 660) { // Before 11:00 AM
          if (l.log_type === 'Check-in') { amIn = formatTimeOnly(l.log_time); amInMins = mins; }
        }
        
        if (mins >= 660 && mins < 750) { // 11:00 AM to 12:30 PM
          if (l.log_type === 'Check-out') { amOut = formatTimeOnly(l.log_time); amOutMins = mins; }
          else if (l.log_type === 'Check-in' && !amIn) { amIn = formatTimeOnly(l.log_time); amInMins = mins; }
        }

        if (mins >= 750 && mins < 900) { // 12:30 PM to 3:00 PM
          if (l.log_type === 'Check-in') { pmIn = formatTimeOnly(l.log_time); pmInMins = mins; }
          else if (l.log_type === 'Check-out' && !amOut) { amOut = formatTimeOnly(l.log_time); amOutMins = mins; }
        }

        if (mins >= 900) { // After 3:00 PM
          if (l.log_type === 'Check-out') { pmOut = formatTimeOnly(l.log_time); pmOutMins = mins; }
        }
      });

      // Calculate undertime (same logic as DTR generator)
      let utStr = '';
      let dailyUndertime = 0;

      // Rule 3: AM In exists, no AM Out, no PM In, but PM Out exists → absent whole day (8 hours)
      if (amInMins !== null && amOutMins === null && pmInMins === null && pmOutMins !== null) {
        dailyUndertime = 480; // 8 hours
      } else {
        // --- Morning ---
        if (amInMins !== null && amOutMins === null) {
          // Rule 1: Timed in AM but never timed out AM → absent morning (4 hours)
          dailyUndertime += 240;
        } else {
          // AM Tardiness: Late if after grace period
          if (amInMins !== null && amInMins > sAmInEnd) {
            dailyUndertime += (amInMins - sAmInEnd);
          }
          // AM Undertime: Leaving before scheduled out
          if (amOutMins !== null && amOutMins < sAmOutStart) {
            dailyUndertime += (sAmOutStart - amOutMins);
          }
        }

        // --- Afternoon ---
        if (pmInMins !== null && pmOutMins === null) {
          // Rule 1: Timed in PM but never timed out PM → absent afternoon (4 hours)
          dailyUndertime += 240;
        } else {
          // PM Tardiness: Late if after grace period
          if (pmInMins !== null && pmInMins > sPmInEnd) {
            dailyUndertime += (pmInMins - sPmInEnd);
          }
          // PM Undertime: Leaving before scheduled out
          if (pmOutMins !== null && pmOutMins < sPmOutStart) {
            dailyUndertime += (sPmOutStart - pmOutMins);
          }
        }
      }

      if (dailyUndertime > 0) {
        const utHours = Math.floor(dailyUndertime / 60);
        const utMins = dailyUndertime % 60;
        utStr = (utHours > 0 ? utHours + 'h ' : '') + (utMins > 0 ? utMins + 'm' : '');
      }

      html += `<tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px;text-align:center;border:1px solid #e5e7eb;">${i}</td>
        <td style="padding:8px;text-align:center;border:1px solid #e5e7eb;">${amIn}</td>
        <td style="padding:8px;text-align:center;border:1px solid #e5e7eb;">${amOut}</td>
        <td style="padding:8px;text-align:center;border:1px solid #e5e7eb;">${pmIn}</td>
        <td style="padding:8px;text-align:center;border:1px solid #e5e7eb;">${pmOut}</td>
        <td style="padding:8px;text-align:center;border:1px solid #e5e7eb;font-weight:bold;color:#ef4444;">${utStr}</td>
        <td style="padding:8px;text-align:center;border:1px solid #e5e7eb;">
          <button class="edit-day-btn" data-day="${i}" style="padding:2px 6px;background:#3b82f6;color:white;border:none;border-radius:3px;cursor:pointer;margin-right:2px;font-size:11px;">Edit</button>
          <button class="delete-day-btn" data-day="${i}" style="padding:2px 6px;background:#ef4444;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;">Delete</button>
        </td>
      </tr>`;
    }

    html += '</tbody></table>';
    logsContainer.innerHTML = html;

    // Add handlers for edit and delete buttons
    logsContainer.querySelectorAll('.edit-day-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const day = btn.getAttribute('data-day');
        const dayLogs = logsByDay[day];
        if (!dayLogs) return;
        showEditDayModal(day, dayLogs, teacherId, logsByDay, currentMonth, currentYear);
      });
    });

    logsContainer.querySelectorAll('.delete-day-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const day = btn.getAttribute('data-day');
        if (confirm(`Are you sure you want to delete all logs for day ${day}?`)) {
          const dayLogs = logsByDay[day];
          for (const log of dayLogs) {
            await ipcRenderer.invoke('delete-attendance-log', log.id);
          }
          showToast('Logs deleted successfully');
          const freshLogs = await ipcRenderer.invoke('get-attendance', parseInt(teacherId), currentMonth, currentYear);
          displayTeacherLogs(freshLogs, teacherId);
        }
      });
    });
  });
}

function formatTimeOnly(dateStr) {
  if (!dateStr) return '';
  
  let date;
  
  // Try multiple parsing methods
  if (typeof dateStr === 'string') {
    console.log('Parsing time from:', dateStr, 'Type:', typeof dateStr);
    
    if (dateStr.includes('-') && dateStr.includes(':')) {
      // Parse as "YYYY-MM-DD HH:MM:SS"
      const parts = dateStr.split(' ');
      if (parts.length === 2) {
        const [datePart, timePart] = parts;
        const [year, month, day] = datePart.split('-').map(Number);
        const timeComponents = timePart.split(':').map(Number);
        const [hours, minutes] = timeComponents;
        date = new Date(year, month - 1, day, hours, minutes, 0);
      }
    }
  }
  
  // Fallback to standard Date parsing
  if (!date || isNaN(date.getTime())) {
    date = new Date(dateStr);
  }
  
  if (isNaN(date.getTime())) {
    console.warn('Invalid date:', dateStr);
    return '';
  }
  
  let hours = date.getHours();
  let minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  minutes = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minutes} ${ampm}`;
}

function formatTimeFor24HourInput(dateStr) {
  if (!dateStr) return '';
  
  let date;
  
  // Try multiple parsing methods
  if (typeof dateStr === 'string') {
    if (dateStr.includes('-') && dateStr.includes(':')) {
      // Parse as "YYYY-MM-DD HH:MM:SS"
      const parts = dateStr.split(' ');
      if (parts.length === 2) {
        const [datePart, timePart] = parts;
        const [year, month, day] = datePart.split('-').map(Number);
        const timeComponents = timePart.split(':').map(Number);
        const [hours, minutes] = timeComponents;
        date = new Date(year, month - 1, day, hours, minutes, 0);
      }
    }
  }
  
  // Fallback to standard Date parsing
  if (!date || isNaN(date.getTime())) {
    date = new Date(dateStr);
  }
  
  if (isNaN(date.getTime())) {
    return '';
  }
  
  // Return in HH:MM format (24-hour) for HTML5 time input
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function showEditDayModal(day, dayLogs, teacherId, logsByDay, month, year) {
  // Create a simple modal for editing
  const modalHtml = `
    <div id="edit-modal" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;">
      <div style="background:white;padding:20px;border-radius:8px;max-width:500px;width:90%;">
        <h3>Edit Day ${day} Logs</h3>
        <div id="edit-logs-list" style="margin:15px 0;max-height:350px;overflow-y:auto;">
          <!-- Logs will be inserted here -->
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:15px;">
          <button id="modal-close-btn" style="padding:8px 16px;background:#9ca3af;color:white;border:none;border-radius:6px;cursor:pointer;">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const modal = document.getElementById('edit-modal');
  const logsList = document.getElementById('edit-logs-list');

  // Classify logs by expected type (AM In, AM Out, PM In, PM Out)
  const logsMap = {
    'AM In': null,
    'AM Out': null,
    'PM In': null,
    'PM Out': null
  };

  dayLogs.forEach(log => {
    const timeStr = log.log_time;
    let logDate;
    
    // Parse log_time to get minutes
    if (typeof timeStr === 'string' && timeStr.includes('-')) {
      const [datePart, timePart] = timeStr.split(' ');
      if (datePart && timePart) {
        const [year, month, day] = datePart.split('-').map(Number);
        const timeComponents = timePart.split(':').map(Number);
        const [hours, minutes] = timeComponents;
        logDate = new Date(year, month - 1, day, hours, minutes, 0);
      }
    } else {
      logDate = new Date(timeStr);
    }
    
    if (!isNaN(logDate.getTime())) {
      const mins = logDate.getHours() * 60 + logDate.getMinutes();
      const isCheckIn = log.log_type === 'Check-in';
      const isMorning = mins < 780; // Before 1 PM
      
      if (isMorning) {
        if (isCheckIn) logsMap['AM In'] = log;
        else logsMap['AM Out'] = log;
      } else {
        if (isCheckIn) logsMap['PM In'] = log;
        else logsMap['PM Out'] = log;
      }
    }
  });

  // Build table showing all 4 expected slots
  let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<thead><tr style="background:#f3f4f6;"><th style="padding:8px;text-align:left;border-bottom:1px solid #e5e7eb;">Slot</th><th style="padding:8px;text-align:left;border-bottom:1px solid #e5e7eb;">Time</th><th style="padding:8px;text-align:right;border-bottom:1px solid #e5e7eb;">Actions</th></tr></thead>';
  html += '<tbody>';

  // Display all 4 slots
  const slotOrder = ['AM In', 'AM Out', 'PM In', 'PM Out'];
  slotOrder.forEach(slotName => {
    const log = logsMap[slotName];
    const timeValue = log ? formatTimeFor24HourInput(log.log_time) : '';

    const logId = log ? log.id : -1; // -1 for new/empty slots
    
    // Disable update button for blank existing logs (user must fill in time first)
    const isEmptyLog = !log;
    const buttonDisabled = isEmptyLog ? 'disabled' : '';
    const buttonStyle = isEmptyLog ? 'opacity:0.5;cursor:not-allowed;' : '';
    
    html += `<tr style="border-bottom:1px solid #e5e7eb;" data-log-id="${logId}" data-slot="${slotName}">
      <td style="padding:8px;font-weight:500;">${slotName}</td>
      <td style="padding:8px;">
        <input type="time" class="log-time-input" data-log-id="${logId}" value="${timeValue}" style="width:120px;padding:6px;border:1px solid #e5e7eb;border-radius:4px;font-size:13px;">
      </td>
      <td style="padding:8px;text-align:right;">
        <button class="inline-update-btn" data-log-id="${logId}" data-slot="${slotName}" style="padding:6px 10px;background:#10b981;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;${buttonStyle}" ${buttonDisabled}>Update</button>
      </td>
    </tr>`;
  });

  html += '</tbody></table>';
  logsList.innerHTML = html;

  // Enable/disable update buttons based on time input
  const inputListener = (e) => {
    if (e.target.classList.contains('log-time-input')) {
      const row = e.target.closest('tr');
      const button = row.querySelector('.inline-update-btn');
      const timeValue = e.target.value.trim();
      
      if (timeValue) {
        // Enable button when time is entered
        button.removeAttribute('disabled');
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
      } else {
        // Disable button when time is cleared
        button.setAttribute('disabled', 'disabled');
        button.style.opacity = '0.5';
        button.style.cursor = 'not-allowed';
      }
    }
  };
  logsList.addEventListener('input', inputListener);

  // Add event delegation for update buttons - ONE TIME ONLY per modal
  let updateProcessing = false;
  const clickListener = async (e) => {
    // Ignore if already processing or if button is disabled
    if (updateProcessing || e.target.classList.contains('inline-update-btn') && e.target.hasAttribute('disabled')) {
      return;
    }
    
    if (e.target.classList.contains('inline-update-btn')) {
      updateProcessing = true; // Prevent multiple simultaneous updates
      
      const logId = parseInt(e.target.getAttribute('data-log-id'));
      const slotName = e.target.getAttribute('data-slot');
      const row = e.target.closest('tr');
      const input = row.querySelector('.log-time-input');
      const newTime = input.value.trim();

      console.log('Update clicked - logId:', logId, 'slot:', slotName, 'newTime:', newTime);

      if (!newTime) {
        showToast('Please select a valid time');
        updateProcessing = false;
        return;
      }

      if (!/^\d{2}:\d{2}$/.test(newTime)) {
        showToast('Please select a valid time');
        updateProcessing = false;
        return;
      }

      try {
        let res;
        if (logId === -1) {
          // Create new log
          console.log('Creating new log for slot:', slotName);
          const isCheckIn = slotName.includes('In');
          const logType = isCheckIn ? 'Check-in' : 'Check-out';
          res = await ipcRenderer.invoke('create-attendance-log', teacherId, day, newTime, logType, month, year);
        } else {
          // Update existing log
          console.log('Updating existing log:', logId);
          res = await ipcRenderer.invoke('update-attendance-time', logId, newTime);
        }

        if (res.success) {
          // Remove listeners before closing modal
          logsList.removeEventListener('input', inputListener);
          logsList.removeEventListener('click', clickListener);
          modal.remove();
          // Show non-blocking toast instead of alert (alert steals Electron focus)
          showToast('Time updated successfully');
          const freshLogs = await ipcRenderer.invoke('get-attendance', parseInt(teacherId), currentMonth, currentYear);
          displayTeacherLogs(freshLogs, teacherId);
        } else {
          showToast('Error: ' + res.message);
          updateProcessing = false;
        }
      } catch (err) {
        console.error('Update failed', err);
        showToast('Update failed: ' + err.message);
        updateProcessing = false;
      }
    }
  };
  logsList.addEventListener('click', clickListener);

  document.getElementById('modal-close-btn').addEventListener('click', () => {
    modal.remove();
  });

  // Close modal when clicking outside of it
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

async function setupAdminView() {
  const sched = await ipcRenderer.invoke('get-time-schedule');
  document.getElementById('sched-am-in').value = sched.am_time_in;
  document.getElementById('sched-am-in-end').value = sched.am_time_in_end;
  document.getElementById('sched-am-out-start').value = sched.am_time_out_start;
  document.getElementById('sched-am-out').value = sched.am_time_out;
  document.getElementById('sched-pm-in').value = sched.pm_time_in;
  document.getElementById('sched-pm-in-end').value = sched.pm_time_in_end;
  document.getElementById('sched-pm-out-start').value = sched.pm_time_out_start;
  document.getElementById('sched-pm-out').value = sched.pm_time_out;

  const statusEl = document.getElementById('schedule-status');
  const btnSave = document.getElementById('btn-save-schedule');
  
  // Clone and replace to remove all existing event listeners
  const newBtn = btnSave.cloneNode(true);
  btnSave.parentNode.replaceChild(newBtn, btnSave);
  
  document.getElementById('btn-save-schedule').addEventListener('click', async () => {
    const data = {
      am_time_in: document.getElementById('sched-am-in').value,
      am_time_in_end: document.getElementById('sched-am-in-end').value,
      am_time_out_start: document.getElementById('sched-am-out-start').value,
      am_time_out: document.getElementById('sched-am-out').value,
      pm_time_in: document.getElementById('sched-pm-in').value,
      pm_time_in_end: document.getElementById('sched-pm-in-end').value,
      pm_time_out_start: document.getElementById('sched-pm-out-start').value,
      pm_time_out: document.getElementById('sched-pm-out').value
    };
    const res = await ipcRenderer.invoke('save-time-schedule', data);
    if (res.success) {
      timeSchedule = data;
      statusEl.textContent = '✓ Schedule saved!'; statusEl.style.color = '#10b981';
    } else {
      statusEl.textContent = '✗ ' + res.message; statusEl.style.color = '#ef4444';
    }
    setTimeout(() => statusEl.textContent = '', 3000);
  });
}

function setupSettingsView() {
  // School Branding
  const schoolNameInput = document.getElementById('school-name');
  const schoolLogoInput = document.getElementById('school-logo');
  const logoPreview = document.getElementById('logo-preview');
  const brandingStatus = document.getElementById('branding-status');

  schoolNameInput.value = localStorage.getItem('schoolName') || '';
  const savedLogo = localStorage.getItem('schoolLogo') || '';
  if (savedLogo) logoPreview.innerHTML = `<img src="${savedLogo}" alt="Logo" style="max-height:60px;max-width:60px;object-fit:contain;"/>`;

  document.getElementById('btn-save-branding').addEventListener('click', () => {
    localStorage.setItem('schoolName', schoolNameInput.value);
    const file = schoolLogoInput.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        localStorage.setItem('schoolLogo', e.target.result);
        logoPreview.innerHTML = `<img src="${e.target.result}" alt="Logo" style="max-height:60px;max-width:60px;object-fit:contain;"/>`;
        applyBranding();
        showMsg(brandingStatus, '✓ Branding saved!', '#10b981');
      };
      reader.readAsDataURL(file);
    } else {
      applyBranding();
      showMsg(brandingStatus, '✓ Branding saved!', '#10b981');
    }
  });

  // Principal info
  const nameInput = document.getElementById('principal-name');
  const sigInput = document.getElementById('principal-signature');
  const sigPreview = document.getElementById('signature-preview');
  const principalStatus = document.getElementById('principal-status');

  nameInput.value = localStorage.getItem('principalName') || '';
  const savedSig = localStorage.getItem('principalSignature') || '';
  if (savedSig) sigPreview.innerHTML = `<img src="${savedSig}" alt="Signature" style="max-height:80px;"/>`;

  document.getElementById('btn-save-principal').addEventListener('click', () => {
    localStorage.setItem('principalName', nameInput.value);
    const file = sigInput.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        localStorage.setItem('principalSignature', e.target.result);
        sigPreview.innerHTML = `<img src="${e.target.result}" alt="Signature" style="max-height:80px;"/>`;
        showMsg(principalStatus, '✓ Saved!', '#10b981');
      };
      reader.readAsDataURL(file);
    } else { showMsg(principalStatus, '✓ Saved!', '#10b981'); }
  });

  // Change password
  const pwStatus = document.getElementById('pw-status');
  document.getElementById('btn-change-pw').addEventListener('click', async () => {
    const cur = document.getElementById('current-pw').value;
    const nw = document.getElementById('new-pw').value;
    const cf = document.getElementById('confirm-pw').value;
    if (!cur || !nw) return showMsg(pwStatus, 'Fill in all fields.', '#ef4444');
    if (nw !== cf) return showMsg(pwStatus, 'Passwords do not match.', '#ef4444');
    if (nw.length < 4) return showMsg(pwStatus, 'Password must be at least 4 characters.', '#ef4444');
    const res = await ipcRenderer.invoke('change-password', currentUser.id, cur, nw);
    showMsg(pwStatus, res.success ? '✓ Password changed!' : '✗ ' + res.message, res.success ? '#10b981' : '#ef4444');
  });

  // User management (admin only)
  if (currentUser && currentUser.role === 'admin') {
    loadUsers();
    const userStatus = document.getElementById('user-mgmt-status');
    document.getElementById('btn-add-user').addEventListener('click', async () => {
      const u = document.getElementById('new-username').value.trim();
      const p = document.getElementById('new-user-pw').value;
      const r = document.getElementById('new-user-role').value;
      if (!u || !p) return showMsg(userStatus, 'Username and password required.', '#ef4444');
      const res = await ipcRenderer.invoke('add-user', u, p, r);
      showMsg(userStatus, res.success ? '✓ User added!' : '✗ ' + res.message, res.success ? '#10b981' : '#ef4444');
      if (res.success) { document.getElementById('new-username').value = ''; document.getElementById('new-user-pw').value = ''; loadUsers(); }
    });
  }
}

async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  const users = await ipcRenderer.invoke('get-users');
  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${u.username}</td>
      <td><span class="role-badge ${u.role}">${u.role}</span></td>
      <td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td>${u.id !== currentUser.id ? `<button class="btn-delete-user" onclick="deleteUser(${u.id})">Delete</button>` : '<span style="color:var(--text-muted);font-size:12px;">You</span>'}</td>
    </tr>`).join('');
}

window.deleteUser = async function(id) {
  if (!confirm('Delete this user?')) return;
  await ipcRenderer.invoke('delete-user', id);
  loadUsers();
};

function showMsg(el, msg, color) {
  el.textContent = msg; el.style.color = color;
  setTimeout(() => el.textContent = '', 3000);
}

function showToast(msg, duration = 2000) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#10b981;color:white;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:500;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.2);transition:opacity 0.3s;';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
