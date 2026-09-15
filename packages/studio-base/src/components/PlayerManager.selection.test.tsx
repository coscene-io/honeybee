/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { act, render } from "@testing-library/react";
import { useContext } from "react";

import type { CoreDataStore } from "@foxglove/studio-base/context/CoreDataContext";
import PlayerSelectionContext, {
  DataSourceArgs,
  IDataSourceFactory,
  PlayerSelection,
} from "@foxglove/studio-base/context/PlayerSelectionContext";
import FoxgloveWebSocketDataSourceFactory from "@foxglove/studio-base/dataSources/FoxgloveWebSocketDataSourceFactory";
import { IndexedDbMessageStore } from "@foxglove/studio-base/persistence/IndexedDbMessageStore";
import type { Player } from "@foxglove/studio-base/players/types";

import PlayerManager from "./PlayerManager";

const mockSetDataSource = jest.fn((dataSource: CoreDataStore["dataSource"]) => {
  mockStore.dataSource = dataSource;
});
const mockSetPlayerProperty = jest.fn();
const mockStore = {
  record: {},
  project: {},
  jobRun: {},
  dataSource: undefined as CoreDataStore["dataSource"],
  setDataSource: mockSetDataSource,
};
const mockConsoleApi = { setType: jest.fn() };
const mockEmpty = {};
const mockRecents = { recents: [], addRecent: jest.fn(() => "recent-id") };
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
  __esModule: true,
  default: jest.requireActual<typeof import("@foxglove/studio-base/context/CurrentLayoutContext")>(
    "@foxglove/studio-base/context/CurrentLayoutContext",
  ).default,
  useCurrentLayoutSelector: () => mockEmpty,
}));
jest.mock("@foxglove/studio-base/context/UrdfStorageContext", () => ({
  useUrdfStorage: () => mockEmpty,
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
jest.mock("@foxglove/studio-base/components/CoreDataSyncAdapter", () => ({
  useSetShowtUrlKey: () => jest.fn(),
}));
jest.mock("@foxglove/studio-base/context/SubscriptionEntitlementContext", () => ({
  useEntitlementWithDialog: () => [undefined, jest.fn()],
}));
jest.mock("@foxglove/studio-base/context/UploadFilesContext", () => ({
  useUploadFiles: () => jest.fn(),
}));
jest.mock("@foxglove/studio-base/context/S3FileServiceContext", () => ({
  useS3FileService: () => mockEmpty,
}));

// Keep the real MessagePipelineProvider: replacement and unmount cleanup are part of this contract.
type AsyncSelection = Omit<PlayerSelection, "selectSource"> & {
  selectSource: (sourceId: string | undefined, args?: DataSourceArgs) => Promise<void>;
};

function makePlayer() {
  return {
    close: jest.fn(async () => {}),
    reOpen: jest.fn(),
    setGlobalVariables: jest.fn(),
    setUserScripts: jest.fn(),
    setAliasFunctions: jest.fn(),
    setListener: jest.fn(),
    setSubscriptions: jest.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderManager(sources: IDataSourceFactory[]) {
  const live = makePlayer();
  const initializeLive = jest.fn(() => live as unknown as Player);
  let selection: AsyncSelection;
  function CaptureSelection() {
    selection = useContext(PlayerSelectionContext) as AsyncSelection;
    return ReactNull;
  }
  const view = render(
    <PlayerManager
      playerSources={[
        { id: "live", type: "connection", displayName: "Live", initialize: initializeLive },
        ...sources,
      ]}
    >
      <CaptureSelection />
    </PlayerManager>,
  );
  return {
    ...view,
    live,
    initializeLive,
    selection: () => selection,
    openLive: async () => {
      await act(async () => {
        await selection.selectSource("live", { type: "connection", params: { url: "live-url" } });
      });
      return mockStore.dataSource!.sessionId!;
    },
  };
}

describe("PlayerManager source selection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.dataSource = undefined;
  });

  it("waits for the active player to close before initializing a sample", async () => {
    const sample = makePlayer();
    const initialize = jest.fn(() => sample as unknown as Player);
    const view = renderManager([
      { id: "sample", type: "sample", displayName: "Sample", initialize },
    ]);
    const gate = deferred<void>();
    let pending: Promise<void> | undefined;
    try {
      await view.openLive();
      view.live.close.mockImplementation(async () => {
        await gate.promise;
      });
      await act(async () => {
        pending = view.selection().selectSource("sample");
      });
      expect(initialize).not.toHaveBeenCalled();
      await act(async () => {
        gate.resolve();
        await pending;
      });
      expect(view.selection().selectedSource?.id).toBe("sample");
      expect(sample.setListener).toHaveBeenCalled();
    } finally {
      gate.resolve();
      await pending;
      view.unmount();
    }
  });

  it.each(["connection", "file", "sample"] as const)(
    "clears a failed %s replacement and can retry the selected source",
    async (type) => {
      const replacement = makePlayer();
      const initialize = jest.fn<ReturnType<IDataSourceFactory["initialize"]>, []>(
        () => replacement as unknown as Player,
      );
      initialize.mockRejectedValueOnce(new Error("replacement failed"));
      const args: DataSourceArgs | undefined =
        type === "sample"
          ? undefined
          : type === "file"
            ? { type: "file", files: [new File([], "test.mcap")] }
            : { type: "connection", params: { url: "replacement-url" } };
      const view = renderManager([
        { id: "replacement", type, displayName: "Replacement", initialize },
      ]);
      try {
        await view.openLive();
        await act(async () => {
          await view.selection().selectSource("replacement", args);
        });
        expect(view.selection().selectedSource?.id).toBe("replacement");
        expect(mockStore.dataSource).toBeUndefined();
        expect(mockSetPlayerProperty).toHaveBeenLastCalledWith("player", "replacement", args);
        expect(view.live.close).toHaveBeenCalled();
        expect(view.live.reOpen).not.toHaveBeenCalled();
        expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(1);
        await act(async () => {
          // Sample has no reload args; its normal selection action is the retry.
          if (type === "sample") {
            await view.selection().selectSource("replacement");
          } else {
            await view.selection().reloadCurrentSource();
          }
        });
        expect(replacement.setListener).toHaveBeenCalled();
        expect(mockStore.dataSource?.id).toBe("replacement");
      } finally {
        view.unmount();
      }
    },
  );

  it("does not revive an earlier request when the latest valid sample request fails", async () => {
    const earlier = makePlayer();
    const gate = deferred<Player>();
    const view = renderManager([
      {
        id: "earlier",
        type: "connection",
        displayName: "Earlier",
        initialize: async () => await gate.promise,
      },
      {
        id: "sample",
        type: "sample",
        displayName: "Sample",
        initialize: () => {
          throw new Error("sample failed");
        },
      },
    ]);
    let pending: Promise<void> | undefined;
    try {
      await view.openLive();
      await act(async () => {
        pending = view.selection().selectSource("earlier", { type: "connection" });
      });
      await act(async () => {
        await view.selection().selectSource("sample");
      });
      await act(async () => {
        gate.resolve(earlier as unknown as Player);
        await pending;
      });
      expect(view.selection().selectedSource?.id).toBe("sample");
      expect(mockStore.dataSource).toBeUndefined();
      expect(earlier.close).toHaveBeenCalled();
      expect(earlier.setListener).not.toHaveBeenCalled();
      expect(view.live.reOpen).not.toHaveBeenCalled();
      expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve(earlier as unknown as Player);
      await pending;
      view.unmount();
    }
  });

  it.each(["batched", "committed"] as const)(
    "closes an installed player on replacement when updates are %s",
    async (mode) => {
      const interim = makePlayer();
      const sample = makePlayer();
      const view = renderManager([
        {
          id: "interim",
          type: "connection",
          displayName: "Interim",
          initialize: () => interim as unknown as Player,
        },
        {
          id: "sample",
          type: "sample",
          displayName: "Sample",
          initialize: () => sample as unknown as Player,
        },
      ]);
      try {
        await view.openLive();
        if (mode === "committed") {
          await act(async () => {
            await view.selection().selectSource("interim", { type: "connection" });
          });
          expect(interim.setListener).toHaveBeenCalled();
        }
        await act(async () => {
          const selection = view.selection();
          if (mode === "batched") {
            await selection.selectSource("interim", { type: "connection" });
          }
          await selection.selectSource("sample");
        });
        if (mode === "batched") {
          expect(interim.setListener).not.toHaveBeenCalled();
        }
        expect(interim.close).toHaveBeenCalled();
        expect(sample.setListener).toHaveBeenCalled();
        expect(view.selection().selectedSource?.id).toBe("sample");
      } finally {
        view.unmount();
      }
    },
  );

  it.each([
    ["clear", "batched"],
    ["clear", "committed"],
    ["unmount", "batched"],
    ["unmount", "committed"],
  ] as const)("closes an installed player on %s with a %s update", async (action, mode) => {
    const player = makePlayer();
    const view = renderManager([
      {
        id: "source",
        type: "connection",
        displayName: "Source",
        initialize: () => player as unknown as Player,
      },
    ]);
    try {
      if (mode === "committed") {
        await act(async () => {
          await view.selection().selectSource("source", { type: "connection" });
        });
        expect(player.setListener).toHaveBeenCalled();
      }
      await act(async () => {
        const selection = view.selection();
        if (mode === "batched") {
          await selection.selectSource("source", { type: "connection" });
        }
        if (action === "clear") {
          await selection.selectSource(undefined);
        } else {
          view.unmount();
        }
      });
      if (mode === "batched") {
        expect(player.setListener).not.toHaveBeenCalled();
      }
      expect(player.close).toHaveBeenCalled();
      if (action === "clear") {
        expect(mockStore.dataSource).toBeUndefined();
        expect(view.selection().selectedSource).toBeUndefined();
      }
    } finally {
      view.unmount();
    }
  });

  it.each([
    ["clear", "resolve"],
    ["clear", "reject"],
    ["unmount", "resolve"],
    ["unmount", "reject"],
  ] as const)(
    "discards a pending initialization after %s when it will %s",
    async (action, outcome) => {
      const candidate = makePlayer();
      const gate = deferred<Player>();
      const view = renderManager([
        {
          id: "pending",
          type: "connection",
          displayName: "Pending",
          initialize: async () => await gate.promise,
        },
      ]);
      let pending: Promise<void> | undefined;
      try {
        await view.openLive();
        await act(async () => {
          pending = view.selection().selectSource("pending", { type: "connection" });
        });
        await act(async () => {
          if (action === "clear") {
            await view.selection().selectSource(undefined);
          } else {
            view.unmount();
          }
        });
        mockSetDataSource.mockClear();
        await act(async () => {
          if (outcome === "resolve") {
            gate.resolve(candidate as unknown as Player);
          } else {
            gate.reject(new Error("late failure"));
          }
          await pending;
        });
        expect(candidate.setListener).not.toHaveBeenCalled();
        if (outcome === "resolve") {
          expect(candidate.close).toHaveBeenCalled();
        }
        expect(mockSetDataSource).not.toHaveBeenCalled();
        expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
        expect(view.live.reOpen).not.toHaveBeenCalled();
      } finally {
        gate.resolve(candidate as unknown as Player);
        await pending;
        view.unmount();
      }
    },
  );

  it.each(["close", "initialize"] as const)(
    "restores the current live source when its replay fails during %s",
    async (stage) => {
      const initialize = jest.fn(() => {
        throw new Error("replay failed");
      });
      const view = renderManager([
        { id: "replay", type: "persistent-cache", displayName: "Replay", initialize },
      ]);
      try {
        const sessionId = await view.openLive();
        if (stage === "close") {
          view.live.close.mockRejectedValueOnce(new Error("flush failed"));
        }
        await act(async () => {
          await view.selection().selectSource("replay", { type: "persistent-cache" });
        });
        expect(initialize).toHaveBeenCalledTimes(stage === "close" ? 0 : 1);
        expect(view.live.reOpen).toHaveBeenCalled();
        expect(view.selection().selectedSource?.id).toBe("live");
        expect(mockStore.dataSource).toEqual(expect.objectContaining({ id: "live", sessionId }));
        expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(1);
        if (stage === "close") {
          expect(console.warn).toHaveBeenCalledWith(
            "Failed to close current player while switching sources:",
            expect.objectContaining({ message: "flush failed" }),
          );
          jest.mocked(console.warn).mockClear();
        }
        await act(async () => {
          await view.selection().reloadCurrentSource();
        });
        expect(view.initializeLive).toHaveBeenLastCalledWith(
          expect.objectContaining({ params: { url: "live-url" } }),
        );
      } finally {
        view.unmount();
      }
    },
  );

  it("restores the installed live descriptor when replay replaces a pending connection and fails", async () => {
    const candidate = makePlayer();
    const gate = deferred<Player>();
    const view = renderManager([
      {
        id: "pending",
        type: "connection",
        displayName: "Pending",
        initialize: async () => await gate.promise,
      },
      {
        id: "replay",
        type: "persistent-cache",
        displayName: "Replay",
        initialize: () => {
          throw new Error("replay failed");
        },
      },
    ]);
    let pending: Promise<void> | undefined;
    try {
      await view.openLive();
      const installedDataSource = mockStore.dataSource;
      jest.mocked(IndexedDbMessageStore).mockClear();
      await act(async () => {
        pending = view.selection().selectSource("pending", {
          type: "connection",
          params: { url: "pending-url" },
        });
      });
      expect(IndexedDbMessageStore).not.toHaveBeenCalled();
      await act(async () => {
        await view.selection().selectSource("replay", { type: "persistent-cache" });
      });
      expect(mockStore.dataSource).toEqual(installedDataSource);
      expect(view.selection().selectedSource?.id).toBe("live");
      expect(view.live.reOpen).toHaveBeenCalled();
      expect(IndexedDbMessageStore).not.toHaveBeenCalled();
      await act(async () => {
        gate.resolve(candidate as unknown as Player);
        await pending;
      });
      expect(candidate.close).toHaveBeenCalled();
      expect(candidate.setListener).not.toHaveBeenCalled();
      expect(mockStore.dataSource).toEqual(installedDataSource);
      expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve(candidate as unknown as Player);
      await pending;
      view.unmount();
    }
  });

  it("does not reopen the old live source after a failed replay is superseded", async () => {
    const gate = deferred<Player>();
    const replacement = makePlayer();
    const view = renderManager([
      {
        id: "replay",
        type: "persistent-cache",
        displayName: "Replay",
        initialize: async () => await gate.promise,
      },
      {
        id: "replacement",
        type: "sample",
        displayName: "Replacement",
        initialize: () => replacement as unknown as Player,
      },
    ]);
    let replaying: Promise<void> | undefined;
    try {
      await view.openLive();
      await act(async () => {
        replaying = view.selection().selectSource("replay", { type: "persistent-cache" });
      });
      await act(async () => {
        await view.selection().selectSource("replacement");
        gate.reject(new Error("late replay failure"));
        await replaying;
      });
      expect(view.live.reOpen).not.toHaveBeenCalled();
      expect(view.selection().selectedSource?.id).toBe("replacement");
      expect(mockEnqueueSnackbar).not.toHaveBeenCalled();
    } finally {
      gate.resolve(replacement as unknown as Player);
      await replaying;
      view.unmount();
    }
  });

  it("uses the newly installed connection session for replay in the same React batch", async () => {
    const connection = makePlayer();
    const replay = makePlayer();
    const initializeConnection = jest.fn(() => connection as unknown as Player);
    const initializeReplay = jest.fn(() => replay as unknown as Player);
    const view = renderManager([
      { id: "next", type: "connection", displayName: "Next", initialize: initializeConnection },
      {
        id: "replay",
        type: "persistent-cache",
        displayName: "Replay",
        initialize: initializeReplay,
      },
    ]);
    try {
      const oldSessionId = await view.openLive();
      const selection = view.selection();
      await act(async () => {
        await selection.selectSource("next", { type: "connection" });
        await selection.selectSource("replay", { type: "persistent-cache" });
      });
      const nextSessionId = mockStore.dataSource?.sessionId;
      expect(nextSessionId).toBeDefined();
      expect(nextSessionId).not.toBe(oldSessionId);
      expect(initializeConnection).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: nextSessionId }),
      );
      expect(initializeReplay).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: nextSessionId }),
      );
      expect(connection.setListener).not.toHaveBeenCalled();
      expect(connection.close).toHaveBeenCalled();
      expect(replay.setListener).toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it.each(["standalone", "explicit", "empty"] as const)(
    "resolves a %s replay session",
    async (mode) => {
      const replay = makePlayer();
      const initialize = jest.fn(() => replay as unknown as Player);
      const view = renderManager([
        { id: "replay", type: "persistent-cache", displayName: "Replay", initialize },
      ]);
      try {
        const liveSessionId = mode === "standalone" ? undefined : await view.openLive();
        await act(async () => {
          await view.selection().selectSource("replay", {
            type: "persistent-cache",
            params: { sessionId: mode === "empty" ? "" : "explicit-session" },
          });
        });
        expect(initialize).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: mode === "empty" ? liveSessionId : "explicit-session",
          }),
        );
        expect(replay.setListener).toHaveBeenCalled();
      } finally {
        view.unmount();
      }
    },
  );

  it.each<[string, string, DataSourceArgs | undefined]>([
    ["unknown source", "unknown", undefined],
    ["missing arguments", "replay", undefined],
    ["missing file", "file", { type: "file" }],
    ["empty file list", "file", { type: "file", files: [] }],
    ["mismatched arguments", "replay", { type: "connection", params: {} }],
    ["missing websocket URL", "coscene-websocket", { type: "connection", params: {} }],
    ["empty websocket URL", "coscene-websocket", { type: "connection", params: { url: " " } }],
    ["missing platform key", "coscene-data-platform", { type: "connection" }],
  ])("does not cancel a valid pending replay for %s", async (_label, sourceId, args) => {
    const replay = makePlayer();
    const gate = deferred<void>();
    const initialize = jest.fn(() => replay as unknown as Player);
    const view = renderManager([
      new FoxgloveWebSocketDataSourceFactory(),
      { id: "file", type: "file", displayName: "File", initialize: jest.fn() },
      { id: "replay", type: "persistent-cache", displayName: "Replay", initialize },
      {
        id: "coscene-data-platform",
        type: "connection",
        displayName: "Platform",
        initialize: jest.fn(),
      },
    ]);
    let pending: Promise<void> | undefined;
    try {
      const sessionId = await view.openLive();
      view.live.close.mockImplementation(async () => {
        await gate.promise;
      });
      await act(async () => {
        pending = view.selection().selectSource("replay", { type: "persistent-cache" });
      });
      await act(async () => {
        await view.selection().selectSource(sourceId, args);
      });
      expect(mockEnqueueSnackbar).toHaveBeenCalledTimes(1);
      expect(initialize).not.toHaveBeenCalled();
      await act(async () => {
        gate.resolve();
        await pending;
      });
      expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ sessionId }));
      expect(replay.setListener).toHaveBeenCalled();
    } finally {
      gate.resolve();
      await pending;
      view.unmount();
    }
  });

  it("uses a valid file handle when the file list is empty", async () => {
    const file = new File([], "example.mcap");
    const handle = {
      queryPermission: jest.fn(async () => "granted"),
      getFile: jest.fn(async () => file),
    } as unknown as FileSystemFileHandle;
    const player = makePlayer();
    const initialize = jest.fn(() => player as unknown as Player);
    const view = renderManager([{ id: "file", type: "file", displayName: "File", initialize }]);
    try {
      await act(async () => {
        await view.selection().selectSource("file", { type: "file", files: [], handle });
      });
      expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ file }));
      expect(player.setListener).toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });
});
