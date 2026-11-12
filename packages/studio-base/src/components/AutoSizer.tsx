// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { AutoSizer as BaseAutoSizer, AutoSizerProps } from "react-virtualized-auto-sizer";

// Keep virtualized content out of the parent's minimum size, so flex panels can shrink.
// AutoSizer 2 measures its parent but no longer supplies these defaults itself.
export default function AutoSizer(props: AutoSizerProps): React.JSX.Element {
  return <BaseAutoSizer {...props} style={{ height: 0, width: 0, ...props.style }} />;
}
