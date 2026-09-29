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
  matchRecommendedLayoutDeviceType,
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

function layoutId(robot: string, transport: string, url: string, config = "_default"): string {
  const base = `recommended:${[robot, transport, url].map(encodeURIComponent).join(":")}`;
  return config === "_default" ? base : `${base}:config=${encodeURIComponent(config)}`;
}

function makeManifest() {
  return parseRecommendedLayoutManifest({
    generated_at: "2026-08-07T00:00:00Z",
    robots: {
      "agibot-a2": {
        device_type_match: { "agibot-远征A2": "_default", "A2 gripper": "gripper" },
        resolution: {
          _default: {
            default: {
              inspect: {
                viewer: "layouts/viewer.json",
                annotator: "layouts/annotator.json",
              },
              secondary: { qa: "layouts/secondary-qa.json" },
            },
            h264: {
              inspect: { qa: "layouts/h264-qa.json", viewer: "layouts/h264-viewer.json" },
            },
          },
          gripper: {
            default: { inspect: { viewer: "layouts/gripper.json" } },
          },
        },
      },
    },
  });
}

const DEFAULT_MATCH = { robot: "agibot-a2", config: "_default" };

describe("RecommendedLayouts", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("matches device_type_match keys exactly without falling back to robot keys", () => {
    const manifest = makeManifest();

    expect(matchRecommendedLayoutDeviceType(manifest, "agibot-远征A2")).toEqual(DEFAULT_MATCH);
    for (const name of [
      "agibot-a2",
      "Agibot-远征A2",
      "agibot-远征A2 ",
      "unknown",
      "toString",
      "",
    ]) {
      expect(matchRecommendedLayoutDeviceType(manifest, name)).toBeUndefined();
    }
    expect(listRecommendedLayouts(manifest, DEFAULT_MATCH)).toHaveLength(5);
  });

  it("uses only the mapped configuration for listing and automatic selection", () => {
    const manifest = makeManifest();
    const match = matchRecommendedLayoutDeviceType(manifest, "A2 gripper")!;
    expect(match).toEqual({ robot: "agibot-a2", config: "gripper" });
    const layouts = listRecommendedLayouts(manifest, match);
    const gripperUrl = "https://honeybee-public-layouts.coscene.io/layouts/gripper.json";
    expect(layouts).toHaveLength(1);
    expect(layouts[0]).toMatchObject({
      id: layoutId("agibot-a2", "default", gripperUrl, "gripper"),
      resolution: "gripper",
      url: gripperUrl,
    });
    expect(resolveRecommendedLayout(manifest, match, "default")).toEqual(layouts[0]);
    expect(resolveRecommendedLayout(manifest, match, "h264")).toBeUndefined();

    const defaultLayouts = listRecommendedLayouts(manifest, DEFAULT_MATCH);
    expect(defaultLayouts.some((layout) => layout.url.endsWith("/layouts/gripper.json"))).toBe(
      false,
    );
    expect(defaultLayouts[0]?.id).toBe(
      layoutId(
        "agibot-a2",
        "default",
        "https://honeybee-public-layouts.coscene.io/layouts/viewer.json",
      ),
    );
    expect(defaultLayouts[0]?.id.includes(":config=")).toBe(false);
  });

  it("supports aliases and config-only robots without a _default group", () => {
    const manifest = parseRecommendedLayoutManifest({
      robots: {
        test: {
          device_type_match: { first: "hand", second: "hand", third: "hand:other" },
          resolution: {
            hand: { default: { inspect: { viewer: "shared.json" } } },
            "hand:other": { default: { inspect: { viewer: "shared.json" } } },
          },
        },
      },
    });
    const first = matchRecommendedLayoutDeviceType(manifest, "first")!;
    expect(matchRecommendedLayoutDeviceType(manifest, "second")).toEqual(first);
    const third = matchRecommendedLayoutDeviceType(manifest, "third")!;
    const firstLayout = listRecommendedLayouts(manifest, first)[0];
    const thirdLayout = listRecommendedLayouts(manifest, third)[0];
    const sharedUrl = "https://honeybee-public-layouts.coscene.io/shared.json";
    expect(firstLayout?.url).toBe(thirdLayout?.url);
    expect(firstLayout?.url).toBe(sharedUrl);
    expect(firstLayout?.id).toBe(layoutId("test", "default", sharedUrl, "hand"));
    expect(thirdLayout?.id).toBe(layoutId("test", "default", sharedUrl, "hand:other"));
    expect(firstLayout?.id).not.toBe(thirdLayout?.id);
  });

  it("rejects ambiguous device types even when a matching robot has no layouts", () => {
    const manifest = parseRecommendedLayoutManifest({
      robots: {
        first: { device_type_match: { duplicate: "_default" }, resolution: { _default: {} } },
        second: { device_type_match: { duplicate: "_default" }, resolution: { _default: {} } },
      },
    });
    expect(() => matchRecommendedLayoutDeviceType(manifest, "duplicate")).toThrow(
      "multiple robots",
    );
  });

  it.each<{ resolution: unknown }>([
    { resolution: undefined },
    { resolution: {} },
    { resolution: { missing: [] } },
    { resolution: { toString: {} } },
    { resolution: { _default: { default: { inspect: { viewer: "default.json" } } } } },
  ])("reports a missing mapped config instead of using _default: %j", ({ resolution }) => {
    const manifest = parseRecommendedLayoutManifest({
      robots: { test: { device_type_match: { device: "missing" }, resolution } },
    });
    expect(() => matchRecommendedLayoutDeviceType(manifest, "device")).toThrow(
      "configuration does not exist",
    );
  });

  it("does not resolve inherited config properties", () => {
    const manifest = parseRecommendedLayoutManifest({
      robots: { test: { device_type_match: { device: "toString" }, resolution: {} } },
    });
    expect(() => matchRecommendedLayoutDeviceType(manifest, "device")).toThrow(
      "configuration does not exist",
    );
  });

  it.each([undefined, 1, ""])("rejects invalid config mappings: %j", (config) => {
    expect(() =>
      parseRecommendedLayoutManifest({
        robots: { test: { device_type_match: { device: config } } },
      }),
    ).toThrow("configuration is invalid");
  });

  it("lists every role in the matched configuration and dedupes urls per transport", () => {
    const manifest = parseRecommendedLayoutManifest({
      generated_at: "2026-07-31T14:10:25+00:00",
      robots: {
        RobotA: {
          device_type_match: { "Robot A": "_default", "Robot A HD": "1080p" },
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

    expect(matchRecommendedLayoutDeviceType(manifest, "RobotA")).toBeUndefined();
    expect(matchRecommendedLayoutDeviceType(manifest, "toString")).toBeUndefined();
    expect(listRecommendedLayouts(manifest, { robot: "RobotA", config: "missing" })).toEqual([]);

    const layouts = listRecommendedLayouts(manifest, { robot: "RobotA", config: "_default" });
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
        role: "annotator",
        name: "review / annotator",
      },
      {
        transport: "default",
        resolution: "_default",
        workflow: "review",
        role: "qa",
        name: "review / qa",
      },
      {
        transport: "default",
        resolution: "_default",
        workflow: "review",
        role: "viewer",
        name: "review / viewer",
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
    expect(
      layouts.every(
        (layout) => layout.id.startsWith("recommended:") && !layout.id.includes(":config="),
      ),
    ).toBe(true);

    const hdLayouts = listRecommendedLayouts(
      manifest,
      matchRecommendedLayoutDeviceType(manifest, "Robot A HD")!,
    );
    expect(hdLayouts.map((layout) => layout.resolution)).toEqual([
      "1080p",
      "1080p",
      "1080p",
      "1080p",
    ]);
    expect(hdLayouts.every((layout) => layout.id.endsWith(":config=1080p"))).toBe(true);
    expect(hdLayouts.some((layout) => layout.url.endsWith("/layouts/review-720p.json"))).toBe(
      false,
    );
  });

  it("dedupes identical urls within one configuration and transport", () => {
    const manifest = parseRecommendedLayoutManifest({
      robots: {
        RobotA: {
          resolution: {
            _default: {
              default: {
                review: { viewer: "layouts/shared.json", annotator: "layouts/shared.json" },
              },
            },
          },
        },
      },
    });

    const layouts = listRecommendedLayouts(manifest, { robot: "RobotA", config: "_default" });
    expect(layouts).toHaveLength(1);
    expect(layouts[0]).toMatchObject({ role: "viewer", workflow: "review" });
  });

  it("uses only the first workflow viewer in the matched configuration", () => {
    const manifest = parseRecommendedLayoutManifest({
      robots: {
        firstWorkflowHasNoViewer: {
          resolution: {
            _default: {
              default: {
                first: { annotator: "layouts/annotator.json" },
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

    const defaultMatch = { robot: "firstWorkflowHasNoViewer", config: "_default" };
    expect(resolveRecommendedLayout(manifest, defaultMatch, "default")).toBe(undefined);
    expect(resolveRecommendedLayout(manifest, defaultMatch, "h264")).toMatchObject({
      resolution: "_default",
      workflow: "first",
      role: "viewer",
      transport: "h264",
    });
    expect(
      resolveRecommendedLayout(
        manifest,
        { robot: "noDefaultResolution", config: "1080p" },
        "default",
      ),
    ).toMatchObject({
      resolution: "1080p",
      workflow: "first",
      role: "viewer",
      transport: "default",
    });
    expect(
      resolveRecommendedLayout(manifest, { robot: "noDefaultResolution", config: "1080p" }, "h264"),
    ).toBe(undefined);
    expect(
      resolveRecommendedLayout(
        manifest,
        { robot: "noDefaultResolution", config: "_default" },
        "default",
      ),
    ).toBe(undefined);
    expect(
      resolveRecommendedLayout(manifest, { robot: "missing", config: "_default" }, "default"),
    ).toBe(undefined);
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
