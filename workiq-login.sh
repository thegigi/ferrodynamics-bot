#!/usr/bin/env bash

TENANT_ID="1eb59533-edcb-413e-b869-72bac5f9bf23"
APP_ID="d0af3f26-ccea-4fc4-afae-b02adb8ff792"
WORKIQ_SCOPE="api://workiq.svc.cloud.microsoft/WorkIQAgent.Ask"

DEVICE_URL="https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/devicecode"
TOKEN_URL="https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token"

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is not installed."
  return 1 2>/dev/null || exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is not installed."
  return 1 2>/dev/null || exit 1
fi

echo "Requesting a new Work IQ device session..."

DEVICE_RESPONSE=$(curl -sS -X POST \
  "$DEVICE_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "client_id=${APP_ID}" \
  --data-urlencode "scope=${WORKIQ_SCOPE} offline_access")

DEVICE_ERROR=$(printf '%s' "$DEVICE_RESPONSE" | jq -r '.error // empty')

if [ -n "$DEVICE_ERROR" ]; then
  echo "DEVICE_REQUEST_FAILED"
  printf '%s\n' "$DEVICE_RESPONSE" | jq .
  return 1 2>/dev/null || exit 1
fi

DEVICE_CODE=$(printf '%s' "$DEVICE_RESPONSE" | jq -r '.device_code // empty')
USER_CODE=$(printf '%s' "$DEVICE_RESPONSE" | jq -r '.user_code // empty')
VERIFICATION_URI=$(printf '%s' "$DEVICE_RESPONSE" | jq -r '.verification_uri // empty')
INTERVAL=$(printf '%s' "$DEVICE_RESPONSE" | jq -r '.interval // 5')
EXPIRES_IN=$(printf '%s' "$DEVICE_RESPONSE" | jq -r '.expires_in // 900')

if [ -z "$DEVICE_CODE" ] || [ -z "$USER_CODE" ] || [ -z "$VERIFICATION_URI" ]; then
  echo "ERROR: Microsoft did not return a complete device session."
  printf '%s\n' "$DEVICE_RESPONSE" | jq .
  return 1 2>/dev/null || exit 1
fi

echo
echo "Open this address in the browser:"
echo "$VERIFICATION_URI"
echo
echo "Enter this code:"
echo "$USER_CODE"
echo
echo "Complete the Microsoft sign-in."
echo "This terminal will continue automatically."
echo

ELAPSED=0
AUTH_COMPLETE=0

while [ "$ELAPSED" -lt "$EXPIRES_IN" ]; do
  TOKEN_RESPONSE=$(curl -sS -X POST \
    "$TOKEN_URL" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
    --data-urlencode "client_id=${APP_ID}" \
    --data-urlencode "device_code=${DEVICE_CODE}")

  ERROR_CODE=$(printf '%s' "$TOKEN_RESPONSE" | jq -r '.error // empty')

  if [ "$ERROR_CODE" = "authorization_pending" ]; then
    printf '.'
    sleep "$INTERVAL"
    ELAPSED=$((ELAPSED + INTERVAL))
    continue
  fi

  if [ "$ERROR_CODE" = "slow_down" ]; then
    INTERVAL=$((INTERVAL + 5))
    printf '+'
    sleep "$INTERVAL"
    ELAPSED=$((ELAPSED + INTERVAL))
    continue
  fi

  if [ -n "$ERROR_CODE" ]; then
    echo
    echo "TOKEN_REQUEST_FAILED"
    printf '%s\n' "$TOKEN_RESPONSE" | jq .
    return 1 2>/dev/null || exit 1
  fi

  TOKEN=$(printf '%s' "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
  REFRESH_TOKEN=$(printf '%s' "$TOKEN_RESPONSE" | jq -r '.refresh_token // empty')
  TOKEN_SCOPE=$(printf '%s' "$TOKEN_RESPONSE" | jq -r '.scope // empty')
  TOKEN_EXPIRES_IN=$(printf '%s' "$TOKEN_RESPONSE" | jq -r '.expires_in // 0')

  if [ -z "$TOKEN" ]; then
    echo
    echo "ERROR: Authentication completed without an access token."
    printf '%s\n' "$TOKEN_RESPONSE" | jq 'del(.refresh_token,.id_token)'
    return 1 2>/dev/null || exit 1
  fi

  export WORKIQ_ACCESS_TOKEN="$TOKEN"
  export WORKIQ_REFRESH_TOKEN="$REFRESH_TOKEN"
  export WORKIQ_TOKEN_SCOPE="$TOKEN_SCOPE"
  export WORKIQ_TOKEN_EXPIRES_IN="$TOKEN_EXPIRES_IN"

  AUTH_COMPLETE=1
  break
done

echo

if [ "$AUTH_COMPLETE" -ne 1 ]; then
  echo "AUTHENTICATION_TIMEOUT"
  echo "Run the script again to obtain a new user code."
  return 1 2>/dev/null || exit 1
fi

echo "AUTHENTICATION_OK"
echo "Scope: $WORKIQ_TOKEN_SCOPE"
echo "Access token length: ${#WORKIQ_ACCESS_TOKEN}"
echo "Refresh token length: ${#WORKIQ_REFRESH_TOKEN}"
echo "Expires in seconds: $WORKIQ_TOKEN_EXPIRES_IN"
echo
echo "The tokens are available in:"
echo "WORKIQ_ACCESS_TOKEN"
echo "WORKIQ_REFRESH_TOKEN"

unset TOKEN
unset REFRESH_TOKEN
unset DEVICE_CODE
unset TOKEN_RESPONSE
unset DEVICE_RESPONSE
