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

import { useCallback, useMemo, useState } from "react";
import { MosaicNode } from "react-mosaic-component";
import { makeStyles } from "tss-react/mui";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { EmptyPanelLayout } from "@foxglove/studio-base/components/EmptyPanelLayout";
import Panel from "@foxglove/studio-base/components/Panel";
import { usePanelContext } from "@foxglove/studio-base/components/PanelContext";
import { UnconnectedPanelLayout } from "@foxglove/studio-base/components/PanelLayout";
import Stack from "@foxglove/studio-base/components/Stack";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks/useAppConfigurationValue";
import {
  DraggingTabPanelState,
  TabDndContext,
} from "@foxglove/studio-base/panels/Tab/TabDndContext";
import { TabbedToolbar } from "@foxglove/studio-base/panels/Tab/TabbedToolbar";
import { TabPanelConfig as Config } from "@foxglove/studio-base/types/layouts";
import { SaveConfig } from "@foxglove/studio-base/types/panels";
import { TAB_PANEL_TYPE } from "@foxglove/studio-base/util/globalConstants";
import { DEFAULT_TAB_PANEL_CONFIG } from "@foxglove/studio-base/util/layout";

const useStyles = makeStyles()((theme) => ({
  panelCover: {
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    zIndex: 2,
    background: theme.palette.background.paper,
    position: "absolute",
    opacity: 0.5,
  },
  tabContent: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    overflow: "hidden",
  },
  hiddenTab: {
    visibility: "hidden",
    pointerEvents: "none",
    zIndex: -999,
    userSelect: "none",
  },
  visibleTab: {
    visibility: "visible",
    pointerEvents: "auto",
    zIndex: 1,
    userSelect: "auto",
  },
}));

type Props = { config: Config; saveConfig: SaveConfig<Config> };

function Tab({ config, saveConfig }: Props) {
  const { id: panelId, hasFullscreenDescendant } = usePanelContext();
  const { classes } = useStyles();

  const { tabs, activeTabIdx } = config;
  const [isRenderAllTabs] = useAppConfigurationValue<boolean>(AppSetting.IS_RENDER_ALL_TABS);
  const renderAllTabs = isRenderAllTabs === true;
  const activeTab = tabs[activeTabIdx];
  const activeLayout = activeTab?.layout;

  // Generate stable keys for each tab to prevent React component reuse issues
  // Use tab index as stable key since tabs are identified by their position
  const tabKeys = useMemo(() => {
    return tabs.map((_, index) => `tab-${index}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only depend on length to prevent key regeneration when tab content changes
  }, [tabs.length]);

  // Holds the state of actively dragging tabs as they relate to this Tab Panel
  const [draggingTabState, setDraggingTabState] = useState<DraggingTabPanelState>({
    item: undefined,
    isOver: false,
  });

  // Create the actions used by the tab
  const selectTab = useCallback(
    (idx: number) => {
      saveConfig({ activeTabIdx: idx });
    },
    [saveConfig],
  );
  const setTabTitle = useCallback(
    (idx: number, title: string) => {
      const newTabs = tabs.slice();
      newTabs[idx] = { ...tabs[idx], title };
      saveConfig({ tabs: newTabs });
    },
    [saveConfig, tabs],
  );
  const removeTab = useCallback(
    (idx: number) => {
      const newTabs = tabs.slice(0, idx).concat(tabs.slice(idx + 1));
      const lastIdx = tabs.length - 1;
      saveConfig({
        tabs: newTabs,
        activeTabIdx: activeTabIdx === lastIdx ? lastIdx - 1 : activeTabIdx,
      });
    },
    [activeTabIdx, saveConfig, tabs],
  );
  const addTab = useCallback(() => {
    const newTab = { title: `${tabs.length + 1}`, layout: undefined };
    saveConfig({ ...config, activeTabIdx: tabs.length, tabs: tabs.concat([newTab]) });
  }, [config, saveConfig, tabs]);
  // Create stable layout change handlers for each tab to prevent unnecessary re-renders
  const tabLayoutChangeHandlers = useMemo(() => {
    return tabs.map((_, tabIndex) => (layout: MosaicNode<string> | undefined) => {
      const newTabs = tabs.slice();
      const currentTab = tabs[tabIndex];
      if (currentTab) {
        newTabs[tabIndex] = { ...currentTab, layout };
        const newConfig = { ...config, tabs: newTabs };
        saveConfig(newConfig);
      }
    });
  }, [config, saveConfig, tabs]);
  const activeTabLayoutChangeHandler = tabLayoutChangeHandlers[activeTabIdx];
  const actions = useMemo(
    () => ({ addTab, removeTab, selectTab, setTabTitle }),
    [addTab, removeTab, selectTab, setTabTitle],
  );

  // If the user drags the active tab out of the toolbar, we'll hide the
  // active layout in order to prevent tabs from dropping into child tabs.
  const draggingTab = draggingTabState.item;
  const preventTabDrop =
    !!draggingTab &&
    draggingTab.panelId === panelId &&
    draggingTab.tabIndex === activeTabIdx &&
    !draggingTabState.isOver;

  return (
    <Stack flex="auto" overflow="hidden">
      {!hasFullscreenDescendant && (
        <TabbedToolbar
          panelId={panelId}
          tabs={tabs}
          actions={actions}
          activeTabIdx={activeTabIdx}
          setDraggingTabState={setDraggingTabState}
        />
      )}
      <Stack direction="row" flex="auto" overflow="hidden" position="relative">
        {/* Show EmptyPanelLayout when there are no tabs */}
        {tabs.length === 0 ? (
          <EmptyPanelLayout tabId={panelId} />
        ) : renderAllTabs ? (
          /* Render all tabs but control visibility with CSS */
          (tabs.map((tab, tabIndex) => {
            const isActive = tabIndex === activeTabIdx;
            const tabLayout = tab.layout;
            const stableKey = tabKeys[tabIndex];

            return (
              <div
                key={stableKey}
                className={`${classes.tabContent} ${
                  isActive ? classes.visibleTab : classes.hiddenTab
                }`}
              >
                {tabLayout != undefined ? (
                  <TabDndContext.Provider value={{ preventTabDrop: preventTabDrop && isActive }}>
                    <UnconnectedPanelLayout
                      layout={tabLayout}
                      onChange={tabLayoutChangeHandlers[tabIndex]!}
                      tabId={panelId}
                    />
                  </TabDndContext.Provider>
                ) : (
                  <EmptyPanelLayout tabId={panelId} />
                )}
              </div>
            );
          }))
        ) : activeLayout != undefined ? (
          <TabDndContext.Provider value={{ preventTabDrop }}>
            <UnconnectedPanelLayout
              layout={activeLayout}
              onChange={activeTabLayoutChangeHandler ?? (() => undefined)}
              tabId={panelId}
            />
          </TabDndContext.Provider>
        ) : (
          <EmptyPanelLayout tabId={panelId} />
        )}
        {preventTabDrop && <div className={classes.panelCover} />}
      </Stack>
    </Stack>
  );
}

Tab.panelType = TAB_PANEL_TYPE;
Tab.defaultConfig = DEFAULT_TAB_PANEL_CONFIG;

export default Panel(Tab);
