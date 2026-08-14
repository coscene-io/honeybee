/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { renderHook, waitFor } from "@testing-library/react";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { useRecommendedLayouts } from "@foxglove/studio-base/context/RecommendedLayoutContext";
import { useFeatureIsOnWithConfig } from "@foxglove/studio-base/providers/GrowthBookProvider";
import RecommendedLayoutProvider, {
  GrowthBookRecommendedLayoutProvider,
} from "@foxglove/studio-base/providers/RecommendedLayoutProvider";
import {
  hasCompressedVideoTopic,
  listRecommendedLayouts,
  loadRecommendedLayoutData,
  loadRecommendedLayoutManifest,
  resolveRecommendedLayout,
  type RecommendedLayoutDescriptor,
  type RecommendedLayoutManifest,
} from "@foxglove/studio-base/services/RecommendedLayouts";
import type ConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";

jest.mock("@foxglove/studio-base/context/CoSceneConsoleApiContext", () => ({
  useConsoleApi: jest.fn(),
}));
jest.mock("@foxglove/studio-base/context/CoreDataContext", () => ({
  useCoreData: jest.fn(),
}));
jest.mock("@foxglove/studio-base/providers/GrowthBookProvider", () => ({
  useFeatureIsOnWithConfig: jest.fn(),
}));
jest.mock("@foxglove/studio-base/services/RecommendedLayouts", () => ({
  hasCompressedVideoTopic: jest.fn(),
  listRecommendedLayouts: jest.fn(),
  loadRecommendedLayoutData: jest.fn(),
  loadRecommendedLayoutManifest: jest.fn(),
  resolveRecommendedLayout: jest.fn(),
}));

function descriptor(robot: string, transport: "default" | "h264"): RecommendedLayoutDescriptor {
  return {
    id: `recommended:${robot}:${transport}` as RecommendedLayoutDescriptor["id"],
    robot,
    resolution: "_default",
    transport,
    workflow: "review",
    role: "viewer",
    name: "review / viewer",
    url: `https://honeybee-public-layouts.coscene.io/${robot}/${transport}.json`,
  };
}

function recordState(deviceType: string): CoreDataStore["record"] {
  return {
    loading: false,
    value: {
      customMetadata: {
        attributes: {
          deviceType: { kind: { case: "stringValue", value: deviceType } },
        },
      },
    },
  } as unknown as CoreDataStore["record"];
}

describe("RecommendedLayoutProvider", () => {
  let coreData: Pick<CoreDataStore, "dataSource" | "externalInitConfig" | "record" | "showtUrlKey">;
  let topics: jest.Mock;
  let manifest: RecommendedLayoutManifest;
  const robotALayouts = [descriptor("RobotA", "default"), descriptor("RobotA", "h264")];

  beforeEach(() => {
    jest.clearAllMocks();
    coreData = {
      dataSource: { id: "coscene-data-platform", type: "connection" },
      externalInitConfig: { recordId: "record-a" },
      record: recordState("RobotA"),
      showtUrlKey: "records/record-a",
    };
    topics = jest.fn().mockResolvedValue({ metaData: [] });
    manifest = { robots: { RobotA: { resolution: {} }, RobotB: { resolution: {} } } };

    jest.mocked(useCoreData).mockImplementation((selector) => selector(coreData as CoreDataStore));
    jest.mocked(useConsoleApi).mockReturnValue({ topics } as unknown as ConsoleApi);
    jest.mocked(loadRecommendedLayoutManifest).mockResolvedValue(manifest);
    jest
      .mocked(listRecommendedLayouts)
      .mockImplementation((_manifest, robot) =>
        robot === "RobotA" ? robotALayouts : [descriptor(robot, "default")],
      );
    jest.mocked(hasCompressedVideoTopic).mockReturnValue(false);
    jest.mocked(useFeatureIsOnWithConfig).mockReturnValue(false);
    jest
      .mocked(resolveRecommendedLayout)
      .mockImplementation((_manifest, robot, transport) => descriptor(robot, transport));
  });

  it("uses the GrowthBook flag to disable and re-enable recommendations", async () => {
    let enabled = false;
    jest.mocked(useFeatureIsOnWithConfig).mockImplementation(() => enabled);

    function Wrapper({ children }: React.PropsWithChildren): React.JSX.Element {
      return <GrowthBookRecommendedLayoutProvider>{children}</GrowthBookRecommendedLayoutProvider>;
    }

    const { result, rerender } = renderHook(() => useRecommendedLayouts(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current).toMatchObject({ status: "ready", layouts: [] });
    });
    expect(loadRecommendedLayoutManifest).not.toHaveBeenCalled();
    expect(topics).not.toHaveBeenCalled();
    expect(useFeatureIsOnWithConfig).toHaveBeenCalledWith("honeybee_recommended_layouts", {
      fallback: false,
    });

    enabled = true;
    rerender();
    await waitFor(() => {
      expect(result.current).toMatchObject({ status: "ready", robot: "RobotA" });
    });

    enabled = false;
    rerender();
    await waitFor(() => {
      expect(result.current).toMatchObject({ status: "ready", layouts: [] });
    });
  });

  it("preserves the explicit enabled override", async () => {
    function Wrapper({ children }: React.PropsWithChildren): React.JSX.Element {
      return (
        <GrowthBookRecommendedLayoutProvider enabled>
          {children}
        </GrowthBookRecommendedLayoutProvider>
      );
    }

    const { result } = renderHook(() => useRecommendedLayouts(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current).toMatchObject({ status: "ready", robot: "RobotA" });
    });
    expect(loadRecommendedLayoutManifest).toHaveBeenCalledTimes(1);
  });

  it("preserves the explicit disabled override", async () => {
    jest.mocked(useFeatureIsOnWithConfig).mockReturnValue(true);

    function Wrapper({ children }: React.PropsWithChildren): React.JSX.Element {
      return (
        <GrowthBookRecommendedLayoutProvider enabled={false}>
          {children}
        </GrowthBookRecommendedLayoutProvider>
      );
    }

    const { result } = renderHook(() => useRecommendedLayouts(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current).toMatchObject({ status: "ready", layouts: [] });
    });
    expect(loadRecommendedLayoutManifest).not.toHaveBeenCalled();
  });

  it("waits for the Record and showtUrlKey before loading recommendations", async () => {
    coreData = {
      dataSource: { id: "coscene-data-platform", type: "connection" },
      externalInitConfig: { recordId: "record-a" },
      record: { loading: true },
    };
    const { result, rerender } = renderHook(() => useRecommendedLayouts(), {
      wrapper: RecommendedLayoutProvider,
    });

    expect(result.current.status).toBe("loading");
    expect(loadRecommendedLayoutManifest).not.toHaveBeenCalled();

    coreData = {
      dataSource: { id: "coscene-data-platform", type: "connection" },
      externalInitConfig: { recordId: "record-a" },
      record: recordState("RobotA"),
      showtUrlKey: "records/record-a",
    };
    rerender();

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(loadRecommendedLayoutManifest).toHaveBeenCalledTimes(1);
    expect(topics).toHaveBeenCalledWith("records/record-a");
  });

  it("waits for the Record playback source to finish initializing", async () => {
    coreData = {
      externalInitConfig: { recordId: "record-a" },
      record: recordState("RobotA"),
      showtUrlKey: "records/record-a",
    };
    const { result, rerender } = renderHook(() => useRecommendedLayouts(), {
      wrapper: RecommendedLayoutProvider,
    });

    expect(result.current.status).toBe("loading");
    expect(loadRecommendedLayoutManifest).not.toHaveBeenCalled();

    coreData = {
      ...coreData,
      dataSource: { id: "coscene-data-platform", type: "connection" },
    };
    rerender();

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(loadRecommendedLayoutManifest).toHaveBeenCalledTimes(1);
  });

  it("finishes without recommendations for a cached Record context without playback", async () => {
    coreData = {
      externalInitConfig: { recordId: "record-a" },
      record: recordState("RobotA"),
    };
    const { result } = renderHook(() => useRecommendedLayouts(), {
      wrapper: RecommendedLayoutProvider,
    });

    await waitFor(() => {
      expect(result.current).toMatchObject({ status: "ready", layouts: [] });
    });
    expect(loadRecommendedLayoutManifest).not.toHaveBeenCalled();
  });

  it("unblocks layout startup when loading a cached Record fails", async () => {
    coreData = {
      externalInitConfig: { recordId: "record-a" },
      record: { loading: true },
    };
    const { result, rerender } = renderHook(() => useRecommendedLayouts(), {
      wrapper: RecommendedLayoutProvider,
    });

    expect(result.current.status).toBe("loading");

    coreData = {
      ...coreData,
      record: { loading: false, error: new Error("Record unavailable") },
    };
    rerender();

    await waitFor(() => {
      expect(result.current).toMatchObject({ status: "ready", layouts: [] });
    });
    expect(loadRecommendedLayoutManifest).not.toHaveBeenCalled();
  });

  it("disables recommendations without a Record playback context", async () => {
    coreData = { record: { loading: true } };
    const { result } = renderHook(() => useRecommendedLayouts(), {
      wrapper: RecommendedLayoutProvider,
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.layouts).toEqual([]);
    expect(loadRecommendedLayoutManifest).not.toHaveBeenCalled();
    expect(topics).not.toHaveBeenCalled();
  });

  it("uses the exact deviceType and metadata transport", async () => {
    jest.mocked(hasCompressedVideoTopic).mockReturnValue(true);
    const { result } = renderHook(() => useRecommendedLayouts(), {
      wrapper: RecommendedLayoutProvider,
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(listRecommendedLayouts).toHaveBeenCalledWith(manifest, "RobotA");
    expect(hasCompressedVideoTopic).toHaveBeenCalledWith([]);
    expect(resolveRecommendedLayout).toHaveBeenCalledWith(manifest, "RobotA", "h264");
    expect(result.current).toMatchObject({
      status: "ready",
      robot: "RobotA",
      layouts: robotALayouts,
      automaticLayout: descriptor("RobotA", "h264"),
    });
  });

  it("hides recommendations without an exact robot match and skips metadata", async () => {
    coreData = {
      dataSource: { id: "coscene-data-platform", type: "connection" },
      externalInitConfig: { recordId: "record-a" },
      record: recordState("robota"),
      showtUrlKey: "records/record-a",
    };
    const { result } = renderHook(() => useRecommendedLayouts(), {
      wrapper: RecommendedLayoutProvider,
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    expect(result.current.layouts).toEqual([]);
    expect(listRecommendedLayouts).not.toHaveBeenCalled();
    expect(topics).not.toHaveBeenCalled();
  });

  it("retries metadata once, then hides the entire recommendation capability", async () => {
    topics.mockRejectedValue(new Error("metadata unavailable"));
    const { result } = renderHook(() => useRecommendedLayouts(), {
      wrapper: RecommendedLayoutProvider,
    });

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(topics).toHaveBeenCalledTimes(2);
    expect(result.current.layouts).toEqual([]);
  });

  it("hides stale recommendations after leaving Record playback", async () => {
    const { result, rerender } = renderHook(() => useRecommendedLayouts(), {
      wrapper: RecommendedLayoutProvider,
    });

    await waitFor(() => {
      expect(result.current).toMatchObject({ status: "ready", robot: "RobotA" });
    });

    coreData = {
      ...coreData,
      dataSource: { id: "foxglove-file", type: "file" },
    };
    rerender();

    await waitFor(() => {
      expect(result.current).toEqual({
        status: "ready",
        layouts: [],
        loadLayout: expect.any(Function),
      });
    });
  });

  it("hides stale recommendations after clearing Record playback", async () => {
    const { result, rerender } = renderHook(() => useRecommendedLayouts(), {
      wrapper: RecommendedLayoutProvider,
    });

    await waitFor(() => {
      expect(result.current).toMatchObject({ status: "ready", robot: "RobotA" });
    });

    coreData = { ...coreData, dataSource: undefined };
    rerender();

    await waitFor(() => {
      expect(result.current).toMatchObject({ status: "ready", layouts: [] });
    });
  });

  it("ignores stale results after switching Records", async () => {
    let resolveRecordA: ((value: { metaData: [] }) => void) | undefined;
    topics.mockImplementation(async (key: string) => {
      if (key === "records/record-a") {
        return await new Promise((resolve) => {
          resolveRecordA = resolve;
        });
      }
      return { metaData: [] };
    });
    const { result, rerender } = renderHook(() => useRecommendedLayouts(), {
      wrapper: RecommendedLayoutProvider,
    });

    await waitFor(() => {
      expect(topics).toHaveBeenCalledWith("records/record-a");
    });
    coreData = {
      dataSource: { id: "coscene-data-platform", type: "connection" },
      externalInitConfig: { recordId: "record-b" },
      record: recordState("RobotB"),
      showtUrlKey: "records/record-b",
    };
    rerender();

    await waitFor(() => {
      expect(result.current).toMatchObject({ status: "ready", robot: "RobotB" });
    });
    resolveRecordA?.({ metaData: [] });
    await Promise.resolve();
    expect(result.current).toMatchObject({ status: "ready", robot: "RobotB" });
  });

  it("delegates layout loading to the validated layout service", async () => {
    const layoutData = { configById: {}, globalVariables: {}, userNodes: {} };
    jest.mocked(loadRecommendedLayoutData).mockResolvedValue(layoutData);
    const { result } = renderHook(() => useRecommendedLayouts(), {
      wrapper: RecommendedLayoutProvider,
    });

    await waitFor(() => {
      expect(result.current.status).toBe("ready");
    });
    await expect(result.current.loadLayout(robotALayouts[0]!)).resolves.toBe(layoutData);
    expect(loadRecommendedLayoutData).toHaveBeenCalledWith(robotALayouts[0]);
  });
});
