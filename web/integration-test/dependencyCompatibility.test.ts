// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { DefinePlugin, ProvidePlugin, rspack } from "@rspack/core";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { Browser, Page, chromium } from "playwright";

let browser: Browser | undefined;
let page: Page;
let buildPath: string;
const errors: string[] = [];

jest.setTimeout(30_000);

beforeAll(async () => {
  buildPath = await mkdtemp(path.join(tmpdir(), "honeybee-dependency-compatibility-"));
  const compiler = rspack({
    mode: "production",
    context: path.resolve(__dirname, "../.."),
    entry: path.resolve(
      __dirname,
      "../../packages/studio-base/src/test/fixtures/dependencyCompatibility.tsx",
    ),
    output: { path: buildPath, filename: "fixture.js" },
    resolve: {
      extensions: [".tsx", ".ts", ".js", ".json"],
      alias: {
        "@foxglove/studio-base": path.resolve(__dirname, "../../packages/studio-base/src"),
      },
      fallback: { path: false, url: false },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          loader: "builtin:swc-loader",
          options: {
            jsc: {
              parser: { syntax: "typescript", tsx: true },
              transform: { react: { runtime: "automatic" } },
            },
          },
        },
      ],
    },
    plugins: [new ProvidePlugin({ React: "react" }), new DefinePlugin({ ReactNull: "null" })],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error || stats?.hasErrors() !== false) {
          reject(error ?? new Error(stats?.toString({ all: false, errors: true })));
        } else {
          resolve();
        }
      });
    });
  } finally {
    await new Promise<void>((resolve) => {
      compiler.close(() => {
        resolve();
      });
    });
  }
  browser = await chromium.launch({ channel: "chromium" });
}, 60_000);

beforeEach(async () => {
  errors.length = 0;
  if (browser == undefined) {
    throw new Error("Browser setup did not complete");
  }
  page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ path: path.join(buildPath, "fixture.js") });
  await page.waitForSelector("#indicator-text-true .MuiTypography-h1");
});

afterEach(async () => {
  // Setup may fail before a page is assigned.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  await page?.close();
});

afterAll(async () => {
  await browser?.close();
  if (buildPath) {
    await rm(buildPath, { recursive: true, force: true });
  }
});

it.each(["topic", "log", "diagnostic"])(
  "keeps the %s list within its flex parent after shrinking and hiding",
  async (kind) => {
    const list = page.locator(`#${kind} [data-auto-sizer] > div`);
    await list.waitFor();
    const expectSize = async (width: number, height: number) => {
      await page.waitForFunction(
        ({ selector, width, height }) => {
          const element = document.querySelector(selector);
          return element?.clientWidth === width && element.clientHeight === height;
        },
        { selector: `#${kind} [data-auto-sizer] > div`, width, height },
      );
      expect(await list.evaluate((element) => [element.clientWidth, element.clientHeight])).toEqual(
        [width, height],
      );
    };
    await expectSize(400, 360);
    await page.locator(`#${kind}`).evaluate((element) => {
      element.style.height = "200px";
      element.style.width = "250px";
    });
    await expectSize(250, 160);
    await page.locator(`#${kind}`).evaluate((element) => {
      element.style.display = "none";
    });
    await list.waitFor({ state: "detached" });
    await page.locator(`#${kind}`).evaluate((element) => {
      element.style.height = "300px";
      element.style.width = "350px";
      element.style.display = "flex";
    });
    await list.waitFor();
    await expectSize(350, 260);
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.locator(`#${kind} [data-auto-sizer]`).getByText("99", { exact: true }).waitFor();
    expect(errors).toEqual([]);
  },
);

it("preserves indicator rule colors and diagnostic severity through theme changes", async () => {
  const expectColor = async (selector: string, expected: string) => {
    await page.waitForFunction(
      ({ selector, expected }) => {
        const element = document.querySelector(selector);
        return element != undefined && getComputedStyle(element).color === expected;
      },
      { selector, expected },
    );
    expect(
      await page.locator(selector).evaluate((element) => getComputedStyle(element).color),
    ).toBe(expected);
  };
  for (const mode of ["dark", "light"]) {
    for (const style of ["text", "bulb", "background"]) {
      for (const matched of [false, true]) {
        const selector = `#indicator-${style}-${String(matched)} .MuiTypography-h1`;
        await page
          .locator(selector)
          .getByText(matched ? "Matched" : "Fallback", { exact: true })
          .waitFor();
        const expected =
          style === "background"
            ? "rgba(0, 0, 0, 0.87)"
            : matched
              ? "rgb(0, 255, 0)"
              : "rgb(255, 0, 0)";
        await expectColor(selector, expected);
      }
    }
    for (const [level, expected] of [
      "rgb(0, 128, 0)",
      "rgb(255, 128, 0)",
      "rgb(255, 0, 0)",
      mode === "dark" ? "rgb(167, 166, 175)" : "rgb(111, 109, 121)",
    ].entries()) {
      await expectColor(`#diagnostic-${level} .MuiTypography-subtitle1`, expected);
      await expectColor(`#diagnostic-${level} .MuiTypography-inherit`, expected);
    }
    await page.getByRole("button", { name: "Toggle theme" }).click();
  }
  expect(errors).toEqual([]);
});
