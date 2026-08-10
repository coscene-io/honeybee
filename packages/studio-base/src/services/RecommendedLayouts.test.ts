// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import {
  hasCompressedVideoTopic,
  listRecommendedLayouts,
  loadRecommendedLayoutData,
  loadRecommendedLayoutManifest,
  parseRecommendedLayoutManifest,
  resolveRecommendedLayout,
  type RecommendedLayoutDescriptor,
} from "@foxglove/studio-base/services/RecommendedLayouts";

function descriptor(url: string): RecommendedLayoutDescriptor {
  return {
    id: `recommended:${url}` as RecommendedLayoutDescriptor["id"],
    robot: "RobotA",
    resolution: "_default",
    transport: "default",
    workflow: "review",
    role: "viewer",
    name: "review / viewer",
    url,
  };
}

function layoutResponse(version = 1): Response {
  return new Response(
    JSON.stringify({
      configById: {},
      globalVariables: {},
      userNodes: {},
      version,
    }),
    { status: 200 },
  );
}

describe("RecommendedLayouts", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("matches robot keys exactly and lists only viewer layouts across every resolution", () => {
    const manifest = parseRecommendedLayoutManifest({
      generated_at: "2026-07-31T14:10:25+00:00",
      robots: {
        RobotA: {
          resolution: {
            _default: {
              default: {
                review: {
                  annotator: "layouts/annotator.json",
                  qa: "layouts/qa.json",
                  viewer: "layouts/shared.json",
                },
              },
              h264: {
                review: { viewer: "layouts/shared.json" },
              },
            },
            "1080p": {
              default: {
                review: { viewer: "./layouts/shared.json" },
                inspect: { engineer: "layouts/engineer.json", viewer: "layouts/inspect.json" },
              },
              h264: {
                inspect: { viewer: "layouts/shared.json" },
              },
            },
            "720p": {
              default: {
                review: { viewer: "layouts/review-720p.json" },
              },
            },
          },
        },
      },
    });

    expect(listRecommendedLayouts(manifest, "robota")).toEqual([]);
    expect(listRecommendedLayouts(manifest, "toString")).toEqual([]);

    const layouts = listRecommendedLayouts(manifest, "RobotA");
    expect(
      layouts.map(({ transport, resolution, workflow, role, name }) => ({
        transport,
        resolution,
        workflow,
        role,
        name,
      })),
    ).toEqual([
      {
        transport: "default",
        resolution: "_default",
        workflow: "review",
        role: "viewer",
        name: "review / viewer / _default",
      },
      {
        transport: "default",
        resolution: "1080p",
        workflow: "inspect",
        role: "viewer",
        name: "inspect / viewer",
      },
      {
        transport: "default",
        resolution: "720p",
        workflow: "review",
        role: "viewer",
        name: "review / viewer / 720p",
      },
      {
        transport: "h264",
        resolution: "_default",
        workflow: "review",
        role: "viewer",
        name: "review / viewer",
      },
    ]);

    expect(layouts.filter((layout) => layout.url.endsWith("/layouts/shared.json"))).toHaveLength(2);
    expect(layouts.every((layout) => layout.id.startsWith("recommended:"))).toBe(true);
  });

  it("uses only the first _default workflow and never falls back", () => {
    const manifest = parseRecommendedLayoutManifest({
      robots: {
        firstWorkflowHasNoViewer: {
          resolution: {
            _default: {
              default: {
                first: "invalid workflow roles",
                second: { viewer: "layouts/viewer.json" },
              },
              h264: {
                first: { viewer: "layouts/viewer-h264.json" },
              },
            },
            "1080p": {
              default: { first: { viewer: "layouts/1080p.json" } },
            },
          },
        },
        noDefaultResolution: {
          resolution: {
            "1080p": {
              default: { first: { viewer: "layouts/1080p.json" } },
            },
          },
        },
      },
    });

    expect(resolveRecommendedLayout(manifest, "firstWorkflowHasNoViewer", "default")).toBe(
      undefined,
    );
    expect(resolveRecommendedLayout(manifest, "firstWorkflowHasNoViewer", "h264")).toMatchObject({
      resolution: "_default",
      workflow: "first",
      role: "viewer",
      transport: "h264",
    });
    expect(resolveRecommendedLayout(manifest, "noDefaultResolution", "default")).toBe(undefined);
    expect(resolveRecommendedLayout(manifest, "missing", "default")).toBe(undefined);
  });

  it.each([
    "foxglove.CompressedVideo",
    "foxglove_msgs/CompressedVideo",
    "foxglove_msgs/msg/CompressedVideo",
    "foxglove::CompressedVideo",
  ])("recognizes the standard CompressedVideo schema variant %s", (schemaName) => {
    expect(hasCompressedVideoTopic([{ schemaName }])).toBe(true);
  });

  it("does not use fuzzy CompressedVideo matching", () => {
    expect(
      hasCompressedVideoTopic([
        { schemaName: "sensor_msgs/msg/CompressedImage" },
        { schemaName: "vendor.CompressedVideo" },
        { schemaName: "foxglove.compressedvideo" },
      ]),
    ).toBe(false);
  });

  it("caches successful layout requests and retries a failed request", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(undefined, { status: 503 }))
      .mockResolvedValueOnce(layoutResponse())
      .mockResolvedValueOnce(layoutResponse());
    const retryLayout = descriptor(
      "https://honeybee-public-layouts.coscene.io/tests/retry-layout.json",
    );
    const cachedLayout = descriptor(
      "https://honeybee-public-layouts.coscene.io/tests/cached-layout.json",
    );

    await expect(loadRecommendedLayoutData(retryLayout)).rejects.toThrow(
      "Recommended layout request failed (503)",
    );
    await expect(loadRecommendedLayoutData(retryLayout)).resolves.toMatchObject({ version: 1 });
    const firstCachedResult = await loadRecommendedLayoutData(cachedLayout);
    const secondCachedResult = await loadRecommendedLayoutData(cachedLayout);

    expect(secondCachedResult).toBe(firstCachedResult);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("caches a successful manifest and permits retry after failure", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(undefined, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            robots: {
              RobotA: {
                resolution: {
                  _default: {
                    default: { review: { viewer: "RobotA/viewer.json" } },
                  },
                },
              },
            },
          }),
          { status: 200 },
        ),
      );

    await expect(loadRecommendedLayoutManifest()).rejects.toThrow(
      "Recommended layout request failed (503)",
    );
    const manifest = await loadRecommendedLayoutManifest();
    await expect(loadRecommendedLayoutManifest()).resolves.toBe(manifest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects cross-origin, oversized, and unsupported layout content", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    await expect(
      loadRecommendedLayoutData(descriptor("https://example.com/untrusted.json")),
    ).rejects.toThrow("Recommended layout URL must use the manifest origin");
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(1024 * 1024 + 1) },
      }),
    );
    await expect(
      loadRecommendedLayoutData(
        descriptor("https://honeybee-public-layouts.coscene.io/tests/oversized.json"),
      ),
    ).rejects.toThrow("Recommended layout response is too large");

    fetchMock.mockResolvedValueOnce(layoutResponse(2));
    await expect(
      loadRecommendedLayoutData(
        descriptor("https://honeybee-public-layouts.coscene.io/tests/future-version.json"),
      ),
    ).rejects.toThrow("Recommended layout version is not supported");
  });

  it("aborts layout requests after five seconds", async () => {
    jest.useFakeTimers();
    jest.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const request = loadRecommendedLayoutData(
      descriptor("https://honeybee-public-layouts.coscene.io/tests/timeout.json"),
    );
    jest.advanceTimersByTime(5_000);
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
