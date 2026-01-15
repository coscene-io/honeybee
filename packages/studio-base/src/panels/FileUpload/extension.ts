// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as React from "react";
import { createRoot } from "react-dom/client";

import type { ExtensionContext, PanelExtensionContext, SettingsTreeAction } from "@foxglove/studio";

import { FileUploadPanel } from "./components/FileUploadPanel";
import { defaultConfig, buildSettingsTree, settingsReducer, type Config } from "./config/settings";

export function activate(context: ExtensionContext) {
  context.registerPanel({
    name: "File Upload",

    initPanel(panelCtx: PanelExtensionContext) {
      // 1) 配置：先用默认值
      let cfg: Config = { ...defaultConfig };

      // 2) React 渲染
      const root = createRoot(panelCtx.panelElement);
      const render = () => {
        // 从配置中提取service设置
        const serviceSettings = {
          getBagListService: "coscene-real", // 使用真实的CoSceneConsoleApi服务
          submitFilesService: "coscene-real" // 使用真实的CoSceneConsoleApi服务
        };
        
        // 刷新按钮服务配置
        const refreshButtonServiceName = cfg.refreshButtonService.serviceName || "/api/test/end_and_get_candidates";
        
        root.render(React.createElement(FileUploadPanel, { 
          config: cfg, 
          context: panelCtx,
          serviceSettings,
          refreshButtonServiceName
        }));
      };

      // 3) 左侧设置：使用 updatePanelSettingsEditor
      const actionHandler = (action: SettingsTreeAction) => {
        if (action.action !== "update") {return;}
        cfg = settingsReducer(cfg, action);
        // 更新左侧与面板
        applySettingsEditor();
        render();
      };
      
      const applySettingsEditor = () => {
        panelCtx.updatePanelSettingsEditor({
          nodes: buildSettingsTree(cfg),
          actionHandler,
        });
      };
      applySettingsEditor();

      // 4) 首次渲染
      render();

      // 5) 清理
      return () => { root.unmount(); };
    },
  });
}

export function deactivate() {}