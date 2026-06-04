// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { create } from "@bufbuild/protobuf";
import { DeleteFileRequestSchema } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha3/services/file_pb";

import type { TimelinePositionedEvent } from "@foxglove/studio-base/context/EventsContext";
import type ConsoleApi from "@foxglove/studio-base/services/api/CoSceneConsoleApi";

export async function deleteEventWithFile({
  consoleApi,
  event,
}: {
  consoleApi: ConsoleApi;
  event: TimelinePositionedEvent;
}): Promise<void> {
  const fileName = event.event.files[0];

  if (fileName != undefined && fileName !== "") {
    try {
      await consoleApi.deleteFile(create(DeleteFileRequestSchema, { name: fileName }));
    } catch (error) {
      console.error("Error deleting file", error);
    }
  }

  await consoleApi.deleteEvent({ eventName: event.event.name });
}
