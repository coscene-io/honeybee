// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { createHash } from "crypto";
import { createReadStream } from "fs";
import { readdir, stat } from "fs/promises";
import http, { IncomingMessage, ServerResponse } from "http";
import path from "path";
import { performance as nodePerformance } from "perf_hooks";
import { Browser, chromium, Locator, Page } from "playwright";
import serveHandler from "serve-handler";

const BENCHMARK_DIRECTORY = process.env.REMOTE_MP4_BENCHMARK_DIR;
const BENCHMARK_FILE_NAMES = process.env.REMOTE_MP4_BENCHMARK_FILES;
const BENCHMARK_LIMIT = process.env.REMOTE_MP4_BENCHMARK_LIMIT;
const BROWSER_CHANNEL = process.env.REMOTE_MP4_BENCHMARK_BROWSER_CHANNEL;
const BENCHMARK_LABEL = process.env.REMOTE_MP4_BENCHMARK_LABEL ?? "working-tree";
const PLAYBACK_SAMPLE_DURATION_MS = parsePlaybackDuration(
  process.env.REMOTE_MP4_BENCHMARK_PLAYBACK_MS,
);
const HEADLESS = process.env.REMOTE_MP4_BENCHMARK_HEADLESS !== "0";

const FRAME_SCREENSHOT_MINIMUM_BYTES = 20_000;
const FRAME_POLL_INTERVAL_MS = 50;
const FRAME_TIMEOUT_MS = 20_000;
const SEEK_FRAME_TIMEOUT_MS = 5_000;
const SEEK_RATIOS = [0.1, 0.9, 0.25, 0.75, 0.5];
const RAPID_SEEK_RATIOS = [0.05, 0.8, 0.2, 0.95, 0.4, 0.7];
const appPath = process.env.REMOTE_MP4_BENCHMARK_APP_DIR ?? path.join(__dirname, "..", ".webpack");

type MediaRequestMetric = {
  fileId: string;
  kind: "probe" | "range";
  start: number;
  end: number;
  requestedBytes: number;
  transferredBytes: number;
  startedAtMs: number;
  completedAtMs?: number;
};

type FrameSnapshot = {
  hash: string;
  pngBytes: number;
};

type SeekMetric = {
  ratio: number;
  latencyMs?: number;
  error?: string;
};

type TransportMetric = {
  probeRequests: number;
  transferredProbeBytes: number;
  rangeRequests: number;
  requestedRangeBytes: number;
  transferredRangeBytes: number;
  uniqueRangeCoverageBytes: number;
  maximumRangeBytes: number;
};

type BenchmarkResult = {
  file: string;
  fileSizeBytes: number;
  browserChannel: string;
  headless: boolean;
  label: string;
  playbackControlsReadyMs?: number;
  sourceInitializeMs?: number;
  firstFrameFromNavigationMs?: number;
  firstFrameAfterPanelReadyMs?: number;
  firstFramePngBytes?: number;
  seeks: SeekMetric[];
  rapidSeekSettleMs?: number;
  playback?: {
    durationMs: number;
    observedFrameChanges: number;
    sampleCount: number;
    longTaskCount: number;
    longTaskTotalMs: number;
    longestTaskMs: number;
  };
  mainThreadHeapBeforeBytes?: number;
  mainThreadHeapAfterBytes?: number;
  sourceInitializeTransport?: TransportMetric;
  firstFrameTransport?: TransportMetric;
  transport: TransportMetric;
  errors: string[];
};

type BenchmarkPageState = {
  longTasks: { startTime: number; duration: number }[];
};

function parsePlaybackDuration(value: string | undefined): number {
  const duration = Number(value ?? 5_000);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Invalid REMOTE_MP4_BENCHMARK_PLAYBACK_MS: ${value}`);
  }
  return duration;
}

function parseLimit(value: string | undefined): number | undefined {
  if (value == undefined || value.length === 0) {
    return undefined;
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error(`Invalid REMOTE_MP4_BENCHMARK_LIMIT: ${value}`);
  }
  return limit;
}

async function benchmarkFiles(directory: string): Promise<string[]> {
  const requestedNames = BENCHMARK_FILE_NAMES?.split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const entries = await readdir(directory, { withFileTypes: true });
  const availableNames = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".mp4")
    .map((entry) => entry.name)
    .sort();

  const names = requestedNames ?? availableNames;
  for (const name of names) {
    if (!availableNames.includes(name)) {
      throw new Error(`MP4 benchmark file does not exist: ${path.join(directory, name)}`);
    }
  }
  return names.slice(0, parseLimit(BENCHMARK_LIMIT));
}

function sendCommonMediaHeaders(response: ServerResponse): void {
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader(
    "Access-Control-Expose-Headers",
    "Accept-Ranges, Content-Length, Content-Range",
  );
  response.setHeader("Content-Type", "video/mp4");
}

function pipeMediaRange(
  mediaPath: string,
  metric: MediaRequestMetric,
  response: ServerResponse,
): void {
  const stream = createReadStream(mediaPath, { start: metric.start, end: metric.end });
  stream.on("data", (chunk) => {
    metric.transferredBytes +=
      typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
  });
  stream.on("error", (error) => {
    response.destroy(error);
  });
  response.on("close", () => {
    metric.completedAtMs = nodePerformance.now();
    stream.destroy();
  });
  stream.pipe(response);
}

async function serveMedia(
  request: IncomingMessage,
  response: ServerResponse,
  fileId: string,
  mediaPath: string,
  metrics: MediaRequestMetric[],
): Promise<void> {
  const { size } = await stat(mediaPath);
  sendCommonMediaHeaders(response);

  const rangeHeader = request.headers.range;
  if (rangeHeader == undefined) {
    const metric: MediaRequestMetric = {
      fileId,
      kind: "probe",
      start: 0,
      end: size - 1,
      requestedBytes: size,
      transferredBytes: 0,
      startedAtMs: nodePerformance.now(),
    };
    metrics.push(metric);
    response.writeHead(200, { "Content-Length": size });
    response.flushHeaders();

    // BrowserHttpReader aborts its metadata probe as soon as the headers arrive. A short delay
    // prevents loopback throughput from sending the whole file before that abort is observed.
    const startBodyTimer = setTimeout(() => {
      pipeMediaRange(mediaPath, metric, response);
    }, 100);
    response.on("close", () => {
      clearTimeout(startBodyTimer);
      metric.completedAtMs = nodePerformance.now();
    });
    return;
  }

  const match = /^bytes=(\d+)-(\d+)?$/.exec(rangeHeader);
  if (!match) {
    response.writeHead(416, { "Content-Range": `bytes */${size}` });
    response.end();
    return;
  }

  const start = Number(match[1]);
  const end = match[2] == undefined ? size - 1 : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end >= size
  ) {
    response.writeHead(416, { "Content-Range": `bytes */${size}` });
    response.end();
    return;
  }

  const requestedBytes = end - start + 1;
  const metric: MediaRequestMetric = {
    fileId,
    kind: "range",
    start,
    end,
    requestedBytes,
    transferredBytes: 0,
    startedAtMs: nodePerformance.now(),
  };
  metrics.push(metric);
  response.writeHead(206, {
    "Content-Length": requestedBytes,
    "Content-Range": `bytes ${start}-${end}/${size}`,
  });
  pipeMediaRange(mediaPath, metric, response);
}

async function startBenchmarkServer(
  directory: string,
  filesById: ReadonlyMap<string, string>,
  metrics: MediaRequestMetric[],
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const mediaMatch = /^\/media\/([^/]+)$/.exec(requestUrl.pathname);
      if (mediaMatch) {
        const fileId = decodeURIComponent(mediaMatch[1]!);
        const fileName = filesById.get(fileId);
        if (!fileName) {
          response.writeHead(404);
          response.end();
          return;
        }
        await serveMedia(request, response, fileId, path.join(directory, fileName), metrics);
        return;
      }

      if (request.url?.startsWith("/viz/") === true) {
        request.url = request.url.slice(4);
      }
      await serveHandler(request, response, { public: appPath });
    })().catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address == undefined || typeof address === "string") {
    throw new Error("MP4 benchmark server did not bind to a TCP port");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

function hashPng(png: Buffer): string {
  return createHash("sha256").update(png).digest("hex");
}

async function snapshotCanvas(canvas: Locator): Promise<FrameSnapshot> {
  const png = await canvas.screenshot({ animations: "disabled", type: "png" });
  return { hash: hashPng(png), pngBytes: png.byteLength };
}

async function waitForRenderedFrame(canvas: Locator): Promise<FrameSnapshot> {
  const deadline = nodePerformance.now() + FRAME_TIMEOUT_MS;
  let latest: FrameSnapshot | undefined;
  while (nodePerformance.now() < deadline) {
    latest = await snapshotCanvas(canvas);
    if (latest.pngBytes >= FRAME_SCREENSHOT_MINIMUM_BYTES) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, FRAME_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Image canvas did not render a non-blank frame (latest PNG was ${latest?.pngBytes ?? 0} bytes)`,
  );
}

async function waitForDifferentFrame(
  canvas: Locator,
  previousHash: string,
): Promise<{ snapshot: FrameSnapshot; latencyMs: number }> {
  const startedAt = nodePerformance.now();
  const deadline = startedAt + SEEK_FRAME_TIMEOUT_MS;
  while (nodePerformance.now() < deadline) {
    const snapshot = await snapshotCanvas(canvas);
    if (snapshot.hash !== previousHash && snapshot.pngBytes >= FRAME_SCREENSHOT_MINIMUM_BYTES) {
      return { snapshot, latencyMs: nodePerformance.now() - startedAt };
    }
    await new Promise((resolve) => setTimeout(resolve, FRAME_POLL_INTERVAL_MS));
  }
  throw new Error(
    `No visual frame change observed within ${SEEK_FRAME_TIMEOUT_MS}ms; the target may have identical pixels`,
  );
}

async function waitForStableDifferentFrame(
  canvas: Locator,
  previousHash: string,
): Promise<{ snapshot: FrameSnapshot; latencyMs: number }> {
  const startedAt = nodePerformance.now();
  const deadline = startedAt + FRAME_TIMEOUT_MS;
  let latest: FrameSnapshot | undefined;
  let stableSamples = 0;
  let changed = false;
  while (nodePerformance.now() < deadline) {
    const snapshot = await snapshotCanvas(canvas);
    changed ||= snapshot.hash !== previousHash;
    stableSamples = latest?.hash === snapshot.hash ? stableSamples + 1 : 0;
    latest = snapshot;
    if (changed && stableSamples >= 3 && snapshot.pngBytes >= FRAME_SCREENSHOT_MINIMUM_BYTES) {
      return { snapshot, latencyMs: nodePerformance.now() - startedAt };
    }
    await new Promise((resolve) => setTimeout(resolve, FRAME_POLL_INTERVAL_MS));
  }
  throw new Error("Image canvas did not settle on a new frame after rapid seeks");
}

async function ensureImagePanel(page: Page): Promise<Locator> {
  const createLayout = page.getByText("Create a new layout", { exact: true });
  if (await createLayout.isVisible()) {
    await createLayout.click();
    await page.locator("#add-panel-button:not([disabled])").waitFor({ timeout: 10_000 });
  }

  const canvas = page.locator("canvas").first();
  if (!(await canvas.isVisible())) {
    await page.locator("#add-panel-button").click();
    await page.getByText("Image", { exact: true }).last().click();
  }
  await canvas.waitFor({ state: "visible", timeout: 10_000 });
  return canvas;
}

async function clickTimelineRatio(page: Page, ratio: number): Promise<void> {
  const scrubber = page.locator('[data-testid="scrubber-slider"]');
  const box = await scrubber.boundingBox();
  if (!box) {
    throw new Error("Playback scrubber is not visible");
  }
  const x = box.x + Math.max(2, Math.min(box.width - 2, box.width * ratio));
  await page.mouse.click(x, box.y + box.height / 2);
}

async function samplePlayback(
  page: Page,
  canvas: Locator,
): Promise<NonNullable<BenchmarkResult["playback"]>> {
  const playPause = page.locator("#play-pause-button");
  await playPause.waitFor({ state: "visible" });
  await playPause.click();
  const playbackStart = await page.evaluate(() => performance.now());
  const hashes: string[] = [];
  const deadline = nodePerformance.now() + PLAYBACK_SAMPLE_DURATION_MS;
  while (nodePerformance.now() < deadline) {
    hashes.push((await snapshotCanvas(canvas)).hash);
    await page.waitForTimeout(250);
  }
  if ((await playPause.getAttribute("aria-label")) === "Pause") {
    await playPause.click();
  }

  const longTasks = await page.evaluate((startTime) => {
    return (
      globalThis as typeof globalThis & {
        remoteMp4BenchmarkMetrics: BenchmarkPageState;
      }
    ).remoteMp4BenchmarkMetrics.longTasks.filter((entry) => entry.startTime >= startTime);
  }, playbackStart);
  let observedFrameChanges = 0;
  for (let index = 1; index < hashes.length; index++) {
    if (hashes[index] !== hashes[index - 1]) {
      observedFrameChanges++;
    }
  }
  return {
    durationMs: PLAYBACK_SAMPLE_DURATION_MS,
    observedFrameChanges,
    sampleCount: hashes.length,
    longTaskCount: longTasks.length,
    longTaskTotalMs: longTasks.reduce((sum, entry) => sum + entry.duration, 0),
    longestTaskMs: Math.max(0, ...longTasks.map((entry) => entry.duration)),
  };
}

async function mainThreadHeapBytes(page: Page): Promise<number | undefined> {
  return await page.evaluate(() => {
    const memory = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number };
      }
    ).memory;
    return memory?.usedJSHeapSize;
  });
}

function uniqueCoverageBytes(requests: readonly MediaRequestMetric[]): number {
  const ranges = requests
    .map((request) => ({ start: request.start, end: request.end + 1 }))
    .sort((left, right) => left.start - right.start);
  let coverage = 0;
  let currentStart: number | undefined;
  let currentEnd: number | undefined;
  for (const range of ranges) {
    if (currentStart == undefined || currentEnd == undefined) {
      currentStart = range.start;
      currentEnd = range.end;
    } else if (range.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, range.end);
    } else {
      coverage += currentEnd - currentStart;
      currentStart = range.start;
      currentEnd = range.end;
    }
  }
  return (
    coverage +
    (currentStart == undefined || currentEnd == undefined ? 0 : currentEnd - currentStart)
  );
}

function transportMetrics(fileId: string, metrics: readonly MediaRequestMetric[]): TransportMetric {
  const requests = metrics.filter((metric) => metric.fileId === fileId);
  const probes = requests.filter((metric) => metric.kind === "probe");
  const ranges = requests.filter((metric) => metric.kind === "range");
  return {
    probeRequests: probes.length,
    transferredProbeBytes: probes.reduce((sum, request) => sum + request.transferredBytes, 0),
    rangeRequests: ranges.length,
    requestedRangeBytes: ranges.reduce((sum, request) => sum + request.requestedBytes, 0),
    transferredRangeBytes: ranges.reduce((sum, request) => sum + request.transferredBytes, 0),
    uniqueRangeCoverageBytes: uniqueCoverageBytes(ranges),
    maximumRangeBytes: Math.max(0, ...ranges.map((request) => request.requestedBytes)),
  };
}

async function runFileBenchmark(
  page: Page,
  origin: string,
  fileId: string,
  fileName: string,
  fileSizeBytes: number,
  requestMetrics: readonly MediaRequestMetric[],
  browserErrors: string[],
): Promise<BenchmarkResult> {
  const result: BenchmarkResult = {
    file: fileName,
    fileSizeBytes,
    browserChannel: BROWSER_CHANNEL ?? "playwright-chromium",
    headless: HEADLESS,
    label: BENCHMARK_LABEL,
    seeks: [],
    transport: transportMetrics(fileId, requestMetrics),
    errors: [],
  };
  const navigationStartedAt = nodePerformance.now();
  const mediaUrl = `${origin}/media/${encodeURIComponent(fileId)}`;
  const appUrl = new URL(`${origin}/viz/`);
  appUrl.searchParams.set("ds", "remote-mp4");
  appUrl.searchParams.set("ds.url", mediaUrl);
  appUrl.searchParams.set("ds.topic", "/camera/h264");

  try {
    await page.goto(appUrl.href, { timeout: 30_000, waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="playback-controls"]').waitFor({ timeout: 30_000 });
    result.playbackControlsReadyMs = nodePerformance.now() - navigationStartedAt;

    const canvas = await ensureImagePanel(page);
    const panelReadyAt = nodePerformance.now();
    await page.locator("#play-pause-button:not([disabled])").waitFor({ timeout: 30_000 });
    const sourceReadyAt = nodePerformance.now();
    result.sourceInitializeMs = sourceReadyAt - navigationStartedAt;
    result.sourceInitializeTransport = transportMetrics(fileId, requestMetrics);
    let currentFrame = await waitForRenderedFrame(canvas);
    const firstFrameAt = nodePerformance.now();
    result.firstFrameFromNavigationMs = firstFrameAt - navigationStartedAt;
    result.firstFrameAfterPanelReadyMs = firstFrameAt - panelReadyAt;
    result.firstFramePngBytes = currentFrame.pngBytes;
    result.firstFrameTransport = transportMetrics(fileId, requestMetrics);
    result.mainThreadHeapBeforeBytes = await mainThreadHeapBytes(page);

    for (const ratio of SEEK_RATIOS) {
      try {
        await clickTimelineRatio(page, ratio);
        const seekResult = await waitForDifferentFrame(canvas, currentFrame.hash);
        currentFrame = seekResult.snapshot;
        result.seeks.push({ ratio, latencyMs: seekResult.latencyMs });
      } catch (error) {
        result.seeks.push({ ratio, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const rapidSeekStartedAt = nodePerformance.now();
    const beforeRapidSeek = currentFrame;
    for (const ratio of RAPID_SEEK_RATIOS) {
      await clickTimelineRatio(page, ratio);
      await page.waitForTimeout(40);
    }
    await waitForStableDifferentFrame(canvas, beforeRapidSeek.hash);
    result.rapidSeekSettleMs = nodePerformance.now() - rapidSeekStartedAt;

    result.playback = await samplePlayback(page, canvas);
    result.mainThreadHeapAfterBytes = await mainThreadHeapBytes(page);
    if (result.playback.observedFrameChanges === 0) {
      result.errors.push("Playback sampling observed no rendered frame changes");
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    const body = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const diagnosticLines = body
      .split("\n")
      .filter((line) => /error decoding|cannot decode|decoder|webcodecs/i.test(line));
    result.errors.push(...diagnosticLines);
  }

  result.errors.push(...browserErrors);
  result.errors = [...new Set(result.errors)];
  result.transport = transportMetrics(fileId, requestMetrics);
  return result;
}

const describeBenchmark = BENCHMARK_DIRECTORY ? describe : describe.skip;

describeBenchmark("remote MP4 browser benchmark", () => {
  jest.setTimeout(20 * 60 * 1_000);

  it("measures real Range, worker, WebCodecs, seek, and render behavior", async () => {
    const directory = BENCHMARK_DIRECTORY!;
    const fileNames = await benchmarkFiles(directory);
    expect(fileNames.length).toBeGreaterThan(0);

    const filesById = new Map(fileNames.map((fileName, index) => [`video-${index}.mp4`, fileName]));
    const requestMetrics: MediaRequestMetric[] = [];
    const server = await startBenchmarkServer(directory, filesById, requestMetrics);
    let browser: Browser | undefined;
    const results: BenchmarkResult[] = [];
    try {
      browser = await chromium.launch({
        headless: HEADLESS,
        channel: BROWSER_CHANNEL,
        args: ["--enable-precise-memory-info"],
      });
      const context = await browser.newContext({ viewport: { width: 1_440, height: 1_000 } });
      await context.addInitScript(() => {
        const state: BenchmarkPageState = { longTasks: [] };
        (
          globalThis as typeof globalThis & {
            remoteMp4BenchmarkMetrics: BenchmarkPageState;
          }
        ).remoteMp4BenchmarkMetrics = state;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }
        }).observe({ entryTypes: ["longtask"] });
      });
      const page = await context.newPage();
      await page.route("https://api.foxglove.dev/v1/studio-update?**", async (route) => {
        await route.fulfill({ json: {} });
      });

      let currentBrowserErrors: string[] = [];
      page.on("pageerror", (error) => {
        currentBrowserErrors.push(error.message);
      });
      page.on("console", (message) => {
        const text = message.text();
        if (
          message.type() === "error" &&
          /remote MP4|WebCodecs|decoder has been disposed|cannot decode/i.test(text)
        ) {
          currentBrowserErrors.push(text);
        }
      });

      for (const [fileId, fileName] of filesById) {
        currentBrowserErrors = [];
        const fileStats = await stat(path.join(directory, fileName));
        const result = await runFileBenchmark(
          page,
          server.origin,
          fileId,
          fileName,
          fileStats.size,
          requestMetrics,
          currentBrowserErrors,
        );
        results.push(result);
        // eslint-disable-next-line no-restricted-syntax
        console.info(`REMOTE_MP4_BENCHMARK ${JSON.stringify(result)}`);
      }

      await context.close();
    } finally {
      await browser?.close();
      await server.close();
    }

    for (const result of results) {
      expect(result.errors).toEqual([]);
      expect(result.transport.probeRequests).toBe(1);
      expect(result.transport.transferredProbeBytes).toBeLessThan(result.fileSizeBytes);
      expect(result.transport.rangeRequests).toBeGreaterThan(0);
      expect(result.transport.maximumRangeBytes).toBeLessThan(result.fileSizeBytes);
      expect(result.sourceInitializeTransport).toBeDefined();
      expect(result.sourceInitializeTransport!.uniqueRangeCoverageBytes).toBeLessThan(
        result.fileSizeBytes,
      );
      expect(
        result.seeks.filter((seek) => seek.latencyMs != undefined).length,
      ).toBeGreaterThanOrEqual(SEEK_RATIOS.length - 1);
    }
  });
});
