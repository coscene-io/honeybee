// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";

import { stringifyWithBigint } from "./stringifyWithBigint";

describe("stringifyWithBigint", () => {
  it("serializes nested bigint values as strings", () => {
    const value = {
      propertyId: "trigger-time",
      timestamp: create(TimestampSchema, { seconds: 1_713_129_600n, nanos: 123_000_000 }),
    };

    expect(stringifyWithBigint(value)).toEqual(
      '{"propertyId":"trigger-time","timestamp":{"$typeName":"google.protobuf.Timestamp","seconds":"1713129600","nanos":123000000}}',
    );
  });

  it("matches JSON.stringify for undefined input", () => {
    expect(stringifyWithBigint(undefined)).toBeUndefined();
  });
});
