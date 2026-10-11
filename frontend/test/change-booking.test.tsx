/**
 * "Change booking": a new harvest day posts to the booking's own address; cancelling needs a
 * second "yes", and only then is anything sent.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangeBooking } from "@/components/change-booking";
import { renderWithIntl } from "./render";

const calls: { url: string; body: string }[] = [];
afterEach(() => vi.unstubAllGlobals());

function serve() {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}

describe("change booking", () => {
  it("saves a new harvest day", async () => {
    serve();
    const onDone = vi.fn();
    renderWithIntl(<ChangeBooking base="farmer/fields/chc-balian/f-1" readyDate="2026-11-02" today="2026-10-31" onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Change booking" }));
    const dialog = await screen.findByRole("dialog", { name: "Change this booking" });
    fireEvent.change(within(dialog).getByLabelText("New harvest day"), { target: { value: "2026-11-05" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("harvest"));
    expect(calls[0]).toMatchObject({ url: expect.stringContaining("farmer/fields/chc-balian/f-1/harvest"), body: JSON.stringify({ readyDate: "2026-11-05" }) });
  });

  it("cancels only after a second yes", async () => {
    serve();
    const onDone = vi.fn();
    renderWithIntl(<ChangeBooking compact label="Paramjit Kaur" base="fields/f-2" readyDate="2026-11-02" today="2026-10-31" onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Change the booking for Paramjit Kaur" }));
    const dialog = await screen.findByRole("dialog", { name: "Change this booking" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel booking" }));
    expect(calls).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, cancel" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("cancel"));
    expect(calls[0]?.url).toContain("fields/f-2/cancel");
  });
});
