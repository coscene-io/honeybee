// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const delay = async (ms: number) => await new Promise((r) => setTimeout(r, ms));

export function bytes(x: number) {
  if (x < 1024) {return `${x} B`;}
  if (x < 1024 ** 2) {return `${(x / 1024).toFixed(1)} KB`;}
  if (x < 1024 ** 3) {return `${(x / 1024 ** 2).toFixed(1)} MB`;}
  return `${(x / 1024 ** 3).toFixed(2)} GB`;
}

export const iso = (s: string) => new Date(s).toLocaleString();