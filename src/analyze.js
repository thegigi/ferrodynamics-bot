import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const WORKIQ_URL = 'https://workiq.svc.cloud.microsoft/a2a/';

function deduplicateAnswer(text) {
  const value = text.trim();

  if (!value) {
    return value;
  }

  const length = value.length;

  for (let split = Math.floor(length / 2) - 5;
       split <= Math.floor(length / 2) + 5;
       split += 1) {

    if (split <= 0 || split >= length) {
      continue;
    }

    const first =
      value.slice(0, split).trim();

    const second =
      value.slice(split).trim();

    if (first === second) {
      return first;
    }
  }

  return value;
}

export async function analyze(command, parameters) {
  const token = process.env.WORKIQ_ACCESS_TOKEN;

  if (!token) {
    throw new Error('WORKIQ_ACCESS_TOKEN missing');
  }

  if (command !== 'summary') {
    throw new Error(`Unsupported command: ${command}`);
  }

  const prompt = await fs.readFile(
    new URL('../prompts/summary.txt', import.meta.url),
    'utf8'
  );

  const text = [
    prompt.trim(),
    '',
    'PARAMETERS:',
    parameters?.input || '',
    '',
    'MESSAGES:',
    JSON.stringify(parameters?.messages || [])
  ].join('\n');

  const body = {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'SendMessage',
    params: {
      message: {
        role: 'ROLE_USER',
        messageId: crypto.randomUUID(),
        parts: [
          { text }
        ],
        metadata: {
          Location: {
            timeZoneOffset: 180,
            timeZone: 'Europe/Bucharest'
          }
        }
      }
    }
  };

  const response = await fetch(WORKIQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'A2A-Version': '1.0'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Work IQ HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(
      `Work IQ: ${data.error.message || JSON.stringify(data.error)}`
    );
  }

  const task = data.result?.task;

  if (!task) {
    throw new Error('Work IQ returned no task');
  }

  const answer = task.artifacts
    ?.find(a => a.name === 'Answer')
    ?.parts
    ?.find(p => typeof p.text === 'string')
    ?.text;

  if (!answer) {
    throw new Error('Work IQ returned no Answer');
  }

  return deduplicateAnswer(answer);
}
