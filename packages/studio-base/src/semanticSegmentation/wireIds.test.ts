// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { v5 as uuidv5, validate, version } from "uuid";

import { isUuid, polygonWireId } from "./wireIds";

describe("polygonWireId", () => {
  it("derives a stable UUIDv5 for a non-UUID editor id", () => {
    const id = polygonWireId("records/r1", "inst", "p-7");
    expect(validate(id)).toBe(true);
    expect(version(id)).toBe(5);
    expect(polygonWireId("records/r1", "inst", "p-7")).toBe(id);
    expect(polygonWireId("records/r1", "inst", "p-8")).not.toBe(id);
    expect(polygonWireId("records/r2", "inst", "p-7")).not.toBe(id);
    expect(id).not.toBe(uuidv5("records/r1/inst/polygons/p-7", uuidv5.URL));
  });

  it("passes a UUID editor id through unchanged", () => {
    const id = "3f2c1b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
    expect(isUuid(id)).toBe(true);
    expect(polygonWireId("records/r1", "inst", id)).toBe(id);
  });
});
