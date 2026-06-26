/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect } from "react";

import MockMessagePipelineProvider from "@foxglove/studio-base/components/MessagePipeline/MockMessagePipelineProvider";
import AppConfigurationContext from "@foxglove/studio-base/context/AppConfigurationContext";
import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  type BagFileInfo,
  type CoScenePlaylistStore,
  usePlaylist,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import {
  type ExternalInitConfig,
  useCoreData,
} from "@foxglove/studio-base/context/CoreDataContext";
import PlayerSelectionContext from "@foxglove/studio-base/context/PlayerSelectionContext";
import type { ConfirmOptions, confirmTypes } from "@foxglove/studio-base/hooks/useConfirm";
import CoScenePlaylistProvider from "@foxglove/studio-base/providers/CoScenePlaylistProvider";
import CoreDataProvider from "@foxglove/studio-base/providers/CoreDataProvider";
import MockCoSceneCurrentUserProvider from "@foxglove/studio-base/providers/MockCoSceneCurrentUserProvider";
import ThemeProvider from "@foxglove/studio-base/theme/ThemeProvider";
import { makeMockAppConfiguration } from "@foxglove/studio-base/util/makeMockAppConfiguration";

import { BagView } from "./BagView";

type ConsoleApi = NonNullable<React.ContextType<typeof CoSceneConsoleApiContext>>;

function makeConsoleApiMock(overrides: Partial<Record<keyof ConsoleApi, unknown>>): ConsoleApi {
  return overrides as unknown as ConsoleApi;
}

function makeBag(name: string, fileType?: BagFileInfo["fileType"]): BagFileInfo {
  return {
    name,
    displayName: name,
    fileType,
    mediaStatues: "OK",
  };
}

function CoreDataSeeder(props: { externalInitConfig: ExternalInitConfig }): ReactNull {
  const setExternalInitConfig = useCoreData((state) => state.setExternalInitConfig);

  useLayoutEffect(() => {
    setExternalInitConfig(props.externalInitConfig);
  }, [props.externalInitConfig, setExternalInitConfig]);

  return ReactNull;
}

function PlaylistSeeder(props: { bagFiles: BagFileInfo[] }): ReactNull {
  const setBagFiles = usePlaylist((state: CoScenePlaylistStore) => state.setBagFiles);

  useLayoutEffect(() => {
    setBagFiles({ loading: false, value: props.bagFiles });
  }, [props.bagFiles, setBagFiles]);

  return ReactNull;
}

function renderBagView({
  bag = makeBag("files/current.bag"),
  confirmResult = "ok",
  playlistBagFiles = [makeBag("files/other.bag"), makeBag("files/current.bag")],
}: {
  bag?: BagFileInfo;
  confirmResult?: "ok" | "cancel";
  playlistBagFiles?: BagFileInfo[];
} = {}): {
  confirm: jest.MockedFunction<confirmTypes>;
  selectSource: jest.Mock;
  setExternalInitConfig: jest.Mock;
  updateUrl: jest.Mock;
} {
  const confirm: jest.MockedFunction<confirmTypes> = jest.fn(
    async (_options: ConfirmOptions) => confirmResult,
  );
  const selectSource = jest.fn();
  const setExternalInitConfig = jest.fn(async () => "new-key");
  const updateUrl = jest.fn();
  const externalInitConfig: ExternalInitConfig = {
    warehouseId: "warehouse-id",
    projectId: "project-id",
    recordId: "record-id",
    files: [{ recordName: "records/source-record" }, { filename: "files/other.bag" }],
  };

  render(
    <ThemeProvider isDark={false}>
      <AppConfigurationContext.Provider value={makeMockAppConfiguration()}>
        <CoSceneConsoleApiContext.Provider
          value={makeConsoleApiMock({
            setExternalInitConfig,
          })}
        >
          <PlayerSelectionContext.Provider
            value={{
              selectSource,
              selectRecent: jest.fn(),
              reloadCurrentSource: jest.fn(async () => {}),
              availableSources: [],
              recentSources: [],
            }}
          >
            <MockCoSceneCurrentUserProvider>
              <CoreDataProvider>
                <CoScenePlaylistProvider>
                  <MockMessagePipelineProvider
                    urlState={{
                      sourceId: "coscene-data-platform",
                      parameters: { key: "old-key" },
                    }}
                  >
                    <CoreDataSeeder externalInitConfig={externalInitConfig} />
                    <PlaylistSeeder bagFiles={playlistBagFiles} />
                    <BagView
                      bag={bag}
                      filter=""
                      isHovered={false}
                      isCurrent={false}
                      updateUrl={updateUrl}
                      onClick={jest.fn()}
                      onHoverStart={jest.fn()}
                      onHoverEnd={jest.fn()}
                      confirm={confirm}
                    />
                  </MockMessagePipelineProvider>
                </CoScenePlaylistProvider>
              </CoreDataProvider>
            </MockCoSceneCurrentUserProvider>
          </PlayerSelectionContext.Provider>
        </CoSceneConsoleApiContext.Provider>
      </AppConfigurationContext.Provider>
    </ThemeProvider>,
  );

  return { confirm, selectSource, setExternalInitConfig, updateUrl };
}

function showFileActions(filename: string): void {
  const fileNameElement = screen.getByText(filename);
  const bagBox = fileNameElement.parentElement?.parentElement;
  expect(bagBox).toBeTruthy();
  fireEvent.mouseEnter(bagBox!);
}

describe("<BagView />", () => {
  it("replaces the playlist with only the selected file after confirmation", async () => {
    const { confirm, selectSource, setExternalInitConfig, updateUrl } = renderBagView();

    showFileActions("files/current.bag");
    fireEvent.click(screen.getByLabelText("Play this file only"));

    await waitFor(() => {
      expect(setExternalInitConfig).toHaveBeenCalledWith({
        warehouseId: "warehouse-id",
        projectId: "project-id",
        recordId: "record-id",
        files: [{ filename: "files/current.bag" }],
        targetFileName: "files/current.bag",
      });
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Play this file only?",
        prompt: "Only files/current.bag will remain playable in this window.",
      }),
    );
    expect(updateUrl).toHaveBeenCalledWith({ dsParams: { key: "new-key" } });
    expect(selectSource).toHaveBeenCalledWith("coscene-data-platform", {
      type: "connection",
      params: expect.objectContaining({
        key: "new-key",
        userId: "mock-user",
      }),
    });
  });

  it("does not update the playlist when play-only confirmation is canceled", async () => {
    const { confirm, setExternalInitConfig } = renderBagView({ confirmResult: "cancel" });

    showFileActions("files/current.bag");
    fireEvent.click(screen.getByLabelText("Play this file only"));

    await waitFor(() => {
      expect(confirm).toHaveBeenCalled();
    });
    expect(setExternalInitConfig).not.toHaveBeenCalled();
  });

  it("does not render the play-only button for shadow files", () => {
    renderBagView({ bag: makeBag("files/shadow.bag", "GHOST_RESULT_FILE") });

    expect(screen.queryByLabelText("Play this file only")).toBeNull();
  });
});
