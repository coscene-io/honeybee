// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// Usage: node ci/react19/build-extension-fixture.cjs /absolute/path/generator.tgz
// Pack the generator at commit 067f303469454c7a192f231e1e3455f531e55722 before running.
// See README.md for the exact reproducible commands.
// Output is ignored build data, not a hand-written ZIP pretending to be an extension package.
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { generatorDigests } = require("./generator-provenance.cjs");

const tarball = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || !fs.statSync(tarball).isFile()) {
  throw new Error("Pass the current generator's npm tarball as the first argument");
}
const { archiveSha256: generatorTarballSha256, payloadSha256: generatorPayloadSha256 } =
  generatorDigests(tarball);
if (generatorPayloadSha256 !== "299a4cb466358d5478e356afad731a5b1219c7ebacf9be22cb4d0eb06daa6415") {
  throw new Error(
    `Generator payload ${generatorPayloadSha256} does not match pinned revision 067f303469454c7a192f231e1e3455f531e55722 (archive ${generatorTarballSha256})`,
  );
}
const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "honeybee-react-extension-"));
const runner = path.join(buildDir, "runner");
fs.mkdirSync(runner);
fs.writeFileSync(path.join(runner, "package.json"), JSON.stringify({ private: true }));
function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}
run("npm", ["install", "--no-audit", "--no-fund", tarball], runner);
run(
  process.execPath,
  [
    path.join(runner, "node_modules/create-coscene-extension/dist/bin/create-coscene-extension.js"),
    "react-upgrade-fixture",
  ],
  buildDir,
);
const project = path.join(buildDir, "react-upgrade-fixture");
// create installs the current published CLI; explicitly use the same audited tarball for packaging.
run("npm", ["install", "--save-dev", "--save-exact", "--no-audit", "--no-fund", tarball], project);
fs.copyFileSync(
  path.join(__dirname, "ExamplePanel.tsx.fixture"),
  path.join(project, "src/ExamplePanel.tsx"),
);
run("npm", ["run", "build"], project);
run("npm", ["run", "package"], project);
const extensionModule = { exports: {} };
// Fail if the bundle imports React (or anything else) from the host's legacy require bridge.
// eslint-disable-next-line no-new-func
new Function(
  "module",
  "exports",
  "require",
  fs.readFileSync(path.join(project, "dist/extension.js"), "utf8"),
)(extensionModule, extensionModule.exports, (name) => {
  throw new Error(`Unexpected host require: ${name}`);
});
const panels = [];
extensionModule.exports.activate({ registerPanel: (panel) => panels.push(panel.name) });
if (panels.length !== 1 || panels[0] !== "example-panel") {
  throw new Error("Generated fixture did not register its expected panel");
}
const packageFile = fs.readdirSync(project).find((file) => file.endsWith(".coe"));
if (!packageFile) {
  throw new Error("Generator did not produce a .coe package");
}
const output = path.resolve(__dirname, "../../temp/react19-extension");
fs.mkdirSync(output, { recursive: true });
fs.copyFileSync(path.join(project, packageFile), path.join(output, "fixture.coe"));
fs.writeFileSync(
  path.join(output, "provenance.json"),
  JSON.stringify(
    {
      generatorRevision: "067f303469454c7a192f231e1e3455f531e55722",
      generatorTarball: tarball,
      generatorTarballSha256,
      generatorPayloadSha256,
      generatorVersion: require(
        path.join(runner, "node_modules/create-coscene-extension/package.json"),
      ).version,
      reactVersion: require(path.join(project, "node_modules/react/package.json")).version,
      fixtureSourceSha256: createHash("sha256")
        .update(fs.readFileSync(path.join(__dirname, "ExamplePanel.tsx.fixture")))
        .digest("hex"),
    },
    undefined,
    2,
  ),
);
fs.copyFileSync(path.join(project, "package-lock.json"), path.join(output, "package-lock.json"));
fs.rmSync(buildDir, { recursive: true, force: true });
process.stdout.write(`Fixture: ${path.join(output, "fixture.coe")}\n`);
