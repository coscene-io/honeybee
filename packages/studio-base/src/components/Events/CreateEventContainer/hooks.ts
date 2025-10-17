// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useEffect, useState } from "react";

import { toDate, subtract, isLessThan, isGreaterThan, toSec } from "@foxglove/rostime";
import { convertCustomFieldValuesToMap } from "@foxglove/studio-base/components/CustomFieldProperty/utils/convertCustomFieldForm";
import {
  BagFileInfo,
  CoScenePlaylistStore,
  usePlaylist,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";

import { CreateEventForm } from "./types";

const selectEventMarks = (store: EventsStore) => store.eventMarks;
const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;
const selectToModifyEvent = (store: EventsStore) => store.toModifyEvent;

export const useGetPassingFile = (): BagFileInfo[] | undefined => {
  const bagFiles = usePlaylist(selectBagFiles);
  const eventMarks = useEvents(selectEventMarks);

  const markStartTime = eventMarks[0]?.time;

  return bagFiles.value?.filter((bag) => {
    if (bag.startTime == undefined || bag.endTime == undefined) {
      return false;
    }
    const bagStartTime = bag.startTime;
    const bagEndTime = bag.endTime;

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

export const useTimeRange = (): { startTime: Date | undefined; duration: number } => {
  const [startTime, setStartTime] = useState<Date | undefined>(undefined);
  const [duration, setDuration] = useState<number>(0);

  const eventMarks = useEvents(selectEventMarks);

  const markStartTime = eventMarks[0]?.time;
  const markEndTime = eventMarks[1]?.time;

  useEffect(() => {
    setStartTime(markStartTime ? toDate(markStartTime) : undefined);

    setDuration(markEndTime && markStartTime ? toSec(subtract(markEndTime, markStartTime)) : 0);
  }, [markStartTime, markEndTime]);

  return { startTime, duration };
};
