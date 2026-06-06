const { ipcRenderer } = require('electron');
const { generateDTRHtml } = require('./dtrGenerator');

let currentUser = null;
let timeSchedule = null;
let currentTeacherId = null;
let currentMonth = null;
let currentYear = null;

document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  applyBranding();
  setupLogin();
  setupThemeToggles();
});

// ─── THEME MANAGEMENT ───────────────────────────────────────

function applyTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeToggleUI(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeToggleUI(next);
}

function setupThemeToggles() {
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  const btnLoginThemeToggle = document.getElementById('btn-login-theme-toggle');

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', toggleTheme);
  }
  if (btnLoginThemeToggle) {
    btnLoginThemeToggle.addEventListener('click', toggleTheme);
  }
}

function updateThemeToggleUI(theme) {
  // Sidebar elements
  const moonIcon = document.getElementById('theme-icon-moon');
  const sunIcon = document.getElementById('theme-icon-sun');
  const label = document.getElementById('theme-toggle-label');

  // Login elements
  const loginMoonIcon = document.getElementById('login-theme-icon-moon');
  const loginSunIcon = document.getElementById('login-theme-icon-sun');

  if (theme === 'dark') {
    if (moonIcon) moonIcon.style.display = 'none';
    if (sunIcon) sunIcon.style.display = '';
    if (label) label.textContent = 'Light Mode';

    if (loginMoonIcon) loginMoonIcon.style.display = 'none';
    if (loginSunIcon) loginSunIcon.style.display = '';
  } else {
    if (moonIcon) moonIcon.style.display = '';
    if (sunIcon) sunIcon.style.display = 'none';
    if (label) label.textContent = 'Dark Mode';

    if (loginMoonIcon) loginMoonIcon.style.display = '';
    if (loginSunIcon) loginSunIcon.style.display = 'none';
  }
}

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
        // Show/hide admin and logs nav depending on user role
        if (currentUser.role === 'admin') {
          document.getElementById('nav-admin').style.display = '';
          document.getElementById('nav-logs').style.display = '';
        } else {
          document.getElementById('nav-admin').style.display = 'none';
          document.getElementById('nav-logs').style.display = 'none';
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
  
  // Clone and replace nav buttons to clear old event listeners
  const sidebarNav = document.querySelector('nav');
  const oldNavBtns = sidebarNav.querySelectorAll('.nav-btn');
  oldNavBtns.forEach(btn => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
  });
  const navBtns = sidebarNav.querySelectorAll('.nav-btn');

  // Clone and replace logout button to prevent multiple listeners
  const btnLogout = document.getElementById('btn-logout');
  const newBtnLogout = btnLogout.cloneNode(true);
  btnLogout.parentNode.replaceChild(newBtnLogout, btnLogout);

  newBtnLogout.addEventListener('click', () => {
    currentUser = null;
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').textContent = '';
    document.getElementById('login-btn').disabled = false;
    document.getElementById('login-btn').textContent = 'Sign In';

    // Clear views to prevent state/DOM leak between users
    mainContent.innerHTML = '';
    for (const key in viewCache) {
      delete viewCache[key];
    }
    for (const key in viewSetupDone) {
      delete viewSetupDone[key];
    }
  });

  // Cache views so switching tabs preserves state (e.g. generated DTR previews)
  const viewCache = {};
  const viewSetupDone = {};

  function showView(viewId) {
    // Restrict admin-only views
    if ((viewId === 'admin' || viewId === 'logs') && (!currentUser || currentUser.role !== 'admin')) {
      viewId = 'dashboard';
    }

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
      else if (viewId === 'logs') wrapper.innerHTML = getLogsView();
      else if (viewId === 'settings') wrapper.innerHTML = getSettingsView();
      mainContent.appendChild(wrapper);
      viewCache[viewId] = wrapper;
    }

    // Show the requested view
    viewCache[viewId].style.display = '';

    // Sync active nav button class
    navBtns.forEach(b => {
      if (b.id === `nav-${viewId}`) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });

    // Run setup only once per view
    if (!viewSetupDone[viewId]) {
      viewSetupDone[viewId] = true;
      if (viewId === 'dashboard') setupDashboardView();
      else if (viewId === 'dtr') setupDtrView();
      else if (viewId === 'search-teacher') setupSearchTeacherView();
      else if (viewId === 'admin') setupAdminView();
      else if (viewId === 'logs') setupLogsView();
      else if (viewId === 'settings') setupSettingsView();
    }
  }

  showView('dashboard');

  navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const viewId = e.target.id.replace('nav-', '');
      showView(viewId);
      
      // If switching to logs tab, refresh the logs table
      if (viewId === 'logs' && typeof refreshLogsTable === 'function') {
        refreshLogsTable();
      }
    });
  });
}

// ─── VIEW TEMPLATES ─────────────────────────────────────────

function getDashboardView() {
  return `
    <div class="view-section active" id="dashboard-view">
      <div class="dashboard-header"><h1>Dashboard</h1><p>Welcome to the Biometric DTR System</p></div>
      <div class="card" style="margin-bottom:20px;">
        <h3>📡 Import Attendance Data</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:14px;">Choose your data source and follow the steps to import attendance records.</p>
        <div id="import-source-tabs" style="display:flex;gap:0;margin-bottom:16px;border-radius:8px;overflow:hidden;border:1px solid var(--border);">
          <button class="import-source-tab active" data-source="cloud" id="tab-cloud">
            <span style="font-size:18px;">☁️</span> NGTeco Office (Cloud)
          </button>
          <button class="import-source-tab" data-source="usb" id="tab-usb">
            <span style="font-size:18px;">🔌</span> USB Device
          </button>
        </div>
        <div id="source-cloud-panel">
          <div class="step-panel-row cloud-step1">
            <span style="font-size:22px;">☁️</span>
            <div style="flex:1;">
              <p class="step-title">Step 1: Export from NGTeco Office</p>
              <p class="step-desc">Log in → Attendance → Select date range → Export as CSV/Excel</p>
            </div>
            <button id="btn-open-portal" style="padding:8px 16px;background:#3b82f6;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;white-space:nowrap;">Open NGTeco Portal ↗</button>
          </div>
          <div class="step-panel-row cloud-step2">
            <span style="font-size:22px;">📥</span>
            <div style="flex:1;">
              <p class="step-title">Step 2: Import into DTR System</p>
              <p class="step-desc">Select the exported CSV or Excel file to import attendance records</p>
            </div>
            <button id="btn-import-cloud" class="btn-import-file" style="padding:8px 16px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;white-space:nowrap;">Import File</button>
          </div>
        </div>
        <div id="source-usb-panel" style="display:none;">
          <div class="step-panel-row usb-step1">
            <span style="font-size:22px;">🔌</span>
            <div style="flex:1;">
              <p class="step-title">Step 1: Export from Device via USB</p>
              <p class="step-desc">Insert USB → Menu → Data Mgmt → USB Export → Download Attendance Report</p>
            </div>
          </div>
          <div class="step-panel-row usb-step2">
            <span style="font-size:22px;">💾</span>
            <div style="flex:1;">
              <p class="step-title">Step 2: Plug USB into Computer</p>
              <p class="step-desc">Open the USB drive and locate the attendance CSV file (e.g. AttendanceLog.csv or .dat file)</p>
            </div>
          </div>
          <div class="step-panel-row usb-step3">
            <span style="font-size:22px;">📥</span>
            <div style="flex:1;">
              <p class="step-title">Step 3: Import into DTR System</p>
              <p class="step-desc">Select the CSV or DAT file from the USB drive to import attendance records</p>
            </div>
            <button id="btn-import-usb" class="btn-import-file" style="padding:8px 16px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;white-space:nowrap;">Import File</button>
          </div>
        </div>
      </div>
      <div id="import-preview-card" class="card" style="display:none;margin-bottom:20px;">
        <h3>📋 File Preview</h3>
        <p id="import-file-name" style="color:var(--text-muted);font-size:13px;margin-bottom:4px;"></p>
        <p id="import-source-label" style="color:#6366f1;font-size:12px;font-weight:600;margin-bottom:8px;"></p>
        <div id="import-preview-table" class="preview-table-container" style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:6px;margin-bottom:12px;"></div>
        <div id="import-mapping-info" class="mapping-info-panel"></div>
        <div style="display:flex;gap:10px;align-items:center;">
          <button id="btn-confirm-import" style="padding:8px 20px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">✓ Import to Database</button>
          <button id="btn-cancel-import" style="padding:8px 16px;background:#9ca3af;color:white;border:none;border-radius:6px;cursor:pointer;">Cancel</button>
        </div>
      </div>
      <div id="import-result-card" class="card" style="display:none;">
        <h3 id="import-result-title">Import Result</h3>
        <p id="import-result-message" style="font-size:14px;"></p>
        <div id="import-result-details" style="font-size:12px;margin-top:8px;"></div>
      </div>
    </div>`;
}

function getDtrView() {
  return `
    <div class="view-section active" id="dtr-view">
      <div class="dashboard-header"><h1>Print DTR</h1><p>Generate and print Civil Service Form No. 48</p></div>
      <div class="card" style="margin-bottom:20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <select id="teacher-select" style="padding:8px;border-radius:6px;border:1px solid var(--border);min-width:150px;"><option value="">Select Teacher</option></select>
        <input type="month" id="month-select" value="2026-06" style="padding:8px;border-radius:6px;border:1px solid var(--border);">
        <button id="btn-generate-dtr" style="padding:8px 16px;background:var(--accent);color:white;border:none;border-radius:6px;cursor:pointer;">Generate DTR</button>
        <button id="btn-generate-all" style="padding:8px 16px;background:#6366f1;color:white;border:none;border-radius:6px;cursor:pointer;">Print All</button>
        <select id="column-layout-select" style="padding:8px;border-radius:6px;border:1px solid var(--border);font-size:13px;">
          <option value="1">1 Column</option>
          <option value="2">2 Columns</option>
        </select>
        <button id="btn-print-dtr" style="padding:8px 16px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;margin-left:auto;">Print Document</button>
      </div>
      <div id="dtr-preview-container" style="padding:20px;border-radius:12px;overflow-y:auto;max-height:500px;display:flex;justify-content:center;">
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
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
          <h3 id="teacher-details-name" style="margin:0;"></h3>
          <span id="teacher-status-badge" style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;"></span>
        </div>
        <div style="margin-bottom:20px;padding:10px;background:var(--surface-alt);border-radius:6px;">
          <p><strong>Biometric ID:</strong> <span id="teacher-details-biometric"></span></p>
          <p><strong>Date Created:</strong> <span id="teacher-details-created"></span></p>
          <p style="margin-top:8px;"><strong>Status:</strong>
            <button id="btn-toggle-status" style="padding:4px 14px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;margin-left:6px;"></button>
          </p>
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
          <div id="logo-preview" style="margin-top:5px;min-height:60px;border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;border-radius:6px;background:var(--surface-alt);"><span style="color:var(--text-muted);font-size:12px;">No logo uploaded</span></div>
          <button class="btn-primary" id="btn-save-branding" style="align-self:flex-start;">Save Branding</button>
          <p class="status-msg" id="branding-status"></p>
        </div>
      </div>
      <div class="card" style="margin-bottom:20px;">
        <h3>Principal Information</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:15px;">Set the Principal's name, position, and signature for the DTR.</p>
        <div style="display:flex;flex-direction:column;gap:10px;max-width:400px;">
          <label style="font-weight:500;font-size:14px;">Principal Name</label>
          <input type="text" id="principal-name" placeholder="e.g. JUAN DELA CRUZ, Ed.D." style="padding:8px;border-radius:6px;border:1px solid var(--border);">
          <label style="font-weight:500;font-size:14px;margin-top:10px;">Position</label>
          <input type="text" id="principal-position" placeholder="e.g. Principal I / Principal-in-Charge" style="padding:8px;border-radius:6px;border:1px solid var(--border);">
          <label style="font-weight:500;font-size:14px;margin-top:10px;">Upload Signature</label>
          <input type="file" id="principal-signature" accept="image/*" style="padding:8px;border-radius:6px;border:1px solid var(--border);">
          <div id="signature-preview" style="margin-top:5px;min-height:60px;border:1px dashed var(--border);display:flex;align-items:center;justify-content:center;border-radius:6px;background:var(--surface-alt);"><span style="color:var(--text-muted);font-size:12px;">No signature uploaded</span></div>
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
  const btnOpenPortal = document.getElementById('btn-open-portal');
  const previewCard = document.getElementById('import-preview-card');
  const previewTable = document.getElementById('import-preview-table');
  const mappingInfo = document.getElementById('import-mapping-info');
  const fileNameEl = document.getElementById('import-file-name');
  const sourceLabel = document.getElementById('import-source-label');
  const btnConfirm = document.getElementById('btn-confirm-import');
  const btnCancel = document.getElementById('btn-cancel-import');
  const resultCard = document.getElementById('import-result-card');
  const resultTitle = document.getElementById('import-result-title');
  const resultMessage = document.getElementById('import-result-message');
  const resultDetails = document.getElementById('import-result-details');
  const cloudPanel = document.getElementById('source-cloud-panel');
  const usbPanel = document.getElementById('source-usb-panel');
  const tabCloud = document.getElementById('tab-cloud');
  const tabUsb = document.getElementById('tab-usb');

  if (!tabCloud) return;

  let selectedFilePath = null;
  let activeSource = 'cloud'; // 'cloud' or 'usb'

  // ── Source Tab Switching ──
  function setActiveSource(source) {
    activeSource = source;
    if (source === 'cloud') {
      cloudPanel.style.display = '';
      usbPanel.style.display = 'none';
      tabCloud.classList.add('active');
      tabUsb.classList.remove('active');
    } else {
      cloudPanel.style.display = 'none';
      usbPanel.style.display = '';
      tabUsb.classList.add('active');
      tabCloud.classList.remove('active');
    }
    // Reset preview when switching
    previewCard.style.display = 'none';
    resultCard.style.display = 'none';
    selectedFilePath = null;
  }

  tabCloud.addEventListener('click', () => setActiveSource('cloud'));
  tabUsb.addEventListener('click', () => setActiveSource('usb'));

  // Step 1: Open NGTeco portal (cloud only)
  btnOpenPortal.addEventListener('click', async () => {
    await ipcRenderer.invoke('open-ngteco-portal');
  });

  // ── Shared Import Handler ──
  async function handleImportClick() {
    const dialogTitle = activeSource === 'cloud'
      ? 'Select NGTeco Office Export File'
      : 'Select USB Device Attendance File';
    const fileResult = await ipcRenderer.invoke('select-import-file', dialogTitle);
    if (!fileResult.success) return;

    selectedFilePath = fileResult.filePath;
    fileNameEl.textContent = `File: ${selectedFilePath.split(/[/\\]/).pop()}`;
    sourceLabel.textContent = activeSource === 'cloud' ? '☁️ Source: NGTeco Office (Cloud)' : '🔌 Source: USB Device';

    // Preview the file
    const preview = await ipcRenderer.invoke('preview-import-file', selectedFilePath);
    if (!preview.success) {
      alert('Error reading file: ' + preview.message);
      return;
    }

    // Show preview table
    if (preview.preview && preview.preview.length > 0) {
      let html = '<table style="width:100%;border-collapse:collapse;font-size:11px;">';
      html += '<tr style="position:sticky;top:0;">';
      preview.headers.forEach(h => {
        html += `<th style="padding:4px 6px;text-align:left;white-space:nowrap;">${h}</th>`;
      });
      html += '</tr>';
      preview.preview.forEach(row => {
        html += '<tr>';
        preview.headers.forEach(h => {
          html += `<td style="padding:3px 6px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${row[h] || ''}</td>`;
        });
        html += '</tr>';
      });
      html += '</table>';
      previewTable.innerHTML = html;
    }

    // Show column mapping detection
    if (preview.isTimecardFormat) {
      // Timecard Report format — show employee and pay period info
      let mapHtml = '<strong>📋 Timecard Report Format Detected</strong><br>';
      if (preview.employeeCount > 1) {
        mapHtml += `Employees: <strong>${preview.employeeCount}</strong> (${preview.employeeName || '—'}) | `;
      } else {
        mapHtml += `Employee: <strong>${preview.employeeName || '—'}</strong> | `;
      }
      mapHtml += `Pay Period: <strong>${preview.payPeriod || '—'}</strong><br>`;
      mapHtml += `<span style="color:var(--text-muted);">Total attendance records: ${preview.totalRows}</span>`;
      mapHtml += `<br><span style="color:var(--accent);font-size:11px;">ℹ️ Teachers not in the database will be auto-created on import.</span>`;
      mappingInfo.innerHTML = mapHtml;
      mappingInfo.className = 'mapping-info-panel';
    } else if (preview.mapping) {
      const m = preview.mapping;
      let mapHtml = '<strong>🔍 Auto-detected columns:</strong><br>';
      mapHtml += `Employee ID → <strong>${m.employeeId || '⚠️ not found'}</strong> | `;
      mapHtml += `Name → <strong>${m.name || '—'}</strong> | `;
      mapHtml += `Date → <strong>${m.date || '—'}</strong> | `;
      if (m.timeIn || m.timeOut) {
        mapHtml += `Time In → <strong>${m.timeIn || '—'}</strong> | `;
        mapHtml += `Time Out → <strong>${m.timeOut || '—'}</strong>`;
      } else if (m.timestamp) {
        mapHtml += `Timestamp → <strong>${m.timestamp}</strong>`;
      }
      mapHtml += `<br><span style="color:var(--text-muted);">Total rows: ${preview.totalRows}</span>`;
      mappingInfo.innerHTML = mapHtml;
      mappingInfo.className = 'mapping-info-panel usb-mapping';
    }

    previewCard.style.display = '';
    resultCard.style.display = 'none';
  }

  // Attach to both import buttons
  document.getElementById('btn-import-cloud').addEventListener('click', handleImportClick);
  document.getElementById('btn-import-usb').addEventListener('click', handleImportClick);

  // Confirm import
  btnConfirm.addEventListener('click', async () => {
    if (!selectedFilePath) return;

    btnConfirm.disabled = true;
    btnConfirm.textContent = 'Importing...';

    const res = await ipcRenderer.invoke('import-attendance-file', selectedFilePath);

    btnConfirm.disabled = false;
    btnConfirm.textContent = '✓ Import to Database';

    // Show result
    resultCard.style.display = '';
    if (res.success) {
      resultTitle.textContent = '✅ Import Complete';
      resultTitle.style.color = '#10b981';
      resultMessage.textContent = res.message;
      resultMessage.style.color = '#374151';
      let detailsHtml = '';
      if (res.synced > 0) detailsHtml += `<span style="color:#10b981;">● ${res.synced} new record(s) added</span><br>`;
      if (res.filtered > 0) detailsHtml += `<span style="color:#6366f1;">● ${res.filtered} repeated scan(s) filtered</span><br>`;
      if (res.skipped > 0) detailsHtml += `<span style="color:#f59e0b;">● ${res.skipped} duplicate(s) skipped</span><br>`;
      if (res.autoCreated > 0) {
        detailsHtml += `<span style="color:#3b82f6;">● Auto-created ${res.autoCreated} new teacher(s): ${(res.autoCreatedNames || []).join(', ')}</span><br>`;
      }
      if (res.unmatched > 0) {
        detailsHtml += `<span style="color:#ef4444;">● ${res.unmatched} unmatched ID(s): ${(res.unmatchedIds || []).join(', ')}</span><br>`;
        detailsHtml += `<span style="color:#6b7280;font-size:11px;">Tip: Make sure the Employee ID in the export matches the Biometric ID (or name matches) in the Teachers table.</span>`;
      }
      resultDetails.innerHTML = detailsHtml;
    } else {
      resultTitle.textContent = '❌ Import Failed';
      resultTitle.style.color = '#ef4444';
      resultMessage.textContent = res.message;
      resultMessage.style.color = '#ef4444';
      resultDetails.innerHTML = '';
    }

    previewCard.style.display = 'none';
  });

  // Cancel import
  btnCancel.addEventListener('click', () => {
    previewCard.style.display = 'none';
    selectedFilePath = null;
  });
}

async function setupDtrView() {
  const container = document.getElementById('dtr-preview-container');
  const select = document.getElementById('teacher-select');
  const monthSelect = document.getElementById('month-select');
  const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // Load schedule
  timeSchedule = await ipcRenderer.invoke('get-time-schedule');

  // Function to refresh the teacher dropdown — called on setup AND every time the DTR tab is shown
  async function refreshTeacherSelect() {
    const currentVal = select.value; // preserve current selection if possible
    const teachers = await ipcRenderer.invoke('get-active-teachers');
    select.innerHTML = '<option value="">Select Teacher</option>';
    teachers.forEach(t => { select.innerHTML += `<option value="${t.id}">${t.name}</option>`; });
    // Restore selection if the teacher still exists
    if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
      select.value = currentVal;
    }
    return teachers;
  }

  // Initial load
  await refreshTeacherSelect();

  // Refresh teacher list every time the DTR tab becomes visible
  const dtrNavBtn = document.getElementById('nav-dtr');
  if (dtrNavBtn) {
    dtrNavBtn.addEventListener('click', () => { refreshTeacherSelect(); });
  }

  const columnSelect = document.getElementById('column-layout-select');

  document.getElementById('btn-generate-dtr').addEventListener('click', async () => {
    const teacherId = select.value; const monthVal = monthSelect.value;
    if (!teacherId || !monthVal) return alert('Select teacher and month');
    const [year, month] = monthVal.split('-');
    // Fetch fresh time schedule before generating DTR
    const freshSchedule = await ipcRenderer.invoke('get-time-schedule');
    const logs = await ipcRenderer.invoke('get-attendance', parseInt(teacherId), parseInt(month), parseInt(year));
    const dtrHtml = generateDTRHtml(select.options[select.selectedIndex].text, monthNames[parseInt(month)], year, logs, freshSchedule);
    const cols = columnSelect.value;
    if (cols === '2') {
      container.innerHTML = `<div class="dtr-page-two-col"><div class="dtr-col">${dtrHtml}</div><div class="dtr-col">${dtrHtml}</div></div>`;
    } else {
      container.innerHTML = dtrHtml;
    }
  });

  document.getElementById('btn-generate-all').addEventListener('click', async () => {
    const monthVal = monthSelect.value;
    if (!monthVal) return alert('Select a month');
    const [year, month] = monthVal.split('-');
    // Fetch only ACTIVE teachers and time schedule before generating all DTRs
    const freshTeachers = await ipcRenderer.invoke('get-active-teachers');
    const freshSchedule = await ipcRenderer.invoke('get-time-schedule');
    const cols = columnSelect.value;
    let allHtml = '';
    for (const t of freshTeachers) {
      const logs = await ipcRenderer.invoke('get-attendance', t.id, parseInt(month), parseInt(year));
      const dtrHtml = generateDTRHtml(t.name, monthNames[parseInt(month)], year, logs, freshSchedule);
      if (cols === '2') {
        allHtml += `<div class="dtr-page-two-col"><div class="dtr-col">${dtrHtml}</div><div class="dtr-col">${dtrHtml}</div></div>`;
      } else {
        allHtml += dtrHtml;
      }
    }
    container.innerHTML = `<div style="display:flex;flex-direction:column;gap:40px;width:100%;">${allHtml}</div>`;
  });

  document.getElementById('btn-print-dtr').addEventListener('click', () => { ipcRenderer.invoke('print-dtr'); });
}

async function setupSearchTeacherView() {
  // Store current teacher ID for month changes
  let currentSearchTeacherId = null;

  // Search handler — always re-acquire elements by ID to avoid stale references
  async function doSearch() {
    const searchInput = document.getElementById('teacher-search-input');
    const resultsContainer = document.getElementById('teacher-search-results');
    const detailsCard = document.getElementById('teacher-details-card');
    const query = searchInput.value.trim();
    if (!query) {
      showToast('Enter a search term');
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
      const isActive = (t.status || 'active') === 'active';
      const statusColor = isActive ? '#10b981' : '#ef4444';
      const statusLabel = isActive ? 'Active' : 'Inactive';
      html += `<div style="padding:10px;border-bottom:1px solid #e5e7eb;cursor:pointer;display:flex;align-items:center;justify-content:space-between;" class="search-result-item" data-teacher-id="${t.id}" data-teacher-name="${t.name}" data-teacher-biometric="${t.biometric_id}" data-teacher-created="${t.created_at}" data-teacher-status="${t.status || 'active'}">
        <span><strong>${t.name}</strong> (ID: ${t.biometric_id})</span>
        <span style="padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;color:white;background:${statusColor};">${statusLabel}</span>
      </div>`;
    });
    html += '</div>';
    resultsContainer.innerHTML = html;
    resultsContainer.style.display = 'block';
  }

  // Direct addEventListener — NO clone-and-replace
  document.getElementById('btn-search-teacher').addEventListener('click', doSearch);

  document.getElementById('teacher-search-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  // Event delegation for search result clicks — avoids re-attaching listeners
  document.getElementById('teacher-search-results').addEventListener('click', async (e) => {
    const item = e.target.closest('.search-result-item');
    if (!item) return;

    const teacherId = item.getAttribute('data-teacher-id');
    const teacherName = item.getAttribute('data-teacher-name');
    const biometricId = item.getAttribute('data-teacher-biometric');
    const createdAt = item.getAttribute('data-teacher-created');
    const teacherStatus = item.getAttribute('data-teacher-status') || 'active';

    currentSearchTeacherId = teacherId;

    document.getElementById('teacher-details-name').textContent = teacherName;
    document.getElementById('teacher-details-biometric').textContent = biometricId;
    document.getElementById('teacher-details-created').textContent = new Date(createdAt).toLocaleDateString();

    // Update status badge and toggle button
    updateStatusUI(teacherStatus);

    document.getElementById('teacher-search-results').style.display = 'none';
    document.getElementById('teacher-details-card').style.display = 'block';

    // Load logs for the selected month
    const monthVal = document.getElementById('search-month-select').value;
    const [year, month] = monthVal.split('-');
    currentYear = parseInt(year);
    currentMonth = parseInt(month);
    const logs = await ipcRenderer.invoke('get-attendance', parseInt(teacherId), parseInt(month), parseInt(year));
    displayTeacherLogs(logs, teacherId);
  });

  // Status toggle — event delegation on the details card
  document.getElementById('teacher-details-card').addEventListener('click', async (e) => {
    if (!e.target.matches('#btn-toggle-status')) return;
    if (!currentSearchTeacherId) return;

    const badge = document.getElementById('teacher-status-badge');
    const currentStatus = badge.getAttribute('data-status');
    const teacherName = document.getElementById('teacher-details-name').textContent;
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    const confirmMsg = newStatus === 'inactive'
      ? `Set ${teacherName} as INACTIVE? Their DTR will no longer be printed.`
      : `Set ${teacherName} as ACTIVE? Their DTR will be included in printing.`;
    const confirmed = await showConfirm(confirmMsg);
    if (!confirmed) return;
    const res = await ipcRenderer.invoke('update-teacher-status', parseInt(currentSearchTeacherId), newStatus);
    if (res.success) {
      updateStatusUI(newStatus);
      showToast(`Teacher status updated to ${newStatus}`);
    } else {
      showToast('Error: ' + res.message);
    }
  });

  // Refresh logs button — direct addEventListener, no clone-and-replace
  document.getElementById('btn-refresh-logs').addEventListener('click', async () => {
    if (!currentSearchTeacherId) {
      showToast('Please select a teacher first');
      return;
    }
    const monthVal = document.getElementById('search-month-select').value;
    const [year, month] = monthVal.split('-');
    currentYear = parseInt(year);
    currentMonth = parseInt(month);
    const logs = await ipcRenderer.invoke('get-attendance', parseInt(currentSearchTeacherId), parseInt(month), parseInt(year));
    displayTeacherLogs(logs, currentSearchTeacherId);
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
        if (await showConfirm(`Are you sure you want to delete all logs for day ${day}?`)) {
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
      <div style="background:var(--modal-bg);color:var(--modal-text);padding:20px;border-radius:8px;max-width:500px;width:90%;border:1px solid var(--border);">
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
  html += '<thead><tr style="background:var(--surface-alt);"><th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Slot</th><th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Time</th><th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">Actions</th></tr></thead>';
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
    
    html += `<tr style="border-bottom:1px solid var(--border);" data-log-id="${logId}" data-slot="${slotName}">
      <td style="padding:8px;font-weight:500;">${slotName}</td>
      <td style="padding:8px;">
        <input type="time" class="log-time-input" data-log-id="${logId}" value="${timeValue}" style="width:120px;padding:6px;border:1px solid var(--border);border-radius:4px;font-size:13px;background:var(--input-bg);color:var(--text-main);">
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
  const positionInput = document.getElementById('principal-position');
  const sigInput = document.getElementById('principal-signature');
  const sigPreview = document.getElementById('signature-preview');
  const principalStatus = document.getElementById('principal-status');

  nameInput.value = localStorage.getItem('principalName') || '';
  positionInput.value = localStorage.getItem('principalPosition') || '';
  const savedSig = localStorage.getItem('principalSignature') || '';
  if (savedSig) sigPreview.innerHTML = `<img src="${savedSig}" alt="Signature" style="max-height:80px;"/>`;

  document.getElementById('btn-save-principal').addEventListener('click', () => {
    localStorage.setItem('principalName', nameInput.value);
    localStorage.setItem('principalPosition', positionInput.value);
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
  if (!(await showConfirm('Delete this user?'))) return;
  await ipcRenderer.invoke('delete-user', id);
  loadUsers();
};

function showMsg(el, msg, color) {
  el.textContent = msg; el.style.color = color;
  setTimeout(() => el.textContent = '', 3000);
}

function updateStatusUI(status) {
  const badge = document.getElementById('teacher-status-badge');
  const toggleBtn = document.getElementById('btn-toggle-status');
  if (!badge || !toggleBtn) return;

  badge.setAttribute('data-status', status);

  if (status === 'active') {
    badge.textContent = 'Active';
    badge.style.background = '#d1fae5';
    badge.style.color = '#065f46';
    toggleBtn.textContent = 'Set Inactive';
    toggleBtn.style.background = '#fecaca';
    toggleBtn.style.color = '#991b1b';
  } else {
    badge.textContent = 'Inactive';
    badge.style.background = '#fecaca';
    badge.style.color = '#991b1b';
    toggleBtn.textContent = 'Set Active';
    toggleBtn.style.background = '#d1fae5';
    toggleBtn.style.color = '#065f46';
  }
}

function showConfirm(msg) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
    overlay.innerHTML = `
      <div style="background:var(--modal-bg);padding:24px;border-radius:12px;max-width:400px;width:90%;box-shadow:0 20px 40px rgba(0,0,0,0.3);border:1px solid var(--border);">
        <p style="font-size:14px;color:var(--modal-text);margin-bottom:20px;line-height:1.5;">${msg}</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button id="confirm-cancel-btn" style="padding:8px 20px;background:var(--border);color:var(--text-main);border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:13px;">Cancel</button>
          <button id="confirm-ok-btn" style="padding:8px 20px;background:#3b82f6;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:13px;">Confirm</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#confirm-ok-btn').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });
    overlay.querySelector('#confirm-cancel-btn').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    });
  });
}

function showToast(msg, duration = 2000) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:var(--toast-bg);color:white;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:500;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.2);transition:opacity 0.3s;';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─── USERS LOG VIEW ─────────────────────────────────────────

let allActivityLogs = [];

function getLogsView() {
  return `
    <div class="view-section active" id="logs-view">
      <div class="dashboard-header">
        <h1>Users Log</h1>
        <p>Audit trail of all system transactions and activity logs</p>
      </div>
      <div class="card" style="margin-bottom:20px; display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
        <input type="text" id="logs-search-input" placeholder="Search logs (username, action, details)..." style="padding:8px 12px; border-radius:6px; border:1px solid var(--border); flex:1; min-width:200px;">
        <button id="btn-refresh-logs-table" class="btn-primary" style="padding:8px 16px; background:var(--accent); color:white; border:none; border-radius:6px; cursor:pointer; font-weight:500;">🔄 Refresh Logs</button>
      </div>
      <div class="card" style="padding:0; overflow:hidden;">
        <div style="overflow-x:auto;">
          <table class="users-table" style="width:100%; border-collapse:collapse; margin:0;">
            <thead>
              <tr style="background:var(--surface-alt); border-bottom:2px solid var(--border);">
                <th style="text-align:left; padding:12px 16px; font-weight:600;">Timestamp</th>
                <th style="text-align:left; padding:12px 16px; font-weight:600;">User</th>
                <th style="text-align:left; padding:12px 16px; font-weight:600;">Action</th>
                <th style="text-align:left; padding:12px 16px; font-weight:600;">Details</th>
              </tr>
            </thead>
            <tbody id="logs-tbody">
              <tr>
                <td colspan="4" style="text-align:center; padding:30px; color:var(--text-muted); font-style:italic;">Loading activity logs...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function refreshLogsTable() {
  const tbody = document.getElementById('logs-tbody');
  if (!tbody) return;
  
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--text-muted); font-style:italic;">Loading activity logs...</td></tr>';
  
  try {
    const logs = await ipcRenderer.invoke('get-activity-logs');
    allActivityLogs = logs;
    displayActivityLogs(logs);
  } catch (err) {
    console.error('Error fetching logs:', err);
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px; color:#ef4444; font-weight:500;">Failed to load logs: ${err.message}</td></tr>`;
  }
}

function displayActivityLogs(logs) {
  const tbody = document.getElementById('logs-tbody');
  if (!tbody) return;
  
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--text-muted); font-style:italic;">No transaction logs found.</td></tr>';
    return;
  }
  
  let html = '';
  logs.forEach(log => {
    let badgeColor = 'var(--text-muted)';
    let badgeBg = 'var(--surface-alt)';
    const act = log.action.toLowerCase();
    
    if (act.includes('success') || act.includes('add') || act.includes('create') || act.includes('save')) {
      badgeColor = '#10b981';
      badgeBg = 'rgba(16, 185, 129, 0.1)';
    } else if (act.includes('fail') || act.includes('delete')) {
      badgeColor = '#ef4444';
      badgeBg = 'rgba(239, 68, 68, 0.1)';
    } else if (act.includes('update') || act.includes('edit')) {
      badgeColor = '#f59e0b';
      badgeBg = 'rgba(245, 158, 11, 0.1)';
    } else if (act.includes('import')) {
      badgeColor = '#6366f1';
      badgeBg = 'rgba(99, 102, 241, 0.1)';
    }
    
    const formattedDate = new Date(log.created_at).toLocaleString();
    
    html += `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:12px 16px; white-space:nowrap; font-size:13px; color:var(--text-muted);">${formattedDate}</td>
        <td style="padding:12px 16px; font-weight:600; font-size:13px; color:var(--text-main);">${log.username}</td>
        <td style="padding:12px 16px; white-space:nowrap;">
          <span style="padding:3px 8px; border-radius:12px; font-size:11px; font-weight:600; color:${badgeColor}; background:${badgeBg}; display:inline-block;">
            ${log.action}
          </span>
        </td>
        <td style="padding:12px 16px; font-size:13px; color:var(--text-main); max-width:400px; word-wrap:break-word;">${log.details}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function setupLogsView() {
  const searchInput = document.getElementById('logs-search-input');
  const btnRefresh = document.getElementById('btn-refresh-logs-table');
  
  if (btnRefresh) {
    btnRefresh.addEventListener('click', refreshLogsTable);
  }
  
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      if (!q) {
        displayActivityLogs(allActivityLogs);
        return;
      }
      
      const filtered = allActivityLogs.filter(log => 
        log.username.toLowerCase().includes(q) || 
        log.action.toLowerCase().includes(q) || 
        log.details.toLowerCase().includes(q) ||
        new Date(log.created_at).toLocaleString().toLowerCase().includes(q)
      );
      displayActivityLogs(filtered);
    });
  }
  
  refreshLogsTable();
}
