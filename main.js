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
  set,
  update,
  remove,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';

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
const pageSize = 6;

const $ = (id) => document.getElementById(id);
const spinner = $('spinner');
const meetingsList = $('meetingsList');
const pageInfo = $('pageInfo');
const appNotice = $('appNotice');

let providers = [];
let participants = [];
let meetings = [];
let currentPage = 1;
let totalPages = 1;
let activeFilterDate = null;
let editingMeetingId = null;
let editingProviderId = null;
let editingParticipantId = null;

const pickerUiState = {
  provider: { query: '', open: false },
  participant: { query: '', open: false },
};

const providerIcons = {
  meet: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Google_Meet_icon_%282020%29.svg/960px-Google_Meet_icon_%282020%29.svg.png',
  teams:
    'https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/Microsoft_Office_Teams_%282025%E2%80%93present%29.svg/3840px-Microsoft_Office_Teams_%282025%E2%80%93present%29.svg.png',
  zoom: 'https://upload.wikimedia.org/wikipedia/commons/2/24/Zoom-Logo.png',
};

const esFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full', timeStyle: 'short' });

function showSpinner(show) {
  spinner.classList.toggle('hidden', !show);
}

function showNotice(message) {
  appNotice.textContent = message;
  appNotice.classList.remove('hidden');
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
  if (end < now) return 'vencida';
  if (start <= now && now < end) return 'en-curso';
  if (today) return 'hoy';
  return 'proxima';
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
    isProvider,
    containerId: isProvider ? 'providersPicker' : 'participantsPicker',
    list: isProvider ? providers : participants,
    openLabel: isProvider ? '+ Proveedor' : '+ Participante',
    addLabel: isProvider ? '+ Agregar nuevo proveedor' : '+ Agregar nuevo participante',
  };
}

function getSelectedIds(type) {
  const { containerId } = getPickerMeta(type);
  const selected = ($(containerId).dataset.selected || '').split(',').filter(Boolean);
  return new Set(selected);
}

function setSelectedIds(type, idsSet) {
  const { containerId } = getPickerMeta(type);
  $(containerId).dataset.selected = [...idsSet].join(',');
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
  return `<button type="button" class="picker-suggestion" data-select-${type}="${item.id}">${visualizeItem(item, type)}<span>${itemLabel(item, type)}</span></button>`;
}

function buildSelectedPill(item, type) {
  return `<span class="option-chip picker-pill">${visualizeItem(item, type)}<span class="chip-text">${itemLabel(item, type)}</span><button type="button" class="pill-remove" aria-label="Quitar" data-remove-${type}="${item.id}">×</button></span>`;
}

function buildPicker(type) {
  const { containerId, list, addLabel } = getPickerMeta(type);
  const { query, open } = pickerUiState[type];
  const selectedIds = getSelectedIds(type);
  const selectedItems = list.filter((item) => selectedIds.has(item.id));
  const availableItems = list.filter((item) => {
    if (selectedIds.has(item.id)) return false;
    return itemLabel(item, type).toLowerCase().includes(query.toLowerCase());
  });

  const suggestions = availableItems.map((item) => buildSuggestionRow(item, type)).join('');
  const noItems = '<div class="picker-empty">No hay coincidencias.</div>';

  $(containerId).innerHTML = `
    <div class="picker-shell ${open ? 'is-open' : ''}" data-picker-shell="${type}">
      <div class="picker-selected-wrap">${selectedItems.map((item) => buildSelectedPill(item, type)).join('')}</div>
      <input type="text" class="picker-input" data-picker-input="${type}" placeholder="Escribí para buscar..." value="${query}" />
      <div class="picker-suggestions ${open ? '' : 'hidden'}" data-picker-suggestions="${type}">
        ${suggestions || noItems}
        <button type="button" class="picker-suggestion picker-add" data-add-${type}="true">${addLabel}</button>
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
            `<div class="created-item"><span class="avatar" style="background:${p.color}">${p.initials}</span><span class="name">${p.name} ${p.lastName}</span><button class="btn btn-ghost btn-xs" data-edit-participant="${p.id}">Editar</button><button class="btn btn-ghost btn-xs" data-delete-participant="${p.id}">Eliminar</button></div>`,
        )
        .join('')
    : '<small>Sin participantes creados.</small>';
}

function resetProviderForm() {
  editingProviderId = null;
  $('providersForm').reset();
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

function badge(label, cls) {
  return `<span class="badge ${cls}">${label}</span>`;
}

function meetingCard(meeting) {
  const status = meetingStatus(meeting);
  const disabled = status === 'vencida';
  const providersHtml = (meeting.providers || [])
    .map((p) => `<span class="option-chip"><img class="provider-img" src="${p.image}" alt="${p.name}"/><span class="chip-text">${p.name}</span></span>`)
    .join('');
  const participantsHtml = (meeting.participants || [])
    .map(
      (p) =>
        `<span class="option-chip"><span class="avatar" style="background:${p.color}">${p.initials}</span><span class="chip-text">${p.name} ${p.lastName}</span></span>`,
    )
    .join('');

  const linkType = parseLinkType(meeting.link);
  const linkIcon = linkType ? `<img class="provider-img" src="${providerIcons[linkType]}" alt="${linkType}"/>` : '';
  const statusBadge =
    status === 'vencida'
      ? badge('Vencida', 'vencida')
      : status === 'en-curso'
      ? badge('En curso', 'en-curso')
      : status === 'hoy'
      ? badge('Hoy (no vencida)', 'hoy')
      : badge('Próxima', 'proxima');

  return `<article class="meeting-item ${disabled ? 'disabled' : ''}">
    <div><strong>${esFmt.format(new Date(meeting.startAt))}</strong></div>
    <div class="badges">${statusBadge}${meeting.link ? badge('Link', 'link') : ''}</div>
    <div>${meeting.note || 'Sin nota'}</div>
    <div class="providers">${providersHtml || '<em>Sin proveedores</em>'}</div>
    <div class="participants">${participantsHtml || '<em>Sin participantes</em>'}</div>
    ${meeting.link ? `<a href="${meeting.link}" target="_blank" rel="noreferrer">${linkIcon} Abrir reunión</a>` : '<span>Sin link</span>'}
    <div class="meeting-actions">
      ${disabled ? `<button class="btn btn-pill btn-soft" data-reschedule="${meeting.id}">Reprogramar</button>` : ''}
      <button class="btn btn-pill btn-ghost" data-edit="${meeting.id}">Editar</button>
      <button class="btn btn-pill btn-ghost" data-delete="${meeting.id}">Eliminar</button>
    </div>
  </article>`;
}

function paginateRows(rows) {
  totalPages = Math.max(Math.ceil(rows.length / pageSize), 1);
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

async function loadReferences() {
  providers = await loadCollection('providers');
  participants = await loadCollection('participants');
  renderPickers();
}

async function fetchMeetings() {
  showSpinner(true);
  try {
    let rows = [];
    if (activeFilterDate) {
      const snap = await get(query(ref(rtdb, 'meetings'), orderByChild('dateKey'), equalTo(activeFilterDate)));
      rows = normalizeSnapshot(snap.val());
    } else {
      rows = await loadCollection('meetings');
    }

    rows.sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
    meetings = paginateRows(rows);

    meetingsList.innerHTML = meetings.length ? meetings.map(meetingCard).join('') : '<p>No hay reuniones.</p>';
    pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;
    $('prevPage').disabled = currentPage === 1;
    $('nextPage').disabled = currentPage >= totalPages;
  } catch (error) {
    showNotice('No se pudieron cargar reuniones desde Realtime Database.');
    meetingsList.innerHTML = '<p>No se pudieron cargar reuniones.</p>';
    console.error(error);
  } finally {
    showSpinner(false);
  }
}

async function onSaveProvider(e) {
  e.preventDefault();
  const name = $('providerName').value.trim();
  const image = $('providerImage').value.trim();
  if (!name || !image) return;

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

async function onSaveMeeting() {
  const day = $('meetingDate').value;
  const time = $('meetingTime').value;
  if (!day || !time) return alert('Seleccioná fecha y hora');
  const startAt = new Date(`${day}T${time}`);
  if (Number.isNaN(startAt.getTime())) return alert('Fecha/hora inválida');

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
  };

  if (editingMeetingId) {
    await update(ref(rtdb, `meetings/${editingMeetingId}`), { ...payload, updatedAt: new Date().toISOString() });
  } else {
    await saveCollectionItem('meetings', payload);
  }

  $('meetingDate').value = '';
  $('meetingTime').value = '';
  $('meetingDuration').value = '60';
  $('meetingNote').value = '';
  $('meetingLink').value = '';
  setSelectedIds('provider', new Set());
  setSelectedIds('participant', new Set());
  pickerUiState.provider.query = '';
  pickerUiState.participant.query = '';
  pickerUiState.provider.open = false;
  pickerUiState.participant.open = false;
  editingMeetingId = null;
  $('cancelEdit').classList.add('hidden');
  $('saveMeeting').textContent = 'Cargar evento';
  renderPickers();
  await fetchMeetings();
}

function loadMeetingToForm(id) {
  const row = meetings.find((m) => m.id === id);
  if (!row) return;
  const dt = new Date(row.startAt);
  $('meetingDate').value = row.dateKey;
  $('meetingDate')._flatpickr?.setDate(row.dateKey, true, 'Y-m-d');
  $('meetingTime').value = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  $('meetingDuration').value = String(row.duration || 60);
  $('meetingNote').value = row.note || '';
  $('meetingLink').value = row.link || '';
  setSelectedIds('provider', new Set((row.providers || []).map((p) => p.id)));
  setSelectedIds('participant', new Set((row.participants || []).map((p) => p.id)));
  editingMeetingId = id;
  $('cancelEdit').classList.remove('hidden');
  $('saveMeeting').textContent = 'Guardar cambios';
  renderPickers();
}

async function deleteMeeting(id) {
  if (!confirm('¿Eliminar esta reunión?')) return;
  await set(ref(rtdb, `meetings/${id}`), null);
  await fetchMeetings();
}

async function rescheduleMeeting(id) {
  const row = meetings.find((m) => m.id === id);
  if (!row) return;
  const next = new Date(row.startAt);
  next.setDate(next.getDate() + 1);

  await update(ref(rtdb, `meetings/${id}`), {
    startAt: next.toISOString(),
    dateKey: next.toISOString().slice(0, 10),
    updatedAt: new Date().toISOString(),
  });

  await fetchMeetings();
}

async function deleteProvider(id) {
  const result = await Swal.fire({
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
  const result = await Swal.fire({
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

function bindPickerEvents(type) {
  const { containerId } = getPickerMeta(type);
  const container = $(containerId);

  container.addEventListener('click', (e) => {
    const add = e.target.closest(`[data-add-${type}]`);
    const select = e.target.closest(`[data-select-${type}]`);
    const removeBtn = e.target.closest(`[data-remove-${type}]`);

    if (add) {
      pickerUiState[type].open = false;
      pickerUiState[type].query = '';
      renderPickers();
      if (type === 'provider') openProviderModal();
      else openParticipantModal();
      return;
    }

    if (select) {
      const id = select.dataset[`select${type[0].toUpperCase()}${type.slice(1)}`];
      const selected = getSelectedIds(type);
      selected.add(id);
      setSelectedIds(type, selected);
      pickerUiState[type].query = '';
      pickerUiState[type].open = true;
      renderPickers();
      $(containerId).querySelector(`[data-picker-input="${type}"]`)?.focus();
      return;
    }

    if (removeBtn) {
      const id = removeBtn.dataset[`remove${type[0].toUpperCase()}${type.slice(1)}`];
      const selected = getSelectedIds(type);
      selected.delete(id);
      setSelectedIds(type, selected);
      renderPickers();
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
  $('openProvidersModal').addEventListener('click', () => openProviderModal());
  $('openParticipantsModal').addEventListener('click', () => openParticipantModal());
  $('cancelProvider').addEventListener('click', () => {
    $('providersModal').close();
    resetProviderForm();
  });
  $('cancelParticipant').addEventListener('click', () => {
    $('participantsModal').close();
    resetParticipantForm();
  });

  $('providersForm').addEventListener('submit', onSaveProvider);
  $('participantsForm').addEventListener('submit', onSaveParticipant);
  $('saveMeeting').addEventListener('click', onSaveMeeting);
  $('cancelEdit').addEventListener('click', () => {
    editingMeetingId = null;
    $('cancelEdit').classList.add('hidden');
    $('saveMeeting').textContent = 'Cargar evento';
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
    currentPage = 1;
    await fetchMeetings();
  });

  $('prevPage').addEventListener('click', async () => {
    if (currentPage > 1) currentPage -= 1;
    await fetchMeetings();
  });
  $('nextPage').addEventListener('click', async () => {
    if (currentPage < totalPages) currentPage += 1;
    await fetchMeetings();
  });

  meetingsList.addEventListener('click', async (e) => {
    const idRes = e.target?.dataset?.reschedule;
    const idEdit = e.target?.dataset?.edit;
    const idDelete = e.target?.dataset?.delete;
    if (idRes) await rescheduleMeeting(idRes);
    if (idEdit) loadMeetingToForm(idEdit);
    if (idDelete) await deleteMeeting(idDelete);
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
  });
}

(async function init() {
  setupFlatpickr();
  bindEvents();
  await verifyRTDBAccess();
  await loadReferences();
  await fetchMeetings();
})();
