// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const TOKEN_KEY = "coScene_org_jwt";
const VERSION_KEY = "coscene.auth.session-version.v1";
export type BrowserSessionStatus = "current" | "changed" | "logged-out" | "recover";

/** One immutable credential/context per browser document. Desktop never installs this guard. */
export class BrowserSession {
  public readonly credential: string;
  public readonly controller = new AbortController();
  #version: string | undefined;
  #status: BrowserSessionStatus = "current";
  #listeners = new Set<() => void>();
  #localPlayback = false;

  public constructor() {
    try {
      this.credential = localStorage.getItem(TOKEN_KEY) ?? "";
      this.#version = this.#readVersion()?.version;
    } catch {
      this.credential = "";
      this.#status = "recover";
      this.controller.abort();
    }
  }

  #readVersion(): { version: string; reason: string } | undefined {
    const raw = localStorage.getItem(VERSION_KEY);
    if (raw == undefined) {
      return undefined;
    }
    const value = JSON.parse(raw) as { version: string; reason: string };
    if (
      !/^[0-9a-f]{32}$/.test(value.version) ||
      !["credentials", "logout"].includes(value.reason)
    ) {
      throw new Error("Invalid session boundary");
    }
    return value;
  }

  public getStatus(): BrowserSessionStatus {
    return this.#status;
  }
  public preservesPlayback(): boolean {
    return this.#localPlayback;
  }
  public setLocalPlayback({ local }: { local: boolean }): void {
    const changed = this.#localPlayback !== local;
    this.#localPlayback = local;
    if (changed && this.#status !== "current") {
      for (const listener of this.#listeners) {
        listener();
      }
    }
  }
  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  #stop(status: BrowserSessionStatus): void {
    this.#status = status;
    this.controller.abort();
    for (const listener of this.#listeners) {
      listener();
    }
  }
  public reconcile = (): void => {
    try {
      const current = localStorage.getItem(TOKEN_KEY) ?? "";
      const boundary = this.#readVersion();
      if (current !== this.credential || boundary?.version !== this.#version) {
        const status =
          boundary?.reason === "logout" && !current
            ? "logged-out"
            : current
              ? "changed"
              : "recover";
        if (status !== this.#status) {
          this.#stop(status);
        }
      }
    } catch {
      if (this.#status !== "recover") {
        this.#stop("recover");
      }
    }
  };
  public assertCurrent(credential = this.credential): void {
    this.reconcile();
    if (this.#status !== "current" || credential !== this.credential) {
      throw new DOMException("Browser session changed; reload required", "AbortError");
    }
  }
  public rejectCredential(credential: string): void {
    this.reconcile();
    if (this.#status !== "current" || credential !== this.credential) {
      return;
    }
    // Invalidate this document only. Never race a Web credential replacement
    // by deleting shared storage from a delayed API response.
    this.#stop("recover");
  }
  public listen(): () => void {
    const storage = (event: StorageEvent) => {
      if (event.key == undefined || event.key === TOKEN_KEY || event.key === VERSION_KEY) {
        this.reconcile();
      }
    };
    window.addEventListener("storage", storage);
    window.addEventListener("pageshow", this.reconcile);
    document.addEventListener("visibilitychange", this.reconcile);
    this.reconcile();
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener("pageshow", this.reconcile);
      document.removeEventListener("visibilitychange", this.reconcile);
    };
  }
}

let browserSession: BrowserSession | undefined;
export function initializeBrowserSession(): BrowserSession {
  browserSession ??= new BrowserSession();
  return browserSession;
}
export function getBrowserSession(): BrowserSession | undefined {
  return browserSession;
}
