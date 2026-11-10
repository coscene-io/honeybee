// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// Archive metadata, including executable bits, can vary between local and CI packing.
// Compare every packaged path and byte, independent of tar/gzip metadata. npm applies bin modes.
function generatorDigests(tarball) {
  const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim();
  const paths = listing.split("\n").filter((name) => !name.endsWith("/"));
  if (
    paths.length === 0 ||
    new Set(paths).size !== paths.length ||
    paths.some((name) => !name.startsWith("package/") || name.split("/").includes(".."))
  ) {
    throw new Error("Unexpected generator archive paths");
  }
  const entries = execFileSync("tar", ["-tvzf", tarball], { encoding: "utf8" }).trim().split("\n");
  if (entries.some((entry) => !entry.startsWith("-") && !entry.startsWith("d"))) {
    throw new Error("Generator archive must contain only regular files and directories");
  }
  const payload = paths.sort().map((name) => ({
    path: name,
    sha256: sha256(execFileSync("tar", ["-xOf", tarball, name])),
  }));
  return {
    archiveSha256: sha256(fs.readFileSync(tarball)),
    payloadSha256: sha256(JSON.stringify(payload)),
  };
}

module.exports = { generatorDigests };
