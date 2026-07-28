// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const { RegExpSyntaxError, RegExpValidator } = require("@eslint-community/regexpp");

function staticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked;
  }
  return undefined;
}

function isShadowed(sourceCode, node, name) {
  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.variables.find((candidate) => candidate.name === name);
    if (variable) {
      return variable.defs.length > 0;
    }
  }
  return false;
}

function hasLookbehind(pattern, flags) {
  let found = false;
  try {
    new RegExpValidator({
      onLookaroundAssertionEnter(_start, kind) {
        found ||= kind === "lookbehind";
      },
    }).validatePattern(
      pattern,
      0,
      pattern.length,
      flags.includes("u") || flags.includes("v"),
      flags.includes("v"),
    );
  } catch (error) {
    if (!(error instanceof RegExpSyntaxError)) {
      throw error;
    }
  }
  return found;
}

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      unsupported: "Regular-expression lookbehind assertions are not supported.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;

    function check(node, pattern, flags) {
      if (hasLookbehind(pattern, flags)) {
        context.report({ node, messageId: "unsupported" });
      }
    }

    function checkConstructor(node) {
      if (
        node.callee.type !== "Identifier" ||
        node.callee.name !== "RegExp" ||
        isShadowed(sourceCode, node, "RegExp")
      ) {
        return;
      }
      const pattern = staticString(node.arguments[0]);
      const flags = staticString(node.arguments[1]) ?? "";
      if (pattern != undefined) {
        check(node, pattern, flags);
      }
    }

    return {
      "Literal[regex]"(node) {
        check(node, node.regex.pattern ?? "", node.regex.flags ?? "");
      },
      CallExpression: checkConstructor,
      NewExpression: checkConstructor,
    };
  },
};
