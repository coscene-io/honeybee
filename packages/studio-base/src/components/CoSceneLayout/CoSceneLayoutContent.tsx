// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

export function CoSceneLayoutContent({
  layouts,
}: {
  layouts?: {
    personalFolders: string[];
    projectFolders: string[];
    personalLayouts: Layout[];
    projectLayouts: Layout[];
  };
}): React.JSX.Element {
  if (!layouts) {
    return <div>No layouts</div>;
  }

  return <div>CoScene Layout</div>;
}
