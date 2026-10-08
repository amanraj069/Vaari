import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { localeSchema } from "@/shared";

export default getRequestConfig(async () => {
  const stored = (await cookies()).get("NEXT_LOCALE")?.value;
  const locale = localeSchema.catch("en").parse(stored);
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
