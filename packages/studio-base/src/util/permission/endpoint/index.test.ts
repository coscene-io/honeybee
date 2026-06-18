// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Endpoint, checkUserPermission } from "./index";

const emptyPermissionList = {
  orgPermissionList: [],
  projectPermissionList: [],
  orgDenyList: [],
  projectDenyList: [],
};

describe("checkUserPermission", () => {
  it("preserves allow, deny, and wildcard matching semantics", () => {
    expect(
      checkUserPermission(Endpoint.CreateEvent, {
        ...emptyPermissionList,
        projectPermissionList: ["coscene.*.services.EventService.*"],
      }),
    ).toBe(true);

    expect(
      checkUserPermission(Endpoint.CreateEvent, {
        ...emptyPermissionList,
        projectPermissionList: ["coscene.*.services.EventService.*"],
        projectDenyList: [Endpoint.CreateEvent],
      }),
    ).toBe(false);
  });

  it("reuses compiled permission regexes for repeated checks", () => {
    const regExpSpy = jest.spyOn(global, "RegExp");

    try {
      const permissionList = {
        ...emptyPermissionList,
        projectPermissionList: [Endpoint.UpdateEvent],
      };

      expect(checkUserPermission(Endpoint.UpdateEvent, permissionList)).toBe(true);
      expect(checkUserPermission(Endpoint.UpdateEvent, permissionList)).toBe(true);

      expect(regExpSpy).toHaveBeenCalledTimes(1);
    } finally {
      regExpSpy.mockRestore();
    }
  });
});
