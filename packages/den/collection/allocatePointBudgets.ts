// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

/**
 * Fairly distributes a total point budget without taking points away from short series.
 * Remainders are assigned in input order to keep the result deterministic.
 */
export function allocatePointBudgets(lengths: readonly number[], totalBudget: number): number[] {
  if (!Number.isFinite(totalBudget) || totalBudget < 0) {
    throw new RangeError("totalBudget must be a finite non-negative number");
  }
  for (const length of lengths) {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new RangeError("series lengths must be non-negative safe integers");
    }
  }

  const budgets = lengths.map(() => 0);
  let remainingBudget = Math.min(
    Math.floor(totalBudget),
    lengths.reduce((sum, length) => sum + length, 0),
  );
  let remainingIndices = lengths.flatMap((length, index) => (length > 0 ? [index] : []));

  while (remainingBudget > 0 && remainingIndices.length > 0) {
    const evenShare = Math.floor(remainingBudget / remainingIndices.length);
    const shortIndices = remainingIndices.filter(
      (index) => lengths[index]! - budgets[index]! <= evenShare,
    );

    if (shortIndices.length > 0) {
      const shortIndexSet = new Set(shortIndices);
      for (const index of shortIndices) {
        const allocation = lengths[index]! - budgets[index]!;
        budgets[index]! += allocation;
        remainingBudget -= allocation;
      }
      remainingIndices = remainingIndices.filter((index) => !shortIndexSet.has(index));
      continue;
    }

    for (const index of remainingIndices) {
      budgets[index]! += evenShare;
      remainingBudget -= evenShare;
    }

    for (const index of remainingIndices) {
      if (remainingBudget === 0) {
        break;
      }
      if (budgets[index]! < lengths[index]!) {
        budgets[index]!++;
        remainingBudget--;
      }
    }
    break;
  }

  return budgets;
}
