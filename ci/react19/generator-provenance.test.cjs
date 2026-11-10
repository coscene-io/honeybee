// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

const { test } = require("@jest/globals");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");


const { generatorDigests } = require("./generator-provenance.cjs");

test("archive metadata varies without changing payload identity; content still changes it", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "generator-provenance-"));
  try {
    fs.mkdirSync(path.join(directory, "package"));
    const entry = path.join(directory, "package", "cli.js");
    fs.writeFileSync(entry, "original CLI\n");
    const archive = path.join(directory, "generator.tgz");
    const pack = () => execFileSync("tar", ["-czf", archive, "-C", directory, "package"]);
    pack();
    const original = generatorDigests(archive);
    fs.chmodSync(entry, 0o755);
    fs.utimesSync(entry, 100, 100);
    pack();
    const differentMetadata = generatorDigests(archive);
    assert.notEqual(original.archiveSha256, differentMetadata.archiveSha256);
    assert.equal(original.payloadSha256, differentMetadata.payloadSha256);
    fs.writeFileSync(entry, "different CLI\n");
    pack();
    assert.notEqual(original.payloadSha256, generatorDigests(archive).payloadSha256);
    fs.symlinkSync("cli.js", path.join(directory, "package", "link"));
    pack();
    assert.throws(() => generatorDigests(archive), /only regular files/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
