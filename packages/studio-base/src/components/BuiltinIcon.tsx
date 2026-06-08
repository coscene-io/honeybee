// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import ICONS from "@foxglove/studio-base/theme/icons";
import { RegisteredIconNames } from "@foxglove/studio-base/types/Icons";

type BuiltinIconProps = {
  name?: RegisteredIconNames;
};

export function BuiltinIcon(props: BuiltinIconProps): React.JSX.Element {
  if (props.name == undefined) {
    return <></>;
  }
  return ICONS[props.name];
}
