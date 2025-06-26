// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { TFunction } from "i18next";
import { produce } from "immer";
import * as _ from "lodash-es";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SettingsTreeAction, SettingsTreeNodes } from "@foxglove/studio";
import {
  CoScenePlaylistStore,
  usePlaylist,
} from "@foxglove/studio-base/context/CoScenePlaylistContext";
import { usePanelSettingsTreeUpdate } from "@foxglove/studio-base/providers/PanelStateContextProvider";
import { SaveConfig } from "@foxglove/studio-base/types/panels";

import { MomentsBarConfig } from "./types";

function buildSettingsTree(
  config: MomentsBarConfig,
  t: TFunction<"cosEvent">,
  selectRecordsOptions: { label: string; value: string }[],
): SettingsTreeNodes {
  return {
    moments: {
      label: t("moments"),
      fields: {
        selectRecords: {
          label: t("filterByRecord"),
          input: "multipleSelect",
          value: config.selectRecords,
          options: selectRecordsOptions,
        },
        momentsFilter: {
          label: t("filterMoments"),
          input: "string",
          value: config.momentsFilter,
          placeholder: t("searchByKV"),
        },
      },
    },
  };
}

const selectBagFiles = (state: CoScenePlaylistStore) => state.bagFiles;

export function useMomentsBarSettings(
  config: MomentsBarConfig,
  saveConfig: SaveConfig<MomentsBarConfig>,
): void {
  const updatePanelSettingsTree = usePanelSettingsTreeUpdate();
  const { t } = useTranslation("cosEvent");
  const bagFiles = usePlaylist(selectBagFiles);

  const records = useMemo<
    {
      label: string;
      value: string;
    }[]
  >(() => {
    const recordsMap = new Map();
    bagFiles.value
      ?.filter((file) => {
        return (
          (file.fileType === "GHOST_SOURCE_FILE" || file.fileType === "NORMAL_FILE") &&
          file.recordDisplayName != undefined &&
          file.name.split("/files/")[0] != undefined
        );
      })
      .forEach((file) => {
        recordsMap.set(file.name.split("/files/")[0], {
          label: file.recordDisplayName ?? "",
          value: file.name.split("/files/")[0] ?? "",
        });
      });

    return Array.from(recordsMap.values());
  }, [bagFiles.value]);

  const actionHandler = useCallback(
    (action: SettingsTreeAction) => {
      if (action.action === "update") {
        const { path, value } = action.payload;
        saveConfig(
          produce((draft) => {
            _.set(draft, path.slice(1), value);
          }),
        );
      }
    },
    [saveConfig],
  );

  useEffect(() => {
    updatePanelSettingsTree({
      actionHandler,
      nodes: buildSettingsTree(config, t, records),
    });
  }, [actionHandler, config, updatePanelSettingsTree, t, records]);
}
