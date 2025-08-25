// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const cosWebsocket = {
  websocketSSLError: "WebSocket SSL Error",
  websocketSSLErrorDesc:
    'By default, Chrome prevents a secure <code>https://</code> page from connecting to an insecure <code>ws://</code> WebSocket server. To allow the connection, enable "Unsafe Scripts" for this page.',
  websocketSSLErrorDesc2:
    'Click the shield icon at the end of your address bar, and then click "Load Unsafe Scripts."',
  note: "Note",
  connectionOccupied:
    "The real-time visualisation of the device {{deviceName}} is being used by {{username}} and continuing to view it may affect others. Are you sure you want to continue?",
  confirm: "Confirm",
  cancel: "Cancel",
  notification: "Notification",
  vizIsTkenNow:
    "The real-time visualisation of the current device {{deviceName}} has been taken over by the user {{username}} and you are automatically logged out!",
  reconnetDesc: "Reconnect if necessary.",
  reconnect: "Reconnect",
  IKnow: "I know",
  vizIsDisconnected: "The real-time visualisation has been disconnected",
  inactivePageDescription:
    "You have been inactive for {{time}} minutes without any operation on this real-time visualisation, the connection has been automatically disconnected to save device traffic. You can adjust the disconnection duration in the settings.",
  exitAndClosePage: "Exit and close the page",
  lanAvailable: "LAN Available",
  lanConnectionPrompt:
    "Detected that you and the current device are on the same LAN, you can use LAN connection to improve network speed",
  switchNow: "Switch Now",
  keepCurrent: "Keep Current",
  switchToPlayback: "Switch to playback mode",
  switchToPlaybackDesc:
    "Playback the data that has been played, up to {{duration}} of data. Want to play more time? <ToSettings>Go to Settings</ToSettings>",
  switchToRealTime: "Switch to real-time mode",
  realTimeVizPlayback: "Real-time visualisation playback",
};
