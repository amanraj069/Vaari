/**
 * A full-bleed background photo for the landing page. Looks for the slot's file in public/landing/
 * (.webp, .jpg, .jpeg or .png; FILE_NAMES lists the names tried) on the server; if none is there
 * yet, a painted scene (CSS, globals.css) stands in, so the page never shows a broken image.
 * Photos are decorative (alt=""): every claim on the page is in text.
 */
import "server-only";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Image from "next/image";

const EXTENSIONS = [".webp", ".jpg", ".jpeg", ".png"];

export type PhotoName = "hero" | "smoke" | "sown";

// File names tried for each slot, in order. hero-img (the sowing tractor at sunrise) and hero-ash
// (a burning paddy field) are the names the photos were added under.
const FILE_NAMES: Record<PhotoName, string[]> = { hero: ["hero", "hero-img"], smoke: ["smoke", "hero-ash"], sown: ["sown"] };

const FALLBACK: Record<PhotoName, string> = { hero: "scene-dawn", smoke: "scene-smoke", sown: "scene-sown" };

export function findPhoto(name: PhotoName): string | null {
  for (const fileName of FILE_NAMES[name]) {
    for (const extension of EXTENSIONS) {
      if (existsSync(join(process.cwd(), "public", "landing", `${fileName}${extension}`))) return `/landing/${fileName}${extension}`;
    }
  }
  return null;
}

export function LandingPhoto({
  name,
  priority = false,
  zoom = false,
  position = "center",
  sizes = "100vw",
  className = "",
  imgClassName = "",
}: {
  name: PhotoName;
  priority?: boolean;
  zoom?: boolean;
  position?: string;
  sizes?: string;
  className?: string;
  imgClassName?: string;
}) {
  const src = findPhoto(name);
  return (
    <div aria-hidden className={`absolute inset-0 overflow-hidden rounded-[inherit] ${className}`}>
      {src ? (
        <Image
          src={src}
          alt=""
          fill
          priority={priority}
          sizes={sizes}
          quality={80}
          className={`object-cover ${zoom ? "slow-zoom" : ""} ${imgClassName}`}
          style={{ objectPosition: position }}
        />
      ) : (
        <div className={`absolute inset-0 ${FALLBACK[name]} ${zoom ? "slow-zoom" : ""} ${imgClassName}`} />
      )}
    </div>
  );
}
