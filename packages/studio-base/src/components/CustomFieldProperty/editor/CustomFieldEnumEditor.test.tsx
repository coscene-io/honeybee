/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { clone, create } from "@bufbuild/protobuf";
import { CustomFieldValueSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/common/custom_field_pb";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { CustomFieldEnumEditor } from "./CustomFieldEnumEditor";
import {
  CustomFieldValuesForm,
  type FormWithCustomFieldValues,
} from "../form/CustomFieldValuesForm";
import { convertCustomFieldValuesMapToArray } from "../utils/convertCustomFieldForm";

function makeValue({ multiple = false, selected = true } = {}) {
  return create(CustomFieldValueSchema, {
    property: {
      id: "creation-type",
      name: "Creation type",
      description: "Creation type",
      type: { case: "enums", value: { multiple, values: { auto: "Automatic", manual: "Manual" } } },
    },
    value: selected
      ? { case: "enums", value: multiple ? { ids: ["auto"] } : { id: "auto" } }
      : { case: undefined },
  });
}

it.each([false, true])(
  "clears a selected enum without mutating the source (multiple=%s)",
  (multiple) => {
    const original = makeValue({ multiple });
    const snapshot = clone(CustomFieldValueSchema, original);
    const onChange = jest.fn();
    function Editor() {
      const [value, setValue] = useState(original);
      return (
        <CustomFieldEnumEditor
          customFieldValue={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Editor />);
    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.click(screen.getByTitle("Clear"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const cleared = onChange.mock.calls[0]![0];
    expect(cleared.property).toEqual(original.property);
    expect(convertCustomFieldValuesMapToArray({ "creation-type": cleared })).toEqual([]);
    expect(original).toEqual(snapshot);
    expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("");
    fireEvent.blur(screen.getByRole("combobox"));
    expect(screen.getByRole<HTMLInputElement>("combobox").value).toBe("");
  },
);

it("blocks saving a required multi-select field after removing its final chip", async () => {
  const initial = makeValue({ multiple: true });
  initial.property!.required = true;
  const onSubmit = jest.fn();
  const onInvalid = jest.fn();
  function Form() {
    const form = useForm({ defaultValues: { customFieldValues: { "creation-type": initial } } });
    return (
      <form onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
        <CustomFieldValuesForm
          form={form as unknown as FormWithCustomFieldValues}
          properties={[initial.property!]}
        />
        <button type="submit">Save</button>
      </form>
    );
  }
  render(<Form />);
  fireEvent.click(screen.getByTestId("CancelIcon"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => {
    expect(onInvalid).toHaveBeenCalled();
  });
  expect(onSubmit).not.toHaveBeenCalled();
});

it("removes the final multi-select chip as an unset value", () => {
  const original = makeValue({ multiple: true });
  const onChange = jest.fn();
  render(<CustomFieldEnumEditor customFieldValue={original} onChange={onChange} />);
  fireEvent.click(screen.getByTestId("CancelIcon"));
  expect(
    convertCustomFieldValuesMapToArray({ "creation-type": onChange.mock.calls[0]![0] }),
  ).toEqual([]);
});

it.each([false, true])("selects an option after starting empty (multiple=%s)", (multiple) => {
  const original = makeValue({ multiple, selected: false });
  const onChange = jest.fn();
  function Editor() {
    const [value, setValue] = useState(original);
    return (
      <CustomFieldEnumEditor
        customFieldValue={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Editor />);
  fireEvent.mouseDown(screen.getByRole("combobox"));
  fireEvent.click(screen.getByRole("option", { name: "Manual" }));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      value: {
        case: "enums",
        value: expect.objectContaining(multiple ? { ids: ["manual"] } : { id: "manual" }),
      },
    }),
  );
  expect(original.value.case).toBeUndefined();
});

it.each([false, true])(
  "preserves the no-clear control for required fields (multiple=%s)",
  (multiple) => {
    render(
      <CustomFieldEnumEditor
        allowClear={false}
        customFieldValue={makeValue({ multiple })}
        onChange={jest.fn()}
      />,
    );
    expect(screen.queryByTitle("Clear")).toBeNull();
  },
);
