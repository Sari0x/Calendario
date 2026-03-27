import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  get,
  getDatabase,
  limitToFirst,
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
const headerActionButtons = Array.from(document.querySelectorAll('.menu-actions button'));

let providers = [];
let participants = [];
let playlists = [];
let todos = [];
let meetings = [];
let filteredMeetings = [];
let countdownInterval = null;
let currentPage = 1;
let totalPages = 1;
let activeFilterDateRange = null;
let activeFilterProvider = '';
let activeFilterParticipant = '';
let activeFilterPlaylist = '';
let activeQuickFilter = 'upcoming';
let activeSection = 'hub';
let editingMeetingId = null;
let editingMeetingOriginalStartAt = null;
let editingProviderId = null;
let editingParticipantId = null;
let editingPlaylistId = null;
let editingTodoId = null;
const todoTaskPageMap = new Map();
let nearestMeetingId = null;
let uiTickerInterval = null;
const pendingFinishMeetingIds = new Set();
const expandedPostMeetingIds =
  globalThis.__expandedPostMeetingIds instanceof Set ? globalThis.__expandedPostMeetingIds : new Set();
globalThis.__expandedPostMeetingIds = expandedPostMeetingIds;
let baseMeetings = [];
let dateMeetCounts = {};
let meetingsCache = [];
let meetingsCacheLoaded = false;
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
  webex: 'https://tesrex.com/wp-content/uploads/2021/07/Webex-logo-new.png',
  discord:
    'https://static.vecteezy.com/system/resources/previews/023/986/880/non_2x/discord-logo-discord-logo-transparent-discord-icon-transparent-free-free-png.png',
  slack_huddles: 'https://www.itsconvo.com/_next/image?url=%2Fslack-logo.png&w=3840&q=75',
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

function formatRuntimeError(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') return error.message;
    try {
      return JSON.stringify(error);
    } catch {
      return 'Error no serializable.';
    }
  }
  return 'Error desconocido.';
}

function handleRuntimeError(error, fallbackMessage = 'Ocurrió un error inesperado.') {
  const detail = formatRuntimeError(error);
  console.error('[Calendario] Error capturado:', error);
  showNotice(`${fallbackMessage} ${detail}`);
}

function showSpinner(show) {
  spinner.classList.toggle('hidden', !show);
}

function showNotice(message) {
  appNotice.textContent = message;
  appNotice.classList.remove('hidden');
}

function setHeaderActionsDisabled(disabled) {
  headerActionButtons.forEach((button) => {
    button.disabled = disabled;
  });
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
  if (low.includes('webex.com') || low.includes('cisco.com/webex')) return 'webex';
  if (low.includes('discord.com') || low.includes('discord.gg')) return 'discord';
  if (low.includes('slack.com') && (low.includes('huddle') || low.includes('/client/'))) return 'slack_huddles';
  return null;
}

function meetingStatus(meeting) {
  if (meeting.finishedAt) return 'finished';
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
  if (diffMs <= 0) return '';

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (days === 0 && hours === 0 && minutes <= 0) return '';
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

function inDateRange(dateKey, range) {
  if (!range?.start || !range?.end) return true;
  return dateKey >= range.start && dateKey <= range.end;
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

async function getMeetingsData({ forceRefresh = false } = {}) {
  if (!forceRefresh && meetingsCacheLoaded) {
    return [...meetingsCache];
  }
  const rows = await loadCollection('meetings');
  meetingsCache = rows;
  meetingsCacheLoaded = true;
  return [...meetingsCache];
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

async function loadSlackSettings() {
  try {
    const snap = await get(ref(rtdb, 'settings/slack'));
    const saved = snap.val() || {};
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

async function saveSlackSettings() {
  await set(ref(rtdb, 'settings/slack'), {
    webhookUrl: slackSettings.webhookUrl || '',
    appScriptUrl: slackSettings.appScriptUrl || '',
    updatedAt: new Date().toISOString(),
  });
}

function buildSlackPayload(meeting, options = {}) {
  const { mode = 'create', previousStartAt = null } = options;
  return {
    webhookUrl: slackSettings.webhookUrl,
    type: mode === 'update' ? 'update_meeting' : 'create_meeting',
    reminderMinutes: Number(meeting.slackReminderMinutes || 15),
    previousStartAt,
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

  $('playlistsCreatedList').innerHTML = playlists.length
    ? playlists
        .map(
          (p) =>
            `<div class="created-item"><span class="name"><strong>${p.name}</strong><small>${p.description || ''}</small></span><button class="btn btn-ghost btn-xs" data-edit-playlist="${p.id}">Editar</button><button class="btn btn-ghost btn-xs" data-delete-playlist="${p.id}">Eliminar</button></div>`,
        )
        .join('')
    : '<small>Sin listas creadas.</small>';
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

function resetPlaylistForm() {
  editingPlaylistId = null;
  $('playlistsForm').reset();
  $('playlistsForm').querySelector('h3').textContent = 'Nueva lista de reproducción';
  $('savePlaylist').textContent = 'Guardar';
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

function openPlaylistsModal(editId = null) {
  resetPlaylistForm();
  renderCreatedLists();
  if (editId) {
    const row = playlists.find((p) => p.id === editId);
    if (row) {
      editingPlaylistId = editId;
      $('playlistName').value = row.name || '';
      $('playlistDescription').value = row.description || '';
      $('playlistsForm').querySelector('h3').textContent = 'Editar lista de reproducción';
      $('savePlaylist').textContent = 'Actualizar';
    }
  }
  $('playlistsModal').showModal();
}

function statusMeta(status) {
  if (status === 'finished') return { text: 'Finalizada', cls: 'finished', icon: 'bi-check2-circle' };
  if (status === 'in_progress') return { text: '', cls: 'in-progress', icon: 'bi-play-fill' };
  if (status === 'today') return { text: 'Hoy', cls: 'today', icon: 'bi-sun-fill' };
  return { text: 'Próxima', cls: 'upcoming', icon: 'bi-calendar2-event' };
}

function playlistSelectOptions(selectedId = '') {
  const rows = ['<option value="">Sin lista de reproducción</option>'];
  playlists.forEach((playlist) => {
    rows.push(`<option value="${playlist.id}" ${playlist.id === selectedId ? 'selected' : ''}>${playlist.name}</option>`);
  });
  rows.push('<option value="__new__">+ Agregar nueva</option>');
  return rows.join('');
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
  const playlistBadge = meeting.playlistName
    ? `<span class="badge playlist"><i class="bi bi-collection-play"></i> ${meeting.playlistName}</span>`
    : '';

  return `<article class="meeting-item status-${meta.cls} ${isFinished ? 'disabled' : ''} ${isNearest ? 'is-nearest' : ''}">
    <div class="meeting-top">
      <strong><i class="bi bi-clock-history"></i> ${esFmt.format(new Date(meeting.startAt))}</strong>
      <div class="top-badges">
        ${isNearest ? '<span class="badge nearest"><i class="bi bi-stars"></i> Próximo meet</span>' : ''}
        <span class="badge ${meta.cls}"><i class="bi ${meta.icon}"></i>${meta.text ? ` ${meta.text}` : ''}</span>
        ${playlistBadge}
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
      ${isFinished ? `<button class="btn btn-soft btn-soft-radius" data-edit-finished-playlist="${meeting.id}"><i class="bi bi-collection-play"></i> Lista</button>` : ''}
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
              <label>Lista de reproducción
                <div class="playlist-inline-wrap">
                  <select data-post-playlist="${meeting.id}">${playlistSelectOptions(meeting.playlistId || '')}</select>
                  <button class="btn btn-pill btn-ghost btn-subtle" type="button" data-post-new-playlist="${meeting.id}"><i class="bi bi-plus-lg"></i> Agregar nueva</button>
                </div>
              </label>
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

function refreshLiveMeetingsView() {
  const rows = [...baseMeetings];
  updateQuickFilterCounts(rows);
  filteredMeetings = sortMeetings(applyQuickFilter(rows));
  if (currentPage > Math.max(Math.ceil(filteredMeetings.length / pageSize), 1)) {
    currentPage = 1;
  }
  renderCurrentPage();
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
  $('filterPlaylist').innerHTML = `<option value="">Lista de reproducción</option>${playlists
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('')}`;
  $('meetingPlaylistSelect').innerHTML = `<option value="">Sin lista de reproducción</option>${playlists
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('')}`;
  $('filterProvider').value = activeFilterProvider;
  $('filterParticipant').value = activeFilterParticipant;
  $('filterPlaylist').value = activeFilterPlaylist;
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
  const compact = nextMeeting ? countdownCompactLabel(nextMeeting.startAt) : '';
  if (!nextMeeting || !compact) {
    counter.classList.add('hidden');
    counter.textContent = '';
    return;
  }
  counter.classList.remove('hidden');
  counter.innerHTML = `<i class="bi bi-alarm"></i> Próxima en ${compact}`;
}

function setNextMeetingCounterLoading(show) {
  const counter = $('nextMeetingCounter');
  if (show) {
    counter.classList.remove('hidden');
    counter.innerHTML = '<span class="spinner mini"></span> Cargando próxima...';
    return;
  }
  if (counter.textContent.includes('Cargando próxima')) {
    counter.textContent = '';
    counter.classList.add('hidden');
  } else if (!counter.textContent.trim()) {
    counter.classList.add('hidden');
  }
}

function startUiTicker() {
  if (uiTickerInterval) window.clearInterval(uiTickerInterval);
  uiTickerInterval = window.setInterval(() => {
    refreshLiveMeetingsView();
    renderTodoList();
  }, 60000);
}

function getTodoProgress(todo) {
  const tasks = todo.tasks || [];
  if (!tasks.length) return 0;
  const completed = tasks.filter((task) => task.done || isTaskOverdue(task)).length;
  return Math.round((completed / tasks.length) * 100);
}

function isTaskOverdue(task) {
  if (!task?.endDate) return false;
  if (task.done) return false;
  const end = new Date(`${task.endDate}T23:59:59`);
  return Date.now() > end.getTime();
}

function todoCard(todo) {
  const progress = getTodoProgress(todo);
  const completed = progress === 100;
  const totalTasks = todo.tasks?.length || 0;
  const completedTasks = (todo.tasks || []).filter((task) => task.done || isTaskOverdue(task)).length;
  const hasOverdue = (todo.tasks || []).some((task) => isTaskOverdue(task));
  const perPage = 15;
  const totalPages = Math.max(Math.ceil(totalTasks / perPage), 1);
  const currentPage = Math.min(todoTaskPageMap.get(todo.id) || 1, totalPages);
  const start = (currentPage - 1) * perPage;
  const visibleTasks = (todo.tasks || []).slice(start, start + perPage);
  return `<article class="todo-item ${hasOverdue ? 'is-overdue' : ''}">
    ${todo.cover ? `<img class="todo-cover" src="${todo.cover}" alt="${todo.title}" />` : ''}
    <div class="todo-main">
      <div class="todo-top"><strong>${todo.title}</strong>${completed ? '<span class="badge finished"><i class="bi bi-check2-circle"></i> Completado</span>' : ''}</div>
      <div class="todo-meta">
        <span><i class="bi bi-list-task"></i> ${totalTasks} tareas</span>
        <span><i class="bi bi-check2-square"></i> ${completedTasks}/${totalTasks} avanzadas</span>
        <span><i class="bi bi-graph-up"></i> ${progress}%</span>
      </div>
      <div class="todo-progress">
        <div class="todo-progress-bar" style="width:${progress}%"></div>
      </div>
      <div class="todo-checks">
        ${visibleTasks
          .map(
            (task, idx) => `<div class="todo-task-row ${isTaskOverdue(task) ? 'is-overdue' : ''}">
              <label class="todo-check">
                <input type="checkbox" data-todo-task="${todo.id}" data-task-index="${start + idx}" ${task.done ? 'checked' : ''} />
                <span>${task.title}</span>
              </label>
              <div class="todo-task-dates">
                <span><i class="bi bi-calendar-range"></i> ${task.startDate || 'Sin desde'} → ${task.endDate || 'Sin hasta'}</span>
              </div>
              <div class="todo-task-actions">
                ${isTaskOverdue(task) ? '<span class="todo-overdue-label">Vencida</span>' : ''}
                <button class="btn btn-pill btn-ghost btn-subtle" data-edit-task="${todo.id}" data-task-index="${start + idx}" type="button"><i class="bi bi-pencil-square"></i> Editar</button>
              </div>
            </div>`,
          )
          .join('')}
      </div>
      ${
        totalPages > 1
          ? `<div class="todo-pagination">
              <button class="btn btn-pill btn-ghost btn-subtle" data-todo-page-prev="${todo.id}" ${currentPage === 1 ? 'disabled' : ''}>Anterior</button>
              <span>Página ${currentPage} de ${totalPages}</span>
              <button class="btn btn-pill btn-ghost btn-subtle" data-todo-page-next="${todo.id}" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente</button>
            </div>`
          : ''
      }
      <div class="todo-actions">
        <button class="btn btn-pill btn-ghost btn-subtle" data-delete-todo="${todo.id}"><i class="bi bi-trash3"></i> Eliminar</button>
      </div>
    </div>
  </article>`;
}

function createTaskRow(task = {}) {
  return `<div class="task-form-row">
    <input type="text" data-task-field="title" placeholder="Título de tarea" value="${task.title || ''}" />
    <input type="date" data-task-field="startDate" value="${task.startDate || ''}" />
    <input type="date" data-task-field="endDate" value="${task.endDate || ''}" />
    <button type="button" class="btn btn-pill btn-ghost" data-remove-task-row><i class="bi bi-trash3"></i></button>
  </div>`;
}

function renderTodoTaskRows(tasks = []) {
  const rows = tasks.length ? tasks : [{ title: '', startDate: '', endDate: '' }];
  $('todoTaskRows').innerHTML = rows.map((task) => createTaskRow(task)).join('');
  initTodoTaskDatePickers();
}

function initTodoTaskDatePickers() {
  document.querySelectorAll('#todoTaskRows input[data-task-field="startDate"], #todoTaskRows input[data-task-field="endDate"]').forEach((input) => {
    if (input._flatpickr) return;
    flatpickr(input, {
      locale: 'es',
      dateFormat: 'Y-m-d',
      allowInput: true,
      appendTo: $('todoModal'),
    });
  });
}

function collectTodoTasksFromForm() {
  return Array.from(document.querySelectorAll('#todoTaskRows .task-form-row'))
    .map((row) => ({
      title: row.querySelector('[data-task-field="title"]')?.value.trim() || '',
      startDate: row.querySelector('[data-task-field="startDate"]')?.value || '',
      endDate: row.querySelector('[data-task-field="endDate"]')?.value || '',
      done: false,
    }))
    .filter((task) => task.title);
}

function showTodoModalNotice(message = '') {
  const notice = $('todoModalNotice');
  if (!notice) return;
  if (!message) {
    notice.textContent = '';
    notice.classList.add('hidden');
    return;
  }
  notice.textContent = message;
  notice.classList.remove('hidden');
}

function normalizeExcelDate(value) {
  if (!value) return '';
  if (typeof value === 'number' && globalThis.XLSX?.SSF) {
    const parsed = globalThis.XLSX.SSF.parse_date_code(value);
    if (!parsed) return '';
    return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const asString = String(value).trim();
  const slash = asString.match(/^(\\d{1,2})[/-](\\d{1,2})[/-](\\d{2,4})$/);
  if (slash) {
    const day = slash[1].padStart(2, '0');
    const month = slash[2].padStart(2, '0');
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${month}-${day}`;
  }
  const date = new Date(asString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

async function importTodoTasksFromXlsx() {
  const file = $('todoTasksXlsx').files?.[0];
  if (!file) {
    showTodoModalNotice('Seleccioná un archivo XLSX primero para importar tareas.');
    return;
  }
  showTodoModalNotice('');
  const buffer = await file.arrayBuffer();
  const workbook = globalThis.XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = globalThis.XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
  const mapped = rows
    .map((row) => ({
      title: String(row.Titulo || row.Título || row.titulo || '').trim(),
      startDate: normalizeExcelDate(row.Desde || row.desde),
      endDate: normalizeExcelDate(row.Hasta || row.hasta),
    }))
    .filter((row) => row.title);
  if (!mapped.length) {
    showTodoModalNotice('No encontré tareas válidas. Usá columnas: Titulo | Desde | Hasta.');
    return;
  }
  renderTodoTaskRows(mapped);
  showTodoModalNotice(`${mapped.length} tareas importadas correctamente.`);
}

function renderTodoList() {
  const list = $('todoList');
  if (!list) return;
  list.innerHTML = todos.length ? todos.map(todoCard).join('') : '<p>No hay checklist creados.</p>';
}

async function loadReferences() {
  const [loadedProviders, loadedParticipants, loadedPlaylists, loadedTodos] = await Promise.all([
    loadCollection('providers'),
    loadCollection('participants'),
    loadCollection('playlists'),
    loadCollection('todos'),
  ]);
  providers = loadedProviders;
  participants = loadedParticipants;
  playlists = loadedPlaylists;
  todos = loadedTodos.map((todo) => ({
    ...todo,
    tasks: Array.isArray(todo.tasks)
      ? todo.tasks
      : Array.isArray(todo.items)
        ? todo.items.map((item) => ({ title: item.text || '', startDate: '', endDate: '', done: Boolean(item.done) }))
        : [],
  }));
  renderFilterOptions();
  renderPickers();
  renderTodoList();
  if (filteredMeetings.length || meetingsList.innerHTML) renderCurrentPage();
}

async function fetchMeetings({ forceRefresh = false } = {}) {
  showSpinner(true);
  setNextMeetingCounterLoading(true);
  meetingsList.innerHTML = '';
  try {
    let rows = await getMeetingsData({ forceRefresh });
    refreshDateMeetCounts(rows);

    if (activeFilterDateRange?.start && activeFilterDateRange?.end) {
      rows = rows.filter((row) => {
        const key = row.dateKey || toDateKeyLocal(new Date(row.startAt));
        return inDateRange(key, activeFilterDateRange);
      });
    }

    if (activeFilterProvider) {
      rows = rows.filter((row) => (row.providers || []).some((p) => p.id === activeFilterProvider));
    }
    if (activeFilterParticipant) {
      rows = rows.filter((row) => (row.participants || []).some((p) => p.id === activeFilterParticipant));
    }
    if (activeFilterPlaylist) {
      rows = rows.filter((row) => row.playlistId === activeFilterPlaylist);
    }

    baseMeetings = [...rows];
    updateQuickFilterCounts(rows);
    filteredMeetings = sortMeetings(applyQuickFilter(rows));
    renderCurrentPage();
  } catch (error) {
    showNotice('No se pudieron cargar reuniones desde Realtime Database.');
    meetingsList.innerHTML = `<div class="meetings-error-state">
      <i class="bi bi-wifi-off meetings-error-icon"></i>
      <h3>No se pudieron cargar reuniones</h3>
      <p>Revisá la conexión o intentá nuevamente.</p>
      <button class="btn btn-pill btn-primary" data-retry-fetch>
        <i class="bi bi-arrow-clockwise"></i> Reintentar
      </button>
    </div>`;
    console.error(error);
  } finally {
    $('filterPlaylist').classList.toggle('hidden', activeQuickFilter !== 'recordings');
    showSpinner(false);
    setNextMeetingCounterLoading(false);
  }
}

function refreshDateMeetCounts(rows = meetingsCache) {
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

async function onSavePlaylist(e) {
  e.preventDefault();
  const name = $('playlistName').value.trim();
  const description = $('playlistDescription').value.trim();
  if (!name) return;
  if (editingPlaylistId) {
    await update(ref(rtdb, `playlists/${editingPlaylistId}`), { name, description, updatedAt: new Date().toISOString() });
  } else {
    await saveCollectionItem('playlists', { name, description });
  }
  $('playlistsModal').close();
  resetPlaylistForm();
  await loadReferences();
}

async function deletePlaylist(id) {
  const result = await IOSSwal.fire({
    title: '¿Estas seguro?',
    text: 'Se eliminará la lista de reproducción.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, eliminar',
    cancelButtonText: 'Cancelar',
  });
  if (!result.isConfirmed) return;
  await remove(ref(rtdb, `playlists/${id}`));
  await loadReferences();
  await fetchMeetings({ forceRefresh: true });
}

async function onSaveTodo(e) {
  e.preventDefault();
  showTodoModalNotice('');
  const title = $('todoTitle').value.trim();
  const coverUrl = $('todoCover').value.trim();
  const coverFile = $('todoCoverFile').files?.[0];
  let cover = coverUrl;
  const tasks = collectTodoTasksFromForm();
  if (!title) return;
  if (coverFile) {
    $('todoCoverUploadSpinner').classList.remove('hidden');
    $('saveTodo').disabled = true;
    try {
      const filePath = `todo-covers/${Date.now()}-${coverFile.name.replace(/\\s+/g, '-')}`;
      const uploaded = await uploadBytes(storageRef(storage, filePath), coverFile);
      cover = await getDownloadURL(uploaded.ref);
    } finally {
      $('todoCoverUploadSpinner').classList.add('hidden');
      $('saveTodo').disabled = false;
    }
  }
  if (!tasks.length) {
    showTodoModalNotice('Agregá al menos una tarea para guardar el módulo.');
    return;
  }
  const payload = { title, cover, tasks };
  if (editingTodoId) {
    await update(ref(rtdb, `todos/${editingTodoId}`), { ...payload, updatedAt: new Date().toISOString() });
  } else {
    await saveCollectionItem('todos', payload);
  }
  $('todoModal').close();
  editingTodoId = null;
  $('todoForm').reset();
  $('todoCoverFile').value = '';
  renderTodoTaskRows();
  await loadReferences();
}

async function editTodoTask(todoId, taskIndex) {
  const todo = todos.find((row) => row.id === todoId);
  const task = todo?.tasks?.[taskIndex];
  if (!todo || !task) return;
  const { value: data, isConfirmed } = await IOSSwal.fire({
    title: 'Editar tarea',
    html: `
      <input id="swTaskTitle" class="swal2-input" placeholder="Título" value="${task.title || ''}" />
      <input id="swTaskStart" class="swal2-input" type="date" value="${task.startDate || ''}" />
      <input id="swTaskEnd" class="swal2-input" type="date" value="${task.endDate || ''}" />
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: 'Guardar',
    cancelButtonText: 'Cancelar',
    preConfirm: () => ({
      title: document.getElementById('swTaskTitle')?.value.trim() || '',
      startDate: document.getElementById('swTaskStart')?.value || '',
      endDate: document.getElementById('swTaskEnd')?.value || '',
    }),
  });
  if (!isConfirmed || !data?.title) return;
  const tasks = [...todo.tasks];
  tasks[taskIndex] = {
    ...tasks[taskIndex],
    title: data.title,
    startDate: data.startDate,
    endDate: data.endDate,
    done: false,
  };
  await update(ref(rtdb, `todos/${todoId}`), { tasks, updatedAt: new Date().toISOString() });
  await loadReferences();
}

function switchSection(section) {
  activeSection = section;
  const isHub = section === 'hub';
  $('folderNovoHub').classList.toggle('active', isHub);
  $('folderTodoNovo').classList.toggle('active', !isHub);
  $('folderNovoHub').setAttribute('aria-selected', String(isHub));
  $('folderTodoNovo').setAttribute('aria-selected', String(!isHub));
  $('meetingFormSection').classList.toggle('hidden', !isHub);
  $('meetingsSection').classList.toggle('hidden', !isHub);
  $('todoSection').classList.toggle('hidden', isHub);
  $('nextMeetingCounter').classList.toggle('hidden', !isHub || !$('nextMeetingCounter').textContent.trim());
  $('todoBackWrap').classList.toggle('hidden', isHub);
  $('openMeetingForm').classList.toggle('hidden', !isHub);
  $('openProvidersModal').classList.toggle('hidden', !isHub);
  $('openParticipantsModal').classList.toggle('hidden', !isHub);
  $('openPlaylistsModal').classList.toggle('hidden', !isHub);
  $('openSlackConfigModal').classList.toggle('hidden', !isHub);
  document.querySelector('.menu-separator')?.classList.toggle('hidden', !isHub);
  renderTodoList();
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
  $('meetingPlaylistSelect').value = '';
  setSelectedIds('provider', new Set());
  setSelectedIds('participant', new Set());
  pickerUiState.provider.query = '';
  pickerUiState.participant.query = '';
  pickerUiState.provider.open = false;
  pickerUiState.participant.open = false;
  editingMeetingId = null;
  editingMeetingOriginalStartAt = null;
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
      $('meetingPlaylistSelect').value ||
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
  const selectedPlaylistId = $('meetingPlaylistSelect').value;
  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId);

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
    playlistId: selectedPlaylist?.id || '',
    playlistName: selectedPlaylist?.name || '',
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
      await notifySlackViaAppScript(
        buildSlackPayload(
          { ...payload, id: meetingId },
          {
            mode: editingMeetingId ? 'update' : 'create',
            previousStartAt: editingMeetingOriginalStartAt,
          },
        ),
      );
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
  await fetchMeetings({ forceRefresh: true });
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
  $('meetingPlaylistSelect').value = row.playlistId || '';
  setSelectedIds('provider', new Set((row.providers || []).map((p) => p.id)));
  setSelectedIds('participant', new Set((row.participants || []).map((p) => p.id)));
  editingMeetingId = id;
  editingMeetingOriginalStartAt = row.startAt || null;
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
  await fetchMeetings({ forceRefresh: true });
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
    await update(ref(rtdb, `meetings/${id}`), {
      duration: elapsedMin,
      finishedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await fetchMeetings({ forceRefresh: true });
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
  const playlistSelect = document.querySelector(`[data-post-playlist="${id}"]`);
  if (!linkInput || !commentInput) return;
  const playlistId = playlistSelect?.value && playlistSelect.value !== '__new__' ? playlistSelect.value : '';
  const selectedPlaylist = playlists.find((p) => p.id === playlistId);
  await update(ref(rtdb, `meetings/${id}`), {
    recordingLink: linkInput.value.trim(),
    postComment: commentInput.value.trim(),
    playlistId: selectedPlaylist?.id || '',
    playlistName: selectedPlaylist?.name || '',
    updatedAt: new Date().toISOString(),
  });
  await IOSSwal.fire({ icon: 'success', title: 'Guardado', timer: 1100, showConfirmButton: false });
  await fetchMeetings({ forceRefresh: true });
}

async function editFinishedMeetingPlaylist(id) {
  const row = filteredMeetings.find((m) => m.id === id);
  if (!row) return;
  const options = playlists.reduce((acc, playlist) => {
    acc[playlist.id] = playlist.name;
    return acc;
  }, { '': 'Sin lista de reproducción' });

  const result = await IOSSwal.fire({
    title: 'Asignar lista de reproducción',
    input: 'select',
    inputOptions: options,
    inputValue: row.playlistId || '',
    showCancelButton: true,
    confirmButtonText: 'Guardar',
    cancelButtonText: 'Cancelar',
  });
  if (!result.isConfirmed) return;
  const selected = playlists.find((p) => p.id === result.value);
  await update(ref(rtdb, `meetings/${id}`), {
    playlistId: selected?.id || '',
    playlistName: selected?.name || '',
    updatedAt: new Date().toISOString(),
  });
  await fetchMeetings({ forceRefresh: true });
}

async function editFinishedMeetingPlaylist(id) {
  const row = filteredMeetings.find((m) => m.id === id);
  if (!row) return;
  const options = playlists.reduce((acc, playlist) => {
    acc[playlist.id] = playlist.name;
    return acc;
  }, { '': 'Sin lista de reproducción' });

  const result = await IOSSwal.fire({
    title: 'Asignar lista de reproducción',
    input: 'select',
    inputOptions: options,
    inputValue: row.playlistId || '',
    showCancelButton: true,
    confirmButtonText: 'Guardar',
    cancelButtonText: 'Cancelar',
  });
  if (!result.isConfirmed) return;
  const selected = playlists.find((p) => p.id === result.value);
  await update(ref(rtdb, `meetings/${id}`), {
    playlistId: selected?.id || '',
    playlistName: selected?.name || '',
    updatedAt: new Date().toISOString(),
  });
  await fetchMeetings({ forceRefresh: true });
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
  document.querySelectorAll('.brand-logo').forEach((logo) => {
    logo.addEventListener('click', () => {
      window.location.href = './index.html';
    });
  });

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
  $('openPlaylistsModal').addEventListener('click', () => openPlaylistsModal());
  $('addPlaylistInline').addEventListener('click', () => openPlaylistsModal());
  $('openSlackConfigModal').addEventListener('click', async () => {
    await loadSlackSettings();
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
  $('cancelPlaylist').addEventListener('click', () => {
    $('playlistsModal').close();
    resetPlaylistForm();
  });
  $('cancelSlackConfig').addEventListener('click', () => $('slackConfigModal').close());
  $('cancelTodo').addEventListener('click', () => {
    $('todoModal').close();
    editingTodoId = null;
    $('todoForm').reset();
    $('todoTasksXlsx').value = '';
    $('todoCoverFile').value = '';
    showTodoModalNotice('');
    renderTodoTaskRows();
  });

  $('providersForm').addEventListener('submit', onSaveProvider);
  $('participantsForm').addEventListener('submit', onSaveParticipant);
  $('playlistsForm').addEventListener('submit', onSavePlaylist);
  $('todoForm').addEventListener('submit', onSaveTodo);
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
    await saveSlackSettings();
    await new Promise((resolve) => setTimeout(resolve, 350));
    $('saveSlackConfig').disabled = false;
    $('saveSlackConfig').textContent = 'Guardar';
    $('slackConfigModal').close();
    await IOSSwal.fire({ icon: 'success', title: 'Configuración guardada', timer: 1000, showConfirmButton: false });
  });
  $('saveMeeting').addEventListener('click', onSaveMeeting);
  $('openTodoModal').addEventListener('click', () => {
    editingTodoId = null;
    $('todoForm').reset();
    $('todoTasksXlsx').value = '';
    $('todoCoverFile').value = '';
    showTodoModalNotice('');
    renderTodoTaskRows();
    $('todoModal').showModal();
  });
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
  $('playlistsCreatedList').addEventListener('click', async (e) => {
    const idDelete = e.target?.dataset?.deletePlaylist;
    const idEdit = e.target?.dataset?.editPlaylist;
    if (idEdit) openPlaylistsModal(idEdit);
    if (idDelete) await deletePlaylist(idDelete);
  });

  $('clearFilter').addEventListener('click', async () => {
    $('filterDate')._flatpickr?.clear();
    activeFilterDateRange = null;
    activeFilterProvider = '';
    activeFilterParticipant = '';
    activeFilterPlaylist = '';
    $('filterProvider').value = '';
    $('filterParticipant').value = '';
    $('filterPlaylist').value = '';
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
  $('filterPlaylist').addEventListener('change', async (e) => {
    activeFilterPlaylist = e.target.value;
    currentPage = 1;
    await fetchMeetings();
  });

  $('quickFilters').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    activeQuickFilter = btn.dataset.filter;
    if (activeQuickFilter !== 'recordings') {
      activeFilterPlaylist = '';
      $('filterPlaylist').value = '';
    }
    currentPage = 1;
    document.querySelectorAll('.quick-filter').forEach((item) => item.classList.toggle('active', item === btn));
    btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    await fetchMeetings();
  });

  $('folderNovoHub').addEventListener('click', () => switchSection('hub'));
  $('folderTodoNovo').addEventListener('click', () => switchSection('todo'));
  $('backToNovoHub').addEventListener('click', () => switchSection('hub'));
  $('addTodoTaskRow').addEventListener('click', () => {
    $('todoTaskRows').insertAdjacentHTML('beforeend', createTaskRow());
    initTodoTaskDatePickers();
  });
  $('importTodoTasksXlsx').addEventListener('click', importTodoTasksFromXlsx);
  $('todoTaskRows').addEventListener('click', (e) => {
    if (!e.target.closest('[data-remove-task-row]')) return;
    const rows = Array.from(document.querySelectorAll('#todoTaskRows .task-form-row'));
    if (rows.length <= 1) return;
    e.target.closest('.task-form-row')?.remove();
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
    if (e.target.closest('[data-retry-fetch]')) {
      await fetchMeetings({ forceRefresh: true });
      return;
    }
    const idRes = e.target.closest('[data-reschedule]')?.dataset?.reschedule;
    const idEdit = e.target.closest('[data-edit]')?.dataset?.edit;
    const idDelete = e.target.closest('[data-delete]')?.dataset?.delete;
    const idFinish = e.target.closest('[data-finish-now]')?.dataset?.finishNow;
    const idCopyLink = e.target.closest('[data-copy-link]')?.dataset?.copyLink;
    const idCopySummary = e.target.closest('[data-copy-summary]')?.dataset?.copySummary;
    const idSavePost = e.target.closest('[data-save-post]')?.dataset?.savePost;
    const idFinishedPlaylist = e.target.closest('[data-edit-finished-playlist]')?.dataset?.editFinishedPlaylist;
    const idPostNewPlaylist = e.target.closest('[data-post-new-playlist]')?.dataset?.postNewPlaylist;
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
    if (idFinishedPlaylist) await editFinishedMeetingPlaylist(idFinishedPlaylist);
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
    if (idPostNewPlaylist) {
      openPlaylistsModal();
      return;
    }
    if (idSavePost) await savePostMeeting(idSavePost);
  });

  meetingsList.addEventListener('change', (e) => {
    const playlistSelect = e.target.closest('[data-post-playlist]');
    if (!playlistSelect) return;
    if (playlistSelect.value === '__new__') {
      openPlaylistsModal();
      const meetingId = playlistSelect.dataset.postPlaylist;
      const row = filteredMeetings.find((m) => m.id === meetingId);
      playlistSelect.value = row?.playlistId || '';
    }
  });

  $('todoList').addEventListener('click', async (e) => {
    const deleteId = e.target.closest('[data-delete-todo]')?.dataset?.deleteTodo;
    const pagePrev = e.target.closest('[data-todo-page-prev]')?.dataset?.todoPagePrev;
    const pageNext = e.target.closest('[data-todo-page-next]')?.dataset?.todoPageNext;
    const taskEditBtn = e.target.closest('[data-edit-task]');
    const todoId = taskEditBtn?.dataset?.editTask;
    const taskIndex = Number(taskEditBtn?.dataset?.taskIndex);
    if (pagePrev) {
      todoTaskPageMap.set(pagePrev, Math.max((todoTaskPageMap.get(pagePrev) || 1) - 1, 1));
      renderTodoList();
      return;
    }
    if (pageNext) {
      todoTaskPageMap.set(pageNext, (todoTaskPageMap.get(pageNext) || 1) + 1);
      renderTodoList();
      return;
    }
    if (deleteId) {
      await remove(ref(rtdb, `todos/${deleteId}`));
      todoTaskPageMap.delete(deleteId);
      await loadReferences();
      return;
    }
    if (todoId && !Number.isNaN(taskIndex)) await editTodoTask(todoId, taskIndex);
  });

  $('todoList').addEventListener('change', async (e) => {
    const todoId = e.target?.dataset?.todoTask;
    const taskIndex = Number(e.target?.dataset?.taskIndex);
    if (!todoId || Number.isNaN(taskIndex)) return;
    const todo = todos.find((row) => row.id === todoId);
    if (!todo) return;
    const tasks = [...(todo.tasks || [])];
    if (!tasks[taskIndex]) return;
    tasks[taskIndex] = { ...tasks[taskIndex], done: e.target.checked };
    await update(ref(rtdb, `todos/${todoId}`), { tasks, updatedAt: new Date().toISOString() });
    await loadReferences();
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
    mode: 'range',
    altInput: true,
    altFormat: 'j M Y',
    dateFormat: 'Y-m-d',
    onChange: async (selectedDates) => {
      if (selectedDates.length === 2) {
        const [from, to] = selectedDates;
        const start = toDateKeyLocal(from <= to ? from : to);
        const end = toDateKeyLocal(from <= to ? to : from);
        activeFilterDateRange = { start, end };
      } else if (selectedDates.length === 1) {
        const single = toDateKeyLocal(selectedDates[0]);
        activeFilterDateRange = { start: single, end: single };
      } else {
        activeFilterDateRange = null;
      }
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
  setHeaderActionsDisabled(true);
  showSpinner(true);
  setNextMeetingCounterLoading(true);
  try {
    setupFlatpickr();
    bindEvents();
    renderTodoTaskRows();
    switchSection('hub');
    await verifyRTDBAccess();
    await Promise.all([loadSlackSettings(), loadReferences(), fetchMeetings({ forceRefresh: true })]);
  } catch (error) {
    handleRuntimeError(error, 'No se pudo inicializar la aplicación.');
  } finally {
    setHeaderActionsDisabled(false);
  }
})();

window.addEventListener('unhandledrejection', (event) => {
  handleRuntimeError(event.reason, 'Se detectó un error asíncrono en la app.');
});
