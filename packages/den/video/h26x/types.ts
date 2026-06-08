// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export interface AnnexBCodec {
  IsAnnexB(data: Uint8Array): boolean;
  AnnexBBoxSize(data: Uint8Array): number | undefined;
  IsKeyframe(data: Uint8Array): boolean;
  GetFirstNALUOfType(data: Uint8Array, naluType: number): Uint8Array | undefined;
  ParseDecoderConfig(data: Uint8Array): VideoDecoderConfig | undefined;
}

export interface H26xCodec extends AnnexBCodec {
  GetNaluTypeFromHeader(headerByte: number): number;
}
