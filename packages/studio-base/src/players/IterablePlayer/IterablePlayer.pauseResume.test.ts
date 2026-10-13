/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { signal } from "@foxglove/den/async";
import { H264 } from "@foxglove/den/video";
import { compare, fromMillis, toNanoSec } from "@foxglove/rostime";
import { MessageEvent } from "@foxglove/studio";
import { CompressedVideoController } from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/Images/CompressedVideoController";
import { CompressedVideo } from "@foxglove/studio-base/panels/ThreeDeeRender/renderables/Images/ImageTypes";
import { PlayerPresence, PlayerState } from "@foxglove/studio-base/players/types";

import { BufferedIterableSource } from "./BufferedIterableSource";
import { IDeserializedIterableSource, Initalization, IteratorResult } from "./IIterableSource";
import { IterablePlayer } from "./IterablePlayer";

const TOPICS = ["/cameraA", "/cameraB"];

function frame(
  ms: number,
  topic = TOPICS[0]!,
  kind: "key" | "delta" = "delta",
): MessageEvent<CompressedVideo> {
  return {
    topic,
    schemaName: "foxglove.CompressedVideo",
    receiveTime: fromMillis(ms),
    sizeInBytes: 1,
    message: {
      timestamp: fromMillis(ms),
      frame_id: topic,
      format: "h264",
      data: new Uint8Array([kind === "key" ? 0x65 : 0x41]),
    },
  };
}

class TestSource implements IDeserializedIterableSource {
  public readonly sourceType = "deserialized";

  public async initialize(): Promise<Initalization> {
    return {
      start: fromMillis(0),
      end: fromMillis(1000),
      topics: TOPICS.map((name) => ({ name, schemaName: "foxglove.CompressedVideo" })),
      topicStats: new Map(),
      datatypes: new Map(),
      publishersByTopic: new Map(),
      profile: undefined,
      problems: [],
    };
  }

  public async *messageIterator(): AsyncIterableIterator<Readonly<IteratorResult>> {}

  public async getBackfillMessages(): Promise<MessageEvent[]> {
    return [];
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 24; i++) {
    await Promise.resolve();
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(predicate()).toBe(true);
}

async function createPlayer(onState?: (state: PlayerState) => Promise<void>) {
  const player = new IterablePlayer({
    source: new TestSource(),
    enablePreload: false,
    sourceId: "pause-resume-test",
  });
  const states: PlayerState[] = [];
  player.setSubscriptions(TOPICS.map((topic) => ({ topic })));
  player.setListener(async (state) => {
    states.push(state);
    await onState?.(state);
  });
  await waitFor(() => {
    const state = states.at(-1);
    return (
      state?.presence === PlayerPresence.PRESENT &&
      state.activeData?.isPlaying === false &&
      compare(state.activeData.currentTime, fromMillis(99)) === 0
    );
  });
  return { player, states };
}

function messages(states: readonly PlayerState[]): MessageEvent[] {
  return states.flatMap((state) => state.activeData?.messages ?? []);
}

describe("pause/resume message continuity", () => {
  afterEach(async () => {
    // close() releases source resources before the playing state finishes its 16ms yield.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flush();
  });

  beforeEach(() => {
    // Keep each playback tick at 20ms while the async read/render gates control the pause boundary.
    let now = 0;
    jest.spyOn(performance, "now").mockImplementation(() => (now += 20));
    jest.spyOn(console, "debug").mockImplementation(() => {});
    jest.spyOn(H264, "IsAnnexB").mockReturnValue(true);
    jest.spyOn(H264, "IsKeyframe").mockImplementation((data) => data[0] === 0x65);
    jest.spyOn(H264, "GetFrameInfo").mockImplementation((data) => ({
      isKeyFrame: data[0] === 0x65,
      mayNeedRewrite: false,
    }));
  });

  it.each(["read", "render", "queued-render"] as const)(
    "preserves both H264 panels when pausing during an async %s",
    async (stage) => {
      const release = signal();
      const releaseQueuedRender = signal();
      const queuedRender = signal();
      const readyToPause = signal();
      const frames = [
        frame(100, TOPICS[0], "key"),
        frame(100, TOPICS[1], "key"),
        frame(120),
        frame(125),
        frame(140),
        frame(140, TOPICS[1]),
      ];
      const iterator = (async function* () {
        for (const [index, msgEvent] of frames.entries()) {
          if (stage === "read" && index === 3) {
            readyToPause.resolve();
            await release;
          } else if (stage !== "read" && index === 4) {
            readyToPause.resolve();
          }
          yield { type: "message-event", msgEvent } as const;
        }
      })();
      jest.spyOn(BufferedIterableSource.prototype, "messageIterator").mockReturnValue(iterator);

      const renderer = {
        currentTime: 0n,
        startTime: 0n,
        stopped: false,
        isPlaybackStopped: () => renderer.stopped,
        subscribeMessageRange: jest.fn(() => undefined),
      };
      const displays = TOPICS.map(() =>
        jest.fn(
          async (_batch: readonly MessageEvent<CompressedVideo>[]) => ({ ok: true }) as const,
        ),
      );
      const controllers = TOPICS.map(
        (topic, index) =>
          new CompressedVideoController({ topic, renderer, displayFrames: displays[index]! }),
      );
      let heldFirstRender = false;
      const { player, states } = await createPlayer(async (state) => {
        const data = state.activeData;
        if (data == undefined) {
          return;
        }
        renderer.stopped = !data.isPlaying;
        renderer.currentTime = toNanoSec(data.currentTime);
        await Promise.all(
          controllers.map(async (controller, index) => {
            await controller.enqueueVideoFrames(
              data.messages.filter(
                (event) => event.topic === TOPICS[index],
              ) as MessageEvent<CompressedVideo>[],
            );
          }),
        );
        if (stage !== "read" && data.isPlaying && data.messages.length > 0 && !heldFirstRender) {
          heldFirstRender = true;
          await release;
        } else if (
          stage === "queued-render" &&
          heldFirstRender &&
          data.isPlaying &&
          data.messages.length === 0
        ) {
          queuedRender.resolve();
          await releaseQueuedRender;
        }
      });
      try {
        player.startPlayback();
        await readyToPause;
        await flush();
        if (stage === "queued-render") {
          // A queued UI/progress update starts another render before the first promise settles.
          player.setPlaybackSpeed(1);
          release.resolve();
          await queuedRender;
          await flush();
        }
        const pausedTime = states.at(-1)!.activeData!.currentTime;
        player.pausePlayback();
        release.resolve();
        releaseQueuedRender.resolve();
        await waitFor(() => states.at(-1)?.activeData?.isPlaying === false);
        expect(states.at(-1)!.activeData!.currentTime).toEqual(pausedTime);
        expect(messages(states)).toEqual(frames.slice(0, 2));

        player.startPlayback();
        await waitFor(() => messages(states).length === frames.length);
        await flush();
        expect(messages(states)).toEqual(frames);
        expect(
          states
            .filter((state) => state.activeData?.isPlaying === false)
            .every((state) => state.activeData?.messages.length === 0),
        ).toBe(true);
        for (const [index, display] of displays.entries()) {
          expect(display.mock.calls.flatMap(([batch]) => batch)).toEqual(
            frames.filter((event) => event.topic === TOPICS[index]),
          );
        }
      } finally {
        release.resolve();
        releaseQueuedRender.resolve();
        await player.close();
        controllers.forEach((controller) => {
          controller.dispose();
        });
      }
    },
  );

  it.each(["stamp", "problem"] as const)(
    "retains a %s result returned after pause",
    async (kind) => {
      const release = signal();
      const reading = signal();
      const keyframe = frame(100, TOPICS[0], "key");
      const delta = frame(120);
      const next = frame(140);
      const result: IteratorResult =
        kind === "stamp"
          ? { type: "stamp", stamp: fromMillis(130) }
          : {
              type: "problem",
              connectionId: 1,
              problem: { severity: "warn", message: "Test read problem" },
            };
      const iterator = (async function* () {
        yield { type: "message-event", msgEvent: keyframe } as const;
        yield { type: "message-event", msgEvent: delta } as const;
        reading.resolve();
        await release;
        yield result;
        yield { type: "message-event", msgEvent: next } as const;
      })();
      jest.spyOn(BufferedIterableSource.prototype, "messageIterator").mockReturnValue(iterator);
      const { player, states } = await createPlayer();
      try {
        player.startPlayback();
        await reading;
        player.pausePlayback();
        release.resolve();
        await waitFor(() => states.at(-1)?.activeData?.isPlaying === false);
        player.setPlaybackSpeed(0.1);
        player.startPlayback();
        await waitFor(() => messages(states).length === 3);
        expect(messages(states)).toEqual([keyframe, delta, next]);
        for (const state of states) {
          for (const message of state.activeData?.messages ?? []) {
            expect(compare(message.receiveTime, state.activeData!.currentTime)).toBeLessThanOrEqual(
              0,
            );
          }
        }
        if (kind === "problem") {
          expect(
            states.some(
              (state) =>
                state.problems?.some((problem) => problem.message === "Test read problem") === true,
            ),
          ).toBe(true);
          expect(console.warn).toHaveBeenCalledWith(
            "Player problem",
            "connid-1",
            result.type === "problem" ? result.problem : undefined,
          );
          jest.mocked(console.warn).mockClear();
        }
      } finally {
        release.resolve();
        await player.close();
      }
    },
  );

  it("preserves consumed frames when playback resumes before a paused read returns", async () => {
    const release = signal();
    const reading = signal();
    const frames = [frame(100, TOPICS[0], "key"), frame(120), frame(125), frame(140)];
    const iterator = (async function* () {
      for (const [index, msgEvent] of frames.entries()) {
        if (index === 2) {
          reading.resolve();
          await release;
        }
        yield { type: "message-event", msgEvent } as const;
      }
    })();
    jest.spyOn(BufferedIterableSource.prototype, "messageIterator").mockReturnValue(iterator);
    const { player, states } = await createPlayer();
    try {
      player.startPlayback();
      await reading;
      player.pausePlayback();
      player.startPlayback();
      release.resolve();
      await waitFor(() => messages(states).length === frames.length);
      expect(messages(states)).toEqual(frames);
    } finally {
      release.resolve();
      await player.close();
    }
  });

  it.each([
    ["read", "before-pause"],
    ["read", "after-resume"],
    ["render", "before-pause"],
    ["render", "after-resume"],
  ] as const)(
    "resets subscriptions changed during a rapid resume with a pending %s (%s)",
    async (stage, changeTime) => {
      const release = signal();
      const readyToPause = signal();
      const frames = [
        frame(100, TOPICS[0], "key"),
        frame(100, TOPICS[1], "key"),
        frame(120),
        frame(125),
        frame(140),
      ];
      const iterator = (async function* () {
        for (const [index, msgEvent] of frames.entries()) {
          if (stage === "read" && index === 3) {
            readyToPause.resolve();
            await release;
          } else if (stage === "render" && index === 4) {
            readyToPause.resolve();
          }
          yield { type: "message-event", msgEvent } as const;
        }
      })();
      const replacement = frame(140, TOPICS[1], "key");
      const messageIterator = jest
        .spyOn(BufferedIterableSource.prototype, "messageIterator")
        .mockReturnValueOnce(iterator)
        .mockImplementation(() =>
          (async function* () {
            yield { type: "message-event", msgEvent: replacement } as const;
          })(),
        );
      let heldFirstRender = false;
      const { player, states } = await createPlayer(async (state) => {
        if (
          stage === "render" &&
          (state.activeData?.messages.length ?? 0) > 0 &&
          !heldFirstRender
        ) {
          heldFirstRender = true;
          await release;
        }
      });
      try {
        player.startPlayback();
        await readyToPause;
        await flush();
        const pausedTime = states.at(-1)!.activeData!.currentTime;
        const subscriptions = [{ topic: TOPICS[1]! }];
        if (changeTime === "before-pause") {
          player.setSubscriptions(subscriptions);
        }
        player.pausePlayback();
        player.startPlayback();
        if (changeTime === "after-resume") {
          player.setSubscriptions(subscriptions);
        }
        release.resolve();
        await waitFor(() =>
          messages(states).some((event) => compare(event.receiveTime, fromMillis(140)) >= 0),
        );
        expect(messageIterator).toHaveBeenCalledTimes(2);
        expect(messageIterator).toHaveBeenLastCalledWith(
          expect.objectContaining({
            topics: new Map([[TOPICS[1], subscriptions[0]]]),
            start: { sec: pausedTime.sec, nsec: pausedTime.nsec + 1 },
            fetchCompleteTopicState: "complete",
          }),
        );
        expect(messages(states)).toEqual([...frames.slice(0, 2), replacement]);
      } finally {
        release.resolve();
        await player.close();
      }
    },
  );

  it("keeps the remaining frames after resuming only part of a retained tick", async () => {
    const release = signal();
    const reading = signal();
    const frames = [frame(100, TOPICS[0], "key"), frame(120), frame(125), frame(140)];
    const iterator = (async function* () {
      for (const [index, msgEvent] of frames.entries()) {
        if (index === 3) {
          reading.resolve();
          await release;
        }
        yield { type: "message-event", msgEvent } as const;
      }
    })();
    jest.spyOn(BufferedIterableSource.prototype, "messageIterator").mockReturnValue(iterator);
    const { player, states } = await createPlayer();
    try {
      player.startPlayback();
      await reading;
      player.pausePlayback();
      release.resolve();
      await waitFor(() => states.at(-1)?.activeData?.isPlaying === false);
      player.playUntil(fromMillis(121));
      await waitFor(
        () =>
          states.at(-1)?.activeData?.isPlaying === false &&
          compare(states.at(-1)!.activeData!.currentTime, fromMillis(121)) === 0,
      );
      expect(messages(states)).toEqual(frames.slice(0, 2));
      player.setPlaybackSpeed(0.1);
      player.startPlayback();
      await waitFor(() => messages(states).length === frames.length);
      expect(messages(states)).toEqual(frames);
    } finally {
      release.resolve();
      await player.close();
    }
  });

  it.each(["seek", "close"] as const)(
    "does not commit an old tick after %s during render",
    async (action) => {
      const release = signal();
      const readComplete = signal();
      const keyframe = frame(100, TOPICS[0], "key");
      const iterator = (async function* () {
        yield { type: "message-event", msgEvent: keyframe } as const;
        yield { type: "message-event", msgEvent: frame(120) } as const;
        yield { type: "message-event", msgEvent: frame(125) } as const;
        readComplete.resolve();
        yield { type: "message-event", msgEvent: frame(140) } as const;
      })();
      jest
        .spyOn(BufferedIterableSource.prototype, "messageIterator")
        .mockReturnValueOnce(iterator)
        .mockImplementation(() => (async function* () {})());
      let held = false;
      const { player, states } = await createPlayer(async (state) => {
        if ((state.activeData?.messages.length ?? 0) > 0 && !held) {
          held = true;
          await release;
        }
      });
      try {
        player.startPlayback();
        await readComplete;
        await flush();
        if (action === "seek") {
          player.seekPlayback(fromMillis(500));
          release.resolve();
          await waitFor(() =>
            states.some(
              (state) =>
                state.activeData != undefined &&
                compare(state.activeData.currentTime, fromMillis(500)) === 0,
            ),
          );
        } else {
          const closed = player.close();
          release.resolve();
          await closed;
        }
        expect(messages(states)).toEqual([keyframe]);
      } finally {
        release.resolve();
        await player.close();
      }
    },
  );

  it.each(["seek", "subscriptions"] as const)(
    "discards retained frames after changing %s",
    async (change) => {
      const release = signal();
      const reading = signal();
      const iterator = (async function* () {
        yield { type: "message-event", msgEvent: frame(100, TOPICS[0], "key") } as const;
        yield { type: "message-event", msgEvent: frame(120) } as const;
        reading.resolve();
        await release;
        yield { type: "message-event", msgEvent: frame(125) } as const;
      })();
      const replacement = frame(600, TOPICS[1], "key");
      jest
        .spyOn(BufferedIterableSource.prototype, "messageIterator")
        .mockReturnValueOnce(iterator)
        .mockImplementation(() =>
          (async function* () {
            yield { type: "message-event", msgEvent: replacement } as const;
          })(),
        );
      const { player, states } = await createPlayer();
      try {
        player.startPlayback();
        await reading;
        player.pausePlayback();
        release.resolve();
        await waitFor(() => states.at(-1)?.activeData?.isPlaying === false);
        if (change === "seek") {
          player.seekPlayback(fromMillis(500));
          await waitFor(
            () => compare(states.at(-1)!.activeData!.currentTime, fromMillis(500)) === 0,
          );
        } else {
          player.setSubscriptions([{ topic: TOPICS[1]! }]);
          await flush();
        }
        player.startPlayback();
        await waitFor(() => messages(states).includes(replacement));
        expect(messages(states)).toEqual([frame(100, TOPICS[0], "key"), replacement]);
      } finally {
        release.resolve();
        await player.close();
      }
    },
  );
});
