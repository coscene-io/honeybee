// SPDX-FileCopyrightText: Copyright (C) 2026 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";
import { IteratorResult } from "@foxglove/studio-base/players/IterablePlayer/IIterableSource";

import { mergeShards } from "./mergeShards";

function msg(t: Time, topic = "/x"): IteratorResult<Uint8Array> {
  return {
    type: "message-event",
    msgEvent: {
      topic,
      receiveTime: t,
      publishTime: t,
      message: new Uint8Array([0]),
      sizeInBytes: 1,
      schemaName: "X",
    },
  };
}

async function* fromArray(values: IteratorResult<Uint8Array>[]) {
  for (const v of values) {
    yield v;
  }
}

async function collect(
  iter: AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>>,
): Promise<IteratorResult<Uint8Array>[]> {
  const out: IteratorResult<Uint8Array>[] = [];
  for await (const v of iter) {
    out.push(v as IteratorResult<Uint8Array>);
  }
  return out;
}

const t = (sec: number, nsec = 0): Time => ({ sec, nsec });

describe("mergeShards", () => {
  it("merges three sorted iterators in time order", async () => {
    const a = fromArray([msg(t(1)), msg(t(4)), msg(t(7))]);
    const b = fromArray([msg(t(2)), msg(t(5)), msg(t(8))]);
    const c = fromArray([msg(t(3)), msg(t(6)), msg(t(9))]);
    const out = await collect(mergeShards([a, b, c]));
    const times = out
      .filter((r): r is IteratorResult<Uint8Array> & { type: "message-event" } => r.type === "message-event")
      .map((r) => r.msgEvent.receiveTime.sec);
    expect(times).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("returns identical sequence for a single iterator", async () => {
    const a = fromArray([msg(t(1)), msg(t(2)), msg(t(3))]);
    const out = await collect(mergeShards([a]));
    expect(out.map((r) => r.type === "message-event" ? r.msgEvent.receiveTime.sec : 0)).toEqual([1, 2, 3]);
  });

  it("returns empty for zero iterators without throwing", async () => {
    const out = await collect(mergeShards([]));
    expect(out).toEqual([]);
  });

  it("breaks ties with stable iterator-index ordering", async () => {
    const a = fromArray([msg(t(1), "/a"), msg(t(2), "/a")]);
    const b = fromArray([msg(t(1), "/b"), msg(t(2), "/b")]);
    const out = await collect(mergeShards([a, b]));
    const tags = out
      .filter((r): r is IteratorResult<Uint8Array> & { type: "message-event" } => r.type === "message-event")
      .map((r) => r.msgEvent.topic);
    // Tie at sec=1 → iterator a wins (lower index); same at sec=2.
    expect(tags).toEqual(["/a", "/b", "/a", "/b"]);
  });

  it("drains remaining iterators after one finishes early", async () => {
    const a = fromArray([msg(t(1))]);
    const b = fromArray([msg(t(2)), msg(t(3)), msg(t(4))]);
    const out = await collect(mergeShards([a, b]));
    const times = out
      .filter((r): r is IteratorResult<Uint8Array> & { type: "message-event" } => r.type === "message-event")
      .map((r) => r.msgEvent.receiveTime.sec);
    expect(times).toEqual([1, 2, 3, 4]);
  });

  it("yields problem results out-of-band before time-based ordering", async () => {
    async function* withProblem() {
      yield {
        type: "problem" as const,
        connectionId: 0,
        problem: { severity: "error" as const, message: "boom" },
      };
      yield msg(t(5));
    }
    const a = withProblem();
    const b = fromArray([msg(t(2))]);
    const out = await collect(mergeShards([a, b]));
    expect(out[0]?.type).toBe("problem");
  });

  it("propagates an iterator's thrown error", async () => {
    async function* faulty(): AsyncIterableIterator<IteratorResult<Uint8Array>> {
      yield msg(t(1));
      throw new Error("iterator failure");
    }
    const a = faulty();
    const b = fromArray([msg(t(2)), msg(t(3))]);
    await expect(collect(mergeShards([a, b]))).rejects.toThrow("iterator failure");
  });

  it("stops consuming when AbortSignal fires", async () => {
    const ctrl = new AbortController();
    async function* infinite(): AsyncIterableIterator<IteratorResult<Uint8Array>> {
      let n = 0;
      while (true) {
        yield msg(t(n++));
        await Promise.resolve();
      }
    }
    const merged = mergeShards([infinite()], ctrl.signal);
    const out: IteratorResult<Uint8Array>[] = [];
    for await (const v of merged) {
      out.push(v as IteratorResult<Uint8Array>);
      if (out.length >= 3) {
        ctrl.abort();
        break;
      }
    }
    expect(out.length).toBe(3);
  });
});
