import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  addDoc,
  collection,
  doc,
  getCountFromServer,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBBaOij5CcHOtPSkiA56dOJnPmVlovimtY',
  authDomain: 'calendario-83eab.firebaseapp.com',
  projectId: 'calendario-83eab',
  storageBucket: 'calendario-83eab.firebasestorage.app',
  messagingSenderId: '370342529436',
  appId: '1:370342529436:web:0cb07d33342e1bcc1ca059',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const pageSize = 6;

const $ = (id) => document.getElementById(id);
const spinner = $('spinner');
const meetingsList = $('meetingsList');
const pageInfo = $('pageInfo');
let providers = [];
let participants = [];
let meetings = [];
let currentPage = 1;
let totalPages = 1;
let activeFilterDate = null;

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

function randomColor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}deg 65% 45%)`;
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

function buildMultiPicker(items, selectedIds, type) {
  return items
    .map((item) => {
      const checked = selectedIds.has(item.id) ? 'checked' : '';
      const visual =
        type === 'provider'
          ? `<img src="${item.image}" class="provider-img" alt="${item.name}" />`
          : `<span class="avatar" style="background:${item.color}">${item.initials}</span>`;
      const label = type === 'provider' ? item.name : `${item.name} ${item.lastName}`;
      return `<label class="option-chip">${visual}<input type="checkbox" data-${type}="${item.id}" ${checked}/> ${label}</label>`;
    })
    .join('');
}

function renderPickers() {
  const selectedProviders = new Set(($('providersPicker').dataset.selected || '').split(',').filter(Boolean));
  const selectedParticipants = new Set(($('participantsPicker').dataset.selected || '').split(',').filter(Boolean));
  $('providersPicker').innerHTML = buildMultiPicker(providers, selectedProviders, 'provider');
  $('participantsPicker').innerHTML = buildMultiPicker(participants, selectedParticipants, 'participant');
}

function syncPickerSelection() {
  $('providersPicker').addEventListener('change', () => {
    const ids = [...document.querySelectorAll('[data-provider]:checked')].map((el) => el.dataset.provider);
    $('providersPicker').dataset.selected = ids.join(',');
  });
  $('participantsPicker').addEventListener('change', () => {
    const ids = [...document.querySelectorAll('[data-participant]:checked')].map((el) => el.dataset.participant);
    $('participantsPicker').dataset.selected = ids.join(',');
  });
}

async function loadReferences() {
  const [providersSnap, participantsSnap] = await Promise.all([
    getDocs(query(collection(db, 'providers'), orderBy('name'))),
    getDocs(query(collection(db, 'participants'), orderBy('name'))),
  ]);
  providers = providersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  participants = participantsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderPickers();
}

function badge(label, cls) {
  return `<span class="badge ${cls}">${label}</span>`;
}

function meetingCard(meeting) {
  const status = meetingStatus(meeting);
  const disabled = status === 'vencida';
  const providersHtml = (meeting.providers || [])
    .map((p) => `<span class="option-chip"><img class="provider-img" src="${p.image}" alt="${p.name}"/>${p.name}</span>`)
    .join('');
  const participantsHtml = (meeting.participants || [])
    .map(
      (p) =>
        `<span class="option-chip"><span class="avatar" style="background:${p.color}">${p.initials}</span>${p.name} ${p.lastName}</span>`,
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
    ${
      meeting.link
        ? `<a href="${meeting.link}" target="_blank" rel="noreferrer">${linkIcon} Abrir reunión</a>`
        : '<span>Sin link</span>'
    }
    ${disabled ? `<button class="btn btn-secondary" data-reschedule="${meeting.id}">Reprogramar</button>` : ''}
  </article>`;
}

async function fetchMeetings() {
  showSpinner(true);
  let countQuery = collection(db, 'meetings');
  let baseQuery = query(collection(db, 'meetings'), orderBy('startAt', 'desc'));

  if (activeFilterDate) {
    countQuery = query(collection(db, 'meetings'), where('dateKey', '==', activeFilterDate));
    baseQuery = query(baseQuery, where('dateKey', '==', activeFilterDate));
  }

  const countSnap = await getCountFromServer(countQuery);
  const total = countSnap.data().count;
  totalPages = Math.max(Math.ceil(total / pageSize), 1);
  currentPage = Math.min(currentPage, totalPages);

  const docs = await getDocs(query(baseQuery, limit(pageSize * currentPage)));
  const sliced = docs.docs.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  meetings = sliced.map((d) => ({ id: d.id, ...d.data() }));

  meetingsList.innerHTML = meetings.length ? meetings.map(meetingCard).join('') : '<p>No hay reuniones.</p>';
  pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;
  $('prevPage').disabled = currentPage === 1;
  $('nextPage').disabled = currentPage >= totalPages;
  showSpinner(false);
}

async function saveProvider(e) {
  e.preventDefault();
  const name = $('providerName').value.trim();
  const image = $('providerImage').value.trim();
  if (!name || !image) return;
  await addDoc(collection(db, 'providers'), { name, image, createdAt: serverTimestamp() });
  $('providerName').value = '';
  $('providerImage').value = '';
  $('providersModal').close();
  await loadReferences();
}

async function saveParticipant(e) {
  e.preventDefault();
  const name = $('participantName').value.trim();
  const lastName = $('participantLastName').value.trim();
  const email = $('participantEmail').value.trim();
  if (!name || !lastName || !email) return;
  const inits = initials(name, lastName);
  const color = randomColor(`${name}${lastName}${email}`);
  await addDoc(collection(db, 'participants'), {
    name,
    lastName,
    email,
    initials: inits,
    color,
    createdAt: serverTimestamp(),
  });
  $('participantName').value = '';
  $('participantLastName').value = '';
  $('participantEmail').value = '';
  $('participantsModal').close();
  await loadReferences();
}

async function saveMeeting() {
  const day = $('meetingDate').value;
  const time = $('meetingTime').value;
  const duration = Number($('meetingDuration').value || 60);
  if (!day || !time) {
    alert('Seleccioná fecha y hora');
    return;
  }

  const startAt = new Date(`${day}T${time}`);
  if (Number.isNaN(startAt.getTime())) {
    alert('Fecha/hora inválida');
    return;
  }

  const selectedProviderIds = ($('providersPicker').dataset.selected || '').split(',').filter(Boolean);
  const selectedParticipantIds = ($('participantsPicker').dataset.selected || '').split(',').filter(Boolean);

  const selectedProviders = providers.filter((p) => selectedProviderIds.includes(p.id));
  const selectedParticipants = participants.filter((p) => selectedParticipantIds.includes(p.id));

  await addDoc(collection(db, 'meetings'), {
    startAt: startAt.toISOString(),
    duration,
    dateKey: startAt.toISOString().slice(0, 10),
    note: $('meetingNote').value.trim(),
    link: $('meetingLink').value.trim(),
    providers: selectedProviders.map(({ id, name, image }) => ({ id, name, image })),
    participants: selectedParticipants.map(({ id, name, lastName, email, initials: ini, color }) => ({
      id,
      name,
      lastName,
      email,
      initials: ini,
      color,
    })),
    createdAt: serverTimestamp(),
  });

  $('meetingDate').value = '';
  $('meetingTime').value = '';
  $('meetingDuration').value = '60';
  $('meetingNote').value = '';
  $('meetingLink').value = '';
  $('providersPicker').dataset.selected = '';
  $('participantsPicker').dataset.selected = '';
  renderPickers();
  await fetchMeetings();
}

async function rescheduleMeeting(id) {
  const current = meetings.find((m) => m.id === id);
  if (!current) return;
  const oldDate = new Date(current.startAt);
  oldDate.setDate(oldDate.getDate() + 1);
  await updateDoc(doc(db, 'meetings', id), {
    startAt: oldDate.toISOString(),
    dateKey: oldDate.toISOString().slice(0, 10),
    updatedAt: serverTimestamp(),
  });
  await fetchMeetings();
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
    onChange: async (dates, dateStr) => {
      activeFilterDate = dateStr || null;
      currentPage = 1;
      await fetchMeetings();
    },
  });
}

function bindEvents() {
  $('openProvidersModal').addEventListener('click', () => $('providersModal').showModal());
  $('openParticipantsModal').addEventListener('click', () => $('participantsModal').showModal());
  $('saveProvider').addEventListener('click', saveProvider);
  $('saveParticipant').addEventListener('click', saveParticipant);
  $('saveMeeting').addEventListener('click', saveMeeting);

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
    const id = e.target?.dataset?.reschedule;
    if (id) await rescheduleMeeting(id);
  });

  syncPickerSelection();
}

(async function init() {
  setupFlatpickr();
  bindEvents();
  await loadReferences();
  await fetchMeetings();
})();
