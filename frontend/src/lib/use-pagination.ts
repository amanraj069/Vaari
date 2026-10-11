/**
 * usePagination: one page of a list the client already holds. The lists that grow (a centre's whole
 * season of fields, a helper's bookings) still arrive whole, because their counts, filters and search
 * need every item; what costs is drawing hundreds of rows on a phone every few seconds of polling.
 *
 * The page survives polling (a refetch with the same filter keeps the operator where they are), goes
 * back to the first page when `resetKey` changes (a new search or filter), and is clamped to the
 * last page when the list shrinks under it (fields done or cancelled since the last poll).
 */
import { useState } from "react";

export type Pagination<Item> = {
  /** 1-based, always within 1..pageCount. */
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  /** 1-based position of the first and last item on this page (0 and 0 when the list is empty). */
  firstShown: number;
  lastShown: number;
  pageItems: Item[];
  setPage: (page: number) => void;
};

export function usePagination<Item>(items: readonly Item[], { pageSize, resetKey = "" }: { pageSize: number; resetKey?: string }): Pagination<Item> {
  // The requested page is remembered with the filter it was asked under, so a new filter starts at
  // page 1 without an effect (no flash of the old page) and without setting state while rendering.
  const [requested, setRequested] = useState({ resetKey, page: 1 });
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const requestedPage = requested.resetKey === resetKey ? requested.page : 1;
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const startIndex = (page - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);
  return {
    page,
    pageCount,
    pageSize,
    total: items.length,
    firstShown: pageItems.length === 0 ? 0 : startIndex + 1,
    lastShown: startIndex + pageItems.length,
    pageItems,
    setPage: (nextPage) => setRequested({ resetKey, page: Math.min(Math.max(1, nextPage), pageCount) }),
  };
}
