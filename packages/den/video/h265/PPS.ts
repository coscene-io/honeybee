// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Bitstream } from "../h26x/Bitstream";

const NALU_TYPE_PPS = 34;

export class PPS {
  public nal_unit_type: number | undefined;
  public nuh_layer_id: number | undefined;
  public nuh_temporal_id_plus1: number | undefined;

  public constructor(data: Uint8Array) {
    const bitstream = new Bitstream(data);
    const forbidden_zero_bit = bitstream.u_1();
    if (forbidden_zero_bit !== 0) {
      throw new Error("NALU error: invalid NALU header");
    }
    this.nal_unit_type = bitstream.u(6);
    this.nuh_layer_id = bitstream.u(6);
    this.nuh_temporal_id_plus1 = bitstream.u(3);
    if (this.nal_unit_type !== NALU_TYPE_PPS) {
      throw new Error("PPS error: not PPS");
    }
  }
}
