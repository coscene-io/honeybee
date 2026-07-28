/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PropsWithChildren, useLayoutEffect } from "react";

import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { ManifestStorageSourceSettings } from "@foxglove/studio-base/components/AppSettingsDialog/settings";
import AppConfigurationContext, {
  AppConfigurationValue,
  ChangeHandler,
  IAppConfiguration,
} from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import PlayerSelectionContext from "@foxglove/studio-base/context/PlayerSelectionContext";
import {
  COSCENE_VIZ_DATA_BASE_URL,
  ManifestStorageSource,
} from "@foxglove/studio-base/dataSources/manifestStorage";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";

const DEFAULT_OBJECT_STORAGE_BASE_URL = "default-storage.example.com";
const DISPLAYED_DEFAULT_OBJECT_STORAGE_BASE_URL = `https://${DEFAULT_OBJECT_STORAGE_BASE_URL}`;

class TestAppConfiguration implements IAppConfiguration {
  public set = jest.fn(async (key: string, value: AppConfigurationValue) => {
    this.#values.set(key, value);
    for (const listener of this.#listeners.get(key) ?? []) {
      listener(value);
    }
  });

  #values = new Map<string, AppConfigurationValue>();
  #listeners = new Map<string, Set<ChangeHandler>>();

  public get(key: string): AppConfigurationValue {
    return this.#values.get(key);
  }

  public addChangeListener(key: string, cb: ChangeHandler): void {
    let listeners = this.#listeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(key, listeners);
    }
    listeners.add(cb);
  }

  public removeChangeListener(key: string, cb: ChangeHandler): void {
    this.#listeners.get(key)?.delete(cb);
  }
}

function CoreDataSeeder(props: { sourceId?: string }): ReactNull {
  const setDataSource = useCoreData((state) => state.setDataSource);

  useLayoutEffect(() => {
    setDataSource(
      props.sourceId == undefined ? undefined : { id: props.sourceId, type: "connection" },
    );
  }, [props.sourceId, setDataSource]);

  return ReactNull;
}

function renderSetting(options: { sourceId?: string; fixedManifestOk?: boolean } = {}): {
  appConfiguration: TestAppConfiguration;
  reloadCurrentSource: jest.Mock<Promise<void>>;
} {
  const appConfiguration = new TestAppConfiguration();
  const reloadCurrentSource = jest.fn(async () => {});
  global.fetch = jest.fn().mockResolvedValue({ ok: options.fixedManifestOk ?? true });
  window.cosConfig = { OBJECT_STORAGE_BASE_URL: DEFAULT_OBJECT_STORAGE_BASE_URL };

  function Wrapper(props: PropsWithChildren): React.JSX.Element {
    return (
      <AppConfigurationContext.Provider value={appConfiguration}>
        <CoSceneConsoleApiContext.Provider
          value={
            {
              getApiBaseInfo: () => ({ projectId: "project-id", recordId: "record-id" }),
            } as never
          }
        >
          <PlayerSelectionContext.Provider
            value={{
              selectSource: jest.fn(),
              selectRecent: jest.fn(),
              reloadCurrentSource,
              availableSources: [],
              recentSources: [],
            }}
          >
            <CoreDataProvider>
              <CoreDataSeeder sourceId={options.sourceId} />
              {props.children}
            </CoreDataProvider>
          </PlayerSelectionContext.Provider>
        </CoSceneConsoleApiContext.Provider>
      </AppConfigurationContext.Provider>
    );
  }

  render(<ManifestStorageSourceSettings />, { wrapper: Wrapper });

  return { appConfiguration, reloadCurrentSource };
}

describe("ManifestStorageSourceSettings", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("does not render outside coscene-data-platform playback", () => {
    renderSetting({ sourceId: "coscene-websocket" });

    expect(screen.queryByText(/Manifest and MCAP request host/)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("renders both choices and enables the fixed host when the current manifest exists", async () => {
    renderSetting({ sourceId: "coscene-data-platform", fixedManifestOk: true });

    expect(await screen.findByText(/Manifest and MCAP request host/)).toBeTruthy();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "https://coscene-viz-data.coscene.io/projects/project-id/records/record-id/manifest.json",
        { method: "HEAD" },
      );
    });

    fireEvent.mouseDown(screen.getByRole("combobox"));

    expect(
      screen.getByRole("option", { name: `${DISPLAYED_DEFAULT_OBJECT_STORAGE_BASE_URL} default` }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: /OBJECT_STORAGE_BASE_URL/ })).toBeNull();
    expect(
      screen.getByRole("option", { name: COSCENE_VIZ_DATA_BASE_URL }).getAttribute("aria-disabled"),
    ).not.toBe("true");
  });

  it("disables the fixed host and explains when the current manifest is unavailable", async () => {
    renderSetting({ sourceId: "coscene-data-platform", fixedManifestOk: false });

    expect(await screen.findByText(/Manifest and MCAP request host/)).toBeTruthy();
    expect(await screen.findByText("This address cannot play the current file.")).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("combobox"));

    expect(
      screen.getByRole("option", { name: COSCENE_VIZ_DATA_BASE_URL }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("persists selection and offers to refresh the current source", async () => {
    const { appConfiguration, reloadCurrentSource } = renderSetting({
      sourceId: "coscene-data-platform",
      fixedManifestOk: true,
    });

    expect(await screen.findByText(/Manifest and MCAP request host/)).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: COSCENE_VIZ_DATA_BASE_URL }));

    await waitFor(() => {
      expect(appConfiguration.set).toHaveBeenCalledWith(
        AppSetting.MANIFEST_STORAGE_SOURCE,
        ManifestStorageSource.CoSceneVizData,
      );
    });
    expect(
      await screen.findByText(
        /Setting updated, will take effect the next time visualization starts/,
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Refresh now"));

    await waitFor(() => {
      expect(reloadCurrentSource).toHaveBeenCalledTimes(1);
    });
  });
});
