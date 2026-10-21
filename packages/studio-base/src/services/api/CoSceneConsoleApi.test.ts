// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { UserSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/user_pb";

import { getPromiseClient } from "@foxglove/studio-base/util/coscene";

import CoSceneConsoleApi, { type ApiBaseInfo } from "./CoSceneConsoleApi";
import { CustomFieldSchemaSchema } from "./moment-custom-field/generated/common/custom_field_pb";
import { CustomFieldService as MomentCustomFieldService } from "./moment-custom-field/generated/services/custom_field_pb";

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

  it("reads project grouping rules with the current descriptor through the existing transport", async () => {
    const api = await createApi(completeBaseInfo);
    const schema = create(CustomFieldSchemaSchema, { groupingRules: [{ propertyId: "platform" }] });
    const getMomentCustomFieldSchema = jest.fn().mockResolvedValue(schema);
    mockGetPromiseClient.mockReturnValue({ getMomentCustomFieldSchema } as never);
    expect(
      await api.getMomentCustomFieldSchema("warehouses/warehouse-id/projects/project-id"),
    ).toBe(schema);
    expect(getMomentCustomFieldSchema).toHaveBeenCalledWith(
      expect.objectContaining({ project: "warehouses/warehouse-id/projects/project-id" }),
    );
    expect(mockGetPromiseClient).toHaveBeenLastCalledWith(MomentCustomFieldService, undefined);
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

  it("loads every organization user page, including empty intermediate pages", async () => {
    const api = await createApi(completeBaseInfo);
    const first = Array.from({ length: 100 }, (_, index) =>
      create(UserSchema, { name: `users/${index}`, active: true }),
    );
    const last = create(UserSchema, { name: "users/remembered-from-last-page", active: true });
    const listOrganizationUsers = jest
      .fn()
      .mockResolvedValueOnce({ organizationUsers: first, nextPageToken: "second" })
      .mockResolvedValueOnce({ organizationUsers: [], nextPageToken: "third" })
      .mockResolvedValueOnce({ organizationUsers: [last], nextPageToken: "" });
    mockGetPromiseClient.mockReturnValue({ listOrganizationUsers } as never);
    expect(await api.listOrganizationUsers()).toEqual([...first, last]);
    expect(listOrganizationUsers).toHaveBeenCalledTimes(3);
    for (const [index, pageToken] of ["", "second", "third"].entries()) {
      expect(listOrganizationUsers).toHaveBeenNthCalledWith(
        index + 1,
        expect.objectContaining({ pageToken }),
      );
    }
  });

  it("rejects an incomplete user directory rather than returning a partial active-user set", async () => {
    const api = await createApi(completeBaseInfo);
    const error = new Error("second page failed");
    const listOrganizationUsers = jest
      .fn()
      .mockResolvedValueOnce({
        organizationUsers: [create(UserSchema, { name: "users/first", active: true })],
        nextPageToken: "second",
      })
      .mockRejectedValueOnce(error);
    mockGetPromiseClient.mockReturnValue({ listOrganizationUsers } as never);
    await expect(api.listOrganizationUsers()).rejects.toBe(error);
  });

  it("normalizes Headers and tuple inputs without exposing a Headers instance", async () => {
    const api = await createApi(completeBaseInfo);
    const requestHeaders = new Headers({ "X-Headers-Input": "headers" });

    const fromHeaders = api.getRequectConfig("/v1/me", { headers: requestHeaders }).fullConfig
      .headers;
    const fromTuples = api.getRequectConfig("/v1/me", {
      headers: [["X-Tuple-Input", "tuples"]],
    }).fullConfig.headers;

    expect(fromHeaders).not.toBeInstanceOf(Headers);
    expect(new Headers(fromHeaders).get("X-Headers-Input")).toBe("headers");
    expect(fromTuples).toEqual(
      expect.objectContaining({
        Authorization: "Bearer test-token",
        "Record-Name": recordName,
        "X-Tuple-Input": "tuples",
      }),
    );
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

  it("does not commit base info when a selection is cancelled during permission loading", async () => {
    const api = new CoSceneConsoleApi(
      "https://console.example.com",
      "https://bff.example.com",
      "Bearer test-token",
    );
    await api.setApiBaseInfo(completeBaseInfo, { fetchPermissionList: false });

    let resolveRoles: ((value: { userRoles: [] }) => void) | undefined;
    listUserRolesMock
      .mockImplementationOnce(
        async () =>
          await new Promise<{ userRoles: [] }>((resolve) => {
            resolveRoles = resolve;
          }),
      )
      .mockResolvedValue({ userRoles: [] });
    let isCurrent = true;
    const update = api.setApiBaseInfo(
      { warehouseId: "warehouse-id", projectId: "project-id", recordId: "record-b" },
      { isCurrent: () => isCurrent },
    );

    await Promise.resolve();
    expect(api.getApiBaseInfo()).toEqual(completeBaseInfo);

    isCurrent = false;
    resolveRoles?.({ userRoles: [] });
    await update;

    expect(api.getApiBaseInfo()).toEqual(completeBaseInfo);
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

  it("converts metadata schemas from base64 without retaining raw schema strings", async () => {
    const api = await createApi(completeBaseInfo);
    fetchMock.mockResolvedValue(
      jsonResponse({
        startTime: 0,
        endTime: 1,
        topics: [
          {
            topic: "/without-schema",
            encoding: "json",
            schemaName: "example.Empty",
            schemaEncoding: "jsonschema",
            version: "1",
          },
          {
            topic: "/with-schema",
            encoding: "protobuf",
            schemaName: "example.Message",
            schemaEncoding: "protobuf",
            schema: "AQI=",
            version: "1",
          },
        ],
      }),
    );

    const result = await api.topics("file-key");

    expect(result.metaData[0]).not.toHaveProperty("schema");
    expect(Array.from(result.metaData[1]?.schema ?? [])).toEqual([1, 2]);
  });
});
