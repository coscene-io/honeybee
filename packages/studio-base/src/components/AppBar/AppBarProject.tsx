// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ProjectSelector } from "@foxglove/studio-base/components/CoSceneLayout/createLayout/ProjectSelector";
import { useSetExternalInitConfig } from "@foxglove/studio-base/components/CoreDataSyncAdapter";
import { CoreDataStore, useCoreData } from "@foxglove/studio-base/context/CoreDataContext";
import { usePlayerSelection } from "@foxglove/studio-base/context/PlayerSelectionContext";

const selectExternalInitConfig = (state: CoreDataStore) => state.externalInitConfig;

export function AppBarProject(): React.JSX.Element {
  const { selectSource, selectedSource } = usePlayerSelection();

  const externalInitConfig = useCoreData(selectExternalInitConfig);
  const setExternalInitConfig = useSetExternalInitConfig();

  const projectName =
    externalInitConfig?.warehouseId && externalInitConfig.projectId
      ? `warehouses/${externalInitConfig.warehouseId}/projects/${externalInitConfig.projectId}`
      : "";

  return (
    <ProjectSelector
      showLabel={false}
      value={projectName}
      onChange={(value) => {
        const array = value.split("/");
        const newExternalInitConfig = {
          warehouseId: array[1],
          projectId: array[3],
        };
        if (selectedSource?.type !== "file") {
          selectSource(undefined);
        }

        void setExternalInitConfig(newExternalInitConfig);
      }}
    />
  );
}
