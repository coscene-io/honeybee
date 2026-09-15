/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { act, render } from "@testing-library/react";
import { PropsWithChildren, useContext } from "react";

import type { CoreDataStore } from "@foxglove/studio-base/context/CoreDataContext";
import PlayerSelectionContext, {
  DataSourceArgs,
  IDataSourceFactory,
  PlayerSelection,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import type { Player } from "@foxglove/studio-base/players/types";

import PlayerManager from "./PlayerManager";

const mockSetDataSource = jest.fn();
const mockSetPlayerProperty = jest.fn();
const mockStore = {
  record: {},
  project: {},
  jobRun: {},
  dataSource: {
    id: "live",
    type: "connection",
    sessionId: "live-session",
  } as CoreDataStore["dataSource"],
  setDataSource: mockSetDataSource,
};
const mockConsoleApi = { setType: jest.fn() };
const mockEmpty = {};
const mockRecents = { recents: [], addRecent: jest.fn() };
const mockEnqueueSnackbar = jest.fn();

jest.mock("@foxglove/studio-base/persistence/IndexedDbMessageStore", () => ({
  IndexedDbMessageStore: jest.fn(() => ({
    discardAndSeal: jest.fn(async () => {}),
    close: jest.fn(async () => {}),
  })),
}));
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
  default: jest.fn(() => ({ setProperty: mockSetPlayerProperty })),
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

// PlayerSelection exposes a fire-and-forget API; PlayerManager's implementation is async.
type AsyncSelection = Omit<PlayerSelection, "selectSource"> & {
  selectSource: (sourceId: string, args?: DataSourceArgs) => Promise<void>;
};

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
    mockStore.dataSource = { id: "live", type: "connection", sessionId: "live-session" };
  });

  it.each(["synchronous error", "asynchronous error", "missing player", "superseded error"])(
    "handles sample initialization failure: %s",
    async (failure) => {
      const live = makePlayer();
      const replacement = makePlayer();
      let rejectSample = (_error: Error) => {};
      const sampleGate = new Promise<Player>((_resolve, reject) => {
        rejectSample = reject;
      });
      const sources: IDataSourceFactory[] = [
        {
          id: "live",
          type: "connection",
          displayName: "Live",
          initialize: () => live as unknown as Player,
        },
        {
          id: "replacement",
          type: "connection",
          displayName: "Replacement",
          initialize: () => replacement as unknown as Player,
        },
        {
          id: "sample",
          type: "sample",
          displayName: "Sample",
          initialize: (): ReturnType<IDataSourceFactory["initialize"]> => {
            if (failure === "synchronous error") {
              throw new Error("sample load failed");
            }
            if (failure === "missing player") {
              return undefined;
            }
            return sampleGate;
          },
        },
      ];
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
          await selection!.selectSource("live", { type: "connection" });
        });
        let selectingSample: Promise<void> | undefined;
        await act(async () => {
          selectingSample = selection!.selectSource("sample");
          if (failure === "superseded error") {
            await selection!.selectSource("replacement", { type: "connection" });
          }
          if (failure === "asynchronous error" || failure === "superseded error") {
            rejectSample(new Error("sample load failed"));
          }
          await selectingSample;
        });
        if (failure === "superseded error") {
          expect(selection?.selectedSource?.id).toBe("replacement");
          expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
        } else {
          expect(selection?.selectedSource?.id).toBe("live");
          expect(live.close).not.toHaveBeenCalled();
          expect(mockSetDataSource).toHaveBeenLastCalledWith(
            expect.objectContaining({ id: "live" }),
          );
          expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
            failure === "missing player"
              ? "Unable to initialize sample player"
              : "sample load failed",
            { variant: "error" },
          );
        }
      } finally {
        view.unmount();
      }
    },
  );

  it.each([
    {
      activeSession: undefined,
      explicitSession: "dialog-session",
      expectedSession: "dialog-session",
    },
    {
      activeSession: "live-session",
      explicitSession: "dialog-session",
      expectedSession: "dialog-session",
    },
    { activeSession: "live-session", explicitSession: "", expectedSession: "live-session" },
  ])(
    "opens replay session $expectedSession with active session $activeSession and field '$explicitSession'",
    async ({ activeSession, explicitSession, expectedSession }) => {
      mockStore.dataSource =
        activeSession == undefined
          ? undefined
          : { id: "live", type: "connection", sessionId: activeSession };
      const replay = makePlayer();
      const initialize = jest.fn(() => replay as unknown as Player);
      const sources: IDataSourceFactory[] = [
        { id: "replay", type: "persistent-cache", displayName: "Replay", initialize },
      ];
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
          await selection!.selectSource("replay", {
            type: "persistent-cache",
            params: { sessionId: explicitSession },
          });
        });
        expect(initialize).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: expectedSession }),
        );
        expect(mockSetDataSource).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "replay",
            type: "persistent-cache",
            sessionId: expectedSession,
          }),
        );
        expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
      } finally {
        view.unmount();
      }
    },
  );

  it.each(["teardown", "sample initialization"])(
    "keeps the live selection when replay fails after superseding %s",
    async (phase) => {
      const live = makePlayer();
      const superseded = makePlayer();
      let releasePending = () => {};
      const pendingGate = new Promise<void>((resolve) => {
        releasePending = resolve;
      });
      const initializeLive = jest.fn(() => live as unknown as Player);
      const initializeOther = jest.fn(async () => {
        await pendingGate;
        return superseded as unknown as Player;
      });
      const sources: IDataSourceFactory[] = [
        { id: "live", type: "connection", displayName: "Live", initialize: initializeLive },
        {
          id: "other",
          type: phase === "teardown" ? "connection" : "sample",
          displayName: "Other",
          initialize: initializeOther,
        },
        {
          id: "replay",
          type: "persistent-cache",
          displayName: "Replay",
          initialize: () => {
            throw new Error("replay initialization failed");
          },
        },
      ];
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
      let pendingOther: Promise<void> | undefined;
      try {
        await act(async () => {
          await selection!.selectSource("live", {
            type: "connection",
            params: { url: "live-url" },
          });
        });
        if (phase === "teardown") {
          live.close.mockImplementation(async () => {
            await pendingGate;
          });
        }
        await act(async () => {
          pendingOther = selection!.selectSource("other", {
            type: "connection",
            params: { url: "other-url" },
          });
        });
        let pendingReplay: Promise<void> | undefined;
        await act(async () => {
          pendingReplay = selection!.selectSource("replay", { type: "persistent-cache" });
          if (phase === "teardown") {
            releasePending();
          }
          await pendingReplay;
        });
        expect(live.reOpen).toHaveBeenCalledTimes(1);
        expect(selection?.selectedSource?.id).toBe("live");
        expect(mockSetDataSource).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: "live", type: "connection" }),
        );
        expect(mockSetPlayerProperty).toHaveBeenLastCalledWith("player", "live", {
          type: "connection",
          params: { url: "live-url" },
        });
        expect(mockEnqueueSnackbar).toHaveBeenLastCalledWith("replay initialization failed", {
          variant: "error",
        });
        await act(async () => {
          releasePending();
          await pendingOther;
        });
        expect(selection?.selectedSource?.id).toBe("live");
        expect(superseded.close).toHaveBeenCalledTimes(phase === "teardown" ? 0 : 1);
        await act(async () => {
          await selection!.reloadCurrentSource();
        });
        expect(initializeLive).toHaveBeenCalledTimes(2);
        expect(initializeLive).toHaveBeenLastCalledWith(
          expect.objectContaining({ params: { url: "live-url" } }),
        );
      } finally {
        releasePending();
        await pendingOther;
        view.unmount();
      }
    },
  );

  it.each(["resolve", "reject"])(
    "discards a pending replay after unmount when initialization will %s",
    async (outcome) => {
      const live = makePlayer();
      const replay = makePlayer();
      let resolvePlayer: (player: Player) => void = () => {};
      let rejectPlayer: (error: Error) => void = () => {};
      const playerGate = new Promise<Player>((resolve, reject) => {
        resolvePlayer = resolve;
        rejectPlayer = reject;
      });
      const initializeReplay = jest.fn(async () => await playerGate);
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
        expect(initializeReplay).toHaveBeenCalledTimes(1);
        view.unmount();
        mockSetDataSource.mockClear();
        await act(async () => {
          if (outcome === "resolve") {
            resolvePlayer(replay as unknown as Player);
          } else {
            rejectPlayer(new Error("replay initialization failed after unmount"));
          }
          await pending;
        });
        expect(replay.close).toHaveBeenCalledTimes(outcome === "resolve" ? 1 : 0);
        expect(replay.setGlobalVariables).not.toHaveBeenCalled();
        expect(mockSetDataSource).not.toHaveBeenCalled();
        expect(live.reOpen).not.toHaveBeenCalled();
        expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
      } finally {
        resolvePlayer(replay as unknown as Player);
        view.unmount();
      }
    },
  );

  it("uses a valid file handle when the file list is empty", async () => {
    const file = new File([], "example.mcap");
    const player = makePlayer();
    const initialize = jest.fn(() => player as unknown as Player);
    const getFile = jest.fn(async () => file);
    const handle = {
      name: file.name,
      queryPermission: jest.fn(async () => "granted"),
      getFile,
    } as unknown as FileSystemFileHandle;
    let selection: AsyncSelection | undefined;
    function CaptureSelection() {
      selection = useContext(PlayerSelectionContext) as AsyncSelection;
      return ReactNull;
    }
    const sources: IDataSourceFactory[] = [
      { id: "file", type: "file", displayName: "File", initialize },
    ];
    const view = render(
      <PlayerManager playerSources={sources}>
        <CaptureSelection />
      </PlayerManager>,
    );
    try {
      await act(async () => {
        await selection!.selectSource("file", { type: "file", files: [], handle });
      });
      expect(getFile).toHaveBeenCalledTimes(1);
      expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ file }));
      expect(selection?.selectedSource?.id).toBe("file");
      expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it.each<[string, string, DataSourceArgs | undefined]>([
    ["unknown source", "unknown", undefined],
    ["missing arguments", "replay", undefined],
    ["missing platform key", "coscene-data-platform", { type: "connection", params: {} }],
    ["missing file", "file", { type: "file" }],
    ["empty file list", "file", { type: "file", files: [] }],
    ["mismatched arguments", "replay", { type: "connection", params: {} }],
  ])(
    "does not cancel a pending replay for an invalid request: %s",
    async (_label, sourceId, args) => {
      const live = makePlayer();
      const replay = makePlayer();
      let resolveClose = () => {};
      const closeGate = new Promise<void>((resolve) => {
        resolveClose = resolve;
      });
      live.close.mockImplementation(async () => {
        await closeGate;
      });
      const initializeReplay = jest.fn(() => replay as unknown as Player);
      const sources: IDataSourceFactory[] = [
        {
          id: "coscene-data-platform",
          type: "connection",
          displayName: "Platform",
          initialize: jest.fn(),
        },
        { id: "file", type: "file", displayName: "File", initialize: jest.fn() },
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
      let pending: Promise<void> | undefined;
      let invalidRequest: Promise<void> | undefined;
      try {
        await act(async () => {
          await selection!.selectSource("live");
        });
        await act(async () => {
          pending = selection!.selectSource("replay", { type: "persistent-cache" });
        });
        expect(live.close).toHaveBeenCalledTimes(1);
        await act(async () => {
          invalidRequest = selection!.selectSource(sourceId, args);
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
        await act(async () => {
          resolveClose();
          await Promise.allSettled([pending, invalidRequest]);
        });
        view.unmount();
      }
    },
  );
});
