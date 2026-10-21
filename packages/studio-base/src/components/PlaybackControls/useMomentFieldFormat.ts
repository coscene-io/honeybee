// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";

import { useConsoleApi } from "@foxglove/studio-base/context/CoSceneConsoleApiContext";
import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";
import type { MomentCustomFieldSchema } from "@foxglove/studio-base/services/api/moment-custom-field/types";

import type { MomentFieldFormatOptions } from "./momentFieldValues";
import { getTrackProperties, isMomentInProject } from "./momentTracks";

// The API declares no maximum. Bound each request instead of sending an entire recording's users.
const USER_LOOKUP_BATCH_SIZE = 100;
const EMPTY_USER_NAMES: ReadonlyMap<string, string> = new Map();

function normalizeUserName(id: string): string {
  return id.startsWith("users/") ? id : `users/${id}`;
}

function formatTime(value: Timestamp): string {
  return dayjs(timestampDate(value)).format("YYYY-MM-DD HH:mm:ss");
}

/** Resolve selected user fields once per user set, independently of playback updates. */
export function useMomentFieldFormat(
  events: TimelinePositionedEvent[],
  schema?: MomentCustomFieldSchema,
  projectName?: string,
): Required<MomentFieldFormatOptions> {
  const consoleApi = useConsoleApi();
  const userFieldIdsJson = useMemo(
    () =>
      JSON.stringify(
        getTrackProperties(schema)
          .filter((property) => property.type.case === "user")
          .map((property) => property.id)
          .sort(),
      )!,
    [schema],
  );
  const requestedNamesJson = useMemo(() => {
    const fieldIds = new Set(JSON.parse(userFieldIdsJson) as string[]);
    const names = new Set<string>();
    if (projectName != undefined && fieldIds.size > 0) {
      for (const entry of events) {
        if (!isMomentInProject(entry, projectName)) {
          continue;
        }
        for (const field of entry.event.customFieldValues) {
          if (field.property && fieldIds.has(field.property.id) && field.value.case === "user") {
            for (const id of field.value.value.ids) {
              if (id !== "" && id !== "users/") {
                names.add(normalizeUserName(id));
              }
            }
          }
        }
      }
    }
    return JSON.stringify([...names].sort())!;
  }, [events, projectName, userFieldIdsJson]);

  const requestKey = JSON.stringify([projectName, userFieldIdsJson, requestedNamesJson])!;
  const [resolved, setResolved] = useState<{
    api: ReturnType<typeof useConsoleApi>;
    key: string;
    userNames: ReadonlyMap<string, string>;
  }>();

  useEffect(() => {
    const names = JSON.parse(requestedNamesJson) as string[];
    if (names.length === 0) {
      return;
    }
    let active = true;
    const resolveUsers = async () => {
      const userNames = new Map<string, string>();
      for (let offset = 0; offset < names.length; offset += USER_LOOKUP_BATCH_SIZE) {
        const batch = names.slice(offset, offset + USER_LOOKUP_BATCH_SIZE);
        try {
          const response = await consoleApi.batchGetUsers(batch);
          if (!active) {
            return;
          }
          const requested = new Set(batch);
          for (const user of response.users) {
            const name = normalizeUserName(user.name);
            const nickname = user.nickname;
            if (requested.has(name) && nickname != undefined && nickname.trim() !== "") {
              userNames.set(name, nickname);
            }
          }
        } catch {
          // Missing or inaccessible users retain their stored IDs in the projection.
          if (!active) {
            return;
          }
        }
      }
      setResolved({ api: consoleApi, key: requestKey, userNames });
    };
    void resolveUsers();
    return () => {
      active = false;
    };
  }, [consoleApi, requestKey, requestedNamesJson]);

  // Do not expose the previous scope's names during the render before effect cleanup.
  const userNames =
    resolved?.api === consoleApi && resolved.key === requestKey
      ? resolved.userNames
      : EMPTY_USER_NAMES;
  return useMemo(() => ({ userNames, formatTime }), [userNames]);
}
