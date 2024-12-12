// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { useMemo } from "react";

import Panel from "@foxglove/studio-base/components/Panel";
import PanelToolbar, {
  PANEL_TOOLBAR_MIN_HEIGHT,
} from "@foxglove/studio-base/components/PanelToolbar";
import Stack from "@foxglove/studio-base/components/Stack";
import { EventsStore, useEvents } from "@foxglove/studio-base/context/EventsContext";
import MomentsList from "@foxglove/studio-base/panels/AnnotatedPlot/MomentsList";
import { useMomentsBarSettings } from "@foxglove/studio-base/panels/MomentsBar/settings";
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import { MomentsBarConfig } from "./types";

type Props = {
  config: MomentsBarConfig;
  saveConfig: SaveConfig<MomentsBarConfig>;
};

const defaultConfig: MomentsBarConfig = {
  selectRecords: [],
};

const selectEvents = (store: EventsStore) => store.events;

function MomentsBar(props: Props) {
  const { saveConfig, config } = props;

  useMomentsBarSettings(config, saveConfig);

  const events = useEvents(selectEvents);

  const { selectRecords, momentsFilter } = config;

  const filteredEvents = useMemo(() => {
    if (selectRecords.length === 0 && (momentsFilter == undefined || momentsFilter === "")) {
      return events.value ?? [];
    }
    return (events.value ?? [])
      .filter((event) => {
        return selectRecords.length === 0 || selectRecords.includes(event.event.record);
      })
      .filter((event) => {
        const eventString =
          event.event.displayName +
          event.event.description +
          Object.entries(event.event.customizedFields)
            .map(([key, value]) => `${key}${value}`)
            .join("");
        return (
          momentsFilter == undefined || momentsFilter === "" || eventString.includes(momentsFilter)
        );
      });
  }, [events, momentsFilter, selectRecords]);

  return (
    <Stack
      flex="auto"
      alignItems="center"
      justifyContent="center"
      overflow="hidden"
      position="relative"
    >
      <PanelToolbar />
      <Stack
        direction="column"
        flex="auto"
        fullWidth
        style={{ height: `calc(100% - ${PANEL_TOOLBAR_MIN_HEIGHT}px)` }}
        position="relative"
        overflow="hidden"
      >
        <MomentsList events={filteredEvents} />
      </Stack>
    </Stack>
  );
}

export default Panel(
  Object.assign(MomentsBar, {
    panelType: "MomentsBar",
    defaultConfig,
  }),
);
