/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { createStore } from "zustand";

import {
  ExtensionCatalog,
  ExtensionCatalogContext,
  RegisteredPanel,
} from "@foxglove/studio-base/context/ExtensionCatalogContext";
import { type PanelInfo, usePanelCatalog } from "@foxglove/studio-base/context/PanelCatalogContext";

import PanelCatalogProvider from "./PanelCatalogProvider";

function makeRegisteredPanel(): RegisteredPanel {
  return {
    extensionName: "sample-extension",
    extensionNamespace: "local",
    registration: {
      name: "sample-panel",
      initPanel: jest.fn(),
    },
  };
}

function makeExtensionCatalogStore(panel: RegisteredPanel) {
  return createStore<ExtensionCatalog>(() => ({
    downloadExtension: async () => new Uint8Array(),
    installExtension: async () => {
      throw new Error("unsupported");
    },
    refreshExtensions: async () => {},
    uninstallExtension: async () => {},
    loadState: "ready",
    loadErrors: [],
    installedExtensions: [],
    installedPanels: { "sample-extension.sample-panel": panel },
    installedMessageConverters: [],
    installedTopicAliasFunctions: [],
    panelSettings: {},
  }));
}

function PanelCatalogProbe(props: {
  onCatalog: (panel: PanelInfo | undefined) => void;
}): React.JSX.Element {
  const panelCatalog = usePanelCatalog();
  useEffect(() => {
    props.onCatalog(panelCatalog.getPanelByType("sample-extension.sample-panel"));
  }, [panelCatalog, props]);
  return <></>;
}

describe("PanelCatalogProvider", () => {
  it("keeps a cached activation snapshot mounted across refreshes", async () => {
    const registeredPanel = makeRegisteredPanel();
    const store = makeExtensionCatalogStore(registeredPanel);
    const observedPanels: (PanelInfo | undefined)[] = [];

    render(
      <ExtensionCatalogContext.Provider value={store}>
        <PanelCatalogProvider>
          <PanelCatalogProbe onCatalog={(panel) => observedPanels.push(panel)} />
        </PanelCatalogProvider>
      </ExtensionCatalogContext.Provider>,
    );

    await waitFor(() => {
      expect(observedPanels.at(-1)?.module).toBeDefined();
    });
    const initialModule = observedPanels.at(-1)!.module;

    act(() => {
      store.setState({
        installedPanels: {
          "sample-extension.sample-panel": registeredPanel,
        },
      });
    });
    await waitFor(() => {
      expect(observedPanels.length).toBeGreaterThanOrEqual(2);
    });
    expect(observedPanels.at(-1)?.module).toBe(initialModule);

    act(() => {
      store.setState({
        installedPanels: {
          "sample-extension.sample-panel": makeRegisteredPanel(),
        },
      });
    });
    await waitFor(() => {
      expect(observedPanels.at(-1)?.module).not.toBe(initialModule);
    });

    const changedModule = await observedPanels.at(-1)!.module();
    expect(changedModule.default.configInitialization).toBe("none");
  });
});
