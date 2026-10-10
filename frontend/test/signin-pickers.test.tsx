/** /signin's pieces: farmers on WhatsApp, the staff role pick with Log in / Register and Google, demo accounts that take over the panel, the role pages' chips. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInChooser } from "@/components/signin-chooser";
import { renderWithIntl } from "./render";

afterEach(() => vi.unstubAllGlobals());

describe("sign-in choices", () => {
  const people = [
    { role: "farmer" as const, name: "Jaswinder Singh", detail: "Farmer · 6 acres in Balian" },
    { role: "officer" as const, name: "District agriculture officer", detail: "Officer" },
  ];
  const renderChooser = (googleOn = true) =>
    renderWithIntl(
      <QueryClientProvider client={new QueryClient()}>
        <SignInChooser people={people} googleOn={googleOn} />
      </QueryClientProvider>,
    );

  it("two audiences in two labelled sections; staff: Log in / Register, then or, then Google; no role picker here", () => {
    renderChooser();
    expect(screen.getByRole("region", { name: "For farmers" })).toContainElement(screen.getByRole("link", { name: /Sign in with WhatsApp/ }));
    const staff = screen.getByRole("region", { name: "For village helpers, operators and officers" });
    // The label names the audience; the card does not say it again.
    expect(within(staff).queryByRole("heading")).not.toBeInTheDocument();
    const login = within(staff).getByRole("link", { name: "Log in / Register" });
    const google = within(staff).getByRole("link", { name: "Continue with Google" });
    expect(login).toHaveAttribute("href", "/signin/helper");
    expect(google).toHaveAttribute("href", "/api/auth/login");
    expect(login.compareDocumentPosition(within(staff).getByText("or")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(staff).getByText("or").compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("Log in / Register opens the role last used: from the address, else this browser", () => {
    renderWithIntl(
      <QueryClientProvider client={new QueryClient()}>
        <SignInChooser people={people} googleOn initialPick="officer" />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("link", { name: "Log in / Register" })).toHaveAttribute("href", "/signin/officer");
  });

  it("'Try the demo accounts' swaps the section for the demo people, each tagged Demo, and goes back", async () => {
    renderChooser();
    await userEvent.click(screen.getByRole("button", { name: /Try the demo accounts/ }));
    expect(await screen.findByRole("heading", { name: "Demo accounts" })).toBeInTheDocument();
    expect(screen.getAllByText("Demo")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Use this account" })).toHaveLength(2);
    await vi.waitFor(() => expect(screen.queryByRole("link", { name: "Log in / Register" })).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(await screen.findByRole("link", { name: "Log in / Register" })).toBeInTheDocument();
  });
});
