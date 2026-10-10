/**
 * /farmer/signin, one question at a time: the mobile number (+91 fixed, ten digits), the six-digit
 * code, and only for a number Vaari has never seen, the name and consent. The code goes to our own
 * route handler (which keeps the session in a cookie), never through the proxy. A demo code is
 * shown and labelled; every refusal has its own sentence; a button never sits dim without a reason.
 */
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FarmerSigninForm, mobileDigits } from "@/components/farmer-signin-form";
import { renderWithIntl } from "./render";

type Answer = { status: number; body: unknown };
const calls: { url: string; body: unknown }[] = [];

/** Answers each URL from its own queue (the last answer repeats). */
function serve(answers: Record<string, Answer[]>) {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const queue = answers[url] ?? [{ status: 404, body: { error: "NOT_FOUND" } }];
      const answer = queue.length > 1 ? queue.shift()! : queue[0]!;
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
    }),
  );
}

const REQUEST = "/api/proxy/farmer/otp/request";
const VERIFY = "/api/farmer/otp/verify";
const ACCOUNT = "/api/proxy/farmer/account";
const DEMO_SENT = { channel: "demo", expiresInSeconds: 600, resendInSeconds: 30, demoCode: "482913" };

/** Clicks a button even while it is aria-disabled (a real tap does reach it; that is the point). */
const tap = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

afterEach(() => vi.unstubAllGlobals());

describe("farmer sign-in", () => {
  it("takes ten digits after a fixed +91, whatever was pasted", () => {
    expect(mobileDigits("+91 98765 43210")).toBe("9876543210");
    expect(mobileDigits("098765-43210")).toBe("9876543210");
    expect(mobileDigits("98765432109999")).toBe("9876543210");
    renderWithIntl(<FarmerSigninForm />);
    const phone = screen.getByRole("textbox", { name: /Mobile number/ });
    expect(phone).toHaveAttribute("type", "tel");
    expect(phone).toHaveAttribute("inputmode", "numeric");
    expect(phone).toHaveAttribute("placeholder", "98765 43210");
    expect(screen.getByText("+91")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /I agree to get messages/ })).not.toBeChecked();
  });

  it("a new number: phone, then the demo code, then name and consent", async () => {
    serve({
      [REQUEST]: [{ status: 200, body: DEMO_SENT }],
      [VERIFY]: [{ status: 401, body: { error: "CODE_WRONG", attemptsLeft: 4 } }, { status: 200, body: { signedIn: true, registered: false } }],
      [ACCOUNT]: [{ status: 201, body: { name: "Paramjit Kaur" } }],
    });
    const onSignedIn = vi.fn();
    renderWithIntl(<FarmerSigninForm onSignedIn={onSignedIn} />);
    // Tapping too early says why instead of doing nothing: first the number, then the consent.
    tap("Send code on WhatsApp");
    expect(screen.getByText("Type your 10-digit mobile number to continue.")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: /Mobile number/ }), "90000 00201");
    tap("Send code on WhatsApp");
    expect(screen.getByText("Tick the box to continue.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    await userEvent.click(screen.getByRole("checkbox", { name: /I agree to get messages/ }));
    await userEvent.click(screen.getByRole("button", { name: "Send code on WhatsApp" }));
    expect(calls[0]).toEqual({ url: REQUEST, body: { phone: "+919000000201", language: "en" } });

    expect(await screen.findByText("Demo: no WhatsApp message is sent")).toBeInTheDocument();
    expect(screen.getByTestId("demo-code")).toHaveTextContent("482913");
    expect(screen.getByText("We sent a 6-digit code on WhatsApp to +91 90000 00201.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New code in \d+ s/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Wrong number? Change it" })).toBeInTheDocument();
    expect(screen.getByText("Can't get the code? Ask your village helper.")).toBeInTheDocument();

    const codeBox = screen.getByRole("textbox", { name: "6-digit code" });
    expect(codeBox).toHaveAttribute("autocomplete", "one-time-code");
    await userEvent.type(codeBox, "11a1111");
    expect(codeBox).toHaveValue("111111");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code is not right. 4 tries left.");
    await userEvent.clear(codeBox);
    await userEvent.type(codeBox, "482913");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    // New to Vaari: only the name now (the consent was given before the code).
    expect(await screen.findByRole("heading", { name: "Welcome to Vaari" })).toBeInTheDocument();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.getByText("This is the name the machine operator will see.")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0); // no second consent box
    tap("Continue");
    expect(screen.getByText("Type your name to continue.")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: /Your name/ }), "Paramjit Kaur");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(calls.at(-1)).toEqual({ url: ACCOUNT, body: { name: "Paramjit Kaur", consent: true, language: "en" } });
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledWith("/farmer"));
    // The code went to our route handler only; nothing ever posts a code through the proxy.
    expect(calls.filter((call) => call.url === VERIFY).map((call) => call.body)).toEqual([
      { phone: "+919000000201", code: "111111" },
      { phone: "+919000000201", code: "482913" },
    ]);
    expect(calls.some((call) => call.url.includes("proxy/farmer/otp/verify"))).toBe(false);
  });

  it("a known number (an account, or a helper's booking) goes straight to its page", async () => {
    serve({ [REQUEST]: [{ status: 200, body: DEMO_SENT }], [VERIFY]: [{ status: 200, body: { signedIn: true, registered: true } }] });
    const onSignedIn = vi.fn();
    renderWithIntl(<FarmerSigninForm next="/farmer/new" onSignedIn={onSignedIn} />);
    await userEvent.type(screen.getByRole("textbox", { name: /Mobile number/ }), "9000000207");
    await userEvent.click(screen.getByRole("checkbox", { name: /I agree to get messages/ }));
    await userEvent.click(screen.getByRole("button", { name: "Send code on WhatsApp" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "6-digit code" }), "482913");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledWith("/farmer/new"));
    expect(screen.queryByRole("heading", { name: "Welcome to Vaari" })).not.toBeInTheDocument();
  });

  it("'Wrong number? Change it' goes back to the number, and refusals say plainly why", async () => {
    serve({ [REQUEST]: [{ status: 200, body: DEMO_SENT }, { status: 429, body: { error: "RESEND_TOO_SOON", retryInSeconds: 12 } }, { status: 503, body: { error: "OTP_SEND_FAILED" } }] });
    renderWithIntl(<FarmerSigninForm />);
    await userEvent.type(screen.getByRole("textbox", { name: /Mobile number/ }), "9000000203");
    await userEvent.click(screen.getByRole("checkbox", { name: /I agree to get messages/ }));
    await userEvent.click(screen.getByRole("button", { name: "Send code on WhatsApp" }));
    await userEvent.click(await screen.findByRole("button", { name: "Wrong number? Change it" }));
    expect(screen.getByRole("textbox", { name: /Mobile number/ })).toHaveValue("9000000203");
    await userEvent.click(screen.getByRole("button", { name: "Send code on WhatsApp" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please wait 12 seconds before asking for a new code.");
    // A message that could not be sent: one line, and nothing more.
    await userEvent.click(screen.getByRole("button", { name: "Send code on WhatsApp" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Can't get the code\? Ask your village helper\.$/);
  });

  it("flags a ten-digit number that cannot be an Indian mobile", async () => {
    renderWithIntl(<FarmerSigninForm />);
    const phone = screen.getByRole("textbox", { name: /Mobile number/ });
    await userEvent.type(phone, "1234567890");
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveAccessibleDescription("Type your 10-digit mobile number.");
  });

  it.each(["pa", "hi"] as const)("renders in %s with no missing text", (locale) => {
    renderWithIntl(<FarmerSigninForm />, locale);
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });
});
