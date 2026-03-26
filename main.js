import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  equalTo,
  get,
  getDatabase,
  limitToFirst,
  orderByChild,
  push,
  query,
  ref,
  remove,
  set,
  update,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';
import { getDownloadURL, getStorage, ref as storageRef, uploadBytes } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBBaOij5CcHOtPSkiA56dOJnPmVlovimtY',
  authDomain: 'calendario-83eab.firebaseapp.com',
  databaseURL: 'https://calendario-83eab-default-rtdb.firebaseio.com/',
  projectId: 'calendario-83eab',
  storageBucket: 'calendario-83eab.firebasestorage.app',
  messagingSenderId: '370342529436',
  appId: '1:370342529436:web:0cb07d33342e1bcc1ca059',
};

const app = initializeApp(firebaseConfig);
const rtdb = getDatabase(app);
const storage = getStorage(app);
const pageSize = 9;

const $ = (id) => document.getElementById(id);
const spinner = $('spinner');
const meetingsList = $('meetingsList');
const pageInfo = $('pageInfo');
const appNotice = $('appNotice');

let providers = [];
let participants = [];
let meetings = [];
let filteredMeetings = [];
let countdownInterval = null;
let currentPage = 1;
let totalPages = 1;
let activeFilterDate = null;
let activeFilterProvider = '';
let activeFilterParticipant = '';
let activeQuickFilter = 'upcoming';
let editingMeetingId = null;
let editingProviderId = null;
let editingParticipantId = null;
let nearestMeetingId = null;
let uiTickerInterval = null;
const pendingFinishMeetingIds = new Set();
const expandedPostMeetingIds =
  globalThis.__expandedPostMeetingIds instanceof Set ? globalThis.__expandedPostMeetingIds : new Set();
globalThis.__expandedPostMeetingIds = expandedPostMeetingIds;
let baseMeetings = [];
let dateMeetCounts = {};
const slackSettings = {
  webhookUrl: '',
  appScriptUrl: '',
};
const corsProxySettings = {
  baseUrl: 'https://proxy.cors.sh/',
  apiKey: 'live_36d58f4c13cb7d838833506e8f6450623bf2605859ac089fa008cfeddd29d8dd',
};

const pickerUiState = {
  provider: { query: '', open: false },
  participant: { query: '', open: false },
};
const selectedPickerIds = {
  provider: new Set(),
  participant: new Set(),
};

const providerIcons = {
  meet: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Google_Meet_icon_%282020%29.svg/960px-Google_Meet_icon_%282020%29.svg.png',
  teams:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Microsoft_Office_Teams_%282025%E2%80%93present%29.svg/3840px-Microsoft_Office_Teams_%282025%E2%80%93present%29.svg.png',
  zoom: 'https://upload.wikimedia.org/wikipedia/commons/2/24/Zoom-Logo.png',
};

const esFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full', timeStyle: 'short' });

const IOSSwal = Swal.mixin({
  background: '#f8f7ff',
  color: '#1e1e2a',
  confirmButtonColor: '#5f5bff',
  cancelButtonColor: '#d4d3e6',
  customClass: {
    popup: 'swal-ios',
    confirmButton: 'swal-ios-btn',
    cancelButton: 'swal-ios-btn swal-ios-btn-cancel',
  },
});

function showSpinner(show) {
  spinner.classList.toggle('hidden', !show);
}

function showNotice(message) {
  appNotice.textContent = message;
  appNotice.classList.remove('hidden');
}

function scrollToMeetingForm() {
  const formSection = $('meetingFormSection');
  formSection.classList.remove('collapsed');
  const headerHeight = document.querySelector('.topbar')?.offsetHeight || 0;
  const safeGap = 16;
  const top = formSection.getBoundingClientRect().top + window.scrollY - headerHeight - safeGap;
  window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
}

function randomColor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}deg 65% 45%)`;
}

function initials(name, lastName) {
  return `${(name?.[0] || '').toUpperCase()}${(lastName?.[0] || '').toUpperCase()}`;
}

function parseLinkType(url) {
  const low = (url || '').toLowerCase();
  if (low.includes('meet.google')) return 'meet';
  if (low.includes('zoom.us')) return 'zoom';
  if (low.includes('teams.microsoft') || low.includes('teams.live') || low.includes('team')) return 'teams';
  return null;
}

function meetingStatus(meeting) {
  const now = new Date();
  const start = new Date(meeting.startAt);
  const end = new Date(start.getTime() + meeting.duration * 60000);
  const today = now.toDateString() === start.toDateString();
  if (end <= now) return 'finished';
  if (start <= now && now < end) return 'in_progress';
  if (today) return 'today';
  return 'upcoming';
}

function getWeekRange(baseDate = new Date()) {
  const date = new Date(baseDate);
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(date.getDate() + diffToMonday);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { start: monday, end: sunday };
}

function countdownLabel(startAt) {
  const now = new Date();
  const start = new Date(startAt);
  const diffMs = start - now;
  if (diffMs <= 0) return 'Inicia pronto';

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `Faltan ${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `Faltan ${hours}h ${minutes}m`;
  return `Faltan ${minutes}m`;
}

function countdownCompactLabel(startAt) {
  const now = new Date();
  const start = new Date(startAt);
  const diffMs = start - now;
  if (diffMs <= 0) return 'inicia pronto';

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function elapsedLabel(startAt) {
  const now = Date.now();
  const start = new Date(startAt).getTime();
  const diffMin = Math.max(Math.floor((now - start) / 60000), 0);
  const hours = Math.floor(diffMin / 60);
  const minutes = diffMin % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function toDateKeyLocal(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeSnapshot(snapshotVal) {
  if (!snapshotVal || typeof snapshotVal !== 'object') return [];
  return Object.entries(snapshotVal).map(([id, value]) => ({ id, ...value }));
}

async function verifyRTDBAccess() {
  try {
    await get(query(ref(rtdb, 'meetings'), limitToFirst(1)));
  } catch (error) {
    showNotice('No se pudo conectar con Realtime Database. Revisá databaseURL y reglas.');
    throw error;
  }
}

async function loadCollection(name) {
  const snap = await get(ref(rtdb, name));
  return normalizeSnapshot(snap.val());
}

async function saveCollectionItem(name, data) {
  await set(push(ref(rtdb, name)), { ...data, createdAt: new Date().toISOString() });
}

function getPickerMeta(type) {
  const isProvider = type === 'provider';
  return {
    type,
    containerId: isProvider ? 'providersPicker' : 'participantsPicker',
    list: isProvider ? providers : participants,
    addLabel: isProvider ? '+ Agregar nuevo proveedor' : '+ Agregar nuevo participante',
  };
}

function getSelectedIds(type) {
  return new Set(selectedPickerIds[type]);
}

function setSelectedIds(type, idsSet) {
  selectedPickerIds[type] = new Set(idsSet);
}

function visualizeItem(item, type) {
  if (type === 'provider') {
    return `<span class="provider-dot">${(item.name?.[0] || '?').toUpperCase()}</span>`;
  }
  return `<span class="avatar" style="background:${item.color}">${item.initials}</span>`;
}

function itemLabel(item, type) {
  return type === 'provider' ? item.name : `${item.name} ${item.lastName}`;
}

function buildSuggestionRow(item, type) {
  return `<button type="button" class="picker-suggestion" data-picker-action="select" data-picker-type="${type}" data-picker-id="${item.id}">${visualizeItem(item, type)}<span>${itemLabel(item, type)}</span></button>`;
}

function buildSelectedPill(item, type) {
  return `<span class="option-chip picker-pill">${visualizeItem(item, type)}<span class="chip-text">${itemLabel(item, type)}</span><button type="button" class="pill-remove" aria-label="Quitar" data-picker-action="remove" data-picker-type="${type}" data-picker-id="${item.id}">×</button></span>`;
}

function buildPicker(type) {
  const { containerId, list, addLabel } = getPickerMeta(type);
  const { query, open } = pickerUiState[type];
  const selectedIds = getSelectedIds(type);
  const selectedItems = list.filter((item) => selectedIds.has(item.id));
  const availableItems = list.filter((item) => !selectedIds.has(item.id) && itemLabel(item, type).toLowerCase().includes(query.toLowerCase()));

  const suggestions = availableItems.map((item) => buildSuggestionRow(item, type)).join('');
  const noItems = '<div class="picker-empty">No hay coincidencias.</div>';

  $(containerId).innerHTML = `
    <div class="picker-shell ${open ? 'is-open' : ''}" data-picker-shell="${type}">
      <div class="picker-selected-wrap">${selectedItems.map((item) => buildSelectedPill(item, type)).join('')}</div>
      <input type="text" id="${type}PickerSearch" name="${type}PickerSearch" class="picker-input" data-picker-input="${type}" placeholder="Escribí para buscar..." value="${query}" />
      <div class="picker-suggestions ${open ? '' : 'hidden'}" data-picker-suggestions="${type}">
        ${suggestions || noItems}
        <button type="button" class="picker-suggestion picker-add" data-picker-action="add" data-picker-type="${type}">${addLabel}</button>
      </div>
    </div>
  `;
}

function syncPickerDropdownVisibility(type) {
  const { containerId } = getPickerMeta(type);
  const container = $(containerId);
  const suggestions = container.querySelector(`[data-picker-suggestions="${type}"]`);
  if (!suggestions) return;
  suggestions.classList.toggle('hidden', !pickerUiState[type].open);
}

function renderPickers() {
  buildPicker('provider');
  buildPicker('participant');
  renderCreatedLists();
}

function loadSlackSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('slackSettings') || '{}');
    slackSettings.webhookUrl = saved.webhookUrl || '';
    slackSettings.appScriptUrl = saved.appScriptUrl || '';
  } catch (error) {
    slackSettings.webhookUrl = '';
    slackSettings.appScriptUrl = '';
  }
  const webhookInput = $('slackWebhookUrl');
  const appScriptInput = $('appsScriptUrl');
  if (webhookInput) webhookInput.value = slackSettings.webhookUrl;
  if (appScriptInput) appScriptInput.value = slackSettings.appScriptUrl;
}

function saveSlackSettings() {
  localStorage.setItem('slackSettings', JSON.stringify(slackSettings));
}

function buildSlackPayload(meeting) {
  return {
    webhookUrl: slackSettings.webhookUrl,
    type: 'create_meeting',
    reminderMinutes: Number(meeting.slackReminderMinutes || 15),
    meeting: {
      id: meeting.id || null,
      note: meeting.note || '',
      link: meeting.link || '',
      duration: meeting.duration || 60,
      startAt: meeting.startAt,
      providers: (meeting.providers || []).map((p) => p.name).join(', '),
      participants: (meeting.participants || []).map((p) => `${p.name} ${p.lastName}`).join(', '),
    },
  };
}

async function notifySlackViaAppScript(payload) {
  if (!slackSettings.webhookUrl || !slackSettings.appScriptUrl) return;
  const targetUrl = `${corsProxySettings.baseUrl}${slackSettings.appScriptUrl}`;
  const response = await fetch(targetUrl, {
    method: 'POST',
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json',
      'x-cors-api-key': corsProxySettings.apiKey,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`No se pudo contactar App Script. HTTP ${response.status}. ${details || 'Sin detalle.'}`);
  }
}

function renderCreatedLists() {
  $('providersCreatedList').innerHTML = providers.length
    ? providers
        .map(
          (p) =>
            `<div class="created-item"><img src="${p.image}" class="provider-img" alt="${p.name}"/><span class="name">${p.name}</span><button class="btn btn-ghost btn-xs" data-edit-provider="${p.id}">Editar</button><button class="btn btn-ghost btn-xs" data-delete-provider="${p.id}">Eliminar</button></div>`,
        )
        .join('')
    : '<small>Sin proveedores creados.</small>';

  $('participantsCreatedList').innerHTML = participants.length
    ? participants
        .map(
          (p) =>
            `<div class="created-item"><span class="avatar" style="background:${p.color}">${p.initials}</span><span class="name"><strong>${p.name} ${p.lastName}</strong><small>${p.email || ''}</small></span><button class="btn btn-ghost btn-xs" data-edit-participant="${p.id}">Editar</button><button class="btn btn-ghost btn-xs" data-delete-participant="${p.id}">Eliminar</button></div>`,
        )
        .join('')
    : '<small>Sin participantes creados.</small>';
}

function resetProviderForm() {
  editingProviderId = null;
  $('providersForm').reset();
  $('providerImageFile').value = '';
  $('providersForm').querySelector('h3').textContent = 'Nuevo proveedor';
  $('saveProvider').textContent = 'Guardar';
}

function resetParticipantForm() {
  editingParticipantId = null;
  $('participantsForm').reset();
  $('participantsForm').querySelector('h3').textContent = 'Nuevo participante';
  $('saveParticipant').textContent = 'Guardar';
}

function openProviderModal(editId = null) {
  resetProviderForm();
  renderCreatedLists();
  if (editId) {
    const row = providers.find((p) => p.id === editId);
    if (row) {
      editingProviderId = editId;
      $('providerName').value = row.name || '';
      $('providerImage').value = row.image || '';
      $('providersForm').querySelector('h3').textContent = 'Editar proveedor';
      $('saveProvider').textContent = 'Actualizar';
    }
  }
  $('providersModal').showModal();
}

function openParticipantModal(editId = null) {
  resetParticipantForm();
  renderCreatedLists();
  if (editId) {
    const row = participants.find((p) => p.id === editId);
    if (row) {
      editingParticipantId = editId;
      $('participantName').value = row.name || '';
      $('participantLastName').value = row.lastName || '';
      $('participantEmail').value = row.email || '';
      $('participantsForm').querySelector('h3').textContent = 'Editar participante';
      $('saveParticipant').textContent = 'Actualizar';
    }
  }
  $('participantsModal').showModal();
}

function statusMeta(status) {
  if (status === 'finished') return { text: 'Finalizada', cls: 'finished', icon: 'bi-check2-circle' };
  if (status === 'in_progress') return { text: '', cls: 'in-progress', icon: 'bi-play-fill' };
  if (status === 'today') return { text: 'Hoy', cls: 'today', icon: 'bi-sun-fill' };
  return { text: 'Próxima', cls: 'upcoming', icon: 'bi-calendar2-event' };
}

function meetingCard(meeting) {
  const status = meetingStatus(meeting);
  const isFinished = status === 'finished';
  const meta = statusMeta(status);
  const isNearest = meeting.id === nearestMeetingId;

  const providerList = (meeting.providers || [])
    .map((p) => `<img class="provider-thumb" src="${p.image}" alt="${p.name}" title="${p.name}" />`)
    .join('');
  const participantList = (meeting.participants || [])
    .map(
      (p) =>
        `<span class="participant-pill"><span class="participant-initials" style="background:${p.color || randomColor(`${p.name}${p.lastName}${p.email || ''}`)}">${p.initials || initials(p.name, p.lastName)}</span><span>${p.name} ${p.lastName}</span></span>`,
    )
    .join('');

  const linkType = parseLinkType(meeting.link);
  const linkIcon = linkType ? `<img class="provider-inline-icon" src="${providerIcons[linkType]}" alt="${linkType}"/>` : '<i class="bi bi-camera-video"></i>';
  let countdown = '';
  if (!isFinished) {
    if (status === 'in_progress') {
      countdown = '<span class="countdown in-progress"><i class="bi bi-broadcast-pin"></i> En curso ahora</span>';
    } else {
      countdown = `<span class="countdown alert-upcoming ${isNearest ? 'nearest-countdown' : ''}" data-countdown="${meeting.startAt}"><i class="bi bi-alarm"></i> ${countdownLabel(meeting.startAt)}</span>`;
    }
  }
  const isFinishing = pendingFinishMeetingIds.has(meeting.id);
  const isPostExpanded = expandedPostMeetingIds.has(meeting.id);
  const hasRecording = Boolean((meeting.recordingLink || '').trim());

  return `<article class="meeting-item status-${meta.cls} ${isFinished ? 'disabled' : ''} ${isNearest ? 'is-nearest' : ''}">
    <div class="meeting-top">
      <strong><i class="bi bi-clock-history"></i> ${esFmt.format(new Date(meeting.startAt))}</strong>
      <div class="top-badges">
        ${isNearest ? '<span class="badge nearest"><i class="bi bi-stars"></i> Próximo meet</span>' : ''}
        <span class="badge ${meta.cls}"><i class="bi ${meta.icon}"></i>${meta.text ? ` ${meta.text}` : ''}</span>
      </div>
    </div>

    <div class="meeting-duration"><i class="bi bi-hourglass-split"></i> Duración: <strong>${meeting.duration || 60} min</strong></div>
    ${countdown}

    <p class="meeting-note"><i class="bi bi-journal-text"></i> ${meeting.note || 'Sin nota'}</p>

    <div class="providers-row">${providerList || '<em>Sin proveedores</em>'}</div>

    <div class="participants-list">${participantList || '<span class="participant-empty"><i class="bi bi-person-x"></i> Sin participantes</span>'}</div>

    <div class="link-actions">
      ${meeting.link ? `<a class="meeting-link" href="${meeting.link}" target="_blank" rel="noreferrer">${linkIcon}<span>Abrir reunión</span></a>` : '<span class="meeting-link muted"><i class="bi bi-link-45deg"></i> Sin link</span>'}
      ${meeting.link ? `<button class="btn btn-pill btn-ghost btn-subtle" data-copy-link="${meeting.id}"><i class="bi bi-copy"></i> Copiar link</button>` : ''}
      <button class="btn btn-pill btn-ghost btn-subtle" data-copy-summary="${meeting.id}"><i class="bi bi-whatsapp"></i> Copiar resumen</button>
    </div>

    <div class="meeting-actions">
      ${isFinished ? `<button class="btn btn-soft btn-soft-radius" data-reschedule="${meeting.id}"><i class="bi bi-arrow-repeat"></i> Reprogramar</button>` : ''}
      ${
        status === 'in_progress'
          ? `<button class="btn btn-soft btn-soft-radius" data-finish-now="${meeting.id}" ${isFinishing ? 'disabled' : ''}>${
              isFinishing ? '<span class="spinner mini"></span> Finalizando...' : '<i class="bi bi-stop-circle"></i> Finalizar ahora'
            }</button>`
          : ''
      }
      ${!isFinished ? `<button class="btn btn-ghost btn-action" data-edit="${meeting.id}"><i class="bi bi-pencil-square"></i></button>` : ''}
      ${!isFinished ? `<button class="btn btn-ghost btn-action" data-delete="${meeting.id}"><i class="bi bi-trash3"></i></button>` : ''}
    </div>
    ${
      isFinished
        ? `<div class="post-meeting-box" data-post-box="${meeting.id}">
            <div class="post-meeting-top">
              <span class="post-meeting-title"><i class="bi bi-journal-check"></i> Post reunión</span>
              <button class="btn btn-pill btn-ghost btn-subtle" data-toggle-post="${meeting.id}">
                <i class="bi ${isPostExpanded ? 'bi-chevron-up' : 'bi-chevron-down'}"></i> ${isPostExpanded ? 'Ocultar' : 'Editar'}
              </button>
            </div>
            ${
              hasRecording
                ? `<div class="recording-preview">
                    <button class="btn btn-pill rec-pill" data-open-recording="${meeting.id}"><span class="rec-dot"></span> REC</button>
                    <span class="recording-label">Grabación cargada</span>
                    <button class="btn btn-pill btn-ghost btn-subtle" data-open-recording="${meeting.id}"><i class="bi bi-box-arrow-up-right"></i> Abrir</button>
                    <button class="btn btn-pill btn-ghost btn-subtle" data-copy-recording="${meeting.id}"><i class="bi bi-copy"></i> Copiar</button>
                  </div>`
                : '<span class="recording-empty"><i class="bi bi-camera-reels"></i> Sin grabación cargada</span>'
            }
            <div class="post-fields ${isPostExpanded ? '' : 'hidden'}">
              <label>Link de grabación
                <input type="url" name="recordingLink" data-recording-link="${meeting.id}" value="${meeting.recordingLink || ''}" placeholder="https://..." />
              </label>
              <label>Comentario post reunión
                <textarea rows="2" name="postComment" data-post-comment="${meeting.id}" placeholder="Notas finales...">${meeting.postComment || ''}</textarea>
              </label>
              <button class="btn btn-pill btn-soft" data-save-post="${meeting.id}"><i class="bi bi-save2"></i> Guardar post reunión</button>
            </div>
          </div>`
        : ''
    }
  </article>`;
}

function paginateRows(rows) {
  totalPages = Math.max(Math.ceil(rows.length / pageSize), 1);
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

function applyQuickFilter(rows) {
  const now = new Date();
  const thisWeek = getWeekRange(now);
  const nextWeekStart = new Date(thisWeek.end);
  nextWeekStart.setDate(thisWeek.end.getDate() + 1);
  nextWeekStart.setHours(0, 0, 0, 0);
  const nextWeek = getWeekRange(nextWeekStart);

  return rows.filter((m) => {
    const start = new Date(m.startAt);
    const status = meetingStatus(m);

    if (activeQuickFilter === 'upcoming') return status === 'upcoming' || status === 'today' || status === 'in_progress';
    if (activeQuickFilter === 'in_progress') return status === 'in_progress';
    if (activeQuickFilter === 'today') return start.toDateString() === now.toDateString();
    if (activeQuickFilter === 'week') return start >= thisWeek.start && start <= thisWeek.end;
    if (activeQuickFilter === 'next_week') return start >= nextWeek.start && start <= nextWeek.end;
    if (activeQuickFilter === 'finished') return status === 'finished';
    if (activeQuickFilter === 'recordings') return Boolean((m.recordingLink || '').trim());
    return true;
  });
}

function updateQuickFilterCounts(rows) {
  const now = new Date();
  const thisWeek = getWeekRange(now);
  const nextWeekStart = new Date(thisWeek.end);
  nextWeekStart.setDate(thisWeek.end.getDate() + 1);
  nextWeekStart.setHours(0, 0, 0, 0);
  const nextWeek = getWeekRange(nextWeekStart);
  const counts = {
    all: rows.length,
    upcoming: 0,
    in_progress: 0,
    today: 0,
    week: 0,
    next_week: 0,
    finished: 0,
    recordings: 0,
  };

  rows.forEach((meeting) => {
    const start = new Date(meeting.startAt);
    const status = meetingStatus(meeting);
    if (status === 'upcoming' || status === 'today' || status === 'in_progress') counts.upcoming += 1;
    if (status === 'in_progress') counts.in_progress += 1;
    if (start.toDateString() === now.toDateString()) counts.today += 1;
    if (start >= thisWeek.start && start <= thisWeek.end) counts.week += 1;
    if (start >= nextWeek.start && start <= nextWeek.end) counts.next_week += 1;
    if (status === 'finished') counts.finished += 1;
    if ((meeting.recordingLink || '').trim()) counts.recordings += 1;
  });

  document.querySelectorAll('[data-count-filter]').forEach((el) => {
    const filter = el.dataset.countFilter;
    el.textContent = String(counts[filter] ?? 0);
  });
}

function sortMeetings(rows) {
  const rank = {
    in_progress: 0,
    upcoming: 1,
    today: 1,
    finished: 2,
  };
  return rows.sort((a, b) => {
    const statusA = meetingStatus(a);
    const statusB = meetingStatus(b);
    const rankDiff = (rank[statusA] ?? 9) - (rank[statusB] ?? 9);
    if (rankDiff !== 0) return rankDiff;

    const timeA = new Date(a.startAt).getTime();
    const timeB = new Date(b.startAt).getTime();
    if (statusA === 'finished' && statusB === 'finished') return timeB - timeA;
    return timeA - timeB;
  });
}

function getNearestMeetingId(rows) {
  const now = Date.now();
  const activeRows = rows.filter((row) => meetingStatus(row) !== 'finished');
  if (!activeRows.length) return null;

  const upcoming = activeRows.filter((row) => new Date(row.startAt).getTime() >= now);
  if (upcoming.length) {
    return upcoming.sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0].id;
  }

  return activeRows.sort((a, b) => new Date(b.startAt) - new Date(a.startAt))[0].id;
}

function renderCurrentPage() {
  nearestMeetingId = getNearestMeetingId(filteredMeetings);
  meetings = paginateRows(filteredMeetings);
  meetingsList.innerHTML = meetings.length ? meetings.map(meetingCard).join('') : '<p>No hay reuniones para este filtro.</p>';
  pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;
  $('prevPage').disabled = currentPage === 1;
  $('nextPage').disabled = currentPage >= totalPages;
  startCountdowns();
  updateTopIndicators();
  startUiTicker();
}

function startCountdowns() {
  if (countdownInterval) window.clearInterval(countdownInterval);

  const updateCountdowns = () => {
    document.querySelectorAll('.countdown.alert-upcoming[data-countdown]').forEach((el) => {
      const meetingStart = el.dataset.countdown;
      if (meetingStart) el.innerHTML = `<i class="bi bi-alarm"></i> ${countdownLabel(meetingStart)}`;
    });
  };

  updateCountdowns();
  countdownInterval = window.setInterval(updateCountdowns, 60000);
}

function renderFilterOptions() {
  $('filterProvider').innerHTML = `<option value="">Proveedor</option>${providers
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('')}`;
  $('filterParticipant').innerHTML = `<option value="">Participante</option>${participants
    .map((p) => `<option value="${p.id}">${p.name} ${p.lastName}</option>`)
    .join('')}`;
  $('filterProvider').value = activeFilterProvider;
  $('filterParticipant').value = activeFilterParticipant;
}

function updateTopIndicators() {
  const now = Date.now();
  const activeInProgress = baseMeetings.filter((m) => meetingStatus(m) === 'in_progress');
  const inProgressBadge = $('inProgressBadge');
  if (activeInProgress.length === 1) {
    inProgressBadge.textContent = elapsedLabel(activeInProgress[0].startAt);
    inProgressBadge.classList.remove('hidden');
  } else if (activeInProgress.length > 1) {
    inProgressBadge.textContent = `${activeInProgress.length} reuniones en curso`;
    inProgressBadge.classList.remove('hidden');
  } else {
    inProgressBadge.classList.add('hidden');
    inProgressBadge.textContent = '';
  }

  const nextMeeting = baseMeetings
    .filter((m) => meetingStatus(m) !== 'finished' && new Date(m.startAt).getTime() > now)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))[0];
  const counter = $('nextMeetingCounter');
  if (!nextMeeting) {
    counter.classList.add('hidden');
    counter.textContent = '';
    return;
  }
  counter.classList.remove('hidden');
  counter.innerHTML = `<i class="bi bi-alarm"></i> Próxima reunión en ${countdownCompactLabel(nextMeeting.startAt)}`;
}

function setNextMeetingCounterLoading(show) {
  const counter = $('nextMeetingCounter');
  if (show) {
    counter.classList.remove('hidden');
    counter.innerHTML = '<span class="spinner mini"></span> Cargando próxima reunión...';
    return;
  }
  if (counter.textContent.includes('Cargando próxima reunión')) {
    counter.textContent = '';
    counter.classList.add('hidden');
  } else if (!counter.textContent.trim()) {
    counter.classList.add('hidden');
  }
}

function startUiTicker() {
  if (uiTickerInterval) window.clearInterval(uiTickerInterval);
  const tick = () => updateTopIndicators();
  tick();
  uiTickerInterval = window.setInterval(tick, 60000);
}

async function loadReferences() {
  providers = await loadCollection('providers');
  participants = await loadCollection('participants');
  renderFilterOptions();
  renderPickers();
}

async function fetchMeetings() {
  showSpinner(true);
  setNextMeetingCounterLoading(true);
  meetingsList.innerHTML = '';
  try {
    let rows = [];
    if (activeFilterDate) {
      const snap = await get(query(ref(rtdb, 'meetings'), orderByChild('dateKey'), equalTo(activeFilterDate)));
      rows = normalizeSnapshot(snap.val());
    } else {
      rows = await loadCollection('meetings');
    }

    if (activeFilterProvider) {
      rows = rows.filter((row) => (row.providers || []).some((p) => p.id === activeFilterProvider));
    }
    if (activeFilterParticipant) {
      rows = rows.filter((row) => (row.participants || []).some((p) => p.id === activeFilterParticipant));
    }

    await refreshDateMeetCounts();
    baseMeetings = [...rows];
    updateQuickFilterCounts(rows);
    filteredMeetings = sortMeetings(applyQuickFilter(rows));
    renderCurrentPage();
  } catch (error) {
    showNotice('No se pudieron cargar reuniones desde Realtime Database.');
    meetingsList.innerHTML = '<p>No se pudieron cargar reuniones.</p>';
    console.error(error);
  } finally {
    showSpinner(false);
    setNextMeetingCounterLoading(false);
  }
}

async function refreshDateMeetCounts() {
  const rows = await loadCollection('meetings');
  dateMeetCounts = rows.reduce((acc, row) => {
    const key = row.dateKey || toDateKeyLocal(new Date(row.startAt));
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  $('filterDate')._flatpickr?.redraw();
}

async function onSaveProvider(e) {
  e.preventDefault();
  const name = $('providerName').value.trim();
  const imageUrl = $('providerImage').value.trim();
  const imageFile = $('providerImageFile').files?.[0];
  if (!name) return;

  let image = imageUrl;
  if (imageFile) {
    $('providerUploadSpinner').classList.remove('hidden');
    $('saveProvider').disabled = true;
    try {
      const filePath = `providers/${Date.now()}-${imageFile.name.replace(/\\s+/g, '-')}`;
      const uploaded = await uploadBytes(storageRef(storage, filePath), imageFile);
      image = await getDownloadURL(uploaded.ref);
    } finally {
      $('providerUploadSpinner').classList.add('hidden');
      $('saveProvider').disabled = false;
    }
  }

  if (!image) {
    await IOSSwal.fire({
      icon: 'info',
      title: 'Falta imagen',
      text: 'Podés pegar una URL o subir un archivo.',
    });
    return;
  }

  if (editingProviderId) {
    await update(ref(rtdb, `providers/${editingProviderId}`), { name, image, updatedAt: new Date().toISOString() });
  } else {
    await saveCollectionItem('providers', { name, image });
  }

  $('providersModal').close();
  resetProviderForm();
  await loadReferences();
}

async function onSaveParticipant(e) {
  e.preventDefault();
  const name = $('participantName').value.trim();
  const lastName = $('participantLastName').value.trim();
  const email = $('participantEmail').value.trim();
  if (!name || !lastName || !email) return;

  const payload = {
    name,
    lastName,
    email,
    initials: initials(name, lastName),
    color: randomColor(`${name}${lastName}${email}`),
  };

  if (editingParticipantId) {
    await update(ref(rtdb, `participants/${editingParticipantId}`), { ...payload, updatedAt: new Date().toISOString() });
  } else {
    await saveCollectionItem('participants', payload);
  }

  $('participantsModal').close();
  resetParticipantForm();
  await loadReferences();
}

function resetMeetingForm({ keepOpen = false } = {}) {
  $('meetingDate').value = '';
  $('meetingDate')._flatpickr?.clear();
  $('meetingTime').value = '';
  $('meetingDuration').value = '60';
  $('meetingNote').value = '';
  $('meetingLink').value = '';
  $('notifySlack').checked = true;
  $('slackReminderMinutes').value = '15';
  setSelectedIds('provider', new Set());
  setSelectedIds('participant', new Set());
  pickerUiState.provider.query = '';
  pickerUiState.participant.query = '';
  pickerUiState.provider.open = false;
  pickerUiState.participant.open = false;
  editingMeetingId = null;
  $('cancelEdit').classList.add('hidden');
  $('saveMeeting').innerHTML = '<i class="bi bi-floppy"></i> Cargar evento';
  if (!keepOpen) $('meetingFormSection').classList.add('collapsed');
  renderPickers();
}

function hasMeetingDraft() {
  return Boolean(
    $('meetingDate').value ||
      $('meetingTime').value ||
      $('meetingNote').value.trim() ||
      $('meetingLink').value.trim() ||
      Number($('meetingDuration').value || 60) !== 60 ||
      getSelectedIds('provider').size ||
      getSelectedIds('participant').size,
  );
}

async function confirmDiscardDraft() {
  const result = await IOSSwal.fire({
    icon: 'warning',
    title: '¿Cancelar creación del evento?',
    text: 'Se perderán los cambios cargados en este formulario.',
    footer: 'Confirmá solo si querés eliminar el borrador.',
    showCancelButton: true,
    confirmButtonText: 'Sí, descartar',
    cancelButtonText: 'Continuar editando',
  });
  return result.isConfirmed;
}

function formatOverlapDetails(row) {
  const start = new Date(row.startAt);
  const end = new Date(start.getTime() + (row.duration || 60) * 60000);
  return `• ${esFmt.format(start)} → ${esFmt.format(end)} ${row.note ? `(${row.note})` : ''}`;
}

function getOverlappingMeetings(startAt, duration, ignoreId = null) {
  const nextStart = startAt.getTime();
  const nextEnd = nextStart + duration * 60000;
  return filteredMeetings.filter((row) => {
    if (ignoreId && row.id === ignoreId) return false;
    const rowStart = new Date(row.startAt).getTime();
    const rowEnd = rowStart + (row.duration || 60) * 60000;
    return nextStart < rowEnd && rowStart < nextEnd;
  });
}

async function onSaveMeeting() {
  const day = $('meetingDate').value;
  const time = $('meetingTime').value;
  if (!day || !time) {
    await IOSSwal.fire({
      icon: 'warning',
      title: 'Completá fecha y hora',
      text: 'Necesitás seleccionar ambos campos para crear la reunión.',
    });
    return;
  }
  const startAt = new Date(`${day}T${time}`);
  if (Number.isNaN(startAt.getTime())) {
    await IOSSwal.fire({
      icon: 'error',
      title: 'Fecha/hora inválida',
      text: 'Revisá los valores ingresados e intentá nuevamente.',
    });
    return;
  }

  const selectedProviderIds = [...getSelectedIds('provider')];
  const selectedParticipantIds = [...getSelectedIds('participant')];

  const payload = {
    startAt: startAt.toISOString(),
    duration: Number($('meetingDuration').value || 60),
    dateKey: startAt.toISOString().slice(0, 10),
    note: $('meetingNote').value.trim(),
    link: $('meetingLink').value.trim(),
    providers: providers.filter((p) => selectedProviderIds.includes(p.id)).map(({ id, name, image }) => ({ id, name, image })),
    participants: participants
      .filter((p) => selectedParticipantIds.includes(p.id))
      .map(({ id, name, lastName, email, initials: ini, color }) => ({ id, name, lastName, email, initials: ini, color })),
    notifySlack: $('notifySlack').checked,
    slackReminderMinutes: Number($('slackReminderMinutes').value || 15),
  };
  if (!payload.note) {
    await IOSSwal.fire({
      icon: 'warning',
      title: 'Falta la nota de la reunión',
      text: 'Completá la nota para poder crear el evento.',
    });
    return;
  }

  const overlaps = getOverlappingMeetings(startAt, payload.duration, editingMeetingId);
  if (overlaps.length) {
    const detail = overlaps.slice(0, 3).map(formatOverlapDetails).join('\n');
    const overlapConfirm = await IOSSwal.fire({
      icon: 'warning',
      title: 'Se superpone con otra reunión',
      text: `Detecté ${overlaps.length} superposición(es).\n${detail}\n¿Deseás continuar igual?`,
      showCancelButton: true,
      confirmButtonText: 'Sí, continuar',
      cancelButtonText: 'No, revisar',
    });
    if (!overlapConfirm.isConfirmed) return;
  }

  const confirmation = await IOSSwal.fire({
    icon: 'question',
    title: editingMeetingId ? '¿Guardar cambios de la reunión?' : '¿Cargar nuevo evento?',
    text: 'Confirmá para guardar o cancelá para cerrar el editor sin guardar.',
    showCancelButton: true,
    confirmButtonText: editingMeetingId ? 'Sí, guardar' : 'Sí, cargar',
    cancelButtonText: 'Cancelar y cerrar',
  });

  if (!confirmation.isConfirmed) {
    resetMeetingForm();
    return;
  }

  let meetingId = editingMeetingId;
  if (editingMeetingId) {
    await update(ref(rtdb, `meetings/${editingMeetingId}`), { ...payload, updatedAt: new Date().toISOString() });
  } else {
    const createdRef = push(ref(rtdb, 'meetings'));
    meetingId = createdRef.key;
    await set(createdRef, { ...payload, createdAt: new Date().toISOString() });
  }

  if (payload.notifySlack) {
    $('saveMeeting').disabled = true;
    $('saveMeeting').innerHTML = '<span class="spinner mini"></span> Enviando a Slack...';
    try {
      await notifySlackViaAppScript(buildSlackPayload({ ...payload, id: meetingId }));
    } catch (error) {
      console.error(error);
      await IOSSwal.fire({
        icon: 'warning',
        title: 'Reunión guardada',
        text: 'No se pudo notificar a App Script/Slack. Verificá las URLs configuradas.',
      });
    } finally {
      $('saveMeeting').disabled = false;
      $('saveMeeting').innerHTML = editingMeetingId ? '<i class="bi bi-floppy"></i> Guardar cambios' : '<i class="bi bi-floppy"></i> Cargar evento';
    }
  }

  resetMeetingForm();
  await fetchMeetings();
}

function loadMeetingToForm(id) {
  const row = filteredMeetings.find((m) => m.id === id);
  if (!row) return;
  const dt = new Date(row.startAt);
  $('meetingDate').value = row.dateKey;
  $('meetingDate')._flatpickr?.setDate(row.dateKey, true, 'Y-m-d');
  $('meetingTime').value = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  $('meetingDuration').value = String(row.duration || 60);
  $('meetingNote').value = row.note || '';
  $('meetingLink').value = row.link || '';
  $('notifySlack').checked = row.notifySlack !== false;
  $('slackReminderMinutes').value = String(row.slackReminderMinutes || 15);
  setSelectedIds('provider', new Set((row.providers || []).map((p) => p.id)));
  setSelectedIds('participant', new Set((row.participants || []).map((p) => p.id)));
  editingMeetingId = id;
  $('cancelEdit').classList.remove('hidden');
  $('saveMeeting').innerHTML = '<i class="bi bi-floppy"></i> Guardar cambios';
  $('meetingFormSection').classList.remove('collapsed');
  renderPickers();
}

async function deleteMeeting(id) {
  const row = filteredMeetings.find((m) => m.id === id);
  if (!row) return;
  if (meetingStatus(row) === 'finished') return;
  const result = await IOSSwal.fire({
    icon: 'warning',
    title: '¿Eliminar reunión activa?',
    text: 'Esta acción quita la reunión del calendario.',
    showCancelButton: true,
    confirmButtonText: 'Sí, eliminar',
    cancelButtonText: 'No',
  });
  if (!result.isConfirmed) return;
  await set(ref(rtdb, `meetings/${id}`), null);
  await fetchMeetings();
}

async function rescheduleMeeting(id) {
  loadMeetingToForm(id);
  scrollToMeetingForm();
}

async function finishMeetingNow(id) {
  if (pendingFinishMeetingIds.has(id)) return;
  const row = filteredMeetings.find((m) => m.id === id);
  if (!row) return;
  const now = new Date();
  const start = new Date(row.startAt);
  const elapsedMin = Math.max(Math.ceil((now - start) / 60000), 1);
  const result = await IOSSwal.fire({
    icon: 'question',
    title: '¿Finalizar reunión ahora?',
    text: `Duración efectiva: ${elapsedMin} min.`,
    showCancelButton: true,
    confirmButtonText: 'Sí, finalizar',
    cancelButtonText: 'Cancelar',
  });
  if (!result.isConfirmed) return;
  pendingFinishMeetingIds.add(id);
  renderCurrentPage();
  try {
    await update(ref(rtdb, `meetings/${id}`), { duration: elapsedMin, updatedAt: new Date().toISOString() });
    await fetchMeetings();
  } catch (error) {
    console.error(error);
    await IOSSwal.fire({ icon: 'error', title: 'No se pudo finalizar', text: 'Intentá nuevamente.' });
  } finally {
    pendingFinishMeetingIds.delete(id);
    renderCurrentPage();
  }
}

async function savePostMeeting(id) {
  const linkInput = document.querySelector(`[data-recording-link="${id}"]`);
  const commentInput = document.querySelector(`[data-post-comment="${id}"]`);
  if (!linkInput || !commentInput) return;
  await update(ref(rtdb, `meetings/${id}`), {
    recordingLink: linkInput.value.trim(),
    postComment: commentInput.value.trim(),
    updatedAt: new Date().toISOString(),
  });
  await IOSSwal.fire({ icon: 'success', title: 'Guardado', timer: 1100, showConfirmButton: false });
}

async function deleteProvider(id) {
  const result = await IOSSwal.fire({
    title: '¿Estas seguro?',
    text: 'Se eliminará el proveedor.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, eliminar',
    cancelButtonText: 'Cancelar',
  });
  if (!result.isConfirmed) return;
  await remove(ref(rtdb, `providers/${id}`));
  await loadReferences();
}

async function deleteParticipant(id) {
  const result = await IOSSwal.fire({
    title: '¿Estas seguro?',
    text: 'Se eliminará el participante.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, eliminar',
    cancelButtonText: 'Cancelar',
  });
  if (!result.isConfirmed) return;
  await remove(ref(rtdb, `participants/${id}`));
  await loadReferences();
}

function buildMeetingSummary(meeting) {
  const providersSummary = (meeting.providers || []).map((p) => p.name).join(', ') || 'Sin proveedores';
  const participantsSummary = (meeting.participants || []).map((p) => `${p.name} ${p.lastName}`).join(', ') || 'Sin participantes';
  const when = esFmt.format(new Date(meeting.startAt));
  return `📅 Reunión: ${when}\n⏱️ Duración: ${meeting.duration || 60} min\n📝 Nota: ${meeting.note || 'Sin nota'}\n👥 Participantes: ${participantsSummary}\n🏢 Proveedores: ${providersSummary}\n🔗 Link: ${meeting.link || 'Sin link'}`;
}

async function copyToClipboard(content, okMessage) {
  try {
    await navigator.clipboard.writeText(content);
    await IOSSwal.fire({ icon: 'success', title: 'Copiado', text: okMessage, timer: 1300, showConfirmButton: false });
  } catch (error) {
    await IOSSwal.fire({ icon: 'error', title: 'No se pudo copiar', text: 'Revisá permisos del navegador.' });
  }
}

function bindPickerEvents(type) {
  const { containerId } = getPickerMeta(type);
  const container = $(containerId);

  container.addEventListener('click', (e) => {
    const actionButton = e.target.closest('[data-picker-action]');
    if (actionButton) {
      e.preventDefault();
      e.stopPropagation();
      const action = actionButton.dataset.pickerAction;
      const id = actionButton.dataset.pickerId;
      if (action === 'add') {
        pickerUiState[type].open = false;
        pickerUiState[type].query = '';
        renderPickers();
        if (type === 'provider') openProviderModal();
        else openParticipantModal();
        return;
      }
      if (action === 'select' && id) {
        const selected = getSelectedIds(type);
        selected.add(id);
        setSelectedIds(type, selected);
        pickerUiState[type].query = '';
        pickerUiState[type].open = true;
        renderPickers();
        $(containerId).querySelector(`[data-picker-input="${type}"]`)?.focus();
        return;
      }
      if (action === 'remove' && id) {
        const selected = getSelectedIds(type);
        selected.delete(id);
        setSelectedIds(type, selected);
        renderPickers();
      }
      return;
    }

    const shell = e.target.closest(`[data-picker-shell="${type}"]`);
    if (shell && !actionButton) {
      pickerUiState[type].open = true;
      syncPickerDropdownVisibility(type);
    }
  });

  container.addEventListener('input', (e) => {
    if (!e.target.matches(`[data-picker-input="${type}"]`)) return;
    pickerUiState[type].query = e.target.value;
    pickerUiState[type].open = true;
    renderPickers();
  });

  container.addEventListener('focusin', (e) => {
    if (!e.target.matches(`[data-picker-input="${type}"]`)) return;
    pickerUiState[type].open = true;
    syncPickerDropdownVisibility(type);
  });
}

function bindEvents() {
  $('openMeetingForm').addEventListener('click', async () => {
    const isCollapsed = $('meetingFormSection').classList.contains('collapsed');
    if (isCollapsed) {
      scrollToMeetingForm();
      return;
    }
    if (hasMeetingDraft()) {
      const shouldDiscard = await confirmDiscardDraft();
      if (!shouldDiscard) return;
    }
    resetMeetingForm();
  });
  $('openProvidersModal').addEventListener('click', () => openProviderModal());
  $('openParticipantsModal').addEventListener('click', () => openParticipantModal());
  $('openSlackConfigModal').addEventListener('click', () => {
    loadSlackSettings();
    $('slackConfigModal').showModal();
  });

  $('cancelProvider').addEventListener('click', () => {
    $('providersModal').close();
    resetProviderForm();
  });
  $('cancelParticipant').addEventListener('click', () => {
    $('participantsModal').close();
    resetParticipantForm();
  });
  $('cancelSlackConfig').addEventListener('click', () => $('slackConfigModal').close());

  $('providersForm').addEventListener('submit', onSaveProvider);
  $('participantsForm').addEventListener('submit', onSaveParticipant);
  $('slackConfigForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const webhookUrl = $('slackWebhookUrl').value.trim();
    const appScriptUrl = $('appsScriptUrl').value.trim();
    if (!webhookUrl || !appScriptUrl) {
      await IOSSwal.fire({
        icon: 'warning',
        title: 'Faltan datos de Slack',
        text: 'Completá webhook y URL de App Script antes de guardar.',
      });
      return;
    }
    $('saveSlackConfig').disabled = true;
    $('saveSlackConfig').innerHTML = '<span class="spinner mini"></span> Guardando...';
    slackSettings.webhookUrl = webhookUrl;
    slackSettings.appScriptUrl = appScriptUrl;
    saveSlackSettings();
    await new Promise((resolve) => setTimeout(resolve, 350));
    $('saveSlackConfig').disabled = false;
    $('saveSlackConfig').textContent = 'Guardar';
    $('slackConfigModal').close();
    await IOSSwal.fire({ icon: 'success', title: 'Configuración guardada', timer: 1000, showConfirmButton: false });
  });
  $('saveMeeting').addEventListener('click', onSaveMeeting);
  $('cancelEdit').addEventListener('click', () => resetMeetingForm());
  $('cancelCreateMeeting').addEventListener('click', async () => {
    if (hasMeetingDraft()) {
      const shouldDiscard = await confirmDiscardDraft();
      if (!shouldDiscard) return;
    }
    resetMeetingForm();
  });

  bindPickerEvents('provider');
  bindPickerEvents('participant');

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-picker-shell]')) return;
    const wasProviderOpen = pickerUiState.provider.open;
    const wasParticipantOpen = pickerUiState.participant.open;
    pickerUiState.provider.open = false;
    pickerUiState.participant.open = false;
    if (wasProviderOpen || wasParticipantOpen) renderPickers();
  });

  $('providersCreatedList').addEventListener('click', async (e) => {
    const idDelete = e.target?.dataset?.deleteProvider;
    const idEdit = e.target?.dataset?.editProvider;
    if (idEdit) openProviderModal(idEdit);
    if (idDelete) await deleteProvider(idDelete);
  });

  $('participantsCreatedList').addEventListener('click', async (e) => {
    const idDelete = e.target?.dataset?.deleteParticipant;
    const idEdit = e.target?.dataset?.editParticipant;
    if (idEdit) openParticipantModal(idEdit);
    if (idDelete) await deleteParticipant(idDelete);
  });

  $('clearFilter').addEventListener('click', async () => {
    $('filterDate')._flatpickr?.clear();
    activeFilterDate = null;
    activeFilterProvider = '';
    activeFilterParticipant = '';
    $('filterProvider').value = '';
    $('filterParticipant').value = '';
    currentPage = 1;
    await fetchMeetings();
  });
  $('filterProvider').addEventListener('change', async (e) => {
    activeFilterProvider = e.target.value;
    currentPage = 1;
    await fetchMeetings();
  });
  $('filterParticipant').addEventListener('change', async (e) => {
    activeFilterParticipant = e.target.value;
    currentPage = 1;
    await fetchMeetings();
  });

  $('quickFilters').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    activeQuickFilter = btn.dataset.filter;
    currentPage = 1;
    document.querySelectorAll('.quick-filter').forEach((item) => item.classList.toggle('active', item === btn));
    await fetchMeetings();
  });

  $('prevPage').addEventListener('click', async () => {
    if (currentPage > 1) currentPage -= 1;
    renderCurrentPage();
  });
  $('nextPage').addEventListener('click', async () => {
    if (currentPage < totalPages) currentPage += 1;
    renderCurrentPage();
  });

  $('scrollUpBtn').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  $('scrollDownBtn').addEventListener('click', () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));

  meetingsList.addEventListener('click', async (e) => {
    const idRes = e.target.closest('[data-reschedule]')?.dataset?.reschedule;
    const idEdit = e.target.closest('[data-edit]')?.dataset?.edit;
    const idDelete = e.target.closest('[data-delete]')?.dataset?.delete;
    const idFinish = e.target.closest('[data-finish-now]')?.dataset?.finishNow;
    const idCopyLink = e.target.closest('[data-copy-link]')?.dataset?.copyLink;
    const idCopySummary = e.target.closest('[data-copy-summary]')?.dataset?.copySummary;
    const idSavePost = e.target.closest('[data-save-post]')?.dataset?.savePost;
    const idTogglePost = e.target.closest('[data-toggle-post]')?.dataset?.togglePost;
    const idOpenRecording = e.target.closest('[data-open-recording]')?.dataset?.openRecording;
    const idCopyRecording = e.target.closest('[data-copy-recording]')?.dataset?.copyRecording;
    if (idTogglePost) {
      if (expandedPostMeetingIds.has(idTogglePost)) expandedPostMeetingIds.delete(idTogglePost);
      else expandedPostMeetingIds.add(idTogglePost);
      renderCurrentPage();
      return;
    }
    if (idRes) await rescheduleMeeting(idRes);
    if (idFinish) await finishMeetingNow(idFinish);
    if (idEdit) {
      loadMeetingToForm(idEdit);
      scrollToMeetingForm();
    }
    if (idDelete) await deleteMeeting(idDelete);
    if (idCopyLink) {
      const row = filteredMeetings.find((m) => m.id === idCopyLink);
      if (row?.link) await copyToClipboard(row.link, 'Link copiado al portapapeles.');
    }
    if (idCopySummary) {
      const row = filteredMeetings.find((m) => m.id === idCopySummary);
      if (row) await copyToClipboard(buildMeetingSummary(row), 'Resumen copiado para compartir por WhatsApp.');
    }
    if (idOpenRecording) {
      const row = filteredMeetings.find((m) => m.id === idOpenRecording);
      if (row?.recordingLink) window.open(row.recordingLink, '_blank', 'noopener,noreferrer');
    }
    if (idCopyRecording) {
      const row = filteredMeetings.find((m) => m.id === idCopyRecording);
      if (row?.recordingLink) await copyToClipboard(row.recordingLink, 'Link de grabación copiado.');
    }
    if (idSavePost) await savePostMeeting(idSavePost);
  });
}

function setupFlatpickr() {
  flatpickr.localize(flatpickr.l10ns.es);
  flatpickr('#meetingDate', {
    locale: 'es',
    altInput: true,
    altFormat: 'l, j \\d\\e F \\d\\e Y',
    dateFormat: 'Y-m-d',
  });
  flatpickr('#filterDate', {
    locale: 'es',
    altInput: true,
    altFormat: 'l, j \\d\\e F \\d\\e Y',
    dateFormat: 'Y-m-d',
    onChange: async (_, dateStr) => {
      activeFilterDate = dateStr || null;
      currentPage = 1;
      await fetchMeetings();
    },
    onDayCreate: (_, __, ___, dayElem) => {
      const dateKey = toDateKeyLocal(dayElem.dateObj);
      const count = dateMeetCounts[dateKey] || 0;
      if (!count) return;
      const badge = document.createElement('span');
      badge.className = 'day-meet-count';
      badge.textContent = String(count);
      dayElem.appendChild(badge);
    },
  });
}

(async function init() {
  showSpinner(true);
  setNextMeetingCounterLoading(true);
  setupFlatpickr();
  bindEvents();
  loadSlackSettings();
  await verifyRTDBAccess();
  await loadReferences();
  await refreshDateMeetCounts();
  await fetchMeetings();
})();
