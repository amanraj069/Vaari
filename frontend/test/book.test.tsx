/**
 * /book: the booking form steps (with the farmer's phone and consent), the slot-link hand-off, and
 * the booked list with status badges, copy and "new link".
 */
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BookForm } from "@/components/book-form";
import { BookedList } from "@/components/booked-list";
import { SAMPLE_BOOKED, SAMPLE_FIELDS, SAMPLE_TODAY } from "@/lib/samples";
import { renderWithIntl } from "./render";

const villages = [
  { id: "v1", name: "Balian", namePa: null },
  { id: "v2", name: "Akoi", namePa: null },
];

async function fillToCheck() {
  const user = userEvent.setup();
  const next = () => user.click(screen.getByRole("button", { name: /Next/ }));
  expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
  await user.type(screen.getByRole("textbox", { name: /Farmer's name/ }), "Paramjit Kaur");
  await next();
  // The phone: a wrong number says so and blocks Next; a right one still needs the farmer's consent.
  const phone = screen.getByRole("textbox", { name: /Paramjit Kaur's mobile number/ });
  await user.type(phone, "12345");
  expect(phone).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText(/Type a 10-digit mobile number/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
  await user.clear(phone);
  await user.type(phone, "98765 43210");
  expect(phone).toHaveAttribute("aria-invalid", "false");
  expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /Paramjit Kaur agrees to get messages/ }));
  await next();
  await user.click(screen.getByRole("button", { name: "Akoi" }));
  await next();
  await user.click(screen.getByRole("button", { name: "More" }));
  await next();
  await user.click(screen.getByRole("button", { name: /Tomorrow/ }));
  await next();
  const slider = screen.getByRole("slider", { name: "Waiting" });
  expect(slider).toHaveAttribute("min", "3");
  expect(slider).toHaveAttribute("max", "10");
  fireEvent.change(slider, { target: { value: "8" } });
  await next();
  return user;
}

describe("BookForm", () => {
  it("walks the steps, confirms, books and hands over a link to copy", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ field: { ...SAMPLE_FIELDS.window, farmerName: "Paramjit Kaur" }, slot: { token: "abc", path: "/slot/abc" } });
    renderWithIntl(<BookForm villages={villages} today={SAMPLE_TODAY} onSubmit={onSubmit} origin="https://vaari.example" />);
    const user = await fillToCheck();
    // user-event installs its own clipboard on setup; spy on that one.
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    const summary = screen.getByRole("heading", { name: "Check before booking" }).parentElement!;
    expect(within(summary).getByText("Paramjit Kaur")).toBeInTheDocument();
    // The facilitator sees the number they typed, as it will be stored.
    expect(within(summary).getByText("+919876543210")).toBeInTheDocument();
    expect(within(summary).getByText("Akoi")).toBeInTheDocument();
    expect(within(summary).getByText("3.5 acres")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Book and get the link" }));
    expect(onSubmit).toHaveBeenCalledWith({
      farmerName: "Paramjit Kaur",
      farmerPhone: "+919876543210",
      consent: true,
      villageId: "v2",
      acres: 3.5,
      readyDate: "2026-11-01",
      waitingLimitDays: 8,
    });
    expect(await screen.findByRole("heading", { name: "Booked for Paramjit Kaur" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://vaari.example/slot/abc")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("https://vaari.example/slot/abc");
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
  });

  it("shows a failure and keeps the answers when booking fails", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("500"));
    renderWithIntl(<BookForm villages={villages} today={SAMPLE_TODAY} onSubmit={onSubmit} />);
    const user = await fillToCheck();
    await user.click(screen.getByRole("button", { name: "Book and get the link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not book. Please try again.");
    expect(screen.getByText("Paramjit Kaur")).toBeInTheDocument();
  });

  it("shows a loading list of villages", () => {
    renderWithIntl(<BookForm villages={null} today={null} onSubmit={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Book a field for a farmer" })).toBeInTheDocument();
  });
});

describe("BookedList", () => {
  it("shows status badges from the promise, never an unpromised date", () => {
    const { container } = renderWithIntl(<BookedList state={{ kind: "ready", items: SAMPLE_BOOKED }} onCopyLink={vi.fn()} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText(/Firm date/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/Window/)).toBeInTheDocument();
    expect(within(rows[2]!).getByText("No date yet")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Burn risk")).toBeInTheDocument();
    // Row 3's planned day (8 Nov) has no promise behind it.
    expect(container.textContent).not.toMatch(/Nov 8|8 Nov/);
  });

  it("copies a farmer's link from the list", async () => {
    const onCopyLink = vi.fn();
    renderWithIntl(<BookedList state={{ kind: "ready", items: SAMPLE_BOOKED }} onCopyLink={onCopyLink} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy link for Baldev Singh" }));
    expect(onCopyLink).toHaveBeenCalledWith(SAMPLE_BOOKED[1]);
  });

  it("gives a farmer a new link only after a confirmation that the old one stops working", async () => {
    const onReissueLink = vi.fn().mockResolvedValue(undefined);
    renderWithIntl(<BookedList state={{ kind: "ready", items: SAMPLE_BOOKED }} onCopyLink={vi.fn()} onReissueLink={onReissueLink} />);
    await userEvent.click(screen.getByRole("button", { name: "New link for Baldev Singh" }));
    expect(onReissueLink).not.toHaveBeenCalled();
    expect(screen.getByText(/The old link stops working at once/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Make a new link and copy it" }));
    expect(onReissueLink).toHaveBeenCalledWith(SAMPLE_BOOKED[1]);
  });

  it("keeps the dialog open with the reason when a new link cannot be made", async () => {
    const onReissueLink = vi.fn().mockRejectedValue(new Error("500"));
    renderWithIntl(<BookedList state={{ kind: "ready", items: SAMPLE_BOOKED }} onCopyLink={vi.fn()} onReissueLink={onReissueLink} />);
    await userEvent.click(screen.getByRole("button", { name: "New link for Manjit Kaur" }));
    await userEvent.click(screen.getByRole("button", { name: "Make a new link and copy it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not make a new link. Try again.");
  });

  it("empty, loading and error states", async () => {
    renderWithIntl(<BookedList state={{ kind: "ready", items: [] }} onCopyLink={vi.fn()} />);
    expect(screen.getByText("No fields booked yet")).toBeInTheDocument();
    const onRetry = vi.fn();
    renderWithIntl(<BookedList state={{ kind: "error", onRetry }} onCopyLink={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    const { container } = renderWithIntl(<BookedList state={{ kind: "loading" }} onCopyLink={vi.fn()} />);
    expect(container.querySelectorAll(".animate-pulse").length).toBe(2);
  });

  it.each(["pa", "hi"] as const)("renders in %s with no missing text", (locale) => {
    renderWithIntl(<BookedList state={{ kind: "ready", items: SAMPLE_BOOKED }} onCopyLink={vi.fn()} onReissueLink={vi.fn()} />, locale);
    renderWithIntl(<BookForm villages={villages} today={SAMPLE_TODAY} onSubmit={vi.fn()} />, locale);
  });
});
