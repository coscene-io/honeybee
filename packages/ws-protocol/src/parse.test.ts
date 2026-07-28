// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { parseClientMessage, parseServerMessage } from "./parse";

function messageWithOpcode(opcode: number): ArrayBuffer {
  const buffer = new ArrayBuffer(1);
  new DataView(buffer).setUint8(0, opcode);
  return buffer;
}

describe("binary message parsing", () => {
  it("rejects unknown server message opcodes", () => {
    expect(() => parseServerMessage(messageWithOpcode(255), 0)).toThrow(
      "Unrecognized server message opcode: 255",
    );
  });

  it("rejects unknown client message opcodes", () => {
    expect(() => parseClientMessage(messageWithOpcode(255))).toThrow(
      "Unrecognized client message opcode: 255",
    );
  });
});
