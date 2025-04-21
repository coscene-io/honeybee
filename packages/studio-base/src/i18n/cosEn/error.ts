// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const cosError = {
  loginExpired: "Login expired, please login again",
  blankAuthToken: "Blank auth token in the request",
  currentUrlNotSupported: "Current URL is not supported",
  insecureWebSocketConnection: "Insecure WebSocket connection",
  insecureWebSocketConnectionMessage:
    "Check that the WebSocket server at {{url}} is reachable and supports protocol version {{version}}.",
  checkNetworkConnection: "Please check the network status of the device or robot you are using.",
  checkFoxgloveBridge: "Please check if your robot has installed <docLink>coBridge</docLink>",
  contactUs: "If none of the above methods can solve the issue, please contact us.",
  connectionFailed: "Connection failed",
  inactivePage: "The page is inactive",
  inactivePageDescription:
    "The page has been inactive for a long time and the connection has been disconnected. <btn>Reconnect</btn>",
  repetitiveConnection: "Repetitive connections",
  repeatedConnectionDesc:
    "Only one person can connect to the same robot at a time. There is currently a user connected, please refresh and try again later.",
  fileFormatUnsupported: "The file format is unsupported.",

  // error code message
  SEMANTIC_LIB_ERROR: "Internal semantic-lib error",
  GET_JOBRUN_FROM_DPS: "Failed to get jobrun from data platform",
  GET_PROJECT_FROM_DPS: "Failed to get project information from data platform",
  GET_FILES_FROM_DPS: "Failed to get Files from data platform",
  GET_RECORD_FROM_DPS: "Failed to get record from data platform",
  ILLEGAL_REQUEST_TIMESTAMP: "Illegal timestamp",
  ILLEGAL_ARGUMENT: "Illegal argument",
  PARSE_MEDIA_BUFFER_FAILED: "Failed to parse media buffer",
  GENERATE_MEDIA_FAILED: "Failed to generate media",
  GENERATE_DATA_INTERPRETATION_FAILED: "Failed to generate data interpretation",
  FILE_MEDIA_LOST: "Media is missing, generating asynchronously, please try again later",
  READ_MEDIA_FILE_FAILED: "Failed to read media file",
  BLANK_AUTH_TOKEN: "Auth token is empty",
  INVALID_TOKEN: "Invalid token",
  TOKEN_PERMISSION_DENIED: "Token permission denied",
  UNKNOWN_AUTH_ERROR: "Unknown token error",
  GET_RESPONSE_FROM_BFF: "Failed to get information from bff",
  USE_FOR_ALWAYS_FAIL: "This error code is only triggered by the alwaysFail interface",
  UNKNOWN_ERROR: "Other errors",
};
