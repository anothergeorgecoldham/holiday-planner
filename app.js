/* ── Holiday Planner App ── */

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

const storageKey = 'holiday-planner-v1';
const tripId = new URLSearchParams(location.search).get('trip');

let data = {};
let cloudEtag = null; // optimistic concurrency token
let currentUser = null;

/* ── Toast notifications ── */
function showToast(message, type = 'info', duration = 4000) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

/* ── Auth ── */
async function getUser() {
  try {
    const res = await fetch('/.auth/me');
    if (res.ok) {
      const authData = await res.json();
      if (authData.clientPrincipal) {
        return authData.clientPrincipal;
      }
    }
  } catch (e) {
    // Not authenticated or auth unavailable (local dev)
  }
  return null;
}

function renderAuthControls() {
  const container = document.getElementById('auth-controls');
  if (!container) return;

  if (currentUser) {
    container.innerHTML = `
      <span class="user-name">👤 ${currentUser.userDetails}</span>
      <a href="/.auth/logout" class="btn btn-ghost btn-sm">Logout</a>
    `;
  } else {
    container.innerHTML = `
      <a href="/.auth/login/github" class="btn btn-ghost btn-sm">Login with GitHub</a>
    `;
  }
}

/* ── Sync status ── */
function setSyncStatus(status, text) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.className = `sync-status ${status}`;
  const icons = { synced: '✓', syncing: '↻', error: '⚠' };
  el.textContent = `${icons[status] || ''} ${text}`;
}

/* ── Data loading ── */
async function loadData() {
  // Load from localStorage as immediate fallback
  try {
    data = JSON.parse(localStorage.getItem(storageKey)) || {};
  } catch (e) {
    data = {};
  }

  if (tripId) {
    setSyncStatus('syncing', 'Loading from cloud...');
    try {
      const res = await fetch(`/api/load?tripId=${encodeURIComponent(tripId)}`);
      if (res.ok) {
        const cloud = await res.json();
        data = cloud.data || {};
        cloudEtag = cloud.etag || null;
        localStorage.setItem(storageKey, JSON.stringify(data));
        setSyncStatus('synced', 'Synced');
      } else if (res.status === 401) {
        setSyncStatus('error', 'Login required');
        showToast('Please log in to access this trip.', 'warning');
      } else if (res.status === 403) {
        setSyncStatus('error', 'Access denied');
        showToast('You do not have access to this trip.', 'error');
      } else if (res.status === 404) {
        // New trip - start fresh
        data = {};
        cloudEtag = null;
        setSyncStatus('synced', 'New trip');
      } else {
        console.warn('Cloud load returned non-OK status:', res.status);
        setSyncStatus('error', 'Load failed');
      }
    } catch (e) {
      console.warn('Cloud load failed; using local data.', e);
      setSyncStatus('error', 'Offline');
    }
  }

  render();
}

/* ── Data saving ── */
async function save() {
  localStorage.setItem(storageKey, JSON.stringify(data));

  if (tripId) {
    setSyncStatus('syncing', 'Saving...');
    try {
      const body = { data };
      if (cloudEtag) {
        body.etag = cloudEtag;
      }

      const res = await fetch(`/api/save?tripId=${encodeURIComponent(tripId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        const result = await res.json();
        cloudEtag = result.etag || null;
        setSyncStatus('synced', 'Synced');
      } else if (res.status === 409) {
        setSyncStatus('error', 'Conflict');
        showToast('Someone else updated this trip. Please reload to get the latest version.', 'warning', 6000);
      } else if (res.status === 401) {
        setSyncStatus('error', 'Login required');
        showToast('Please log in to save changes.', 'warning');
      } else if (res.status === 403) {
        setSyncStatus('error', 'Access denied');
        showToast('You do not have permission to edit this trip.', 'error');
      } else {
        console.warn('Cloud save returned non-OK status:', res.status);
        setSyncStatus('error', 'Save failed');
      }
    } catch (e) {
      console.warn('Cloud save failed; local data preserved.', e);
      setSyncStatus('error', 'Offline');
    }
  }
}

/* ── Navigation ── */
const today = new Date();
let viewYear  = today.getFullYear();
let viewMonth = today.getMonth();

const yearSel = document.getElementById('year-select');
for (let y = today.getFullYear() - 2; y <= today.getFullYear() + 5; y++) {
  const opt = document.createElement('option');
  opt.value = y;
  opt.textContent = y;
  if (y === viewYear) opt.selected = true;
  yearSel.appendChild(opt);
}
yearSel.addEventListener('change', () => { viewYear = +yearSel.value; render(); });

document.getElementById('btn-prev').addEventListener('click', () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  syncYearSelect();
  render();
});

document.getElementById('btn-next').addEventListener('click', () => {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  syncYearSelect();
  render();
});

function syncYearSelect() {
  yearSel.value = viewYear;
}

/* ── Day popover ── */
let activePopover = null;
let popoverDateKey = null;

const DEFAULT_FIELD_ORDER = ['flights', 'accom', 'transit', 'activity', 'ref', 'notes'];

function closePopover() {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
    popoverDateKey = null;
  }
}

function showPopover(dateKey, label, cellEl) {
  // If tapping same cell again, open modal
  if (popoverDateKey === dateKey) {
    closePopover();
    openModal(dateKey, label);
    return;
  }

  closePopover();
  popoverDateKey = dateKey;

  const entry = data[dateKey] || {};
  const hasContent = entry.flyOut || entry.flyIn ||
    entry.accom || entry.transit || entry.activity || entry.ref || entry.notes;

  // If no content, skip straight to modal
  if (!hasContent) {
    popoverDateKey = null;
    openModal(dateKey, label);
    return;
  }

  const popover = document.createElement('div');
  popover.className = 'day-popover';

  // Header
  const header = document.createElement('div');
  header.className = 'popover-header';
  const dateTitle = document.createElement('span');
  dateTitle.className = 'popover-date';
  dateTitle.textContent = label;
  const editBtn = document.createElement('button');
  editBtn.className = 'popover-edit';
  editBtn.textContent = '✎ Edit';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closePopover();
    openModal(dateKey, label);
  });
  header.appendChild(dateTitle);
  header.appendChild(editBtn);
  popover.appendChild(header);

  // Tags (full text, no truncation) — in field order
  renderFieldTags(entry, popover);
  if (entry.notes) {
    const notesEl = document.createElement('div');
    notesEl.className = 'tag';
    notesEl.style.cssText = 'white-space:normal;color:var(--muted);font-size:0.75rem;';
    notesEl.textContent = '📝 ' + entry.notes;
    popover.appendChild(notesEl);
  }

  document.body.appendChild(popover);
  activePopover = popover;

  // Position relative to cell
  const rect = cellEl.getBoundingClientRect();
  const popRect = popover.getBoundingClientRect();
  let top = rect.bottom + 6;
  let left = rect.left + (rect.width / 2) - (popRect.width / 2);

  // Keep within viewport
  if (top + popRect.height > window.innerHeight - 12) {
    top = rect.top - popRect.height - 6;
  }
  if (left < 8) left = 8;
  if (left + popRect.width > window.innerWidth - 8) {
    left = window.innerWidth - popRect.width - 8;
  }

  popover.style.top = top + 'px';
  popover.style.left = left + 'px';
}

// Close popover when clicking outside
document.addEventListener('click', (e) => {
  if (activePopover && !activePopover.contains(e.target) && !e.target.closest('.day-cell')) {
    closePopover();
  }
});

/* ── Modal state ── */
let activeKey = null;

const overlay  = document.getElementById('modal-overlay');
const fFlyOut  = document.getElementById('field-fly-out');
const fFlyIn   = document.getElementById('field-fly-in');
const fAccom   = document.getElementById('field-accom');
const fTransit = document.getElementById('field-transit');
const fActivity= document.getElementById('field-activity');
const fRef     = document.getElementById('field-ref');
const fNotes   = document.getElementById('field-notes');

function openModal(dateKey, label) {
  closePopover();
  activeKey = dateKey;
  document.getElementById('modal-date-title').textContent = label;
  const d = data[dateKey] || {};
  fFlyOut.checked    = !!d.flyOut;
  fFlyIn.checked     = !!d.flyIn;
  fAccom.value       = d.accom    || '';
  fTransit.value     = d.transit  || '';
  fActivity.value    = d.activity || '';
  fRef.value         = d.ref      || '';
  fNotes.value       = d.notes    || '';
  setFieldOrder(d.fieldOrder);
  setupDragAndDrop();
  overlay.classList.add('open');
  fAccom.focus();
}

function closeModal() {
  overlay.classList.remove('open');
  activeKey = null;
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

document.getElementById('btn-save').addEventListener('click', async () => {
  if (!activeKey) return;
  const entry = {
    flyOut:   fFlyOut.checked,
    flyIn:    fFlyIn.checked,
    accom:    fAccom.value.trim(),
    transit:  fTransit.value.trim(),
    activity: fActivity.value.trim(),
    ref:      fRef.value.trim(),
    notes:    fNotes.value.trim(),
    fieldOrder: getFieldOrder(),
  };
  const hasContent = entry.flyOut || entry.flyIn ||
    entry.accom || entry.transit || entry.activity || entry.ref || entry.notes;
  if (hasContent) {
    data[activeKey] = entry;
  } else {
    delete data[activeKey];
  }
  await save();
  closeModal();
  render();
});

document.getElementById('btn-clear').addEventListener('click', async () => {
  if (!activeKey) return;
  delete data[activeKey];
  await save();
  closeModal();
  render();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

/* ── Field order rendering helper ── */
function renderFieldTags(entry, container) {
  const order = entry.fieldOrder || DEFAULT_FIELD_ORDER;
  order.forEach(field => {
    if (field === 'flights') {
      if (entry.flyOut) container.appendChild(tag('✈️ Fly out', 'tag-flight-out'));
      if (entry.flyIn)  container.appendChild(tag('🛬 Fly in',  'tag-flight-in'));
    } else if (field === 'accom' && entry.accom) {
      entry.accom.split('\n').filter(l => l.trim()).forEach(line => {
        container.appendChild(tag('🏨 ' + line.trim(), 'tag-accom'));
      });
    } else if (field === 'transit' && entry.transit) {
      entry.transit.split('\n').filter(l => l.trim()).forEach(line => {
        container.appendChild(tag('🚂 ' + line.trim(), 'tag-transit'));
      });
    } else if (field === 'activity' && entry.activity) {
      entry.activity.split('\n').filter(l => l.trim()).forEach(line => {
        container.appendChild(tag('🎯 ' + line.trim(), 'tag-activity'));
      });
    } else if (field === 'ref' && entry.ref) {
      entry.ref.split('\n').filter(l => l.trim()).forEach(line => {
        container.appendChild(tag('🔖 ' + line.trim(), 'tag-ref'));
      });
    }
  });
}

/* ── Modal drag-and-drop reordering ── */
function setupDragAndDrop() {
  const container = document.getElementById('modal-fields');
  if (!container) return;

  let draggedEl = null;

  container.querySelectorAll('.modal-field-wrapper').forEach(wrapper => {
    wrapper.setAttribute('draggable', 'true');

    wrapper.addEventListener('dragstart', (e) => {
      draggedEl = wrapper;
      wrapper.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', wrapper.dataset.field);
    });

    wrapper.addEventListener('dragend', () => {
      wrapper.classList.remove('dragging');
      container.querySelectorAll('.modal-field-wrapper').forEach(w => w.classList.remove('drag-over'));
      draggedEl = null;
    });

    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (wrapper !== draggedEl) {
        wrapper.classList.add('drag-over');
      }
    });

    wrapper.addEventListener('dragleave', () => {
      wrapper.classList.remove('drag-over');
    });

    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      wrapper.classList.remove('drag-over');
      if (draggedEl && draggedEl !== wrapper) {
        const allWrappers = [...container.querySelectorAll('.modal-field-wrapper')];
        const dragIdx = allWrappers.indexOf(draggedEl);
        const dropIdx = allWrappers.indexOf(wrapper);
        if (dragIdx < dropIdx) {
          container.insertBefore(draggedEl, wrapper.nextSibling);
        } else {
          container.insertBefore(draggedEl, wrapper);
        }
      }
    });

    // Touch support for mobile drag
    let touchStartY = 0;
    let touchClone = null;

    wrapper.querySelector('.drag-handle').addEventListener('touchstart', (e) => {
      e.preventDefault();
      draggedEl = wrapper;
      touchStartY = e.touches[0].clientY;
      wrapper.classList.add('dragging');
    });

    document.addEventListener('touchmove', (e) => {
      if (!draggedEl || draggedEl !== wrapper) return;
      const touch = e.touches[0];
      const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
      const targetWrapper = elemBelow?.closest('.modal-field-wrapper');
      container.querySelectorAll('.modal-field-wrapper').forEach(w => w.classList.remove('drag-over'));
      if (targetWrapper && targetWrapper !== draggedEl) {
        targetWrapper.classList.add('drag-over');
      }
    });

    document.addEventListener('touchend', () => {
      if (!draggedEl || draggedEl !== wrapper) return;
      const overEl = container.querySelector('.modal-field-wrapper.drag-over');
      if (overEl) {
        const allWrappers = [...container.querySelectorAll('.modal-field-wrapper')];
        const dragIdx = allWrappers.indexOf(draggedEl);
        const dropIdx = allWrappers.indexOf(overEl);
        if (dragIdx < dropIdx) {
          container.insertBefore(draggedEl, overEl.nextSibling);
        } else {
          container.insertBefore(draggedEl, overEl);
        }
      }
      container.querySelectorAll('.modal-field-wrapper').forEach(w => w.classList.remove('drag-over'));
      wrapper.classList.remove('dragging');
      draggedEl = null;
    });
  });
}

function getFieldOrder() {
  const container = document.getElementById('modal-fields');
  return [...container.querySelectorAll('.modal-field-wrapper')].map(w => w.dataset.field);
}

function setFieldOrder(order) {
  const container = document.getElementById('modal-fields');
  const wrappers = [...container.querySelectorAll('.modal-field-wrapper')];
  const byField = {};
  wrappers.forEach(w => { byField[w.dataset.field] = w; });
  (order || DEFAULT_FIELD_ORDER).forEach(field => {
    if (byField[field]) container.appendChild(byField[field]);
  });
}

/* ── Render ── */
function render() {
  document.getElementById('month-label').textContent =
    `${MONTHS[viewMonth]} ${viewYear}`;

  const cal = document.getElementById('calendar');
  cal.innerHTML = '';

  DAYS.forEach(d => {
    const h = document.createElement('div');
    h.className = 'day-header';
    h.textContent = d;
    cal.appendChild(h);
  });

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const startOffset = (firstDay + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  for (let i = 0; i < startOffset; i++) {
    const empty = document.createElement('div');
    empty.className = 'day-cell empty';
    cal.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const entry = data[dateKey] || {};

    const cell = document.createElement('div');
    cell.className = 'day-cell';

    const isToday = (d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear());
    if (isToday) cell.classList.add('today');
    if (entry.flyOut) cell.classList.add('fly-out');
    if (entry.flyIn)  cell.classList.add('fly-in');

    const num = document.createElement('div');
    num.className = 'day-num';
    num.textContent = d;
    cell.appendChild(num);

    renderFieldTags(entry, cell);

    const label = `${DAYS[(startOffset + d - 1) % 7]} ${d} ${MONTHS[viewMonth]} ${viewYear}`;
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      showPopover(dateKey, label, cell);
    });

    cal.appendChild(cell);
  }
}

function tag(text, cls) {
  const t = document.createElement('span');
  t.className = `tag ${cls}`;
  t.textContent = text;
  return t;
}

/* ── Import / Export ── */
const FILE_MAGIC = 'HPD1:';

function exportData() {
  const payload = FILE_MAGIC + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  const blob = new Blob([payload], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'holiday-planner.hpd';
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const raw = e.target.result.trim();
      if (!raw.startsWith(FILE_MAGIC)) throw new Error('Unrecognised file format.');
      const decoded = JSON.parse(decodeURIComponent(escape(atob(raw.slice(FILE_MAGIC.length)))));
      if (typeof decoded !== 'object' || decoded === null) throw new Error('Invalid data.');
      const existing = Object.keys(data).length;
      if (existing > 0) {
        const merge = confirm(
          `Import contains ${Object.keys(decoded).length} day(s).\n\n` +
          `OK → Merge with existing data (imported days overwrite conflicts)\n` +
          `Cancel → Replace all existing data`
        );
        if (merge) {
          Object.assign(data, decoded);
        } else {
          data = decoded;
        }
      } else {
        data = decoded;
      }
      await save();
      render();
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
}

document.getElementById('btn-export').addEventListener('click', exportData);

document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('file-input').value = '';
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', e => {
  if (e.target.files.length) importData(e.target.files[0]);
});

/* ── Share modal ── */
const shareOverlay = document.getElementById('share-overlay');
const shareBtn = document.getElementById('btn-share');
const shareLink = document.getElementById('share-link');
const membersList = document.getElementById('members-list');
const shareUsername = document.getElementById('share-username');

// Show share button only when viewing a shared trip
if (tripId) {
  shareBtn.style.display = '';
}

shareBtn.addEventListener('click', async () => {
  shareLink.value = window.location.href;
  shareOverlay.classList.add('open');
  await loadMembers();
});

document.getElementById('share-close').addEventListener('click', () => {
  shareOverlay.classList.remove('open');
});

shareOverlay.addEventListener('click', (e) => {
  if (e.target === shareOverlay) shareOverlay.classList.remove('open');
});

shareLink.addEventListener('click', () => {
  shareLink.select();
  navigator.clipboard.writeText(shareLink.value).then(() => {
    showToast('Link copied!', 'info', 2000);
  });
});

async function loadMembers() {
  if (!tripId) return;
  membersList.innerHTML = '<span style="color:var(--muted)">Loading...</span>';
  try {
    const res = await fetch(`/api/members?tripId=${encodeURIComponent(tripId)}`);
    if (res.ok) {
      const { members } = await res.json();
      renderMembers(members);
    } else {
      membersList.innerHTML = '<span style="color:var(--accent2)">Could not load members</span>';
    }
  } catch {
    membersList.innerHTML = '<span style="color:var(--accent2)">Failed to fetch members</span>';
  }
}

function renderMembers(members) {
  membersList.innerHTML = members.map(m =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);">
      <span>@${m}</span>
      <button class="btn btn-ghost btn-sm remove-member-btn" data-username="${m}" style="font-size:0.7rem;padding:2px 8px;">✕</button>
    </div>`
  ).join('');

  membersList.querySelectorAll('.remove-member-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const username = btn.dataset.username;
      if (!confirm(`Remove @${username} from this trip?`)) return;
      try {
        const res = await fetch(`/api/members?tripId=${encodeURIComponent(tripId)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        });
        if (res.ok) {
          const { members } = await res.json();
          renderMembers(members);
          showToast(`@${username} removed`, 'info', 2000);
        } else {
          const err = await res.json();
          showToast(err.error || 'Failed to remove', 'error');
        }
      } catch {
        showToast('Failed to remove member', 'error');
      }
    });
  });
}

document.getElementById('btn-add-member').addEventListener('click', async () => {
  const username = shareUsername.value.trim().replace(/^@/, '');
  if (!username) return;
  try {
    const res = await fetch(`/api/members?tripId=${encodeURIComponent(tripId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    if (res.ok) {
      const { members } = await res.json();
      renderMembers(members);
      shareUsername.value = '';
      showToast(`@${username} added!`, 'info', 2000);
    } else {
      const err = await res.json();
      showToast(err.error || 'Failed to add', 'error');
    }
  } catch {
    showToast('Failed to add member', 'error');
  }
});

shareUsername.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-add-member').click();
});

/* ── Trips Dashboard ── */
async function showDashboard() {
  const dashboard = document.getElementById('trips-dashboard');
  const calendar = document.getElementById('calendar');
  const legend = document.getElementById('legend');

  // Only show dashboard if logged in and no trip selected
  if (!currentUser || tripId) {
    dashboard.style.display = 'none';
    return;
  }

  dashboard.style.display = '';
  calendar.style.display = 'none';
  legend.style.display = 'none';

  const tripsList = document.getElementById('trips-list');
  tripsList.innerHTML = '<span style="color:var(--muted);font-size:0.85rem;">Loading trips...</span>';

  try {
    const res = await fetch('/api/trips');
    if (res.ok) {
      const { trips } = await res.json();
      if (trips.length === 0) {
        tripsList.innerHTML = '<span style="color:var(--muted);font-size:0.85rem;">No trips yet. Create one to get started!</span>';
      } else {
        tripsList.innerHTML = trips.map(t => `
          <div class="trip-card" data-trip-id="${t.tripId}">
            <div>
              <div class="trip-name">${t.name}</div>
              <div class="trip-meta">Updated ${new Date(t.updatedAt).toLocaleDateString()}</div>
            </div>
            <span style="color:var(--muted);font-size:1.2rem;">›</span>
          </div>
        `).join('');

        tripsList.querySelectorAll('.trip-card').forEach(card => {
          card.addEventListener('click', () => {
            window.location.href = `?trip=${card.dataset.tripId}`;
          });
        });
      }
    } else {
      tripsList.innerHTML = '<span style="color:var(--accent2);font-size:0.85rem;">Failed to load trips</span>';
    }
  } catch {
    tripsList.innerHTML = '<span style="color:var(--accent2);font-size:0.85rem;">Could not connect to server</span>';
  }
}

document.getElementById('btn-new-trip').addEventListener('click', async () => {
  const name = prompt('Trip name (e.g. "Vietnam 2026"):');
  if (!name || !name.trim()) return;

  try {
    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) {
      const { tripId: newTripId } = await res.json();
      window.location.href = `?trip=${newTripId}`;
    } else {
      const err = await res.json();
      showToast(err.error || 'Failed to create trip', 'error');
    }
  } catch {
    showToast('Failed to create trip', 'error');
  }
});

/* ── Init ── */
(async function init() {
  currentUser = await getUser();
  renderAuthControls();
  if (!tripId && currentUser) {
    await showDashboard();
  } else {
    await loadData();
  }
})();
