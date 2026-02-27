// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { PropsWithChildren, useState } from "react";

import S3FileServiceContext from "@foxglove/studio-base/context/S3FileServiceContext";
import { S3FileService } from "@foxglove/studio-base/services/S3FileService";

const defaultMockS3FileService = {
  headObject: async () => {
    throw new Error("Unexpected S3FileService.headObject call in test");
  },
  getObject: async () => {
    throw new Error("Unexpected S3FileService.getObject call in test");
  },
} as unknown as S3FileService;

type Props = PropsWithChildren<{
  value?: S3FileService;
}>;

export default function MockS3FileServiceContextProvider({
  children,
  value,
}: Props): React.JSX.Element {
  const [s3FileService] = useState<S3FileService>(() => value ?? defaultMockS3FileService);
  return (
    <S3FileServiceContext.Provider value={s3FileService}>{children}</S3FileServiceContext.Provider>
  );
}
