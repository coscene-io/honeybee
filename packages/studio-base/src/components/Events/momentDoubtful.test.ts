// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { buildMomentCustomizedFields, isMomentDoubtful } from "./momentDoubtful";

it.each(["true", "false", "TRUE", "1", "", undefined])(
  "recognizes only the stored true flag (%s)",
  (value) => {
    expect(isMomentDoubtful(value == undefined ? {} : { _doubtful: value })).toBe(value === "true");
  },
);

it("sets and removes the reserved flag while preserving unrelated metadata without mutating it", () => {
  const fields = Object.freeze({ issue: "A42", _doubtful: "true" });
  expect(buildMomentCustomizedFields({ fields, isDoubtful: false })).toEqual({ issue: "A42" });
  expect(
    buildMomentCustomizedFields({ fields: { issue: "A42", _doubtful: "false" }, isDoubtful: true }),
  ).toEqual({ issue: "A42", _doubtful: "true" });
  expect(fields).toEqual({ issue: "A42", _doubtful: "true" });
});
