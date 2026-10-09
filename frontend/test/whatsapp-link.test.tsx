/** "See all my fields" on the slot page: WhatsApp with Vaari's number and "my fields" typed in, never the farmer's own number. */
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SlotView, type SlotState } from "@/components/slot-view";
import { MY_FIELDS_MESSAGE, myFieldsUrl } from "@/components/whatsapp-link";
import { SAMPLE_FIELDS, SAMPLE_REASONS, SAMPLE_TODAY } from "@/lib/samples";
import { renderWithIntl } from "./render";

const ready: SlotState = { kind: "ready", field: SAMPLE_FIELDS.window, today: SAMPLE_TODAY, why: { kind: "ready", reasons: SAMPLE_REASONS }, onCannotWait: vi.fn() };

describe("slot page: See all my fields", () => {
  it("opens WhatsApp with Vaari's number and 'my fields' typed in", () => {
    renderWithIntl(<SlotView state={ready} whatsappNumber="910000000000" />);
    const link = screen.getByRole("link", { name: "See all my fields" });
    expect(link).toHaveAttribute("href", "https://wa.me/910000000000?text=my%20fields");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(MY_FIELDS_MESSAGE).toBe("my fields");
    expect(myFieldsUrl("+91 00000 00000")).toBe("https://wa.me/910000000000?text=my%20fields");
  });

  it("is offered on a link that no longer works, and hidden without a configured number", () => {
    renderWithIntl(<SlotView state={{ kind: "invalid" }} whatsappNumber="910000000000" />);
    expect(screen.getByRole("link", { name: "See all my fields" })).toBeInTheDocument();
    renderWithIntl(<SlotView state={ready} />);
    expect(screen.getAllByRole("link", { name: "See all my fields" })).toHaveLength(1);
  });

  it("never shows a phone number of the farmer", () => {
    const { container } = renderWithIntl(<SlotView state={ready} whatsappNumber="910000000000" />);
    // Only the business number, and only inside the WhatsApp link's address.
    expect(container.textContent).not.toMatch(/\+?\d[\d\s]{8,}\d/);
  });
});
