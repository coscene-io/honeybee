/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { act, render } from "@testing-library/react";
import type * as monacoApi from "monaco-editor/esm/vs/editor/editor.api.js";
import { ModuleKind, ModuleResolutionKind } from "typescript-for-user-script";

import Editor from "./Editor";

const mockSetCompilerOptionsSpy = jest.fn();
const mockSetDiagnosticsOptionsSpy = jest.fn();
const mockGetCompilerOptionsSpy = jest.fn(() => ({ allowNonTsExtensions: true, target: 99 }));
const mockAddExtraLibSpy = jest.fn((_content: string, _filePath?: string) => ({
  dispose: jest.fn(),
}));
const mockReactNull = ReactNull;
const mockModels = new Map<string, ReturnType<typeof mockCreateModel>>();
let mockMountEditor: ((editor: monacoApi.editor.IStandaloneCodeEditor) => void) | undefined;
function mockGetModel(uri: ReturnType<typeof mockUriParse>) {
  return mockModels.get(uri.path);
}

function mockSetCompilerOptions(...args: unknown[]): void {
  mockSetCompilerOptionsSpy(...args);
}

function mockSetDiagnosticsOptions(...args: unknown[]): void {
  mockSetDiagnosticsOptionsSpy(...args);
}

function mockGetCompilerOptions(): { allowNonTsExtensions: boolean; target: number } {
  return mockGetCompilerOptionsSpy();
}

function mockAddExtraLib(content: string, filePath?: string): { dispose: () => void } {
  return mockAddExtraLibSpy(content, filePath);
}

function mockUriParse(value: string) {
  return {
    path: value.replace(/^file:\/\//, ""),
    toString: () => value,
    toStringWithEncoding: () => value,
  };
}

function mockCreateModel(value: string, _language: string, uri: ReturnType<typeof mockUriParse>) {
  let currentValue = value;
  const model = {
    getValue: () => currentValue,
    setValue: jest.fn((next: string) => {
      currentValue = next;
    }),
    updateOptions: jest.fn(),
    uri,
  };
  mockModels.set(uri.path, model);
  return model;
}

const mockMonaco = {
  editor: {
    createModel: mockCreateModel,
    defineTheme: jest.fn(),
    getModel: mockGetModel,
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
  withTranslation: () => (component: unknown) => component,
  Trans: ({ i18nKey }: { i18nKey?: string }) => i18nKey,
}));

jest.mock("react-resize-detector", () => ({
  useResizeDetector: () => ({ ref: jest.fn() }),
}));

jest.mock("@monaco-editor/react", () => ({
  __esModule: true,
  loader: { config: jest.fn() },
  default: (props: {
    beforeMount?: (monaco: typeof mockMonaco) => void;
    onMount?: typeof mockMountEditor;
  }) => {
    mockMountEditor = props.onMount;
    props.beforeMount?.(mockMonaco);
    return mockReactNull;
  },
}));

jest.mock("monaco-editor/esm/vs/editor/browser/services/codeEditorService.js", () => ({
  ICodeEditorService: Symbol("ICodeEditorService"),
}));

jest.mock("monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js", () => ({
  StandaloneServices: {
    get: () => ({
      registerCodeEditorOpenHandler: jest.fn(() => ({ dispose: jest.fn() })),
    }),
  },
}));

jest.mock("monaco-editor/esm/vs/editor/editor.api.js", () => ({
  editor: {
    createModel: mockCreateModel,
    defineTheme: jest.fn(),
    getModel: mockGetModel,
  },
  KeyCode: { KeyS: 49 },
  KeyMod: { CtrlCmd: 2048 },
  Uri: {
    parse: mockUriParse,
  },
}));

jest.mock("monaco-editor/esm/vs/language/typescript/monaco.contribution.js", () => ({
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
    mockModels.clear();
    mockMountEditor = undefined;
    mockAddExtraLibSpy.mockClear();
    mockGetCompilerOptionsSpy.mockClear();
    mockSetCompilerOptionsSpy.mockClear();
    mockSetDiagnosticsOptionsSpy.mockClear();
  });

  it("synchronizes the latest script and selection after asynchronous editor initialization", () => {
    const props = {
      autoFormatOnSave: false,
      rosLib: "",
      typesLib: "",
      save: jest.fn(),
      setScriptCode: jest.fn(),
      setScriptOverride: jest.fn(),
    };
    const { rerender } = render(
      <Editor {...props} script={{ code: "old", filePath: "script.ts", readOnly: false }} />,
    );
    const initialMount = mockMountEditor!;
    const selection = { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 3 };
    rerender(
      <Editor
        {...props}
        script={{ code: "latest", filePath: "script.ts", readOnly: false, selection }}
      />,
    );
    const editor = {
      setModel: jest.fn(),
      addAction: jest.fn(),
      setSelection: jest.fn(),
      revealRangeInCenter: jest.fn(),
    };
    act(() => {
      initialMount(editor as unknown as monacoApi.editor.IStandaloneCodeEditor);
    });
    expect(editor.setModel.mock.calls[0]![0].getValue()).toBe("latest");
    expect(editor.setSelection).toHaveBeenCalledWith(selection);
  });

  it("configures Monaco TypeScript resolution for virtual user script modules", () => {
    render(
      <Editor
        autoFormatOnSave={false}
        rosLib=""
        save={jest.fn()}
        script={{ code: "", filePath: "script.ts", readOnly: false }}
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
