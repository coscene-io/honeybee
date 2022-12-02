// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import CoSceneConsoleApi from "@foxglove/studio-base/services/CoSceneConsoleApi";

import {
  DataPlatformInterableSourceConsoleApi,
  DataPlatformIterableSource,
} from "./DataPlatformIterableSource";
import { streamMessages } from "./streamMessages";

jest.mock("./streamMessages", () => ({
  ...jest.requireActual("./streamMessages"),
  streamMessages: jest.fn(() => {
    return [];
  }),
}));

describe("DataPlatformIterableSource", () => {
  it("should correctly play into next coverage region", async () => {
    const stubApi: DataPlatformInterableSourceConsoleApi = {
      async topics(): ReturnType<CoSceneConsoleApi["topics"]> {
        return {
          start: "2022-06-03T05:19:30.999000000Z",
          end: "2022-06-03T05:19:35.999000000Z",
          metaData: [
            {
              topic: "foo",
              version: "1",
              schemaEncoding: "jsonschema",
              schemaName: "",
              encoding: "json",
              schema: new Uint8Array(),
            },
          ],
        };
      },
      async getDevice(id: string): ReturnType<CoSceneConsoleApi["getDevice"]> {
        return {
          id,
          name: "my device",
        };
      },
      getAuthHeader(): ReturnType<CoSceneConsoleApi["getAuthHeader"]> {
        return "Authorization";
      },
    };

    const source = new DataPlatformIterableSource({
      api: stubApi,
      params: {
        revisionName:
          "warehouses/1c593c01-eaa3-4b85-82ed-277494820866/projects/66364b66-0439-47c3-931d-c622a0e57177/records/445b7d55-eeb7-41c0-bbc2-329aa8867038/revisions/61e11ed356d789547c4a2286106a8bcd98709b351561628670fc34963fb9e559",
        filename: "kisstti11.bag",
        recordName: "recordName",
      },
    });

    const initResult = await source.initialize();
    expect(initResult.problems).toEqual([]);

    const msgIterator = source.messageIterator({ consumptionType: "partial", topics: ["foo"] });
    // read all the messages
    for await (const _ of msgIterator) {
      // no-op
    }

    expect((streamMessages as jest.Mock).mock.calls).toEqual([
      [
        expect.objectContaining({
          params: {
            authHeader: "Authorization",
            end: {
              nsec: 999000000,
              sec: 1654233575,
            },
            filename: "kisstti11.bag",
            revisionName:
              "warehouses/1c593c01-eaa3-4b85-82ed-277494820866/projects/66364b66-0439-47c3-931d-c622a0e57177/records/445b7d55-eeb7-41c0-bbc2-329aa8867038/revisions/61e11ed356d789547c4a2286106a8bcd98709b351561628670fc34963fb9e559",
            recordName: "recordName",
            start: {
              nsec: 999000000,
              sec: 1654233570,
            },
          },
        }),
      ],
    ]);
  });
});
