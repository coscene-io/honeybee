// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { getPromiseClient } from "@foxglove/studio-base/util/coscene";

import CoSceneConsoleApi, { type ApiBaseInfo } from "./CoSceneConsoleApi";

jest.mock("@foxglove/studio-base/util/coscene", () => ({
  ...jest.requireActual("@foxglove/studio-base/util/coscene"),
  getPromiseClient: jest.fn(),
}));

const mockGetPromiseClient = getPromiseClient as jest.MockedFunction<typeof getPromiseClient>;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CoSceneConsoleApi", () => {
  const originalFetch = global.fetch;
  const recordName = "warehouses/warehouse-id/projects/project-id/records/record-id";
  const completeBaseInfo: ApiBaseInfo = {
    warehouseId: "warehouse-id",
    projectId: "project-id",
    recordId: "record-id",
  };

  let fetchMock: jest.MockedFunction<typeof fetch>;
  let listUserRolesMock: jest.Mock;

  async function createApi(baseInfo: ApiBaseInfo): Promise<CoSceneConsoleApi> {
    const api = new CoSceneConsoleApi(
      "https://console.example.com",
      "https://bff.example.com",
      "  Bearer test-token  ",
    );

    await api.setApiBaseInfo(baseInfo);

    return api;
  }

  function getHeadersFromCall(callIndex = 0): Record<string, string> {
    return fetchMock.mock.calls[callIndex]?.[1]?.headers as Record<string, string>;
  }

  beforeEach(() => {
    fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;

    listUserRolesMock = jest.fn().mockResolvedValue({ userRoles: [] });
    mockGetPromiseClient.mockReset();
    mockGetPromiseClient.mockReturnValue({
      listUserRoles: listUserRolesMock,
    } as never);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("adds Record-Name to request config when base info is complete", async () => {
    const api = await createApi(completeBaseInfo);

    const { fullConfig } = api.getRequectConfig("/v1/me", {
      headers: { "X-Test": "1" },
    });

    expect(fullConfig.headers).toEqual({
      Authorization: "Bearer test-token",
      "Record-Name": recordName,
      "X-Test": "1",
    });
  });

  it("omits Record-Name when record id is missing", async () => {
    const api = await createApi({
      warehouseId: "warehouse-id",
      projectId: "project-id",
    });

    const { fullConfig } = api.getRequectConfig("/v1/me");

    expect(fullConfig.headers).toEqual({
      Authorization: "Bearer test-token",
    });
  });

  it("adds Record-Name to generic REST requests", async () => {
    const api = await createApi(completeBaseInfo);
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "user-id",
      }),
    );

    await api.me();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://console.example.com/v1/me",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Record-Name": recordName,
        }),
      }),
    );
  });

  it("keeps getStreams headers and adds Record-Name", async () => {
    const api = await createApi(completeBaseInfo);
    fetchMock.mockResolvedValue(new Response("stream", { status: 200 }));

    await api.getStreams({
      start: 10,
      end: 20,
      topics: ["/topic"],
      id: "file-id",
      signal: new AbortController().signal,
      projectName: "warehouses/warehouse-id/projects/project-id",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://console.example.com/v1/data/getStreams",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(getHeadersFromCall()).toEqual(
      expect.objectContaining({
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
        "Project-Name": "warehouses/warehouse-id/projects/project-id",
        "Topic-Prefix": "false",
        "Relative-Time": "false",
        "Record-Name": recordName,
      }),
    );
  });

  it("adds Record-Name to getFilesStatus requests", async () => {
    const api = await createApi(completeBaseInfo);
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    await api.getFilesStatus("file-key");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://console.example.com/v1/data/getFilesStatus/file-key",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Record-Name": recordName,
        }),
      }),
    );
  });
});
