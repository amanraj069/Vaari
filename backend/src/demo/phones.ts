/**
 * The demo farmers' phones: the seeded demo farmer's, plus any listed in DEMO_FARMER_PHONES. They
 * are demo accounts anyone may use, so their sign-in code is shown on screen (labelled as a demo)
 * and Vaari never sends them a WhatsApp message. Every other phone is a real farmer's: its code
 * goes to WhatsApp, and its notices follow its consent.
 */
import type { Config } from "../config";
import { fromWhatsAppNumber } from "../whatsapp/phone";
import { DEMO_FARMER_PHONE } from "./seed";

export function demoFarmerPhones(config: Config): Set<string> {
  const listed = config.DEMO_FARMER_PHONES.split(",")
    .map((item) => fromWhatsAppNumber(item))
    .filter((item): item is string => item !== null);
  return new Set([DEMO_FARMER_PHONE, ...listed]);
}

export const isDemoFarmerPhone = (config: Config, phone: string): boolean => demoFarmerPhones(config).has(phone);
