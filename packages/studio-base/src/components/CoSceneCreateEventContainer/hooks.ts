// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { toDate, subtract, isLessThan, isGreaterThan } from "@foxglove/rostime";
import { AppSetting } from "@foxglove/studio-base/AppSetting";
import { convertCustomFieldValuesToMap } from "@foxglove/studio-base/components/CustomFieldProperty/utils/convertCustomFieldForm";
import {
  BagFileInfo,
  CoScenePlaylistStore,
  usePlaylist,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
import { useAppConfigurationValue } from "@foxglove/studio-base/hooks";

import { CreateEventForm } from "./types";

const selectEventMarks = (store: EventsStore) => store.eventMarks;
const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;
const selectToModifyEvent = (store: EventsStore) => store.toModifyEvent;

export const useGetPassingFile = (): BagFileInfo[] | undefined => {
  const bagFiles = usePlaylist(selectBagFiles);
  const [timeModeSetting] = useAppConfigurationValue<string>(AppSetting.TIME_MODE);
  const timeMode = timeModeSetting === "relativeTime" ? "relativeTime" : "absoluteTime";
  const eventMarks = useEvents(selectEventMarks);

  const markStartTime = eventMarks[0]?.time;

  return bagFiles.value?.filter((bag) => {
    if (bag.startTime == undefined || bag.endTime == undefined) {
      return false;
    }
    const bagStartTime = timeMode === "absoluteTime" ? bag.startTime : { sec: 0, nsec: 0 };
    const bagEndTime =
      timeMode === "absoluteTime" ? bag.endTime : subtract(bag.endTime, bag.startTime);

    return (
      bag.fileType !== "GHOST_RESULT_FILE" &&
      markStartTime &&
      !isGreaterThan(bagStartTime, markStartTime) &&
      !isLessThan(bagEndTime, markStartTime)
    );
  });
};

export const useDefaultEventForm = (): CreateEventForm => {
  const eventMarks = useEvents(selectEventMarks);
  const toModifyEvent = useEvents(selectToModifyEvent);

  const passingFile = useGetPassingFile();

  const markStartTime = eventMarks[0]?.time;

  if (toModifyEvent != undefined) {
    return {
      eventName: toModifyEvent.eventName,
      startTime: toModifyEvent.startTime,
      duration: toModifyEvent.duration,
      durationUnit: toModifyEvent.durationUnit,
      description: toModifyEvent.description,
      metadataEntries:
        toModifyEvent.metadataEntries.length > 0
          ? toModifyEvent.metadataEntries
          : [{ key: "", value: "" }],
      enabledCreateNewTask: toModifyEvent.enabledCreateNewTask,
      fileName: toModifyEvent.record,
      imgUrl: toModifyEvent.imgUrl,
      record: toModifyEvent.record,
      customFieldValues: convertCustomFieldValuesToMap(toModifyEvent.customFieldValues),
    };
  }

  return {
    eventName: "",
    startTime: markStartTime ? toDate(markStartTime) : undefined,
    duration: 1,
    durationUnit: "sec",
    description: "",
    metadataEntries: [{ key: "", value: "" }],
    enabledCreateNewTask: false,
    fileName: passingFile?.[0]?.name ?? "",
    record: "",
    customFieldValues: {},
  };
};
