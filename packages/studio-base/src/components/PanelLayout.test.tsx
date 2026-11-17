/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { createStore } from "zustand";

import Panel from "@foxglove/studio-base/components/Panel";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneLayoutManagerContext from "@foxglove/studio-base/context/CoSceneLayoutManagerContext";
import {
  LayoutState,
  useCurrentLayoutSelector,
} from "@foxglove/studio-base/context/CurrentLayoutContext";
import { PanelsActions } from "@foxglove/studio-base/context/CurrentLayoutContext/actions";
import {
  ExtensionCatalog,
  ExtensionCatalogContext,
} from "@foxglove/studio-base/context/ExtensionCatalogContext";
import PanelCatalogContext, {
  PanelCatalog,
  PanelInfo,
} from "@foxglove/studio-base/context/PanelCatalogContext";
import MockCurrentLayoutProvider from "@foxglove/studio-base/providers/CurrentLayoutProvider/MockCurrentLayoutProvider";
import { PanelStateContextProvider } from "@foxglove/studio-base/providers/PanelStateContextProvider";
import WorkspaceContextProvider from "@foxglove/studio-base/providers/WorkspaceContextProvider";
import MockCoSceneLayoutManager from "@foxglove/studio-base/services/LayoutManager/MockCoSceneLayoutManager";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import PanelLayout, { UnconnectedPanelLayout } from "./PanelLayout";

class MockPanelCatalog implements PanelCatalog {
  public constructor(private allPanels: PanelInfo[]) {}
  public getPanels(): readonly PanelInfo[] {
    return this.allPanels;
  }
  public getPanelByType(type: string): PanelInfo | undefined {
    return this.allPanels.find((panel) => !panel.config && panel.type === type);
  }
}

const selectConfigById = (state: LayoutState) => state.selectedLayout?.data?.configById ?? {};

function LayoutConfigProbe(): React.JSX.Element {
  const configById = useCurrentLayoutSelector(selectConfigById);
  return <output data-testid="layout-config">{JSON.stringify(configById)}</output>;
}

describe("UnconnectedPanelLayout", () => {
  it("does not remount panels when changing split percentage", async () => {
    function createTrackedPanel(type: string) {
      const renderPanel = jest.fn();
      const mounted = jest.fn();
      const unmounted = jest.fn();
      function TrackedPanel() {
        renderPanel();
        useEffect(() => {
          mounted();
          return unmounted;
        }, []);
        return <>{type.toUpperCase()}</>;
      }
      return {
        renderPanel,
        mounted,
        unmounted,
        module: jest.fn().mockResolvedValue({
          default: Panel(Object.assign(TrackedPanel, { panelType: type, defaultConfig: {} })),
        }),
      };
    }
    const panelA = createTrackedPanel("a");
    const panelB = createTrackedPanel("b");
    const panelC = createTrackedPanel("c");

    const panels: PanelInfo[] = [
      { title: "A", type: "a", module: panelA.module },
      { title: "B", type: "b", module: panelB.module },
      { title: "C", type: "c", module: panelC.module },
    ];

    const panelCatalog = new MockPanelCatalog(panels);

    const onChange = () => {
      throw new Error("unexpected call to onChange");
    };
    const { rerender, unmount } = render(
      <UnconnectedPanelLayout
        layout={{ first: "a", second: "b", direction: "row", splitPercentage: 50 }}
        onChange={onChange}
      />,
      {
        wrapper: function Wrapper({ children }: React.PropsWithChildren) {
          const [config] = useState(() => makeMockAppConfiguration());

          return (
            <DndProvider backend={HTML5Backend}>
              <WorkspaceContextProvider>
                <AppConfigurationContext.Provider value={config}>
                  <MockCurrentLayoutProvider>
                    <PanelStateContextProvider>
                      <PanelCatalogContext.Provider value={panelCatalog}>
                        {children}
                      </PanelCatalogContext.Provider>
                    </PanelStateContextProvider>
                  </MockCurrentLayoutProvider>
                </AppConfigurationContext.Provider>
              </WorkspaceContextProvider>
            </DndProvider>
          );
        },
      },
    );

    await waitFor(() => {
      expect(panelA.mounted).toHaveBeenCalledTimes(1);
      expect(panelB.mounted).toHaveBeenCalledTimes(1);
    });
    const rendersA = panelA.renderPanel.mock.calls.length;
    const rendersB = panelB.renderPanel.mock.calls.length;
    rerender(
      <UnconnectedPanelLayout
        layout={{ first: "a", second: "b", direction: "row", splitPercentage: 40 }}
        onChange={onChange}
      />,
    );
    expect(panelA.mounted).toHaveBeenCalledTimes(1);
    expect(panelB.mounted).toHaveBeenCalledTimes(1);
    expect(panelA.unmounted).not.toHaveBeenCalled();
    expect(panelB.unmounted).not.toHaveBeenCalled();
    expect(panelA.renderPanel).toHaveBeenCalledTimes(rendersA);
    expect(panelB.renderPanel).toHaveBeenCalledTimes(rendersB);

    rerender(
      <UnconnectedPanelLayout
        layout={{ first: "a", second: "c", direction: "row", splitPercentage: 40 }}
        onChange={onChange}
      />,
    );
    await waitFor(() => {
      expect(panelC.mounted).toHaveBeenCalledTimes(1);
    });
    expect(panelA.module).toHaveBeenCalledTimes(1);
    expect(panelB.module).toHaveBeenCalledTimes(1);
    expect(panelC.module).toHaveBeenCalledTimes(1);
    expect(panelA.renderPanel).toHaveBeenCalledTimes(rendersA);
    expect(panelB.renderPanel).toHaveBeenCalledTimes(rendersB);
    expect(panelA.unmounted).not.toHaveBeenCalled();
    expect(panelB.unmounted).toHaveBeenCalledTimes(1);

    unmount();
    expect(panelA.unmounted).toHaveBeenCalledTimes(1);
    expect(panelC.unmounted).toHaveBeenCalledTimes(1);
  });

  it("renders built-in panels while the extension catalog is still loading", async () => {
    const renderA = jest.fn().mockReturnValue(<>A</>);
    const moduleA = jest.fn().mockResolvedValue({
      default: Panel(Object.assign(renderA, { panelType: "a", defaultConfig: {} })),
    });
    const panelCatalog = new MockPanelCatalog([{ title: "A", type: "a", module: moduleA }]);
    const extensionCatalog = createStore<ExtensionCatalog>(() => ({
      downloadExtension: async () => new Uint8Array(),
      installExtension: async () => {
        throw new Error("unsupported");
      },
      refreshExtensions: async () => {},
      uninstallExtension: async () => {},
      loadState: "loading",
      loadErrors: [],
      installedExtensions: undefined,
      installedMessageConverters: [],
      installedPanels: {},
      installedTopicAliasFunctions: [],
      panelSettings: {},
    }));
    const layoutManager = new MockCoSceneLayoutManager();

    const { queryByText } = render(<PanelLayout />, {
      wrapper: function Wrapper({ children }: React.PropsWithChildren) {
        const [config] = useState(() => makeMockAppConfiguration());

        return (
          <DndProvider backend={HTML5Backend}>
            <WorkspaceContextProvider>
              <AppConfigurationContext.Provider value={config}>
                <CoSceneLayoutManagerContext.Provider value={layoutManager}>
                  <ExtensionCatalogContext.Provider value={extensionCatalog}>
                    <MockCurrentLayoutProvider initialState={{ layout: "a" }}>
                      <PanelStateContextProvider>
                        <PanelCatalogContext.Provider value={panelCatalog}>
                          {children}
                        </PanelCatalogContext.Provider>
                      </PanelStateContextProvider>
                    </MockCurrentLayoutProvider>
                  </ExtensionCatalogContext.Provider>
                </CoSceneLayoutManagerContext.Provider>
              </AppConfigurationContext.Provider>
            </WorkspaceContextProvider>
          </DndProvider>
        );
      },
    });

    await waitFor(() => {
      expect(renderA).toHaveBeenCalled();
    });
    expect(queryByText("Loading extensions…")).toBeNull();
  });

  it("keeps mounted built-in panels alive when the catalog publishes extensions", async () => {
    const mounted = jest.fn();
    const unmounted = jest.fn();
    const BuiltinPanel = () => {
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return <>Built-in panel</>;
    };
    const builtinModule = jest.fn().mockResolvedValue({
      default: Panel(Object.assign(BuiltinPanel, { panelType: "builtin", defaultConfig: {} })),
    });
    const extensionModule = jest.fn().mockResolvedValue({
      default: Panel(
        Object.assign(() => <>Extension panel</>, {
          panelType: "extension",
          defaultConfig: {},
        }),
      ),
    });
    const initialCatalog = new MockPanelCatalog([
      { title: "Built-in", type: "builtin", module: builtinModule },
    ]);
    const publishedCatalog = new MockPanelCatalog([
      { title: "Built-in", type: "builtin", module: builtinModule },
      { title: "Extension", type: "extension", module: extensionModule },
    ]);
    const config = makeMockAppConfiguration();
    const onChange = jest.fn();

    const tree = (panelCatalog: PanelCatalog) => (
      <DndProvider backend={HTML5Backend}>
        <WorkspaceContextProvider>
          <AppConfigurationContext.Provider value={config}>
            <MockCurrentLayoutProvider>
              <PanelStateContextProvider>
                <PanelCatalogContext.Provider value={panelCatalog}>
                  <UnconnectedPanelLayout layout="builtin!panel" onChange={onChange} />
                </PanelCatalogContext.Provider>
              </PanelStateContextProvider>
            </MockCurrentLayoutProvider>
          </AppConfigurationContext.Provider>
        </WorkspaceContextProvider>
      </DndProvider>
    );

    const { getByText, rerender, unmount } = render(tree(initialCatalog));
    await waitFor(() => {
      expect(getByText("Built-in panel")).toBeDefined();
    });
    const initialMountCount = mounted.mock.calls.length;
    const initialUnmountCount = unmounted.mock.calls.length;
    expect(initialMountCount).toBeGreaterThan(0);

    rerender(tree(publishedCatalog));
    await waitFor(() => {
      expect(getByText("Built-in panel")).toBeDefined();
    });
    expect(mounted).toHaveBeenCalledTimes(initialMountCount);
    expect(unmounted).toHaveBeenCalledTimes(initialUnmountCount);
    expect(builtinModule).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();

    unmount();
  });

  it("restores a late extension panel in place without rewriting the layout", async () => {
    const renderLatePanel = jest.fn().mockReturnValue(<>Late extension panel</>);
    const latePanelModule = jest.fn().mockResolvedValue({
      default: Panel(
        Object.assign(renderLatePanel, {
          panelType: "late-extension",
          defaultConfig: {},
          configInitialization: "none" as const,
        }),
      ),
    });
    const emptyCatalog = new MockPanelCatalog([]);
    const loadedCatalog = new MockPanelCatalog([
      { title: "Late extension", type: "late-extension", module: latePanelModule },
    ]);
    const config = makeMockAppConfiguration();
    const onChange = jest.fn();
    const layoutActions: PanelsActions[] = [];

    const tree = (panelCatalog: PanelCatalog) => (
      <DndProvider backend={HTML5Backend}>
        <WorkspaceContextProvider>
          <AppConfigurationContext.Provider value={config}>
            <MockCurrentLayoutProvider onAction={(action) => layoutActions.push(action)}>
              <LayoutConfigProbe />
              <PanelStateContextProvider>
                <PanelCatalogContext.Provider value={panelCatalog}>
                  <UnconnectedPanelLayout layout="late-extension!panel" onChange={onChange} />
                </PanelCatalogContext.Provider>
              </PanelStateContextProvider>
            </MockCurrentLayoutProvider>
          </AppConfigurationContext.Provider>
        </WorkspaceContextProvider>
      </DndProvider>
    );

    const { getByTestId, getByText, rerender } = render(tree(emptyCatalog));
    await waitFor(() => {
      expect(getByText("Unknown panel type: late-extension.")).toBeDefined();
    });
    expect(layoutActions).toEqual([]);
    expect(getByTestId("layout-config").textContent).toBe("{}");

    rerender(tree(loadedCatalog));
    await waitFor(() => {
      expect(getByText("Late extension panel")).toBeDefined();
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(latePanelModule).toHaveBeenCalledTimes(1);
    expect(layoutActions).toEqual([]);
    expect(getByTestId("layout-config").textContent).toBe("{}");
  });
});
