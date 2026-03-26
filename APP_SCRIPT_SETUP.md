# Configuración de Google App Script para recordatorios Slack

## 1) Crear el proyecto
1. Abrí https://script.google.com
2. Creá un proyecto nuevo.
3. Reemplazá el contenido por este código.
4. En **Deploy > New deployment > Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copiá la URL `/exec` y cargala en la app (campo "URL App Script").

## 2) Código App Script (optimizado + CORS + cleanup de triggers)
```javascript
const TZ = 'America/Argentina/Buenos_Aires';
const STORE_SHEET = 'trigger_store';

function doOptions() {
  return ContentService.createTextOutput('ok')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (body.type !== 'create_meeting') return jsonResponse({ ok: false, error: 'Invalid type' }, headers);

    const meeting = body.meeting || {};
    const webhookUrl = body.webhookUrl;
    const reminderMinutes = Number(body.reminderMinutes || 15);

    sendSlackCreationMessage(webhookUrl, meeting, reminderMinutes);
    createReminderTrigger(webhookUrl, meeting, reminderMinutes);

    return jsonResponse({ ok: true }, headers);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, headers);
  }
}

function sendSlackCreationMessage(webhookUrl, meeting, reminderMinutes) {
  const startDate = new Date(meeting.startAt);
  const text = `✅ *Reunión creada*`;

  const payload = {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '📅 *Nueva reunión cargada*' } },
      { type: 'section', text: { type: 'mrkdwn', text: `*Inicio:* ${Utilities.formatDate(startDate, TZ, 'dd/MM/yyyy HH:mm')}\n*Duración:* ${meeting.duration} min\n*Nota:* ${meeting.note || '-'}\n*Participantes:* ${meeting.participants || '-'}\n*Proveedores:* ${meeting.providers || '-'}` } },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Abrir reunión' }, url: meeting.link || 'https://slack.com' }] },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `⏰ Recordatorio programado: ${reminderMinutes} min antes.` }] },
    ],
  };

  UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}

function createReminderTrigger(webhookUrl, meeting, reminderMinutes) {
  const meetingTime = new Date(meeting.startAt).getTime();
  const triggerAt = new Date(meetingTime - reminderMinutes * 60 * 1000);
  if (triggerAt.getTime() <= Date.now()) return;

  const trigger = ScriptApp.newTrigger('sendReminderFromTrigger').timeBased().at(triggerAt).create();
  const sheet = getStoreSheet();

  sheet.appendRow([
    trigger.getUniqueId(),
    webhookUrl,
    JSON.stringify(meeting),
    reminderMinutes,
    new Date().toISOString(),
  ]);
}

function sendReminderFromTrigger(e) {
  const triggerId = e && e.triggerUid;
  const sheet = getStoreSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== String(triggerId)) continue;

    const webhookUrl = data[i][1];
    const meeting = JSON.parse(data[i][2] || '{}');

    const payload = {
      text: '⏰ Recordatorio de reunión',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: '⏰ *Recordatorio*\nTu reunión está por comenzar.' } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Nota:* ${meeting.note || '-'}\n*Inicio:* ${Utilities.formatDate(new Date(meeting.startAt), TZ, 'dd/MM/yyyy HH:mm')}` } },
        { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Entrar a la reunión' }, url: meeting.link || 'https://slack.com' }] },
      ],
    };

    UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    cleanupTrigger(triggerId, i + 1);
    break;
  }
}

function cleanupTrigger(triggerId, rowNumber) {
  const all = ScriptApp.getProjectTriggers();
  all.forEach((t) => {
    if (t.getUniqueId() === triggerId) ScriptApp.deleteTrigger(t);
  });

  const sheet = getStoreSheet();
  sheet.deleteRow(rowNumber);
}

function getStoreSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.create('Calendario Trigger Store');
  let sh = ss.getSheetByName(STORE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(STORE_SHEET);
    sh.appendRow(['trigger_uid', 'webhook_url', 'meeting_json', 'reminder_minutes', 'created_at']);
  }
  return sh;
}

function jsonResponse(obj, headers) {
  const out = ContentService.createTextOutput(JSON.stringify(obj));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}
```

## 3) Permisos y primera ejecución
- Ejecutá manualmente una función para autorizar `UrlFetchApp`, `ScriptApp` y `SpreadsheetApp`.
- Volvé a desplegar si cambiás el script.

## 4) En la app web
- Guardá los dos campos:
  - Webhook Slack
  - URL App Script `/exec`
- Al crear reunión con el check activo:
  - Se envía mensaje de creación.
  - Se programa trigger de recordatorio.
  - Al dispararse, se borra trigger y registro.
