// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

jest.mock("@foxglove/studio-base/services/api/CoSceneConsoleApi", () => {
  const mockSetApiBaseInfo = jest.fn();
  const mockConsoleApiConstructor = jest.fn().mockImplementation(() => ({
    setApiBaseInfo: mockSetApiBaseInfo,
    topics: jest.fn(),
    getStreams: jest.fn(),
  }));

  return {
    __esModule: true,
    CoverageResponse: undefined,
    __mockConsoleApiConstructor: mockConsoleApiConstructor,
    __mockSetApiBaseInfo: mockSetApiBaseInfo,
    default: mockConsoleApiConstructor,
  };
});

import {
  __mockConsoleApiConstructor as mockConsoleApiConstructor,
  __mockSetApiBaseInfo as mockSetApiBaseInfo,
} from "@foxglove/studio-base/services/api/CoSceneConsoleApi";
import { initialize } from "./DataPlatformIterableSource";

describe("DataPlatformIterableSource", () => {
  beforeEach(() => {
    mockConsoleApiConstructor.mockClear();
    mockSetApiBaseInfo.mockClear();
  });

  it("hydrates the worker ConsoleApi with record base info", () => {
    initialize({
      api: {
        baseUrl: "https://console.example.com",
        bffUrl: "https://bff.example.com",
        auth: "Bearer token",
      },
      params: {
        key: "file-key",
        warehouseId: "warehouse-id",
        projectId: "project-id",
        recordId: "record-id",
      },
    });

    expect(mockConsoleApiConstructor).toHaveBeenCalledWith(
      "https://console.example.com",
      "https://bff.example.com",
      "Bearer token",
    );
    expect(mockSetApiBaseInfo).toHaveBeenCalledWith(
      {
        warehouseId: "warehouse-id",
        projectId: "project-id",
        recordId: "record-id",
      },
      { fetchPermissionList: false },
    );
  });
});
