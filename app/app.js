/* ── Holiday Planner App ── */

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

const storageKey = 'holiday-planner-v1';
const tripId = new URLSearchParams(location.search).get('trip');

let data = {};
let cloudEtag = null; // optimistic concurrency token
let currentUser = null;
let currentTripName = null;

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
      <a href="/.auth/logout?post_logout_redirect_uri=/logged-out.html" class="btn btn-ghost btn-sm">Logout</a>
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

function renderCurrentTrip() {
  const el = document.getElementById('current-trip');
  if (!el) return;

  if (!tripId) {
    el.style.display = 'none';
    el.replaceChildren();
    return;
  }

  el.style.display = '';
  el.replaceChildren();

  const name = document.createElement('strong');
  name.textContent = currentTripName || 'Loading trip...';

  const id = document.createElement('span');
  id.className = 'trip-id';
  id.textContent = tripId;

  const back = document.createElement('button');
  back.className = 'btn btn-ghost btn-sm';
  back.type = 'button';
  back.textContent = 'My Trips';
  back.addEventListener('click', () => {
    window.location.href = window.location.pathname;
  });

  el.append('🧳 ', name, id, back);
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
    renderCurrentTrip();
    setSyncStatus('syncing', 'Loading from cloud...');
    try {
      const res = await fetch(`/api/load?tripId=${encodeURIComponent(tripId)}`);
      if (res.ok) {
        const cloud = await res.json();
        currentTripName = cloud.name || tripId;
        data = cloud.data || {};
        cloudEtag = cloud.etag || null;
        localStorage.setItem(storageKey, JSON.stringify(data));
        renderCurrentTrip();
        setSyncStatus('synced', 'Synced');
      } else if (res.status === 401) {
        setSyncStatus('error', 'Login required');
        showToast('Please log in to access this trip.', 'warning');
      } else if (res.status === 403) {
        currentTripName = 'Access denied';
        renderCurrentTrip();
        setSyncStatus('error', 'Access denied');
        showToast('You do not have access to this trip.', 'error');
      } else if (res.status === 404) {
        // New trip - start fresh
        currentTripName = tripId;
        data = {};
        cloudEtag = null;
        renderCurrentTrip();
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

  showFirstPlanMonth();
  render();
}

/* ── Data saving ── */
async function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch (error) {
    console.warn('Local save failed.', error);
    showToast('This device could not save your changes. Free some browser storage and try again.', 'error', 6000);
    return false;
  }

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
        return true;
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
      return false;
    } catch (e) {
      console.warn('Cloud save failed; local data preserved.', e);
      setSyncStatus('error', 'Offline');
      showToast('Saved on this device, but the trip is offline. Reconnect and save again to sync.', 'warning', 6000);
      return false;
    }
  }
  return true;
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
  ensureYearOption(viewYear);
  yearSel.value = viewYear;
}

function ensureYearOption(year) {
  if ([...yearSel.options].some(option => Number(option.value) === year)) return;
  const option = document.createElement('option');
  option.value = year;
  option.textContent = year;
  yearSel.appendChild(option);
  [...yearSel.options]
    .sort((a, b) => Number(a.value) - Number(b.value))
    .forEach(existing => yearSel.appendChild(existing));
}

function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function hasLegacyDayContent(entry) {
  return !!(entry && typeof entry === 'object' && (
    entry.flyOut || entry.flyIn || entry.accom || entry.transit ||
    entry.activity || entry.ref || entry.notes
  ));
}

function getFirstPlanDate() {
  const dates = Object.entries(data)
    .filter(([dateKey, entry]) => isValidDateKey(dateKey) && hasLegacyDayContent(entry))
    .map(([dateKey]) => dateKey);

  getItinerary().forEach(item => {
    const dateKey = item.type === 'activity' ? item.date : item.startDate;
    if (isValidDateKey(dateKey)) dates.push(dateKey);
  });

  return dates.sort()[0] || null;
}

function showFirstPlanMonth() {
  const firstDate = getFirstPlanDate();
  if (!firstDate) return;
  const [year, month] = firstDate.split('-').map(Number);
  viewYear = year;
  viewMonth = month - 1;
  syncYearSelect();
}

/* ── Itinerary data and editors ── */
const ITINERARY_KEY = '_itinerary';
const DEFAULT_FIELD_ORDER = ['flights', 'accom', 'transit', 'activity', 'ref', 'notes'];
const TYPE_LABELS = { stay: 'Stay', transport: 'Transport', activity: 'Activity' };
const MODE_LABELS = { flight: 'Flight', train: 'Train', bus: 'Bus', ferry: 'Ferry', car: 'Car' };

let activeKey = null;

const agendaDialog = document.getElementById('agenda-dialog');
const entryDialog = document.getElementById('entry-dialog');
const entryForm = document.getElementById('entry-form');
const fFlyOut = document.getElementById('field-fly-out');
const fFlyIn = document.getElementById('field-fly-in');
const fAccom = document.getElementById('field-accom');
const fTransit = document.getElementById('field-transit');
const fActivity = document.getElementById('field-activity');
const fRef = document.getElementById('field-ref');
const fNotes = document.getElementById('field-notes');

function getItinerary() {
  if (!Array.isArray(data[ITINERARY_KEY])) data[ITINERARY_KEY] = [];
  return data[ITINERARY_KEY];
}

function parseDateKey(dateKey) {
  return new Date(`${dateKey}T12:00:00`);
}

function formatDateKey(dateKey) {
  if (!dateKey) return '';
  return parseDateKey(dateKey).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(value) {
  if (!value) return '';
  const [hours, minutes] = value.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function itemOccursOn(item, dateKey) {
  if (item.type === 'stay') {
    return item.startDate <= dateKey && item.endDate >= dateKey;
  }
  if (item.type === 'transport') {
    return item.startDate === dateKey || (item.endDate && item.endDate !== item.startDate && item.endDate === dateKey);
  }
  return item.date === dateKey;
}

function itemsForDate(dateKey) {
  return getItinerary()
    .filter(item => itemOccursOn(item, dateKey))
    .sort((a, b) => {
      if (a.type === 'stay' && b.type !== 'stay') return -1;
      if (a.type !== 'stay' && b.type === 'stay') return 1;
      const aTime = a.startTime || '';
      const bTime = b.startTime || '';
      return aTime.localeCompare(bTime) || String(a.name || '').localeCompare(String(b.name || ''));
    });
}

function openAgenda(dateKey, label = formatDateKey(dateKey)) {
  activeKey = dateKey;
  document.getElementById('agenda-date-title').textContent = label;

  const legacy = data[dateKey] || {};
  fFlyOut.checked = !!legacy.flyOut;
  fFlyIn.checked = !!legacy.flyIn;
  fAccom.value = legacy.accom || '';
  fTransit.value = legacy.transit || '';
  fActivity.value = legacy.activity || '';
  fRef.value = legacy.ref || '';
  fNotes.value = legacy.notes || '';

  const hasLegacy = legacy.flyOut || legacy.flyIn || legacy.accom ||
    legacy.transit || legacy.activity || legacy.ref || legacy.notes;
  document.getElementById('legacy-notes').open = !!hasLegacy;
  renderAgenda();
  agendaDialog.showModal();
}

function renderAgenda() {
  const container = document.getElementById('agenda-items');
  const items = itemsForDate(activeKey);
  container.replaceChildren();

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'agenda-empty';
    empty.textContent = 'Nothing planned yet. Add a stay, journey, or activity.';
    container.appendChild(empty);
    return;
  }

  items.forEach(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'agenda-item';

    const time = document.createElement('span');
    time.className = 'agenda-item-time';
    if (item.type === 'stay') {
      if (activeKey === item.startDate) time.textContent = item.startTime ? `Check in ${formatTime(item.startTime)}` : 'Check in';
      else if (activeKey === item.endDate) time.textContent = item.endTime ? `Check out ${formatTime(item.endTime)}` : 'Check out';
      else time.textContent = 'Staying';
    } else if (item.type === 'transport' && activeKey === item.endDate && item.endDate !== item.startDate) {
      time.textContent = item.endTime ? `Arrive ${formatTime(item.endTime)}` : 'Arrive';
    } else {
      time.textContent = formatTime(item.startTime) || 'Any time';
    }

    const detail = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'agenda-item-name';
    name.textContent = item.name;
    const type = document.createElement('span');
    type.className = 'agenda-item-type';
    type.textContent = item.type === 'transport' ? MODE_LABELS[item.mode] || 'Transport' : TYPE_LABELS[item.type];
    detail.append(name, type);

    const arrow = document.createElement('span');
    arrow.className = 'agenda-item-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '›';

    button.append(time, detail, arrow);
    button.addEventListener('click', () => {
      agendaDialog.close();
      openEntry(item.type, activeKey, item);
    });
    container.appendChild(button);
  });
}

function setEntryType(type) {
  document.getElementById('entry-type').value = type;
  document.getElementById('entry-title').textContent = `${document.getElementById('entry-id').value ? 'Edit' : 'Add'} ${type === 'activity' ? 'an activity' : `a ${type}`}`;
  document.querySelectorAll('[data-entry-fields]').forEach(fields => {
    fields.classList.toggle('active', fields.dataset.entryFields === type);
  });
  document.getElementById('entry-address-label').textContent =
    type === 'activity' ? 'Location or address' : type === 'transport' ? 'Meeting point or address' : 'Address';
}

function openEntry(type, dateKey, item = null) {
  activeKey = dateKey;
  entryForm.reset();
  document.getElementById('entry-form-error').textContent = '';
  document.getElementById('entry-name-error').textContent = '';
  document.getElementById('entry-id').value = item?.id || '';
  document.getElementById('entry-kicker').textContent = item ? 'Plan details' : 'New plan';
  document.getElementById('btn-delete-entry').style.display = item ? '' : 'none';
  setEntryType(type);

  document.getElementById('entry-name').value = item?.name || '';
  document.getElementById('entry-address').value = item?.address || '';
  document.getElementById('entry-booking-ref').value = item?.bookingRef || '';
  document.getElementById('entry-notes').value = item?.notes || '';

  if (type === 'stay') {
    document.getElementById('stay-start-date').value = item?.startDate || dateKey;
    document.getElementById('stay-start-time').value = item?.startTime || '';
    document.getElementById('stay-end-date').value = item?.endDate || dateKey;
    document.getElementById('stay-end-time').value = item?.endTime || '';
  } else if (type === 'transport') {
    document.getElementById('transport-mode').value = item?.mode || 'flight';
    document.getElementById('transport-number').value = item?.serviceNumber || '';
    document.getElementById('transport-start-date').value = item?.startDate || dateKey;
    document.getElementById('transport-start-time').value = item?.startTime || '';
    document.getElementById('transport-end-date').value = item?.endDate || dateKey;
    document.getElementById('transport-end-time').value = item?.endTime || '';
    document.getElementById('transport-from').value = item?.from || '';
    document.getElementById('transport-to').value = item?.to || '';
    document.getElementById('transport-start-terminal').value = item?.startTerminal || '';
    document.getElementById('transport-end-terminal').value = item?.endTerminal || '';
    updateTransportFields();
  } else {
    document.getElementById('activity-date').value = item?.date || dateKey;
    document.getElementById('activity-start-time').value = item?.startTime || '';
    document.getElementById('activity-end-time').value = item?.endTime || '';
  }

  entryDialog.showModal();
  document.getElementById('entry-name').focus();
}

function updateTransportFields() {
  const mode = document.getElementById('transport-mode').value;
  const labels = {
    flight: ['Flight number', 'Departure airport', 'Arrival airport'],
    train: ['Train or service number', 'Departure station', 'Arrival station'],
    bus: ['Bus or route number', 'Departure stop', 'Arrival stop'],
    ferry: ['Ferry or service number', 'Departure port', 'Arrival port'],
    car: ['Reservation number', 'Pickup location', 'Drop-off location'],
  };
  const [number, from, to] = labels[mode];
  document.getElementById('transport-number-label').textContent = number;
  document.getElementById('transport-from-label').textContent = from;
  document.getElementById('transport-to-label').textContent = to;
  document.querySelectorAll('.transport-terminal').forEach(field => {
    field.style.display = mode === 'flight' ? '' : 'none';
  });
}

function buildEntryFromForm() {
  const type = document.getElementById('entry-type').value;
  const item = {
    id: document.getElementById('entry-id').value ||
      (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `plan-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    type,
    name: document.getElementById('entry-name').value.trim(),
    address: document.getElementById('entry-address').value.trim(),
    bookingRef: document.getElementById('entry-booking-ref').value.trim(),
    notes: document.getElementById('entry-notes').value.trim(),
  };

  if (type === 'stay') {
    Object.assign(item, {
      startDate: document.getElementById('stay-start-date').value,
      startTime: document.getElementById('stay-start-time').value,
      endDate: document.getElementById('stay-end-date').value,
      endTime: document.getElementById('stay-end-time').value,
    });
  } else if (type === 'transport') {
    const mode = document.getElementById('transport-mode').value;
    Object.assign(item, {
      mode,
      serviceNumber: document.getElementById('transport-number').value.trim(),
      startDate: document.getElementById('transport-start-date').value,
      startTime: document.getElementById('transport-start-time').value,
      endDate: document.getElementById('transport-end-date').value,
      endTime: document.getElementById('transport-end-time').value,
      from: document.getElementById('transport-from').value.trim(),
      to: document.getElementById('transport-to').value.trim(),
      startTerminal: mode === 'flight' ? document.getElementById('transport-start-terminal').value.trim() : '',
      endTerminal: mode === 'flight' ? document.getElementById('transport-end-terminal').value.trim() : '',
    });
  } else {
    Object.assign(item, {
      date: document.getElementById('activity-date').value,
      startTime: document.getElementById('activity-start-time').value,
      endTime: document.getElementById('activity-end-time').value,
    });
  }
  return item;
}

function validateEntry(item) {
  const nameInput = document.getElementById('entry-name');
  nameInput.removeAttribute('aria-invalid');
  document.getElementById('entry-name-error').textContent = '';
  document.getElementById('entry-form-error').textContent = '';

  if (!item.name) {
    nameInput.setAttribute('aria-invalid', 'true');
    document.getElementById('entry-name-error').textContent = 'Please enter a name for this plan.';
    nameInput.focus();
    return false;
  }

  const requiredDate = item.type === 'activity' ? item.date : item.startDate;
  if (!requiredDate || (item.type === 'stay' && !item.endDate)) {
    document.getElementById('entry-form-error').textContent = 'Please add the required date fields.';
    return false;
  }
  if (item.type === 'stay' && item.endDate < item.startDate) {
    document.getElementById('entry-form-error').textContent = 'Check-out cannot be before check-in.';
    return false;
  }
  if (item.type === 'transport' && item.endDate && item.endDate < item.startDate) {
    document.getElementById('entry-form-error').textContent = 'Arrival cannot be before departure.';
    return false;
  }
  const sameDayEndBeforeStart = item.startTime && item.endTime && item.endTime < item.startTime && (
    item.type === 'activity' ||
    (item.type === 'stay' && item.startDate === item.endDate) ||
    (item.type === 'transport' && (!item.endDate || item.startDate === item.endDate))
  );
  if (sameDayEndBeforeStart) {
    document.getElementById('entry-form-error').textContent = 'The end time cannot be before the start time on the same day.';
    return false;
  }
  return true;
}

document.getElementById('agenda-close').addEventListener('click', () => agendaDialog.close());
document.getElementById('entry-close').addEventListener('click', () => entryDialog.close());
document.getElementById('btn-cancel-entry').addEventListener('click', () => entryDialog.close());
document.getElementById('transport-mode').addEventListener('change', updateTransportFields);

document.querySelectorAll('[data-add-type]').forEach(button => {
  button.addEventListener('click', () => {
    agendaDialog.close();
    openEntry(button.dataset.addType, activeKey);
  });
});

document.getElementById('btn-save-day').addEventListener('click', async () => {
  if (!activeKey) return;
  const existing = data[activeKey] || {};
  const legacy = {
    flyOut: fFlyOut.checked,
    flyIn: fFlyIn.checked,
    accom: fAccom.value.trim(),
    transit: fTransit.value.trim(),
    activity: fActivity.value.trim(),
    ref: fRef.value.trim(),
    notes: fNotes.value.trim(),
    fieldOrder: existing.fieldOrder || DEFAULT_FIELD_ORDER,
  };
  const hasContent = legacy.flyOut || legacy.flyIn || legacy.accom ||
    legacy.transit || legacy.activity || legacy.ref || legacy.notes;
  if (hasContent) data[activeKey] = legacy;
  else delete data[activeKey];
  const saved = await save();
  if (!saved) return;
  render();
  showToast('Day notes saved.', 'info', 2200);
});

document.getElementById('btn-clear-day').addEventListener('click', async () => {
  if (!activeKey || !confirm('Clear the notes and older entries for this day? Structured plans will stay in place.')) return;
  delete data[activeKey];
  fFlyOut.checked = false;
  fFlyIn.checked = false;
  fAccom.value = '';
  fTransit.value = '';
  fActivity.value = '';
  fRef.value = '';
  fNotes.value = '';
  const saved = await save();
  if (!saved) return;
  render();
  showToast('Day notes cleared.', 'info', 2200);
});

entryForm.addEventListener('submit', async event => {
  event.preventDefault();
  const item = buildEntryFromForm();
  if (!validateEntry(item)) return;

  const itinerary = getItinerary();
  const existingIndex = itinerary.findIndex(existing => existing.id === item.id);
  if (existingIndex >= 0) itinerary[existingIndex] = item;
  else itinerary.push(item);

  const saveButton = document.getElementById('btn-save-entry');
  saveButton.disabled = true;
  saveButton.textContent = 'Saving...';
  const saved = await save();
  if (!saved) {
    saveButton.disabled = false;
    saveButton.textContent = 'Save plan';
    return;
  }
  saveButton.disabled = false;
  saveButton.textContent = 'Save plan';
  entryDialog.close();
  render();
  openAgenda(activeKey);
});

document.getElementById('btn-delete-entry').addEventListener('click', async () => {
  const id = document.getElementById('entry-id').value;
  if (!id || !confirm('Delete this plan? This cannot be undone.')) return;
  data[ITINERARY_KEY] = getItinerary().filter(item => item.id !== id);
  const saved = await save();
  if (!saved) return;
  entryDialog.close();
  render();
  openAgenda(activeKey);
  showToast('Plan deleted.', 'info', 2200);
});

/* ── Legacy day rendering ── */
function renderLegacyTags(entry, container) {
  const order = entry.fieldOrder || DEFAULT_FIELD_ORDER;
  order.forEach(field => {
    if (field === 'flights') {
      if (entry.flyOut) container.appendChild(tag('Flying out', 'tag-flight-out tag-legacy'));
      if (entry.flyIn) container.appendChild(tag('Flying in', 'tag-flight-in tag-legacy'));
    } else if (field === 'accom' && entry.accom) {
      entry.accom.split('\n').filter(Boolean).forEach(line => container.appendChild(tag(line.trim(), 'tag-accom tag-legacy')));
    } else if (field === 'transit' && entry.transit) {
      entry.transit.split('\n').filter(Boolean).forEach(line => container.appendChild(tag(line.trim(), 'tag-transit tag-legacy')));
    } else if (field === 'activity' && entry.activity) {
      entry.activity.split('\n').filter(Boolean).forEach(line => container.appendChild(tag(line.trim(), 'tag-activity tag-legacy')));
    } else if (field === 'ref' && entry.ref) {
      entry.ref.split('\n').filter(Boolean).forEach(line => container.appendChild(tag(line.trim(), 'tag-ref tag-legacy')));
    }
  });
}

function createItineraryTag(item, dateKey) {
  let text = item.name;
  let className = '';
  if (item.type === 'stay') {
    const dayIndex = (parseDateKey(dateKey).getDay() + 6) % 7;
    const segmentStart = item.startDate === dateKey || dayIndex === 0;
    const segmentEnd = item.endDate === dateKey || dayIndex === 6;
    className = `tag-stay${segmentStart ? ' segment-start' : ''}${segmentEnd ? ' segment-end' : ''}`;
    text = segmentStart ? item.name : '\u00a0';
  } else if (item.type === 'transport') {
    const isArrival = item.endDate && item.endDate !== item.startDate && item.endDate === dateKey;
    const time = isArrival ? item.endTime : item.startTime;
    text = `${time ? `${formatTime(time)} ` : ''}${isArrival ? 'Arrive: ' : ''}${item.name}`;
    className = 'tag-transport';
  } else {
    text = `${item.startTime ? `${formatTime(item.startTime)} ` : ''}${item.name}`;
    className = 'tag-itinerary-activity';
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `tag ${className}`;
  button.textContent = text;
  button.title = item.name;
  button.setAttribute('aria-label', `${TYPE_LABELS[item.type]}: ${item.name}. Open details.`);
  button.addEventListener('click', event => {
    event.stopPropagation();
    openEntry(item.type, dateKey, item);
  });
  return button;
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
    const label = `${DAYS[(startOffset + d - 1) % 7]} ${d} ${MONTHS[viewMonth]} ${viewYear}`;

    const isToday = (d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear());
    if (isToday) cell.classList.add('today');
    const num = document.createElement('button');
    num.type = 'button';
    num.className = 'day-num';
    num.textContent = d;
    num.setAttribute('aria-label', `Open ${label}`);
    cell.appendChild(num);

    itemsForDate(dateKey).forEach(item => {
      cell.appendChild(createItineraryTag(item, dateKey));
    });
    renderLegacyTags(entry, cell);

    cell.addEventListener('click', () => openAgenda(dateKey, label));

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
      if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) throw new Error('Invalid data.');
      const existing = Object.keys(data).length;
      if (existing > 0) {
        const importedDays = Object.keys(decoded).filter(key => key !== ITINERARY_KEY).length;
        const importedPlans = Array.isArray(decoded[ITINERARY_KEY]) ? decoded[ITINERARY_KEY].length : 0;
        const merge = confirm(
          `Import contains ${importedDays} day(s) and ${importedPlans} structured plan(s).\n\n` +
          `OK → Merge with existing data (imported entries overwrite matching entries)\n` +
          `Cancel → Replace all existing data`
        );
        if (merge) {
          const currentItems = getItinerary();
          const importedItems = Array.isArray(decoded[ITINERARY_KEY]) ? decoded[ITINERARY_KEY] : [];
          Object.assign(data, decoded);
          const mergedItems = new Map();
          [...currentItems, ...importedItems].forEach((item, index) => {
            mergedItems.set(item.id || `legacy-import-${index}`, item);
          });
          data[ITINERARY_KEY] = [...mergedItems.values()];
        } else {
          data = decoded;
        }
      } else {
        data = decoded;
      }
      const saved = await save();
      if (!saved) return;
      showFirstPlanMonth();
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

  // Only show dashboard if no trip selected
  if (tripId) {
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
  if (!tripId) {
    await showDashboard();
  } else {
    await loadData();
  }
})();
