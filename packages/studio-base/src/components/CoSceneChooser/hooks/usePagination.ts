// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

// SPDX-FileCopyrightText: Copyright (C) 2022-2024 Shanghai coScene Information Technology Co., Ltd.<contact@coscene.io>
// SPDX-License-Identifier: MPL-2.0

import { useState, useCallback } from "react";
import { useDebounce } from "use-debounce";

import { PaginationState } from "../types";

export function usePagination(initialPageSize = 20): {
  page: number;
  pageSize: number;
  filter: string;
  debouncedFilter: string;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setFilter: (filter: string) => void;
  resetState: () => void;
} {
  const [state, setState] = useState<PaginationState>({
    page: 0,
    pageSize: initialPageSize,
    filter: "",
  });

  const [debouncedFilter] = useDebounce(state.filter, 500);

  const setPage = useCallback((page: number) => {
    setState((prev) => ({ ...prev, page }));
  }, []);

  const setPageSize = useCallback((pageSize: number) => {
    setState((prev) => ({ ...prev, pageSize, page: 0 }));
  }, []);

  const setFilter = useCallback((filter: string) => {
    setState((prev) => ({ ...prev, filter, page: 0 }));
  }, []);

  const resetState = useCallback(() => {
    setState({
      page: 0,
      pageSize: initialPageSize,
      filter: "",
    });
  }, [initialPageSize]);

  return {
    ...state,
    debouncedFilter,
    setPage,
    setPageSize,
    setFilter,
    resetState,
  };
}
