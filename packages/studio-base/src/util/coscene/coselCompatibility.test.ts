// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { BinaryOperator, CosQuery, SerializeOption } from "./cosel";

it("restores and edits filters serialized by Cosel 24 without dropping unrelated conditions", () => {
  // Captured from the previous 24.14.0 runtime, using synthetic user/filter values.
  const legacy =
    '{"assignee =":"assignee=\\"user/example\\"","state =":"state=[\\"PENDING\\",\\"PROCESSING\\"]"}';
  const query = CosQuery.Companion.deserialize(legacy);
  expect(query.getField("assignee", BinaryOperator.EQ)).toBe("user/example");
  expect(query.getListField("state", BinaryOperator.EQ)).toEqual(["PENDING", "PROCESSING"]);
  expect(query.toQueryString(new SerializeOption(false))).toBe(
    '(assignee="user/example" AND state=["PENDING","PROCESSING"])',
  );
  query.setField("assignee", [BinaryOperator.EQ], ["user/changed"]);
  const restored = CosQuery.Companion.deserialize(query.serialize());
  expect(restored.getField("assignee", BinaryOperator.EQ)).toBe("user/changed");
  expect(restored.getListField("state", BinaryOperator.EQ)).toEqual(["PENDING", "PROCESSING"]);
});
