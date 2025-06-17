// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

// extra boundary added for jest testing, since jsdom's Blob doesn't support .text()
import getArch from "arch";

import { APP_CONFIG } from "@foxglove/studio-base/util/appConfig";
import isDesktopApp from "@foxglove/studio-base/util/isDesktopApp";

export function downloadTextFile(text: string, fileName: string): void {
  downloadFiles([{ blob: new Blob([text]), fileName }]);
}

export function downloadFiles(files: { blob: Blob; fileName: string }[]): void {
  const body = document.body;

  const link = document.createElement("a");
  link.style.display = "none";
  body.appendChild(link);

  const urls = files.map((file) => {
    const url = window.URL.createObjectURL(file.blob);
    link.setAttribute("download", file.fileName);
    link.setAttribute("href", url);
    link.click();
    return url;
  });

  // remove the link after triggering download
  window.requestAnimationFrame(() => {
    body.removeChild(link);
    urls.forEach((url) => {
      URL.revokeObjectURL(url);
    });
  });
}

export async function downloadLatestStudio(): Promise<void> {
  const arch = getArch() === "x64" ? "amd64" : "arm64";
  let platform = navigator.userAgent.toLowerCase();

  if (platform.includes("mac")) {
    platform = "mac";
  } else if (platform.includes("win")) {
    platform = "windows";
  } else {
    platform = "linux";
  }

  switch (platform) {
    case "mac": {
      const downloadUrl = `${APP_CONFIG.COSTUDIO_DOWNLOAD_URL}/latest/coStudio_latest-mac_universal.dmg`;
      window.open(downloadUrl);
      break;
    }
    case "windows": {
      const downloadUrl =
        arch === "amd64"
          ? `${APP_CONFIG.COSTUDIO_DOWNLOAD_URL}/latest/coStudio_latest-win_x64.exe`
          : `${APP_CONFIG.COSTUDIO_DOWNLOAD_URL}/latest/coStudio_latest-win_arm64.exe`;
      window.open(downloadUrl);
      break;
    }
    case "linux": {
      const downloadUrl =
        arch === "amd64"
          ? `${APP_CONFIG.COSTUDIO_DOWNLOAD_URL}/latest/coStudio_latest-linux_amd64.deb`
          : `${APP_CONFIG.COSTUDIO_DOWNLOAD_URL}/latest/coStudio_latest-linux_arm64.deb`;
      window.open(downloadUrl);
      break;
    }
    default:
      break;
  }
}

export async function getCoStudioVersion(): Promise<string> {
  try {
    const response = await fetch(`${APP_CONFIG.COSTUDIO_DOWNLOAD_URL}/latest.yml`);
    const text = await response.text();

    // 使用正则表达式匹配 version 行
    const versionMatch = text.match(/^version:\s*(.+)$/m);

    if (versionMatch?.[1]) {
      return versionMatch[1].trim();
    } else {
      throw new Error("未找到版本信息");
    }
  } catch (error) {
    console.error("获取版本信息失败:", error);
    throw error;
  }
}

// first check current platform is not desktop, then check APP_CONFIG.COSTUDIO_DOWNLOAD_URL is not empty
export function checkSupportCoStudioDownload(): boolean {
  return !isDesktopApp() && !!APP_CONFIG.COSTUDIO_DOWNLOAD_URL;
}
