/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";

import { useMessagePipeline } from "@foxglove/studio-base/components/MessagePipeline";
import { useProblemsStore } from "@foxglove/studio-base/context/ProblemsContext";
import { error as en } from "@foxglove/studio-base/i18n/en/error";
import { error as zh } from "@foxglove/studio-base/i18n/zh/error";
import { PlayerProblem } from "@foxglove/studio-base/players/types";

import { ProblemsList } from "./ProblemsList";

jest.mock("@foxglove/studio-base/components/MessagePipeline", () => ({
  useMessagePipeline: jest.fn(),
}));
jest.mock("@foxglove/studio-base/context/ProblemsContext", () => ({ useProblemsStore: jest.fn() }));

it("translates serialized problems at display time and retains literal problems and expansion state", async () => {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: { error: en }, zh: { error: zh } },
    interpolation: { escapeValue: false },
  });
  const problems: PlayerProblem[] = [
    {
      severity: "warn",
      message: "This file contains no messages.",
      messageKey: "fileContainsNoMessages",
    },
    {
      severity: "warn",
      message: "Rosbridge error",
      messageKey: "rosbridgeError",
      tipKey: "rosbridgeUnreachableTip",
      tipParams: { url: "ws://robot:9090" },
    },
    { severity: "error", message: "External diagnostic", tip: "Original details" },
  ];
  // Model the serializable payload delivered by an isolated worker.
  jest.mocked(useMessagePipeline).mockReturnValue(JSON.parse(JSON.stringify(problems)!));
  jest.mocked(useProblemsStore).mockReturnValue([]);
  render(
    <I18nextProvider i18n={i18n}>
      <ProblemsList />
    </I18nextProvider>,
  );
  const summary = screen.getByRole("button", { name: "This file contains no messages." });
  fireEvent.click(summary);
  expect(summary.getAttribute("aria-expanded")).toBe("false");
  await act(async () => {
    await i18n.changeLanguage("zh");
  });
  expect(screen.getByText(zh.fileContainsNoMessages!)).toBeDefined();
  expect(screen.getByText(zh.rosbridgeError!)).toBeDefined();
  expect(
    screen.getByText(i18n.t("error:rosbridgeUnreachableTip", { url: "ws://robot:9090" })),
  ).toBeDefined();
  expect(screen.getByText("External diagnostic")).toBeDefined();
  expect(screen.getByText("Original details")).toBeDefined();
  expect(
    screen.getByRole("button", { name: zh.fileContainsNoMessages }).getAttribute("aria-expanded"),
  ).toBe("false");
});
