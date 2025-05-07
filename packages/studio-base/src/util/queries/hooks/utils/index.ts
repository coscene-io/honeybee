// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { REACT_QUERY_DEFAULT_CONFIG } from "@coscene-io/coscene/queries/constants";
import { QueryClient } from "@tanstack/react-query";

export * from "./queryFields";

export const queryClient = new QueryClient({
  defaultOptions: REACT_QUERY_DEFAULT_CONFIG,
});

export function convertSearchParamsToObject(searchParams: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    result[key] = value;
  }

  return result;
}

export function camelToSnake(str: string): string {
  return str
    .replace(/^[A-Z]/g, (letter) => letter.toLowerCase())
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
