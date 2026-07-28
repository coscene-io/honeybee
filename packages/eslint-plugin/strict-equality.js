// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

function isNullishLiteral(node) {
  return (
    (node.type === "Identifier" && node.name === "undefined") ||
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
    return {
      BinaryExpression(node) {
        if (!["==", "!=", "===", "!=="].includes(node.operator)) {
          return;
        }

        const comparesNullish = isNullishLiteral(node.left) || isNullishLiteral(node.right);
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
