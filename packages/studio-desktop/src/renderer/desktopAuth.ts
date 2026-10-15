// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useRef, useState } from "react";

import {
  clearDesktopCredential,
  DesktopSession,
  getDesktopSession,
  initializeDesktopSession,
  preservesDesktopPlayback,
  subscribeDesktopSession,
  installDesktopCredential,
} from "@foxglove/studio-base/util/desktopSession";

import type { Auth } from "../common/types";

export function bindDesktopAuth(
  bridge: Auth | undefined,
  { onLogin, onLogout }: { onLogin: () => void; onLogout: () => void },
): () => void {
  // Storage or the initiating renderer can retire a session before its IPC logout arrives.
  // Remember the login this renderer observed independently of shared-token deletion.
  let observedLogin = getDesktopSession();
  let active = true;
  const stopSession = subscribeDesktopSession(() => {
    const session = getDesktopSession();
    if (session?.credential) {
      observedLogin = session;
    }
  });
  const stopLogin = bridge?.onAuthToken((credential, sessionId) => {
    void installDesktopCredential(credential, sessionId)
      .then((accepted) => {
        if (accepted) {
          onLogin();
        }
      })
      .catch(() => {
        console.error("Failed to install desktop credential");
      });
  });
  const stopLogout = bridge?.onLogout((credential, sessionId) => {
    void clearDesktopCredential(credential, sessionId)
      .then(() => {
        const current = getDesktopSession();
        if (
          active &&
          observedLogin?.credential &&
          (credential == undefined || credential === observedLogin.credential) &&
          (sessionId == undefined || sessionId === observedLogin.sessionId) &&
          current?.credential === "" &&
          current.sessionId === observedLogin.sessionId
        ) {
          observedLogin = undefined;
          onLogout();
        }
      })
      .catch(() => {
        console.error("Failed to persist desktop sign-out");
      });
  });
  bridge?.ready?.();
  return () => {
    active = false;
    stopSession();
    stopLogin?.();
    stopLogout?.();
  };
}

/** Keep anonymous playback mounted while replacing the authenticated part of its state. */
export function useDesktopSessionState(): {
  session: DesktopSession;
  workspaceGeneration: number;
  discardStartupLinks: boolean;
} {
  const [session, setSession] = useState(initializeDesktopSession);
  const previousSession = useRef(session);
  const [workspaceGeneration, setWorkspaceGeneration] = useState(0);
  const [discardStartupLinks, setDiscardStartupLinks] = useState(false);
  useEffect(
    () =>
      subscribeDesktopSession(() => {
        const current = getDesktopSession()!;
        if (!preservesDesktopPlayback()) {
          if (previousSession.current.credential) {
            setDiscardStartupLinks(true);
          }
          setWorkspaceGeneration((value) => value + 1);
        }
        previousSession.current = current;
        setSession(current);
      }),
    [],
  );
  return { session, workspaceGeneration, discardStartupLinks };
}
