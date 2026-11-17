// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// The test runs under Node, so it may use Node's crypto as the reference implementation.
// eslint-disable-next-line no-restricted-imports
import { createHash } from "crypto";

import { polygonWireId, sha256 } from "./wireIds";

describe("sha256", () => {
  it("matches Node's SHA-256 across block boundaries and multi-byte text", () => {
    const inputs = [
      "",
      "abc",
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(63),
      "a".repeat(64),
      "a".repeat(65),
      "a".repeat(1000),
      "record/实例 #2/polygons/多边形-1",
      "😀".repeat(40),
    ];
    for (const input of inputs) {
      expect(Buffer.from(sha256(input)).toString("hex")).toBe(
        createHash("sha256").update(input).digest("hex"),
      );
    }
  });
});

describe("polygonWireId", () => {
  it("keeps the ids previously derived with Node's crypto", () => {
    const key = "records/r1/inst/polygons/p-7";
    const bytes = createHash("sha256").update(key).digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    const expected = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

    expect(polygonWireId("records/r1", "inst", "p-7")).toBe(expected);
  });

  it("passes a UUID editor id through unchanged", () => {
    const id = "3f2c1b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
    expect(polygonWireId("records/r1", "inst", id)).toBe(id);
  });
});
