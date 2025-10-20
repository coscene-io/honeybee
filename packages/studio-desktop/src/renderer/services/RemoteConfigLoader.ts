// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import Logger from "@foxglove/log";

const log = Logger.getLogger(__filename);

export interface RemoteConfigOptions {
  remoteUrl?: string;
  timeout?: number;
}

const DEFAULT_TIMEOUT = 5000;

export async function initializeCosConfig(options: RemoteConfigOptions): Promise<void> {
  // local config
  await loadLocalConfig();

  await loadRemoteConfig(options);
}

async function loadLocalConfig(): Promise<void> {
  const localConfigPath =
    window.location.protocol === "file:" ? "./cos-config.js" : "/cos-config.js";

  try {
    log.info(`Loading local config from: ${localConfigPath}`);
    await loadScriptWithTimeout(localConfigPath, 3000);
    log.info("Local config loaded successfully");
  } catch (error) {
    log.error("Failed to load local config:", error);
    // ensure at least an empty object
    window.cosConfig = window.cosConfig ?? {};
  }
}

/**
 * 加载远程配置并合并到本地配置
 */
async function loadRemoteConfig(options: RemoteConfigOptions): Promise<boolean> {
  const { remoteUrl, timeout = DEFAULT_TIMEOUT } = options;

  const pattern = /^https:\/\/(?:[a-z0-9-]+\.)*coscene\.(?:io|cn)\/?$/i;

  if (!remoteUrl || remoteUrl.trim() === "" || !pattern.test(remoteUrl)) {
    return false;
  }

  try {
    log.info(`Loading remote config from: ${remoteUrl}`);

    // 保存当前配置（此时已经加载了本地配置）
    const localConfig = { ...window.cosConfig };

    // 加载远程配置
    const success = await loadScriptWithTimeout(`${remoteUrl}/cos-config.js`, timeout);

    if (success && window.cosConfig && typeof window.cosConfig === "object") {
      // 合并配置：远程配置优先
      window.cosConfig = { ...localConfig, ...window.cosConfig };
      log.info("Remote config loaded and merged successfully");
      return true;
    } else {
      // 恢复本地配置
      window.cosConfig = localConfig;
      log.warn("Remote config is invalid, using local config");
      return false;
    }
  } catch (error) {
    log.warn("Failed to load remote config:", error);
    // 配置保持不变（使用本地配置）
    return false;
  }
}

/**
 * 使用 script 标签加载配置文件，带超时控制
 */
async function loadScriptWithTimeout(url: string, timeout: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = `${url}?t=${window.buildTime}`;

    let completed = false;
    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        script.remove();
        log.warn(`Script load timeout: ${url}`);
        resolve(false);
      }
    }, timeout);

    script.onload = () => {
      if (!completed) {
        completed = true;
        clearTimeout(timer);
        resolve(true);
      }
    };

    script.onerror = (error) => {
      if (!completed) {
        completed = true;
        clearTimeout(timer);
        script.remove();
        log.error(`Script load error: ${url}`, error);
        resolve(false);
      }
    };

    document.head.appendChild(script);
  });
}
