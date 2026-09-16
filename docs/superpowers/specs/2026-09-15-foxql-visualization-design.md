# FoxQL Visualization (Foxglove 3.1.1) Design

**Date:** 2026-09-15  
**Status:** Approved for planning (brainstorming: approach 1, 3.1.1 names only, type-based autocomplete)  
**Reference implementation:** `/Applications/Foxglove.app` 3.1.1 (asar semantics only — do not copy minified JS)

## Goal

Honeybee visualization expressions match Foxglove 3.1.1 FoxQL for:

- handwritten recursive-descent parser
- filter operators `== != < <= > >=` and unquoted enum identifiers
- function chains (`.@name`, `.@name(operand)`, struct field access, left-to-right chaining)
- type-based autocomplete
- evaluation in Plot, Raw Messages, Gauge, Indicator, and State Transitions

Search-page FoxQL (`and` / `or`, `@device.name`, `visual()`) is out of scope.

## Decisions

| Topic | Choice |
| --- | --- |
| Parser | Replace Nearley with one handwritten RD parser for the whole expression |
| Function names | 3.1.1 only: `@radians` / `@degrees`. Do not evaluate `@deg2rad` / `@rad2deg` |
| Autocomplete | Type-based, matching 3.1.1 |
| Search FoxQL | Not implemented |
| Source of truth | This spec + tests. Local Foxglove 3.1.1 is the semantic oracle |

## Non-goals

- Foxglove Search query grammar
- Table panel function support (Table keeps path selection only)
- Keeping `MessagePath.modifier`
- Aliasing `@deg2rad` / `@rad2deg`
- Vendoring Foxglove asar / minified bundles

## Architecture

Three layers:

1. **`@foxglove/message-path`** — parse, stringify, `parseFunction`, function *names* (not evaluation). No `three`, no rostime.
2. **`MessagePathSyntax`** — `filterMatches`, `applyFunctionChain`, walkers (`simpleGetMessagePathDataItems`, `getMessagePathDataItems`), type-based suggestions, function validation against panel flags.
3. **Panels / Plot builders** — enable flags; Plot timestamp axis splits a time-series function out of the chain and applies it across consecutive samples.

```text
string
  -> parseMessagePath -> MessagePath { messagePath, functionChain, isFullySpecified }
  -> fillInGlobalVariablesInPath
  -> walker (filters, slices, names)
  -> applyFunctionChain (per sample; time-series steps skipped)
  -> Plot timestamp only: delta | derivative | timedelta then trailing scalar/operand
```

## AST

Replace `modifier?: string` with:

```ts
export type MessagePathFunction = {
  function: string; // "abs" | "mul(3.6)" | "rpy"
  fieldAccess?: string; // struct only: yaw, roll, w, ...
};

export type MessagePath = {
  topicName: string;
  topicNameRepr: string;
  messagePath: MessagePathPart[];
  functionChain?: MessagePathFunction[];
  isFullySpecified: boolean;
};

export type FilterOperator = "==" | "!=" | "<" | "<=" | ">" | ">=";

export type MessagePathFilter = {
  type: "filter";
  path: string[];
  operator?: FilterOperator;
  value?: number | string | bigint | boolean | { variableName: string; startLoc: number };
  valueIsIdentifier?: boolean;
  nameLoc: number;
  valueLoc: number;
  repr: string;
};
```

`isFullySpecified` is false when any name is empty, any filter is missing operator or value, any function name is empty, or any struct fieldAccess is the empty string (incomplete `.@rpy.`).

Public parse API:

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

`parseMessagePath` is `parseMessagePathWithDiagnostics(input).path`. Existing callers keep working.

`parseFunction`:

```ts
export type ParsedFunction = {
  name: string;
  operand?: number;
  operandRaw?: string;
};

export function parseFunction(functionStr: string): ParsedFunction | undefined;
```

Regex: `/^([a-zA-Z0-9_-]+)(?:\((.*)\))?$/`. Empty parentheses → name only. Quoted operand strips one pair of quotes. Finite `Number` → `operand` + `operandRaw`; otherwise `operandRaw` only (`$scale`).

`STRUCT_FUNCTION_NAMES = new Set(["rpy", "quat", "ypr", "yrp"])`.

## Parser

Delete `packages/message-path/src/grammar.ne` and the `nearley` dependency from `@foxglove/message-path`. If no remaining `.ne` files, drop `nearley-loader` from studio-base webpack/jest.

Behavior aligned with Foxglove 3.1.1:

- Topic: `/a/b`, unquoted `a/b`, or `"quoted:name"`.
- Steps: `.field`, `."quoted"`, `[n]`, `[start:end]`, `[:]`, `[$var]`, `{filter}`.
- Filters: `{path}`, `{path==val}`, `{path!=val}`, `{path<val}`, `{path<=val}`, `{path>val}`, `{path>=val}`. Values: number, `'str'` / `"str"`, `true` / `false`, `$var`, unquoted identifier (`MOVING`).
- Function suffix: repeat `.@name`, `.@name(operand)`, optional `.field` after a struct function. Stop field-access when the next token is `.@`.
- Integers in filters/slices that fit JS number stay number or bigint consistently with current Honeybee tests (current tests use bigint for filter integers such as `2n`). Preserve that: integer-looking filter values that are not scientific notation become `bigint` when they would have been bigint today. Slice indices remain `number` (current grammar uses `Number(BigInt(...))`).
- Recoverable incomplete input returns a path with empty names / empty function names and `isFullySpecified: false` (`/topic.`, `/topic.hi.@`, `/topic.foo{}`, `/topic.foo{bar}`, `/topic.foo{==1}`).
- Unrecoverable input returns `undefined` (unclosed quotes, `[0][1]`, `/topic.foo[]`, `/topic.foo[bar]`, trailing junk).

`stringifyMessagePath` lives in `@foxglove/message-path` and round-trips parseable strings. studio-base `stringifyRosPath.ts` re-exports it.

`fillInGlobalVariablesInPath` (studio-base) fills slices, filter `$vars`, and function operands (`@mul($scale)` → `@mul(3.6)` when `$scale` is a number). Recompute stringify after fill.

## Function catalog

Names (exact, no aliases):

| Category | Names |
| --- | --- |
| Scalar | `abs acos asin atan ceil cos log log1p log2 log10 round sign sin sqrt tan trunc negative radians degrees` |
| Operand | `add sub mul div` |
| Array | `length` |
| Vector | `norm` |
| Struct | `rpy ypr yrp quat` |
| Time-series | `delta derivative timedelta` |

Semantics:

- Scalar: JS `Math.*`; `negative` = `-x`; `radians` = deg→rad; `degrees` = rad→deg.
- Operand: one finite number or `$variable`. Missing/non-finite operand → invalid function.
- Non-operand functions must not have parentheses/operand.
- `length`: JS `.length` of array or typed array (empty → 0).
- `norm`: `Math.hypot` of `{x,y}` or `{x,y,z}` or a non-empty numeric array / typed array. BigInt64Array/BigUint64Array converted with `Number`.
- `rpy`: quaternion `{x,y,z,w}` → `{roll,pitch,yaw}` radians, intrinsic XYZ (three.js `Euler.setFromQuaternion(q, "XYZ")`).
- `ypr`: same with `"ZYX"`.
- `yrp`: same with `"ZXY"`.
- `quat`: `{roll,pitch,yaw}` radians → `{x,y,z,w}`, inverse of `rpy`.
- Struct field access allowed only for that function's fields: `rpy`/`ypr`/`yrp` → `roll|pitch|yaw`; `quat` → `x|y|z|w`.
- Time-series: not applied in the per-sample walker.

`@deg2rad` / `@rad2deg` parse as function names but fail catalog validation.

### Chain rules

- Evaluate left to right.
- At most one time-series function per chain.
- After a time-series function, only scalar or operand functions are allowed.
- Valid: `/foo.value.@derivative.@abs`, `/foo.value.@delta.@negative`.
- Invalid: `/foo.value.@derivative.@derivative`, `/foo.value.@derivative.@norm`.

### Per-sample evaluation (`applyFunctionChain`)

After the path walker yields a value:

1. If the next step is time-series, skip it (Plot applies later).
2. Coerce `{sec, nsec}` Time with `toSec` before any numeric function.
3. Coerce bigint / boolean / numeric string to number for scalar/operand.
4. Scalar on a plain object maps every numeric field and returns a new object (Raw Messages).
5. Struct without `fieldAccess` returns the whole object; with access, the scalar field.
6. If a step cannot apply, drop that item (do not throw).

Walkers that must call this: `simpleGetMessagePathDataItems`, `getMessagePathDataItems`.

Negative indices: `simpleGetMessagePathDataItems` currently loops `for (i = start; i < length && i <= end)` and misses `[-1]`. Match `getMessagePathDataItems`: `index = i >= 0 ? i : length + i`.

### Filters

`filterMatches`:

- `==` keeps today's loose `==`.
- `!= < <= > >=` use the corresponding JS comparison after the path is resolved.
- Unquoted identifier: if the field has an enum map, compare to the enum's stored value; otherwise compare to the identifier string.
- Unfilled `$variable` (object value) still throws — callers must fill first.

## Plot time-series

Extract:

```ts
export function splitTimeSeriesFunctionChain(path: MessagePath): {
  pathBeforeSpecialFunction: MessagePath;
  specialFunction?: "delta" | "derivative" | "timedelta";
  postSpecialScalarFunctions: Array<(n: number) => number>;
};
```

Walker uses `pathBeforeSpecialFunction` (functions before the time-series step). Timestamp builder then:

- `timedelta`: first sample skipped; later `x[n] - x[n-1]` seconds; ignore y.
- `derivative`: first sample skipped; `(y[n]-y[n-1]) / (x[n]-x[n-1])`; `dx === 0` → `NaN`.
- `delta`: first sample skipped; `y[n] - y[n-1]`.
- Apply `postSpecialScalarFunctions` to the result.

Existing `@derivative` legend/viewport tests in `TimestampDatasetsBuilderImpl.test.ts` must keep passing. Index / currentCustom / custom x-axis: a time-series function is an error (`INCOMPATIBLE_MESSAGE_PATH_FUNCTION`), not evaluated.

Delete `mathFunctions.ts`. Builders must not read `path.modifier`.

## Autocomplete and validation

Extract a pure helper (unit-tested, no React):

```ts
export type MessagePathFunctionSupport = {
  supportsMessagePathFunctions: boolean;
  supportsTimeSeriesMessagePathFunctions: boolean;
  globalVariables: Record<string, unknown>;
};

export function suggestMessagePathCompletions(args: {
  path: string;
  parsed: MessagePath | undefined;
  structureItem: MessagePathStructureItem | undefined;
  support: MessagePathFunctionSupport;
  validTypes?: readonly string[];
}): { items: string[]; filterText: string; range: { start: number; end: number } };

export function validateMessagePathFunctions(
  parsed: MessagePath,
  terminatingItem: MessagePathStructureItem | undefined,
  support: MessagePathFunctionSupport,
): string | undefined;
```

Suggestions when the user is in a `.@` suffix, based on terminating structure:

- primitive number → scalar + operand templates `@abs`, `@mul(` …
- array → `@length`
- vector-like `{x,y}` / `{x,y,z}` → `@norm`
- quaternion `{x,y,z,w}` → `@rpy.roll`, `@rpy.pitch`, `@rpy.yaw` (and ypr/yrp)
- rpy object → `@quat.x` … `@quat.w`
- Plot + timestamp support → also `@delta`, `@derivative`, `@timedelta`

Filter suggestions include operators `== != < <= > >=` and enum constant names when the field has enums.

`MessagePathInput` / settings field:

- Rename `supportsMathModifiers` → `supportsMessagePathFunctions`
- Add `supportsTimeSeriesMessagePathFunctions` (default `true` only when functions are enabled and the caller does not pass false)
- `.@` in a field with functions disabled is an error (same as today)
- Show `validateMessagePathFunctions` / parser diagnostic message as the field error when present

## Panel wiring

| Surface | Functions | Time-series |
| --- | --- | --- |
| Plot series `value` | yes | yes (timestamp x-axis only; builders reject otherwise) |
| Plot `xAxisPath` | yes | no |
| Raw Messages path inputs | yes | no |
| Gauge `path` | yes | no |
| Indicator `path` | yes | no |
| State Transitions series `value` | yes | no |
| Table | no | no |

Gauge / Indicator already use `simpleGetMessagePathDataItems`; enabling the flag plus walker-side evaluation is enough for data. They should still validate function chains and set `pathParseError` for unknown / time-series functions.

## Error handling

- Parse unrecoverable → `undefined` path → existing "invalid path" UI.
- Parse incomplete → path with `isFullySpecified: false` → autocomplete continues; settings treat as error if the panel requires a complete path.
- Unknown function / bad operand / bad field access / illegal chain / time-series on a non-Plot-timestamp field → string from `validateMessagePathFunctions`, shown on the input.
- Runtime apply failure → drop the item.

## Testing (normative)

This feature is specified by tests. An implementation that matches comments but fails the matrix below is incomplete.

### Where tests live

| Layer | File | Runner |
| --- | --- | --- |
| Parser / stringify / parseFunction | `packages/message-path/src/*.test.ts` | new `packages/message-path/jest.config.json` (this package currently has tests that **are not in any Jest project**) |
| applyFunctionChain, filters, walkers, suggestions | `packages/studio-base/src/components/MessagePathSyntax/*.test.ts(x)` | existing studio-base Jest |
| Plot split + derivative/delta/timedelta | `packages/studio-base/src/panels/Plot/**/*.test.ts` | existing studio-base Jest |

Run examples:

```sh
yarn jest packages/message-path/src/parseMessagePath.test.ts --runInBand
yarn jest packages/studio-base/src/components/MessagePathSyntax/simpleGetMessagePathDataItems.test.ts --runInBand
yarn jest packages/studio-base/src/panels/Plot/builders/TimestampDatasetsBuilderImpl.test.ts --runInBand
```

### Golden strings (must parse, stringify round-trip unless noted)

```text
/imu.linear_acceleration.x.@abs
/wheel.speed.@mul(3.6)
/imu.linear_acceleration.@norm
/imu.orientation.@rpy.yaw.@degrees
/scan.ranges.@length
/odom.pose.pose.position.x.@derivative
/foo.value.@derivative.@abs
/topic.items[:]{id!=1}.name
/topic.items[:]{status==MOVING}.name
/topic.arr[-1]
```

`@mul($scale)` stringifies as itself until variables are filled; after fill with `{scale: 3.6}` stringifies as `@mul(3.6)`.

### Evaluation goldens

| Path | Input | Output |
| --- | --- | --- |
| `/t.v.@abs` | `{v: -3}` | `[3]` |
| `/t.v.@mul(3.6)` | `{v: 10}` | `[36]` |
| `/t.v.@norm` | `{v: {x: 3, y: 4}}` | `[5]` |
| `/t.v.@length` | `{v: [1, 2, 3]}` | `[3]` |
| `/t.q.@rpy.yaw.@degrees` | identity quat | `[0]` |
| `/t.q.@rpy.yaw.@degrees` | +90° yaw quat `{x:0,y:0,z:√2/2,w:√2/2}` | `[90]` |
| `/t.stamp.@mul(1000)` | `{stamp: {sec: 1, nsec: 500000000}}` | `[1500]` |
| `/t.arr[-1]` | `{arr: [10, 20, 30]}` | `[30]` |
| `/t.items[:]{id>1}.id` | `[{id:1},{id:2}]` | `[2]` |
| `/t.v.@deg2rad` | `{v: 180}` | `[]` (unknown; walker may still return raw if validation is UI-only — **evaluation must not convert**. Prefer drop or leave untransformed only if chain apply ignores unknown by skip; spec: **unknown functions do not transform**, Plot/settings show error. Walker `applyFunctionChain` treats unknown as skip so Raw Messages does not silently change values; UI still errors.) |

Clarify unknown-function runtime: **skip the unknown step** (identity), UI still errors. This matches Foxglove walker `type:"skip"` for functions `FR` cannot compile. `@deg2rad` therefore leaves `180` as `180` in the walker, and the input is red.

Time-series goldens (Plot timestamp only):

| Path | Samples (x seconds, y) | Plotted y |
| --- | --- | --- |
| `@delta` | (0,1), (2,4) | NaN/skip, 3 |
| `@derivative` | (0,0), (2,20) | skip, 10 |
| `@timedelta` | (0,*), (2,*) | skip, 2 |
| `@derivative.@abs` | (0,0), (2,-20) | skip, 10 |
| `@derivative.@derivative` | any | invalid chain, no plot |

### Existing tests that must be updated, not deleted

- `packages/message-path/src/parseMessagePath.test.ts` — `modifier` → `functionChain` / `isFullySpecified`; keep unfinished-string cases
- `packages/studio-base/src/components/MessagePathSyntax/stringifyRosPath.test.ts` — add chain/operator cases
- `packages/studio-base/src/components/MessagePathSyntax/simpleGetMessagePathDataItems.test.ts` — add function/filter/negative-index cases
- `packages/studio-base/src/components/MessagePathSyntax/useCachedGetMessagePathDataItems.test.tsx` — `modifier: undefined` fixtures; add function apply case
- `packages/studio-base/src/components/MessagePathSyntax/MessagePathInput.test.ts` — `modifier` on fixture
- `packages/studio-base/src/panels/Plot/builders/IndexDatasetsBuilder.test.ts` — `/bar.val.@abs` still plots `3`
- `packages/studio-base/src/panels/Plot/builders/CurrentCustomDatasetsBuilder.test.ts` — same
- `packages/studio-base/src/panels/Plot/builders/TimestampDatasetsBuilderImpl.test.ts` — all `@derivative` tests still pass; add `@delta`, `@timedelta`, `@derivative.@abs`

### Autocomplete tests (pure helper)

Given a float32 field and `supportsMessagePathFunctions: true`, typing `/imu.x.@` yields items including `.@abs` and `.@mul(`.  
Given an array and functions enabled, `/t.arr.@` includes `.@length` and does not require time-series.  
Given functions disabled, `/t.x.@abs` is a validation error.  
Given Gauge support (`supportsTimeSeriesMessagePathFunctions: false`), `/t.x.@derivative` is a validation error.  
Given a quaternion field, `/t.q.@` includes `.@rpy.yaw`.

### What not to test

- Search `visual()` / entity fields
- Visual screenshots of autocomplete
- three.js Euler internals beyond the goldens above
- Layout "modifier" (last editor user id) — unrelated

## Rollout / compatibility

Layouts store path *strings*. `/topic.field.@abs` and `/topic.field.@derivative` keep working. `/topic.field.@deg2rad` still parses but is an unknown function (red input, no conversion).

## Files (expected)

Create:

- `packages/message-path/jest.config.json`
- `packages/message-path/src/parseFunction.ts`
- `packages/message-path/src/parser.ts`
- `packages/message-path/src/stringifyMessagePath.ts`
- `packages/studio-base/src/components/MessagePathSyntax/messagePathFunctions.ts`
- `packages/studio-base/src/components/MessagePathSyntax/suggestMessagePathCompletions.ts`
- `packages/studio-base/src/panels/Plot/splitTimeSeriesFunctionChain.ts`
- corresponding `*.test.ts` files listed in Testing

Delete:

- `packages/message-path/src/grammar.ne`
- `packages/studio-base/src/panels/Plot/mathFunctions.ts`

Modify:

- `packages/message-path/src/types.ts`, `parseMessagePath.ts`, `index.ts`, `package.json`
- `packages/studio-base/src/components/MessagePathSyntax/*`
- `packages/studio/src/index.ts` (`SettingsTreeFieldMessagePath`)
- Plot builders + settings, Gauge/Indicator/RawMessages/StateTransitions settings
- webpack/jest nearley hooks if unused
