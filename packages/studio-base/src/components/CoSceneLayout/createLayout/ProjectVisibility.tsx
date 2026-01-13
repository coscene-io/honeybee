// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { ProjectVisibilityEnum_ProjectVisibility } from "@coscene-io/cosceneapis-es-v2/coscene/dataplatform/v1alpha1/enums/project_visibility_pb";
import { Chip } from "@mui/material";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

const useStyles = makeStyles()({
  private: {
    backgroundColor: "#d1fae5",
    color: "#047857",
  },
  public: {
    backgroundColor: "#dbeafe",
    color: "#1d4ed8",
  },
});

export function ProjectVisibilityChip({
  visibility,
}: {
  visibility: ProjectVisibilityEnum_ProjectVisibility;
}): React.JSX.Element | undefined {
  const { t } = useTranslation("project");
  const { classes } = useStyles();

  switch (visibility) {
    case ProjectVisibilityEnum_ProjectVisibility.PRIVATE:
      return (
        <Chip size="small" variant="filled" label={t("private")} className={classes.private} />
      );
    case ProjectVisibilityEnum_ProjectVisibility.INTERNAL:
      return <Chip size="small" variant="filled" label={t("internal")} />;
    case ProjectVisibilityEnum_ProjectVisibility.PUBLIC:
      return <Chip size="small" variant="filled" label={t("public")} className={classes.public} />;
  }

  return undefined;
}
