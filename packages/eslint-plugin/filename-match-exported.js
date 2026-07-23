// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

const path = require("node:path");

function declarationName(node) {
  if (node.type === "Identifier") {
    return node.name;
  }
  if ((node.type === "ClassDeclaration" || node.type === "FunctionDeclaration") && node.id) {
    return node.id.name;
  }
  return undefined;
}

function exportedName(program) {
  for (const statement of program.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      return declarationName(statement.declaration);
    }
    if (
      statement.type === "ExpressionStatement" &&
      statement.expression.type === "AssignmentExpression" &&
      statement.expression.operator === "=" &&
      statement.expression.left.type === "MemberExpression" &&
      !statement.expression.left.computed &&
      statement.expression.left.object.type === "Identifier" &&
      statement.expression.left.object.name === "module" &&
      statement.expression.left.property.type === "Identifier" &&
      statement.expression.left.property.name === "exports"
    ) {
      return declarationName(statement.expression.right);
    }
  }
  return undefined;
}

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    schema: [],
    messages: {
      mismatch: "Filename '{{filename}}' must match the default export '{{exportName}}'.",
      indexMismatch:
        "Directory '{{directory}}' must match the default export '{{exportName}}' from its index file.",
    },
  },

  create(context) {
    return {
      Program(node) {
        const filename = context.filename ?? context.getFilename();
        if (filename === "<text>" || filename === "<input>") {
          return;
        }

        const name = exportedName(node);
        if (!name) {
          return;
        }

        const extension = path.extname(filename);
        const basename = path.basename(filename, extension);
        const isIndex = basename === "index";
        const expected = isIndex ? path.basename(path.dirname(filename)) : basename;
        if (expected === name || (expected === "index" && name === "index")) {
          return;
        }

        context.report({
          node,
          messageId: isIndex ? "indexMismatch" : "mismatch",
          data: isIndex
            ? { directory: expected, exportName: name }
            : { filename: basename, exportName: name },
        });
      },
    };
  },
};
