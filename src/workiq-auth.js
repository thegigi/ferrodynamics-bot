import fs from 'node:fs/promises';
import path from 'node:path';

const TENANT_ID =
  '1eb59533-edcb-413e-b869-72bac5f9bf23';

const APP_ID =
  'd0af3f26-ccea-4fc4-afae-b02adb8ff792';

const WORKIQ_SCOPE =
  'api://workiq.svc.cloud.microsoft/WorkIQAgent.Ask';

const TOKEN_URL =
  `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;

const DATA_DIR =
  process.env.DATA_DIR || '/data';

const REFRESH_TOKEN_FILE =
  path.join(
    DATA_DIR,
    'workiq-refresh-token'
  );

let cachedAccessToken = '';
let cachedAccessTokenExpiresAt = 0;
let currentRefreshToken = '';

async function readRefreshToken() {
  if (currentRefreshToken) {
    return currentRefreshToken;
  }

  try {
    const value =
      await fs.readFile(
        REFRESH_TOKEN_FILE,
        'utf8'
      );

    if (value.trim()) {
      currentRefreshToken =
        value.trim();

      console.log(
        'WORKIQ_REFRESH_TOKEN_LOADED_FROM_FILE'
      );

      return currentRefreshToken;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(
        'WORKIQ_REFRESH_TOKEN_READ_FAILED',
        err
      );
    }
  }

  const environmentToken =
    process.env.WORKIQ_REFRESH_TOKEN || '';

  if (environmentToken) {
    currentRefreshToken =
      environmentToken.trim();

    console.log(
      'WORKIQ_REFRESH_TOKEN_LOADED_FROM_ENV'
    );

    return currentRefreshToken;
  }

  throw new Error(
    'WORKIQ_REFRESH_TOKEN_NOT_CONFIGURED'
  );
}

async function saveRefreshToken(
  refreshToken
) {
  if (!refreshToken) {
    return;
  }

  await fs.mkdir(
    DATA_DIR,
    { recursive: true }
  );

  const temporaryFile =
    `${REFRESH_TOKEN_FILE}.tmp`;

  await fs.writeFile(
    temporaryFile,
    refreshToken,
    {
      encoding: 'utf8',
      mode: 0o600
    }
  );

  await fs.rename(
    temporaryFile,
    REFRESH_TOKEN_FILE
  );

  currentRefreshToken =
    refreshToken;

  console.log(
    'WORKIQ_REFRESH_TOKEN_ROTATED'
  );
}

async function refreshAccessToken() {
  const refreshToken =
    await readRefreshToken();

  const body =
    new URLSearchParams();

  body.set(
    'client_id',
    APP_ID
  );

  body.set(
    'grant_type',
    'refresh_token'
  );

  body.set(
    'refresh_token',
    refreshToken
  );

  body.set(
    'scope',
    `${WORKIQ_SCOPE} offline_access`
  );

  console.log(
    'WORKIQ_TOKEN_REFRESH_START'
  );

  const response =
    await fetch(
      TOKEN_URL,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        },

        body
      }
    );

  const responseText =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(responseText);
  } catch {
    throw new Error(
      `WORKIQ_TOKEN_INVALID_RESPONSE_${response.status}`
    );
  }

  if (!response.ok) {
    console.error(
      'WORKIQ_TOKEN_REFRESH_FAILED',
      {
        status:
          response.status,

        error:
          data.error,

        description:
          data.error_description
      }
    );

    throw new Error(
      `WORKIQ_TOKEN_REFRESH_HTTP_${response.status}`
    );
  }

  if (!data.access_token) {
    throw new Error(
      'WORKIQ_TOKEN_REFRESH_NO_ACCESS_TOKEN'
    );
  }

  const expiresIn =
    Number(data.expires_in || 3600);

  cachedAccessToken =
    data.access_token;

  cachedAccessTokenExpiresAt =
    Date.now() +
    expiresIn * 1000;

  if (data.refresh_token) {
    await saveRefreshToken(
      data.refresh_token
    );
  }

  console.log(
    `WORKIQ_TOKEN_REFRESH_OK expiresIn=${expiresIn}`
  );

  return cachedAccessToken;
}

export async function getWorkIqAccessToken({
  forceRefresh = false
} = {}) {
  const safetyWindowMs =
    5 * 60 * 1000;

  const tokenStillValid =
    cachedAccessToken &&
    Date.now() <
      cachedAccessTokenExpiresAt -
      safetyWindowMs;

  if (
    !forceRefresh &&
    tokenStillValid
  ) {
    return cachedAccessToken;
  }

  return await refreshAccessToken();
}

export function clearWorkIqAccessToken() {
  cachedAccessToken = '';
  cachedAccessTokenExpiresAt = 0;
}
