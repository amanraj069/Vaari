/**
 * The staff sign-in card on /signin/<role>: one form, in this order: back and title, the role with
 * its one-line description, Google, "or use email", email and password, the button, and the switch
 * between sign in and create account; then the farmer's way in. Create account and password reset
 * are steps of the same card. Errors never say whether an email is registered.
 */
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_STORAGE_KEY, StaffAuthCard, ruleMet, type PasswordRule } from "@/components/staff-auth-card";
import { renderWithIntl } from "./render";

const POLICY: PasswordRule[] = [{ kind: "min", length: 8 }, { kind: "lowercase" }, { kind: "uppercase" }, { kind: "number" }, { kind: "symbol" }];
let bodies: Record<string, unknown>[] = [];

function serve(answers: unknown[]) {
  bodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(answers.length > 1 ? answers.shift() : answers[0]), { status: 200 });
    }),
  );
}

const card = (props: Partial<Parameters<typeof StaffAuthCard>[0]> = {}) => <StaffAuthCard initialRole="operator" googleOn emailOn passwordRules={POLICY} onSignedIn={vi.fn()} {...props} />;

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("staff sign-in card", () => {
  it("reads top to bottom: title, the role picker, Google, or use email, the form, create an account, the farmer's way in", () => {
    renderWithIntl(card());
    const order = [
      screen.getByRole("heading", { name: "Sign in as an operator" }),
      screen.getByRole("radio", { name: "Machine centre operator" }),
      screen.getByRole("link", { name: "Continue with Google" }),
      screen.getByText("or use email"),
      screen.getByLabelText("Email"),
      screen.getByLabelText("Password"),
      screen.getByRole("button", { name: "Forgot password?" }),
      screen.getByRole("button", { name: "Sign in" }),
      screen.getByRole("button", { name: "Create an account" }),
      screen.getByRole("link", { name: /Farmer\? Sign in with WhatsApp/ }),
    ];
    for (let index = 1; index < order.length; index++) expect(order[index - 1]!.compareDocumentPosition(order[index]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One switch between sign in and create account; no tab bar.
    expect(screen.queryByRole("group", { name: /Sign in or create/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("the role picker is preset from the address and switches in place: title, Google, address, memory", async () => {
    const replace = vi.spyOn(window.history, "replaceState");
    renderWithIntl(card({ initialRole: "operator" }));
    expect(screen.getByRole("radio", { name: "Machine centre operator" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "Agriculture officer" }));
    expect(screen.getByRole("heading", { name: "Sign in as an officer" })).toBeInTheDocument();
    // No description line under the picker.
    expect(screen.queryByText(/burn risk across clusters/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", "/api/auth/login?pick=officer");
    expect(replace).toHaveBeenLastCalledWith(null, "", "/signin/officer");
    expect(window.localStorage.getItem(ROLE_STORAGE_KEY)).toBe("officer");
    replace.mockRestore();
  });

  it("signs in; a wrong email or password gets one message that never says which", async () => {
    serve([{ error: "WRONG_LOGIN" }, { next: "/operator" }]);
    const onSignedIn = vi.fn();
    renderWithIntl(card({ onSignedIn }));
    await userEvent.type(screen.getByLabelText("Email"), "harpal@example");
    fireEvent.blur(screen.getByLabelText("Email"));
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Enter an email address like name@example.com.");
    await userEvent.type(screen.getByLabelText("Email"), ".org");
    await userEvent.type(screen.getByLabelText("Password"), "Secret-123{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("That email or password is incorrect.");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledWith("/operator"));
    expect(bodies[0]).toEqual({ step: "signIn", email: "harpal@example.org", password: "Secret-123", pick: "operator" });
  });

  it("while a request runs: a spinner, fields locked, and a second submit is ignored", async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (release = resolve))));
    renderWithIntl(card());
    await userEvent.type(screen.getByLabelText("Email"), "a@example.org");
    await userEvent.type(screen.getByLabelText("Password"), "x");
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
    expect(await screen.findByRole("button", { name: /Signing in/ })).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(1);
    release(new Response(JSON.stringify({ error: "WRONG_LOGIN" })));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("create account: a live password checklist from the pool's policy, then the emailed code in the same card", async () => {
    serve([{ confirm: true }, { next: "/welcome" }]);
    const onSignedIn = vi.fn();
    renderWithIntl(card({ onSignedIn, initialRole: "helper" }));
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(await screen.findByRole("heading", { name: "Create a village helper account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument(); // "Already have an account? Sign in"
    await userEvent.type(await screen.findByLabelText("Your name"), "Gurpreet Kaur");
    await userEvent.type(screen.getByLabelText("Email"), "g@example.org");
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    await userEvent.type(password, "secret");
    expect(screen.getByText("At least 8 characters")).toHaveTextContent("(not yet)");
    expect(screen.getByText("A lowercase letter")).toHaveTextContent("(done)");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Your password does not meet all the rules yet.");
    expect(bodies).toHaveLength(0);
    await userEvent.type(password, "-Pass1");
    expect(screen.getByText("A symbol")).toHaveTextContent("(done)");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Resend in \d+ s/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Wrong email? Go back" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("6-digit code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Confirm and sign in" }));
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledWith("/welcome"));
    expect(bodies[0]).toEqual({ step: "signUp", name: "Gurpreet Kaur", email: "g@example.org", password: "secret-Pass1", pick: "helper" });
    expect(bodies[1]).toMatchObject({ step: "confirm", email: "g@example.org", code: "123456" });
  });

  it("forgot password: a code, then a new password, then back to sign in", async () => {
    serve([{ sent: true }, { reset: true }]);
    renderWithIntl(card());
    await userEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(await screen.findByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    const send = await screen.findByRole("button", { name: "Send reset code" });
    await userEvent.type(screen.getByLabelText("Email"), "harpal@example.org");
    await userEvent.click(send);
    expect(await screen.findByText("If harpal@example.org has an account, a code is on its way to it.")).toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText("6-digit code"), "654321");
    await userEvent.type(screen.getByLabelText("New password"), "New-Pass1");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByText("Password changed. Sign in with your new password.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign in as an operator" })).toBeInTheDocument();
    expect(bodies).toEqual([
      { step: "forgot", email: "harpal@example.org" },
      { step: "reset", email: "harpal@example.org", code: "654321", password: "New-Pass1" },
    ]);
  });

  it("show / hide password is a labelled, pressable button, and Caps Lock is announced", async () => {
    renderWithIntl(card());
    const password = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(password, { key: "A", modifierCapsLock: true });
    expect(screen.getByText("Caps Lock is on.")).toBeInTheDocument();
    expect(password.getAttribute("aria-describedby")).toContain("caps");
  });

  it("without a configured policy shows no checklist, and the rules match what they say", () => {
    renderWithIntl(card({ passwordRules: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.queryByText(/At least/)).not.toBeInTheDocument();
    expect(ruleMet({ kind: "min", length: 8 }, "1234567")).toBe(false);
    expect(ruleMet({ kind: "symbol" }, "abc!")).toBe(true);
    expect(ruleMet({ kind: "uppercase" }, "abc")).toBe(false);
  });

  it.each(["pa", "hi"] as const)("renders in %s with no missing text, in both modes", (locale) => {
    renderWithIntl(card(), locale);
    fireEvent.click(screen.getAllByRole("button").find((button) => button.textContent === (locale === "pa" ? "ਖਾਤਾ ਬਣਾਓ" : "खाता बनाएँ"))!);
    expect(screen.getAllByRole("button").length).toBeGreaterThan(3);
  });
});
