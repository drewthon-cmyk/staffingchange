// ─── Shared App Utilities ──────────────────────────────────────────────────────

const API = {
  async request(method, path, body = null, isFormData = false) {
    const token = localStorage.getItem('tc_token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (body && !isFormData) headers['Content-Type'] = 'application/json';

    const res = await fetch('/api' + path, {
      method,
      headers,
      body: isFormData ? body : (body ? JSON.stringify(body) : null),
    });

    if (res.status === 401) {
      localStorage.removeItem('tc_token');
      localStorage.removeItem('tc_user');
      location.href = '/';
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'An error occurred.');
    return data;
  },
  get: (path) => API.request('GET', path),
  post: (path, body) => API.request('POST', path, body),
  put: (path, body) => API.request('PUT', path, body),
  del: (path) => API.request('DELETE', path),
  upload: (path, formData) => API.request('POST', path, formData, true),
};

function getUser() {
  return JSON.parse(localStorage.getItem('tc_user') || 'null');
}

function requireAuth(allowedRoles = null) {
  const token = localStorage.getItem('tc_token');
  const user = getUser();
  if (!token || !user) { location.href = '/'; return null; }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    if (user.role === 'hr_admin') location.href = '/hr/dashboard.html';
    else if (user.role === 'principal') location.href = '/principal/dashboard.html';
    else location.href = '/dashboard.html';
    return null;
  }
  return user;
}

function logout() {
  localStorage.removeItem('tc_token');
  localStorage.removeItem('tc_user');
  location.href = '/';
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDatetime(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusLabel(status) {
  const map = {
    pending_sending_principal: { text: 'Awaiting Sending Principal', cls: 'badge-pending' },
    sending_denied:            { text: 'Denied by Sending Principal', cls: 'badge-denied' },
    pending_interview:         { text: 'Awaiting Interview Schedule', cls: 'badge-interview' },
    interview_scheduled:       { text: 'Interview Scheduled', cls: 'badge-interview' },
    pending_receiving_principal: { text: 'Awaiting Receiving Principal', cls: 'badge-pending' },
    receiving_denied:          { text: 'Denied by Receiving Principal', cls: 'badge-denied' },
    pending_hr:                { text: 'Awaiting HR Approval', cls: 'badge-hr' },
    hr_approved:               { text: 'Transfer Approved', cls: 'badge-approved' },
    hr_denied:                 { text: 'Denied by HR', cls: 'badge-denied' },
    position_filled:           { text: 'Position Filled', cls: 'badge-closed' },
  };
  const s = map[status] || { text: status, cls: 'badge-pending' };
  return `<span class="badge ${s.cls}">${s.text}</span>`;
}

function postingStatusBadge(status) {
  const map = { open: 'badge-open', filled: 'badge-filled', closed: 'badge-closed' };
  return `<span class="badge ${map[status] || 'badge-pending'}">${status.charAt(0).toUpperCase() + status.slice(1)}</span>`;
}

function showAlert(containerId, message, type = 'error') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.textContent = message;
  el.className = `alert alert-${type}`;
}

function hideAlert(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.className = 'alert hidden';
}

function initSidebar(user) {
  const toggle = document.querySelector('.sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');

  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay && overlay.classList.toggle('open');
    });
    overlay && overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
    });
  }

  // Set user info
  const nameEl = document.getElementById('sidebar-name');
  const roleEl = document.getElementById('sidebar-role');
  const avatarEl = document.getElementById('sidebar-avatar');
  if (nameEl && user) nameEl.textContent = user.name || user.email;
  if (roleEl && user) roleEl.textContent = user.role === 'hr_admin' ? 'HR Administrator' : user.role === 'principal' ? 'Administrator / Principal' : 'Employee';
  if (avatarEl && user) avatarEl.textContent = (user.name || user.email)[0].toUpperCase();

  // Active nav
  const currentPath = location.pathname;
  document.querySelectorAll('.nav-item').forEach(a => {
    if (a.getAttribute('href') === currentPath) a.classList.add('active');
  });
}

// Modal helpers
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
  if (e.target.classList.contains('modal-close')) {
    const modal = e.target.closest('.modal-overlay');
    if (modal) modal.classList.remove('open');
  }
});

// Build status tracker HTML
function buildTracker(app) {
  const steps = [
    {
      label: 'Application\nSubmitted',
      icon: '📋',
      state: 'complete',
      date: app.applied_date ? formatDate(app.applied_date) : null,
    },
    {
      label: 'Sending Principal\nApproval',
      icon: '👤',
      state: app.sending_decision === 'approved' ? 'complete'
           : app.sending_decision === 'denied' ? 'denied'
           : (app.status === 'pending_sending_principal' ? 'active' : 'complete'),
      date: app.sending_date ? formatDate(app.sending_date) : null,
      note: app.sending_decision === 'denied' ? 'Denied' : app.sending_decision === 'approved' ? 'Approved' : '',
    },
    {
      label: 'Interview\nScheduled',
      icon: '📅',
      state: ['pending_sending_principal','sending_denied'].includes(app.status) ? ''
           : app.interview_date ? 'complete'
           : (app.status === 'pending_interview' ? 'active' : (app.status === 'interview_scheduled' ? 'active' : '')),
      date: app.interview_date ? formatDate(app.interview_date) : null,
    },
    {
      label: 'Receiving Principal\nDecision',
      icon: '🏫',
      state: app.receiving_decision === 'approved' ? 'complete'
           : app.receiving_decision === 'denied' ? 'denied'
           : (['pending_hr','hr_approved','hr_denied'].includes(app.status) ? 'complete'
           : (['pending_interview','interview_scheduled'].includes(app.status) ? 'active' : '')),
      date: app.receiving_date ? formatDate(app.receiving_date) : null,
      note: app.receiving_decision === 'denied' ? 'Denied' : app.receiving_decision === 'approved' ? 'Approved' : '',
    },
    {
      label: 'HR Final\nApproval',
      icon: '✅',
      state: app.hr_decision === 'approved' ? 'complete'
           : app.hr_decision === 'denied' ? 'denied'
           : (app.status === 'pending_hr' ? 'active' : ''),
      date: app.hr_date ? formatDate(app.hr_date) : null,
      note: app.hr_decision === 'denied' ? 'Denied' : app.hr_decision === 'approved' ? 'Approved' : '',
    },
  ];

  return `<div class="status-tracker">` + steps.map(s => `
    <div class="tracker-step ${s.state}">
      <div class="tracker-dot">${s.state === 'complete' ? '✓' : s.state === 'denied' ? '✗' : s.icon}</div>
      <div>
        <div class="tracker-label">${s.label.replace('\n', '<br>')}</div>
        ${s.note ? `<div class="tracker-date" style="font-weight:600">${s.note}</div>` : ''}
        ${s.date ? `<div class="tracker-date">${s.date}</div>` : ''}
      </div>
    </div>
  `).join('') + `</div>`;
}
