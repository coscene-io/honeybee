// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { validateParameterSetsForCodec } from "./Mp4Demuxer";

describe("validateParameterSetsForCodec", () => {
  it.each(["avc3.64001f", "hev1.1.6.L93.B0"])(
    "allows %s to carry parameter sets in media samples",
    (codec) => {
      expect(() => {
        validateParameterSetsForCodec(codec, []);
      }).not.toThrow();
    },
  );

  it.each(["avc1.64001f", "hvc1.1.6.L93.B0"])(
    "requires out-of-band parameter sets for %s",
    (codec) => {
      expect(() => {
        validateParameterSetsForCodec(codec, []);
      }).toThrow("no out-of-band codec parameter sets");
    },
  );
});
