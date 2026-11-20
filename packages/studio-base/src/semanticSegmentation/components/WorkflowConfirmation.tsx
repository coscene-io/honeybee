// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<hi@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

export function WorkflowConfirmation({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  disabled = false,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <div className="seg-modal-backdrop">
      <div
        className="seg-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          if (event.key === "Tab") {
            const controls = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
            ];
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && event.target === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && event.target === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2>{title}</h2>
        {children}
        <div className="seg-row">
          <button type="button" disabled={disabled} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" autoFocus onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
