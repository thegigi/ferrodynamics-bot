import express from 'express';
import QRCode from 'qrcode';
import { JSONFilePreset } from 'lowdb/node';
import pkg from 'whatsapp-web.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const { Client, RemoteAuth } = pkg;

process.on('uncaughtException', err => {
  console.error('UNCAUGHT_EXCEPTION', err);
});

process.on('unhandledRejection', reason => {
  console.error('UNHANDLED_REJECTION', reason);
});

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || '/data';

const ANALYSIS_URL = process.env.ANALYSIS_URL || '';
const ANALYSIS_API_KEY = process.env.ANALYSIS_API_KEY || '';

const DB_PATH = path.join(DATA_DIR, 'ferrodynamics.json');
const AUTH_PATH = '/tmp/whatsapp-session';
const REMOTE_AUTH_DIR = path.join(DATA_DIR, 'remote-auth');

const SUMMARY_PROMPT_PATH =
  path.join(process.cwd(), 'prompts', 'summary.txt');

await fs.mkdir(DATA_DIR, { recursive: true });
await fs.mkdir(AUTH_PATH, { recursive: true });
await fs.mkdir(REMOTE_AUTH_DIR, { recursive: true });

const db = await JSONFilePreset(DB_PATH, {
  messages: [],
  state: {
    whatsappReady: false,
    lastQrAt: null
  }
});

let ready = false;
let qrDataUrl = null;


/* -------------------------------------------------
 * RemoteAuth persistent store
 * ------------------------------------------------- */

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

  async sessionExists({ session }) {
    try {
      await fs.access(this.filePath(session));

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

  async save({ session }) {
    const source = path.join(
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

  async delete({ session }) {
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


/* -------------------------------------------------
 * WhatsApp
 * ------------------------------------------------- */

const client = new Client({
  authStrategy: new RemoteAuth({
    clientId: 'ferrodynamics',
    dataPath: AUTH_PATH,
    store: remoteStore,
    backupSyncIntervalMs: 60000
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


client.on('qr', async qr => {
  qrDataUrl =
    await QRCode.toDataURL(qr);

  db.data.state.lastQrAt =
    new Date().toISOString();

  await db.write();

  console.log('QR_READY');
});


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


client.on('authenticated', () => {
  console.log(
    'WHATSAPP_AUTHENTICATED'
  );
});


client.on('auth_failure', message => {
  console.error(
    'WHATSAPP_AUTH_FAILURE',
    message
  );
});


client.on('remote_session_saved', () => {
  console.log(
    'REMOTE_SESSION_SAVED'
  );
});


client.on('ready', async () => {
  ready = true;
  qrDataUrl = null;

  db.data.state.whatsappReady = true;
  await db.write();

  console.log(
    'WHATSAPP_READY'
  );
});


client.on(
  'disconnected',
  async reason => {
    ready = false;

    db.data.state.whatsappReady = false;
    await db.write();

    console.error(
      'WHATSAPP_DISCONNECTED',
      reason
    );
  }
);


/* -------------------------------------------------
 * Analysis
 * ------------------------------------------------- */

async function runSummary({
  groupId,
  author,
  args,
  timestamp
}) {
  if (!ANALYSIS_URL) {
    throw new Error(
      'ANALYSIS_URL_NOT_CONFIGURED'
    );
  }

  const prompt =
    await fs.readFile(
      SUMMARY_PROMPT_PATH,
      'utf8'
    );

  const parameters = {
    command: '/summary',

    args,

    requestedFromGroup:
      groupId,

    requestedBy:
      author,

    requestedAt:
      timestamp,

    messages:
      db.data.messages
  };

  console.log(
    `SUMMARY_REQUEST group=${groupId} messages=${parameters.messages.length}`
  );

  const headers = {
    'Content-Type': 'application/json'
  };

  if (ANALYSIS_API_KEY) {
    headers.Authorization =
      `Bearer ${ANALYSIS_API_KEY}`;
  }

  const response =
    await fetch(
      ANALYSIS_URL,
      {
        method: 'POST',
        headers,

        body: JSON.stringify({
          prompt,
          parameters
        })
      }
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `ANALYSIS_HTTP_${response.status}: ${errorText}`
    );
  }

  const contentType =
    response.headers.get(
      'content-type'
    ) || '';

  if (
    contentType.includes(
      'application/json'
    )
  ) {
    const data =
      await response.json();

    return (
      data.result ||
      data.response ||
      data.text ||
      data.output ||
      JSON.stringify(data)
    );
  }

  return await response.text();
}


/* -------------------------------------------------
 * Commands
 * ------------------------------------------------- */

async function handleCommand(
  msg,
  groupId
) {
  const text =
    (msg.body || '').trim();

  const firstSpace =
    text.indexOf(' ');

  let command;
  let args;

  if (firstSpace === -1) {
    command =
      text.toLowerCase();

    args = '';
  } else {
    command =
      text
        .slice(0, firstSpace)
        .toLowerCase();

    args =
      text
        .slice(firstSpace + 1)
        .trim();
  }


  if (command === '/help') {
    await client.sendMessage(
      groupId,
      [
        'FerroDynamics Bot',
        '',
        '/help',
        '/status',
        '/summary [cerere]'
      ].join('\n')
    );

    return true;
  }


  if (command === '/status') {
    await client.sendMessage(
      groupId,
      ready
        ? 'Bot online. WhatsApp ready.'
        : 'Bot online. WhatsApp not ready.'
    );

    return true;
  }


  if (command === '/summary') {
    try {
      await client.sendMessage(
        groupId,
        'Analizez...'
      );

      const result =
        await runSummary({
          groupId,

          author:
            msg.author ||
            msg.from,

          args,

          timestamp:
            msg.timestamp
        });


      await client.sendMessage(
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


  return false;
}


/* -------------------------------------------------
 * Messages
 * ------------------------------------------------- */

client.on('message', async msg => {
  try {
    const groupId =
      msg.from;

    /*
     * Ignore private conversations.
     */

    if (
      !groupId ||
      !groupId.endsWith('@g.us')
    ) {
      return;
    }


    const text =
      (msg.body || '').trim();


    /*
     * Commands are executed but are not added
     * to the analysis archive.
     */

    if (text.startsWith('/')) {
      const handled =
        await handleCommand(
          msg,
          groupId
        );

      if (handled) {
        return;
      }
    }


    /*
     * Normal group message.
     */

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

      groupName: null,

      timestamp:
        msg.timestamp,

      author:
        msg.author ||
        msg.from,

      fromMe:
        Boolean(msg.fromMe),

      type:
        msg.type || null,

      text:
        msg.body || '',

      hasMedia:
        Boolean(msg.hasMedia),

      hasQuotedMsg:
        Boolean(msg.hasQuotedMsg),

      isForwarded:
        Boolean(msg.isForwarded),

      savedAt:
        new Date().toISOString()
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
});


/* -------------------------------------------------
 * HTTP
 * ------------------------------------------------- */

const app =
  express();


app.get('/', (req, res) => {
  res.json({
    service:
      'ferrodynamics-whatsapp-bot',

    ok: true
  });
});


app.get(
  '/health',
  (req, res) => {
    res.json({
      ok: true,
      whatsappReady: ready,
      analysisConfigured:
        Boolean(ANALYSIS_URL)
    });
  }
);


app.get(
  '/qr',
  async (req, res) => {
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
          .map(message => message.groupId)
          .filter(Boolean)
      );

    res.json({
      messages:
        db.data.messages.length,

      groups:
        groups.size,

      whatsappReady:
        ready,

      analysisConfigured:
        Boolean(ANALYSIS_URL)
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


/* -------------------------------------------------
 * Start
 * ------------------------------------------------- */

client
  .initialize()
  .catch(err => {
    console.error(
      'WHATSAPP_INIT_FAILED',
      err
    );
  });
