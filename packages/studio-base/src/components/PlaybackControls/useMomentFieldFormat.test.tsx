/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { UserSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/user_pb";
import { CustomFieldValueSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import {
  CustomFieldSchemaSchema,
  CustomFieldTrackRuleSchema,
  PropertySchema,
} from "@foxglove/studio-base/services/api/moment-custom-field/generated/common/custom_field_pb";
import { makeMomentFixture } from "@foxglove/studio-base/test/fixtures/moments";

import { formatMomentFieldValue } from "./momentFieldValues";
import { useMomentFieldFormat } from "./useMomentFieldFormat";

jest.mock("@foxglove/studio-base/context/CoSceneConsoleApiContext", () => ({
  useConsoleApi: jest.fn(),
}));

const project = "warehouses/w/projects/p";
const userProperty = create(PropertySchema, {
  id: "assignees",
  type: { case: "user", value: { multiple: true } },
});

function schema() {
  return create(CustomFieldSchemaSchema, {
    properties: [userProperty],
    trackRules: [{ propertyId: userProperty.id }],
  });
}

function event(ids: string[], owner = project, propertyId = userProperty.id) {
  const entry = makeMomentFixture(1)[0]!;
  entry.event.name = `${owner}/events/one`;
  entry.event.record = `${owner}/records/one`;
  entry.event.customFieldValues = [
    create(CustomFieldValueSchema, {
      property: { id: propertyId },
      value: { case: "user", value: { ids } },
    }),
  ];
  return entry;
}

function user(name: string, nickname: string) {
  return create(UserSchema, { name, nickname });
}

describe("useMomentFieldFormat", () => {
  const batchGetUsers = jest.fn();

  beforeEach(() => {
    batchGetUsers.mockReset().mockResolvedValue({ users: [] });
    jest
      .mocked(useConsoleApi)
      .mockReturnValue({ batchGetUsers } as unknown as ReturnType<typeof useConsoleApi>);
  });

  it("deduplicates and normalizes selected users without refetching playback snapshots", async () => {
    batchGetUsers.mockResolvedValue({ users: [user("users/a", "Alice"), user("users/b", "Bob")] });
    const current = schema();
    current.trackRules.push(
      current.trackRules[0]!,
      create(CustomFieldTrackRuleSchema, { propertyId: "removed" }),
    );
    const entries = [event(["a", "users/a", "b", ""]), event(["b", "a"])];
    const { result, rerender } = renderHook(
      ({ events }) => useMomentFieldFormat(events, current, project),
      { initialProps: { events: entries } },
    );
    await waitFor(() => {
      expect(result.current.userNames.get("users/a")).toBe("Alice");
    });
    expect(batchGetUsers).toHaveBeenCalledTimes(1);
    expect(batchGetUsers).toHaveBeenCalledWith(["users/a", "users/b"]);
    const previousOptions = result.current;
    rerender({ events: entries.map((entry) => ({ ...entry, startPosition: 0.25 })) });
    expect(result.current).toBe(previousOptions);
    expect(batchGetUsers).toHaveBeenCalledTimes(1);
  });

  it("bounds requests at 100 users and retains successful batches after a failure", async () => {
    batchGetUsers
      .mockResolvedValueOnce({ users: [user("users/u000", "First")] })
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce({ users: [user("users/u200", "Last")] });
    const ids = Array.from({ length: 205 }, (_, index) => `u${String(index).padStart(3, "0")}`);
    const { result } = renderHook(() => useMomentFieldFormat([event(ids)], schema(), project));
    await waitFor(() => {
      expect(result.current.userNames.get("users/u200")).toBe("Last");
    });
    expect(batchGetUsers.mock.calls.map(([names]: [string[]]) => names.length)).toEqual([
      100, 100, 5,
    ]);
    expect(result.current.userNames.get("users/u000")).toBe("First");
    expect(result.current.userNames.has("users/u100")).toBe(false);
  });

  it("skips absent, grouped, invalid, unselected and foreign user fields", () => {
    const current = schema();
    current.groupingRules = [
      {
        ...current.trackRules[0]!,
        $typeName: "coscene.dataplatform.v1alpha3.common.CustomFieldGroupingRule",
      },
    ];
    const initialProps: {
      fields: ReturnType<typeof schema>;
      entries: ReturnType<typeof event>[];
      owner: string | undefined;
    } = { fields: current, entries: [event(["a"])], owner: project };
    const { rerender } = renderHook(
      ({ fields, entries, owner }) => useMomentFieldFormat(entries, fields, owner),
      { initialProps },
    );
    rerender({ fields: schema(), entries: [event(["a"], `${project}-other`)], owner: project });
    const conflicting = event(["a"], `${project}-other`);
    conflicting.event.record = `${project}/records/one`;
    rerender({ fields: schema(), entries: [conflicting], owner: project });
    rerender({ fields: schema(), entries: [event(["a"], project, "unselected")], owner: project });
    rerender({ fields: schema(), entries: [event([])], owner: project });
    rerender({ fields: schema(), entries: [event(["a"])], owner: undefined });
    expect(batchGetUsers).not.toHaveBeenCalled();
  });

  it("immediately clears removed selections and ignores a stale project response", async () => {
    let resolvePrevious: (response: { users: ReturnType<typeof user>[] }) => void = () => {};
    batchGetUsers
      .mockImplementationOnce(
        async () =>
          await new Promise((resolve) => {
            resolvePrevious = resolve;
          }),
      )
      .mockResolvedValueOnce({ users: [user("users/b", "Bob")] });
    const { result, rerender } = renderHook(
      ({ entries, fields, owner }) => useMomentFieldFormat(entries, fields, owner),
      { initialProps: { entries: [event(["a"])], fields: schema(), owner: project } },
    );
    const nextProject = "warehouses/w/projects/next";
    rerender({ entries: [event(["b"], nextProject)], fields: schema(), owner: nextProject });
    await waitFor(() => {
      expect(result.current.userNames.get("users/b")).toBe("Bob");
    });
    await act(async () => {
      resolvePrevious({ users: [user("users/a", "Alice")] });
    });
    expect([...result.current.userNames]).toEqual([["users/b", "Bob"]]);
    const cleared = schema();
    cleared.trackRules = [];
    rerender({ entries: [event(["b"], nextProject)], fields: cleared, owner: nextProject });
    expect(result.current.userNames.size).toBe(0);
  });

  it("uses stored IDs when lookup fails", async () => {
    batchGetUsers.mockRejectedValueOnce(new Error("permission denied"));
    const entry = event(["a", "users/b"]);
    const { result } = renderHook(() => useMomentFieldFormat([entry], schema(), project));
    await act(async () => {});
    expect(
      formatMomentFieldValue(entry.event.customFieldValues[0]!, userProperty, result.current),
    ).toBe("a, users/b");
    expect(batchGetUsers).toHaveBeenCalledTimes(1);
  });

  it("retains IDs for missing and unnamed users and ignores unexpected response users", async () => {
    batchGetUsers.mockResolvedValue({
      users: [user("users/a", "Alice"), user("users/b", " "), user("users/unrequested", "Other")],
    });
    const entry = event(["a", "b", "missing"]);
    entry.event.name = "events/legacy";
    const { result } = renderHook(() => useMomentFieldFormat([entry], schema(), project));
    await waitFor(() => {
      expect(result.current.userNames.get("users/a")).toBe("Alice");
    });
    expect(
      formatMomentFieldValue(entry.event.customFieldValues[0]!, userProperty, result.current),
    ).toBe("Alice, b, missing");
    expect(result.current.userNames.has("users/unrequested")).toBe(false);
  });

  it("formats timestamps as absolute custom field metadata", () => {
    const timestamp = timestampFromDate(new Date(2026, 9, 21, 12, 34, 56));
    const { result, rerender } = renderHook(({ entries }) => useMomentFieldFormat(entries), {
      initialProps: { entries: [] as ReturnType<typeof event>[] },
    });
    expect(result.current.formatTime(timestamp)).toBe("2026-10-21 12:34:56");
    const previousFormatter = result.current.formatTime;
    rerender({ entries: [event([])] });
    expect(result.current.formatTime).toBe(previousFormatter);
    expect(result.current.formatTime(timestamp)).toBe("2026-10-21 12:34:56");
  });
});
