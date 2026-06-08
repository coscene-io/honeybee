// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { parseChannel } from "@foxglove/mcap-support";
import { MessageDefinition } from "@foxglove/message-definition";
import { ImageAnnotations } from "@foxglove/schemas/jsonschema";
import { getMessagePathSearchItems } from "@foxglove/studio-base/components/TopicList/getMessagePathSearchItems";
import { Topic } from "@foxglove/studio-base/players/types";

describe("getMessagePathSearchItems", () => {
  it("returns items with correct paths and types", () => {
    const schemasByName: ReadonlyMap<string, MessageDefinition> = new Map([
      [
        "Foo",
        {
          name: "Foo",
          definitions: [
            { name: "const", type: "float64", isConstant: true, value: 1 },
            { name: "num", type: "float64" },
            { name: "num_array", type: "float64", isArray: true },
            { name: "bar", type: "Bar", isComplex: true },
            { name: "bar_array", type: "Bar", isComplex: true, isArray: true },
          ],
        },
      ],
      [
        "Bar",
        {
          name: "Bar",
          definitions: [
            { name: "const", type: "float64", isConstant: true, value: 1 },
            { name: "str", type: "string" },
            { name: "str_array", type: "string", isArray: true },
          ],
        },
      ],
    ]);
    const topics: Topic[] = [
      { name: "foo1", schemaName: "Foo" },
      { name: "foo2", schemaName: "Foo" },
      { name: "bar", schemaName: "Bar" },
    ];

    expect(getMessagePathSearchItems(topics, schemasByName).items).toEqual([
      {
        topic: { name: "foo1", schemaName: "Foo" },
        fullPath: "foo1.num",
        suffix: { pathSuffix: ".num", type: "float64", isLeaf: true },
        offset: 4,
      },
      {
        topic: { name: "foo2", schemaName: "Foo" },
        fullPath: "foo2.num",
        suffix: { pathSuffix: ".num", type: "float64", isLeaf: true },
        offset: 4,
      },
      {
        topic: { name: "foo1", schemaName: "Foo" },
        fullPath: "foo1.num_array",
        suffix: { pathSuffix: ".num_array", type: "float64[]", isLeaf: true },
        offset: 4,
      },
      {
        topic: { name: "foo2", schemaName: "Foo" },
        fullPath: "foo2.num_array",
        suffix: { pathSuffix: ".num_array", type: "float64[]", isLeaf: true },
        offset: 4,
      },
      {
        topic: { name: "foo1", schemaName: "Foo" },
        fullPath: "foo1.bar",
        suffix: { pathSuffix: ".bar", type: "Bar", isLeaf: false },
        offset: 4,
      },
      {
        topic: { name: "foo2", schemaName: "Foo" },
        fullPath: "foo2.bar",
        suffix: { pathSuffix: ".bar", type: "Bar", isLeaf: false },
        offset: 4,
      },
      {
        topic: { name: "foo1", schemaName: "Foo" },
        fullPath: "foo1.bar.str",
        suffix: { pathSuffix: ".bar.str", type: "string", isLeaf: true },
        offset: 4,
      },
      {
        topic: { name: "foo2", schemaName: "Foo" },
        fullPath: "foo2.bar.str",
        suffix: { pathSuffix: ".bar.str", type: "string", isLeaf: true },
        offset: 4,
      },
      {
        topic: { name: "foo1", schemaName: "Foo" },
        fullPath: "foo1.bar.str_array",
        suffix: { pathSuffix: ".bar.str_array", type: "string[]", isLeaf: true },
        offset: 4,
      },
      {
        topic: { name: "foo2", schemaName: "Foo" },
        fullPath: "foo2.bar.str_array",
        suffix: { pathSuffix: ".bar.str_array", type: "string[]", isLeaf: true },
        offset: 4,
      },
      {
        topic: { name: "foo1", schemaName: "Foo" },
        fullPath: "foo1.bar_array",
        suffix: { pathSuffix: ".bar_array", type: "Bar[]", isLeaf: false },
        offset: 4,
      },
      {
        topic: { name: "foo2", schemaName: "Foo" },
        fullPath: "foo2.bar_array",
        suffix: { pathSuffix: ".bar_array", type: "Bar[]", isLeaf: false },
        offset: 4,
      },
      {
        topic: { name: "foo1", schemaName: "Foo" },
        fullPath: "foo1.bar_array[:].str",
        suffix: { pathSuffix: ".bar_array[:].str", type: "string", isLeaf: true },
        offset: 4,
      },
      {
        topic: { name: "foo2", schemaName: "Foo" },
        fullPath: "foo2.bar_array[:].str",
        suffix: { pathSuffix: ".bar_array[:].str", type: "string", isLeaf: true },
        offset: 4,
      },
      {
        topic: { name: "foo1", schemaName: "Foo" },
        fullPath: "foo1.bar_array[:].str_array",
        suffix: { pathSuffix: ".bar_array[:].str_array", type: "string[]", isLeaf: true },
        offset: 4,
      },
      {
        topic: { name: "foo2", schemaName: "Foo" },
        fullPath: "foo2.bar_array[:].str_array",
        suffix: { pathSuffix: ".bar_array[:].str_array", type: "string[]", isLeaf: true },
        offset: 4,
      },
      {
        topic: { name: "bar", schemaName: "Bar" },
        fullPath: "bar.str",
        suffix: { pathSuffix: ".str", type: "string", isLeaf: true },
        offset: 3,
      },
      {
        topic: { name: "bar", schemaName: "Bar" },
        fullPath: "bar.str_array",
        suffix: { pathSuffix: ".str_array", type: "string[]", isLeaf: true },
        offset: 3,
      },
    ]);
  });

  it("supports cyclic types at root and non-root levels", () => {
    const schemasByName: ReadonlyMap<string, MessageDefinition> = new Map([
      [
        "Foo",
        {
          name: "Foo",
          definitions: [
            { name: "self", type: "Foo", isComplex: true },
            { name: "bar", type: "Bar", isComplex: true },
          ],
        },
      ],
      [
        "Bar",
        {
          name: "Bar",
          definitions: [{ name: "foo", type: "Foo", isComplex: true }],
        },
      ],
    ]);

    expect(
      getMessagePathSearchItems([{ name: "foo", schemaName: "Foo" }], schemasByName).items,
    ).toEqual([
      {
        topic: { name: "foo", schemaName: "Foo" },
        suffix: { pathSuffix: ".self", type: "Foo", isLeaf: false },
        fullPath: "foo.self",
        offset: 3,
      },
      {
        topic: { name: "foo", schemaName: "Foo" },
        suffix: { pathSuffix: ".bar", type: "Bar", isLeaf: false },
        fullPath: "foo.bar",
        offset: 3,
      },
      {
        topic: { name: "foo", schemaName: "Foo" },
        suffix: { pathSuffix: ".bar.foo", type: "Foo", isLeaf: false },
        fullPath: "foo.bar.foo",
        offset: 3,
      },
    ]);

    expect(
      getMessagePathSearchItems([{ name: "bar", schemaName: "Bar" }], schemasByName).items,
    ).toEqual([
      {
        topic: { name: "bar", schemaName: "Bar" },
        suffix: { pathSuffix: ".foo", type: "Foo", isLeaf: false },
        fullPath: "bar.foo",
        offset: 3,
      },
      {
        topic: { name: "bar", schemaName: "Bar" },
        suffix: { pathSuffix: ".foo.self", type: "Foo", isLeaf: false },
        fullPath: "bar.foo.self",
        offset: 3,
      },
      {
        topic: { name: "bar", schemaName: "Bar" },
        suffix: { pathSuffix: ".foo.bar", type: "Bar", isLeaf: false },
        fullPath: "bar.foo.bar",
        offset: 3,
      },
    ]);
  });

  it("includes quoted topic name length in offset", () => {
    const schemasByName: ReadonlyMap<string, MessageDefinition> = new Map([
      [
        "Foo",
        {
          name: "Foo",
          definitions: [{ name: "num", type: "float64" }],
        },
      ],
    ]);

    expect(
      getMessagePathSearchItems([{ name: "foo with spaces", schemaName: "Foo" }], schemasByName)
        .items,
    ).toEqual([
      {
        topic: { name: "foo with spaces", schemaName: "Foo" },
        suffix: { pathSuffix: ".num", type: "float64", isLeaf: true },
        fullPath: `"foo with spaces".num`,
        offset: `"foo with spaces"`.length,
      },
    ]);
  });

  it("works for foxglove.ImageAnnotations", () => {
    const { datatypes } = parseChannel({
      messageEncoding: "json",
      schema: {
        name: "foxglove.ImageAnnotations",
        encoding: "jsonschema",
        data: new TextEncoder().encode(JSON.stringify(ImageAnnotations)),
      },
    });

    expect(
      getMessagePathSearchItems(
        [{ name: "annotations", schemaName: "foxglove.ImageAnnotations" }],
        datatypes,
      ).items,
    ).toMatchSnapshot();
  });
});
