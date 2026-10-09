/** The /design samples come from the messages files, in the reader's language. */
import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { SAMPLE_REASONS, useSamples } from "@/lib/samples";
import pa from "../messages/pa.json";

describe("/design samples", () => {
  it("come from the messages, in the reader's language", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider locale="pa" messages={pa} timeZone="Asia/Kolkata">
        {children}
      </NextIntlClientProvider>
    );
    const { result } = renderHook(() => useSamples(), { wrapper });
    expect(result.current.reasons).toEqual([pa.design.sampleWhyFull, pa.design.sampleWhyBefore]);
    expect(result.current.fields.firm.reason.text).toBe(pa.design.sampleFirmRoute);
    expect(SAMPLE_REASONS[0]).toBe("Sunday 1 November: every working machine is already full.");
  });
});
