// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import MoreVertIcon from "@mui/icons-material/MoreVert";
import { Button, IconButton } from "@mui/material";
import { useTranslation } from "react-i18next";

import { Layout } from "@foxglove/studio-base/services/CoSceneILayoutStorage";

export function LayoutActions({
  layout,
  handleMenuOpen,
  onSelectLayout,
}: {
  layout: Layout;
  handleMenuOpen: (event: React.MouseEvent<HTMLButtonElement>, layout: Layout) => void;
  onSelectLayout: (layout: Layout) => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation("cosLayout");

  const handleUse = () => {
    void onSelectLayout(layout);
  };

  return (
    <div>
      <Button variant="outlined" size="small" onClick={handleUse}>
        {t("use")}
      </Button>

      <IconButton
        size="small"
        onClick={(event) => {
          handleMenuOpen(event, layout);
        }}
      >
        <MoreVertIcon />
      </IconButton>
    </div>
  );
}
