// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import EastIcon from "@mui/icons-material/East";
import { Link, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import Stack from "@foxglove/studio-base/components/Stack";

interface CreateTaskSuccessToastProps {
  targetUrl: string;
}

export function CreateTaskSuccessToast({
  targetUrl,
}: CreateTaskSuccessToastProps): React.ReactNode {
  const { t } = useTranslation("cosEvent");

  return (
    <Stack direction="row" alignItems="center" gap={1}>
      <Typography>{t("createTaskSuccess")}</Typography>
      <Link href={targetUrl} target="_blank" underline="hover" color="inherit">
        <Stack direction="row" alignItems="center" gap={0.5}>
          {t("toView")}
          <EastIcon />
        </Stack>
      </Link>
    </Stack>
  );
}
