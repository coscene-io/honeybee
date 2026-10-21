/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import {
  User,
  UserSchema,
} from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/resources/user_pb";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import CoSceneConsoleApiContext from "@foxglove/studio-base/context/CoSceneConsoleApiContext";

import { UserSelect } from "./UserSelect";

const alice = create(UserSchema, { name: "users/alice", nickname: "Alice", active: true });
const inactive = create(UserSchema, { name: "users/inactive", nickname: "Inactive" });
const listUsers = jest.fn(async (): Promise<User[]> => [alice, inactive]);

function renderSelect({
  multiple = false,
  initialValue = multiple ? [alice.name] : alice.name,
  allowClear,
  disabled,
}: {
  multiple?: boolean;
  initialValue?: string | string[];
  allowClear?: boolean;
  disabled?: boolean;
} = {}) {
  const onChange = jest.fn();
  const onClear = jest.fn();
  const api = { listOrganizationUsers: listUsers } as unknown as NonNullable<
    React.ContextType<typeof CoSceneConsoleApiContext>
  >;
  function Select() {
    const [value, setValue] = useState(initialValue);
    return multiple ? (
      <UserSelect
        multiple
        value={value}
        allowClear={allowClear}
        disabled={disabled}
        onChange={(users) => {
          onChange(users);
          setValue(users.map((user) => user.name));
        }}
      />
    ) : (
      <UserSelect
        value={value}
        allowClear={allowClear}
        disabled={disabled}
        onChange={(user) => {
          onChange(user);
          setValue(user.name);
        }}
        onClear={() => {
          onClear();
          setValue("");
        }}
      />
    );
  }
  render(
    <CoSceneConsoleApiContext.Provider value={api}>
      <Select />
    </CoSceneConsoleApiContext.Provider>,
  );
  return { onChange, onClear };
}

beforeEach(() => {
  listUsers.mockReset();
  listUsers.mockResolvedValue([alice, inactive]);
});

it.each([false, true])(
  "keeps pending selections visible and clearable (multiple=%s)",
  (multiple) => {
    listUsers.mockReturnValue(new Promise(() => {}));
    const { onChange, onClear } = renderSelect({ multiple });
    if (multiple) {
      expect(screen.getByText(alice.name)).toBeDefined();
    } else {
      expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe(alice.name);
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("Clear"));
    expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("");
    if (multiple) {
      expect(screen.queryByText(alice.name)).toBeNull();
      expect(onChange).toHaveBeenCalledWith([]);
      expect(onClear).not.toHaveBeenCalled();
    } else {
      expect(onChange).not.toHaveBeenCalled();
      expect(onClear).toHaveBeenCalledTimes(1);
    }
  },
);

it.each([false, true])(
  "keeps failed-directory selections visible and clearable (multiple=%s)",
  async (multiple) => {
    listUsers.mockRejectedValue(new Error("directory unavailable"));
    const { onChange, onClear } = renderSelect({ multiple });
    await act(async () => {});
    expect(listUsers).toHaveBeenCalledTimes(1);
    if (multiple) {
      expect(screen.getByText(alice.name)).toBeDefined();
      fireEvent.click(screen.getByTestId("CancelIcon"));
      expect(onChange).toHaveBeenCalledWith([]);
      expect(onClear).not.toHaveBeenCalled();
      expect(screen.queryByText(alice.name)).toBeNull();
    } else {
      expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe(alice.name);
      fireEvent.click(screen.getByTitle("Clear"));
      expect(onChange).not.toHaveBeenCalled();
      expect(onClear).toHaveBeenCalledTimes(1);
      expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("");
    }
  },
);

it.each([false, true])(
  "replaces the fallback with the directory nickname without changing selections (multiple=%s)",
  async (multiple) => {
    let resolve: (users: User[]) => void = () => {};
    listUsers.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { onChange, onClear } = renderSelect({ multiple });
    await act(async () => {
      resolve([alice]);
    });
    if (multiple) {
      expect(screen.getByText("Alice")).toBeDefined();
      expect(screen.queryByText(alice.name)).toBeNull();
    } else {
      expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("Alice");
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    expect(listUsers).toHaveBeenCalledTimes(1);
  },
);

it("keeps inactive and unknown selections visible while offering only active users", async () => {
  const { onChange } = renderSelect({
    multiple: true,
    initialValue: [inactive.name, "users/unknown"],
  });
  expect(await screen.findByText("Inactive")).toBeDefined();
  expect(screen.getByText("users/unknown")).toBeDefined();
  fireEvent.mouseDown(screen.getByRole("combobox"));
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Alice"]);
  fireEvent.click(screen.getByRole("option", { name: "Alice" }));
  expect(onChange).toHaveBeenCalledWith([
    inactive,
    expect.objectContaining({ name: "users/unknown" }),
    alice,
  ]);
});

it("uses a known user's name when the nickname is empty and preserves single selection callbacks", async () => {
  const unnamed = create(UserSchema, { name: "users/unnamed", nickname: "", active: true });
  listUsers.mockResolvedValue([unnamed]);
  const { onChange, onClear } = renderSelect({ initialValue: "" });
  await waitFor(() => {
    expect(listUsers).toHaveBeenCalledTimes(1);
  });
  fireEvent.mouseDown(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name: unnamed.name }));
  expect(onChange).toHaveBeenCalledWith(unnamed);
  expect(onClear).not.toHaveBeenCalled();
  expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe(unnamed.name);
});

it.each([false, true])("ignores empty user names (multiple=%s)", (multiple) => {
  listUsers.mockReturnValue(new Promise(() => {}));
  renderSelect({ multiple, initialValue: multiple ? ["", "users/"] : "users/" });
  expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("");
  expect(screen.queryByTitle("Clear")).toBeNull();
  expect(screen.queryByText("users/")).toBeNull();
});

it.each([false, true])("preserves allowClear=false (multiple=%s)", (multiple) => {
  listUsers.mockReturnValue(new Promise(() => {}));
  renderSelect({ multiple, allowClear: false });
  expect(screen.queryByTitle("Clear")).toBeNull();
});

it.each([false, true])("preserves disabled selections (multiple=%s)", (multiple) => {
  listUsers.mockReturnValue(new Promise(() => {}));
  const { onChange, onClear } = renderSelect({ multiple, disabled: true });
  expect(screen.getByRole<HTMLInputElement>("combobox").disabled).toBe(true);
  expect(screen.queryByTitle("Clear")).toBeNull();
  if (multiple) {
    expect(screen.getByText(alice.name)).toBeDefined();
    expect(
      window.getComputedStyle(screen.getByRole("button", { name: alice.name })).pointerEvents,
    ).toBe("none");
  } else {
    expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe(alice.name);
  }
  expect(onChange).not.toHaveBeenCalled();
  expect(onClear).not.toHaveBeenCalled();
});
