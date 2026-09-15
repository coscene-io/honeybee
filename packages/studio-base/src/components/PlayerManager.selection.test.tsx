/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { act, render } from "@testing-library/react";
import { PropsWithChildren, useContext } from "react";

import PlayerSelectionContext, {
  DataSourceArgs,
  IDataSourceFactory,
  PlayerSelection,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import type { Player } from "@foxglove/studio-base/players/types";

import PlayerManager from "./PlayerManager";

const mockSetDataSource = jest.fn();
const mockStore = {
  record: {},
  project: {},
  jobRun: {},
  dataSource: { id: "live", type: "connection", sessionId: "live-session" },
  setDataSource: mockSetDataSource,
};
const mockConsoleApi = { setType: jest.fn() };
const mockEmpty = {};
const mockRecents = { recents: [], addRecent: jest.fn() };
const mockEnqueueSnackbar = jest.fn();

jest.mock("notistack", () => ({ useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }) }));
jest.mock("@foxglove/studio-base/context/AnalyticsContext", () => ({
  useAnalytics: () => mockEmpty,
}));
jest.mock("@foxglove/studio-base/context/CoSceneConsoleApiContext", () => ({
  useConsoleApi: () => mockConsoleApi,
}));
jest.mock("@foxglove/studio-base/context/CoreDataContext", () => ({
  useCoreData: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));
jest.mock("@foxglove/studio-base/context/CurrentLayoutContext", () => ({
  useCurrentLayoutSelector: () => mockEmpty,
}));
jest.mock("@foxglove/studio-base/context/PerformanceContext", () => ({
  usePerformance: () => mockEmpty,
}));
jest.mock("@foxglove/studio-base/context/UserScriptStateContext", () => ({
  useUserScriptState: () => mockEmpty,
}));
jest.mock("@foxglove/studio-base/hooks", () => ({ useAppConfigurationValue: () => [] }));
jest.mock("@foxglove/studio-base/hooks/useConfirm", () => ({ useConfirm: () => undefined }));
jest.mock("@foxglove/studio-base/hooks/useIndexedDbRecents", () => ({
  __esModule: true,
  default: () => mockRecents,
}));
jest.mock("@foxglove/studio-base/players/AnalyticsMetricsCollector", () => ({
  __esModule: true,
  default: jest.fn(() => ({ setProperty: jest.fn() })),
}));
jest.mock("@foxglove/studio-base/players/TopicAliasingPlayer/TopicAliasingPlayer", () => ({
  TopicAliasingPlayer: jest.fn((player: Player) => player),
}));
jest.mock("@foxglove/studio-base/players/UserScriptPlayer", () => ({
  __esModule: true,
  default: jest.fn((player: Player) => player),
}));
jest.mock("@foxglove/studio-base/components/MessagePipeline", () => ({
  MessagePipelineProvider: ({ children }: PropsWithChildren) => children,
}));

jest.mock("@foxglove/studio-base/components/CoreDataSyncAdapter", () => ({
  useSetShowtUrlKey: () => jest.fn(),
}));
jest.mock("@foxglove/studio-base/context/SubscriptionEntitlementContext", () => ({
  useEntitlementWithDialog: () => [true, jest.fn()],
}));
jest.mock("@foxglove/studio-base/context/UploadFilesContext", () => ({
  useUploadFiles: () => jest.fn(),
}));

function makePlayer() {
  return {
    close: jest.fn(async () => {}),
    reOpen: jest.fn(),
    setGlobalVariables: jest.fn(),
    setUserScripts: jest.fn(),
    setAliasFunctions: jest.fn(),
  };
}

describe("PlayerManager source selection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each<[string, string, DataSourceArgs | undefined]>([
    ["unknown source", "unknown", undefined],
    ["missing arguments", "replay", undefined],
  ])(
    "does not cancel a pending replay for an invalid request: %s",
    async (_label, sourceId, args) => {
      const live = makePlayer();
      const replay = makePlayer();
      let resolveClose = () => {};
      live.close.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          resolveClose = resolve;
        });
      });
      const initializeReplay = jest.fn(() => replay as unknown as Player);
      const sources: IDataSourceFactory[] = [
        {
          id: "live",
          type: "sample",
          displayName: "Live",
          initialize: () => live as unknown as Player,
        },
        {
          id: "replay",
          type: "persistent-cache",
          displayName: "Replay",
          initialize: initializeReplay,
        },
      ];
      // PlayerSelection exposes a fire-and-forget API; PlayerManager's implementation is async.
      type AsyncSelection = Omit<PlayerSelection, "selectSource"> & {
        selectSource: (sourceId: string, args?: DataSourceArgs) => Promise<void>;
      };
      let selection: AsyncSelection | undefined;
      function CaptureSelection() {
        selection = useContext(PlayerSelectionContext) as AsyncSelection;
        return ReactNull;
      }
      const view = render(
        <PlayerManager playerSources={sources}>
          <CaptureSelection />
        </PlayerManager>,
      );
      try {
        await act(async () => {
          await selection!.selectSource("live");
        });
        let pending: Promise<void> | undefined;
        await act(async () => {
          pending = selection!.selectSource("replay", { type: "persistent-cache" });
        });
        expect(live.close).toHaveBeenCalledTimes(1);
        await act(async () => {
          await selection!.selectSource(sourceId, args);
        });
        expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(1);
        expect(selection?.selectedSource?.id).toBe("live");
        await act(async () => {
          resolveClose();
          await pending;
        });
        expect(initializeReplay).toHaveBeenCalledTimes(1);
        expect(selection?.selectedSource?.id).toBe("replay");
        expect(mockSetDataSource).toHaveBeenLastCalledWith(
          expect.objectContaining({ type: "persistent-cache", sessionId: "live-session" }),
        );
      } finally {
        resolveClose();
        view.unmount();
      }
    },
  );
});
