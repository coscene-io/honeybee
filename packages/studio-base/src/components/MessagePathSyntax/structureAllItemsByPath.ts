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

import { filterMap } from "@foxglove/den/collection";
import {
  MessagePathStructureItem,
  MessagePathStructureItemMessage,
  quoteTopicNameIfNeeded,
} from "@foxglove/message-path";
import { Topic } from "@foxglove/studio-base/players/types";

import { messagePathsForStructure } from "./messagePathsForDatatype";

type StructureAllItemsByPathProps = {
  noMultiSlices?: boolean;
  validTypes?: readonly string[];
  messagePathStructuresForDatatype: Record<string, MessagePathStructureItemMessage>;
  topics: readonly Topic[];
};

export function structureAllItemsByPath({
  noMultiSlices,
  validTypes,
  messagePathStructuresForDatatype,
  topics,
}: StructureAllItemsByPathProps): Map<string, MessagePathStructureItem> {
  return new Map(
    topics.flatMap((topic) => {
      if (topic.schemaName == undefined) {
        return [];
      }

      const structureItem = messagePathStructuresForDatatype[topic.schemaName];
      if (structureItem == undefined) {
        return [];
      }

      const allPaths = messagePathsForStructure(structureItem, {
        validTypes,
        noMultiSlices,
      });
      return filterMap(allPaths, (item) => {
        if (item.path === "") {
          return undefined;
        }
        return [quoteTopicNameIfNeeded(topic.name) + item.path, item.terminatingStructureItem];
      });
    }),
  );
}
