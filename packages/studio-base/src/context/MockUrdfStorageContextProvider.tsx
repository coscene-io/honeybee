// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PropsWithChildren, useState } from "react";

import UrdfStorageContext from "@foxglove/studio-base/context/UrdfStorageContext";
import { IUrdfStorage } from "@foxglove/studio-base/services/IUrdfStorage";

const defaultMockUrdfStorage: IUrdfStorage = {
  checkUriNeedsCache: () => false,
  getEtag: async () => undefined,
  getFile: async () => undefined,
  set: async () => undefined,
};

type Props = PropsWithChildren<{
  value?: IUrdfStorage;
}>;

export default function MockUrdfStorageContextProvider({
  children,
  value,
}: Props): React.JSX.Element {
  const [urdfStorage] = useState<IUrdfStorage>(() => value ?? defaultMockUrdfStorage);
  return <UrdfStorageContext.Provider value={urdfStorage}>{children}</UrdfStorageContext.Provider>;
}
