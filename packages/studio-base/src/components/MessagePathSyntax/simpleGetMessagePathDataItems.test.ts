// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { parseMessagePath } from "@foxglove/message-path";
import { MessageEvent } from "@foxglove/studio";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";

import { simpleGetMessagePathDataItems } from "./simpleGetMessagePathDataItems";
import { fillInGlobalVariablesInPath } from "./useCachedGetMessagePathDataItems";

describe("simpleGetMessagePathDataItems", () => {
  it("returns root message if topic matches", () => {
    const message: MessageEvent = {
      topic: "/foo",
      receiveTime: { sec: 0, nsec: 0 },
      sizeInBytes: 0,
      schemaName: "datatype",
      message: { foo: 42 },
    };
    expect(simpleGetMessagePathDataItems(message, parseMessagePath("/foo")!)).toEqual([
      { foo: 42 },
    ]);
    expect(simpleGetMessagePathDataItems(message, parseMessagePath("/bar")!)).toEqual([]);
  });

  it("supports TypedArray messages", () => {
    const message: MessageEvent = {
      topic: "/foo",
      receiveTime: { sec: 0, nsec: 0 },
      sizeInBytes: 0,
      schemaName: "datatype",
      message: {
        bar: new Uint32Array([3, 4, 5]),
      },
    };
    expect(simpleGetMessagePathDataItems(message, parseMessagePath("/foo.bar")!)).toEqual([
      new Uint32Array([3, 4, 5]),
    ]);
    expect(simpleGetMessagePathDataItems(message, parseMessagePath("/foo.bar[0]")!)).toEqual([3]);
  });

  it("returns correct nested values", () => {
    const message: MessageEvent = {
      topic: "/foo",
      receiveTime: { sec: 0, nsec: 0 },
      sizeInBytes: 0,
      schemaName: "datatype",
      message: {
        foo: {
          bars: [
            { id: 1, name: "bar1" },
            { id: 1, name: "bar1-2" },
            { id: 2, name: "bar2" },
          ],
        },
      },
    };

    expect(
      simpleGetMessagePathDataItems(message, parseMessagePath("/foo.foo.bars[:]{id==1}")!),
    ).toEqual([
      { id: 1, name: "bar1" },
      { id: 1, name: "bar1-2" },
    ]);
    expect(
      simpleGetMessagePathDataItems(message, parseMessagePath("/foo.foo.bars[:]{id==1}.name")!),
    ).toEqual(["bar1", "bar1-2"]);
    expect(
      simpleGetMessagePathDataItems(message, parseMessagePath("/foo.foo.bars[:]{id==2}")!),
    ).toEqual([{ id: 2, name: "bar2" }]);
    expect(
      simpleGetMessagePathDataItems(message, parseMessagePath("/foo.foo.bars[:]{id==2}.name")!),
    ).toEqual(["bar2"]);
  });

  it("returns nothing for missing fields", () => {
    const message: MessageEvent = {
      topic: "/foo",
      receiveTime: { sec: 0, nsec: 0 },
      sizeInBytes: 0,
      schemaName: "datatype",
      message: { foo: 1 },
    };
    expect(simpleGetMessagePathDataItems(message, parseMessagePath("/foo.foo.baz.hello")!)).toEqual(
      [],
    );
  });

  it("throws for unsupported paths", () => {
    const message: MessageEvent = {
      topic: "/foo",
      receiveTime: { sec: 0, nsec: 0 },
      sizeInBytes: 0,
      schemaName: "datatype",
      message: {
        foo: {
          bars: [
            { id: 1, name: "bar1" },
            { id: 1, name: "bar1-2" },
            { id: 2, name: "bar2" },
          ],
        },
      },
    };

    expect(() =>
      simpleGetMessagePathDataItems(message, parseMessagePath("/foo.foo.bars[:]{id==$id}")!),
    ).toThrow("filterMatches only works on paths where global variables have been filled in");
    expect(() =>
      simpleGetMessagePathDataItems(message, parseMessagePath("/foo.foo.bars[$id]")!),
    ).toThrow("Variables in slices are not supported");
  });

  function msg(message: unknown): MessageEvent {
    return {
      topic: "/foo",
      receiveTime: { sec: 0, nsec: 0 },
      sizeInBytes: 0,
      schemaName: "datatype",
      message,
    };
  }

  it("applies function chains", () => {
    expect(simpleGetMessagePathDataItems(msg({ v: -3 }), parseMessagePath("/foo.v.@abs")!)).toEqual(
      [3],
    );
    expect(
      simpleGetMessagePathDataItems(msg({ v: { x: 3, y: 4 } }), parseMessagePath("/foo.v.@norm")!),
    ).toEqual([5]);
  });

  it("filters with > and negative index", () => {
    const payload = { items: [{ id: 1 }, { id: 2 }], arr: [10, 20, 30] };
    expect(
      simpleGetMessagePathDataItems(msg(payload), parseMessagePath("/foo.items[:]{id>1}.id")!),
    ).toEqual([2]);
    expect(simpleGetMessagePathDataItems(msg(payload), parseMessagePath("/foo.arr[-1]")!)).toEqual([
      30,
    ]);
    expect(simpleGetMessagePathDataItems(msg(payload), parseMessagePath("/foo.arr[-1:]")!)).toEqual(
      [30],
    );
    expect(
      simpleGetMessagePathDataItems(msg(payload), parseMessagePath("/foo.arr[1:-1]")!),
    ).toEqual([20, 30]);
  });

  it("compares identifier filters as strings without schema", () => {
    // simpleGet has no enum map — `{status==MOVING}` is a string compare (and loose ==).
    expect(
      simpleGetMessagePathDataItems(msg({ status: 1 }), parseMessagePath("/foo{status==MOVING}")!),
    ).toEqual([]);
    expect(
      simpleGetMessagePathDataItems(
        msg({ status: "MOVING" }),
        parseMessagePath("/foo{status==MOVING}")!,
      ),
    ).toEqual([{ status: "MOVING" }]);
  });

  it("clamps non-finite and out-of-range slice bounds instead of hanging", () => {
    const arr = [10, 20, 30];
    const parsed = parseMessagePath("/foo.arr[$i:]")!;
    const fromNegInf = fillInGlobalVariablesInPath(parsed, { i: Number.NEGATIVE_INFINITY });
    expect(simpleGetMessagePathDataItems(msg({ arr }), fromNegInf)).toEqual([10, 20, 30]);
    const fromPosInf = fillInGlobalVariablesInPath(parsed, { i: Number.POSITIVE_INFINITY });
    expect(simpleGetMessagePathDataItems(msg({ arr }), fromPosInf)).toEqual([]);
    expect(
      simpleGetMessagePathDataItems(
        msg({ arr }),
        parseMessagePath("/foo.arr[99999999999999999999]")!,
      ),
    ).toEqual([]);
    expect(
      simpleGetMessagePathDataItems(msg({ arr }), parseMessagePath("/foo.arr[-5:1]")!),
    ).toEqual([10, 20]);
  });

  it.each([
    ["[-4]", []],
    ["[-3]", [10]],
    ["[-1]", [30]],
    ["[3]", []],
    ["[-4:-4]", []],
    ["[-4:]", [10, 20, 30]],
    ["[:-4]", []],
    ["[$index]", []],
  ] as const)("preserves index and slice boundaries for %s", (slice, expected) => {
    const path = fillInGlobalVariablesInPath(parseMessagePath(`/foo.arr${slice}.@abs`)!, {
      index: -4,
    });
    for (const arr of [[-10, -20, -30], new Float64Array([-10, -20, -30])]) {
      expect(simpleGetMessagePathDataItems(msg({ arr }), path)).toEqual(expected);
    }
    expect(simpleGetMessagePathDataItems(msg({ arr: [] }), path)).toEqual([]);
  });

  it("drops items whose function chain cannot be applied", () => {
    expect(
      simpleGetMessagePathDataItems(msg({ v: 3 }), parseMessagePath("/foo.v.@derivative")!),
    ).toEqual([]);
    expect(
      simpleGetMessagePathDataItems(msg({ v: { x: 1 } }), parseMessagePath("/foo.v.@abs")!),
    ).toEqual([]);
  });
});

it("resolves nested enum identifiers using the message schema without changing quoted strings", () => {
  const datatypes: RosDatatypes = new Map([
    ["Root", { definitions: [{ name: "items", type: "Item", isComplex: true, isArray: true }] }],
    [
      "Item",
      {
        definitions: [
          { name: "state", type: "State", isComplex: true },
          { name: "value", type: "float64" },
        ],
      },
    ],
    [
      "State",
      {
        definitions: [
          { name: "MOVING", type: "uint8", isConstant: true, value: 1 },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  ]);
  const message: MessageEvent = {
    topic: "/t",
    schemaName: "Root",
    receiveTime: { sec: 0, nsec: 0 },
    sizeInBytes: 0,
    message: {
      items: [
        { state: { status: 1 }, value: 3 },
        { state: { status: 2 }, value: 4 },
      ],
    },
  };
  const path = parseMessagePath("/t.items[:]{state.status==MOVING}.value.@mul(2)")!;
  expect(simpleGetMessagePathDataItems(message, path, datatypes)).toEqual([6]);
  expect(
    simpleGetMessagePathDataItems(
      message,
      parseMessagePath('/t.items[:]{state.status=="MOVING"}.value')!,
      datatypes,
    ),
  ).toEqual([]);
  expect(
    simpleGetMessagePathDataItems(
      message,
      parseMessagePath("/t.items[:]{state.status!=MOVING}.value")!,
      datatypes,
    ),
  ).toEqual([4]);
  // Cached resolution is invalidated when the source schema changes, and never mutates the AST.
  const newDatatypes: RosDatatypes = new Map(datatypes);
  newDatatypes.set("State", {
    definitions: [
      { name: "MOVING", type: "uint8", isConstant: true, value: 2 },
      { name: "status", type: "uint8" },
    ],
  });
  expect(simpleGetMessagePathDataItems(message, path, newDatatypes)).toEqual([8]);
  expect(simpleGetMessagePathDataItems(message, path, datatypes)).toEqual([6]);
});
