// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { inspectVideoPacket } from "./inspectVideoPacket";

// Encoded 64×64 red frames (libx264/libx265, bframes=2). Types independently verified
// with ffprobe -show_frames in packet position order. Encoder identification SEI removed.
const samples = [
  {
    format: "h264",
    key: "00000109100000016764000aacd94426c044000003000400000300283c48965800000168ebe3cb22c00000016588840012fffee8c9fccb2b2fe3d437b34629b349a71cc23d1d23feb907664bc821c159078b89c1",
    predicted: "0000010930000001419a236c411ffeb52bef",
    b: "0000010950000001419e4178821f02c7",
  },
  {
    format: "h265",
    key: "00000146011000000140010c01ffff01600000030090000003000003001e95900900000142010101600000030090000003000003001ea020810596564924caf0168080000003008000000302840000014401c172b422400000012801af26fa5585fffc939ffd6a121e216529f9e0",
    predicted: "0000014601300000010201d0195f843191f902",
    b: "0000014601500000010201e04497e199bea0",
  },
];
it.each(samples)(
  "classifies actual $format slices independently of SPS reorder capability",
  (sample) => {
    const pps = new Map<number, number>();
    const read = (hex: string) => inspectVideoPacket(sample.format, Buffer.from(hex, "hex"), pps);
    expect(read(sample.key)).toMatchObject({
      key: true,
      bFrame: false,
      missing: [],
      reorder: true,
    });
    expect(read(sample.predicted)).toMatchObject({ key: false, bFrame: false });
    expect(read(sample.b)).toMatchObject({ key: false, bFrame: true });
  },
);
it("reports missing context and incomplete inputs", () => {
  const pps = new Map<number, number>();
  expect(inspectVideoPacket("h265", Buffer.from(samples[1]!.b, "hex"), pps).bFrame).toBeUndefined();
  expect(inspectVideoPacket("h264", [], pps).problem).toBe("empty");
  expect(inspectVideoPacket("h265", [12, 34], pps).problem).toBe("annexB");
  expect(inspectVideoPacket("h264", [0, 0, 1, 0x41], pps).problem).toBe("malformed");
  expect(inspectVideoPacket("h264", [0, 0, 1, 0x65, 0xb0], pps).missing).toEqual(["SPS", "PPS"]);
  const withoutPps = samples[0]!.key.replace("00000168ebe3cb22c0", "");
  expect(inspectVideoPacket("h264", Buffer.from(withoutPps, "hex"), pps).missing).toEqual(["PPS"]);
});

it("rejects a trailing start code but allows Annex B trailing zero bytes", () => {
  const read = (suffix: string) =>
    inspectVideoPacket("h264", Buffer.from(samples[0]!.key + suffix, "hex"), new Map());
  expect(read("0000").problem).toBeUndefined();
  expect(read("000001").problem).toBe("malformed");
  expect(read("00000001").problem).toBe("malformed");
});
