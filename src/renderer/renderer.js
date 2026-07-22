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
  setupThemeToggles();
  checkLicense().then(activated => {
    if (activated) {
      setupLogin();
    } else {
      setupActivation();
    }
  });
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

// ─── LICENSE ACTIVATION ─────────────────────────────────────

async function checkLicense() {
  try {
    const res = await ipcRenderer.invoke('check-license');
    return res.activated;
  } catch (_) {
    return false;
  }
}

function setupActivation() {
  document.getElementById('activation-overlay').style.display = 'flex';
  document.getElementById('login-overlay').style.display = 'none';

  const form = document.getElementById('activation-form');
  const errEl = document.getElementById('activation-error');
  const btn = document.getElementById('btn-activate');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = document.getElementById('activation-key').value.trim();
    if (!key) {
      errEl.textContent = 'Please enter a license key.';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Activating...';
    errEl.textContent = '';

    try {
      const res = await ipcRenderer.invoke('activate-license', key);
      if (res.valid) {
        document.getElementById('activation-overlay').style.display = 'none';
        document.getElementById('login-overlay').style.display = '';
        setupLogin();
      } else {
        errEl.textContent = res.message || 'Activation failed.';
        btn.disabled = false;
        btn.textContent = 'Activate';
      }
    } catch (err) {
      errEl.textContent = 'Activation error: ' + err.message;
      btn.disabled = false;
      btn.textContent = 'Activate';
    }
  });
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
          document.getElementById('nav-teachers').style.display = '';
        } else {
          document.getElementById('nav-admin').style.display = 'none';
          document.getElementById('nav-logs').style.display = 'none';
          document.getElementById('nav-teachers').style.display = 'none';
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
    if ((viewId === 'admin' || viewId === 'logs' || viewId === 'teachers') && (!currentUser || currentUser.role !== 'admin')) {
      viewId = 'dashboard';
    }

    // Hide all cached views
    Object.values(viewCache).forEach(el => el.style.display = 'none');

    // Create view if not cached yet
    if (!viewCache[viewId]) {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-view', viewId);
      if (viewId === 'dashboard') wrapper.innerHTML = getDashboardView();
      else if (viewId === 'devices') wrapper.innerHTML = getDevicesView();
      else if (viewId === 'teachers') wrapper.innerHTML = getTeachersView();
      else if (viewId === 'dtr') wrapper.innerHTML = getDtrView();
      else if (viewId === 'search-teacher') wrapper.innerHTML = getSearchTeacherView();
      else if (viewId === 'admin') wrapper.innerHTML = getAdminView();
      else if (viewId === 'logs') wrapper.innerHTML = getLogsView();
      else if (viewId === 'settings') wrapper.innerHTML = getSettingsView();
      else if (viewId === 'about') wrapper.innerHTML = getAboutView();
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
      else if (viewId === 'devices') setupDevicesView();
      else if (viewId === 'teachers') setupTeachersView();
      else if (viewId === 'dtr') setupDtrView();
      else if (viewId === 'search-teacher') setupSearchTeacherView();
      else if (viewId === 'admin') setupAdminView();
      else if (viewId === 'logs') setupLogsView();
      else if (viewId === 'settings') setupSettingsView();
      else if (viewId === 'about') setupAboutView();
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
        <h3>Import Attendance Data</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:14px;">Choose your data source and follow the steps to import attendance records.</p>
        <div id="import-source-tabs" style="display:flex;gap:0;margin-bottom:16px;border-radius:8px;overflow:hidden;border:1px solid var(--border);">
          <button class="import-source-tab active" data-source="ngteco-cloud" id="tab-ngteco-cloud">
            <span style="font-size:18px;">☁️</span> NGTeco Cloud
          </button>
          <button class="import-source-tab" data-source="ngteco-usb" id="tab-ngteco-usb">
            <span style="font-size:18px;">🔌</span> NGTeco USB
          </button>
          <button class="import-source-tab" data-source="zkteco-usb" id="tab-zkteco-usb">
            <span style="font-size:18px;">🔌</span> ZKTeco USB
          </button>
        </div>

        <!-- NGTeco Cloud Panel -->
        <div id="source-ngteco-cloud-panel">
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

        <!-- NGTeco USB Panel -->
        <div id="source-ngteco-usb-panel" style="display:none;">
          <div class="step-panel-row usb-step1">
            <span style="font-size:22px;">🔌</span>
            <div style="flex:1;">
              <p class="step-title">Step 1: Export from NGTeco Device via USB</p>
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
            <button id="btn-import-ngteco-usb" class="btn-import-file" style="padding:8px 16px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;white-space:nowrap;">Import File</button>
          </div>
        </div>

        <!-- ZKTeco USB Panel -->
        <div id="source-zkteco-usb-panel" style="display:none;">
          <div class="step-panel-row">
            <span style="font-size:22px;">🔌</span>
            <div style="flex:1;">
              <p class="step-title">Step 1: Export from ZKTeco Device via USB</p>
              <p class="step-desc">Insert USB → Menu → Data Mgmt → USB Download → Export AttLog as .dat or .csv</p>
            </div>
          </div>
          <div class="step-panel-row">
            <span style="font-size:22px;">💾</span>
            <div style="flex:1;">
              <p class="step-title">Step 2: Plug USB into Computer</p>
              <p class="step-desc">Open the USB drive and locate the attendance file (e.g. attlog.dat or .csv file)</p>
            </div>
          </div>
          <div class="step-panel-row">
            <span style="font-size:22px;">📥</span>
            <div style="flex:1;">
              <p class="step-title">Step 3: Import into DTR System</p>
              <p class="step-desc">Select the file from the USB drive to import attendance records</p>
            </div>
            <button id="btn-import-zkteco-usb" class="btn-import-file" style="padding:8px 16px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;white-space:nowrap;">Import File</button>
          </div>
        </div>
      </div>
      <div id="import-preview-card" class="card" style="display:none;margin-bottom:20px;">
        <h3>File Preview</h3>
        <p id="import-file-name" style="color:var(--text-muted);font-size:13px;margin-bottom:4px;"></p>
        <p id="import-source-label" style="color:#6366f1;font-size:12px;font-weight:600;margin-bottom:8px;"></p>
        <div id="import-preview-table" class="preview-table-container" style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:6px;margin-bottom:12px;"></div>
        <div id="import-mapping-info" class="mapping-info-panel"></div>
        <div style="display:flex;gap:10px;align-items:center;">
          <button id="btn-confirm-import" style="padding:8px 20px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Import to Database</button>
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

function getDevicesView() {
  return `
    <div class="view-section active" id="devices-view">
      <div class="dashboard-header"><h1>Biometric Devices</h1><p>Manage ZKTeco and other biometric device connections</p></div>

      <!-- How to Setup Guide -->
      <div class="card" style="margin-bottom:20px;border-left:4px solid #3b82f6;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
          <h3 style="margin:0;">How to Connect Your ZKTeco Device</h3>
          <button id="btn-toggle-setup-guide" style="padding:4px 10px;background:var(--surface-alt);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:12px;color:var(--text-muted);">Show Steps</button>
        </div>
        <div id="setup-guide-content" style="display:none;">
          <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px;">Follow these steps to connect your ZKTeco device to this application via TCP/IP (network cable or WiFi).</p>

          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:16px;">
            <!-- Step 1 -->
            <div style="padding:14px;background:var(--surface-alt);border-radius:8px;border:1px solid var(--border);">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="background:#3b82f6;color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">1</span>
                <strong>Set a Static IP on the Device</strong>
              </div>
              <ol style="margin:0;padding-left:18px;font-size:13px;color:var(--text);line-height:1.8;">
                <li>On the ZKTeco device, press <strong>Menu</strong></li>
                <li>Go to <strong>System</strong> → <strong>Network</strong></li>
                <li>Set <strong>IP Address</strong> (e.g. <code>192.168.1.201</code>)</li>
                <li>Set <strong>Subnet Mask</strong> (e.g. <code>255.255.255.0</code>)</li>
                <li>Set <strong>Gateway</strong> (e.g. <code>192.168.1.1</code>)</li>
                <li>Press <strong>OK</strong> to save</li>
              </ol>
            </div>

            <!-- Step 2 -->
            <div style="padding:14px;background:var(--surface-alt);border-radius:8px;border:1px solid var(--border);">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="background:#3b82f6;color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">2</span>
                <strong>Configure Your Computer's IP</strong>
              </div>
              <p style="font-size:13px;color:var(--text);margin:0 0 8px 0;">Your computer must be on the <strong>same network</strong> as the device. Set a static IP on the same subnet:</p>
              <ol style="margin:0;padding-left:18px;font-size:13px;color:var(--text);line-height:1.8;">
                <li>Open <strong>Control Panel</strong> → <strong>Network and Sharing Center</strong></li>
                <li>Click <strong>Change adapter settings</strong></li>
                <li>Right-click your network adapter → <strong>Properties</strong></li>
                <li>Select <strong>Internet Protocol Version 4 (TCP/IPv4)</strong> → <strong>Properties</strong></li>
                <li>Select <strong>Use the following IP address</strong></li>
                <li>Set IP: <code>192.168.1.100</code> (must be different from device)</li>
                <li>Set Subnet: <code>255.255.255.0</code></li>
                <li>Set Gateway: <code>192.168.1.1</code> (your router)</li>
                <li>Click <strong>OK</strong> to save</li>
              </ol>
            </div>

            <!-- Step 3 -->
            <div style="padding:14px;background:var(--surface-alt);border-radius:8px;border:1px solid var(--border);">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="background:#3b82f6;color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">3</span>
                <strong>Connect the Device</strong>
              </div>
              <ol style="margin:0;padding-left:18px;font-size:13px;color:var(--text);line-height:1.8;">
                <li>Connect the device to your network via <strong>LAN cable</strong> or <strong>WiFi</strong></li>
                <li>On your computer, open <strong>Command Prompt</strong></li>
                <li>Type <code>ping 192.168.1.201</code> (device IP) to test connection</li>
                <li>If you get replies, the connection is working</li>
                <li>Add the device below with the same IP address</li>
              </ol>
            </div>

            <!-- Step 4 -->
            <div style="padding:14px;background:var(--surface-alt);border-radius:8px;border:1px solid var(--border);">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="background:#10b981;color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">4</span>
                <strong>Sync Attendance Data</strong>
              </div>
              <ol style="margin:0;padding-left:18px;font-size:13px;color:var(--text);line-height:1.8;">
                <li>Add the device in the form below</li>
                <li>Select the device and click <strong>Connect</strong></li>
                <li>Click <strong>Sync Attendance</strong> to import logs</li>
                <li>Records will be matched to teachers automatically</li>
              </ol>
            </div>
          </div>

          <div style="margin-top:16px;padding:12px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:6px;">
            <p style="margin:0;font-size:13px;color:var(--text);">
              <strong>Tips:</strong><br>
              • The device's default port is <strong>4370</strong> — do not change this unless you know the device uses a different port.<br>
              • Make sure your firewall allows connections on port <strong>4370</strong> (TCP).<br>
              • The device and computer must be on the <strong>same subnet</strong> (e.g. both <code>192.168.1.x</code>).<br>
              • If using WiFi, ensure the device is connected to the <strong>same network</strong> as your computer.
            </p>
          </div>
        </div>
      </div>

      <!-- Add Device Form -->
      <div class="card" style="margin-bottom:20px;">
        <h3>Add New Device</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px;">Configure a new biometric device for attendance syncing.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:12px;margin-bottom:16px;">
          <div class="form-group">
            <label style="font-weight:500;font-size:13px;">Device Name</label>
            <input type="text" id="device-name" placeholder="e.g. Main Entrance" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);">
          </div>
          <div class="form-group">
            <label style="font-weight:500;font-size:13px;">Serial Number</label>
            <input type="text" id="device-serial" placeholder="e.g. A667230960706" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);">
          </div>
          <div class="form-group">
            <label style="font-weight:500;font-size:13px;">IP Address</label>
            <input type="text" id="device-ip" placeholder="e.g. 192.168.1.201" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);">
          </div>
          <div class="form-group">
            <label style="font-weight:500;font-size:13px;">Port</label>
            <input type="number" id="device-port" value="4370" placeholder="4370" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);">
          </div>
          <div class="form-group">
            <label style="font-weight:500;font-size:13px;">Device Type</label>
            <select id="device-type" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);">
              <option value="zkteco">ZKTeco</option>
              <option value="ngteco">NGTeco</option>
            </select>
          </div>
        </div>
        <button id="btn-add-device" style="padding:8px 20px;background:var(--accent);color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Add Device</button>
        <span id="add-device-status" style="margin-left:12px;font-size:13px;"></span>
      </div>

      <!-- Device List -->
      <div class="card" style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <h3 style="margin:0;">Registered Devices</h3>
          <button id="btn-refresh-devices" style="padding:6px 14px;background:var(--accent);color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;">Refresh</button>
        </div>
        <div id="devices-list-container">
          <p style="color:var(--text-muted);font-size:13px;font-style:italic;">Loading devices...</p>
        </div>
      </div>

      <!-- Device Connection Panel -->
      <div class="card" id="device-connection-panel" style="display:none;">
        <h3>Device Connection</h3>
        <div id="connection-info" style="padding:12px;background:var(--surface-alt);border-radius:6px;margin-bottom:16px;"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
          <button id="btn-connect-device" style="padding:8px 20px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Connect</button>
          <button id="btn-disconnect-device" style="padding:8px 16px;background:#ef4444;color:white;border:none;border-radius:6px;cursor:pointer;display:none;">Disconnect</button>
          <button id="btn-sync-attendance" style="padding:8px 16px;background:#6366f1;color:white;border:none;border-radius:6px;cursor:pointer;display:none;">Sync Attendance</button>
          <button id="btn-clear-resync" style="padding:8px 16px;background:#f59e0b;color:white;border:none;border-radius:6px;cursor:pointer;display:none;">Clear & Re-sync</button>
          <button id="btn-view-device-users" style="padding:8px 16px;background:#8b5cf6;color:white;border:none;border-radius:6px;cursor:pointer;display:none;">View Users</button>
        </div>
        <span id="connection-status" style="font-size:13px;"></span>
      </div>

      <!-- Sync Result -->
      <div class="card" id="sync-result-card" style="display:none;">
        <h3 id="sync-result-title">Sync Result</h3>
        <p id="sync-result-message" style="font-size:14px;"></p>
        <div id="sync-result-details" style="font-size:12px;margin-top:8px;"></div>
      </div>

      <!-- Device Users Modal -->
      <div id="device-users-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;z-index:1000;">
        <div style="background:var(--modal-bg);color:var(--modal-text);padding:20px;border-radius:8px;max-width:600px;width:90%;max-height:80vh;overflow:auto;border:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="margin:0;">Device Users</h3>
            <button id="btn-close-users-modal" style="padding:6px 12px;background:#9ca3af;color:white;border:none;border-radius:4px;cursor:pointer;">Close</button>
          </div>
          <div id="device-users-list"></div>
        </div>
      </div>
    </div>`;
}

function getTeachersView() {
  return `
    <div class="view-section active" id="teachers-view">
      <div class="dashboard-header"><h1>Teacher Enrollment</h1><p>Manage teachers and enroll them to the ZKTeco device</p></div>

      <!-- Device Status Banner -->
      <div id="teachers-device-status" class="card" style="margin-bottom:20px;border-left:4px solid #3b82f6;">
        <p style="margin:0;font-size:13px;" id="teachers-device-status-text">Checking device connection...</p>
      </div>

      <!-- Add Teacher Form -->
      <div class="card" style="margin-bottom:20px;">
        <h3>Add New Teacher</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:16px;">Manually add a teacher to the database. The Biometric ID must match the ID registered on the ZKTeco device.</p>
        <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
          <div class="form-group" style="flex:1;min-width:200px;">
            <label style="font-weight:500;font-size:13px;">Teacher Name</label>
            <input type="text" id="teacher-name-input" placeholder="e.g. Juan Dela Cruz" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);">
          </div>
          <div class="form-group" style="min-width:150px;">
            <label style="font-weight:500;font-size:13px;">Biometric ID</label>
            <input type="number" id="teacher-bio-id-input" placeholder="e.g. 1" min="1" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);">
          </div>
          <div class="form-group" style="min-width:120px;">
            <label style="font-weight:500;font-size:13px;">Device Password</label>
            <input type="text" id="teacher-password-input" placeholder="Max 8 chars" maxlength="8" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);">
          </div>
          <button id="btn-add-teacher" style="padding:8px 20px;background:var(--accent);color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;height:36px;">Add Teacher</button>
        </div>
        <span id="add-teacher-status" style="display:block;margin-top:8px;font-size:13px;"></span>
      </div>

      <!-- Teacher List -->
      <div class="card" style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <h3 style="margin:0;">Enrolled Teachers</h3>
          <div style="display:flex;gap:8px;">
            <button id="btn-refresh-teachers" style="padding:6px 14px;background:var(--accent);color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;">Refresh</button>
            <button id="btn-enroll-all" style="padding:6px 14px;background:#10b981;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;display:none;">Enroll All to Device</button>
          </div>
        </div>
        <div id="teachers-list-container">
          <p style="color:var(--text-muted);font-size:13px;font-style:italic;">Loading teachers...</p>
        </div>
      </div>

      <!-- Enrollment Result -->
      <div class="card" id="enroll-result-card" style="display:none;">
        <h3 id="enroll-result-title">Enrollment Result</h3>
        <p id="enroll-result-message" style="font-size:14px;"></p>
        <div id="enroll-result-details" style="font-size:12px;margin-top:8px;"></div>
      </div>

      <!-- Edit Teacher Modal -->
      <div id="edit-teacher-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);align-items:center;justify-content:center;z-index:1000;">
        <div style="background:var(--modal-bg);color:var(--modal-text);padding:20px;border-radius:8px;max-width:420px;width:90%;border:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="margin:0;">Edit Teacher</h3>
            <button id="btn-close-edit-modal" style="padding:4px 10px;background:var(--surface-alt);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:12px;color:var(--text-muted);">✕</button>
          </div>
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div class="form-group">
              <label style="font-weight:500;font-size:13px;">Teacher Name</label>
              <input type="text" id="edit-teacher-name" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);">
            </div>
            <div class="form-group">
              <label style="font-weight:500;font-size:13px;">Biometric ID</label>
              <input type="number" id="edit-teacher-bio-id" min="1" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);">
            </div>
            <div class="form-group">
              <label style="font-weight:500;font-size:13px;">Device Password</label>
              <input type="text" id="edit-teacher-password" maxlength="8" placeholder="Max 8 chars" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);">
            </div>
            <span id="edit-teacher-status" style="font-size:13px;"></span>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
              <button id="btn-cancel-edit-teacher" style="padding:8px 16px;background:var(--surface-alt);border:1px solid var(--border);border-radius:6px;cursor:pointer;">Cancel</button>
              <button id="btn-save-edit-teacher" style="padding:8px 20px;background:var(--accent);color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">Save Changes</button>
            </div>
          </div>
        </div>
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
        <div style="margin-bottom:20px;padding:10px;background:var(--surface-alt);border-radius:6px;display:flex;flex-wrap:wrap;gap:20px;">
          <p style="margin:0;"><strong>Biometric ID:</strong> <span id="teacher-details-biometric"></span></p>
          <p style="margin:0;"><strong>Date Created:</strong> <span id="teacher-details-created"></span></p>
          <p style="margin:0;display:flex;align-items:center;"><strong>Status:</strong>
            <button id="btn-toggle-status" style="padding:4px 14px;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;margin-left:6px;"></button>
          </p>
        </div>

        <!-- Inner tabs for Teacher details -->
        <div class="teacher-tabs" style="display:flex;gap:10px;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:5px;">
          <button class="teacher-tab-btn active" id="tab-teacher-attendance" style="padding:8px 16px;background:none;border:none;border-bottom:2px solid var(--accent);cursor:pointer;font-weight:600;color:var(--text);">Attendance Records</button>
          <button class="teacher-tab-btn" id="tab-teacher-config" style="padding:8px 16px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-weight:500;color:var(--text-muted);">Specific Time Config</button>
        </div>

        <!-- Attendance Records Tab Panel -->
        <div id="teacher-attendance-panel">
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

        <!-- Specific Time Config Tab Panel -->
        <div id="teacher-config-panel" style="display:none;">
          <h4 style="margin-top:0;margin-bottom:10px;">Specific Time Schedule Configuration</h4>
          <p style="color:var(--text-muted);font-size:13px;margin-bottom:15px;">Set custom time-in and time-out rules for this teacher. When enabled, these override the global configuration.</p>
          
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;padding:10px;background:var(--surface-alt);border-radius:6px;border:1px solid var(--border);">
            <input type="checkbox" id="enable-teacher-config" style="cursor:pointer;width:18px;height:18px;">
            <label for="enable-teacher-config" style="font-weight:600;cursor:pointer;margin:0;">Use Teacher-Specific Time Configuration</label>
          </div>
          
          <div id="teacher-config-inputs-container" style="display:none;">
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:20px;margin-bottom:20px;">
              <div class="time-schedule-card" style="border:1px solid var(--border);padding:15px;border-radius:8px;background:var(--surface-alt);">
                <h4 style="margin-top:0;margin-bottom:12px;color:var(--accent);">🌅 Morning (A.M.)</h4>
                <div style="display:flex;flex-direction:column;gap:10px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;"><label>Time In:</label><input type="time" id="teacher-am-in" style="padding:5px;border-radius:4px;border:1px solid var(--border);"></div>
                  <div style="display:flex;justify-content:space-between;align-items:center;"><label>Grace Until:</label><input type="time" id="teacher-am-in-end" style="padding:5px;border-radius:4px;border:1px solid var(--border);"></div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px;"><label>Out From:</label><input type="time" id="teacher-am-out-start" style="padding:5px;border-radius:4px;border:1px solid var(--border);"></div>
                  <div style="display:flex;justify-content:space-between;align-items:center;"><label>Out Until:</label><input type="time" id="teacher-am-out" style="padding:5px;border-radius:4px;border:1px solid var(--border);"></div>
                </div>
              </div>
              <div class="time-schedule-card" style="border:1px solid var(--border);padding:15px;border-radius:8px;background:var(--surface-alt);">
                <h4 style="margin-top:0;margin-bottom:12px;color:var(--accent);">🌇 Afternoon (P.M.)</h4>
                <div style="display:flex;flex-direction:column;gap:10px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;"><label>Time In:</label><input type="time" id="teacher-pm-in" style="padding:5px;border-radius:4px;border:1px solid var(--border);"></div>
                  <div style="display:flex;justify-content:space-between;align-items:center;"><label>Grace Until:</label><input type="time" id="teacher-pm-in-end" style="padding:5px;border-radius:4px;border:1px solid var(--border);"></div>
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px;"><label>Out From:</label><input type="time" id="teacher-pm-out-start" style="padding:5px;border-radius:4px;border:1px solid var(--border);"></div>
                  <div style="display:flex;justify-content:space-between;align-items:center;"><label>Out Until:</label><input type="time" id="teacher-pm-out" style="padding:5px;border-radius:4px;border:1px solid var(--border);"></div>
                </div>
              </div>
            </div>
          </div>
          
          <div style="display:flex;align-items:center;gap:12px;">
            <button class="btn-primary" id="btn-save-teacher-schedule">Save Configuration</button>
            <span class="status-msg" id="teacher-schedule-status"></span>
          </div>
        </div>
      </div>
    </div>`;
}

function getAdminView() {
  return `
    <div class="view-section active" id="admin-view">
      <div class="dashboard-header"><h1>Admin</h1><p>Manage time schedule, holidays, and system settings</p></div>
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

      <!-- Holidays / Class Suspensions Management -->
      <div class="card" style="margin-top:20px;">
        <h3>📅 Holidays & Class Suspensions</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:20px;">Mark dates as holidays or class suspensions. These will be reflected in DTR generation.</p>
        
        <div class="holiday-add-form" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:20px;padding:16px;background:var(--surface-alt);border-radius:8px;border:1px solid var(--border);">
          <div class="form-group">
            <label>Date</label>
            <input type="date" id="holiday-date" style="padding:8px;border-radius:6px;border:1px solid var(--border);">
          </div>
          <div class="form-group">
            <label>Type</label>
            <select id="holiday-type" style="padding:8px;border-radius:6px;border:1px solid var(--border);">
              <option value="holiday">Holiday</option>
              <option value="suspension">Class Suspension</option>
            </select>
          </div>
          <div class="form-group">
            <label>Description (optional)</label>
            <input type="text" id="holiday-description" placeholder="e.g. National Heroes Day" style="padding:8px;border-radius:6px;border:1px solid var(--border);width:200px;">
          </div>
          <div class="form-group">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
              <input type="checkbox" id="holiday-half-day" style="cursor:pointer;width:16px;height:16px;">
              <label for="holiday-half-day" style="font-weight:500;cursor:pointer;margin:0;">Half-day</label>
            </div>
            <div id="holiday-half-day-periods" style="display:none;gap:12px;">
              <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;">
                <input type="radio" name="half-day-period" value="AM" checked> AM
              </label>
              <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;">
                <input type="radio" name="half-day-period" value="PM"> PM
              </label>
            </div>
          </div>
          <button class="btn-primary" id="btn-add-holiday" style="padding:8px 20px;">Add</button>
        </div>
        
        <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;">
          <label for="holiday-month-filter" style="font-weight:500;font-size:14px;">View month:</label>
          <input type="month" id="holiday-month-filter" style="padding:8px;border-radius:6px;border:1px solid var(--border);">
          <button class="btn-primary" id="btn-refresh-holidays" style="padding:6px 14px;font-size:12px;">Refresh</button>
        </div>
        
        <div id="holidays-list-container">
          <p style="color:var(--text-muted);font-size:13px;font-style:italic;">Loading holidays...</p>
        </div>
      </div>
    </div>`;
}

function getAboutView() {
  return `
    <div class="view-section active" id="about-view">
      <div class="dashboard-header"><h1>About</h1><p>Biometric Daily Time Record System</p></div>
      <div class="card" style="margin-bottom:20px;">
        <h3>Biometric DTR System</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:4px;">Version <span id="about-version">1.0.0</span></p>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:15px;">License: <span id="about-license" style="font-weight:600;color:var(--success);">Active</span></p>
        <p style="line-height:1.7;font-size:14px;max-width:600px;">
          This application is a Daily Time Record (DTR) system designed for school personnel 
          in the Philippines. It follows the Civil Service Commission (CSC) Form No. 48 format 
          and supports biometric attendance data import from NGTeco devices.
        </p>
        <p style="line-height:1.7;font-size:14px;max-width:600px;margin-top:12px;">
          <strong>Features:</strong><br>
          • Biometric attendance import (NGTeco Cloud / USB devices)<br>
          • ZKTeco device direct connection (TCP/IP) with sync & enrollment<br>
          • Automated DTR generation in CSC Form No. 48 format<br>
          • Teacher management with time schedule configuration<br>
          • User authentication and role-based access<br>
          • Automatic updates via GitHub Releases
        </p>
      </div>
      <div class="card">
        <h3>Check for Updates</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:15px;">
          The app can auto-update when a new version is published on GitHub.
        </p>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <button class="btn-primary" id="btn-about-check-updates">Check for Updates</button>
          <button class="btn-success" id="btn-about-download-update" style="display:none;">Download Update</button>
          <button class="btn-primary" id="btn-about-install-update" style="display:none;">Restart & Install</button>
          <span id="about-update-status" style="font-size:13px;font-weight:500;color:var(--text-muted);"></span>
        </div>
        <div id="about-update-progress" style="display:none;margin-top:12px;width:100%;max-width:400px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:4px;">
            <span id="about-progress-label">Downloading...</span>
            <span id="about-progress-percent">0%</span>
          </div>
          <div style="width:100%;height:8px;background:var(--border);border-radius:4px;overflow:hidden;">
            <div id="about-progress-bar" style="height:100%;width:0%;background:var(--accent);border-radius:4px;transition:width 0.3s;"></div>
          </div>
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
      <div class="card" style="margin-bottom:20px;">
        <h3>Updates</h3>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:15px;">Check for new versions of the application.</p>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <button class="btn-primary" id="btn-check-updates">Check for Updates</button>
          <button class="btn-success" id="btn-download-update" style="display:none;">Download Update</button>
          <button class="btn-primary" id="btn-install-update" style="display:none;">Restart & Install</button>
          <span id="update-status-text" style="font-size:13px;font-weight:500;color:var(--text-muted);"></span>
        </div>
        <div id="update-progress-container" style="display:none;margin-top:12px;width:100%;max-width:400px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:4px;">
            <span id="update-progress-label">Downloading...</span>
            <span id="update-progress-percent">0%</span>
          </div>
          <div style="width:100%;height:8px;background:var(--border);border-radius:4px;overflow:hidden;">
            <div id="update-progress-bar" style="height:100%;width:0%;background:var(--accent);border-radius:4px;transition:width 0.3s;"></div>
          </div>
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
  const ngtecoCloudPanel = document.getElementById('source-ngteco-cloud-panel');
  const ngtecoUsbPanel = document.getElementById('source-ngteco-usb-panel');
  const zktecoUsbPanel = document.getElementById('source-zkteco-usb-panel');
  const tabNgtecoCloud = document.getElementById('tab-ngteco-cloud');
  const tabNgtecoUsb = document.getElementById('tab-ngteco-usb');
  const tabZktecoUsb = document.getElementById('tab-zkteco-usb');

  if (!tabNgtecoCloud) return;

  let selectedFilePath = null;
  let activeSource = 'ngteco-cloud';

  // ── Source Tab Switching ──
  function setActiveSource(source) {
    activeSource = source;
    // Hide all panels
    ngtecoCloudPanel.style.display = 'none';
    ngtecoUsbPanel.style.display = 'none';
    zktecoUsbPanel.style.display = 'none';
    // Remove active from all tabs
    tabNgtecoCloud.classList.remove('active');
    tabNgtecoUsb.classList.remove('active');
    tabZktecoUsb.classList.remove('active');
    // Show selected panel and activate tab
    if (source === 'ngteco-cloud') {
      ngtecoCloudPanel.style.display = '';
      tabNgtecoCloud.classList.add('active');
    } else if (source === 'ngteco-usb') {
      ngtecoUsbPanel.style.display = '';
      tabNgtecoUsb.classList.add('active');
    } else if (source === 'zkteco-usb') {
      zktecoUsbPanel.style.display = '';
      tabZktecoUsb.classList.add('active');
    }
    // Reset preview when switching
    previewCard.style.display = 'none';
    resultCard.style.display = 'none';
    selectedFilePath = null;
  }

  tabNgtecoCloud.addEventListener('click', () => setActiveSource('ngteco-cloud'));
  tabNgtecoUsb.addEventListener('click', () => setActiveSource('ngteco-usb'));
  tabZktecoUsb.addEventListener('click', () => setActiveSource('zkteco-usb'));

  // Step 1: Open NGTeco portal (cloud only)
  btnOpenPortal.addEventListener('click', async () => {
    await ipcRenderer.invoke('open-ngteco-portal');
  });

  // ── Shared Import Handler ──
  async function handleImportClick() {
    let dialogTitle, sourceLabelText;
    if (activeSource === 'ngteco-cloud') {
      dialogTitle = 'Select NGTeco Office Export File';
      sourceLabelText = 'Source: NGTeco Office (Cloud)';
    } else if (activeSource === 'ngteco-usb') {
      dialogTitle = 'Select NGTeco USB Attendance File';
      sourceLabelText = 'Source: NGTeco USB Device';
    } else {
      dialogTitle = 'Select ZKTeco USB Attendance File';
      sourceLabelText = 'Source: ZKTeco USB Device';
    }

    const fileResult = await ipcRenderer.invoke('select-import-file', dialogTitle);
    if (!fileResult.success) return;

    selectedFilePath = fileResult.filePath;
    fileNameEl.textContent = `File: ${selectedFilePath.split(/[/\\]/).pop()}`;
    sourceLabel.textContent = sourceLabelText;

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

  // Attach to all import buttons
  document.getElementById('btn-import-cloud').addEventListener('click', handleImportClick);
  document.getElementById('btn-import-ngteco-usb').addEventListener('click', handleImportClick);
  document.getElementById('btn-import-zkteco-usb').addEventListener('click', handleImportClick);

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

async function setupDevicesView() {
  let selectedDeviceId = null;
  let selectedDevice = null;

  // Setup guide toggle
  const btnToggleGuide = document.getElementById('btn-toggle-setup-guide');
  const guideContent = document.getElementById('setup-guide-content');
  if (btnToggleGuide && guideContent) {
    btnToggleGuide.addEventListener('click', () => {
      const isVisible = guideContent.style.display !== 'none';
      guideContent.style.display = isVisible ? 'none' : '';
      btnToggleGuide.textContent = isVisible ? 'Show Steps' : 'Hide Steps';
    });
  }

  // Load devices list
  async function loadDevices() {
    const devices = await ipcRenderer.invoke('get-devices');
    const container = document.getElementById('devices-list-container');

    if (devices.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;font-style:italic;">No devices registered. Add a device above.</p>';
      return;
    }

    let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="background:var(--surface-alt);">';
    html += '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Name</th>';
    html += '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Serial</th>';
    html += '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">IP Address</th>';
    html += '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Port</th>';
    html += '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Type</th>';
    html += '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Last Sync</th>';
    html += '<th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Actions</th>';
    html += '</tr></thead><tbody>';

    devices.forEach(d => {
      const lastSync = d.last_sync ? new Date(d.last_sync).toLocaleString() : 'Never';
      const isActive = d.status === 'active';
      html += `<tr style="border-bottom:1px solid var(--border);${selectedDeviceId === d.id ? 'background:var(--surface-alt);' : ''}" class="device-row" data-device-id="${d.id}" data-device-name="${d.name}" data-device-serial="${d.serial_number || ''}" data-device-ip="${d.ip_address}" data-device-port="${d.port}" data-device-type="${d.device_type}">
        <td style="padding:8px;font-weight:500;cursor:pointer;">${d.name}</td>
        <td style="padding:8px;font-family:monospace;font-size:12px;cursor:pointer;">${d.serial_number || '—'}</td>
        <td style="padding:8px;font-family:monospace;cursor:pointer;">${d.ip_address}</td>
        <td style="padding:8px;cursor:pointer;">${d.port}</td>
        <td style="padding:8px;cursor:pointer;"><span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:${d.device_type === 'zkteco' ? 'rgba(59,130,246,0.1);color:#3b82f6' : 'rgba(16,185,129,0.1);color:#10b981'}">${d.device_type.toUpperCase()}</span></td>
        <td style="padding:8px;color:var(--text-muted);cursor:pointer;font-size:12px;">${lastSync}</td>
        <td style="padding:8px;text-align:center;">
          <button class="btn-select-device" data-device-id="${d.id}" style="padding:4px 10px;background:var(--accent);color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;">Select</button>
          <button class="btn-delete-device" data-device-id="${d.id}" data-device-name="${d.name}" style="padding:4px 10px;background:rgba(239,68,68,0.1);color:var(--danger);border:1px solid rgba(239,68,68,0.2);border-radius:4px;cursor:pointer;font-size:11px;">Delete</button>
        </td>
      </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Attach event handlers
    container.querySelectorAll('.btn-select-device').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const deviceId = parseInt(btn.getAttribute('data-device-id'));
        selectDevice(deviceId, devices);
      });
    });

    container.querySelectorAll('.btn-delete-device').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const deviceId = parseInt(btn.getAttribute('data-device-id'));
        const deviceName = btn.getAttribute('data-device-name');
        if (confirm(`Delete device "${deviceName}"?`)) {
          await ipcRenderer.invoke('delete-device', deviceId);
          if (selectedDeviceId === deviceId) {
            selectedDeviceId = null;
            selectedDevice = null;
            document.getElementById('device-connection-panel').style.display = 'none';
          }
          loadDevices();
          showToast('Device deleted');
        }
      });
    });

    container.querySelectorAll('.device-row').forEach(row => {
      row.addEventListener('click', () => {
        const deviceId = parseInt(row.getAttribute('data-device-id'));
        selectDevice(deviceId, devices);
      });
    });
  }

  function selectDevice(deviceId, devices) {
    selectedDeviceId = deviceId;
    selectedDevice = devices.find(d => d.id === deviceId);
    if (!selectedDevice) return;

    const panel = document.getElementById('device-connection-panel');
    const info = document.getElementById('connection-info');
    panel.style.display = '';
    info.innerHTML = `
      <strong>${selectedDevice.name}</strong> — 
      <span style="font-family:monospace;">${selectedDevice.ip_address}:${selectedDevice.port}</span>
      ${selectedDevice.serial_number ? `<br>Serial: <span style="font-family:monospace;">${selectedDevice.serial_number}</span>` : ''}
    `;

    // Highlight selected row
    document.querySelectorAll('.device-row').forEach(r => r.style.background = '');
    const selectedRow = document.querySelector(`.device-row[data-device-id="${deviceId}"]`);
    if (selectedRow) selectedRow.style.background = 'var(--surface-alt)';

    // Check connection status
    checkConnectionStatus();
  }

  async function checkConnectionStatus() {
    const status = await ipcRenderer.invoke('get-device-status');
    const statusEl = document.getElementById('connection-status');
    const btnConnect = document.getElementById('btn-connect-device');
    const btnDisconnect = document.getElementById('btn-disconnect-device');
    const btnSync = document.getElementById('btn-sync-attendance');
    const btnClearResync = document.getElementById('btn-clear-resync');
    const btnUsers = document.getElementById('btn-view-device-users');

    if (status.connected) {
      statusEl.innerHTML = '<span style="color:#10b981;font-weight:600;">● Connected</span>';
      btnConnect.style.display = 'none';
      btnDisconnect.style.display = '';
      btnSync.style.display = '';
      btnClearResync.style.display = '';
      btnUsers.style.display = '';
    } else {
      statusEl.innerHTML = '<span style="color:#9ca3af;">● Not connected</span>';
      btnConnect.style.display = '';
      btnDisconnect.style.display = 'none';
      btnSync.style.display = 'none';
      btnClearResync.style.display = 'none';
      btnUsers.style.display = 'none';
    }
  }

  // Add device button
  document.getElementById('btn-add-device').addEventListener('click', async () => {
    const name = document.getElementById('device-name').value.trim();
    const serial = document.getElementById('device-serial').value.trim();
    const ip = document.getElementById('device-ip').value.trim();
    const port = parseInt(document.getElementById('device-port').value) || 4370;
    const type = document.getElementById('device-type').value;
    const statusEl = document.getElementById('add-device-status');

    if (!name) { showToast('Please enter a device name'); return; }
    if (!ip) { showToast('Please enter an IP address'); return; }

    const result = await ipcRenderer.invoke('add-device', { name, serial_number: serial, ip_address: ip, port, device_type: type });
    if (result.success) {
      statusEl.textContent = '✓ Device added!';
      statusEl.style.color = '#10b981';
      document.getElementById('device-name').value = '';
      document.getElementById('device-serial').value = '';
      document.getElementById('device-ip').value = '';
      document.getElementById('device-port').value = '4370';
      loadDevices();
      showToast('Device added successfully');
    } else {
      statusEl.textContent = '✗ ' + result.message;
      statusEl.style.color = '#ef4444';
    }
    setTimeout(() => statusEl.textContent = '', 3000);
  });

  // Refresh button
  document.getElementById('btn-refresh-devices').addEventListener('click', loadDevices);

  // Connect button
  document.getElementById('btn-connect-device').addEventListener('click', async () => {
    if (!selectedDevice) return;
    const statusEl = document.getElementById('connection-status');
    statusEl.innerHTML = '<span style="color:#f59e0b;">● Connecting...</span>';

    const result = await ipcRenderer.invoke('connect-device', selectedDevice.ip_address, selectedDevice.port);
    if (result.success) {
      showToast('Connected to device');
    } else {
      showToast('Connection failed: ' + result.message);
    }
    checkConnectionStatus();
  });

  // Disconnect button
  document.getElementById('btn-disconnect-device').addEventListener('click', async () => {
    await ipcRenderer.invoke('disconnect-device');
    showToast('Disconnected');
    checkConnectionStatus();
  });

  // Sync button
  document.getElementById('btn-sync-attendance').addEventListener('click', async () => {
    const statusEl = document.getElementById('connection-status');
    statusEl.innerHTML = '<span style="color:#6366f1;">● Syncing attendance data...</span>';
    document.getElementById('btn-sync-attendance').disabled = true;

    const result = await ipcRenderer.invoke('sync-device-attendance');
    document.getElementById('btn-sync-attendance').disabled = false;
    checkConnectionStatus();

    // Show result
    const resultCard = document.getElementById('sync-result-card');
    const resultTitle = document.getElementById('sync-result-title');
    const resultMessage = document.getElementById('sync-result-message');
    const resultDetails = document.getElementById('sync-result-details');

    resultCard.style.display = '';
    if (result.success) {
      resultTitle.textContent = '✅ Sync Complete';
      resultTitle.style.color = '#10b981';
      resultMessage.textContent = result.message;
      resultMessage.style.color = 'var(--text)';
      let detailsHtml = '';
      if (result.synced > 0) detailsHtml += `<span style="color:#10b981;">● ${result.synced} new record(s) added</span><br>`;
      if (result.skipped > 0) detailsHtml += `<span style="color:#f59e0b;">● ${result.skipped} duplicate(s) skipped</span><br>`;
      if (result.autoCreated > 0) detailsHtml += `<span style="color:#3b82f6;">● Auto-created ${result.autoCreated} teacher(s): ${(result.autoCreatedNames || []).join(', ')}</span>`;
      resultDetails.innerHTML = detailsHtml;
    } else {
      resultTitle.textContent = '❌ Sync Failed';
      resultTitle.style.color = '#ef4444';
      resultMessage.textContent = result.message;
      resultMessage.style.color = '#ef4444';
      resultDetails.innerHTML = '';
    }
  });

  // Clear & Re-sync button
  document.getElementById('btn-clear-resync').addEventListener('click', async () => {
    const confirmed = await showConfirm('This will delete ALL teachers and attendance logs, then re-sync fresh data from the device. Continue?');
    if (!confirmed) return;

    const statusEl = document.getElementById('connection-status');
    statusEl.innerHTML = '<span style="color:#f59e0b;">● Clearing old data...</span>';

    const clearResult = await ipcRenderer.invoke('clear-device-sync-data');
    if (!clearResult.success) {
      showToast('Error: ' + clearResult.message);
      checkConnectionStatus();
      return;
    }

    showToast(clearResult.message);
    statusEl.innerHTML = '<span style="color:#6366f1;">● Re-syncing attendance data...</span>';

    // Now re-sync
    const result = await ipcRenderer.invoke('sync-device-attendance');
    checkConnectionStatus();

    // Show result
    const resultCard = document.getElementById('sync-result-card');
    const resultTitle = document.getElementById('sync-result-title');
    const resultMessage = document.getElementById('sync-result-message');
    const resultDetails = document.getElementById('sync-result-details');

    resultCard.style.display = '';
    if (result.success) {
      resultTitle.textContent = '✅ Re-sync Complete';
      resultTitle.style.color = '#10b981';
      resultMessage.textContent = result.message;
      resultMessage.style.color = 'var(--text)';
      let detailsHtml = '';
      if (result.synced > 0) detailsHtml += `<span style="color:#10b981;">● ${result.synced} new record(s) added</span><br>`;
      if (result.skipped > 0) detailsHtml += `<span style="color:#f59e0b;">● ${result.skipped} duplicate(s) skipped</span><br>`;
      if (result.autoCreated > 0) detailsHtml += `<span style="color:#3b82f6;">● Auto-created ${result.autoCreated} teacher(s): ${(result.autoCreatedNames || []).join(', ')}</span>`;
      resultDetails.innerHTML = detailsHtml;
    } else {
      resultTitle.textContent = '❌ Re-sync Failed';
      resultTitle.style.color = '#ef4444';
      resultMessage.textContent = result.message;
      resultMessage.style.color = '#ef4444';
      resultDetails.innerHTML = '';
    }
  });

  // View users button
  document.getElementById('btn-view-device-users').addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('get-device-users');
    const modal = document.getElementById('device-users-modal');
    const list = document.getElementById('device-users-list');

    if (result.success && result.data && result.data.length > 0) {
      let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
      html += '<thead><tr style="background:var(--surface-alt);"><th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">User ID</th><th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Name</th><th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Role</th></tr></thead><tbody>';
      result.data.forEach(u => {
        html += `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px;font-family:monospace;">${u.userId || u.id || ''}</td>
          <td style="padding:8px;">${u.name || '—'}</td>
          <td style="padding:8px;">${u.role === 1 ? 'Admin' : 'User'}</td>
        </tr>`;
      });
      html += '</tbody></table>';
      list.innerHTML = html;
    } else {
      list.innerHTML = `<p style="color:var(--text-muted);">${result.message || 'No users found on device.'}</p>`;
    }

    modal.style.display = 'flex';
  });

  // Close users modal
  document.getElementById('btn-close-users-modal').addEventListener('click', () => {
    document.getElementById('device-users-modal').style.display = 'none';
  });

  // Close modal on outside click
  document.getElementById('device-users-modal').addEventListener('click', (e) => {
    if (e.target.id === 'device-users-modal') {
      document.getElementById('device-users-modal').style.display = 'none';
    }
  });

  // Initial load
  await loadDevices();
  checkConnectionStatus();
}

async function setupTeachersView() {
  async function checkDeviceStatus() {
    const status = await ipcRenderer.invoke('get-device-status');
    const statusText = document.getElementById('teachers-device-status-text');
    const btnEnrollAll = document.getElementById('btn-enroll-all');
    const banner = document.getElementById('teachers-device-status');

    if (status.connected) {
      statusText.innerHTML = '<span style="color:#10b981;font-weight:600;">● Device Connected</span> — You can enroll teachers to the ZKTeco device.';
      banner.style.borderLeftColor = '#10b981';
      btnEnrollAll.style.display = '';
    } else {
      statusText.innerHTML = '<span style="color:#f59e0b;font-weight:600;">● No Device Connected</span> — Go to the <strong>Devices</strong> tab to connect before enrolling.';
      banner.style.borderLeftColor = '#f59e0b';
      btnEnrollAll.style.display = 'none';
    }
  }

  async function loadTeachers() {
    const teachers = await ipcRenderer.invoke('get-teachers');
    const container = document.getElementById('teachers-list-container');

    if (teachers.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;font-style:italic;">No teachers added yet. Use the form above to add one.</p>';
      return;
    }

    let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="background:var(--surface-alt);">';
    html += '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Name</th>';
    html += '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Biometric ID</th>';
    html += '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Status</th>';
    html += '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Created</th>';
    html += '<th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Actions</th>';
    html += '</tr></thead><tbody>';

    teachers.forEach(t => {
      const isActive = (t.status || 'active') === 'active';
      const statusColor = isActive ? '#10b981' : '#9ca3af';
      const createdDate = t.created_at ? new Date(t.created_at).toLocaleDateString() : '—';
      html += `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px;font-weight:500;">${t.name}</td>
        <td style="padding:8px;font-family:monospace;">${t.biometric_id}</td>
        <td style="padding:8px;"><span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;color:white;background:${statusColor};">${isActive ? 'Active' : 'Inactive'}</span></td>
        <td style="padding:8px;color:var(--text-muted);font-size:12px;">${createdDate}</td>
        <td style="padding:8px;text-align:center;">
          <button class="btn-edit-teacher" data-teacher-id="${t.id}" data-teacher-name="${t.name}" data-teacher-bio="${t.biometric_id}" data-teacher-password="${t.device_password || ''}" style="padding:4px 10px;background:rgba(99,102,241,0.1);color:#6366f1;border:1px solid rgba(99,102,241,0.3);border-radius:4px;cursor:pointer;font-size:11px;">Edit</button>
          <button class="btn-enroll-teacher" data-teacher-id="${t.id}" data-teacher-name="${t.name}" style="padding:4px 10px;background:#10b981;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;display:none;">Enroll</button>
          <button class="btn-toggle-teacher-status" data-teacher-id="${t.id}" data-teacher-name="${t.name}" data-teacher-status="${t.status || 'active'}" style="padding:4px 10px;background:${isActive ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)'};color:${isActive ? '#f59e0b' : '#10b981'};border:1px solid ${isActive ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'};border-radius:4px;cursor:pointer;font-size:11px;">${isActive ? 'Deactivate' : 'Activate'}</button>
          <button class="btn-delete-teacher" data-teacher-id="${t.id}" data-teacher-name="${t.name}" style="padding:4px 10px;background:rgba(239,68,68,0.1);color:var(--danger);border:1px solid rgba(239,68,68,0.2);border-radius:4px;cursor:pointer;font-size:11px;">Delete</button>
        </td>
      </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Show/hide enroll buttons based on device status
    const deviceStatus = await ipcRenderer.invoke('get-device-status');
    const enrollBtns = container.querySelectorAll('.btn-enroll-teacher');
    if (deviceStatus.connected) {
      enrollBtns.forEach(btn => btn.style.display = '');
    }

    // Attach event handlers
    container.querySelectorAll('.btn-enroll-teacher').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const teacherId = parseInt(btn.getAttribute('data-teacher-id'));
        const teacherName = btn.getAttribute('data-teacher-name');
        btn.disabled = true;
        btn.textContent = 'Enrolling...';
        const result = await ipcRenderer.invoke('enroll-teacher-to-device', teacherId);
        btn.disabled = false;
        btn.textContent = 'Enroll';
        if (result.success) {
          showToast(`"${teacherName}" enrolled to device`);
        } else {
          showToast('Enrollment failed: ' + result.message);
        }
      });
    });

    container.querySelectorAll('.btn-delete-teacher').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const teacherId = parseInt(btn.getAttribute('data-teacher-id'));
        const teacherName = btn.getAttribute('data-teacher-name');
        const confirmed = await showConfirm(`Delete teacher "${teacherName}"? This will also remove all their attendance logs.`);
        if (!confirmed) return;
        const result = await ipcRenderer.invoke('delete-teacher', teacherId);
        if (result.success) {
          showToast(`"${teacherName}" deleted`);
          loadTeachers();
        } else {
          showToast('Delete failed: ' + result.message);
        }
      });
    });

    container.querySelectorAll('.btn-toggle-teacher-status').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const teacherId = parseInt(btn.getAttribute('data-teacher-id'));
        const teacherName = btn.getAttribute('data-teacher-name');
        const currentStatus = btn.getAttribute('data-teacher-status');
        const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
        const result = await ipcRenderer.invoke('update-teacher-status', teacherId, newStatus);
        if (result.success) {
          showToast(`"${teacherName}" is now ${newStatus}`);
          loadTeachers();
        } else {
          showToast('Status update failed: ' + result.message);
        }
      });
    });
  }

  // Add teacher button
  document.getElementById('btn-add-teacher').addEventListener('click', async () => {
    const nameInput = document.getElementById('teacher-name-input');
    const bioIdInput = document.getElementById('teacher-bio-id-input');
    const passwordInput = document.getElementById('teacher-password-input');
    const statusEl = document.getElementById('add-teacher-status');
    const name = nameInput.value.trim();
    const biometric_id = bioIdInput.value.trim();
    const device_password = passwordInput.value;

    if (!name) {
      statusEl.textContent = 'Please enter a teacher name.';
      statusEl.style.color = '#ef4444';
      return;
    }
    if (!biometric_id || parseInt(biometric_id) <= 0) {
      statusEl.textContent = 'Please enter a valid Biometric ID.';
      statusEl.style.color = '#ef4444';
      return;
    }

    const result = await ipcRenderer.invoke('add-teacher', { name, biometric_id: parseInt(biometric_id), device_password });
    if (result.success) {
      statusEl.textContent = `✓ "${name}" added successfully!`;
      statusEl.style.color = '#10b981';
      nameInput.value = '';
      bioIdInput.value = '';
      passwordInput.value = '';
      showToast(`"${name}" added to database`);
      loadTeachers();
    } else {
      statusEl.textContent = '✗ ' + result.message;
      statusEl.style.color = '#ef4444';
    }
    setTimeout(() => statusEl.textContent = '', 4000);
  });

  // Refresh button
  document.getElementById('btn-refresh-teachers').addEventListener('click', loadTeachers);

  // Enroll All button
  document.getElementById('btn-enroll-all').addEventListener('click', async () => {
    const btn = document.getElementById('btn-enroll-all');
    const confirmed = await showConfirm('Enroll all active teachers to the connected ZKTeco device?');
    if (!confirmed) return;

    btn.disabled = true;
    btn.textContent = 'Enrolling...';

    const result = await ipcRenderer.invoke('enroll-all-teachers-to-device');
    btn.disabled = false;
    btn.textContent = 'Enroll All to Device';

    const resultCard = document.getElementById('enroll-result-card');
    const resultTitle = document.getElementById('enroll-result-title');
    const resultMessage = document.getElementById('enroll-result-message');
    const resultDetails = document.getElementById('enroll-result-details');

    resultCard.style.display = '';
    if (result.success) {
      resultTitle.textContent = '✅ Enrollment Complete';
      resultTitle.style.color = '#10b981';
      resultMessage.textContent = result.message;
      resultMessage.style.color = 'var(--text)';
      let detailsHtml = '';
      if (result.enrolled > 0) detailsHtml += `<span style="color:#10b981;">● ${result.enrolled} teacher(s) enrolled</span><br>`;
      if (result.failed > 0) {
        detailsHtml += `<span style="color:#ef4444;">● ${result.failed} teacher(s) failed:</span><br>`;
        (result.errors || []).forEach(err => {
          detailsHtml += `<span style="color:#ef4444;margin-left:12px;">— ${err}</span><br>`;
        });
      }
      resultDetails.innerHTML = detailsHtml;
    } else {
      resultTitle.textContent = '❌ Enrollment Failed';
      resultTitle.style.color = '#ef4444';
      resultMessage.textContent = result.message;
      resultMessage.style.color = '#ef4444';
      resultDetails.innerHTML = '';
    }
  });

  // ── Edit Teacher Modal ──
  let editingTeacherId = null;

  function openEditModal(teacherId, name, bioId, devicePassword) {
    editingTeacherId = teacherId;
    document.getElementById('edit-teacher-name').value = name;
    document.getElementById('edit-teacher-bio-id').value = bioId;
    document.getElementById('edit-teacher-password').value = devicePassword || '';
    document.getElementById('edit-teacher-status').textContent = '';
    document.getElementById('edit-teacher-modal').style.display = 'flex';
  }

  function closeEditModal() {
    editingTeacherId = null;
    document.getElementById('edit-teacher-modal').style.display = 'none';
  }

  // Event delegation for edit buttons on teacher rows
  document.getElementById('teachers-list-container').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-edit-teacher');
    if (!btn) return;
    e.stopPropagation();
    const teacherId = parseInt(btn.getAttribute('data-teacher-id'));
    const teacherName = btn.getAttribute('data-teacher-name');
    const teacherBio = btn.getAttribute('data-teacher-bio');
    const teacherPassword = btn.getAttribute('data-teacher-password');
    openEditModal(teacherId, teacherName, teacherBio, teacherPassword);
  });

  document.getElementById('btn-save-edit-teacher').addEventListener('click', async () => {
    if (!editingTeacherId) return;
    const name = document.getElementById('edit-teacher-name').value.trim();
    const bioId = document.getElementById('edit-teacher-bio-id').value.trim();
    const device_password = document.getElementById('edit-teacher-password').value;
    const statusEl = document.getElementById('edit-teacher-status');

    if (!name) {
      statusEl.textContent = 'Please enter a name.';
      statusEl.style.color = '#ef4444';
      return;
    }
    if (!bioId || parseInt(bioId) <= 0) {
      statusEl.textContent = 'Please enter a valid Biometric ID.';
      statusEl.style.color = '#ef4444';
      return;
    }

    const result = await ipcRenderer.invoke('update-teacher', editingTeacherId, { name, biometric_id: parseInt(bioId), device_password });
    if (result.success) {
      closeEditModal();
      showToast('Teacher updated');
      loadTeachers();
    } else {
      statusEl.textContent = result.message;
      statusEl.style.color = '#ef4444';
    }
  });

  document.getElementById('btn-cancel-edit-teacher').addEventListener('click', closeEditModal);
  document.getElementById('btn-close-edit-modal').addEventListener('click', closeEditModal);
  document.getElementById('edit-teacher-modal').addEventListener('click', (e) => {
    if (e.target.id === 'edit-teacher-modal') closeEditModal();
  });

  // Refresh teacher list and device status each time the tab is visited
  const teachersNavBtn = document.getElementById('nav-teachers');
  if (teachersNavBtn) {
    teachersNavBtn.addEventListener('click', () => {
      loadTeachers();
      checkDeviceStatus();
    });
  }

  // Initial load
  await loadTeachers();
  await checkDeviceStatus();
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
    // Fetch fresh effective time schedule before generating DTR
    const freshSchedule = await ipcRenderer.invoke('get-effective-schedule', parseInt(teacherId));
    const logs = await ipcRenderer.invoke('get-attendance', parseInt(teacherId), parseInt(month), parseInt(year));
    // Fetch holidays for the month
    const holidays = await ipcRenderer.invoke('get-holidays-for-dtr', parseInt(month), year);
    const dtrHtml = generateDTRHtml(select.options[select.selectedIndex].text, monthNames[parseInt(month)], year, logs, freshSchedule, holidays);
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
    // Fetch only ACTIVE teachers before generating all DTRs
    const freshTeachers = await ipcRenderer.invoke('get-active-teachers');
    // Fetch holidays once for all teachers (same month)
    const holidays = await ipcRenderer.invoke('get-holidays-for-dtr', parseInt(month), year);
    const cols = columnSelect.value;
    let allHtml = '';
    for (const t of freshTeachers) {
      const logs = await ipcRenderer.invoke('get-attendance', t.id, parseInt(month), parseInt(year));
      // Fetch each teacher's individual effective time schedule
      const teacherSchedule = await ipcRenderer.invoke('get-effective-schedule', t.id);
      const dtrHtml = generateDTRHtml(t.name, monthNames[parseInt(month)], year, logs, teacherSchedule, holidays);
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

  // Tabs selectors
  const tabAttendance = document.getElementById('tab-teacher-attendance');
  const tabConfig = document.getElementById('tab-teacher-config');
  const panelAttendance = document.getElementById('teacher-attendance-panel');
  const panelConfig = document.getElementById('teacher-config-panel');

  function switchTeacherTab(tabName) {
    if (tabName === 'attendance') {
      tabAttendance.classList.add('active');
      tabAttendance.style.borderBottom = '2px solid var(--accent)';
      tabAttendance.style.fontWeight = '600';
      tabAttendance.style.color = 'var(--text)';
      
      tabConfig.classList.remove('active');
      tabConfig.style.borderBottom = '2px solid transparent';
      tabConfig.style.fontWeight = '500';
      tabConfig.style.color = 'var(--text-muted)';
      
      panelAttendance.style.display = '';
      panelConfig.style.display = 'none';
    } else {
      tabConfig.classList.add('active');
      tabConfig.style.borderBottom = '2px solid var(--accent)';
      tabConfig.style.fontWeight = '600';
      tabConfig.style.color = 'var(--text)';
      
      tabAttendance.classList.remove('active');
      tabAttendance.style.borderBottom = '2px solid transparent';
      tabAttendance.style.fontWeight = '500';
      tabAttendance.style.color = 'var(--text-muted)';
      
      panelAttendance.style.display = 'none';
      panelConfig.style.display = '';
    }
  }

  if (tabAttendance && tabConfig) {
    tabAttendance.addEventListener('click', () => switchTeacherTab('attendance'));
    tabConfig.addEventListener('click', () => switchTeacherTab('config'));
  }

  // Config UI references
  const enableConfigCheckbox = document.getElementById('enable-teacher-config');
  const configInputsContainer = document.getElementById('teacher-config-inputs-container');

  if (enableConfigCheckbox) {
    enableConfigCheckbox.addEventListener('change', () => {
      configInputsContainer.style.display = enableConfigCheckbox.checked ? 'block' : 'none';
    });
  }

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

    // Reset status message
    document.getElementById('teacher-schedule-status').textContent = '';

    // Load custom schedule if exists
    const teacherSchedule = await ipcRenderer.invoke('get-teacher-time-schedule', parseInt(teacherId));
    const globalSchedule = await ipcRenderer.invoke('get-time-schedule');

    if (teacherSchedule) {
      enableConfigCheckbox.checked = true;
      configInputsContainer.style.display = 'block';
      
      document.getElementById('teacher-am-in').value = teacherSchedule.am_time_in;
      document.getElementById('teacher-am-in-end').value = teacherSchedule.am_time_in_end;
      document.getElementById('teacher-am-out-start').value = teacherSchedule.am_time_out_start;
      document.getElementById('teacher-am-out').value = teacherSchedule.am_time_out;
      document.getElementById('teacher-pm-in').value = teacherSchedule.pm_time_in;
      document.getElementById('teacher-pm-in-end').value = teacherSchedule.pm_time_in_end;
      document.getElementById('teacher-pm-out-start').value = teacherSchedule.pm_time_out_start;
      document.getElementById('teacher-pm-out').value = teacherSchedule.pm_time_out;
    } else {
      enableConfigCheckbox.checked = false;
      configInputsContainer.style.display = 'none';
      
      // Pre-fill fields with global schedule as sensible default
      document.getElementById('teacher-am-in').value = globalSchedule.am_time_in;
      document.getElementById('teacher-am-in-end').value = globalSchedule.am_time_in_end;
      document.getElementById('teacher-am-out-start').value = globalSchedule.am_time_out_start;
      document.getElementById('teacher-am-out').value = globalSchedule.am_time_out;
      document.getElementById('teacher-pm-in').value = globalSchedule.pm_time_in;
      document.getElementById('teacher-pm-in-end').value = globalSchedule.pm_time_in_end;
      document.getElementById('teacher-pm-out-start').value = globalSchedule.pm_time_out_start;
      document.getElementById('teacher-pm-out').value = globalSchedule.pm_time_out;
    }

    // Reset tab to attendance
    switchTeacherTab('attendance');

    // Load logs for the selected month
    const monthVal = document.getElementById('search-month-select').value;
    const [year, month] = monthVal.split('-');
    currentYear = parseInt(year);
    currentMonth = parseInt(month);
    await loadTeacherLogs(parseInt(teacherId), month, year);
  });

  // Save specific schedule
  // Get effective schedule including holiday info for this teacher
  async function getEffectiveScheduleWithHolidays(teacherId, month, year) {
    const schedule = await ipcRenderer.invoke('get-effective-schedule', parseInt(teacherId));
    const holidays = await ipcRenderer.invoke('get-holidays-for-dtr', parseInt(month), year);
    return { schedule, holidays };
  }

  // Modify displayTeacherLogs to use this context
  async function loadTeacherLogs(teacherId, month, year) {
    const logs = await ipcRenderer.invoke('get-attendance', parseInt(teacherId), parseInt(month), year);
    const { schedule, holidays } = await getEffectiveScheduleWithHolidays(teacherId, month, year);
    displayTeacherLogs(logs, teacherId, month, year, schedule, holidays);
  }

  document.getElementById('btn-save-teacher-schedule').addEventListener('click', async () => {
    if (!currentSearchTeacherId) return;

    const statusEl = document.getElementById('teacher-schedule-status');
    statusEl.textContent = 'Saving...';
    statusEl.style.color = 'var(--text-muted)';

    if (enableConfigCheckbox.checked) {
      const schedule = {
        am_time_in: document.getElementById('teacher-am-in').value,
        am_time_in_end: document.getElementById('teacher-am-in-end').value,
        am_time_out_start: document.getElementById('teacher-am-out-start').value,
        am_time_out: document.getElementById('teacher-am-out').value,
        pm_time_in: document.getElementById('teacher-pm-in').value,
        pm_time_in_end: document.getElementById('teacher-pm-in-end').value,
        pm_time_out_start: document.getElementById('teacher-pm-out-start').value,
        pm_time_out: document.getElementById('teacher-pm-out').value
      };

      const res = await ipcRenderer.invoke('save-teacher-time-schedule', parseInt(currentSearchTeacherId), schedule);
      if (res.success) {
        statusEl.textContent = '✓ Saved specific schedule!';
        statusEl.style.color = '#10b981';
        showToast('Teacher-specific schedule saved');
        
        // Refresh logs immediately with new schedule calculations
        const monthVal = document.getElementById('search-month-select').value;
        const [year, month] = monthVal.split('-');
        await loadTeacherLogs(currentSearchTeacherId, month, year);
      } else {
        statusEl.textContent = 'Error: ' + res.message;
        statusEl.style.color = '#ef4444';
      }
    } else {
      const res = await ipcRenderer.invoke('delete-teacher-time-schedule', parseInt(currentSearchTeacherId));
      if (res.success) {
        statusEl.textContent = '✓ Specific schedule disabled (using global)';
        statusEl.style.color = '#10b981';
        showToast('Teacher-specific schedule disabled');
        
        // Refresh logs immediately to reflect global schedule calculations
        const monthVal = document.getElementById('search-month-select').value;
        const [year, month] = monthVal.split('-');
        await loadTeacherLogs(currentSearchTeacherId, month, year);
      } else {
        statusEl.textContent = 'Error: ' + res.message;
        statusEl.style.color = '#ef4444';
      }
    }
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

  // Refresh logs button
  document.getElementById('btn-refresh-logs').addEventListener('click', async () => {
    if (!currentSearchTeacherId) {
      showToast('Please select a teacher first');
      return;
    }
    const monthVal = document.getElementById('search-month-select').value;
    const [year, month] = monthVal.split('-');
    currentYear = parseInt(year);
    currentMonth = parseInt(month);
    await loadTeacherLogs(currentSearchTeacherId, month, year);
  });

}

function displayTeacherLogs(logs, teacherId, month, year, timeSchedule, holidays) {
  const logsContainer = document.getElementById('teacher-logs-container');
  if (!timeSchedule) {
    // Fallback if called without schedule (during initial page render)
    ipcRenderer.invoke('get-effective-schedule', parseInt(teacherId)).then(sched => {
      ipcRenderer.invoke('get-holidays-for-dtr', parseInt(month), year).then(hols => {
        displayTeacherLogs(logs, teacherId, month, year, sched, hols);
      });
    });
    return;
  }
  
  const monthNum = parseInt(month).toString().padStart(2, '0');
  
  if (logs.length === 0) {
    // Check if month has any holidays
    const hasHolidays = holidays && Object.keys(holidays).length > 0;
    if (!hasHolidays) {
      logsContainer.innerHTML = '<div style="padding:10px;color:#6b7280;">No logs found</div>';
      return;
    }
  }
  
  // Group logs by day
  const logsByDay = {};
  logs.forEach(l => {
    const d = parseInt(l.log_time.substring(8, 10));
    if (!logsByDay[d]) logsByDay[d] = [];
    logsByDay[d].push(l);
  });

  const sAmOutStart = timeToMinutes(timeSchedule.am_time_out_start);
  const sPmOutStart = timeToMinutes(timeSchedule.pm_time_out_start);
  const sAmInEnd = timeToMinutes(timeSchedule.am_time_in_end);
  const sPmInEnd = timeToMinutes(timeSchedule.pm_time_in_end);

  let html = '<div id="bulk-delete-toolbar" style="display:none;margin-bottom:8px;padding:6px 10px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;align-items:center;justify-content:space-between;">';
  html += '<span id="bulk-delete-count" style="font-size:13px;color:#991b1b;font-weight:500;"></span>';
  html += '<button id="btn-bulk-delete" style="padding:4px 12px;background:#ef4444;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;">Delete Selected</button>';
  html += '</div>';

  html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
  html += '<thead><tr style="background:#111827;"><th style="padding:8px;text-align:center;border:1px solid #374151;width:36px;color:white;"><input type="checkbox" id="select-all-days" style="cursor:pointer;"></th><th style="padding:8px;text-align:center;border:1px solid #374151;color:white;">Day</th><th style="padding:8px;text-align:center;border:1px solid #374151;color:white;">AM In</th><th style="padding:8px;text-align:center;border:1px solid #374151;color:white;">AM Out</th><th style="padding:8px;text-align:center;border:1px solid #374151;color:white;">PM In</th><th style="padding:8px;text-align:center;border:1px solid #374151;color:white;">PM Out</th><th style="padding:8px;text-align:center;border:1px solid #374151;color:white;">Undertime</th><th style="padding:8px;text-align:center;border:1px solid #374151;color:white;">Actions</th></tr></thead>';
  html += '<tbody>';

  // Process each day
  for (let i = 1; i <= 31; i++) {
    const dayLogs = logsByDay[i] || [];
    
    // Build date string for holiday lookup
    const dateStr = `${year}-${monthNum}-${String(i).padStart(2, '0')}`;
    const holiday = holidays ? holidays[dateStr] : null;
    const isHoliday = holiday && holiday.type === 'holiday';
    const isSuspension = holiday && holiday.type === 'suspension';
    const isHalfDay = holiday && holiday.is_half_day;
    const halfDayPeriod = holiday ? holiday.half_day_period : null;

    // Skip days with no logs AND no holidays
    if (dayLogs.length === 0 && !holiday) continue;

    let amIn = '', amOut = '', pmIn = '', pmOut = '';
    let amInMins = null, amOutMins = null, pmInMins = null, pmOutMins = null;

    dayLogs.forEach(l => {
      const timePart = l.log_time.substring(11);
      const [hours, minutes] = timePart.split(':').map(Number);
      const mins = hours * 60 + minutes;
      
      if (mins < 660) {
        if (l.log_type === 'Check-in') { amIn = formatTimeOnly(l.log_time); amInMins = mins; }
      }
      
      if (mins >= 660 && mins < 750) {
        if (l.log_type === 'Check-out') { amOut = formatTimeOnly(l.log_time); amOutMins = mins; }
        else if (l.log_type === 'Check-in' && !amIn) { amIn = formatTimeOnly(l.log_time); amInMins = mins; }
      }

      if (mins >= 750 && mins < 900) {
        if (l.log_type === 'Check-in') { pmIn = formatTimeOnly(l.log_time); pmInMins = mins; }
        else if (l.log_type === 'Check-out' && !amOut) { amOut = formatTimeOnly(l.log_time); amOutMins = mins; }
      }

      if (mins >= 900) {
        if (l.log_type === 'Check-out') { pmOut = formatTimeOnly(l.log_time); pmOutMins = mins; }
      }
    });

    // Calculate undertime with holiday awareness
    let utStr = '';
    let dailyUndertime = 0;

    let dayDisplay = String(i);
    let rowStyle = '';
    let holidayCellLabel = '';

    if (isHoliday) {
      holidayCellLabel = 'Holiday';
      rowStyle = 'background:#fef3c7;';
      // Show label in all time cells, no undertime
      amIn = holidayCellLabel; amOut = holidayCellLabel;
      pmIn = holidayCellLabel; pmOut = holidayCellLabel;
      amInMins = null; amOutMins = null;
      pmInMins = null; pmOutMins = null;
    } else if (isSuspension && !isHalfDay) {
      holidayCellLabel = 'Class Suspension';
      rowStyle = 'background:#fce7f3;';
      amIn = holidayCellLabel; amOut = holidayCellLabel;
      pmIn = holidayCellLabel; pmOut = holidayCellLabel;
      amInMins = null; amOutMins = null;
      pmInMins = null; pmOutMins = null;
    } else if (isSuspension && isHalfDay) {
      holidayCellLabel = 'Class Suspension';
      rowStyle = 'background:#fce7f3;';
      
      if (halfDayPeriod === 'AM') {
        amIn = holidayCellLabel; amOut = holidayCellLabel;
        amInMins = null; amOutMins = null;
      } else if (halfDayPeriod === 'PM') {
        pmIn = holidayCellLabel; pmOut = holidayCellLabel;
        pmInMins = null; pmOutMins = null;
      }

      // Calculate undertime only for active half
      if (halfDayPeriod !== 'AM') {
        if (amInMins === null || amOutMins === null) {
          dailyUndertime += 240;
        } else {
          if (amInMins > sAmInEnd) dailyUndertime += (amInMins - sAmInEnd);
          if (amOutMins < sAmOutStart) dailyUndertime += (sAmOutStart - amOutMins);
        }
      }
      if (halfDayPeriod !== 'PM') {
        if (pmInMins === null || pmOutMins === null) {
          dailyUndertime += 240;
        } else {
          if (pmInMins > sPmInEnd) dailyUndertime += (pmInMins - sPmInEnd);
          if (pmOutMins < sPmOutStart) dailyUndertime += (sPmOutStart - pmOutMins);
        }
      }
    } else {
      // Normal day evaluation
      if (amInMins !== null && amOutMins === null && pmInMins === null && pmOutMins !== null) {
        dailyUndertime = 480;
      } else {
        if (amInMins === null || amOutMins === null) {
          dailyUndertime += 240;
        } else {
          if (amInMins > sAmInEnd) dailyUndertime += (amInMins - sAmInEnd);
          if (amOutMins < sAmOutStart) dailyUndertime += (sAmOutStart - amOutMins);
        }

        if (pmInMins === null || pmOutMins === null) {
          dailyUndertime += 240;
        } else {
          if (pmInMins > sPmInEnd) dailyUndertime += (pmInMins - sPmInEnd);
          if (pmOutMins < sPmOutStart) dailyUndertime += (sPmOutStart - pmOutMins);
        }
      }
    }

    if (dailyUndertime > 0) {
      const utHours = Math.floor(dailyUndertime / 60);
      const utMins = dailyUndertime % 60;
      utStr = (utHours > 0 ? utHours + 'h ' : '') + (utMins > 0 ? utMins + 'm' : '');
    }

    const canSelect = !(isHoliday || (isSuspension && !isHalfDay));

    html += `<tr style="border-bottom:1px solid #e5e7eb;${rowStyle}">
      <td style="padding:8px;text-align:center;border:1px solid #e5e7eb;"><input type="checkbox" class="day-checkbox" data-day="${i}" ${canSelect ? '' : 'disabled'} style="cursor:${canSelect ? 'pointer' : 'not-allowed'};"></td>
      <td style="padding:8px;text-align:center;border:1px solid #e5e7eb;">${dayDisplay}</td>
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
      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const holiday = holidays ? holidays[dateStr] : null;
      if (holiday && holiday.type === 'holiday') {
        showToast('Cannot edit logs on a holiday');
        return;
      }
      if (holiday && holiday.type === 'suspension' && !holiday.is_half_day) {
        showToast('Cannot edit logs on a full-day suspension');
        return;
      }
      const dayLogs = logsByDay[day];
      if (!dayLogs) return;
      showEditDayModal(day, dayLogs, teacherId, logsByDay, currentMonth, currentYear);
    });
  });

  logsContainer.querySelectorAll('.delete-day-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const day = btn.getAttribute('data-day');
      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const holiday = holidays ? holidays[dateStr] : null;
      if (holiday && holiday.type === 'holiday') {
        showToast('Cannot delete logs on a holiday');
        return;
      }
      if (await showConfirm(`Are you sure you want to delete all logs for day ${day}?`)) {
        const dayLogs = logsByDay[day];
        for (const log of dayLogs) {
          await ipcRenderer.invoke('delete-attendance-log', log.id);
        }
        showToast('Logs deleted successfully');
        const freshLogs = await ipcRenderer.invoke('get-attendance', parseInt(teacherId), currentMonth, currentYear);
        const freshSchedule = await ipcRenderer.invoke('get-effective-schedule', parseInt(teacherId));
        const freshHolidays = await ipcRenderer.invoke('get-holidays-for-dtr', currentMonth, currentYear);
        displayTeacherLogs(freshLogs, teacherId, currentMonth, currentYear, freshSchedule, freshHolidays);
      }
    });
  });

  // Bulk delete: select all checkbox
  const selectAllCb = logsContainer.querySelector('#select-all-days');
  const toolbar = logsContainer.querySelector('#bulk-delete-toolbar');
  const countSpan = logsContainer.querySelector('#bulk-delete-count');
  const bulkDeleteBtn = logsContainer.querySelector('#btn-bulk-delete');
  const dayCheckboxes = logsContainer.querySelectorAll('.day-checkbox');

  function updateBulkToolbar() {
    const checked = logsContainer.querySelectorAll('.day-checkbox:checked').length;
    if (checked > 0) {
      toolbar.style.display = 'flex';
      countSpan.textContent = `${checked} day${checked > 1 ? 's' : ''} selected`;
    } else {
      toolbar.style.display = 'none';
    }
    // Sync select-all state
    const total = logsContainer.querySelectorAll('.day-checkbox:not(:disabled)').length;
    selectAllCb.checked = total > 0 && checked === total;
    selectAllCb.indeterminate = checked > 0 && checked < total;
  }

  selectAllCb.addEventListener('change', () => {
    dayCheckboxes.forEach(cb => { if (!cb.disabled) cb.checked = selectAllCb.checked; });
    updateBulkToolbar();
  });

  dayCheckboxes.forEach(cb => {
    cb.addEventListener('change', updateBulkToolbar);
  });

  // Bulk delete button
  bulkDeleteBtn.addEventListener('click', async () => {
    const selectedDays = [];
    logsContainer.querySelectorAll('.day-checkbox:checked').forEach(cb => {
      selectedDays.push(parseInt(cb.getAttribute('data-day')));
    });
    if (selectedDays.length === 0) return;

    const dayWord = selectedDays.length > 1 ? 'days' : 'day';
    if (await showConfirm(`Are you sure you want to delete all logs for ${selectedDays.length} selected ${dayWord}?`)) {
      for (const day of selectedDays) {
        const dayLogs = logsByDay[day];
        if (!dayLogs) continue;
        for (const log of dayLogs) {
          await ipcRenderer.invoke('delete-attendance-log', log.id);
        }
      }
      showToast('Logs deleted successfully');
      const freshLogs = await ipcRenderer.invoke('get-attendance', parseInt(teacherId), currentMonth, currentYear);
      const freshSchedule = await ipcRenderer.invoke('get-effective-schedule', parseInt(teacherId));
      const freshHolidays = await ipcRenderer.invoke('get-holidays-for-dtr', currentMonth, currentYear);
      displayTeacherLogs(freshLogs, teacherId, currentMonth, currentYear, freshSchedule, freshHolidays);
    }
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
      
      // Classification logic matching displayTeacherLogs/dtrGenerator
      if (mins < 660) { // Before 11:00 AM
        if (log.log_type === 'Check-in') { logsMap['AM In'] = log; }
      }
      
      if (mins >= 660 && mins < 750) { // 11:00 AM to 12:30 PM
        if (log.log_type === 'Check-out') { logsMap['AM Out'] = log; }
        else if (log.log_type === 'Check-in' && !logsMap['AM In']) { logsMap['AM In'] = log; }
      }

      if (mins >= 750 && mins < 900) { // 12:30 PM to 3:00 PM
        if (log.log_type === 'Check-in') { logsMap['PM In'] = log; }
        else if (log.log_type === 'Check-out' && !logsMap['AM Out']) { logsMap['AM Out'] = log; }
      }

      if (mins >= 900) { // After 3:00 PM
        if (log.log_type === 'Check-out') { logsMap['PM Out'] = log; }
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
          const freshSchedule = await ipcRenderer.invoke('get-effective-schedule', parseInt(teacherId));
          const freshHolidays = await ipcRenderer.invoke('get-holidays-for-dtr', currentMonth, currentYear);
          displayTeacherLogs(freshLogs, teacherId, currentMonth, currentYear, freshSchedule, freshHolidays);
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
  // ── Time Schedule ───────────────────────────────────────
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

  // ── Holidays / Class Suspensions ────────────────────────
  const holidayDateInput = document.getElementById('holiday-date');
  const holidayTypeSelect = document.getElementById('holiday-type');
  const holidayDescInput = document.getElementById('holiday-description');
  const holidayHalfDayCheck = document.getElementById('holiday-half-day');
  const holidayHalfDayPeriods = document.getElementById('holiday-half-day-periods');
  const holidayMonthFilter = document.getElementById('holiday-month-filter');
  const btnAddHoliday = document.getElementById('btn-add-holiday');
  const btnRefreshHolidays = document.getElementById('btn-refresh-holidays');
  const holidaysListContainer = document.getElementById('holidays-list-container');

  // Set default date to today
  const today = new Date();
  holidayDateInput.value = today.toISOString().split('T')[0];
  holidayMonthFilter.value = today.toISOString().slice(0, 7);

  // Toggle half-day period radio buttons
  holidayHalfDayCheck.addEventListener('change', () => {
    holidayHalfDayPeriods.style.display = holidayHalfDayCheck.checked ? 'flex' : 'none';
  });

  // Load holidays
  async function loadHolidays() {
    const filterVal = holidayMonthFilter.value;
    let holidays;
    if (filterVal) {
      const [year, month] = filterVal.split('-');
      holidays = await ipcRenderer.invoke('get-holidays', parseInt(month), year);
    } else {
      holidays = await ipcRenderer.invoke('get-holidays');
    }

    if (holidays.length === 0) {
      holidaysListContainer.innerHTML = '<p style="color:var(--text-muted);font-size:13px;font-style:italic;">No holidays or class suspensions set for this month.</p>';
      return;
    }

    let html = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:var(--surface-alt);">
        <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Date</th>
        <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Type</th>
        <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Period</th>
        <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Description</th>
        <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);"></th>
      </tr></thead><tbody>`;

    holidays.forEach(h => {
      const dateStr = new Date(h.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
      const typeLabel = h.type === 'holiday' ? '🎉 Holiday' : '⚠️ Suspension';
      const periodLabel = h.is_half_day ? `Half-day (${h.half_day_period})` : 'Full day';
      const typeColor = h.type === 'holiday' ? '#d97706' : '#db2777';
      const typeBg = h.type === 'holiday' ? 'rgba(217,119,6,0.1)' : 'rgba(219,39,119,0.1)';
      
      html += `<tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px;font-weight:500;">${dateStr}</td>
        <td style="padding:8px;"><span style="padding:3px 8px;border-radius:12px;font-size:11px;font-weight:600;color:${typeColor};background:${typeBg};">${typeLabel}</span></td>
        <td style="padding:8px;color:var(--text-muted);">${periodLabel}</td>
        <td style="padding:8px;color:var(--text-muted);">${h.description || '—'}</td>
        <td style="padding:8px;text-align:center;">
          <button class="btn-delete-holiday" data-id="${h.id}" style="padding:4px 10px;background:rgba(239,68,68,0.1);color:var(--danger);border:1px solid rgba(239,68,68,0.2);border-radius:4px;cursor:pointer;font-size:11px;">Delete</button>
        </td>
      </tr>`;
    });

    html += '</tbody></table>';
    holidaysListContainer.innerHTML = html;

    // Attach delete handlers
    holidaysListContainer.querySelectorAll('.btn-delete-holiday').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-id'));
        const confirmed = await showConfirm('Delete this holiday/suspension?');
        if (!confirmed) return;
        const res = await ipcRenderer.invoke('delete-holiday', id);
        if (res.success) {
          showToast('Deleted successfully');
          loadHolidays();
        } else {
          showToast('Error: ' + res.message);
        }
      });
    });
  }

  // Add holiday
  btnAddHoliday.addEventListener('click', async () => {
    const date = holidayDateInput.value;
    if (!date) {
      showToast('Please select a date');
      return;
    }

    const type = holidayTypeSelect.value;
    const description = holidayDescInput.value.trim();
    const is_half_day = holidayHalfDayCheck.checked;
    const halfDayRadios = document.querySelectorAll('input[name="half-day-period"]');
    let half_day_period = null;
    if (is_half_day) {
      for (const radio of halfDayRadios) {
        if (radio.checked) {
          half_day_period = radio.value;
          break;
        }
      }
    }

    const res = await ipcRenderer.invoke('add-holiday', { date, type, description, is_half_day, half_day_period });
    if (res.success) {
      showToast(`${type === 'holiday' ? 'Holiday' : 'Suspension'} added for ${date}`);
      holidayDescInput.value = '';
      holidayHalfDayCheck.checked = false;
      holidayHalfDayPeriods.style.display = 'none';
      loadHolidays();
    } else {
      showToast('Error: ' + res.message);
    }
  });

  btnRefreshHolidays.addEventListener('click', loadHolidays);

  // Initial load
  loadHolidays();
}

let appVersion = '1.0.0';

function setupAboutView() {
  ipcRenderer.invoke('get-app-version').then(v => {
    appVersion = v;
    const el = document.getElementById('about-version');
    if (el) el.textContent = v;
  });

  ipcRenderer.invoke('check-license').then(res => {
    const el = document.getElementById('about-license');
    if (el && res.activated) {
      el.textContent = '✓ Activated (' + res.licenseKey.substring(0, 8) + '...)';
      el.style.color = 'var(--success)';
    } else if (el) {
      el.textContent = 'Not activated';
      el.style.color = '#ef4444';
    }
  });

  const btnCheck = document.getElementById('btn-about-check-updates');
  const btnDownload = document.getElementById('btn-about-download-update');
  const btnInstall = document.getElementById('btn-about-install-update');
  const statusText = document.getElementById('about-update-status');
  const progressContainer = document.getElementById('about-update-progress');
  const progressBar = document.getElementById('about-progress-bar');
  const progressPercent = document.getElementById('about-progress-percent');

  ipcRenderer.on('update-status', (event, { status, data }) => {
    if (status === 'checking') {
      statusText.textContent = 'Checking for updates...';
      btnCheck.disabled = true;
    } else if (status === 'available') {
      statusText.textContent = `Update v${data.version} available`;
      btnCheck.style.display = 'none';
      btnDownload.style.display = '';
      progressContainer.style.display = 'none';
    } else if (status === 'not-available') {
      statusText.textContent = `You're on the latest version (v${appVersion}).`;
      btnCheck.disabled = false;
    } else if (status === 'downloading') {
      progressContainer.style.display = '';
      const pct = Math.round(data.percent);
      progressBar.style.width = pct + '%';
      progressPercent.textContent = pct + '%';
      statusText.textContent = 'Downloading...';
      btnDownload.disabled = true;
    } else if (status === 'downloaded') {
      statusText.textContent = 'Update ready. Restart to install.';
      progressContainer.style.display = 'none';
      btnDownload.style.display = 'none';
      btnInstall.style.display = '';
    } else if (status === 'error') {
      statusText.textContent = 'Error: ' + data;
      statusText.style.color = '#ef4444';
      btnCheck.disabled = false;
      btnCheck.style.display = '';
      btnDownload.style.display = 'none';
      btnInstall.style.display = 'none';
      progressContainer.style.display = 'none';
    }
  });

  btnCheck.addEventListener('click', () => ipcRenderer.invoke('check-for-updates'));
  btnDownload.addEventListener('click', () => {
    statusText.textContent = 'Starting download...';
    ipcRenderer.invoke('download-update');
  });
  btnInstall.addEventListener('click', () => ipcRenderer.invoke('install-update'));
}

function setupSettingsView() {
  // Get app version from main process
  ipcRenderer.invoke('get-app-version').then(v => { appVersion = v; });
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

  // ─── Update Management ──────────────────────────────────────
  const btnCheck = document.getElementById('btn-check-updates');
  const btnDownload = document.getElementById('btn-download-update');
  const btnInstall = document.getElementById('btn-install-update');
  const statusText = document.getElementById('update-status-text');
  const progressContainer = document.getElementById('update-progress-container');
  const progressBar = document.getElementById('update-progress-bar');
  const progressPercent = document.getElementById('update-progress-percent');

  ipcRenderer.on('update-status', (event, { status, data }) => {
    if (status === 'checking') {
      statusText.textContent = 'Checking for updates...';
      btnCheck.disabled = true;
    } else if (status === 'available') {
      statusText.textContent = `Update v${data.version} is available (${data.releaseName || ''})`;
      btnCheck.style.display = 'none';
      btnDownload.style.display = '';
      progressContainer.style.display = 'none';
    } else if (status === 'not-available') {
      statusText.textContent = `You're on the latest version (v${appVersion}).`;
      btnCheck.disabled = false;
    } else if (status === 'downloading') {
      progressContainer.style.display = '';
      const pct = Math.round(data.percent);
      progressBar.style.width = pct + '%';
      progressPercent.textContent = pct + '%';
      statusText.textContent = 'Downloading update...';
      btnDownload.disabled = true;
    } else if (status === 'downloaded') {
      statusText.textContent = 'Update downloaded. Restart to install.';
      progressContainer.style.display = 'none';
      btnDownload.style.display = 'none';
      btnInstall.style.display = '';
    } else if (status === 'error') {
      statusText.textContent = 'Update error: ' + data;
      statusText.style.color = '#ef4444';
      btnCheck.disabled = false;
      btnCheck.style.display = '';
      btnDownload.style.display = 'none';
      btnInstall.style.display = 'none';
      progressContainer.style.display = 'none';
    }
  });

  btnCheck.addEventListener('click', () => {
    ipcRenderer.invoke('check-for-updates');
  });

  btnDownload.addEventListener('click', () => {
    statusText.textContent = 'Starting download...';
    ipcRenderer.invoke('download-update');
  });

  btnInstall.addEventListener('click', () => {
    ipcRenderer.invoke('install-update');
  });

  // ─── User management (admin only) ────────────────────────────
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
