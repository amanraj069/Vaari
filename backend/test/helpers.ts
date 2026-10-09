/**
 * Shared test helpers. Test phone numbers come from Ofcom's range reserved for fiction
 * (+44 7700 900000-900999), so no test can ever contact or describe a real person.
 */
import request from "supertest";
import type { createApp } from "../src/app";
import { mintFarmerLoginLink } from "../src/auth/farmer-session";
import type { buildRuntime } from "../src/server";

export const testPhone = (suffix: number) => `+447700900${String(suffix).padStart(3, "0")}`;

/** A facilitator's booking as the web sends it: name, phone (as typed), consent. */
export function bookingInput(villageId: string, overrides: Record<string, unknown> = {}) {
  return { farmerName: "Paramjit Kaur", farmerPhone: testPhone(101), consent: true, villageId, acres: 3, readyDate: "2026-11-02", waitingLimitDays: 8, ...overrides };
}

/** A farmer's phone session, made the way the web makes one: mint a login link, exchange it once. */
export async function farmerSession(app: ReturnType<typeof createApp>, runtime: Awaited<ReturnType<typeof buildRuntime>>, phone: string): Promise<string> {
  const { config, store } = runtime.dependencies;
  const link = await mintFarmerLoginLink(config, store, phone);
  const exchanged = await request(app).post("/farmer/login").send({ token: link.token }).expect(200);
  return exchanged.body.sessionToken as string;
}
