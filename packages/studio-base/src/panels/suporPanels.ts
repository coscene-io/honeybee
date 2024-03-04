// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { TFunction } from "i18next";

import { PanelInfo } from "@foxglove/studio-base/context/PanelCatalogContext";
import { TAB_PANEL_TYPE } from "@foxglove/studio-base/util/globalConstants";

import plotThumbnail from "./Plot/thumbnail.png";
import tabThumbnail from "./Tab/thumbnail.png";

export const getBuiltin: (t: TFunction<"panels">) => PanelInfo[] = (t) => [
  {
    title: t("annotatedPlot", {
      ns: "cosAnnotatedPlot",
    }),
    type: "AnnotatedPlot",
    description: t("plotDescription"),
    thumbnail: plotThumbnail,
    module: async () => await import("./AnnotatedPlot"),
  },
  {
    title: t("tab"),
    type: TAB_PANEL_TYPE,
    description: t("tabDescription"),
    thumbnail: tabThumbnail,
    module: async () => await import("./Tab"),
    hasCustomToolbar: true,
  },
];
