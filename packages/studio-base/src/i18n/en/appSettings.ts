// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const appSettings = {
  about: "About",
  advanced: "Advanced",
  askEachTime: "Ask each time",
  colorScheme: "Color scheme",
  dark: "Dark",
  debugModeDescription: "Enable panels and features for debugging CoScene",
  desktopApp: "Desktop app",
  displayTimestampsIn: "Display timestamps in",
  experimentalFeatures: "Experimental features",
  experimentalFeaturesDescription: "These features are unstable and not recommended for daily use.",
  extensions: "Extensions",
  followSystem: "Follow system",
  general: "General",
  language: "Language",
  layoutDebugging: "Layout debugging",
  layoutDebuggingDescription: "Show extra controls for developing and debugging layout storage.",
  light: "Light",
  newAppMenu: "Enable unified navigation",
  newAppMenuDescription: "Show the new menu and navigation.",
  noExperimentalFeatures: "Currently there are no experimental features.",
  openLinksIn: "Open links in",
  privacy: "Privacy",
  privacyDescription: "Changes will take effect the next time CoScene Studio is launched.",
  ros: "ROS",
  sendAnonymizedCrashReports: "Send anonymized crash reports",
  sendAnonymizedUsageData: "Send anonymized usage data to help us improve CoScene Studio",
  settings: "Settings",
  timestampFormat: "Timestamp format",
  webApp: "Web app",
  contact: "Contact",
  legal: "Legal",
  licenseTerms: "License terms",
  privacyPolicy: "Privacy policy",
  termsOfService: "Terms of service",
  security: "Security",
  updates: "Updates",
  automaticallyInstallUpdates: "Automatically install updates",
  tfCompatibilityMode: "TF compatibility mode",
  on: "On",
  off: "Off",
  tfCompatibilityModeHelp:
    "Once this mode is enabled, the coordinate system names will have the '/' prefix removed for compatibility with tf2's coordinate system names. <Link>More details</Link>",
  inactivityTimeout: "Real-time visualization inactivity timeout",
  inactivityTimeoutDescription: "Set the timeout for inactivity of the real-time visualization",
  seconds: "seconds",
  minutes: "minutes",
  neverDisconnect: "Never disconnect",
  retentionWindowMs: "Real-time visualization cache duration",
  noCache: "No cache",
  retentionWindowNextEffectiveNotice:
    "Setting updated, will take effect on next connection <Link>Reconnect now</Link>",
  retentionWindowDescription:
    "Set the cache duration of the real-time visualization, for playback of real-time data",
  requestWindow: "Data platform request window (s)",
  requestWindowDescription:
    "Controls how many seconds of data each data-platform request loads. Larger windows mean fewer API calls but slower seek response.",
  requestWindowNextEffectiveNotice:
    "Setting updated, will take effect the next time visualization starts. <Link>Refresh now</Link>",
  readAheadDuration: "Read-ahead buffer (s)",
  readAheadDurationDescription:
    "Sets how many seconds of data the player preloads ahead of playback. Higher values smooth playback but use more memory.",
  readAheadDurationNextEffectiveNotice:
    "Setting updated, will take effect the next time visualization starts. <Link>Refresh now</Link>",
  autoConnectToLan: "Real-time visualization auto connect to LAN",
  autoConnectToLanDescription:
    "When detected to be on the same LAN as the device, automatically connect to the LAN address, no need to manually confirm",
  isRenderAllTabs: "Render all tabs",
  isRenderAllTabsDescription:
    "Whether to render all tabs, including unopened tabs, after enabling, the speed of opening the tab page will be improved, but more memory will be occupied",
};
