/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { render } from "@testing-library/react";
import { ModuleKind, ModuleResolutionKind } from "typescript";

import Editor from "./Editor";

const mockSetCompilerOptionsSpy = jest.fn();
const mockSetDiagnosticsOptionsSpy = jest.fn();
const mockGetCompilerOptionsSpy = jest.fn(() => ({ allowNonTsExtensions: true, target: 99 }));
const mockAddExtraLibSpy = jest.fn(() => ({ dispose: jest.fn() }));
const mockReactNull = ReactNull;

function mockSetCompilerOptions(...args: unknown[]): void {
  mockSetCompilerOptionsSpy(...args);
}

function mockSetDiagnosticsOptions(...args: unknown[]): void {
  mockSetDiagnosticsOptionsSpy(...args);
}

function mockGetCompilerOptions(): { allowNonTsExtensions: boolean; target: number } {
  return mockGetCompilerOptionsSpy();
}

function mockAddExtraLib(...args: unknown[]): { dispose: () => void } {
  return mockAddExtraLibSpy(...args);
}

function mockUriParse(value: string) {
  return {
    path: value.replace(/^file:\/\//, ""),
    toString: () => value,
    toStringWithEncoding: () => value,
  };
}

function mockCreateModel(value: string, _language: string, uri: ReturnType<typeof mockUriParse>) {
  return {
    getValue: () => value,
    setValue: jest.fn(),
    updateOptions: jest.fn(),
    uri,
  };
}

const mockMonaco = {
  editor: {
    createModel: mockCreateModel,
    defineTheme: jest.fn(),
    getModel: jest.fn(() => undefined),
  },
  languages: {
    registerDocumentFormattingEditProvider: jest.fn(),
  },
};

jest.mock("@mui/material", () => ({
  useTheme: () => ({ palette: { mode: "dark" } }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock("react-resize-detector", () => ({
  useResizeDetector: () => ({ ref: jest.fn() }),
}));

jest.mock("react-monaco-editor", () => ({
  __esModule: true,
  default: (props: { editorWillMount?: (monaco: typeof mockMonaco) => void }) => {
    props.editorWillMount?.(mockMonaco);
    return mockReactNull;
  },
}));

jest.mock("monaco-editor/esm/vs/editor/browser/services/codeEditorService", () => ({
  ICodeEditorService: Symbol("ICodeEditorService"),
}));

jest.mock("monaco-editor/esm/vs/editor/standalone/browser/standaloneServices", () => ({
  StandaloneServices: {
    get: () => ({
      registerCodeEditorOpenHandler: jest.fn(() => ({ dispose: jest.fn() })),
    }),
  },
}));

jest.mock("monaco-editor/esm/vs/editor/editor.api", () => ({
  editor: {
    createModel: mockCreateModel,
    defineTheme: jest.fn(),
    getModel: jest.fn(() => undefined),
  },
  KeyCode: { KeyS: 49 },
  KeyMod: { CtrlCmd: 2048 },
  Uri: {
    parse: mockUriParse,
  },
}));

jest.mock("monaco-editor/esm/vs/language/typescript/monaco.contribution", () => ({
  javascriptDefaults: {
    setEagerModelSync: jest.fn(),
  },
  typescriptDefaults: {
    addExtraLib: mockAddExtraLib,
    getCompilerOptions: mockGetCompilerOptions,
    setCompilerOptions: mockSetCompilerOptions,
    setDiagnosticsOptions: mockSetDiagnosticsOptions,
    setEagerModelSync: jest.fn(),
  },
}));

describe("UserScriptEditor Editor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddExtraLibSpy.mockClear();
    mockGetCompilerOptionsSpy.mockClear();
    mockSetCompilerOptionsSpy.mockClear();
    mockSetDiagnosticsOptionsSpy.mockClear();
  });

  it("configures Monaco TypeScript resolution for virtual user script modules", () => {
    render(
      <Editor
        autoFormatOnSave={false}
        rosLib=""
        save={jest.fn()}
        script={{ code: "", filePath: "script.ts" }}
        setScriptCode={jest.fn()}
        setScriptOverride={jest.fn()}
        typesLib=""
      />,
    );

    expect(mockSetCompilerOptionsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "file:///",
        module: ModuleKind.ESNext,
        moduleResolution: ModuleResolutionKind.Bundler,
        paths: {
          "@foxglove/schemas": ["node_modules/@foxglove/schemas/index.ts"],
          "@foxglove/schemas/*": ["node_modules/@foxglove/schemas/*.ts"],
        },
      }),
    );

    expect(mockSetDiagnosticsOptionsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnosticCodesToIgnore: expect.arrayContaining([6192]),
      }),
    );
  });
});
