import * as React from "react";
import { createRoot } from "react-dom/client";
import type { ExtensionContext, PanelExtensionContext, SettingsTreeAction } from "@coscene/extension";
import { FileUploadPanel } from "./components/FileUploadPanel";
import type { Config } from "./config/types";
import { defaultConfig, useSettingsNodes, settingsActionReducer } from "./config/settings";

export function activate(context: ExtensionContext) {
  context.registerPanel({
    name: "File Upload",

    initPanel(panelCtx: PanelExtensionContext) {
      // 1) 配置：先用默认值
      let cfg: Config = { ...defaultConfig };

      // 2) React 渲染
      const root = createRoot(panelCtx.panelElement);
      const render = () => root.render(React.createElement(FileUploadPanel, { config: cfg }));

      // 3) 左侧设置：使用 updatePanelSettingsEditor
      const actionHandler = (action: SettingsTreeAction) => {
        if (action.action !== "update") return;
        cfg = settingsActionReducer(cfg, action);
        // 更新左侧与面板
        applySettingsEditor();
        render();
      };
      
      const applySettingsEditor = () => {
        panelCtx.updatePanelSettingsEditor?.({
          nodes: useSettingsNodes(cfg, actionHandler),
          actionHandler,
        });
      };
      applySettingsEditor();

      // 4) 首次渲染
      render();

      // 5) 清理
      return () => root.unmount();
    },
  });
}

export function deactivate() {}