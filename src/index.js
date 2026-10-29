import express from 'express';
import QRCode from 'qrcode';
import { JSONFilePreset } from 'lowdb/node';
import pkg from 'whatsapp-web.js';
import fs from 'node:fs/promises';
import path from 'node:path';

import { analyze } from './analyze.js';

const { Client, RemoteAuth } = pkg;

process.on(
  'uncaughtException',
  err => {
    console.error(
      'UNCAUGHT_EXCEPTION',
      err
    );
  }
);

process.on(
  'unhandledRejection',
  reason => {
    console.error(
      'UNHANDLED_REJECTION',
      reason
    );
  }
);

const PORT =
  Number(process.env.PORT || 8080);

const DATA_DIR =
  process.env.DATA_DIR || '/data';

const DB_PATH =
  path.join(
    DATA_DIR,
    'ferrodynamics.json'
  );

const AUTH_PATH =
  '/tmp/whatsapp-session';

const REMOTE_AUTH_DIR =
  path.join(
    DATA_DIR,
    'remote-auth'
  );

await fs.mkdir(
  DATA_DIR,
  { recursive: true }
);

await fs.mkdir(
  AUTH_PATH,
  { recursive: true }
);

await fs.mkdir(
  REMOTE_AUTH_DIR,
  { recursive: true }
);

const db =
  await JSONFilePreset(
    DB_PATH,
    {
      messages: [],
      state: {
        whatsappReady: false,
        lastQrAt: null
      }
    }
  );

let ready = false;
let qrDataUrl = null;

class AzureFileStore {
  constructor(basePath) {
    this.basePath = basePath;
  }

  filePath(session) {
    return path.join(
      this.basePath,
      `${session}.zip`
    );
  }

  async sessionExists({
    session
  }) {
    try {
      await fs.access(
        this.filePath(session)
      );

      console.log(
        `REMOTE_AUTH_EXISTS ${session}`
      );

      return true;
    } catch {
      console.log(
        `REMOTE_AUTH_NOT_FOUND ${session}`
      );

      return false;
    }
  }

  async save({
    session
  }) {
    const source =
      path.join(
        AUTH_PATH,
        `${session}.zip`
      );

    const destination =
      this.filePath(session);

    await fs.mkdir(
      this.basePath,
      { recursive: true }
    );

    await fs.copyFile(
      source,
      destination
    );

    console.log(
      `REMOTE_AUTH_SAVED ${session}`
    );
  }

  async extract({
    session,
    path: destination
  }) {
    const source =
      this.filePath(session);

    await fs.copyFile(
      source,
      destination
    );

    console.log(
      `REMOTE_AUTH_EXTRACTED ${session}`
    );
  }

  async delete({
    session
  }) {
    await fs.rm(
      this.filePath(session),
      { force: true }
    );

    console.log(
      `REMOTE_AUTH_DELETED ${session}`
    );
  }
}

const remoteStore =
  new AzureFileStore(
    REMOTE_AUTH_DIR
  );

const client =
  new Client({
    authStrategy:
      new RemoteAuth({
        clientId:
          'ferrodynamics',

        dataPath:
          AUTH_PATH,

        store:
          remoteStore,

        backupSyncIntervalMs:
          60000
      }),

    puppeteer: {
      headless: true,

      executablePath:
        process.env.CHROME_PATH ||
        '/usr/bin/chromium',

      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    }
  });

client.on(
  'qr',
  async qr => {
    qrDataUrl =
      await QRCode.toDataURL(qr);

    db.data.state.lastQrAt =
      new Date().toISOString();

    await db.write();

    console.log(
      'QR_READY'
    );
  }
);

client.on(
  'loading_screen',
  (percent, message) => {
    console.log(
      'WHATSAPP_LOADING',
      percent,
      message
    );
  }
);

client.on(
  'authenticated',
  () => {
    console.log(
      'WHATSAPP_AUTHENTICATED'
    );
  }
);

client.on(
  'auth_failure',
  message => {
    console.error(
      'WHATSAPP_AUTH_FAILURE',
      message
    );
  }
);

client.on(
  'remote_session_saved',
  () => {
    console.log(
      'REMOTE_SESSION_SAVED'
    );
  }
);

let healthCheckFailures = 0;

const HEALTH_CHECK_INTERVAL_MS = 60_000;
const MAX_HEALTH_CHECK_FAILURES = 3;

client.on(
  'ready',
  async () => {
    healthCheckFailures = 0;
    ready = true;
    qrDataUrl = null;

    db.data.state.whatsappReady = true;
    await db.write();

    console.log('WHATSAPP_READY');
  }
);

client.on(
  'disconnected',
  async reason => {
    ready = false;

    db.data.state.whatsappReady =
      false;

    await db.write();

    console.error(
      'WHATSAPP_DISCONNECTED',
      reason
    );

    console.error(
      'WHATSAPP_SELF_HEAL_RESTART'
    );

    process.exit(1);
  }
);

setInterval(async () => {
  if (!ready) {
    return;
  }

  try {
    const state = await client.getState();

    if (!state) {
      throw new Error('WhatsApp state unavailable');
    }

    healthCheckFailures = 0;
  } catch (err) {
    healthCheckFailures++;

    console.error(
      `WHATSAPP_HEALTH_FAILED count=${healthCheckFailures}`,
      err?.message || err
    );

    if (
      healthCheckFailures >=
      MAX_HEALTH_CHECK_FAILURES
    ) {
      console.error(
        'WHATSAPP_SELF_HEAL_RESTART'
      );

      process.exit(1);
    }
  }
}, HEALTH_CHECK_INTERVAL_MS);


async function sendLongMessage(
  groupId,
  text
) {
  const value =
    String(text || '').trim();

  if (!value) {
    return;
  }

  const maxLength = 3500;

  if (
    value.length <= maxLength
  ) {
    await client.sendMessage(
      groupId,
      value
    );

    return;
  }

  let position = 0;

  while (
    position < value.length
  ) {
    let end =
      Math.min(
        position + maxLength,
        value.length
      );

    if (
      end < value.length
    ) {
      const newline =
        value.lastIndexOf(
          '\n',
          end
        );

      if (
        newline > position
      ) {
        end = newline;
      }
    }

    const part =
      value
        .slice(
          position,
          end
        )
        .trim();

    if (part) {
      await client.sendMessage(
        groupId,
        part
      );
    }

    position = end;

    while (
      value.charAt(position) === '\n'
    ) {
      position += 1;
    }
  }
}

async function handleCommand(
  msg,
  groupId
) {
  const text =
    (msg.body || '').trim();

  const parts =
    text.split(/\s+/);

  if (
    parts[0].toLowerCase() !==
    '/bot'
  ) {
    return false;
  }

  const command =
    (parts[1] || '')
      .toLowerCase();

  const input =
    parts
      .slice(2)
      .join(' ')
      .trim();

  if (
    !command ||
    command === 'help'
  ) {
    await client.sendMessage(
      groupId,
      [
        'FerroDynamics Bot',
        '',
        '/bot help',
        '/bot status',
        '/bot summary <cerere>'
      ].join('\n')
    );

    return true;
  }

  if (
    command === 'status'
  ) {
    const status =
      ready
        ? 'Bot online. WhatsApp ready.'
        : 'Bot online. WhatsApp not ready.';

    await client.sendMessage(
      groupId,
      status
    );

    return true;
  }

  if (
    command === 'summary'
  ) {
    try {
      await client.sendMessage(
        groupId,
        'Analizez...'
      );

      const parameters = {
        input,

        requestedFromGroup:
          groupId,

        requestedBy:
          msg.author ||
          msg.from,

        requestedAt:
          msg.timestamp,

        messages:
          db.data.messages
      };

      console.log(
        `SUMMARY_REQUEST group=${groupId} messages=${parameters.messages.length}`
      );

      const result =
        await analyze(
          'summary',
          parameters
        );

      await sendLongMessage(
        groupId,
        result
      );

      console.log(
        `SUMMARY_SENT group=${groupId}`
      );
    } catch (err) {
      console.error(
        'SUMMARY_FAILED',
        err
      );

      await client.sendMessage(
        groupId,
        'Nu am putut finaliza analiza.'
      );
    }

    return true;
  }

  await client.sendMessage(
    groupId,
    'Comanda necunoscuta. Foloseste /bot help.'
  );

  return true;
}

client.on(
  'message',
  async msg => {
    try {
      const groupId =
        msg.from;

      if (
        !groupId ||
        !groupId.endsWith(
          '@g.us'
        )
      ) {
        return;
      }

      const text =
        (msg.body || '').trim();

      const lowerText =
        text.toLowerCase();

      if (
        lowerText === '/bot' ||
        lowerText.startsWith(
          '/bot '
        )
      ) {
        const handled =
          await handleCommand(
            msg,
            groupId
          );

        if (handled) {
          return;
        }
      }

      const id =
        msg.id?._serialized ||
        msg.id?.id ||
        `${msg.from}-${msg.timestamp}-${msg.author || 'unknown'}`;

      console.log(
        `MESSAGE_RECEIVED group=${groupId} id=${id}`
      );

      const exists =
        db.data.messages.some(
          message =>
            message.id === id
        );

      if (exists) {
        console.log(
          `MESSAGE_DUPLICATE ${id}`
        );

        return;
      }

      db.data.messages.push({
        id,

        groupId,

        groupName:
          null,

        timestamp:
          msg.timestamp,

        author:
          msg.author ||
          msg.from,

        fromMe:
          Boolean(
            msg.fromMe
          ),

        type:
          msg.type || null,

        text:
          msg.body || '',

        hasMedia:
          Boolean(
            msg.hasMedia
          ),

        hasQuotedMsg:
          Boolean(
            msg.hasQuotedMsg
          ),

        isForwarded:
          Boolean(
            msg.isForwarded
          ),

        savedAt:
          new Date()
            .toISOString()
      });

      await db.write();

      console.log(
        `SAVED ${id} ${groupId}`
      );
    } catch (err) {
      console.error(
        'MESSAGE_PROCESS_FAILED',
        err
      );
    }
  }
);

const app =
  express();

app.get(
  '/',
  (req, res) => {
    res.json({
      service:
        'ferrodynamics-whatsapp-bot',

      ok:
        true
    });
  }
);

app.get(
  '/health',
  (req, res) => {
    res.json({
      ok:
        true,

      whatsappReady:
        ready,

      modelConfigured:
        Boolean(
          process.env.MODEL_URL
        )
    });
  }
);

app.get(
  '/qr',
  (req, res) => {
    if (ready) {
      return res
        .status(409)
        .send(
          'WhatsApp already authenticated.'
        );
    }

    if (!qrDataUrl) {
      return res
        .status(404)
        .send(
          'QR not available yet.'
        );
    }

    const base64 =
      qrDataUrl.replace(
        /^data:image\/png;base64,/,
        ''
      );

    const image =
      Buffer.from(
        base64,
        'base64'
      );

    res.type('png');
    res.send(image);
  }
);

app.get(
  '/stats',
  (req, res) => {
    const groups =
      new Set(
        db.data.messages
          .map(
            message =>
              message.groupId
          )
          .filter(Boolean)
      );

    res.json({
      messages:
        db.data.messages.length,

      groups:
        groups.size,

      whatsappReady:
        ready,

      modelConfigured:
        Boolean(
          process.env.MODEL_URL
        )
    });
  }
);

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `HTTP_READY ${PORT}`
    );
  }
);

client
  .initialize()
  .catch(err => {
    console.error(
      'WHATSAPP_INIT_FAILED',
      err
    );
  });
