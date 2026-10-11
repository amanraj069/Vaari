/**
 * The farmer pages' small pieces: "Back" returns to the previous Vaari page (or a fallback when the
 * page was opened directly), and "Open WhatsApp" types the greeting in the page's language.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackButton } from "@/components/back-button";
import { WhatsAppStart, whatsappStartUrl } from "@/components/whatsapp-start";
import { renderWithIntl } from "./render";

const router = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/farmer/signin" }));

afterEach(() => {
  router.back.mockReset();
  router.push.mockReset();
  Reflect.deleteProperty(window, "navigation");
});

describe("Back", () => {
  it("goes back when a Vaari page is behind this one", async () => {
    Object.defineProperty(window, "navigation", { value: { canGoBack: true }, configurable: true });
    renderWithIntl(<BackButton fallback="/" />);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(router.back).toHaveBeenCalledOnce();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("opens the fallback page when the page was opened directly", async () => {
    Object.defineProperty(window, "navigation", { value: { canGoBack: false }, configurable: true });
    renderWithIntl(<BackButton fallback="/farmer" />, "pa");
    await userEvent.click(screen.getByRole("button", { name: "ਪਿੱਛੇ" }));
    expect(router.push).toHaveBeenCalledWith("/farmer");
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe("Open WhatsApp", () => {
  it.each([
    ["en", "Sat Sri Akal"],
    ["pa", "ਸਤ ਸ੍ਰੀ ਅਕਾਲ"],
    ["hi", "सत श्री अकाल"],
  ] as const)("in %s types %s in the link and the chat, with phone mockup visible and no extra text fields", (locale, greeting) => {
    const { container } = renderWithIntl(<WhatsAppStart number="910000000000" />, locale);
    const link = container.querySelector("a[href^='https://wa.me/']");
    expect(link).toHaveAttribute("href", whatsappStartUrl("910000000000", greeting));
    expect(link?.getAttribute("href")).toBe(`https://wa.me/910000000000?text=${encodeURIComponent(greeting)}`);
    expect(screen.getByRole("img", { name: new RegExp(greeting) })).toBeInTheDocument();
    expect(screen.queryByText(/No app to learn/)).not.toBeInTheDocument();
    expect(screen.queryByText("Example chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Prefer to chat?")).not.toBeInTheDocument();
    // No line under the button explaining what it does.
    expect(container.querySelector("a + p")).toBeNull();
  });

  it("shows the capabilities text on the signin page when fill/showDescription is true", () => {
    renderWithIntl(<WhatsAppStart number="910000000000" fill />);
    expect(screen.getByText(/No app to learn/)).toBeInTheDocument();
  });

  it("on sign-in (fill) shows the phone picture only beside the form, so above the form on phones the card stays short", () => {
    renderWithIntl(<WhatsAppStart number="910000000000" fill />);
    const pictureBox = screen.getByRole("img", { name: /Sat Sri Akal/ }).parentElement!;
    expect(pictureBox.className).toContain("hidden lg:flex");
    expect(pictureBox.className).not.toContain("sm:flex");
  });
});
