/**
 * /farmer behind a phone session: every field booked with the farmer's phone, read-only, and a way
 * back in (WhatsApp "my fields") when there is no session or the login link was used or expired.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FarmerHomeView, type LinkProblem } from "@/components/farmer-home";
import { ThemeProvider } from "@/contexts/theme-context";
import { SAMPLE_FIELDS, SAMPLE_TODAY } from "@/lib/samples";
import type { FarmerHome } from "@/shared";
import { renderWithIntl } from "./render";

const HOME: FarmerHome = {
  today: SAMPLE_TODAY,
  farmerName: "Jaswinder Singh",
  fields: [
    { ...SAMPLE_FIELDS.firm, id: "f-new", chcId: "chc-balian", chcName: "Balian Cooperative Society", operatorPhone: "" },
    { ...SAMPLE_FIELDS.done, id: "f-old", token: 7, chcId: "chc-other", chcName: "Other Society", operatorPhone: "" },
  ],
};

const requests: string[] = [];
function serve(answer: { status: number; body: unknown }) {
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
    }),
  );
}

function renderHome(options: { whatsappNumber?: string | null; linkProblem?: LinkProblem; locale?: "en" | "pa" | "hi" } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithIntl(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <FarmerHomeView whatsappNumber={options.whatsappNumber === undefined ? "910000000000" : options.whatsappNumber} linkProblem={options.linkProblem ?? null} />
      </QueryClientProvider>
    </ThemeProvider>,
    options.locale,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("/farmer (phone session)", () => {
  it("lists every field for the phone, each with its machine centre, read-only", async () => {
    serve({ status: 200, body: HOME });
    renderHome();
    expect(await screen.findByRole("heading", { name: /Jaswinder/ })).toBeInTheDocument();
    const fields = within(screen.getByRole("list", { name: "Your fields" })).getAllByRole("listitem", { name: undefined });
    expect(fields.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Balian Cooperative Society")).toBeInTheDocument();
    expect(screen.getByText("Other Society")).toBeInTheDocument();
    expect(screen.getByText(/Every field booked with your phone number/)).toBeInTheDocument();
    // Read-only: nothing to book, request or change from here.
    expect(screen.queryByRole("link", { name: /Ask for a date|Add/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cannot wait/i })).not.toBeInTheDocument();
    expect(requests[0]).toContain("/api/proxy/farmer/home?lang=en");
  });

  it("asks the phone-session route why, never a signed-in route", async () => {
    serve({ status: 200, body: HOME });
    renderHome();
    await userEvent.click((await screen.findAllByRole("button", { name: /Why this date/ }))[0]!);
    expect(requests.at(-1)).toContain("/api/proxy/farmer/fields/chc-balian/f-new/why?lang=en");
  });

  it("with no session, says how to get a link and offers WhatsApp 'my fields'", async () => {
    serve({ status: 401, body: { error: "UNAUTHENTICATED" } });
    renderHome();
    expect(await screen.findByText("Open your link from WhatsApp")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all my fields" })).toHaveAttribute("href", "https://wa.me/910000000000?text=my%20fields");
    // No sign-in redirect for farmers.
    expect(screen.queryByText(/Sign in/)).not.toBeInTheDocument();
  });

  it("explains a used or expired login link", async () => {
    serve({ status: 401, body: { error: "UNAUTHENTICATED" } });
    renderHome({ linkProblem: "expired" });
    expect(await screen.findByText("This link has already been used or has expired")).toBeInTheDocument();
    expect(screen.getByText(/each link opens once and only for 15 minutes/)).toBeInTheDocument();
  });

  it("without a WhatsApp number configured, shows no WhatsApp button", async () => {
    serve({ status: 401, body: { error: "UNAUTHENTICATED" } });
    renderHome({ whatsappNumber: null });
    expect(await screen.findByText("Open your link from WhatsApp")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See all my fields" })).not.toBeInTheDocument();
  });

  it("an empty list and an unreachable API each have their own state", { timeout: 15000 }, async () => {
    serve({ status: 200, body: { ...HOME, farmerName: "", fields: [] } });
    renderHome();
    expect(await screen.findByText("No fields booked with this number yet")).toBeInTheDocument();
    vi.unstubAllGlobals();
    serve({ status: 503, body: { error: "API_UNAVAILABLE" } });
    renderHome();
    // Anything but a 401 is retried twice (with back-off) before the error state shows.
    expect(await screen.findByText("We could not load this", {}, { timeout: 8000 })).toBeInTheDocument();
  });

  it.each(["pa", "hi"] as const)("renders in %s with no missing text", async (locale) => {
    serve({ status: 200, body: HOME });
    renderHome({ locale });
    expect(await screen.findAllByRole("listitem")).not.toHaveLength(0);
    vi.unstubAllGlobals();
    serve({ status: 401, body: { error: "UNAUTHENTICATED" } });
    renderHome({ locale, linkProblem: "expired" });
    expect(await screen.findAllByRole("link")).not.toHaveLength(0);
  });
});
