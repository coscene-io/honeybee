// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

function isShadowed(sourceCode, node, name) {
  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.variables.find((candidate) => candidate.name === name);
    const hasRuntimeDefinition = variable?.defs.some(
      (definition) =>
        definition.type !== "ImportBinding" ||
        (definition.parent?.importKind !== "type" && definition.node.importKind !== "type"),
    );
    if (hasRuntimeDefinition && (variable.isValueVariable ?? true)) {
      return true;
    }
  }
  return false;
}

function isNullishLiteral(sourceCode, node) {
  return (
    (node.type === "Identifier" &&
      node.name === "undefined" &&
      !isShadowed(sourceCode, node, "undefined")) ||
    (node.type === "Literal" && node.raw === "null")
  );
}

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      requireLooseNullish:
        "Use '{{expectedOperator}}' when comparing with null or undefined so both nullish values match.",
      requireStrict: "Use '{{expectedOperator}}' instead of '{{actualOperator}}'.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;

    return {
      BinaryExpression(node) {
        if (!["==", "!=", "===", "!=="].includes(node.operator)) {
          return;
        }

        const comparesNullish =
          isNullishLiteral(sourceCode, node.left) || isNullishLiteral(sourceCode, node.right);
        if (comparesNullish && (node.operator === "===" || node.operator === "!==")) {
          context.report({
            node,
            messageId: "requireLooseNullish",
            data: { expectedOperator: node.operator.slice(0, 2) },
          });
        } else if (!comparesNullish && (node.operator === "==" || node.operator === "!=")) {
          context.report({
            node,
            messageId: "requireStrict",
            data: {
              actualOperator: node.operator,
              expectedOperator: `${node.operator}=`,
            },
          });
        }
      },
    };
  },
};
