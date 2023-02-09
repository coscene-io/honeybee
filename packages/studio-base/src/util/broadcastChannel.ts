// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { BroadcastChannel } from "broadcast-channel";

class BroadcastChannelClient {
  private bc: BroadcastChannel;
  public constructor() {
    this.bc = new BroadcastChannel("coScene");
  }
  public async sendBroadcastMessage(message: unknown) {
    await this.bc.postMessage(message);
  }
  public listenBroadcastMessage(callback: (message: unknown) => void) {
    this.bc.onmessage = (ev) => {
      callback(ev);
    };
  }
}

export const bcInstance = new BroadcastChannelClient();
export const LOGOUT_MESSAGE = "logout";
