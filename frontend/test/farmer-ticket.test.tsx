/** /farmer/new: a registered farmer books a field for their own phone in five steps; no name, phone or consent to ask. */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FarmerTicketForm } from "@/components/farmer-ticket-form";
import { ApiError } from "@/lib/api";
import { SAMPLE_FIELDS, SAMPLE_TODAY } from "@/lib/samples";
import type { Booking, FarmerVillageOption } from "@/shared";
import { renderWithIntl } from "./render";

const VILLAGES: FarmerVillageOption[] = [
  { id: "v-balian", name: "Balian", namePa: null, chcId: "chc-balian", chcName: "Balian Cooperative Society" },
  { id: "v-ubhawal", name: "Ubhawal", namePa: null, chcId: "chc-balian", chcName: "Balian Cooperative Society" },
];
const BOOKED: Booking = { field: { ...SAMPLE_FIELDS.firm, acres: 3, villageName: "Ubhawal" }, slot: { token: "t", path: "/slot/t" } };

async function walkToReview() {
  await userEvent.click(screen.getByRole("button", { name: "Ubhawal" }));
  await userEvent.click(screen.getByRole("button", { name: /Next/ }));
  await userEvent.click(screen.getByRole("button", { name: /Next/ }));
  await userEvent.click(screen.getByRole("button", { name: /Today/ }));
  await userEvent.click(screen.getByRole("button", { name: /Next/ }));
  await userEvent.click(screen.getByRole("button", { name: /Next/ }));
}

describe("a farmer's new booking", () => {
  it("asks only about the field, shows the machine centre, and books it", async () => {
    const onSubmit = vi.fn(async () => BOOKED);
    renderWithIntl(<FarmerTicketForm villages={VILLAGES} today={SAMPLE_TODAY} onSubmit={onSubmit} />);
    expect(screen.queryByRole("textbox", { name: /phone|name/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
    await walkToReview();
    expect(screen.getByText("Balian Cooperative Society")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Book this field" }));
    expect(onSubmit).toHaveBeenCalledWith({ villageId: "v-ubhawal", acres: 3, readyDate: SAMPLE_TODAY, waitingLimitDays: 6 });
    expect(await screen.findByText("Your turn is booked")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See my fields" })).toHaveAttribute("href", "/dashboard");
  });

  it("explains the 10-field limit and a missing registration", async () => {
    const onSubmit = vi.fn<() => Promise<Booking>>().mockRejectedValueOnce(new ApiError(409, "TOO_MANY_FIELDS")).mockRejectedValueOnce(new ApiError(403, "NOT_REGISTERED"));
    renderWithIntl(<FarmerTicketForm villages={VILLAGES} today={SAMPLE_TODAY} onSubmit={onSubmit} />);
    await walkToReview();
    await userEvent.click(screen.getByRole("button", { name: "Book this field" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You already have 10 fields waiting for a machine.");
    await userEvent.click(screen.getByRole("button", { name: "Book this field" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Register with your phone number first");
  });

  it.each(["pa", "hi"] as const)("renders in %s with no missing text", (locale) => {
    renderWithIntl(<FarmerTicketForm villages={VILLAGES} today={SAMPLE_TODAY} onSubmit={vi.fn()} />, locale);
    expect(screen.getAllByRole("button").length).toBeGreaterThan(2);
  });
});
