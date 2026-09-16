# FoxQL Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Honeybee visualization expressions parse, autocomplete, and evaluate like Foxglove 3.1.1 FoxQL (handwritten parser, filter operators, function chains) in Plot, Raw Messages, Gauge, Indicator, and State Transitions.

**Architecture:** Replace Nearley with a recursive-descent parser in `@foxglove/message-path` that emits `functionChain` instead of `modifier`. Evaluate chains in shared `MessagePathSyntax` walkers. Plot timestamp series split out `delta` / `derivative` / `timedelta` and apply them across consecutive samples. Type-based `.@` suggestions live in a pure helper consumed by `MessagePathInput`.

**Tech Stack:** TypeScript, Jest (`yarn jest <file> --runInBand`), Nearley removal, `@foxglove/rostime` `toSec`/`isTime`, `three` Quaternion/Euler for `@rpy`/`@quat`/`@ypr`/`@yrp`.

**Spec:** `docs/superpowers/specs/2026-09-15-foxql-visualization-design.md`

## Global Constraints

- Every new `.ts` / `.tsx` file starts with the same SPDX header used in `packages/message-path/src/types.ts`.
- Do not evaluate `@deg2rad` or `@rad2deg`. Catalog names are 3.1.1 only (`@radians`, `@degrees`).
- Do not implement Search FoxQL (`and`/`or`, `@device.name`, `visual()`).
- Do not copy code out of `/Applications/Foxglove.app` asar. Tests are the oracle.
- `MessagePath.modifier` is removed, not deprecated. Layout "modifier" (last editor user id) is unrelated — leave it.
- Per-task verification is the Jest command in that task. Do not run `yarn run tsc` / oxlint / eslint / prettier until Task 14.
- Integer filter values in existing parser tests are `bigint` (`2n`). Keep that. Slice bounds stay `number`.
- Unknown function names skip at runtime (identity) and fail `validateMessagePathFunctions` in the UI.

## File map

| File | Role |
| --- | --- |
| `packages/message-path/src/types.ts` | `MessagePathFunction`, `functionChain`, `isFullySpecified`, filter `operator` |
| `packages/message-path/src/parseFunction.ts` | Split `"mul(3.6)"` → `{name, operand, operandRaw}` |
| `packages/message-path/src/parser.ts` | Recursive-descent parser + diagnostics |
| `packages/message-path/src/parseMessagePath.ts` | Public `parseMessagePath` / `parseMessagePathWithDiagnostics` |
| `packages/message-path/src/stringifyMessagePath.ts` | Path → string |
| `packages/message-path/jest.config.json` | **Required** — this package's tests are currently not in any Jest project |
| `packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.ts` | Catalog, `applyFunctionChain`, `validateMessagePathFunctions` |
| `packages/studio-base/src/components/MessagePathSyntax/filterMatches.ts` | Filter operators |
| `packages/studio-base/src/components/MessagePathSyntax/simpleGetMessagePathDataItems.ts` | Walker + chain + negative index |
| `packages/studio-base/src/components/MessagePathSyntax/useCachedGetMessagePathDataItems.ts` | Cached walker + fill function operands |
| `packages/studio-base/src/components/MessagePathSyntax/suggestMessagePathCompletions.ts` | Type-based `.@` / filter suggestions |
| `packages/studio-base/src/components/MessagePathSyntax/MessagePathInput.tsx` | Flags + suggestions + error text |
| `packages/studio-base/src/panels/Plot/splitTimeSeriesFunctionChain.ts` | Split chain for Plot timestamp |
| `packages/studio-base/src/panels/Plot/mathFunctions.ts` | Delete after builders stop importing it |
| `packages/message-path/src/grammar.ne` | Delete |

---

### Task 1: `parseFunction` + Jest project for message-path

**Files:**
- Create: `packages/message-path/jest.config.json`
- Create: `packages/message-path/src/parseFunction.ts`
- Create: `packages/message-path/src/parseFunction.test.ts`
- Modify: `packages/message-path/src/index.ts`
- Modify: `packages/message-path/package.json` (remove `nearley` only in Task 5; this task only adds jest config)

**Interfaces:**
- Consumes: nothing
- Produces: `export type ParsedFunction = { name: string; operand?: number; operandRaw?: string }; export function parseFunction(functionStr: string): ParsedFunction | undefined; export const STRUCT_FUNCTION_NAMES: ReadonlySet<string>;`

- [ ] **Step 1: Add Jest project so message-path tests actually run**

Create `packages/message-path/jest.config.json`:

```json
{
  "testMatch": ["<rootDir>/src/**/*.test.ts(x)?"],
  "transform": {
    "\\.[jt]sx?$": "<rootDir>/../../jest.swc-transformer.js"
  },
  "transformIgnorePatterns": [],
  "haste": { "forceNodeFilesystemAPI": true }
}
```

Root `jest.config.json` already includes `"<rootDir>/packages/*/jest.config.json"`. No root change.

- [ ] **Step 2: Write the failing tests**

Create `packages/message-path/src/parseFunction.test.ts`:

```ts
import { parseFunction, STRUCT_FUNCTION_NAMES } from "./parseFunction";

describe("parseFunction", () => {
  it("parses a bare name", () => {
    expect(parseFunction("abs")).toEqual({ name: "abs" });
  });

  it("parses a numeric operand", () => {
    expect(parseFunction("mul(3.6)")).toEqual({
      name: "mul",
      operand: 3.6,
      operandRaw: "3.6",
    });
  });

  it("parses a variable operand", () => {
    expect(parseFunction("add($scale)")).toEqual({
      name: "add",
      operandRaw: "$scale",
    });
  });

  it("strips one pair of quotes around the operand", () => {
    expect(parseFunction(`mul("3.6")`)).toEqual({
      name: "mul",
      operand: 3.6,
      operandRaw: "3.6",
    });
  });

  it("treats empty parentheses as name-only", () => {
    expect(parseFunction("abs()")).toEqual({ name: "abs" });
  });

  it("returns undefined for an empty string", () => {
    expect(parseFunction("")).toBeUndefined();
  });
});

describe("STRUCT_FUNCTION_NAMES", () => {
  it("contains the 3.1.1 struct functions", () => {
    expect([...STRUCT_FUNCTION_NAMES].sort()).toEqual(["quat", "rpy", "ypr", "yrp"]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn jest packages/message-path/src/parseFunction.test.ts --runInBand`

Expected: FAIL resolving `./parseFunction` or `parseFunction is not a function`.

- [ ] **Step 4: Implement `parseFunction`**

```ts
export const STRUCT_FUNCTION_NAMES: ReadonlySet<string> = new Set(["rpy", "quat", "ypr", "yrp"]);

const FUNCTION_RE = /^([a-zA-Z0-9_-]+)(?:\((.*)\))?$/;

export type ParsedFunction = {
  name: string;
  operand?: number;
  operandRaw?: string;
};

export function parseFunction(functionStr: string): ParsedFunction | undefined {
  if (functionStr.length === 0) {
    return undefined;
  }
  const match = FUNCTION_RE.exec(functionStr);
  if (!match) {
    return { name: functionStr };
  }
  const name = match[1] ?? "";
  if (!name) {
    return undefined;
  }
  const raw = match[2];
  if (raw == undefined || raw.length === 0) {
    return { name };
  }
  const unquoted = raw.replace(/^["'](.*)["']$/s, "$1");
  const asNumber = Number(unquoted);
  if (Number.isNaN(asNumber)) {
    return { name, operandRaw: unquoted };
  }
  return { name, operand: asNumber, operandRaw: unquoted };
}
```

Export from `packages/message-path/src/index.ts`: `export * from "./parseFunction";`

- [ ] **Step 5: Re-run tests**

Run: `yarn jest packages/message-path/src/parseFunction.test.ts --runInBand`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/message-path/jest.config.json packages/message-path/src/parseFunction.ts packages/message-path/src/parseFunction.test.ts packages/message-path/src/index.ts
git commit -m "$(cat <<'EOF'
feat(message-path): add parseFunction and Jest project

FoxQL function suffixes store "mul(3.6)" as a single string; parseFunction
splits name and operand. Add a Jest project so this package's tests run.
EOF
)"
```

---

### Task 2: AST types and migrate existing parser tests off `modifier`

**Files:**
- Modify: `packages/message-path/src/types.ts`
- Modify: `packages/message-path/src/parseMessagePath.test.ts`
- Modify: `packages/studio-base/src/components/MessagePathSyntax/MessagePathInput.test.ts`
- Modify: `packages/studio-base/src/components/MessagePathSyntax/useCachedGetMessagePathDataItems.test.tsx`

**Interfaces:**
- Consumes: none of Task 1's runtime, only the upcoming `MessagePath` shape
- Produces:

```ts
export type MessagePathFunction = { function: string; fieldAccess?: string };
export type FilterOperator = "==" | "!=" | "<" | "<=" | ">" | ">=";
export type MessagePath = {
  topicName: string;
  topicNameRepr: string;
  messagePath: MessagePathPart[];
  functionChain?: MessagePathFunction[];
  isFullySpecified: boolean;
};
```

`MessagePathFilter` gains `operator?: FilterOperator` and `valueIsIdentifier?: boolean`. **Delete `modifier`.**

- [ ] **Step 1: Rewrite parser test expectations to the new AST (they will fail until Task 4)**

In `parseMessagePath.test.ts`:

- Remove `const MISSING = null`.
- Every complete path object must include `isFullySpecified: true` and omit `modifier`.
- `/some0/nice_topic.with[99].stuff[0].@derivative` must equal:

```ts
{
  topicName: "/some0/nice_topic",
  topicNameRepr: "/some0/nice_topic",
  messagePath: [
    { type: "name", name: "with", repr: "with" },
    { type: "slice", start: 99, end: 99 },
    { type: "name", name: "stuff", repr: "stuff" },
    { type: "slice", start: 0, end: 0 },
  ],
  functionChain: [{ function: "derivative" }],
  isFullySpecified: true,
}
```

- Every `{...}` filter fixture must include `operator: "=="` when a value is present.
- Unfinished `/topic.hi.@` must equal:

```ts
{
  topicName: "/topic",
  topicNameRepr: "/topic",
  messagePath: [{ type: "name", name: "hi", repr: "hi" }],
  functionChain: [{ function: "" }],
  isFullySpecified: false,
}
```

- Unfinished `/`, `/topic.`, `/topic.hi.`, `/topic.foo{}`, `/topic.foo{bar}` must set `isFullySpecified: false`.
- Keep the invalid-string cases that currently return `undefined`.

In `MessagePathInput.test.ts` and `useCachedGetMessagePathDataItems.test.tsx`, replace `modifier: undefined` with `isFullySpecified: true` (omit `functionChain`). Filter fixtures used there do not need `operator` until evaluation tests (default `==` in `filterMatches` when operator is missing, Task 7).

- [ ] **Step 2: Change `types.ts`**

Replace `modifier?: string` with `functionChain?: MessagePathFunction[]` and `isFullySpecified: boolean`. Extend `MessagePathFilter` as in Interfaces. Delete `modifier`.

- [ ] **Step 3: Run parser tests (expected FAIL on shape / missing `isFullySpecified`)**

Run: `yarn jest packages/message-path/src/parseMessagePath.test.ts --runInBand`

Expected: FAIL — Nearley still emits `modifier` and no `isFullySpecified`.

Leave them failing. Task 4 makes them pass. Do not commit a red suite except as part of Task 4.

- [ ] **Step 4: Temporary shim so the rest of the app still typechecks while parser is old**

Do **not** add a `modifier` shim. Fix compile errors in this task by deleting `path.modifier` reads and replacing with:

```ts
path.functionChain?.[0]?.function
```

only in files that would otherwise not compile: `TimestampDatasetsBuilder.ts`, `TimestampDatasetsBuilderImpl.ts` (`isDerivative`), `CustomDatasetsBuilder.ts` `getMathFn`, `CurrentCustomDatasetsBuilder.ts`, `IndexDatasetsBuilder.ts`, `stringifyRosPath.ts`. Keep using `mathFunctions[name]` until Task 10–11. `stringifyRosPath` should stringify `functionChain`:

```ts
(path.functionChain ?? [])
  .map((step) => `.@${step.function}${step.fieldAccess != undefined ? `.${step.fieldAccess}` : ""}`)
  .join("")
```

For `isFullySpecified` on the current Nearley parser, set it in `parseMessagePath.ts` after parse:

```ts
export function isFullySpecified(
  messagePath: MessagePathPart[],
  functionChain: MessagePathFunction[] | undefined,
): boolean {
  for (const part of messagePath) {
    if (part.type === "name" && part.name === "") {
      return false;
    }
    if (part.type === "filter" && (part.operator == undefined || part.value == undefined)) {
      return false;
    }
  }
  for (const step of functionChain ?? []) {
    if (step.function === "" || step.fieldAccess === "") {
      return false;
    }
  }
  return true;
}
```

Wire the old Nearley result: map `modifier` (if present, including `""`) to `functionChain: [{ function: modifier }]`, delete `modifier`, set `isFullySpecified`. This is a **temporary adapter** deleted in Task 4.

- [ ] **Step 5: Re-run parser tests**

Run: `yarn jest packages/message-path/src/parseMessagePath.test.ts --runInBand`

Expected: PASS with the adapter (single `.@id` only). Filter `operator: "=="` must be set by the adapter for `==` filters.

- [ ] **Step 6: Commit**

```bash
git add packages/message-path/src/types.ts packages/message-path/src/parseMessagePath.ts packages/message-path/src/parseMessagePath.test.ts packages/studio-base/src/components/MessagePathSyntax/stringifyRosPath.ts packages/studio-base/src/components/MessagePathSyntax/MessagePathInput.test.ts packages/studio-base/src/components/MessagePathSyntax/useCachedGetMessagePathDataItems.test.tsx packages/studio-base/src/panels/Plot
git commit -m "$(cat <<'EOF'
refactor(message-path): replace modifier with functionChain on MessagePath

Keep a temporary Nearley adapter so existing .@abs / .@derivative paths
still parse while the handwritten parser lands.
EOF
)"
```

---

### Task 3: Parser coverage for FoxQL suffixes and filter operators (failing tests first)

**Files:**
- Modify: `packages/message-path/src/parseMessagePath.test.ts`

**Interfaces:**
- Consumes: `parseMessagePath` from Task 2
- Produces: the cases Task 4 must satisfy

- [ ] **Step 1: Append these tests to `parseMessagePath.test.ts`**

```ts
describe("FoxQL function chains", () => {
  it("parses chained functions with struct field access", () => {
    expect(parseMessagePath("/imu.orientation.@rpy.yaw.@degrees")).toEqual({
      topicName: "/imu",
      topicNameRepr: "/imu",
      messagePath: [{ type: "name", name: "orientation", repr: "orientation" }],
      functionChain: [{ function: "rpy", fieldAccess: "yaw" }, { function: "degrees" }],
      isFullySpecified: true,
    });
  });

  it("parses an operand function", () => {
    expect(parseMessagePath("/wheel.speed.@mul(3.6)")).toEqual({
      topicName: "/wheel",
      topicNameRepr: "/wheel",
      messagePath: [{ type: "name", name: "speed", repr: "speed" }],
      functionChain: [{ function: "mul(3.6)" }],
      isFullySpecified: true,
    });
  });

  it("parses a variable operand", () => {
    expect(parseMessagePath("/wheel.speed.@mul($scale)")!.functionChain).toEqual([
      { function: "mul($scale)" },
    ]);
  });
});

describe("FoxQL filter operators", () => {
  it("parses != < <= > >=", () => {
    expect(parseMessagePath("/t.items[:]{id!=1}")!.messagePath[2]).toMatchObject({
      type: "filter",
      path: ["id"],
      operator: "!=",
      value: 1n,
      repr: "id!=1",
    });
    expect(parseMessagePath("/t.items[:]{id>1}")!.messagePath[2]).toMatchObject({
      type: "filter",
      operator: ">",
      value: 1n,
    });
    expect(parseMessagePath("/t.items[:]{id>=1}")!.messagePath[2]).toMatchObject({
      type: "filter",
      operator: ">=",
    });
    expect(parseMessagePath("/t.items[:]{id<1}")!.messagePath[2]).toMatchObject({
      type: "filter",
      operator: "<",
    });
    expect(parseMessagePath("/t.items[:]{id<=1}")!.messagePath[2]).toMatchObject({
      type: "filter",
      operator: "<=",
    });
  });

  it("parses an unquoted identifier filter value", () => {
    expect(parseMessagePath("/t.items[:]{status==MOVING}")!.messagePath[2]).toMatchObject({
      type: "filter",
      path: ["status"],
      operator: "==",
      value: "MOVING",
      valueIsIdentifier: true,
      repr: "status==MOVING",
    });
  });
});

describe("negative slice index", () => {
  it("parses [-1]", () => {
    expect(parseMessagePath("/t.arr[-1]")).toMatchObject({
      messagePath: [
        { type: "name", name: "arr", repr: "arr" },
        { type: "slice", start: -1, end: -1 },
      ],
      isFullySpecified: true,
    });
  });
});
```

If current Nearley already parses `[-1]` (integer rule allows `-`), that case may already pass. The chain/operator cases must fail.

- [ ] **Step 2: Run tests**

Run: `yarn jest packages/message-path/src/parseMessagePath.test.ts --runInBand`

Expected: FAIL on `.@rpy.yaw.@degrees`, `.@mul(3.6)`, `{id!=1}`, `{status==MOVING}` (Nearley stops at `.@id` and only parses `{==}`).

- [ ] **Step 3: Do not implement yet — commit the failing tests only if the suite is otherwise green. Prefer implementing Task 4 in the same sitting so CI never sits red.**

If you commit now, message must say `test: add failing FoxQL parse cases`. Otherwise skip commit and continue to Task 4.

---

### Task 4: Handwritten recursive-descent parser

**Files:**
- Create: `packages/message-path/src/parser.ts`
- Modify: `packages/message-path/src/parseMessagePath.ts`
- Delete: `packages/message-path/src/grammar.ne` (after tests pass)
- Delete: `packages/message-path/src/typings/extensions.ts` if it only typed `.ne`

**Interfaces:**
- Consumes: `parseFunction` (not required inside the scanner; function text is sliced raw), `isFullySpecified` from Task 2 (move it next to the parser)
- Produces:

```ts
export type MessagePathDiagnostic = {
  code: string;
  message: string;
  start: number;
  end: number;
};
export function parseMessagePathWithDiagnostics(input: string): {
  path: MessagePath | undefined;
  diagnostics: MessagePathDiagnostic[];
};
export function parseMessagePath(input: string): MessagePath | undefined;
```

Parser rules (implement all):

1. Topic: `"..."` with `\\` and `\"`; or `/` + identifier runs; or identifier + `/` runs.
2. While `{` → filter. While `.` not followed by `@` → name, then optional `[slice]`.
3. While `.@` → function name (`[A-Za-z0-9_-]*`), optional `( ... )` to matching `)`, optional `.field` unless next is `.@`.
4. Filter operators tried in order `== != <= >= < >`.
5. Filter value: `$ident`, quoted string, `true`/`false`, number (bigint when `/^[+-]?[0-9]+$/` and `BigInt(n) !== BigInt(Number(n))` **or** always bigint for that regex — match existing tests: `{bar==3}` is `3n`, `{bar==-1}` is `-1n`, `{baz==2}` is `2n`). Use: if the raw token matches `/^[+-]?[0-9]+$/`, store `BigInt(raw)` when `BigInt(Number(raw)) !== BigInt(raw)` else... Existing tests expect `2n` for `2`. So **all integer-only filter numbers are bigint**. Slice numbers stay `Number(...)`.
6. Incomplete: empty name after `.`, empty function after `.@`, `{` without close, `{path}` without operator — still return a path, `isFullySpecified: false`.
7. Unrecoverable (`undefined` path): unclosed quoted topic/field, `[0][1]`, `[]`, `[bar]`, chars after a complete expression that are not a valid continuation.

- [ ] **Step 1: Implement parser.ts + switch parseMessagePath.ts off Nearley**

`parseMessagePath` becomes:

```ts
export function parseMessagePath(input: string): MessagePath | undefined {
  return parseMessagePathWithDiagnostics(input).path;
}
```

Remove `import { Grammar, Parser } from "nearley"` and `grammar.ne`.

Keep `quoteTopicNameIfNeeded` / `quoteFieldNameIfNeeded` in `parseMessagePath.ts` or move next to stringify.

- [ ] **Step 2: Run parser tests**

Run: `yarn jest packages/message-path/src/parseMessagePath.test.ts --runInBand`

Expected: PASS including Task 3 cases.

If a current valid path fails, fix the parser; do not weaken tests.

- [ ] **Step 3: Delete `grammar.ne` and unused nearley typings in this package. Remove `nearley` and `@types/nearley` from `packages/message-path/package.json`.**

Leave studio-base `nearley-loader` until you confirm no remaining `.ne` files (`rg "\\.ne$" -g '!node_modules'`).

- [ ] **Step 4: Commit**

```bash
git add packages/message-path
git commit -m "$(cat <<'EOF'
feat(message-path): replace Nearley with a FoxQL recursive-descent parser

Parse function chains, operand suffixes, and filter operators != < <= > >=
plus unquoted enum identifiers, matching Foxglove 3.1.1 visualization FoxQL.
EOF
)"
```

---

### Task 5: Stringify round-trip and fill function operands

**Files:**
- Create: `packages/message-path/src/stringifyMessagePath.ts`
- Modify: `packages/studio-base/src/components/MessagePathSyntax/stringifyRosPath.ts` (re-export)
- Modify: `packages/studio-base/src/components/MessagePathSyntax/stringifyRosPath.test.ts`
- Modify: `packages/studio-base/src/components/MessagePathSyntax/useCachedGetMessagePathDataItems.ts` (`fillInGlobalVariablesInPath`)
- Modify: `packages/message-path/src/index.ts`

**Interfaces:**
- Consumes: `MessagePath`, `parseFunction`
- Produces: `export function stringifyMessagePath(path: MessagePath): string;`
- `fillInGlobalVariablesInPath` must rewrite `functionChain` entries whose operand is `$name` when `globalVariables[name]` is a number: `mul($scale)` + `{scale: 3.6}` → `mul(3.6)`.

- [ ] **Step 1: Extend stringify tests**

In `stringifyRosPath.test.ts` add to the `paths` array:

```ts
"/imu.orientation.@rpy.yaw.@degrees",
"/wheel.speed.@mul(3.6)",
"/topic.items[:]{id!=1}.name",
```

Add:

```ts
it("fills a function operand variable", () => {
  expect(
    stringifyMessagePath(
      fillInGlobalVariablesInPath(parseMessagePath("/wheel.speed.@mul($scale)")!, {
        scale: 3.6,
      }),
    ),
  ).toEqual("/wheel.speed.@mul(3.6)");
});
```

- [ ] **Step 2: Run tests (fail on new strings if stringify drops chains/operators)**

Run: `yarn jest packages/studio-base/src/components/MessagePathSyntax/stringifyRosPath.test.ts --runInBand`

Expected: FAIL until stringify emits `.@rpy.yaw.@degrees` and `{id!=1}`, and fill rewrites `$scale`.

- [ ] **Step 3: Implement stringify in message-path**

```ts
export function stringifyMessagePath(path: MessagePath): string {
  return (
    path.topicNameRepr +
    path.messagePath.map(stringifyPart).join("") +
    (path.functionChain ?? [])
      .map(
        (step) =>
          `.@${step.function}${step.fieldAccess != undefined ? `.${step.fieldAccess}` : ""}`,
      )
      .join("")
  );
}
```

Filter stringify uses `filter.repr` inside `{}` (already how Honeybee works). Name → `.${repr}`. Slice same as current `stringifyRosPath.ts`.

`stringifyRosPath.ts` becomes: `export { stringifyMessagePath } from "@foxglove/message-path";`

Fill function operands:

```ts
function fillFunctionOperand(step: MessagePathFunction, vars: GlobalVariables): MessagePathFunction {
  const parsed = parseFunction(step.function);
  const raw = parsed?.operandRaw?.trim();
  if (raw?.startsWith("$") !== true) {
    return step;
  }
  const value = vars[raw.slice(1)];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return step;
  }
  return { ...step, function: `${parsed!.name}(${value})` };
}
```

- [ ] **Step 4: Re-run stringify tests**

Run: `yarn jest packages/studio-base/src/components/MessagePathSyntax/stringifyRosPath.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/message-path/src/stringifyMessagePath.ts packages/message-path/src/index.ts packages/studio-base/src/components/MessagePathSyntax/stringifyRosPath.ts packages/studio-base/src/components/MessagePathSyntax/stringifyRosPath.test.ts packages/studio-base/src/components/MessagePathSyntax/useCachedGetMessagePathDataItems.ts
git commit -m "$(cat <<'EOF'
feat(message-path): stringify FoxQL chains and fill function operands
EOF
)"
```

---

### Task 6: Function catalog + `validateMessagePathFunctions`

**Files:**
- Create: `packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.ts`
- Create: `packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.test.ts`

**Interfaces:**
- Consumes: `parseFunction`, `STRUCT_FUNCTION_NAMES`, `MessagePath`
- Produces:

```ts
export const SCALAR_FUNCTION_NAMES: readonly string[];
export const OPERAND_FUNCTION_NAMES: readonly string[]; // ["add","sub","mul","div"]
export const ARRAY_FUNCTION_NAMES: readonly string[]; // ["length"]
export const VECTOR_FUNCTION_NAMES: readonly string[]; // ["norm"]
export const TIME_SERIES_FUNCTION_NAMES: readonly string[]; // ["delta","derivative","timedelta"]
export const STRUCT_FIELD_ACCESS: Record<string, readonly string[]>;
// rpy/ypr/yrp: roll,pitch,yaw; quat: x,y,z,w

export type MessagePathFunctionSupport = {
  supportsMessagePathFunctions: boolean;
  supportsTimeSeriesMessagePathFunctions: boolean;
  globalVariables: Record<string, unknown>;
};

export function compileScalarFunction(functionStr: string): ((n: number) => number) | undefined;
export function validateMessagePathFunctions(
  parsed: MessagePath,
  support: MessagePathFunctionSupport,
  terminatingItem?: MessagePathStructureItem,
): string | undefined;
```

Catalog names (copy exactly):  
`abs acos asin atan ceil cos log log1p log2 log10 round sign sin sqrt tan trunc negative radians degrees add sub mul div length norm rpy ypr yrp quat delta derivative timedelta`

`radians` = `n * Math.PI / 180`. `degrees` = `n * 180 / Math.PI`. **No `deg2rad` / `rad2deg` keys.**

- [ ] **Step 1: Write validation tests**

```ts
import { parseMessagePath } from "@foxglove/message-path";

import {
  compileScalarFunction,
  validateMessagePathFunctions,
} from "./messagePathFunctions";

const plotSupport = {
  supportsMessagePathFunctions: true,
  supportsTimeSeriesMessagePathFunctions: true,
  globalVariables: {},
};

const gaugeSupport = {
  ...plotSupport,
  supportsTimeSeriesMessagePathFunctions: false,
};

describe("compileScalarFunction", () => {
  it("maps 3.1.1 names", () => {
    expect(compileScalarFunction("abs")!(-3)).toBe(3);
    expect(compileScalarFunction("degrees")!(Math.PI)).toBeCloseTo(180);
    expect(compileScalarFunction("radians")!(180)).toBeCloseTo(Math.PI);
    expect(compileScalarFunction("mul(3.6)")!(10)).toBeCloseTo(36);
    expect(compileScalarFunction("negative")!(4)).toBe(-4);
  });

  it("does not compile deg2rad/rad2deg", () => {
    expect(compileScalarFunction("deg2rad")).toBeUndefined();
    expect(compileScalarFunction("rad2deg")).toBeUndefined();
  });
});

describe("validateMessagePathFunctions", () => {
  it("rejects functions when the field disables them", () => {
    const parsed = parseMessagePath("/t.v.@abs")!;
    expect(
      validateMessagePathFunctions(parsed, {
        supportsMessagePathFunctions: false,
        supportsTimeSeriesMessagePathFunctions: false,
        globalVariables: {},
      }),
    ).toMatch(/does not accept functions/i);
  });

  it("rejects time-series on gauge", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@derivative")!, gaugeSupport),
    ).toMatch(/time-series/i);
  });

  it("rejects unknown names including deg2rad", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@deg2rad")!, plotSupport),
    ).toMatch(/not a valid function/i);
  });

  it("rejects operand-less mul and extra operand on abs", () => {
    expect(validateMessagePathFunctions(parseMessagePath("/t.v.@mul")!, plotSupport)).toBeDefined();
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@abs(1)")!, plotSupport),
    ).toBeDefined();
  });

  it("rejects a second time-series or @derivative.@norm", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@derivative.@derivative")!, plotSupport),
    ).toBeDefined();
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@derivative.@norm")!, plotSupport),
    ).toBeDefined();
  });

  it("allows @derivative.@abs on plot", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@derivative.@abs")!, plotSupport),
    ).toBeUndefined();
  });

  it("rejects field access on non-struct functions and bad struct fields", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@abs.yaw")!, plotSupport),
    ).toBeDefined();
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@rpy.w")!, plotSupport),
    ).toBeDefined();
  });

  it("requires $operand to be a numeric global", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@mul($scale)")!, {
        ...plotSupport,
        globalVariables: { scale: "nope" },
      }),
    ).toMatch(/not a numeric global/i);
  });

  it("rejects @length when the terminating value is not an array", () => {
    expect(
      validateMessagePathFunctions(parseMessagePath("/t.v.@length")!, plotSupport, {
        structureType: "primitive",
        primitiveType: "float64",
        datatype: "float64",
      }),
    ).toMatch(/array/i);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `yarn jest packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.test.ts --runInBand`

Expected: FAIL module not found.

- [ ] **Step 3: Implement catalog + validate**

Rules for `validateMessagePathFunctions`:

- No `functionChain` → `undefined` (valid).
- If `supportsMessagePathFunctions !== true` → error string containing `does not accept functions`.
- For each step, `parseFunction` then:
  - name must be in the catalog
  - operand functions require finite number or `$Var` whose `globalVariables` value `typeof === "number"`
  - other names must have `operandRaw == undefined`
- `fieldAccess` only if name ∈ STRUCT and access is in `STRUCT_FIELD_ACCESS[name]`
- Walk names: at most one of `delta|derivative|timedelta`; after that only scalar/operand (`compileScalarFunction` succeeds). If any time-series and `supportsTimeSeriesMessagePathFunctions === false` → time-series error.

`compileScalarFunction`: Math table + operand closures. Return `undefined` for struct/array/vector/time-series/unknown.

- [ ] **Step 4: Re-run tests**

Run: `yarn jest packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.ts packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.test.ts
git commit -m "$(cat <<'EOF'
feat: add FoxQL function catalog and chain validation
EOF
)"
```

---

### Task 7: `applyFunctionChain` evaluation goldens

**Files:**
- Modify: `packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.ts`
- Modify: `packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.test.ts`

**Interfaces:**
- Consumes: `compileScalarFunction`, `parseFunction`, `STRUCT_FUNCTION_NAMES`
- Produces: `export function applyFunctionChain(value: unknown, functionChain: MessagePathFunction[] | undefined): unknown;`

Time-series steps are **skipped** (identity). Unknown names skipped. Failed apply returns `undefined`.

Use `isTime` / `toSec` from `@foxglove/rostime`. Use `three` `Quaternion` + `Euler` for struct conversions (`"XYZ"` / `"ZYX"` / `"ZXY"`). `quat` from rpy uses the inverse of `rpy` (Euler `"XYZ"` → quaternion).

- [ ] **Step 1: Append evaluation tests**

```ts
import { applyFunctionChain } from "./messagePathFunctions";

const SQ2 = Math.SQRT1_2; // 90° yaw quaternion z/w

describe("applyFunctionChain", () => {
  it("applies scalar and operand", () => {
    expect(applyFunctionChain(-3, [{ function: "abs" }])).toBe(3);
    expect(applyFunctionChain(10, [{ function: "mul(3.6)" }])).toBeCloseTo(36);
  });

  it("computes length and norm", () => {
    expect(applyFunctionChain([1, 2, 3], [{ function: "length" }])).toBe(3);
    expect(applyFunctionChain({ x: 3, y: 4 }, [{ function: "norm" }])).toBe(5);
    expect(applyFunctionChain({ x: 0, y: 0, z: 1 }, [{ function: "norm" }])).toBe(1);
  });

  it("converts quaternion yaw to degrees", () => {
    expect(
      applyFunctionChain(
        { x: 0, y: 0, z: 0, w: 1 },
        [{ function: "rpy", fieldAccess: "yaw" }, { function: "degrees" }],
      ),
    ).toBeCloseTo(0);
    expect(
      applyFunctionChain(
        { x: 0, y: 0, z: SQ2, w: SQ2 },
        [{ function: "rpy", fieldAccess: "yaw" }, { function: "degrees" }],
      ),
    ).toBeCloseTo(90);
  });

  it("reads a Time value as seconds before math", () => {
    expect(
      applyFunctionChain({ sec: 1, nsec: 500_000_000 }, [{ function: "mul(1000)" }]),
    ).toBeCloseTo(1500);
  });

  it("skips time-series and unknown names", () => {
    expect(applyFunctionChain(5, [{ function: "derivative" }])).toBe(5);
    expect(applyFunctionChain(180, [{ function: "deg2rad" }])).toBe(180);
  });

  it("returns undefined when length/norm cannot apply", () => {
    expect(applyFunctionChain(5, [{ function: "length" }])).toBeUndefined();
    expect(applyFunctionChain({ a: 1 }, [{ function: "norm" }])).toBeUndefined();
  });

  it("maps scalar across numeric object fields", () => {
    expect(applyFunctionChain({ x: -1, y: 2, name: "n" }, [{ function: "abs" }])).toEqual({
      x: 1,
      y: 2,
      name: "n",
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `yarn jest packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.test.ts --runInBand`

Expected: FAIL `applyFunctionChain is not a function`.

- [ ] **Step 3: Implement `applyFunctionChain`**

Order per step: parse name → if time-series or unknown, continue → if `length`, require array/typed array → if `norm`, hypot object or numeric array → if struct, convert then optional field → else `compileScalarFunction` on coerced number or map object numeric fields.

Coerce: `bigint`/`boolean`/`number` as number; string via `Number`; Time via `isTime`+`toSec`.

- [ ] **Step 4: Re-run tests**

Run: `yarn jest packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.test.ts --runInBand`

Expected: PASS (yaw golden uses `toBeCloseTo(90)` — if three.js Euler returns a wrap near -270, fix conversion to match Foxglove XYZ and the golden, not the other way around).

- [ ] **Step 5: Commit**

```bash
git add packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.ts packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.test.ts
git commit -m "$(cat <<'EOF'
feat: evaluate FoxQL function chains per sample
EOF
)"
```

---

### Task 8: Filter operators + walker integration

**Files:**
- Modify: `packages/studio-base/src/components/MessagePathSyntax/filterMatches.ts`
- Create: `packages/studio-base/src/components/MessagePathSyntax/filterMatches.test.ts`
- Modify: `packages/studio-base/src/components/MessagePathSyntax/simpleGetMessagePathDataItems.ts`
- Modify: `packages/studio-base/src/components/MessagePathSyntax/simpleGetMessagePathDataItems.test.ts`
- Modify: `packages/studio-base/src/components/MessagePathSyntax/useCachedGetMessagePathDataItems.ts`

**Interfaces:**
- Consumes: `applyFunctionChain`, `MessagePathFilter.operator`, `valueIsIdentifier`
- Produces: walkers that apply `functionChain` after path traversal; `filterMatches` for six operators

- [ ] **Step 1: Filter unit tests**

```ts
import { filterMatches } from "./filterMatches";

const base = {
  type: "filter" as const,
  path: ["id"],
  nameLoc: 0,
  valueLoc: 0,
  repr: "",
};

describe("filterMatches", () => {
  it("supports six operators", () => {
    expect(filterMatches({ ...base, operator: "==", value: 1, repr: "id==1" }, { id: 1 })).toBe(
      true,
    );
    expect(filterMatches({ ...base, operator: "!=", value: 1, repr: "id!=1" }, { id: 2 })).toBe(
      true,
    );
    expect(filterMatches({ ...base, operator: ">", value: 1, repr: "id>1" }, { id: 2 })).toBe(true);
    expect(filterMatches({ ...base, operator: ">=", value: 1, repr: "id>=1" }, { id: 1 })).toBe(
      true,
    );
    expect(filterMatches({ ...base, operator: "<", value: 1, repr: "id<1" }, { id: 0 })).toBe(true);
    expect(filterMatches({ ...base, operator: "<=", value: 1, repr: "id<=1" }, { id: 1 })).toBe(
      true,
    );
    expect(filterMatches({ ...base, operator: ">", value: 1, repr: "id>1" }, { id: 1 })).toBe(false);
  });

  it("keeps loose == for 1 and true", () => {
    expect(filterMatches({ ...base, operator: "==", value: 1, repr: "id==1" }, { id: true })).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Walker tests in `simpleGetMessagePathDataItems.test.ts`**

Reuse the existing `MessageEvent` helper shape. Add:

```ts
function msg(message: unknown): MessageEvent {
  return {
    topic: "/foo",
    receiveTime: { sec: 0, nsec: 0 },
    sizeInBytes: 0,
    schemaName: "datatype",
    message,
  };
}

it("applies function chains", () => {
  expect(simpleGetMessagePathDataItems(msg({ v: -3 }), parseMessagePath("/foo.v.@abs")!)).toEqual([
    3,
  ]);
  expect(
    simpleGetMessagePathDataItems(msg({ v: { x: 3, y: 4 } }), parseMessagePath("/foo.v.@norm")!),
  ).toEqual([5]);
});

it("filters with > and negative index", () => {
  const payload = { items: [{ id: 1 }, { id: 2 }], arr: [10, 20, 30] };
  expect(
    simpleGetMessagePathDataItems(msg(payload), parseMessagePath("/foo.items[:]{id>1}.id")!),
  ).toEqual([2]);
  expect(simpleGetMessagePathDataItems(msg(payload), parseMessagePath("/foo.arr[-1]")!)).toEqual([
    30,
  ]);
});
```

- [ ] **Step 3: Run tests**

Run:

```sh
yarn jest packages/studio-base/src/components/MessagePathSyntax/filterMatches.test.ts packages/studio-base/src/components/MessagePathSyntax/simpleGetMessagePathDataItems.test.ts --runInBand
```

Expected: FAIL on `>` (always equality) and `[-1]` / `.@abs` until implementation.

- [ ] **Step 4: Implement**

`filterMatches`: default `operator` to `"=="`. Switch on operator. Keep loose `==` / `!=` (`==` / `!=`). Relational operators use `<` `<=` `>` `>=`. If `value` is an object (unfilled variable), throw the existing error.

`simpleGetMessagePathDataItems`: after `traverse` finishes pushing raw values, map through `applyFunctionChain(value, filledInPath.functionChain)` and drop `undefined`. Better: when `pathPart == undefined` (end of path), push `applyFunctionChain(value, filledInPath.functionChain)` if not `undefined`.

Negative slice:

```ts
const length = value.length;
for (let i = start; i <= end; i++) {
  const index = i >= 0 ? i : length + i;
  if (index < 0 || index >= length) {
    continue;
  }
  traverse(value[index], pathIndex + 1);
}
```

`getMessagePathDataItems`: at the leaf `queriedData.push`, set `value` to `applyFunctionChain(value, filledInPath.functionChain) ?? skip`. Skip pushing when the result is `undefined`.

- [ ] **Step 5: Re-run walker + existing cached tests**

```sh
yarn jest packages/studio-base/src/components/MessagePathSyntax/filterMatches.test.ts packages/studio-base/src/components/MessagePathSyntax/simpleGetMessagePathDataItems.test.ts packages/studio-base/src/components/MessagePathSyntax/useCachedGetMessagePathDataItems.test.tsx --runInBand
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/studio-base/src/components/MessagePathSyntax/filterMatches.ts packages/studio-base/src/components/MessagePathSyntax/filterMatches.test.ts packages/studio-base/src/components/MessagePathSyntax/simpleGetMessagePathDataItems.ts packages/studio-base/src/components/MessagePathSyntax/simpleGetMessagePathDataItems.test.ts packages/studio-base/src/components/MessagePathSyntax/useCachedGetMessagePathDataItems.ts
git commit -m "$(cat <<'EOF'
feat: apply FoxQL functions and filter operators in message-path walkers
EOF
)"
```

---

### Task 9: Plot `splitTimeSeriesFunctionChain` + timestamp series

**Files:**
- Create: `packages/studio-base/src/panels/Plot/splitTimeSeriesFunctionChain.ts`
- Create: `packages/studio-base/src/panels/Plot/splitTimeSeriesFunctionChain.test.ts`
- Modify: `packages/studio-base/src/panels/Plot/builders/TimestampDatasetsBuilder.ts`
- Modify: `packages/studio-base/src/panels/Plot/builders/TimestampDatasetsBuilderImpl.ts`
- Modify: `packages/studio-base/src/panels/Plot/builders/TimestampDatasetsBuilderImpl.test.ts`
- Modify: `packages/studio-base/src/panels/Plot/builders/TimestampDatasetsBuilder.test.ts` if it references `modifier`

**Interfaces:**
- Consumes: `compileScalarFunction`, `parseFunction`, `TIME_SERIES_FUNCTION_NAMES`, `MessagePath`
- Produces:

```ts
export type TimeSeriesName = "delta" | "derivative" | "timedelta";
export function splitTimeSeriesFunctionChain(path: MessagePath): {
  pathBeforeSpecialFunction: MessagePath;
  specialFunction: TimeSeriesName | undefined;
  postSpecialScalarFunctions: Array<(n: number) => number>;
};
```

- [ ] **Step 1: Split tests**

```ts
import { parseMessagePath } from "@foxglove/message-path";

import { splitTimeSeriesFunctionChain } from "./splitTimeSeriesFunctionChain";

describe("splitTimeSeriesFunctionChain", () => {
  it("keeps a scalar-only chain on the path", () => {
    const path = parseMessagePath("/t.v.@abs")!;
    const split = splitTimeSeriesFunctionChain(path);
    expect(split.specialFunction).toBeUndefined();
    expect(split.pathBeforeSpecialFunction.functionChain).toEqual([{ function: "abs" }]);
    expect(split.postSpecialScalarFunctions).toEqual([]);
  });

  it("splits @mul then @derivative then @abs", () => {
    const split = splitTimeSeriesFunctionChain(parseMessagePath("/t.v.@mul(2).@derivative.@abs")!);
    expect(split.pathBeforeSpecialFunction.functionChain).toEqual([{ function: "mul(2)" }]);
    expect(split.specialFunction).toBe("derivative");
    expect(split.postSpecialScalarFunctions).toHaveLength(1);
    expect(split.postSpecialScalarFunctions[0]!(-4)).toBe(4);
  });
});
```

- [ ] **Step 2: Timestamp goldens in `TimestampDatasetsBuilderImpl.test.ts`**

Keep every existing `@derivative` test. Add (mirror `returns the plotted derivative value in the legend`):

```ts
it("plots delta and timedelta", () => {
  const impl = new TimestampDatasetsBuilderImpl();
  const delta = makeSeries("delta", 0, { path: "/topic.value.@delta" });
  impl.applyActions([
    updateSeries([delta]),
    append("append-full", delta, [makeItem(0, 1), makeItem(2, 4)]),
  ]);
  expect(
    impl.getViewportDatasetsWithCurrentValues(viewport(), { sec: 2, nsec: 0 })
      .currentValuesByConfigIndex,
  ).toEqual([3]);
});

it("applies @derivative.@abs in the legend", () => {
  const impl = new TimestampDatasetsBuilderImpl();
  const series = makeSeries("der-abs", 0, { path: "/topic.value.@derivative.@abs" });
  impl.applyActions([
    updateSeries([series]),
    append("append-full", series, [makeItem(0, 0), makeItem(2, -20)]),
  ]);
  expect(
    impl.getViewportDatasetsWithCurrentValues(viewport(), { sec: 2, nsec: 0 })
      .currentValuesByConfigIndex,
  ).toEqual([10]);
});
```

`makeItem(x, y)` already used in that file — match its signature. If `makeSeries` stores `parsed: parseMessagePath(path)`, it will pick up `functionChain` automatically.

- [ ] **Step 3: Run tests**

```sh
yarn jest packages/studio-base/src/panels/Plot/splitTimeSeriesFunctionChain.test.ts packages/studio-base/src/panels/Plot/builders/TimestampDatasetsBuilderImpl.test.ts --runInBand
```

Expected: FAIL new tests; **existing derivative tests must still pass**. If derivative tests fail after Task 2's `isDerivative` change, fix `isDerivative` to:

```ts
function isDerivative(series: Series): boolean {
  return series.config.parsed.functionChain?.some(
    (step) => parseFunction(step.function)?.name === "derivative",
  ) === true;
}
```

until the impl uses `specialFunction` from the split.

- [ ] **Step 4: Implement split + apply in TimestampDatasetsBuilderImpl**

`splitTimeSeriesFunctionChain`: find first step whose parsed name is in `["delta","derivative","timedelta"]`. `pathBeforeSpecialFunction` is a copy with `functionChain` = steps before that (or `undefined` if empty). `postSpecialScalarFunctions` = `compileScalarFunction` for each following step (caller already validated).

`readMessagePathItems` in `TimestampDatasetsBuilder.ts`: stop passing `mathFn`. Call `simpleGetMessagePathDataItems` on `pathBeforeSpecialFunction` (fill variables first). Store `specialFunction` + post scalars on the series config or compute in the impl from `parsed`.

In `getSeriesY` / append path, replace `modifier === "derivative"` with the split:

- first point of a time-series series: skip / NaN as today for derivative
- `timedelta`: `x - prevX`
- `delta`: `y - prevY`
- `derivative`: `(y - prevY) / (x - prevX)` or NaN if dx === 0
- then fold `postSpecialScalarFunctions`

Remove `mathFunctions` import from `TimestampDatasetsBuilder.ts`.

- [ ] **Step 5: Re-run timestamp tests including `TimestampDatasetsBuilder.test.ts`**

```sh
yarn jest packages/studio-base/src/panels/Plot/splitTimeSeriesFunctionChain.test.ts packages/studio-base/src/panels/Plot/builders/TimestampDatasetsBuilderImpl.test.ts packages/studio-base/src/panels/Plot/builders/TimestampDatasetsBuilder.test.ts --runInBand
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/studio-base/src/panels/Plot
git commit -m "$(cat <<'EOF'
feat(plot): apply FoxQL time-series functions with trailing scalars
EOF
)"
```

---

### Task 10: Index / custom Plot builders drop `mathFunctions`

**Files:**
- Modify: `packages/studio-base/src/panels/Plot/builders/IndexDatasetsBuilder.ts`
- Modify: `packages/studio-base/src/panels/Plot/builders/CurrentCustomDatasetsBuilder.ts`
- Modify: `packages/studio-base/src/panels/Plot/builders/CustomDatasetsBuilder.ts`
- Modify: `packages/studio-base/src/panels/Plot/builders/IndexDatasetsBuilder.test.ts`
- Modify: `packages/studio-base/src/panels/Plot/builders/CurrentCustomDatasetsBuilder.test.ts`
- Modify: `packages/studio-base/src/panels/Plot/builders/CustomDatasetsBuilder.test.ts` / `CustomDatasetsBuilderImpl.test.ts` if they use `modifier`

**Interfaces:**
- Consumes: walker already applies scalar/operand/norm/length/struct. These builders only need `getChartValue` on walker output.
- Produces: no `mathFn` parameter; time-series names on these x-axis modes are not applied (walker skips them). Validation in Task 12 flags them in the UI.

- [ ] **Step 1: Confirm existing `@abs` tests still express the contract**

`IndexDatasetsBuilder.test.ts` already has `value: "/bar.val.@abs"` expecting `y: 3` for `val: -3`. Same for `CurrentCustomDatasetsBuilder.test.ts`. Do not weaken them.

Add one operand case to `IndexDatasetsBuilder.test.ts` (copy the `@abs` test, change path to `/bar.val.@mul(2)` and `val: 3`, expect `y: 6`).

- [ ] **Step 2: Run tests (may already pass if walker applies `@abs`)**

```sh
yarn jest packages/studio-base/src/panels/Plot/builders/IndexDatasetsBuilder.test.ts packages/studio-base/src/panels/Plot/builders/CurrentCustomDatasetsBuilder.test.ts packages/studio-base/src/panels/Plot/builders/CustomDatasetsBuilder.test.ts --runInBand
```

Expected: `@abs` PASS via walker. If builders still apply `mathFunctions[modifier]` and `modifier` is gone, they may double-apply or skip — **remove mathFn** so `@abs` is applied once in the walker.

- [ ] **Step 3: Delete mathFn plumbing**

Remove `mathFunctions` imports and `path.modifier` / `parsed.modifier` usage. `readMessagePathItems(..., mathFunction)` should drop the last argument and use walker values as-is.

- [ ] **Step 4: Re-run the three builder test files**

Expected: PASS, including new `@mul(2)` case.

- [ ] **Step 5: Delete `packages/studio-base/src/panels/Plot/mathFunctions.ts` if nothing imports it (`rg mathFunctions`).**

- [ ] **Step 6: Commit**

```bash
git add packages/studio-base/src/panels/Plot
git commit -m "$(cat <<'EOF'
refactor(plot): evaluate FoxQL functions in the path walker, not mathFunctions
EOF
)"
```

---

### Task 11: Type-based autocomplete helper

**Files:**
- Create: `packages/studio-base/src/components/MessagePathSyntax/suggestMessagePathCompletions.ts`
- Create: `packages/studio-base/src/components/MessagePathSyntax/suggestMessagePathCompletions.test.ts`
- Modify: `packages/studio-base/src/components/MessagePathSyntax/MessagePathInput.tsx`
- Modify: `packages/studio/src/index.ts` (`SettingsTreeFieldMessagePath`)
- Modify: `packages/studio-base/src/components/SettingsTreeEditor/FieldEditor.tsx`

**Interfaces:**
- Consumes: `parseMessagePath`, function name lists from `messagePathFunctions.ts`, `traverseStructure`
- Produces:

```ts
export function suggestFunctionSuffixes(args: {
  terminatingItem: MessagePathStructureItem | undefined;
  support: MessagePathFunctionSupport;
}): string[]; // e.g. "@abs", "@mul(", "@length", "@norm", "@rpy.yaw", "@derivative"

export function validateMessagePathInput(
  path: string,
  support: MessagePathFunctionSupport,
): string | undefined;
```

`validateMessagePathInput`: parse; if `undefined` return `"Invalid expression"`; if `!isFullySpecified` return `"Invalid expression"` when the user is not mid-edit... **Do not block incomplete paths while the cursor is in `.@` or `{`**. MessagePathInput already uses `autocompleteType != undefined` as error. Keep that. Additional error: `validateMessagePathFunctions` when `isFullySpecified` and chain present.

When `supportsMessagePathFunctions` is false and the path includes `.@`, error (replace `usesUnsupportedMathModifier`).

- [ ] **Step 1: Suggestion tests**

```ts
import {
  suggestFunctionSuffixes,
  validateMessagePathInput,
} from "./suggestMessagePathCompletions";
import { messagePathStructures } from "./messagePathsForDatatype";

const plotSupport = {
  supportsMessagePathFunctions: true,
  supportsTimeSeriesMessagePathFunctions: true,
  globalVariables: {},
};

const floatItem = {
  structureType: "primitive" as const,
  primitiveType: "float64" as const,
  datatype: "float64",
};

describe("suggestFunctionSuffixes", () => {
  it("suggests scalar and operand on a number", () => {
    const items = suggestFunctionSuffixes({ terminatingItem: floatItem, support: plotSupport });
    expect(items).toEqual(expect.arrayContaining(["@abs", "@mul(", "@degrees", "@derivative"]));
  });

  it("omits time-series when disabled", () => {
    const items = suggestFunctionSuffixes({
      terminatingItem: floatItem,
      support: { ...plotSupport, supportsTimeSeriesMessagePathFunctions: false },
    });
    expect(items).not.toEqual(expect.arrayContaining(["@derivative"]));
    expect(items).toEqual(expect.arrayContaining(["@abs"]));
  });

  it("suggests length on arrays and norm on xyz", () => {
    expect(
      suggestFunctionSuffixes({
        terminatingItem: {
          structureType: "array",
          next: floatItem,
          datatype: "float64[]",
        },
        support: plotSupport,
      }),
    ).toEqual(expect.arrayContaining(["@length"]));
    expect(
      suggestFunctionSuffixes({
        terminatingItem: {
          structureType: "message",
          datatype: "Vector3",
          nextByName: {
            x: floatItem,
            y: floatItem,
            z: floatItem,
          },
        },
        support: plotSupport,
      }),
    ).toEqual(expect.arrayContaining(["@norm"]));
  });

  it("suggests rpy fields on a quaternion-shaped message", () => {
    const items = suggestFunctionSuffixes({
      terminatingItem: {
        structureType: "message",
        datatype: "Quaternion",
        nextByName: {
          x: floatItem,
          y: floatItem,
          z: floatItem,
          w: floatItem,
        },
      },
      support: plotSupport,
    });
    expect(items).toEqual(expect.arrayContaining(["@rpy.yaw", "@rpy.roll", "@rpy.pitch"]));
  });
});

describe("validateMessagePathInput", () => {
  it("errors when functions are disabled", () => {
    expect(
      validateMessagePathInput("/t.v.@abs", {
        supportsMessagePathFunctions: false,
        supportsTimeSeriesMessagePathFunctions: false,
        globalVariables: {},
      }),
    ).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `yarn jest packages/studio-base/src/components/MessagePathSyntax/suggestMessagePathCompletions.test.ts --runInBand`

Expected: FAIL module not found.

- [ ] **Step 3: Implement suggestions**

Number primitive → all scalar names as `@abs`, operand as `@mul(` `@add(` `@sub(` `@div(`, plus time-series if allowed.  
Array → `@length` plus scalar if the panel still wants them on length results (Foxglove still lists scalar in the docs for all panels; **include scalar+operand+length** for arrays).  
Message with numeric `x` and `y` (optional `z`) → `@norm`.  
Message with numeric `x,y,z,w` → `@rpy.roll` `@rpy.pitch` `@rpy.yaw` `@ypr.yaw` `@yrp.yaw`.  
Message with numeric `roll,pitch,yaw` → `@quat.x` `@quat.y` `@quat.z` `@quat.w`.

- [ ] **Step 4: Wire MessagePathInput**

Rename props:

```ts
supportsMessagePathFunctions?: boolean;
supportsTimeSeriesMessagePathFunctions?: boolean;
```

When `autocompleteType` is `messagePath` and `trimmedPath` includes `.@` and functions are enabled, set `autocompleteItems` to `suggestFunctionSuffixes(...)` mapped through the current prefix (`.@ab` filters to `@abs`). Range starts at the last `.@`.

`FieldEditor` passes the new props from `SettingsTreeFieldMessagePath`. Update `packages/studio/src/index.ts`:

```ts
export type SettingsTreeFieldMessagePath = {
  input: "messagepath";
  value?: string;
  validTypes?: string[];
  supportsMessagePathFunctions?: boolean;
  supportsTimeSeriesMessagePathFunctions?: boolean;
};
```

Delete `supportsMathModifiers`.

- [ ] **Step 5: Re-run suggestion tests + MessagePathInput.test.ts**

```sh
yarn jest packages/studio-base/src/components/MessagePathSyntax/suggestMessagePathCompletions.test.ts packages/studio-base/src/components/MessagePathSyntax/MessagePathInput.test.ts --runInBand
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/index.ts packages/studio-base/src/components/MessagePathSyntax packages/studio-base/src/components/SettingsTreeEditor/FieldEditor.tsx
git commit -m "$(cat <<'EOF'
feat: type-based FoxQL function autocomplete and input flags
EOF
)"
```

---

### Task 12: Panel flags (Plot, Raw Messages, Gauge, Indicator, State Transitions)

**Files:**
- Modify: `packages/studio-base/src/panels/Plot/settings.ts`
- Modify: `packages/studio-base/src/panels/RawMessages/Toolbar.tsx`
- Modify: `packages/studio-base/src/panels/Gauge/settings.ts`
- Modify: `packages/studio-base/src/panels/Indicator/settings.ts`
- Modify: `packages/studio-base/src/panels/StateTransitions/settings.ts`

**Interfaces:**
- Consumes: `supportsMessagePathFunctions`, `supportsTimeSeriesMessagePathFunctions`
- Produces: panel settings fields as in the spec table

- [ ] **Step 1: Add a settings-tree smoke test where one already exists; otherwise test via `buildSettingsTree` if exported. Plot `settings.ts` is not unit-tested — add `packages/studio-base/src/panels/Plot/settings.test.ts`:**

```ts
import { plotPathDisplayName } from "./settings";
```

Do **not** invent a huge settings renderer test. Instead add `packages/studio-base/src/panels/Plot/settingsFlags.test.ts`:

```ts
import { parseMessagePath } from "@foxglove/message-path";

import { validateMessagePathFunctions } from "@foxglove/studio-base/components/MessagePathSyntax/messagePathFunctions";

describe("panel FoxQL flags", () => {
  const plot = {
    supportsMessagePathFunctions: true,
    supportsTimeSeriesMessagePathFunctions: true,
    globalVariables: {},
  };
  const gauge = {
    supportsMessagePathFunctions: true,
    supportsTimeSeriesMessagePathFunctions: false,
    globalVariables: {},
  };

  it("plot allows derivative; gauge does not", () => {
    const parsed = parseMessagePath("/t.v.@derivative")!;
    expect(validateMessagePathFunctions(parsed, plot)).toBeUndefined();
    expect(validateMessagePathFunctions(parsed, gauge)).toBeDefined();
  });
});
```

This locks the spec table. The settings files must pass the matching flags into the messagepath field.

- [ ] **Step 2: Run the flags test**

Run: `yarn jest packages/studio-base/src/panels/Plot/settingsFlags.test.ts --runInBand`

Expected: PASS (pure validation). Then change settings files.

- [ ] **Step 3: Wire flags**

Plot series `value`: `supportsMessagePathFunctions: true` (time-series default true).  
Plot `xAxisPath`: `supportsMessagePathFunctions: true`, `supportsTimeSeriesMessagePathFunctions: false`.  
Gauge, Indicator, State Transitions `value`/`path`: functions true, time-series false. Also pass `validateMessagePathFunctions` result into `error` if the path is fully specified.  
Raw Messages `MessagePathInput`: `supportsMessagePathFunctions={true}` `supportsTimeSeriesMessagePathFunctions={false}`.

Gauge/Indicator `pathParseError`: if `validateMessagePathFunctions(parsed, gaugeSupport)` is a string, use it (in addition to the variables-not-supported check).

- [ ] **Step 4: `rg supportsMathModifiers` must be empty. `rg "mathFunctions"` must be empty.**

- [ ] **Step 5: Commit**

```bash
git add packages/studio-base/src/panels
git commit -m "$(cat <<'EOF'
feat: enable FoxQL functions on Plot, Raw Messages, Gauge, Indicator, State Transitions
EOF
)"
```

---

### Task 13: Cached walker enum identifier + existing Plot/Raw regressions

**Files:**
- Modify: `packages/studio-base/src/components/MessagePathSyntax/useCachedGetMessagePathDataItems.ts`
- Modify: `packages/studio-base/src/components/MessagePathSyntax/useCachedGetMessagePathDataItems.test.tsx`
- Modify: `packages/studio-base/src/components/MessagePathSyntax/filterMatches.ts` if identifier handling belongs here with `enumValues`

**Interfaces:**
- Consumes: `valueIsIdentifier`, `enumValuesByDatatypeAndField`
- Produces: `{status==MOVING}` matches a field whose enum map has `MOVING: 1` when the stored value is `1`

Identifier comparison is schema-aware, so it belongs in `getMessagePathDataItems` (has `enumValues` + `structureItem`), not in schema-free `filterMatches`.

In the filter branch of `getMessagePathDataItems`, if `pathItem.valueIsIdentifier === true` and `typeof pathItem.value === "string"`, look up `enumValues[structureItem.datatype]` inverted (name → stored value). Current `enumValues` is storedValue → name. Invert for lookup. If found, compare using a copy of the filter with `value` replaced by the stored enum value.

`simpleGetMessagePathDataItems` has no schema — identifier compares to the string (and loose `==`). Document that in the test.

- [ ] **Step 1: Cached walker test**

Reuse the existing enum fixture style around `constantName: "ON"` in `useCachedGetMessagePathDataItems.test.tsx` (`some_datatype` with constants `OFF=0`, `ON=1`, field `state`). Add:

```ts
it("filters enum identifiers by constant name", () => {
  const messages: MessageEvent[] = [
    {
      topic: "/some/topic",
      receiveTime: { sec: 0, nsec: 0 },
      message: { state: 0 },
      schemaName: "datatype",
      sizeInBytes: 0,
    },
    {
      topic: "/some/topic",
      receiveTime: { sec: 0, nsec: 0 },
      message: { state: 1 },
      schemaName: "datatype",
      sizeInBytes: 0,
    },
  ];
  const topics: Topic[] = [{ name: "/some/topic", schemaName: "some_datatype" }];
  const datatypes: RosDatatypes = new Map(
    Object.entries({
      some_datatype: {
        definitions: [
          { name: "OFF", type: "uint32", isConstant: true, value: 0 },
          { name: "ON", type: "uint32", isConstant: true, value: 1 },
          { name: "state", type: "uint32" },
        ],
      },
    }),
  );
  expect(
    addValuesWithPathsToItems(messages, "/some/topic{state==ON}.state", topics, datatypes),
  ).toEqual([
    [],
    [{ value: 1, path: "/some/topic{state==ON}.state", constantName: "ON" }],
  ]);
});
```

- [ ] **Step 2: Run test**

Run: `yarn jest packages/studio-base/src/components/MessagePathSyntax/useCachedGetMessagePathDataItems.test.tsx --runInBand`

Expected: FAIL until identifier rewrite exists; other tests still PASS.

- [ ] **Step 3: Implement identifier rewrite in `getMessagePathDataItems` filter branch only.**

- [ ] **Step 4: Re-run cached + simpleGet + Plot builder tests listed below**

```sh
yarn jest \
  packages/studio-base/src/components/MessagePathSyntax/useCachedGetMessagePathDataItems.test.tsx \
  packages/studio-base/src/components/MessagePathSyntax/simpleGetMessagePathDataItems.test.ts \
  packages/studio-base/src/panels/Plot/builders/IndexDatasetsBuilder.test.ts \
  packages/studio-base/src/panels/Plot/builders/CurrentCustomDatasetsBuilder.test.ts \
  packages/studio-base/src/panels/Plot/builders/TimestampDatasetsBuilderImpl.test.ts \
  --runInBand
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/studio-base/src/components/MessagePathSyntax
git commit -m "$(cat <<'EOF'
feat: match unquoted FoxQL filter identifiers against enum constants
EOF
)"
```

---

### Task 14: Cleanup nearley + final verification battery

**Files:**
- Modify: `packages/studio-base/webpack.ts` (drop `.ne` loader if unused)
- Modify: `packages/studio-base/jest.config.json` (drop `\\.ne$` transform if unused)
- Modify: `packages/studio-base/package.json` (remove `nearley` / `nearley-loader` / `@types/nearley` if unused)
- Modify: `packages/studio-base/src/typings/extensions.d.ts` (drop `.ne` module)

**Interfaces:** none

- [ ] **Step 1: Confirm no remaining `.ne` sources**

Run: `rg "grammar\\.ne|from \"nearley\"|nearley-loader" --glob '!node_modules' --glob '!docs/**'`

Expected: no matches (or only changelog/docs). If studio-base still references nearley, remove them.

- [ ] **Step 2: `yarn install --immutable` if lockfile/manifests changed.**

- [ ] **Step 3: Run the full FoxQL Jest battery**

```sh
yarn jest --runInBand \
  packages/message-path/src/parseFunction.test.ts \
  packages/message-path/src/parseMessagePath.test.ts \
  packages/studio-base/src/components/MessagePathSyntax/stringifyRosPath.test.ts \
  packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.test.ts \
  packages/studio-base/src/components/MessagePathSyntax/filterMatches.test.ts \
  packages/studio-base/src/components/MessagePathSyntax/simpleGetMessagePathDataItems.test.ts \
  packages/studio-base/src/components/MessagePathSyntax/useCachedGetMessagePathDataItems.test.tsx \
  packages/studio-base/src/components/MessagePathSyntax/suggestMessagePathCompletions.test.ts \
  packages/studio-base/src/components/MessagePathSyntax/MessagePathInput.test.ts \
  packages/studio-base/src/panels/Plot/splitTimeSeriesFunctionChain.test.ts \
  packages/studio-base/src/panels/Plot/settingsFlags.test.ts \
  packages/studio-base/src/panels/Plot/builders/IndexDatasetsBuilder.test.ts \
  packages/studio-base/src/panels/Plot/builders/CurrentCustomDatasetsBuilder.test.ts \
  packages/studio-base/src/panels/Plot/builders/CustomDatasetsBuilder.test.ts \
  packages/studio-base/src/panels/Plot/builders/TimestampDatasetsBuilder.test.ts \
  packages/studio-base/src/panels/Plot/builders/TimestampDatasetsBuilderImpl.test.ts
```

Expected: all PASS.

- [ ] **Step 4: Fast verification on changed TS/TSX (not deleted files)**

```sh
git diff --check
yarn run tsc --noEmit
yarn oxlint <changed-ts-or-tsx-files>
yarn eslint --cache --cache-strategy content --cache-location .eslintcache <changed-ts-or-tsx-files>
yarn prettier --check <changed-ts-or-tsx-files>
```

If manifests changed, also `yarn run lint:ci` is **not** required unless eslint/prettier/tsconfig/jest config changed. Jest config + webpack nearley removal counts as lint-related tooling — run `yarn run lint:ci` only if those configs changed and targeted eslint is not enough. Prefer targeted eslint on the changed config files.

- [ ] **Step 5: Manual checklist (no browser tools required if Jest battery is green; still do a 30-second path audit)**

Type these into a Plot series field in your head against `validateMessagePathFunctions` + `parseMessagePath`:

| Input | Parse | Validate (Plot timestamp) | Validate (Gauge) |
| --- | --- | --- | --- |
| `/t.v.@abs` | yes | ok | ok |
| `/t.v.@mul(3.6)` | yes | ok | ok |
| `/t.q.@rpy.yaw.@degrees` | yes | ok | ok |
| `/t.v.@derivative` | yes | ok | error |
| `/t.v.@derivative.@abs` | yes | ok | error |
| `/t.v.@deg2rad` | yes | error | error |
| `/t.items[:]{id!=1}` | yes | ok | ok |

- [ ] **Step 6: Commit cleanup**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: remove Nearley after FoxQL parser migration
EOF
)"
```

---

## Test battery (copy this; do not ship without it)

These are the behaviors that must stay green. If a task's local tests pass but this list is not covered, the work is not done.

1. **Parser:** `.@rpy.yaw.@degrees`, `.@mul(3.6)`, `{id!=1}`, `{status==MOVING}`, `[-1]`, unfinished `/topic.hi.@`, invalid `[0][1]`.
2. **Stringify:** those strings round-trip; `$scale` fills inside `@mul($scale)`.
3. **Catalog:** `degrees(π)≈180`, no `deg2rad`, Plot allows `@derivative.@abs`, Gauge rejects `@derivative`.
4. **Eval:** abs/mul/norm/length/rpy+degrees/Time×1000; unknown name is identity; bad `@length` is drop.
5. **Walker:** `@abs` on `-3` → `3`; `{id>1}`; `[-1]`.
6. **Plot:** existing derivative legend tests; new delta / `@derivative.@abs`; Index `@abs` and `@mul(2)`.
7. **Autocomplete:** number → `@abs`+`@derivative`; gauge support omits `@derivative`; quaternion → `@rpy.yaw`.
8. **Jest project:** `packages/message-path` tests run via root `yarn jest`.

Gauge / Indicator / Raw Messages / State Transitions have no dedicated panel unit tests today. Their data path is `simpleGetMessagePathDataItems` / `getMessagePathDataItems`. Do not add screenshot tests. Do not claim panel UI was tested in a browser unless you actually ran the app.

## Out of scope leftovers

- Search FoxQL
- Table panel functions
- `@deg2rad` compatibility
- i18n for new error strings (English is enough, matching current Gauge `pathParseError`)
