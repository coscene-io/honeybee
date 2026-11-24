// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import type { Property } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import dayjs, { type Dayjs } from "dayjs";

import { formatMomentFieldValue } from "@foxglove/studio-base/components/PlaybackControls/momentFieldValues";
import type {
  MomentCustomFieldFilter,
  MomentNumberOperator,
} from "@foxglove/studio-base/context/EventsContext";

export type NumberFilterDraft = {
  case: "number";
  operator: MomentNumberOperator | "between";
  first: string;
  second: string;
};

type DateTimeBound = { value: Dayjs | ReactNull; invalid?: boolean; incomplete?: boolean };

export type TimeFilterDraft = {
  case: "time";
  start: DateTimeBound;
  end: DateTimeBound;
};

export type MomentFilterDraft =
  | Exclude<MomentCustomFieldFilter, { case: "number" | "time" }>
  | { case: undefined }
  | NumberFilterDraft
  | TimeFilterDraft;

export function createFilterDraft(
  type: Property["type"]["case"],
  filter?: MomentCustomFieldFilter,
): MomentFilterDraft {
  switch (type) {
    case "number":
      if (filter?.case === "number") {
        return filter.operator === "between"
          ? {
              case: type,
              operator: filter.operator,
              first: String(filter.min),
              second: String(filter.max),
            }
          : { case: type, operator: filter.operator, first: String(filter.value), second: "" };
      }
      return { case: type, operator: "between", first: "", second: "" };
    case "time": {
      const time = filter?.case === "time" ? filter : undefined;
      return {
        case: type,
        start: { value: time?.start == undefined ? ReactNull : dayjs(time.start) },
        end: { value: time?.end == undefined ? ReactNull : dayjs(time.end) },
      };
    }
    default:
      return filter?.case === type && filter != undefined ? filter : { case: undefined };
  }
}

type DraftResult = {
  filter?: MomentCustomFieldFilter;
  error?:
    | "filterInvalidNumber"
    | "filterIncompleteNumberRange"
    | "filterReversedNumberRange"
    | "filterInvalidDate"
    | "filterReversedDateRange";
};

function parseDecimal(input: string): number | undefined {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input)) {
    return undefined;
  }
  const value = Number(input);
  return Number.isFinite(value) ? value : undefined;
}

export function resolveFilterDraft(draft: MomentFilterDraft, property: Property): DraftResult {
  switch (draft.case) {
    case "number": {
      const first = draft.first.trim();
      const second = draft.operator === "between" ? draft.second.trim() : "";
      if (first === "" && second === "") {
        return {};
      }
      const min = parseDecimal(first);
      const max = parseDecimal(second);
      if ((first !== "" && min == undefined) || (second !== "" && max == undefined)) {
        return { error: "filterInvalidNumber" };
      }
      if (draft.operator !== "between") {
        return min == undefined
          ? {}
          : { filter: { case: "number", operator: draft.operator, value: min } };
      }
      if (min == undefined || max == undefined) {
        return { error: "filterIncompleteNumberRange" };
      }
      if (min > max) {
        return { error: "filterReversedNumberRange" };
      }
      return { filter: { case: "number", operator: "between", min, max } };
    }
    case "time": {
      const { start, end } = draft;
      if (
        start.invalid === true ||
        end.invalid === true ||
        start.incomplete === true ||
        end.incomplete === true ||
        start.value?.isValid() === false ||
        end.value?.isValid() === false
      ) {
        return { error: "filterInvalidDate" };
      }
      const startMs = start.value?.startOf("minute").valueOf();
      const endMs = end.value?.startOf("minute").valueOf();
      if (startMs != undefined && endMs != undefined && startMs > endMs) {
        return { error: "filterReversedDateRange" };
      }
      return startMs == undefined && endMs == undefined
        ? {}
        : { filter: { case: "time", start: startMs, end: endMs } };
    }
    case undefined:
      return {};
    default:
      return formatMomentFieldValue({ value: draft }, property) == undefined
        ? {}
        : { filter: draft };
  }
}
