// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import memoizeWeak from "memoize-weak";

import { MessagePath, MessagePathFilter, MessagePathStructureItem } from "@foxglove/message-path";
import { Immutable } from "@foxglove/studio";
import { RosDatatypes } from "@foxglove/studio-base/types/RosDatatypes";
import { enumValuesByDatatypeAndField } from "@foxglove/studio-base/util/enums";

import { messagePathStructures } from "./messagePathsForDatatype";

// enumValues is storedValue → name per field. Invert to name → storedValue for identifier filters.
function structureAtFilterPath(
  structureItem: MessagePathStructureItem | undefined,
  path: readonly string[],
): MessagePathStructureItem | undefined {
  let current = structureItem;
  for (let i = 0; i < path.length - 1; i++) {
    const name = path[i];
    if (name == undefined || current == undefined) {
      return undefined;
    }
    if (current.structureType === "message") {
      current = current.nextByName[name];
    } else if (current.structureType === "array") {
      current = current.next;
    } else {
      return undefined;
    }
  }
  return current;
}

export function rewriteIdentifierFilter(
  pathItem: Immutable<MessagePathFilter>,
  structureItem: MessagePathStructureItem | undefined,
  enumValues: ReturnType<typeof enumValuesByDatatypeAndField>,
): Immutable<MessagePathFilter> {
  if (pathItem.valueIsIdentifier !== true || typeof pathItem.value !== "string") {
    return pathItem;
  }
  const owner = structureAtFilterPath(structureItem, pathItem.path);
  const fieldEnums = owner != undefined ? enumValues[owner.datatype] : undefined;
  if (fieldEnums == undefined) {
    return pathItem;
  }

  const fieldName = pathItem.path[pathItem.path.length - 1];
  const fieldMap = fieldName != undefined ? fieldEnums[fieldName] : undefined;
  const storedValue = Object.entries(fieldMap ?? {}).find(
    ([, name]) => name === pathItem.value,
  )?.[0];
  if (storedValue == undefined) {
    return pathItem;
  }
  return { ...pathItem, value: storedValue };
}

const getStructures = memoizeWeak(messagePathStructures);
const getEnums = memoizeWeak(enumValuesByDatatypeAndField);

/** Resolve enum names once per schema/path, before the simple walker processes messages. */
export const resolveMessagePathEnums = memoizeWeak(
  (
    path: Immutable<MessagePath>,
    schemaName: string,
    datatypes: Immutable<RosDatatypes>,
  ): Immutable<MessagePath> => {
    if (
      !path.messagePath.some((part) => part.type === "filter" && part.valueIsIdentifier === true)
    ) {
      return path;
    }
    let structure: MessagePathStructureItem | undefined = getStructures(datatypes)[schemaName];
    const enums = getEnums(datatypes);
    return {
      ...path,
      messagePath: path.messagePath.map((part) => {
        if (part.type === "filter") {
          return rewriteIdentifierFilter(part, structure, enums);
        }
        if (part.type === "name") {
          structure =
            structure?.structureType === "message" ? structure.nextByName[part.name] : undefined;
        } else {
          structure = structure?.structureType === "array" ? structure.next : undefined;
        }
        return part;
      }),
    };
  },
);
