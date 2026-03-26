const TZ = 'America/Argentina/Buenos_Aires';
const STORE_SHEET_NAME = 'trigger_store';
const STORE_SPREADSHEET_ID_PROP = 'TRIGGER_STORE_SPREADSHEET_ID';

function doOptions() {
  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    const body = parseRequestBody_(e);
    const meeting = body.meeting || {};
    const webhookUrl = String(body.webhookUrl || '').trim();
    const reminderMinutes = Number(body.reminderMinutes || 15);

    validateMeetingPayload_(meeting, webhookUrl, reminderMinutes);

    if (body.type === 'update_meeting') {
      upsertReminderTrigger_(webhookUrl, meeting, reminderMinutes, {
        previousStartAt: body.previousStartAt,
        sendCreationMessage: false,
      });
      return jsonResponse_({ ok: true, message: 'Reunión actualizada y trigger reprogramado.' });
    }

    if (body.type === 'create_meeting') {
      sendSlackCreationMessage_(webhookUrl, meeting, reminderMinutes);
      upsertReminderTrigger_(webhookUrl, meeting, reminderMinutes, { sendCreationMessage: true });
      return jsonResponse_({ ok: true, message: 'Reunión creada y recordatorio programado correctamente.' });
    }

    return jsonResponse_({ ok: false, error: 'Tipo inválido. Se esperaba "create_meeting" o "update_meeting".' });
  } catch (err) {
    return jsonResponse_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function upsertReminderTrigger_(webhookUrl, meeting, reminderMinutes) {
  const meetingId = String(meeting.id || '').trim();
  if (!meetingId) {
    throw new Error('meeting.id es obligatorio para gestionar triggers.');
  }

  const sh = getStoreSheet_();
  const existing = findTriggerRowByMeetingId_(meetingId, sh);

  if (existing) {
    const oldTriggerId = String(existing.values[1] || '');
    if (oldTriggerId) cleanupTriggerById_(oldTriggerId);
    sh.deleteRow(existing.rowNumber);
  }

  const meetingTimeMs = new Date(meeting.startAt).getTime();
  if (isNaN(meetingTimeMs)) {
    throw new Error('meeting.startAt no tiene una fecha válida.');
  }

  const triggerAt = new Date(meetingTimeMs - reminderMinutes * 60 * 1000);
  if (triggerAt.getTime() <= Date.now()) {
    return;
  }

  const trigger = ScriptApp.newTrigger('sendReminderFromTrigger').timeBased().at(triggerAt).create();
  sh.appendRow([meetingId, trigger.getUniqueId(), webhookUrl, JSON.stringify(meeting), reminderMinutes, new Date()]);
}

function sendReminderFromTrigger(e) {
  const triggerId = e && e.triggerUid ? String(e.triggerUid) : '';
  if (!triggerId) return;

  const sh = getStoreSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    cleanupTriggerById_(triggerId);
    return;
  }

  const data = sh.getRange(2, 1, lastRow - 1, 6).getValues();

  for (let i = 0; i < data.length; i++) {
    const rowTriggerId = String(data[i][1] || '');
    if (rowTriggerId !== triggerId) continue;

    const rowNumber = i + 2;
    const webhookUrl = String(data[i][2] || '');
    const meetingJson = String(data[i][3] || '{}');

    let meeting = {};
    try {
      meeting = JSON.parse(meetingJson);
    } catch (err) {
      meeting = {};
    }

    const payload = {
      text: '⏰ Recordatorio de reunión',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: '⏰ *Recordatorio*\nTu reunión está por comenzar.' } },
        { type: 'section', text: { type: 'mrkdwn', text: '*Nota:* ' + (meeting.note || '-') + '\n*Inicio:* ' + formatDateSafe_(meeting.startAt) } },
        {
          type: 'actions',
          elements: [{ type: 'button', text: { type: 'plain_text', text: 'Entrar a la reunión' }, url: meeting.link || 'https://slack.com' }],
        },
      ],
    };

    try {
      postToSlackWebhook_(webhookUrl, payload);
    } finally {
      cleanupStoredTriggerRow_(triggerId, rowNumber);
    }

    break;
  }
}

function sendSlackCreationMessage_(webhookUrl, meeting, reminderMinutes) {
  const startDate = new Date(meeting.startAt);
  const formattedStart = Utilities.formatDate(startDate, TZ, 'dd/MM/yyyy HH:mm');

  const payload = {
    text: '✅ Reunión creada',
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '📅 *Nueva reunión cargada*' } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            '*Inicio:* ' +
            formattedStart +
            '\n*Duración:* ' +
            (meeting.duration || '-') +
            ' min' +
            '\n*Nota:* ' +
            (meeting.note || '-') +
            '\n*Participantes:* ' +
            (meeting.participants || '-') +
            '\n*Proveedores:* ' +
            (meeting.providers || '-'),
        },
      },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Abrir reunión' }, url: meeting.link || 'https://slack.com' }] },
      { type: 'context', elements: [{ type: 'mrkdwn', text: '⏰ Recordatorio programado: ' + reminderMinutes + ' min antes.' }] },
    ],
  };

  postToSlackWebhook_(webhookUrl, payload);
}

function cleanupStoredTriggerRow_(triggerId, rowNumber) {
  cleanupTriggerById_(triggerId);
  const sh = getStoreSheet_();
  const lastRow = sh.getLastRow();
  if (rowNumber >= 2 && rowNumber <= lastRow) sh.deleteRow(rowNumber);
}

function cleanupTriggerById_(triggerId) {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (String(triggers[i].getUniqueId()) === String(triggerId)) {
      ScriptApp.deleteTrigger(triggers[i]);
      break;
    }
  }
}

function findTriggerRowByMeetingId_(meetingId, sh) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  const data = sh.getRange(2, 1, lastRow - 1, 6).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0] || '') === meetingId) {
      return { rowNumber: i + 2, values: data[i] };
    }
  }
  return null;
}

function postToSlackWebhook_(webhookUrl, payload) {
  const response = UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Slack devolvió error. Código: ' + code + '. Respuesta: ' + response.getContentText());
  }
}

function getStoreSheet_() {
  const ss = getOrCreateStoreSpreadsheet();
  return getOrCreateStoreSheet_(ss);
}

function getOrCreateStoreSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  let spreadsheetId = props.getProperty(STORE_SPREADSHEET_ID_PROP);

  if (spreadsheetId) {
    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (err) {}
  }

  const ss = SpreadsheetApp.create('Calendario Trigger Store');
  props.setProperty(STORE_SPREADSHEET_ID_PROP, ss.getId());
  return ss;
}

function getOrCreateStoreSheet_(ss) {
  let sh = ss.getSheetByName(STORE_SHEET_NAME);

  if (!sh) {
    sh = ss.insertSheet(STORE_SHEET_NAME);
    sh.appendRow(['meeting_id', 'trigger_uid', 'webhook_url', 'meeting_json', 'reminder_minutes', 'created_at']);
  }

  return sh;
}

function parseRequestBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('No llegó contenido en el POST.');
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    throw new Error('El body no es JSON válido.');
  }
}

function validateMeetingPayload_(meeting, webhookUrl, reminderMinutes) {
  if (!webhookUrl) throw new Error('Falta webhookUrl.');
  if (!meeting || !meeting.startAt) throw new Error('Falta meeting.startAt.');

  const testDate = new Date(meeting.startAt);
  if (isNaN(testDate.getTime())) throw new Error('meeting.startAt tiene formato inválido.');
  if (!isFinite(reminderMinutes) || reminderMinutes < 0) throw new Error('reminderMinutes es inválido.');
}

function formatDateSafe_(dateValue) {
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return '-';
  return Utilities.formatDate(d, TZ, 'dd/MM/yyyy HH:mm');
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
