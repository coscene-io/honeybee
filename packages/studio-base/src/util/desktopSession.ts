// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Auth } from "@foxglove/studio-desktop/src/common/types";

const TOKEN_KEY = "coScene_org_jwt";
const SESSION_KEY = "coScene_desktop_session_id";
const LOCK_KEY = "coscene.desktop-auth";
const listeners = new Set<() => void>();
let currentSession: DesktopSession | undefined;
let nextGeneration = 0;
let retiringSessionId: string | undefined;
let localPlayback = false;

export function setDesktopLocalPlayback({ local }: { local: boolean }): void {
  localPlayback = local;
}

export function preservesDesktopPlayback(): boolean {
  return localPlayback;
}

/** Each desktop login owns its requests, including when the same token is installed again. */
export class DesktopSession {
  public readonly controller = new AbortController();
  public readonly generation = ++nextGeneration;

  public constructor(
    public readonly credential: string,
    public readonly sessionId: string,
  ) {}

  public assertCurrent(credential = this.credential): void {
    if (
      this.controller.signal.aborted ||
      !this.credential ||
      credential !== this.credential ||
      localStorage.getItem(TOKEN_KEY) !== this.credential ||
      (localStorage.getItem(SESSION_KEY) ?? "") !== this.sessionId
    ) {
      this.controller.abort();
      throw new DOMException("Desktop session changed; sign in again", "AbortError");
    }
  }

  public requestSignal(signal?: AbortSignal): AbortSignal {
    return signal == undefined
      ? this.controller.signal
      : AbortSignal.any([signal, this.controller.signal]);
  }

  public rejectCredential(credential: string): void {
    if (currentSession !== this || credential !== this.credential) {
      return;
    }
    try {
      this.assertCurrent(credential);
    } catch {
      return;
    }
    void signOutDesktop(credential).catch(() => {
      console.error("Failed to persist desktop sign-out");
    });
  }
}

export function getDesktopSession(): DesktopSession | undefined {
  return currentSession;
}

export function initializeDesktopSession(): DesktopSession {
  // Hydrate under the cross-window lock after subscription; never combine two partial writes.
  currentSession ??= new DesktopSession("", "");
  return currentSession;
}

function replaceSession(credential: string, sessionId: string): void {
  currentSession?.controller.abort();
  currentSession = new DesktopSession(credential, sessionId);
  for (const listener of listeners) {
    listener();
  }
}

function applyStoredDesktopSession(): void {
  const sessionId = localStorage.getItem(SESSION_KEY) ?? "";
  const credential = sessionId === retiringSessionId ? "" : (localStorage.getItem(TOKEN_KEY) ?? "");
  if (credential !== currentSession?.credential || sessionId !== currentSession.sessionId) {
    replaceSession(credential, sessionId);
  }
}

function reconcileDesktopSession(): void {
  void navigator.locks.request(LOCK_KEY, applyStoredDesktopSession).catch(() => {
    currentSession?.controller.abort();
    console.error("Failed to read desktop session");
  });
}

/** IPC delivery can lag in a background renderer; shared storage must never move backwards. */
function isOlderDesktopSession(candidate: string, stored: string): boolean {
  const [candidateProcess, candidateRevision] = candidate.split(":");
  const [storedProcess, storedRevision] = stored.split(":");
  return (
    candidateProcess === storedProcess &&
    candidateRevision != undefined &&
    storedRevision != undefined &&
    Number(candidateRevision) < Number(storedRevision)
  );
}

export async function installDesktopCredential(
  credential: string,
  sessionId: string = crypto.randomUUID(),
): Promise<boolean> {
  if (!/^(Bearer|Basic) \S+$/i.test(credential)) {
    throw new Error("Invalid desktop credential");
  }
  // Web Locks coordinates different renderer processes, unlike a per-window JS mutex.
  return await navigator.locks.request(LOCK_KEY, () => {
    const storedSessionId = localStorage.getItem(SESSION_KEY) ?? "";
    if (
      sessionId === retiringSessionId ||
      isOlderDesktopSession(sessionId, storedSessionId) ||
      (sessionId === storedSessionId && localStorage.getItem(TOKEN_KEY) == undefined)
    ) {
      return false;
    }
    if (storedSessionId === sessionId && localStorage.getItem(TOKEN_KEY) === credential) {
      // Another renderer already committed this broadcast. Adopt it without briefly removing
      // its token, which would invalidate that renderer's current requests.
      if (
        currentSession?.credential !== credential ||
        currentSession.sessionId !== sessionId ||
        currentSession.controller.signal.aborted
      ) {
        replaceSession(credential, sessionId);
        return true;
      }
      return false;
    }
    retiringSessionId = currentSession?.sessionId;
    if (currentSession?.credential) {
      replaceSession("", currentSession.sessionId);
    } else {
      currentSession?.controller.abort();
    }
    // Remove the old credential before advancing its revision; a failed second write must
    // never leave a new revision paired with the previous account's token.
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("user-storage");
    localStorage.setItem(SESSION_KEY, sessionId);
    localStorage.setItem(TOKEN_KEY, credential);
    retiringSessionId = undefined;
    replaceSession(credential, sessionId);
    return true;
  });
}

/** Retire local requests synchronously, then compare and commit the shared logout under the lock. */
export async function clearDesktopCredential(
  expectedCredential = currentSession?.credential,
  expectedSessionId = currentSession?.sessionId,
): Promise<boolean> {
  if (
    currentSession != undefined &&
    ((expectedCredential != undefined && expectedCredential !== currentSession.credential) ||
      (expectedSessionId != undefined && expectedSessionId !== currentSession.sessionId))
  ) {
    return false;
  }
  const sessionId = currentSession?.sessionId ?? localStorage.getItem(SESSION_KEY) ?? "";
  retiringSessionId = sessionId;
  replaceSession("", sessionId);
  // If persistence fails, leave this revision retired; later pageshow cannot restore its token.
  return await navigator.locks.request(LOCK_KEY, () => {
    const stored = localStorage.getItem(TOKEN_KEY) ?? "";
    const storedSessionId = localStorage.getItem(SESSION_KEY) ?? "";
    if (
      (expectedCredential != undefined && stored !== "" && stored !== expectedCredential) ||
      (expectedSessionId != undefined && storedSessionId !== expectedSessionId)
    ) {
      applyStoredDesktopSession();
      return false;
    }
    // Retain the last revision as a tombstone so a lagging window cannot replay its login.
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("user-storage");
    retiringSessionId = undefined;
    applyStoredDesktopSession();
    return stored !== "";
  });
}

export async function signOutDesktop(credential = currentSession?.credential): Promise<void> {
  const sessionId = currentSession?.sessionId;
  if (await clearDesktopCredential(credential, sessionId)) {
    const bridge = (global as { authBridge?: Auth }).authBridge;
    bridge?.logout(credential, sessionId);
  }
}

export function subscribeDesktopSession(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key == undefined || event.key === TOKEN_KEY || event.key === SESSION_KEY) {
      reconcileDesktopSession();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", reconcileDesktopSession);
  reconcileDesktopSession();
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", reconcileDesktopSession);
  };
}
