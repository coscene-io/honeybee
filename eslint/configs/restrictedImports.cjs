// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const muiRestrictedImportPaths = [
  {
    name: "@mui/material",
    importNames: ["styled"],
    message: "@mui/styled has performance implications. Use tss-react/mui instead.",
  },
  {
    name: "@mui/styles",
    message: "@mui/styles has performance implications. Use tss-react/mui instead.",
  },
  {
    name: "@mui/material/styles/styled",
    message: "@mui/styled has performance implications. Use tss-react/mui instead.",
  },
  {
    name: "@emotion/styled",
    message: "@emotion/styled has performance implications. Use tss-react/mui instead.",
  },
];

const studioBaseEntryPointRestrictedImportPaths = [
  {
    name: "@foxglove/studio-base",
    message:
      "Use a direct studio-base subpath import. Importing the package entry point from inside studio-base creates dependency cycles.",
  },
  {
    name: "@foxglove/studio-base/index",
    message:
      "Use a direct studio-base subpath import. Importing the package entry point from inside studio-base creates dependency cycles.",
  },
];

module.exports = {
  muiRestrictedImportPaths,
  studioBaseEntryPointRestrictedImportPaths,
};
