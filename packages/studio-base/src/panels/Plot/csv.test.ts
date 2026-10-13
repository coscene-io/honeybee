// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { downloadFiles } from "@foxglove/studio-base/util/download";

import { downloadCSV, generateCSV, guardCsvDataChunkSource } from "./csv";

jest.mock("@foxglove/studio-base/util/download", () => ({
  downloadFiles: jest.fn(),
}));

describe("csv", () => {
  describe("getCSVData", () => {
    it("should generate valid csv data", () => {
      const csv = generateCSV(
        [
          {
            label: "label",
            data: [
              {
                receiveTime: { sec: 0, nsec: 0 },
                x: 0,
                y: 0,
                value: 0,
              },
            ],
          },
        ],
        "timestamp",
      );
      expect(csv).toEqual(
        ["elapsed time,receive time,header.stamp,topic,value", "0,0.000000000,,label,0"].join("\n"),
      );
    });

    it("should generate valid csv data for bigint values", () => {
      const csv = generateCSV(
        [
          {
            label: "label",
            data: [
              {
                receiveTime: { sec: 0, nsec: 0 },
                x: 0,
                y: Number(9999999999999001n),
                value: 9999999999999001n,
              },
            ],
          },
        ],
        "timestamp",
      );
      expect(csv).toEqual(
        [
          "elapsed time,receive time,header.stamp,topic,value",
          "0,0.000000000,,label,9999999999999001",
        ].join("\n"),
      );
    });
  });

  it("builds a download from bounded CSV string parts", async () => {
    const originalBlob = globalThis.Blob;
    const createdBlob = {} as Blob;
    const BlobMock = jest.fn(() => createdBlob);
    Object.defineProperty(globalThis, "Blob", {
      configurable: true,
      writable: true,
      value: BlobMock,
    });

    try {
      await downloadCSV("plot_data", "timestamp", async (callback, maxDatums) => {
        expect(maxDatums).toBe(10_000);
        await callback([
          {
            label: "/foo.val",
            data: [
              {
                x: 0,
                y: Number(9_999_999_999_999_001n),
                receiveTime: { sec: 1, nsec: 2 },
                headerStamp: { sec: 3, nsec: 4 },
                value: 9_999_999_999_999_001n,
              },
            ],
          },
        ]);
        await callback([
          {
            label: "/bar.val",
            data: [
              {
                x: 1,
                y: 2,
                receiveTime: { sec: 5, nsec: 6 },
                value: 2,
              },
            ],
          },
        ]);
        return true;
      });

      expect(BlobMock).toHaveBeenCalledWith(
        [
          "elapsed time,receive time,header.stamp,topic,value",
          "\n",
          "0,1.000000002,3.000000004,/foo.val,9999999999999001",
          "\n",
          "1,5.000000006,,/bar.val,2",
        ],
        { type: "text/csv;charset=utf-8;" },
      );
      expect(downloadFiles).toHaveBeenCalledWith([
        { blob: createdBlob, fileName: "plot_data.csv" },
      ]);
    } finally {
      Object.defineProperty(globalThis, "Blob", {
        configurable: true,
        writable: true,
        value: originalBlob,
      });
    }
  });

  it("stops requesting chunks as soon as the UI consumer becomes inactive", async () => {
    let active = true;
    let chunkRequests = 0;
    const source = guardCsvDataChunkSource(
      async (callback) => {
        while (chunkRequests < 3) {
          chunkRequests++;
          const keepGoing = await callback([
            {
              label: "/foo.val",
              data: [
                {
                  x: chunkRequests,
                  y: chunkRequests,
                  receiveTime: { sec: chunkRequests, nsec: 0 },
                  value: chunkRequests,
                },
              ],
            },
          ]);
          if (keepGoing === false) {
            return false;
          }
        }
        return true;
      },
      () => active,
    );
    const callback = jest.fn(async () => {
      active = false;
    });

    await expect(source(callback, 10_000)).resolves.toBe(false);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(chunkRequests).toBe(1);
  });
});
