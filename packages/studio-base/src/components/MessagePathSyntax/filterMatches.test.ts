// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { filterMatches } from "./filterMatches";

const base = {
  type: "filter" as const,
  path: ["id"],
  nameLoc: 0,
  valueLoc: 0,
  repr: "",
};

describe("filterMatches", () => {
  it("supports six operators", () => {
    expect(filterMatches({ ...base, operator: "==", value: 1, repr: "id==1" }, { id: 1 })).toBe(
      true,
    );
    expect(filterMatches({ ...base, operator: "!=", value: 1, repr: "id!=1" }, { id: 2 })).toBe(
      true,
    );
    expect(filterMatches({ ...base, operator: ">", value: 1, repr: "id>1" }, { id: 2 })).toBe(true);
    expect(filterMatches({ ...base, operator: ">=", value: 1, repr: "id>=1" }, { id: 1 })).toBe(
      true,
    );
    expect(filterMatches({ ...base, operator: "<", value: 1, repr: "id<1" }, { id: 0 })).toBe(true);
    expect(filterMatches({ ...base, operator: "<=", value: 1, repr: "id<=1" }, { id: 1 })).toBe(
      true,
    );
    expect(filterMatches({ ...base, operator: ">", value: 1, repr: "id>1" }, { id: 1 })).toBe(
      false,
    );
  });

  it("keeps loose == for 1 and true", () => {
    expect(filterMatches({ ...base, operator: "==", value: 1, repr: "id==1" }, { id: true })).toBe(
      true,
    );
  });

  it("compares number 2 against bigint 1 for {id>1}", () => {
    expect(filterMatches({ ...base, operator: ">", value: 1n, repr: "id>1" }, { id: 2 })).toBe(
      true,
    );
  });

  it("does not throw when comparing boolean true to bigint 1", () => {
    expect(() =>
      filterMatches({ ...base, operator: ">", value: 1n, repr: "id>1" }, { id: true }),
    ).not.toThrow();
    expect(filterMatches({ ...base, operator: ">", value: 1n, repr: "id>1" }, { id: true })).toBe(
      false,
    );
  });
});
