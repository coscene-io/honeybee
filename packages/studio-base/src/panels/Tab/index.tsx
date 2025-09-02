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

import { useCallback, useMemo, useRef, useState } from "react";
import { MosaicNode } from "react-mosaic-component";
import { makeStyles } from "tss-react/mui";

import { EmptyPanelLayout } from "@foxglove/studio-base/components/EmptyPanelLayout";
import Panel from "@foxglove/studio-base/components/Panel";
import { usePanelContext } from "@foxglove/studio-base/components/PanelContext";
import { UnconnectedPanelLayout } from "@foxglove/studio-base/components/PanelLayout";
import Stack from "@foxglove/studio-base/components/Stack";
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
  const panelId = usePanelContext().id;
  const { classes } = useStyles();

  const { tabs, activeTabIdx } = config;

  // Generate stable keys for each tab to prevent React component reuse issues
  // Use a WeakMap to store stable IDs for tab objects
  const tabIdMap = useRef(new WeakMap<object, string>());
  const tabIdCounter = useRef(0);

  const tabKeys = useMemo(() => {
    return tabs.map((tab) => {
      // Check if this tab object already has a stable ID
      let tabId = tabIdMap.current.get(tab);
      if (!tabId) {
        // Generate a new stable ID for this tab object
        tabId = `tab-${tabIdCounter.current++}`;
        tabIdMap.current.set(tab, tabId);
      }
      return tabId;
    });
  }, [tabs]);

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
  // Create individual layout change handlers for each tab to maintain state
  const createTabLayoutChangeHandler = useCallback(
    (tabIndex: number) => (layout: MosaicNode<string> | undefined) => {
      const newTabs = tabs.slice();
      const currentTab = tabs[tabIndex];
      if (currentTab) {
        newTabs[tabIndex] = { ...currentTab, layout };
        const newConfig = { ...config, tabs: newTabs };
        saveConfig(newConfig);
      }
    },
    [config, saveConfig, tabs],
  );
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
      <TabbedToolbar
        panelId={panelId}
        tabs={tabs}
        actions={actions}
        activeTabIdx={activeTabIdx}
        setDraggingTabState={setDraggingTabState}
      />
      <Stack direction="row" flex="auto" overflow="hidden" position="relative">
        {/* Show EmptyPanelLayout when there are no tabs */}
        {tabs.length === 0 ? (
          <EmptyPanelLayout tabId={panelId} />
        ) : (
          /* Render all tabs but control visibility with CSS */
          tabs.map((tab, tabIndex) => {
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
                      onChange={createTabLayoutChangeHandler(tabIndex)}
                      tabId={panelId}
                    />
                  </TabDndContext.Provider>
                ) : (
                  <EmptyPanelLayout tabId={panelId} />
                )}
              </div>
            );
          })
        )}
        {preventTabDrop && <div className={classes.panelCover} />}
      </Stack>
    </Stack>
  );
}

Tab.panelType = TAB_PANEL_TYPE;
Tab.defaultConfig = DEFAULT_TAB_PANEL_CONFIG;

export default Panel(Tab);
