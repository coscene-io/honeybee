// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { Button } from "@mui/material";
import { useTranslation } from "react-i18next";

interface CommonSourceSelectProps {
  value?: string;
  onChange: (value?: string) => void;
}

export default function CommonSourceSelect({
  value,
  onChange,
}: CommonSourceSelectProps): React.JSX.Element {
  const { t } = useTranslation("cosSettings");
  // return <div>CommonSourceSelect</div>;
  return (
    <>
      <Button>{value ?? t("selectCommonSource")}</Button>

      {/* file seleter */}
    </>
  );
}
