// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
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

async function getLatestVersion(system: string, arch: string) {
  const baseUrl = APP_CONFIG.COSTUDIO_DOWNLOAD_URL;

  // 根据系统和架构确定 yml 文件路径
  const ymlPath = getYmlPath(system, arch);
  const latestYmlUrl = `${baseUrl}/${ymlPath}`;

  try {
    // 获取并解析 yml 文件
    const response = await fetch(latestYmlUrl);
    if (!response.ok) {
      throw new Error("Failed to fetch the latest version information");
    }
    const text = await response.text();
    const result = parseYml(text);

    // 根据系统和架构选择目标文件
    const targetFile = findTargetFile(result.files, system, arch);
    if (!targetFile) {
      throw new Error(`No installation package found for ${system} ${arch}`);
    }

    return `${baseUrl}/${targetFile.url}`;
  } catch (error) {
    console.error("Failed to get the latest version information:", error);
    throw error;
  }
}

// 获取对应的 yml 文件路径
function getYmlPath(system: string, arch: string) {
  switch (system) {
    case "windows":
      return "latest.yml";
    case "linux":
      return arch === "arm64" ? "latest-linux-arm64.yml" : "latest-linux.yml";
    case "mac":
      return "latest-mac.yml";
    default:
      throw new Error(`Unsupported system type: ${system}`);
  }
}

// 解析 yml 文件内容
function parseYml(text: string) {
  const lines = text.split("\n");
  const result: {
    version: string;
    files: { url: string; sha512?: string; size?: number }[];
  } = {
    version: "",
    files: [],
  };

  let currentFile: { url: string; sha512?: string; size?: number } | undefined = undefined;
  for (let line of lines) {
    line = line.trim();

    if (line.startsWith("version:")) {
      result.version = line.split(":")[1]?.trim() ?? "";
    } else if (line.startsWith("- url:")) {
      if (currentFile) {
        result.files.push(currentFile);
      }
      currentFile = { url: line.split(":")[1]?.trim() ?? "" };
    } else if (currentFile) {
      if (line.startsWith("sha512:")) {
        currentFile.sha512 = line.split(":")[1]?.trim() ?? "";
      } else if (line.startsWith("size:")) {
        currentFile.size = parseInt(line.split(":")[1]?.trim() ?? "");
      }
    }
  }

  if (currentFile) {
    result.files.push(currentFile);
  }

  return result;
}

// 根据系统和架构查找目标文件
function findTargetFile(files: { url: string }[], system: string, arch: string) {
  if (system === "linux") {
    // Linux 版本直接使用第一个文件
    return files[0];
  }

  return files.find((file) => {
    if (system === "windows") {
      return arch === "amd64"
        ? file.url.includes("-win-x64.exe")
        : file.url.includes("-win-arm64.exe");
    } else if (system === "mac") {
      return file.url.includes("-mac-universal.dmg");
    }
    return false;
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

  if (platform === "mac") {
    const latestVersion = await getLatestVersion("mac", "universal");
    window.open(latestVersion);
  }

  if (platform === "windows") {
    const latestVersion = await getLatestVersion("windows", arch);
    window.open(latestVersion);
  }

  if (platform === "linux") {
    const latestVersion = await getLatestVersion("linux", arch);
    window.open(latestVersion);
  }
}

export async function getCoStudioVersion(): Promise<string> {
  try {
    const response = await fetch(
      "https://coscene-download.oss-cn-hangzhou.aliyuncs.com/coStudio/packages/latest.yml",
    );
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
