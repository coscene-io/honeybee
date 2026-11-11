// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import protobufjs from "protobufjs";

const schema = `syntax = "proto3";
message Values {
  int64 signed = 1;
  uint64 unsigned = 2;
  sint64 zigzag = 3;
  fixed64 fixed = 4;
  sfixed64 signedFixed = 5;
  map<int64, int64> byNumber = 6;
  map<string, int64> byName = 7;
}`;

it("preserves exact signed/unsigned 64-bit values, defaults and decimal map keys", () => {
  const type = protobufjs.parse(schema).root.lookupType("Values");
  const values = {
    signed: -(2n ** 63n),
    unsigned: 2n ** 64n - 1n,
    zigzag: -(2n ** 53n) - 1n,
    fixed: 2n ** 64n - 1n,
    signedFixed: -(2n ** 63n),
    byNumber: { "-9223372036854775808": 2n ** 63n - 1n },
  };
  // The upstream writer accepts strings/Long, while Honeybee's reader returns bigint.
  const wireValues = {
    ...Object.fromEntries(
      Object.entries(values).flatMap(([key, value]) =>
        typeof value === "bigint" ? [[key, value.toString()]] : [],
      ),
    ),
    byNumber: { "-9223372036854775808": "9223372036854775807" },
  };
  const decoded = type.toObject(type.decode(type.encode(wireValues).finish()), { defaults: true });
  expect(decoded).toEqual({ ...values, byName: {} });
  expect(type.toObject(type.decode(new Uint8Array()), { defaults: true })).toEqual({
    signed: 0n,
    unsigned: 0n,
    zigzag: 0n,
    fixed: 0n,
    signedFixed: 0n,
    byNumber: {},
    byName: {},
  });
});

it("retains the upstream protection for special map property names", () => {
  const type = protobufjs.parse(schema).root.lookupType("Values");
  const byName = Object.fromEntries([["__proto__", "99"]]);
  const decoded = type.toObject(type.decode(type.encode({ byName }).finish()));
  expect(Object.hasOwn(decoded.byName as object, "__proto__")).toBe(true);
  expect(decoded.byName.__proto__).toBe(99n);
  expect(Object.getPrototypeOf(decoded.byName)).toBe(Object.prototype);
});

it.each<[string, bigint]>([
  ["int64", -(2n ** 63n)],
  ["uint64", 2n ** 64n - 1n],
  ["sint64", -(2n ** 53n) - 1n],
  ["fixed64", 2n ** 64n - 1n],
  ["sfixed64", -(2n ** 63n)],
])("preserves proto3 optional %s presence and exact values", (scalar, boundary) => {
  const root = protobufjs.parse(`syntax = "proto3";
    message Optional { optional ${scalar} value = 1; }`).root;
  root.resolveAll();
  const type = root.lookupType("Optional");
  const options = { defaults: true, oneofs: true };
  const absent = type.decode(new Uint8Array());
  expect(Reflect.get(absent, "value")).toBeNull();
  expect(type.toObject(absent, options)).toEqual({});

  for (const value of [0n, boundary]) {
    const wire = type.encode({ value: value.toString() }).finish();
    expect(type.toObject(type.decode(wire), options)).toEqual({ value, _value: "value" });
  }
});

it("preserves a nullable 64-bit default in reflection JSON without a oneof", () => {
  const type = protobufjs.Type.fromJSON("Optional", {
    fields: { value: { type: "int64", id: 1, options: { proto3_optional: true } } },
  });
  const object = type.toObject(type.decode(new Uint8Array()), { defaults: true });
  expect(object).toHaveProperty("value");
  expect(object.value).toBeNull();
});
