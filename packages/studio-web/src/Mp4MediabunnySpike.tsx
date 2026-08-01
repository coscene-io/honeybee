// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { useEffect, useRef, useState } from "react";

import { Mp4MediabunnyController } from "@foxglove/studio-base/players/IterablePlayer/Mp4/Mp4MediabunnyController";
import type {
  Mp4MediabunnyFrame,
  Mp4MediabunnyInfo,
  Mp4MediabunnyReadSummary,
} from "@foxglove/studio-base/players/IterablePlayer/Mp4/Mp4MediabunnyController";

type FrameSummary = Omit<Mp4MediabunnyFrame, "frame">;

type Playback = {
  abortController: AbortController;
  promise: Promise<void>;
};

const pageStyle: React.CSSProperties = {
  boxSizing: "border-box",
  minHeight: "100vh",
  padding: 24,
  color: "#e8e8e8",
  background: "#161719",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

const panelStyle: React.CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
  padding: 20,
  border: "1px solid #3f4248",
  borderRadius: 8,
  background: "#202226",
};

const canvasStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  minHeight: 320,
  maxHeight: 600,
  objectFit: "contain",
  background: "#000",
};

async function waitUntil(deadline: number, signal: AbortSignal): Promise<void> {
  const delay = deadline - performance.now();
  if (delay <= 0 || signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function drawFrame(canvas: HTMLCanvasElement, decoded: Mp4MediabunnyFrame): void {
  canvas.width = decoded.width;
  canvas.height = decoded.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D rendering is unavailable");
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  switch (decoded.rotation) {
    case 0:
      context.drawImage(decoded.frame, 0, 0, canvas.width, canvas.height);
      break;
    case 90:
      context.translate(canvas.width, 0);
      context.rotate(Math.PI / 2);
      context.drawImage(decoded.frame, 0, 0, canvas.height, canvas.width);
      break;
    case 180:
      context.translate(canvas.width, canvas.height);
      context.rotate(Math.PI);
      context.drawImage(decoded.frame, 0, 0, canvas.width, canvas.height);
      break;
    case 270:
      context.translate(0, canvas.height);
      context.rotate(-Math.PI / 2);
      context.drawImage(decoded.frame, 0, 0, canvas.height, canvas.width);
      break;
  }
}

export function Mp4MediabunnySpike(): React.JSX.Element {
  const query = new URLSearchParams(window.location.search);
  const [url, setUrl] = useState(query.get("url") ?? "");
  const [timeSeconds, setTimeSeconds] = useState(0);
  const [info, setInfo] = useState<Mp4MediabunnyInfo>();
  const [lastFrame, setLastFrame] = useState<FrameSummary>();
  const [totalReads, setTotalReads] = useState<Mp4MediabunnyReadSummary>();
  const [status, setStatus] = useState("Enter a Range-enabled MP4 URL, then load it.");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(ReactNull);
  const controllerRef = useRef<Mp4MediabunnyController>();
  const playbackRef = useRef<Playback>();

  useEffect(() => {
    return () => {
      playbackRef.current?.abortController.abort();
      playbackRef.current = undefined;
      controllerRef.current?.dispose();
      controllerRef.current = undefined;
    };
  }, []);

  const stopPlayback = async () => {
    const playback = playbackRef.current;
    if (!playback) {
      return;
    }
    playback.abortController.abort();
    try {
      await playback.promise;
    } catch {
      // The playback owner reports non-abort errors.
    }
    if (playbackRef.current === playback) {
      playbackRef.current = undefined;
    }
    setPlaying(false);
  };

  const displayFrame = (decoded: Mp4MediabunnyFrame, nextStatus?: string) => {
    try {
      const canvas = canvasRef.current;
      if (canvas) {
        drawFrame(canvas, decoded);
      }
      const { frame: _frame, ...summary } = decoded;
      setLastFrame(summary);
      setTimeSeconds(decoded.presentationTimeSeconds);
      const controller = controllerRef.current;
      if (controller) {
        setTotalReads(controller.getReadSummary());
      }
      if (nextStatus) {
        setStatus(nextStatus);
      }
    } finally {
      decoded.frame.close();
    }
  };

  const load = async () => {
    if (url.length === 0) {
      return;
    }
    await stopPlayback();
    setBusy(true);
    setStatus("Reading sparse MP4 metadata and checking WebCodecs support…");
    setInfo(undefined);
    setLastFrame(undefined);
    setTotalReads(undefined);
    controllerRef.current?.dispose();
    const controller = new Mp4MediabunnyController(url);
    controllerRef.current = controller;
    try {
      const nextInfo = await controller.initialize();
      setInfo(nextInfo);
      setTimeSeconds(0);
      setStatus("Initialization complete; decoding the first presentation frame…");
      displayFrame(
        await controller.seekFrame(0),
        "Ready. Exact paused seeking and presentation-order playback are available.",
      );
    } catch (error) {
      controller.dispose();
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
      }
      setStatus(`Error: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const seek = async () => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    await stopPlayback();
    setBusy(true);
    setStatus(`Decoding the frame covering ${timeSeconds.toFixed(6)}s…`);
    try {
      const decoded = await controller.seekFrame(timeSeconds);
      displayFrame(
        decoded,
        `Requested ${timeSeconds.toFixed(6)}s; presented PTS ${decoded.presentationTimeSeconds.toFixed(6)}s`,
      );
    } catch (error) {
      setStatus(`Error: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const play = async () => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    await stopPlayback();
    const startTime = timeSeconds;
    const abortController = new AbortController();
    const wallClockStart = performance.now();
    setPlaying(true);
    setStatus(`Playing in presentation order from ${startTime.toFixed(6)}s…`);

    const playback: Playback = {
      abortController,
      promise: Promise.resolve(),
    };
    playback.promise = (async () => {
      try {
        for await (const decoded of controller.frames(startTime, abortController.signal)) {
          await waitUntil(
            wallClockStart + Math.max(0, decoded.presentationTimeSeconds - startTime) * 1000,
            abortController.signal,
          );
          if (abortController.signal.aborted) {
            decoded.frame.close();
            break;
          }
          displayFrame(
            decoded,
            `Playing PTS ${decoded.presentationTimeSeconds.toFixed(6)}s (${decoded.durationSeconds.toFixed(6)}s frame)`,
          );
        }
        if (!abortController.signal.aborted) {
          setStatus("Playback reached the end of the video.");
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          setStatus(`Error: ${(error as Error).message}`);
        }
      } finally {
        if (playbackRef.current === playback) {
          playbackRef.current = undefined;
          setPlaying(false);
        }
      }
    })();
    playbackRef.current = playback;
  };

  const pause = async () => {
    await stopPlayback();
    setStatus(`Paused on presentation PTS ${timeSeconds.toFixed(6)}s.`);
  };

  return (
    <main style={pageStyle}>
      <section style={panelStyle}>
        <h1 style={{ marginTop: 0 }}>Remote MP4 Mediabunny spike</h1>
        <p style={{ color: "#b8bbc2", lineHeight: 1.5 }}>
          Development-only proof: bounded HTTP Range source → Mediabunny MP4 demux → WebCodecs
          VideoFrame. Mediabunny performs random-access-point decode and returns B-frame/VFR content
          in presentation order; no MSE remux or whole-file download is used.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
          style={{ display: "flex", gap: 8, marginBottom: 16 }}
        >
          <input
            aria-label="Remote MP4 URL"
            type="url"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
            placeholder="https://example.com/video.mp4"
            style={{ flex: 1, minWidth: 0, padding: "8px 10px" }}
          />
          <button type="submit" disabled={busy || url.length === 0}>
            Load
          </button>
        </form>

        <canvas ref={canvasRef} style={canvasStyle} />

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 18 }}>
          <input
            aria-label="Seek time"
            type="range"
            min={0}
            max={info?.durationSeconds ?? 0}
            step="any"
            value={timeSeconds}
            disabled={!info || busy || playing}
            onChange={(event) => {
              setTimeSeconds(event.target.valueAsNumber);
            }}
            style={{ flex: 1 }}
          />
          <input
            aria-label="Seek time in seconds"
            type="number"
            min={0}
            max={info?.durationSeconds}
            step="any"
            value={timeSeconds}
            disabled={!info || busy || playing}
            onChange={(event) => {
              setTimeSeconds(event.target.valueAsNumber);
            }}
            style={{ width: 130, padding: "7px 8px" }}
          />
          <button
            type="button"
            disabled={!info || busy || playing}
            onClick={() => {
              void seek();
            }}
          >
            Seek exact frame
          </button>
          {playing ? (
            <button
              type="button"
              onClick={() => {
                void pause();
              }}
            >
              Pause
            </button>
          ) : (
            <button
              type="button"
              disabled={!info || busy || timeSeconds >= info.durationSeconds}
              onClick={() => {
                void play();
              }}
            >
              Play
            </button>
          )}
        </div>

        <p
          role="status"
          style={{ minHeight: 24, color: status.startsWith("Error") ? "#ff8b8b" : "#b7e4a8" }}
        >
          {status}
        </p>

        {(info != undefined || lastFrame != undefined) && (
          <pre
            style={{
              overflow: "auto",
              maxHeight: 360,
              padding: 12,
              color: "#d9e6ff",
              background: "#111214",
              borderRadius: 4,
            }}
          >
            {JSON.stringify({ info, lastFrame, totalReads }, undefined, 2)}
          </pre>
        )}
      </section>
    </main>
  );
}
