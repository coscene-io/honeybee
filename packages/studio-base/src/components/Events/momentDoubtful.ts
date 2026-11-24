// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export const DOUBTFUL_MOMENT_COLOR = "#FF4D4F";
export const DOUBTFUL_FIELD_KEY = "_doubtful";
export function isMomentDoubtful(fields: Readonly<Record<string, string>>): boolean {
  return fields[DOUBTFUL_FIELD_KEY] === "true";
}

export function buildMomentCustomizedFields({
  fields,
  isDoubtful,
}: {
  fields: Readonly<Record<string, string>>;
  isDoubtful: boolean;
}): Record<string, string> {
  const result = { ...fields };
  delete result[DOUBTFUL_FIELD_KEY];
  if (isDoubtful) {
    result[DOUBTFUL_FIELD_KEY] = "true";
  }
  return result;
}
