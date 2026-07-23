// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const { ESLintUtils } = require("@typescript-eslint/utils");
const ts = require("typescript");

const ALLOWED_FLAGS =
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.Void |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Null |
  ts.TypeFlags.Never;

function unionParts(type) {
  return type.isUnion() ? type.types.flatMap(unionParts) : [type];
}

function parameterIdentifier(parameter) {
  if (parameter.type === "Identifier") {
    return parameter;
  }
  if (parameter.type === "AssignmentPattern" && parameter.left.type === "Identifier") {
    return parameter.left;
  }
  return undefined;
}

function functionName(parameter) {
  const fn = parameter.parent;
  if (fn.id?.type === "Identifier") {
    return fn.id.name;
  }
  const owner = fn.parent;
  if (owner?.type === "VariableDeclarator" && owner.id.type === "Identifier") {
    return owner.id.name;
  }
  if (
    (owner?.type === "Property" ||
      owner?.type === "MethodDefinition" ||
      owner?.type === "TSAbstractMethodDefinition") &&
    owner.key.type === "Identifier"
  ) {
    return owner.key.name;
  }
  return undefined;
}

function suggestions(parameter, context) {
  const identifier = parameterIdentifier(parameter);
  if (!identifier) {
    return [];
  }

  const sourceCode = context.sourceCode;
  const name = identifier.name;
  const optional = identifier.optional ? "?" : "";
  let defaultText = "";
  if (parameter.type === "AssignmentPattern") {
    const originalDefault = sourceCode.getText(parameter.right);
    if (originalDefault === "true") {
      defaultText = ' = "enabled"';
    } else if (originalDefault === "false") {
      defaultText = ' = "disabled"';
    }
  }

  const nullableParts = [];
  const annotation = identifier.typeAnnotation?.typeAnnotation;
  if (annotation?.type === "TSUnionType") {
    for (const member of annotation.types) {
      if (
        member.type === "TSUndefinedKeyword" ||
        member.type === "TSNullKeyword" ||
        member.type === "TSVoidKeyword"
      ) {
        nullableParts.push(sourceCode.getText(member));
      }
    }
  }
  const nullableSuffix = nullableParts.length > 0 ? ` | ${nullableParts.join(" | ")}` : "";
  const stringUnion = `"enabled" | "disabled"${nullableSuffix}`;

  const objectDefault =
    parameter.type === "AssignmentPattern" ? ` = ${sourceCode.getText(parameter.right)}` : "";
  const objectAnnotation = identifier.typeAnnotation
    ? sourceCode.getText(identifier.typeAnnotation.typeAnnotation)
    : "boolean";

  return [
    {
      messageId: "useStringUnion",
      data: { type: stringUnion },
      fix(fixer) {
        return fixer.replaceText(parameter, `${name}${optional}: ${stringUnion}${defaultText}`);
      },
    },
    {
      messageId: "wrapInObject",
      data: { name },
      fix(fixer) {
        return fixer.replaceText(
          parameter,
          `{ ${name}${objectDefault} }: { ${name}${optional}: ${objectAnnotation} }`,
        );
      },
    },
  ];
}

/** @type {import("@typescript-eslint/utils").TSESLint.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    hasSuggestions: true,
    schema: [
      {
        type: "object",
        properties: {
          allowLoneParameter: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      booleanTrap:
        "Boolean parameter{{parameter}}{{functionName}} makes call sites ambiguous; use a string union or options object.",
      useStringUnion: "Replace the boolean with {{type}}.",
      wrapInObject: "Wrap '{{name}}' in an options object.",
    },
  },

  create(context) {
    const { allowLoneParameter = false } = context.options[0] ?? {};
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      ":function > AssignmentPattern.params, :function > [typeAnnotation].params, TSFunctionType > [typeAnnotation].params, TSEmptyBodyFunctionExpression > [typeAnnotation].params":
        (parameter) => {
          if (allowLoneParameter && parameter.parent.params.length === 1) {
            return;
          }

          const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(parameter));
          const parts = unionParts(type);
          const containsBoolean = parts.some(
            (part) => (part.flags & ts.TypeFlags.BooleanLike) !== 0,
          );
          const containsOnlyBooleanAndNullish = parts.every(
            (part) => (part.flags & ALLOWED_FLAGS) !== 0,
          );
          if (!containsBoolean || !containsOnlyBooleanAndNullish) {
            return;
          }

          const identifier = parameterIdentifier(parameter);
          const ownerName = functionName(parameter);
          context.report({
            node: parameter,
            messageId: "booleanTrap",
            data: {
              parameter: identifier ? ` '${identifier.name}'` : "",
              functionName: ownerName ? ` on '${ownerName}'` : "",
            },
            suggest: suggestions(parameter, context),
          });
        },
    };
  },
};
