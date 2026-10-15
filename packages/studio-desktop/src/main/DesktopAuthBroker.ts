// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { randomUUID } from "crypto";

import { parseLegacyAuthLink } from "../common/authLink";

type Login = { credential: string; sessionId: string };
type Recipient = (
  event: "auth-token" | "auth-signout",
  credential?: string,
  sessionId?: string,
) => void;

/** Retain cold-start callbacks until the renderer has installed its IPC listeners. */
export class DesktopAuthBroker {
  readonly #processId = randomUUID();
  #revision = 0;
  #login: Login | undefined;
  readonly #recipients = new Map<number, Recipient>();

  public acceptLink(link: string): boolean {
    const credential = parseLegacyAuthLink(link);
    if (credential == undefined) {
      return false;
    }
    this.#login = { credential, sessionId: `${this.#processId}:${++this.#revision}` };
    for (const send of this.#recipients.values()) {
      send("auth-token", this.#login.credential, this.#login.sessionId);
    }
    return true;
  }

  public ready(id: number, send: Recipient): void {
    this.#recipients.set(id, send);
    if (this.#login != undefined) {
      send("auth-token", this.#login.credential, this.#login.sessionId);
    }
  }

  public remove(id: number): void {
    this.#recipients.delete(id);
  }

  public logout(credential?: string, sessionId?: string): void {
    if (
      this.#login != undefined &&
      ((credential != undefined && credential !== this.#login.credential) ||
        (sessionId != undefined && sessionId !== this.#login.sessionId))
    ) {
      return;
    }
    this.#login = undefined;
    for (const send of this.#recipients.values()) {
      send("auth-signout", credential, sessionId);
    }
  }
}
