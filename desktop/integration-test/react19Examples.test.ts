// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { readdir } from "fs/promises";
import path from "path";

import { launchApp } from "./launchApp";
import { createEmptyLayout } from "../../web/integration-test/reactUpgradeExtension";

declare global {
  interface Window {
    react19WorkerCount: number;
    react19MonacoGlobals: { environment: unknown; api: unknown };
  }
}

// Opt in with the artifact directory printed by create-coscene-extension's test:e2e script.
// These archives are built in the generator repository and are deliberately not checked in here.
const examplesDirectory = process.env.HONEYBEE_REACT19_EXAMPLES_DIR;
const describeExamples = examplesDirectory ? describe : describe.skip;

const examples = [
  { directory: "call-service-panel-example", name: "call-service", kind: "service" },
  {
    directory: "custom-image-extension",
    name: "coScene Example Image Extension Panel",
    kind: "canvas",
  },
  { directory: "extension-demo", name: "Extension Demo", kind: "canvas" },
  { directory: "monaco-editor-example", name: "Monaco Editor", kind: "editor" },
  { directory: "panel-settings", name: "coScene Panel Settings Example", kind: "settings" },
  { directory: "webworker", name: "Webworker Demo", kind: "worker" },
];

describeExamples("generator extension examples", () => {
  it.each(examples)(
    "installs and reopens the generated $directory example",
    async ({ directory, name, kind }) => {
      const artifactDirectory = path.join(examplesDirectory!, directory);
      const archives = (await readdir(artifactDirectory)).filter((file) => file.endsWith(".coe"));
      expect(archives).toHaveLength(1);

      const app = await launchApp();
      const errors: unknown[] = [];
      try {
        const page = app.renderer;
        const editorRequests: string[] = [];
        page.on("request", (request) => {
          if (request.url().includes("/monaco-editor@")) {
            editorRequests.push(request.url());
          }
        });
        await createEmptyLayout(page);
        await page.evaluate(() => {
          window.react19MonacoGlobals = {
            environment: Reflect.get(window, "MonacoEnvironment"),
            api: Reflect.get(window, "monaco"),
          };
        });
        await page
          .locator("[data-puppeteer-file-upload]")
          .setInputFiles(path.join(artifactDirectory, archives[0]!));
        await page.getByText(/Installed extension/).waitFor();

        if (kind === "worker" || kind === "editor") {
          await page.evaluate(() => {
            const state = window;
            state.react19WorkerCount = 0;
            const NativeWorker = window.Worker;
            const terminated = new WeakSet<Worker>();
            window.Worker = class extends NativeWorker {
              public constructor(url: string | URL, options?: WorkerOptions) {
                super(url, options);
                state.react19WorkerCount++;
              }
              public override terminate() {
                if (!terminated.has(this)) {
                  terminated.add(this);
                  state.react19WorkerCount--;
                }
                super.terminate();
              }
            };
          });
        }

        let editorWorkerCount = 0;
        for (let cycle = 0; cycle < 2; cycle++) {
          await page.locator("#add-panel-button").click();
          await page.getByTestId(`panel-menu-item ${name}`).click();
          const panel = page.locator('[data-testid^="panel-mouseenter-container"]');
          await panel.waitFor();

          if (kind === "service") {
            await panel.getByRole("heading", { name: "Call service", exact: true }).waitFor();
            await panel.getByPlaceholder("Enter service name").fill("/local-test-only");
            await panel.locator("textarea").fill('{"reactVersion":19}');
            expect(await panel.locator("textarea").inputValue()).toBe('{"reactVersion":19}');
            // There is no live connection in this test. Never send a real service request.
            expect(
              await panel.getByRole("button", { name: "Call /local-test-only" }).isDisabled(),
            ).toBe(true);
            await panel.locator(".react-json-view").waitFor();
          } else if (kind === "canvas") {
            const canvas = panel.locator("canvas");
            await canvas.waitFor();
            expect(await canvas.getAttribute("width")).toBe("480");
            expect(await canvas.getAttribute("height")).toBe("480");
            await panel.getByText("Choose a topic to render:", { exact: true }).waitFor();
            expect(
              await canvas.evaluate(
                (element) => (element as HTMLCanvasElement).getContext("2d") != undefined,
              ),
            ).toBe(true);
          } else if (kind === "editor") {
            const editor = panel.locator(".monaco-editor");
            await editor.waitFor({ timeout: 45_000 });
            await editor.locator("textarea.inputarea").focus();
            await page.keyboard.press("ControlOrMeta+A");
            await page.keyboard.insertText('const version: number = "React 19 editor smoke";');
            await page.waitForFunction(() =>
              [...document.querySelectorAll(".monaco-editor .view-lines")].some((element) =>
                /React\s19\seditor\ssmoke/.test(element.textContent),
              ),
            );
            // A type error is reported by the bundled TypeScript worker, beyond plain text input.
            await editor.locator(".squiggly-error").first().waitFor();
            expect(editorRequests).toEqual([]);
            const activeWorkers = await page.evaluate(() => window.react19WorkerCount);
            expect(activeWorkers).toBeGreaterThan(0);
            if (cycle === 0) {
              editorWorkerCount = activeWorkers;
            } else {
              // Monaco 0.33 shares its language worker for this extension module’s lifetime.
              expect(activeWorkers).toBe(editorWorkerCount);
            }
            expect(
              await page.evaluate(
                () =>
                  Reflect.get(window, "MonacoEnvironment") ===
                    window.react19MonacoGlobals.environment &&
                  Reflect.get(window, "monaco") === window.react19MonacoGlobals.api,
              ),
            ).toBe(true);
          } else if (kind === "worker") {
            await panel.getByText("hello world from worker!", { exact: true }).first().waitFor();
            expect(await page.evaluate(() => window.react19WorkerCount)).toBe(1);
          } else {
            await panel.locator(".react-json-view").waitFor();
            await panel.getByRole("button", { name: "Settings", exact: true }).click();
            await page.getByText("Display DataTypes", { exact: true }).waitFor();
            const off = page.getByRole("button", { name: "Off", exact: true });
            await off.click();
            expect(await off.getAttribute("aria-pressed")).toBe("true");
          }

          await panel.getByTestId("panel-menu").click();
          await page.getByTestId("panel-menu-remove").click();
          await panel.waitFor({ state: "detached" });
          if (kind === "worker") {
            await page.waitForFunction(() => window.react19WorkerCount === 0);
          }
        }
      } catch (error) {
        errors.push(error);
      }
      try {
        await app[Symbol.asyncDispose]();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) {
        throw errors[0];
      }
      if (errors.length > 1) {
        throw new AggregateError(errors, "Example test and app cleanup failed");
      }
    },
    120_000,
  );
});
