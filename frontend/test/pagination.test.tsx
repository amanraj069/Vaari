/**
 * Long lists are drawn a page at a time: the hook slices, keeps its page through a poll, goes back to
 * page 1 on a new search or filter and never points past the last page when the list shrinks. The
 * operator queue shows 25 fields a page with the counts still over every field, and a list that
 * fits on one page looks exactly as before (no page controls).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, renderHook, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookedList } from "@/components/booked-list";
import { OperatorQueueView } from "@/components/views/operator-queue";
import { usePagination } from "@/lib/use-pagination";
import type { QueueItem } from "@/shared";
import { renderWithIntl } from "./render";

const numbers = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

describe("usePagination", () => {
  it("slices one page and says which items it shows", () => {
    const { result } = renderHook(() => usePagination(numbers(45), { pageSize: 20 }));
    expect(result.current.pageItems).toEqual(numbers(20));
    expect(result.current).toMatchObject({ page: 1, pageCount: 3, total: 45, firstShown: 1, lastShown: 20 });
    act(() => result.current.setPage(3));
    expect(result.current.pageItems).toEqual([41, 42, 43, 44, 45]);
    expect(result.current).toMatchObject({ page: 3, firstShown: 41, lastShown: 45 });
  });

  it("keeps its page when the same list comes back from a poll, and starts again on a new filter", () => {
    const { result, rerender } = renderHook(({ items, resetKey }) => usePagination(items, { pageSize: 10, resetKey }), { initialProps: { items: numbers(30), resetKey: "all|" } });
    act(() => result.current.setPage(2));
    rerender({ items: numbers(30), resetKey: "all|" });
    expect(result.current.page).toBe(2);
    rerender({ items: numbers(30), resetKey: "at_risk|" });
    expect(result.current.page).toBe(1);
  });

  it("never points past the last page when the list shrinks, and an empty list is one empty page", () => {
    const { result, rerender } = renderHook(({ items }) => usePagination(items, { pageSize: 10 }), { initialProps: { items: numbers(30) } });
    act(() => result.current.setPage(3));
    rerender({ items: numbers(12) });
    expect(result.current).toMatchObject({ page: 2, pageCount: 2, pageItems: [11, 12] });
    rerender({ items: [] });
    expect(result.current).toMatchObject({ page: 1, pageCount: 1, pageItems: [], firstShown: 0, lastShown: 0 });
  });

  it("clamps a requested page to the pages there are", () => {
    const { result } = renderHook(() => usePagination(numbers(25), { pageSize: 10 }));
    act(() => result.current.setPage(99));
    expect(result.current.page).toBe(3);
    act(() => result.current.setPage(-4));
    expect(result.current.page).toBe(1);
  });
});

const item = (index: number): QueueItem => ({
  fieldId: `f${index}`,
  token: index,
  farmerName: `Farmer ${index}`,
  villageName: index % 2 === 0 ? "Balian" : "Ubhawal",
  acres: 3,
  readyDate: "2026-11-01",
  burnDeadlineDate: "2026-11-08",
  plannedDate: "2026-11-03",
  promise: null,
  slackDays: 5,
  risk: "safe",
});

function serveQueue(count: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ today: "2026-10-31", items: numbers(count).map(item) }), { status: 200, headers: { "content-type": "application/json" } })),
  );
}
const renderQueue = () => renderWithIntl(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OperatorQueueView /></QueryClientProvider>);
const queueRows = () => within(document.getElementById("queue-list")!).getAllByRole("listitem");

afterEach(() => vi.unstubAllGlobals());

describe("operator queue pages", () => {
  it("shows 25 fields a page, counts every field, and a search starts again at page 1", async () => {
    serveQueue(30);
    renderQueue();
    expect(await screen.findByText("Farmer 1")).toBeInTheDocument();
    expect(queueRows()).toHaveLength(25);
    const pages = screen.getByRole("navigation", { name: "Pages" });
    expect(within(pages).getByText("1–25 of 30")).toBeInTheDocument();
    expect(within(pages).getByText("Page 1 of 2")).toBeInTheDocument();
    expect(within(pages).getByRole("button", { name: "Previous page" })).toBeDisabled();
    // The filter's count is still the whole centre, not the page.
    expect(screen.getByRole("radio", { name: /All/ })).toHaveTextContent("30");

    fireEvent.click(within(pages).getByRole("button", { name: "Next page" }));
    expect(queueRows()).toHaveLength(5);
    expect(screen.getByText("Farmer 30")).toBeInTheDocument();
    expect(screen.queryByText("Farmer 1")).not.toBeInTheDocument();
    expect(within(pages).getByRole("button", { name: "Next page" })).toBeDisabled();

    // "Farmer 2" matches Farmer 2 and Farmer 20-29: eleven fields, one page, back to the plain footer.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Farmer 2" } });
    expect(queueRows()).toHaveLength(11);
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();
    expect(screen.getByText("Showing 11 of 30 fields")).toBeInTheDocument();
  });

  it("a queue that fits on one page has no page controls", async () => {
    serveQueue(25);
    renderQueue();
    expect(await screen.findByText("Farmer 25")).toBeInTheDocument();
    expect(queueRows()).toHaveLength(25);
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();
    expect(screen.getByText("Showing 25 of 25 fields")).toBeInTheDocument();
  });
});

describe("booked list pages", () => {
  it("shows every row without a page size, and one page of them with it", () => {
    const items = numbers(23).map(item);
    const { unmount } = renderWithIntl(<BookedList state={{ kind: "ready", items }} onCopyLink={() => undefined} />);
    expect(screen.getAllByRole("button", { name: /Copy link for/ })).toHaveLength(23);
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();
    unmount();

    renderWithIntl(<BookedList state={{ kind: "ready", items }} pageSize={20} onCopyLink={() => undefined} />);
    expect(screen.getAllByRole("button", { name: /Copy link for/ })).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getAllByRole("button", { name: /Copy link for/ })).toHaveLength(3);
    expect(screen.getByText("21–23 of 23")).toBeInTheDocument();
  });
});
