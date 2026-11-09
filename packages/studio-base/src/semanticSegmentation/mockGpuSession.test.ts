// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { MockGpuPool, MOCK_GPU_IDLE_TIMEOUT_MS, MOCK_MEDIA_CACHE_LIMIT_BYTES } from "./mockGpuPool";
import { MockGpuSession } from "./mockGpuSession";

function session(pool: MockGpuPool, userId: string, sessionId = `${userId}-session`) {
  return new MockGpuSession(pool, { userId, sessionId });
}

describe("local mock GPU sessions (SEG-GPU-002/005/006/008..011)", () => {
  it("isolates U allocation from V status and shares U allocation across U sessions", async () => {
    const pool = new MockGpuPool();
    const u = session(pool, "U");
    const v = session(pool, "V");
    await u.start(4);
    await v.reconnect();
    expect(u.snapshot()).toMatchObject({ userId: "U", allocated: 4, status: "ready", mock: true });
    expect(v.snapshot()).toMatchObject({ userId: "V", allocated: 0, status: "stopped" });
    const otherU = session(pool, "U", "U-another-source");
    await otherU.reconnect();
    expect(otherU.snapshot().allocated).toBe(4);
    expect(pool.activeUsers()).toBe(1);
  });

  it("rejects the fifth active user, enforces quota, and releases capacity on stop", async () => {
    const pool = new MockGpuPool();
    const users = ["U", "V", "W", "X", "Y"].map((user) => session(pool, user));
    await Promise.all(users.slice(0, 4).map(async (user) => await user.start(4)));
    await expect(users[4]!.start()).rejects.toThrow("capacity");
    expect(users[4]!.snapshot()).toMatchObject({
      allocated: 0,
      connected: false,
      status: "stopped",
    });
    expect(pool.activeUsers()).toBe(4);
    users[0]!.stop();
    await users[4]!.start();
    expect(users[4]!.snapshot().status).toBe("ready");
    await expect(session(new MockGpuPool(), "quota").start(5)).rejects.toThrow("quota");
    await expect(session(new MockGpuPool(), "fraction").start(1.5)).rejects.toThrow("integer");
  });

  it("requires explicit mock-backend idle input; elapsed client time alone does not stop resources", async () => {
    let now = 0;
    const pool = new MockGpuPool(() => now);
    const u = session(pool, "U");
    const events = jest.fn();
    u.subscribe(events);
    await u.start();
    now = MOCK_GPU_IDLE_TIMEOUT_MS;
    expect(u.snapshot().status).toBe("ready");
    pool.reportIdle();
    expect(events).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "stopped", allocated: 0 }),
    );
    expect(pool.activeUsers()).toBe(0);
  });

  it("delivers connecting, ready, disconnect and reconnect without allocating or enqueueing again", async () => {
    const pool = new MockGpuPool();
    const start = jest.spyOn(pool, "start");
    const u = session(pool, "U");
    const events = jest.fn();
    u.subscribe(events);
    const first = u.start(4);
    const second = u.start(4);
    await Promise.all([first, second]);
    expect(events.mock.calls.map(([gpu]) => gpu.statusChannel)).toContain("connecting");
    expect(u.snapshot()).toMatchObject({ statusChannel: "connected", status: "ready" });
    u.disconnect();
    expect(events).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "disconnected", connected: false, allocated: 4 }),
    );
    await u.reconnect();
    expect(events.mock.calls.map(([gpu]) => gpu.statusChannel)).toContain("reconnecting");
    expect(u.snapshot().status).toBe("ready");
    expect(start).toHaveBeenCalledTimes(1);
    expect(pool.activeUsers()).toBe(1);
  });

  it("rejects foreign and old-session status events and refuses a channel bound to another user", async () => {
    const pool = new MockGpuPool();
    const u = session(pool, "U");
    const events = jest.fn();
    await u.start();
    u.subscribe(events);
    const before = events.mock.calls.length;
    u.receive({
      userId: "V",
      sessionId: u.identity.sessionId,
      sequence: 999,
      gpu: { ...u.snapshot(), status: "error" },
    });
    u.receive({
      ...u.identity,
      sessionId: "old-session",
      sequence: 1000,
      gpu: { ...u.snapshot(), status: "error" },
    });
    expect(events).toHaveBeenCalledTimes(before);
    expect(u.snapshot().status).toBe("ready");
    u.receive({ ...u.identity, sequence: 100, gpu: u.snapshot() });
    const accepted = events.mock.calls.length;
    u.receive({ ...u.identity, sequence: 99, gpu: { ...u.snapshot(), status: "error" } });
    u.receive({ ...u.identity, sequence: 100, gpu: { ...u.snapshot(), status: "error" } });
    u.receive({ ...u.identity, sequence: Number.NaN, gpu: { ...u.snapshot(), status: "error" } });
    expect(events).toHaveBeenCalledTimes(accepted);
    await expect(session(pool, "V", u.identity.sessionId).reconnect()).rejects.toThrow(
      "different user",
    );
  });

  it("closes the old source channel and ignores callbacks and handshakes after disposal", async () => {
    const pool = new MockGpuPool();
    const open = jest.spyOn(pool, "openChannel");
    const old = session(pool, "U", "old-source");
    const events = jest.fn();
    old.subscribe(events);
    const handshake = old.reconnect();
    const callback = open.mock.calls[0]![1];
    old.dispose();
    const count = events.mock.calls.length;
    await expect(handshake).rejects.toThrow("disposed");
    const current = session(pool, "V", "new-source");
    await current.start();
    callback({ ...old.identity, sequence: 20, gpu: current.snapshot() });
    expect(events).toHaveBeenCalledTimes(count);
    expect(old.snapshot().statusChannel).toBe("closed");
    expect(current.snapshot().userId).toBe("V");
  });

  it("cancels a pending start on stop or disposal without reserving hidden capacity", async () => {
    const pool = new MockGpuPool();
    const u = session(pool, "U");
    let finish!: () => void;
    const pending = u.start(4, async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    u.stop();
    finish();
    await expect(pending).rejects.toThrow("superseded");
    expect(pool.activeUsers()).toBe(0);
    const v = session(pool, "V");
    const disposed = v.start();
    v.dispose();
    await expect(disposed).rejects.toThrow("disposed");
    expect(pool.activeUsers()).toBe(0);
  });

  it("delivers explicit backend failure through the channel without changing another user", async () => {
    const pool = new MockGpuPool();
    const u = session(pool, "U");
    const v = session(pool, "V");
    await Promise.all([u.start(), v.start()]);
    const events = jest.fn();
    u.subscribe(events);
    pool.reportFailure(u.identity, "Mock backend failure");
    expect(events).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error", error: "Mock backend failure" }),
    );
    expect(v.snapshot().status).toBe("ready");
  });

  it("closes a cached source channel, rejects its saved callback, and resumes without reallocating", async () => {
    const pool = new MockGpuPool();
    const open = jest.spyOn(pool, "openChannel");
    const u = session(pool, "U", "shared-panel");
    await u.start(4);
    const oldCallback = open.mock.calls[0]![1];
    const events = jest.fn();
    u.subscribe(events);
    u.close();
    const count = events.mock.calls.length;
    const v = session(pool, "V", "shared-panel");
    await v.start();
    oldCallback({ ...u.identity, sequence: 999, gpu: v.snapshot() });
    expect(events).toHaveBeenCalledTimes(count);
    expect(u.snapshot().statusChannel).toBe("closed");
    v.close();
    await u.reconnect();
    expect(u.snapshot()).toMatchObject({ userId: "U", allocated: 4, status: "ready" });
    expect(pool.activeUsers()).toBe(2);
    const resumed = events.mock.calls.length;
    oldCallback({ ...u.identity, sequence: 1000, gpu: v.snapshot() });
    expect(events).toHaveBeenCalledTimes(resumed);
  });

  it("does not leak a channel when a connecting listener closes or disposes the session", async () => {
    const pool = new MockGpuPool();
    const open = jest.spyOn(pool, "openChannel");
    const closing = session(pool, "U");
    closing.subscribe((gpu) => {
      if (gpu.statusChannel === "connecting") {
        closing.close();
      }
    });
    expect(await closing.reconnect()).toMatchObject({ statusChannel: "closed" });
    const disposing = session(pool, "V");
    disposing.subscribe((gpu) => {
      if (gpu.statusChannel === "connecting") {
        disposing.dispose();
      }
    });
    await expect(disposing.reconnect()).rejects.toThrow("disposed");
    expect(open).not.toHaveBeenCalled();
  });

  it("does not reconnect when a pool-start notification synchronously closes the source", async () => {
    const pool = new MockGpuPool();
    const open = jest.spyOn(pool, "openChannel");
    const u = session(pool, "U");
    await u.reconnect();
    let closed = false;
    u.subscribe((gpu) => {
      if (!closed && gpu.allocated > 0 && gpu.statusChannel === "connected") {
        closed = true;
        u.close();
      }
    });
    await expect(u.start()).rejects.toThrow("superseded");
    expect(u.snapshot().statusChannel).toBe("closed");
    expect(open).toHaveBeenCalledTimes(1);
    // Start was accepted by the mock backend before the source closed; reconnect reuses it.
    expect(pool.activeUsers()).toBe(1);
    await u.reconnect();
    expect(u.snapshot()).toMatchObject({ allocated: 1, status: "ready" });
  });
});

describe("local per-user media acknowledgement (SEG-CACHE-002/003)", () => {
  const media = { recordId: "record", videoId: "video", sourceKey: "content-A" };
  it("reuses the same user/video acknowledgement but isolates users, records, videos and content", () => {
    const pool = new MockGpuPool(() => 42);
    const first = pool.acknowledgeMedia("U", media, 10).entries[0];
    expect(pool.acknowledgeMedia("U", media, 10).entries).toEqual([first]);
    expect(pool.mediaCache("V").entries).toEqual([]);
    const otherUser = pool.acknowledgeMedia("V", media, 10).entries[0];
    expect(otherUser).not.toEqual(first);
    for (const other of [
      { ...media, videoId: "other-video" },
      { ...media, recordId: "other-record" },
      { ...media, sourceKey: "content-B" },
    ]) {
      pool.acknowledgeMedia("U", other, 10);
    }
    expect(pool.mediaCache("U").entries).toHaveLength(4);
    expect(pool.mediaCache("U").usedBytes).toBe(40);
    expect(pool.mediaCache("V").usedBytes).toBe(10);
    pool.mediaCache("U").entries[0]!.sizeBytes = 999;
    expect(pool.mediaCache("U").usedBytes).toBe(40);
  });

  it("accounts quota across all videos for one user while another user has an independent quota", () => {
    const pool = new MockGpuPool();
    pool.acknowledgeMedia("U", media, MOCK_MEDIA_CACHE_LIMIT_BYTES);
    expect(() => pool.acknowledgeMedia("U", { ...media, videoId: "other" }, 1)).toThrow("16 GiB");
    expect(pool.acknowledgeMedia("V", media, 1).usedBytes).toBe(1);
  });
});
