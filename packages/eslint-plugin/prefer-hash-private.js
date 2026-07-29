// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

function isThisBindingResetBetween(node, classNode) {
  for (let current = node.parent; current && current !== classNode; current = current.parent) {
    if (
      current.type === "FunctionDeclaration" ||
      (current.type === "FunctionExpression" &&
        current.parent?.type !== "MethodDefinition" &&
        current.parent?.type !== "PropertyDefinition")
    ) {
      return true;
    }
  }
  return false;
}

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "suggestion",
    hasSuggestions: true,
    schema: [],
    messages: {
      preferHash:
        "Prefer the JavaScript private name '{{newName}}' over the TypeScript private modifier.",
      rename: "Convert '{{oldName}}' to '{{newName}}'.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;
    const classes = [];
    const classStack = [];
    const memberOwners = new Map();

    function enterClass(node) {
      classStack.push({
        node,
        name: node.id?.name,
        definitions: [],
        privateNames: new Set(),
        references: new Map(),
        unsafeReferences: new Set(),
      });
    }

    function recordReference(node) {
      const currentClass = classStack.at(-1);
      const propertyName = node.computed
        ? node.property.type === "Literal" && typeof node.property.value === "string"
          ? node.property.value
          : undefined
        : node.property.type === "Identifier"
          ? node.property.name
          : undefined;
      if (!propertyName) {
        return;
      }

      const owners = memberOwners.get(propertyName) ?? new Set();
      owners.add(currentClass?.node);
      memberOwners.set(propertyName, owners);

      if (!currentClass) {
        return;
      }
      if (node.computed) {
        currentClass.unsafeReferences.add(propertyName);
        return;
      }

      const isThisReference = node.object.type === "ThisExpression";
      const isClassReference =
        currentClass.name &&
        node.object.type === "Identifier" &&
        node.object.name === currentClass.name;
      if (
        (!isThisReference && !isClassReference) ||
        (isThisReference && isThisBindingResetBetween(node, currentClass.node))
      ) {
        currentClass.unsafeReferences.add(propertyName);
        return;
      }

      const references = currentClass.references.get(propertyName) ?? [];
      references.push(node.property);
      currentClass.references.set(propertyName, references);
    }

    function exitClass() {
      const currentClass = classStack.pop();
      if (currentClass) {
        classes.push(currentClass);
      }
    }

    function reportClasses() {
      for (const currentClass of classes) {
        for (const definition of currentClass.definitions) {
          const oldName = definition.key.name;
          const newName = `#${oldName.replace(/^_/, "")}`;
          const references = currentClass.references.get(oldName) ?? [];
          const owners = memberOwners.get(oldName) ?? new Set();
          const hasExternalReference = [...owners].some((owner) => owner !== currentClass.node);
          const suggestionIsUnsafe =
            currentClass.unsafeReferences.has(oldName) ||
            currentClass.privateNames.has(newName.slice(1)) ||
            hasExternalReference;
          const suggest = suggestionIsUnsafe
            ? undefined
            : [
                {
                  messageId: "rename",
                  data: { oldName, newName },
                  *fix(fixer) {
                    const privateToken = sourceCode
                      .getTokens(definition)
                      .find((token) => token.type === "Keyword" && token.value === "private");
                    if (privateToken) {
                      const nextToken = sourceCode.getTokenAfter(privateToken);
                      yield fixer.removeRange([
                        privateToken.range[0],
                        nextToken?.range[0] ?? privateToken.range[1],
                      ]);
                    }
                    yield fixer.replaceText(definition.key, newName);
                    for (const reference of references) {
                      yield fixer.replaceText(reference, newName);
                    }
                  },
                },
              ];

          context.report({
            node: definition.key,
            messageId: "preferHash",
            data: { newName },
            suggest,
          });
        }
      }
    }

    return {
      ClassDeclaration: enterClass,
      ClassExpression: enterClass,
      MemberExpression: recordReference,
      "Program:exit": reportClasses,
      ":matches(PropertyDefinition, MethodDefinition)[computed=false] > PrivateIdentifier.key": (
        node,
      ) => {
        classStack.at(-1)?.privateNames.add(node.name);
      },
      ":matches(PropertyDefinition, MethodDefinition)[accessibility='private'][computed=false]": (
        node,
      ) => {
        const currentClass = classStack.at(-1);
        if (
          currentClass &&
          node.key.type === "Identifier" &&
          !(node.type === "MethodDefinition" && node.kind === "constructor")
        ) {
          currentClass.definitions.push(node);
        }
      },
      "ClassDeclaration:exit": exitClass,
      "ClassExpression:exit": exitClass,
    };
  },
};
