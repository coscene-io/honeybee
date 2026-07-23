// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

function nearestFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionDeclaration" ||
      current.type === "FunctionExpression"
    ) {
      return current;
    }
  }
  return undefined;
}

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    fixable: "code",
    schema: [],
    messages: {
      returnDirectly: "Return values directly from async functions.",
      throwDirectly: "Throw errors directly from async functions.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;

    return {
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.computed ||
          node.callee.object.type !== "Identifier" ||
          node.callee.object.name !== "Promise" ||
          node.callee.property.type !== "Identifier" ||
          (node.callee.property.name !== "resolve" && node.callee.property.name !== "reject")
        ) {
          return;
        }

        const parent = node.parent;
        const isReturned = parent?.type === "ReturnStatement";
        const isArrowBody = parent?.type === "ArrowFunctionExpression" && parent.body === node;
        const enclosingFunction = nearestFunction(node);
        if ((!isReturned && !isArrowBody) || !enclosingFunction?.async) {
          return;
        }

        const rejects = node.callee.property.name === "reject";
        context.report({
          node: rejects && isReturned ? parent : node,
          messageId: rejects ? "throwDirectly" : "returnDirectly",
          fix(fixer) {
            const argument = node.arguments[0];
            const argumentText = argument ? sourceCode.getText(argument) : "undefined";

            if (rejects) {
              if (isReturned) {
                return fixer.replaceText(parent, `throw ${argumentText};`);
              }
              return fixer.replaceText(node, `{ throw ${argumentText}; }`);
            }

            const firstToken = argument && sourceCode.getFirstToken(argument);
            const needsParentheses =
              isArrowBody && firstToken?.type === "Punctuator" && firstToken.value === "{";
            return fixer.replaceText(node, needsParentheses ? `(${argumentText})` : argumentText);
          },
        });
      },
    };
  },
};
