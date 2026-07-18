/* ── Holiday Planner App ── */

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

const storageKey = 'holiday-planner-v1';
const tripId = new URLSearchParams(location.search).get('trip');
const SETTINGS_KEY = '_settings';
const RATE_CACHE_PREFIX = 'holiday-planner-rate-';

const COUNTRIES = [
  ['AR', 'Argentina', 'ARS'], ['AU', 'Australia', 'AUD'], ['AT', 'Austria', 'EUR'],
  ['BE', 'Belgium', 'EUR'], ['BR', 'Brazil', 'BRL'], ['BG', 'Bulgaria', 'BGN'],
  ['KH', 'Cambodia', 'KHR'], ['CA', 'Canada', 'CAD'], ['CL', 'Chile', 'CLP'],
  ['CN', 'China', 'CNY'], ['CO', 'Colombia', 'COP'], ['HR', 'Croatia', 'EUR'],
  ['CY', 'Cyprus', 'EUR'], ['CZ', 'Czechia', 'CZK'], ['DK', 'Denmark', 'DKK'],
  ['EG', 'Egypt', 'EGP'], ['EE', 'Estonia', 'EUR'], ['FJ', 'Fiji', 'FJD'],
  ['FI', 'Finland', 'EUR'], ['FR', 'France', 'EUR'], ['DE', 'Germany', 'EUR'],
  ['GR', 'Greece', 'EUR'], ['HK', 'Hong Kong', 'HKD'], ['HU', 'Hungary', 'HUF'],
  ['IS', 'Iceland', 'ISK'], ['IN', 'India', 'INR'], ['ID', 'Indonesia', 'IDR'],
  ['IE', 'Ireland', 'EUR'], ['IL', 'Israel', 'ILS'], ['IT', 'Italy', 'EUR'],
  ['JP', 'Japan', 'JPY'], ['JO', 'Jordan', 'JOD'], ['KE', 'Kenya', 'KES'],
  ['LA', 'Laos', 'LAK'], ['LV', 'Latvia', 'EUR'], ['LT', 'Lithuania', 'EUR'],
  ['LU', 'Luxembourg', 'EUR'], ['MY', 'Malaysia', 'MYR'], ['MV', 'Maldives', 'MVR'],
  ['MT', 'Malta', 'EUR'], ['MX', 'Mexico', 'MXN'], ['MA', 'Morocco', 'MAD'],
  ['NP', 'Nepal', 'NPR'], ['NL', 'Netherlands', 'EUR'], ['NZ', 'New Zealand', 'NZD'],
  ['NO', 'Norway', 'NOK'], ['PE', 'Peru', 'PEN'], ['PH', 'Philippines', 'PHP'],
  ['PL', 'Poland', 'PLN'], ['PT', 'Portugal', 'EUR'], ['QA', 'Qatar', 'QAR'],
  ['RO', 'Romania', 'RON'], ['SG', 'Singapore', 'SGD'], ['SK', 'Slovakia', 'EUR'],
  ['SI', 'Slovenia', 'EUR'], ['ZA', 'South Africa', 'ZAR'], ['KR', 'South Korea', 'KRW'],
  ['ES', 'Spain', 'EUR'], ['LK', 'Sri Lanka', 'LKR'], ['SE', 'Sweden', 'SEK'],
  ['CH', 'Switzerland', 'CHF'], ['TW', 'Taiwan', 'TWD'], ['TZ', 'Tanzania', 'TZS'],
  ['TH', 'Thailand', 'THB'], ['TR', 'Türkiye', 'TRY'], ['AE', 'United Arab Emirates', 'AED'],
  ['GB', 'United Kingdom', 'GBP'], ['US', 'United States', 'USD'], ['VU', 'Vanuatu', 'VUV'],
  ['VN', 'Vietnam', 'VND']
].map(([code, name, currency]) => ({ code, name, currency }));

let data = {};
let cloudEtag = null; // optimistic concurrency token
let currentUser = null;
let currentTripName = null;
let converterReversed = false;
let converterRate = null;
let converterRateDate = null;
let converterRequestId = 0;

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

  const settings = getSettings();
  const destination = getCountry(settings.destinationCountry);
  const context = document.createElement('span');
  context.className = 'trip-context';
  context.textContent = [
    destination?.name,
    isValidDateKey(settings.startDate) && isValidDateKey(settings.endDate)
      ? formatDateRange(settings.startDate, settings.endDate)
      : ''
  ].filter(Boolean).join(' · ');

  const back = document.createElement('button');
  back.className = 'btn btn-ghost btn-sm';
  back.type = 'button';
  back.textContent = 'My Trips';
  back.addEventListener('click', () => {
    window.location.href = window.location.pathname;
  });

  el.append('🧳 ', name);
  if (context.textContent) el.append(context);
  el.append(id, back);
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

  showTripStartMonth();
  render();
  renderCurrentTrip();
  renderCurrencyConverter();
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

function getSettings() {
  const settings = data[SETTINGS_KEY];
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
}

function getCountry(code) {
  return COUNTRIES.find(country => country.code === code) || null;
}

function formatDateRange(startDate, endDate) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })}–${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
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

function showTripStartMonth() {
  const settings = getSettings();
  const firstDate = isValidDateKey(settings.startDate) ? settings.startDate : getFirstPlanDate();
  if (!firstDate) return;
  const [year, month] = firstDate.split('-').map(Number);
  viewYear = year;
  viewMonth = month - 1;
  syncYearSelect();
}

/* ── Holiday settings and currency conversion ── */
const settingsDialog = document.getElementById('settings-dialog');
const settingsForm = document.getElementById('settings-form');
const destinationSelect = document.getElementById('holiday-country');
const homeSelect = document.getElementById('home-country');
const converterAmount = document.getElementById('converter-amount');
const converterRange = document.getElementById('converter-range');

function populateCountrySelect(select) {
  COUNTRIES.forEach(country => {
    const option = document.createElement('option');
    option.value = country.code;
    option.textContent = `${country.name} (${country.currency})`;
    select.appendChild(option);
  });
}

populateCountrySelect(destinationSelect);
populateCountrySelect(homeSelect);

function openSettings() {
  const settings = getSettings();
  document.getElementById('holiday-start-date').value = settings.startDate || '';
  document.getElementById('holiday-end-date').value = settings.endDate || '';
  destinationSelect.value = settings.destinationCountry || '';
  homeSelect.value = settings.homeCountry || '';
  document.getElementById('settings-form-error').textContent = '';
  settingsDialog.showModal();
}

document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('converter-open-settings').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', () => settingsDialog.close());
document.getElementById('settings-cancel').addEventListener('click', () => settingsDialog.close());

settingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  const startDate = document.getElementById('holiday-start-date').value;
  const endDate = document.getElementById('holiday-end-date').value;
  const destinationCountry = destinationSelect.value;
  const homeCountry = homeSelect.value;
  const error = document.getElementById('settings-form-error');
  error.textContent = '';

  if (!startDate || !endDate || !destinationCountry || !homeCountry) {
    error.textContent = 'Add both dates and choose a holiday and home country.';
    return;
  }
  if (endDate < startDate) {
    error.textContent = 'The end date cannot be before the start date.';
    return;
  }

  data[SETTINGS_KEY] = { startDate, endDate, destinationCountry, homeCountry };
  const saveButton = document.getElementById('settings-save');
  saveButton.disabled = true;
  saveButton.textContent = 'Saving…';
  const saved = await save();
  saveButton.disabled = false;
  saveButton.textContent = 'Save settings';
  if (!saved) return;

  converterReversed = false;
  showTripStartMonth();
  render();
  renderCurrentTrip();
  renderCurrencyConverter();
  settingsDialog.close();
  showToast('Holiday settings saved.', 'info', 2200);
});

function getConverterPair() {
  const settings = getSettings();
  const destination = getCountry(settings.destinationCountry);
  const home = getCountry(settings.homeCountry);
  if (!destination || !home) return null;
  return converterReversed
    ? { source: home, target: destination }
    : { source: destination, target: home };
}

function getSliderConfig(currency) {
  const configs = {
    VND: [10000000, 100000, 1000000],
    IDR: [10000000, 100000, 1000000],
    KRW: [2000000, 10000, 100000],
    JPY: [200000, 1000, 10000],
    HUF: [500000, 5000, 50000],
    CLP: [2000000, 10000, 100000],
    COP: [10000000, 100000, 1000000],
    KHR: [10000000, 100000, 1000000],
    LAK: [10000000, 100000, 1000000]
  };
  const [max, step, initial] = configs[currency] || [5000, 10, 100];
  return { max, step, initial };
}

function formatPlainAmount(value, currency) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: ['VND', 'IDR', 'JPY', 'KRW', 'CLP', 'HUF'].includes(currency) ? 0 : 2
  }).format(value);
}

function updateConversionResult() {
  const pair = getConverterPair();
  const amount = Number(converterAmount.value);
  const result = document.getElementById('converter-result-value');
  if (!pair || !Number.isFinite(amount) || amount < 0 || !converterRate) {
    result.textContent = '—';
    return;
  }
  result.textContent = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: pair.target.currency,
    maximumFractionDigits: pair.target.currency === 'VND' ? 0 : 2
  }).format(amount * converterRate);
}

function syncConverterAmount(value, source) {
  const numericValue = Math.max(0, Number(value) || 0);
  if (source !== 'number') converterAmount.value = numericValue;
  if (source !== 'range') converterRange.value = Math.min(numericValue, Number(converterRange.max));
  updateConversionResult();
}

converterAmount.addEventListener('input', event => syncConverterAmount(event.target.value, 'number'));
converterRange.addEventListener('input', event => syncConverterAmount(event.target.value, 'range'));

document.getElementById('converter-swap').addEventListener('click', () => {
  converterReversed = !converterReversed;
  renderCurrencyConverter();
});

async function loadCurrencyRate(sourceCurrency, targetCurrency) {
  const requestId = ++converterRequestId;
  const cacheKey = `${RATE_CACHE_PREFIX}${sourceCurrency.toLowerCase()}`;
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(cacheKey));
  } catch (error) {
    console.warn('Currency cache could not be read.', error);
  }

  const isFresh = cached?.savedAt && Date.now() - cached.savedAt < 12 * 60 * 60 * 1000;
  let rates = isFresh ? cached : null;
  let isStale = false;

  if (!rates) {
    try {
      const response = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${sourceCurrency.toLowerCase()}.json`);
      if (!response.ok) throw new Error(`Rate service returned ${response.status}`);
      const payload = await response.json();
      rates = {
        date: payload.date,
        values: payload[sourceCurrency.toLowerCase()],
        savedAt: Date.now()
      };
      try {
        localStorage.setItem(cacheKey, JSON.stringify(rates));
      } catch (error) {
        console.warn('Currency rate could not be cached.', error);
      }
    } catch (error) {
      console.warn('Currency rate load failed.', error);
      if (cached?.values) {
        rates = cached;
        isStale = true;
      } else {
        if (requestId !== converterRequestId) return;
        converterRate = null;
        document.getElementById('converter-rate').textContent = 'Rate unavailable. Check your connection and try again.';
        updateConversionResult();
        return;
      }
    }
  }

  if (requestId !== converterRequestId) return;
  const rate = Number(rates.values?.[targetCurrency.toLowerCase()]);
  converterRate = Number.isFinite(rate) ? rate : null;
  converterRateDate = rates.date || null;
  document.getElementById('converter-rate').textContent = converterRate
    ? `${isStale ? 'Cached' : 'Daily'} rate${converterRateDate ? ` · ${formatDateKey(converterRateDate)}` : ''}`
    : `No ${sourceCurrency} to ${targetCurrency} rate is available.`;
  updateConversionResult();
}

function renderCurrencyConverter() {
  const pair = getConverterPair();
  const empty = document.getElementById('converter-empty');
  const controls = document.getElementById('converter-controls');
  const swap = document.getElementById('converter-swap');
  converterRate = null;
  converterRateDate = null;

  if (!pair) {
    empty.hidden = false;
    controls.hidden = true;
    swap.disabled = true;
    document.getElementById('converter-pair').textContent = 'Set your countries to get started';
    return;
  }

  empty.hidden = true;
  controls.hidden = false;
  swap.disabled = pair.source.currency === pair.target.currency;
  document.getElementById('converter-pair').textContent = `${pair.source.name} to ${pair.target.name}`;
  document.getElementById('converter-source-code').textContent = pair.source.currency;
  document.getElementById('converter-target-code').textContent = pair.target.currency;
  document.getElementById('converter-rate').textContent = pair.source.currency === pair.target.currency
    ? 'Both countries use the same currency.'
    : 'Loading the latest rate…';

  const config = getSliderConfig(pair.source.currency);
  converterRange.max = config.max;
  converterRange.step = config.step;
  converterAmount.step = config.step;
  document.getElementById('converter-range-max').textContent =
    `${formatPlainAmount(config.max, pair.source.currency)} ${pair.source.currency}`;
  syncConverterAmount(config.initial);

  if (pair.source.currency === pair.target.currency) {
    converterRate = 1;
    updateConversionResult();
    return;
  }
  loadCurrencyRate(pair.source.currency, pair.target.currency);
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

function getStayLaneLayout(monthStart, monthEnd, startOffset, daysInMonth) {
  const stays = getItinerary()
    .filter(item => item.type === 'stay' && item.startDate <= monthEnd && item.endDate >= monthStart)
    .sort((a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      a.endDate.localeCompare(b.endDate) ||
      String(a.name || '').localeCompare(String(b.name || ''))
    );
  const laneEnds = [];
  const laneByStay = new Map();
  const activeWeeks = new Set();

  stays.forEach(stay => {
    let lane = laneEnds.findIndex(endDate => endDate < stay.startDate);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = stay.endDate;
    laneByStay.set(stay, lane);
  });

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (stays.some(stay => itemOccursOn(stay, dateKey))) {
      activeWeeks.add(Math.floor((startOffset + day - 1) / 7));
    }
  }

  return { laneByStay, laneCount: laneEnds.length, activeWeeks };
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

function createStayTag(item, dateKey, monthStart, monthEnd) {
  const dayIndex = (parseDateKey(dateKey).getDay() + 6) % 7;
  const isCheckIn = item.startDate === dateKey;
  const isCheckOut = item.endDate === dateKey;
  const startsRow = dayIndex === 0 || dateKey === monthStart;
  const endsRow = dayIndex === 6 || dateKey === monthEnd;
  const segmentStart = isCheckIn || startsRow;
  const segmentEnd = isCheckOut || endsRow;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = [
    'tag',
    'tag-stay',
    segmentStart ? 'segment-start' : '',
    segmentEnd ? 'segment-end' : '',
    isCheckIn ? 'stay-check-in' : '',
    isCheckOut ? 'stay-check-out' : '',
    !isCheckIn && !isCheckOut ? 'stay-continuation' : '',
  ].filter(Boolean).join(' ');

  if (isCheckIn || isCheckOut) {
    if (isCheckIn) {
      const checkIn = document.createElement('span');
      checkIn.className = 'stay-state stay-state-start';
      checkIn.textContent = 'Check in';
      button.appendChild(checkIn);
    }
    const name = document.createElement('span');
    name.className = 'stay-name';
    name.textContent = item.name;
    button.appendChild(name);
    if (isCheckOut) {
      const checkOut = document.createElement('span');
      checkOut.className = 'stay-state stay-state-end';
      checkOut.textContent = 'Check out';
      button.appendChild(checkOut);
    }
  } else if (startsRow) {
    const name = document.createElement('span');
    name.className = 'stay-name';
    name.textContent = item.name;
    button.appendChild(name);
  } else {
    button.textContent = '\u00a0';
  }

  button.title = `${item.name}: ${formatDateKey(item.startDate)} to ${formatDateKey(item.endDate)}`;
  button.setAttribute(
    'aria-label',
    `${isCheckIn ? 'Check in to' : isCheckOut ? 'Check out from' : 'Staying at'} ${item.name}. Open details.`
  );
  button.addEventListener('click', event => {
    event.stopPropagation();
    openEntry(item.type, dateKey, item);
  });
  return button;
}

function renderStayLanes(container, stays, stayLayout, weekIndex, dateKey, monthStart, monthEnd) {
  if (!stayLayout.laneCount || !stayLayout.activeWeeks.has(weekIndex)) return;
  const lanes = document.createElement('div');
  lanes.className = 'stay-lanes';
  const stayByLane = new Map(stays.map(stay => [stayLayout.laneByStay.get(stay), stay]));

  for (let lane = 0; lane < stayLayout.laneCount; lane++) {
    const slot = document.createElement('div');
    slot.className = 'stay-lane';
    const stay = stayByLane.get(lane);
    if (stay) slot.appendChild(createStayTag(stay, dateKey, monthStart, monthEnd));
    lanes.appendChild(slot);
  }
  container.appendChild(lanes);
}

function createItineraryTag(item, dateKey) {
  let text = item.name;
  let className = '';
  if (item.type === 'transport') {
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
  const settings = getSettings();

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
  const monthStart = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
  const monthEnd = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
  const stayLayout = getStayLaneLayout(monthStart, monthEnd, startOffset, daysInMonth);

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
    if (isValidDateKey(settings.startDate) && isValidDateKey(settings.endDate)) {
      if (dateKey >= settings.startDate && dateKey <= settings.endDate) cell.classList.add('holiday-date');
      else cell.classList.add('outside-holiday');
    }
    const num = document.createElement('button');
    num.type = 'button';
    num.className = 'day-num';
    num.textContent = d;
    num.setAttribute('aria-label', `Open ${label}`);
    cell.appendChild(num);

    const dayItems = itemsForDate(dateKey);
    renderStayLanes(
      cell,
      dayItems.filter(item => item.type === 'stay'),
      stayLayout,
      Math.floor((startOffset + d - 1) / 7),
      dateKey,
      monthStart,
      monthEnd
    );
    dayItems.filter(item => item.type !== 'stay').forEach(item => {
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
        const importedDays = Object.keys(decoded)
          .filter(key => key !== ITINERARY_KEY && key !== SETTINGS_KEY && isValidDateKey(key))
          .length;
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
      showTripStartMonth();
      render();
      renderCurrentTrip();
      renderCurrencyConverter();
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
  const workspace = document.getElementById('planner-workspace');
  const legend = document.getElementById('legend');

  // Only show dashboard if no trip selected
  if (tripId) {
    dashboard.style.display = 'none';
    return;
  }

  dashboard.style.display = '';
  workspace.style.display = 'none';
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
    document.getElementById('btn-settings').style.display = '';
    await loadData();
  }
})();
