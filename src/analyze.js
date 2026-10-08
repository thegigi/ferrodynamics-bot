import fs from 'node:fs/promises';
import crypto from 'node:crypto';

import {
  getWorkIqAccessToken,
  clearWorkIqAccessToken
} from './workiq-auth.js';

const WORKIQ_URL =
  'https://workiq.svc.cloud.microsoft/a2a/';

const PROMPT_URL =
  new URL(
    '../prompts/summary.txt',
    import.meta.url
  );

/*
 * Work IQ occasionally returns the same answer twice
 * concatenated in a single text part.
 *
 * Only remove the duplicate when both halves are exactly
 * identical. Otherwise leave the response untouched.
 */
function deduplicateAnswer(text) {
  const value =
    String(text || '').trim();

  if (!value) {
    return value;
  }

  const middle =
    Math.floor(value.length / 2);

  for (
    let split = Math.max(1, middle - 10);
    split <= Math.min(value.length - 1, middle + 10);
    split += 1
  ) {
    const first =
      value.slice(0, split).trim();

    const second =
      value.slice(split).trim();

    if (
      first &&
      first === second
    ) {
      return first;
    }
  }

  return value;
}


/*
 * Load the external prompt.
 */
async function loadPrompt(command) {
  if (command !== 'summary') {
    throw new Error(
      `UNSUPPORTED_COMMAND: ${command}`
    );
  }

  const prompt =
    await fs.readFile(
      PROMPT_URL,
      'utf8'
    );

  if (!prompt.trim()) {
    throw new Error(
      'EMPTY_PROMPT'
    );
  }

  return prompt.trim();
}


/*
 * Construct the message sent to Work IQ.
 */
function buildInput(
  prompt,
  parameters
) {
  const input =
    parameters?.input || '';

  const messages =
    Array.isArray(parameters?.messages)
      ? parameters.messages
      : [];

  return [
    prompt,
    '',
    'PARAMETERS:',
    input,
    '',
    'MESSAGES:',
    JSON.stringify(messages)
  ].join('\n');
}


/*
 * Construct an A2A SendMessage request.
 */
function buildRequest(text) {
  return {
    jsonrpc: '2.0',

    id:
      crypto.randomUUID(),

    method:
      'SendMessage',

    params: {
      message: {
        role:
          'ROLE_USER',

        messageId:
          crypto.randomUUID(),

        parts: [
          {
            text
          }
        ],

        metadata: {
          Location: {
            timeZoneOffset: 180,
            timeZone:
              'Europe/Bucharest'
          }
        }
      }
    }
  };
}


/*
 * Single HTTP call to Work IQ.
 */
async function sendToWorkIq(
  token,
  body
) {
  return await fetch(
    WORKIQ_URL,
    {
      method: 'POST',

      headers: {
        Authorization:
          `Bearer ${token}`,

        'Content-Type':
          'application/json',

        'A2A-Version':
          '1.0'
      },

      body:
        JSON.stringify(body)
    }
  );
}


/*
 * Extract the Answer artifact returned by Work IQ.
 */
function extractAnswer(data) {
  if (data?.error) {
    const message =
      data.error.message ||
      JSON.stringify(data.error);

    throw new Error(
      `WORKIQ_RPC_ERROR: ${message}`
    );
  }

  const task =
    data?.result?.task;

  if (!task) {
    throw new Error(
      'WORKIQ_NO_TASK'
    );
  }

  const state =
    task.status?.state;

  if (
    state &&
    state !== 'TASK_STATE_COMPLETED'
  ) {
    throw new Error(
      `WORKIQ_TASK_STATE: ${state}`
    );
  }

  const artifact =
    task.artifacts
      ?.find(
        item =>
          item.name === 'Answer'
      );

  if (!artifact) {
    throw new Error(
      'WORKIQ_NO_ANSWER_ARTIFACT'
    );
  }

  const texts =
    (artifact.parts || [])
      .filter(
        part =>
          typeof part.text === 'string'
      )
      .map(
        part =>
          part.text.trim()
      )
      .filter(Boolean);

  if (!texts.length) {
    throw new Error(
      'WORKIQ_EMPTY_ANSWER'
    );
  }

  return deduplicateAnswer(
    texts.join('\n')
  );
}


/*
 * Public analyzer interface.
 */
export async function analyze(
  command,
  parameters = {}
) {
  const prompt =
    await loadPrompt(command);

  const input =
    buildInput(
      prompt,
      parameters
    );

  const body =
    buildRequest(input);

  /*
   * getWorkIqAccessToken() handles:
   *
   *   refresh token
   *       ↓
   *   access token
   *       ↓
   *   in-memory cache
   */
  let token =
    await getWorkIqAccessToken();

  let response =
    await sendToWorkIq(
      token,
      body
    );

  /*
   * One controlled retry.
   *
   * A 401 may mean the cached access token was
   * rejected or expired. Force a refresh and retry
   * the same request exactly once.
   */
  if (response.status === 401) {
    const rejectionBody =
      await response.text();

    console.warn(
      `WORKIQ_TOKEN_REJECTED status=401 body=${rejectionBody}`
    );

    clearWorkIqAccessToken();

    token =
      await getWorkIqAccessToken({
        forceRefresh: true
      });

    response =
      await sendToWorkIq(
        token,
        body
      );
  }

  if (!response.ok) {
    const errorBody =
      await response.text();

    console.error(
      `WORKIQ_HTTP_ERROR status=${response.status} body=${errorBody}`
    );

    throw new Error(
      `WORKIQ_HTTP_${response.status}`
    );
  }

  let data;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      'WORKIQ_INVALID_JSON'
    );
  }

  const answer =
    extractAnswer(data);

  console.log(
    `WORKIQ_ANALYSIS_OK command=${command}`
  );

  return answer;
}
