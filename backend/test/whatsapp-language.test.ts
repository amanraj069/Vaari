/**
 * Scripts on WhatsApp: romanize turns a village said or written in Hindi (Devanagari) or Punjabi
 * (Gurmukhi) into rough Latin letters, so it can be matched against the village's English name.
 */
import { describe, expect, it } from "vitest";
import { romanize } from "../src/whatsapp/language";

describe("romanize", () => {
  it.each([
    ["बालियां", "baliyan"],
    ["ਬਾਲੀਆਂ", "balian"],
    ["बटूहा", "batuha"],
    ["भैणी महाराज", "bhaini maharaj"],
    ["ढंडीवाल", "dhandival"],
    ["कट्टू", "kattu"],
    ["कुंबड़वाल", "kunbaraval"],
    ["फ़ाज़िल्का", "fazilka"],
    ["Balian", "Balian"],
  ])("%s -> %s", (written, latin) => {
    expect(romanize(written)).toBe(latin);
  });
});
