import fs from 'node:fs/promises';
import path from 'node:path';

const PROMPTS_DIR =
  path.join(process.cwd(), 'prompts');

const MODEL_URL =
  process.env.MODEL_URL || '';

const MODEL_API_KEY =
  process.env.MODEL_API_KEY || '';

const MODEL_NAME =
  process.env.MODEL_NAME || '';

async function loadPrompt(command) {
  if (command !== 'summary') {
    throw new Error(
      'UNSUPPORTED_COMMAND'
    );
  }

  const filePath =
    path.join(
      PROMPTS_DIR,
      'summary.txt'
    );

  const prompt =
    await fs.readFile(
      filePath,
      'utf8'
    );

  if (!prompt.trim()) {
    throw new Error(
      'EMPTY_PROMPT'
    );
  }

  return prompt;
}

export async function analyze(
  command,
  parameters
) {
  if (!command) {
    throw new Error(
      'MISSING_COMMAND'
    );
  }

  if (
    !parameters ||
    typeof parameters !== 'object'
  ) {
    throw new Error(
      'INVALID_PARAMETERS'
    );
  }

  if (!MODEL_URL) {
    throw new Error(
      'MODEL_URL_NOT_CONFIGURED'
    );
  }

  const prompt =
    await loadPrompt(command);

  const payload = {
    model: MODEL_NAME || undefined,

    prompt,

    parameters
  };

  const headers = {
    'Content-Type':
      'application/json'
  };

  if (MODEL_API_KEY) {
    headers.Authorization =
      `Bearer ${MODEL_API_KEY}`;
  }

  console.log(
    `AI_REQUEST command=${command}`
  );

  const response =
    await fetch(
      MODEL_URL,
      {
        method: 'POST',

        headers,

        body:
          JSON.stringify(payload)
      }
    );

  if (!response.ok) {
    const body =
      await response.text();

    console.error(
      `AI_HTTP_ERROR status=${response.status}`
    );

    throw new Error(
      `MODEL_HTTP_${response.status}: ${body}`
    );
  }

  const contentType =
    response.headers.get(
      'content-type'
    ) || '';

  let result;

  if (
    contentType.includes(
      'application/json'
    )
  ) {
    const data =
      await response.json();

    result =
      data.result ||
      data.response ||
      data.output ||
      data.text;
  } else {
    result =
      await response.text();
  }

  if (
    typeof result !== 'string' ||
    !result.trim()
  ) {
    throw new Error(
      'EMPTY_MODEL_RESPONSE'
    );
  }

  console.log(
    `AI_COMPLETE command=${command}`
  );

  return result.trim();
}
