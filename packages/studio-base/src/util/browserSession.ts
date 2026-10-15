// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const TOKEN_KEY = "coScene_org_jwt";
const INVALID_TOKEN_KEY = "coScene_invalid_org_jwt";
const VERSION_KEY = "coscene.auth.session-version.v1";
export type BrowserSessionStatus = "current" | "changed" | "logged-out" | "recover";

export function getBrowserAuthUrl(
  path: "/auth/login" | "/auth/logout" | "/auth/recover" | "/auth/logged-out",
  location: Pick<Location, "pathname" | "search" | "hash"> = window.location,
): string {
  return `${path}?redirectToPath=${encodeURIComponent(
    location.pathname + location.search + location.hash,
  )}`;
}

/** Match the main site's tab-local invalidation without clearing a peer's credentials. */
export function markBrowserCredentialInvalid(credential: string): void {
  try {
    if (credential && localStorage.getItem(TOKEN_KEY) === credential) {
      sessionStorage.setItem(INVALID_TOKEN_KEY, credential);
    }
  } catch {
    // The recovery page remains available when storage cannot record this hint.
  }
}

function isUsableCredential(credential: string): boolean {
  return (
    /^(basic|bearer) /i.test(credential) &&
    credential.slice(credential.indexOf(" ") + 1).trim().length > 0
  );
}

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
      if (
        this.credential &&
        (!isUsableCredential(this.credential) ||
          sessionStorage.getItem(INVALID_TOKEN_KEY) === this.credential)
      ) {
        this.#status = "recover";
        this.controller.abort();
      }
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
    const value = JSON.parse(raw) as
      | {
          version: string;
          reason: string;
          signOutPendingUntilMs?: number;
          isServerSignOutConfirmed?: boolean;
        }
      | undefined;
    if (
      value == undefined ||
      !/^[0-9a-f]{32}$/.test(value.version) ||
      !["credentials", "logout"].includes(value.reason) ||
      (value.signOutPendingUntilMs != undefined &&
        (!Number.isSafeInteger(value.signOutPendingUntilMs) || value.signOutPendingUntilMs < 0)) ||
      (value.isServerSignOutConfirmed != undefined &&
        typeof value.isServerSignOutConfirmed !== "boolean")
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
  public requestSignal(signal?: AbortSignal): AbortSignal {
    const sessionSignal = this.controller.signal;
    if (signal == undefined || sessionSignal.aborted) {
      return sessionSignal;
    }
    if (signal.aborted) {
      return signal;
    }
    if (typeof AbortSignal.any === "function") {
      return AbortSignal.any([signal, sessionSignal]);
    }
    // Preserve the browser versions supported by Studio before AbortSignal.any was available.
    const controller = new AbortController();
    const onRequestAbort = () => {
      controller.abort(signal.reason);
    };
    const onSessionAbort = () => {
      controller.abort(sessionSignal.reason);
    };
    controller.signal.addEventListener(
      "abort",
      () => {
        signal.removeEventListener("abort", onRequestAbort);
        sessionSignal.removeEventListener("abort", onSessionAbort);
      },
      { once: true },
    );
    signal.addEventListener("abort", onRequestAbort, { once: true });
    sessionSignal.addEventListener("abort", onSessionAbort, { once: true });
    return controller.signal;
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
      } else if (
        this.#status === "current" &&
        current &&
        sessionStorage.getItem(INVALID_TOKEN_KEY) === current
      ) {
        this.#stop("recover");
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
    markBrowserCredentialInvalid(credential);
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
    window.addEventListener("coscene:session-version", this.reconcile);
    document.addEventListener("visibilitychange", this.reconcile);
    this.reconcile();
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener("pageshow", this.reconcile);
      window.removeEventListener("coscene:session-version", this.reconcile);
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
