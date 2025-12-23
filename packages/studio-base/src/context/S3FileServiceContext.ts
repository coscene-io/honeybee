// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { createContext, useContext } from "react";

import { S3FileService } from "@foxglove/studio-base/services/S3FileService";

const S3FileServiceContext = createContext<S3FileService | undefined>(undefined);
S3FileServiceContext.displayName = "S3FileServiceContext";

function useS3FileService(): S3FileService {
  const service = useContext(S3FileServiceContext);
  if (!service) {
    throw new Error("S3FileServiceContext Provider is required to useS3FileService");
  }
  return service;
}

export { useS3FileService };
export default S3FileServiceContext;
