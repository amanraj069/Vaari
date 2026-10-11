"use client";

/**
 * Realistic fire flicker & glowing red angaare (fire embers/sparks)
 * that rise organically from the burning stubble field and drift
 * up through the smoke plume.
 */

interface EmberSpec {
  id: number;
  left: string;
  bottom: string;
  size: number;
  driftX: number;
  riseY: number;
  duration: number;
  delay: number;
  sway: number;
  pulseDuration: number;
  coreColor: string;
  glowColor: string;
  maxOpacity: number;
}

// Fixed deterministic distribution along the fire line (42% to 88% width, 14% to 26% height)
const EMBERS: EmberSpec[] = [
  // Fast micro-sparks shooting from the hottest flame spots
  { id: 1, left: "62%", bottom: "22%", size: 2, driftX: -35, riseY: 240, duration: 2.8, delay: -0.4, sway: 8, pulseDuration: 0.9, coreColor: "#fff4cc", glowColor: "#ff3300", maxOpacity: 0.95 },
  { id: 2, left: "70%", bottom: "20%", size: 1.5, driftX: -45, riseY: 210, duration: 2.5, delay: -1.2, sway: 6, pulseDuration: 0.8, coreColor: "#ffe699", glowColor: "#ff2200", maxOpacity: 0.9 },
  { id: 3, left: "54%", bottom: "23%", size: 2, driftX: -25, riseY: 260, duration: 3.1, delay: -1.9, sway: 10, pulseDuration: 1.1, coreColor: "#ffdd80", glowColor: "#ff4400", maxOpacity: 0.95 },
  { id: 4, left: "78%", bottom: "18%", size: 1.5, driftX: -55, riseY: 190, duration: 2.4, delay: -0.8, sway: 7, pulseDuration: 0.85, coreColor: "#ffffff", glowColor: "#ff2600", maxOpacity: 0.85 },
  { id: 5, left: "84%", bottom: "17%", size: 2, driftX: -60, riseY: 220, duration: 2.9, delay: -2.3, sway: 9, pulseDuration: 1.0, coreColor: "#ffe699", glowColor: "#ff3b00", maxOpacity: 0.9 },

  // Glowing red angaare (medium embers drifting through the smoke)
  { id: 6, left: "48%", bottom: "24%", size: 3, driftX: -30, riseY: 270, duration: 3.6, delay: -0.6, sway: 12, pulseDuration: 1.3, coreColor: "#ffaa33", glowColor: "#ff1800", maxOpacity: 0.95 },
  { id: 7, left: "58%", bottom: "21%", size: 3.5, driftX: -40, riseY: 290, duration: 4.1, delay: -2.7, sway: 14, pulseDuration: 1.4, coreColor: "#ff9500", glowColor: "#ff0000", maxOpacity: 0.98 },
  { id: 8, left: "66%", bottom: "19%", size: 3, driftX: -50, riseY: 280, duration: 3.8, delay: -1.5, sway: 11, pulseDuration: 1.2, coreColor: "#ffb347", glowColor: "#e61900", maxOpacity: 0.92 },
  { id: 9, left: "74%", bottom: "21%", size: 3.5, driftX: -65, riseY: 260, duration: 4.3, delay: -3.2, sway: 15, pulseDuration: 1.5, coreColor: "#ff8c00", glowColor: "#ff2200", maxOpacity: 0.95 },
  { id: 10, left: "81%", bottom: "19%", size: 3, driftX: -55, riseY: 250, duration: 3.9, delay: -0.9, sway: 10, pulseDuration: 1.25, coreColor: "#ffa040", glowColor: "#ff2e00", maxOpacity: 0.9 },
  { id: 11, left: "52%", bottom: "23%", size: 2.5, driftX: -35, riseY: 265, duration: 3.4, delay: -2.1, sway: 9, pulseDuration: 1.1, coreColor: "#ffc04d", glowColor: "#ff2a00", maxOpacity: 0.9 },
  { id: 12, left: "64%", bottom: "20%", size: 2.5, driftX: -45, riseY: 275, duration: 3.7, delay: -3.6, sway: 13, pulseDuration: 1.3, coreColor: "#ffb733", glowColor: "#ff1a00", maxOpacity: 0.92 },
  { id: 13, left: "72%", bottom: "22%", size: 3, driftX: -58, riseY: 285, duration: 4.0, delay: -1.8, sway: 12, pulseDuration: 1.35, coreColor: "#ffa626", glowColor: "#ff1100", maxOpacity: 0.95 },

  // Large floating cinders (heavy burning embers with deep crimson-ruby glow)
  { id: 14, left: "60%", bottom: "22%", size: 5, driftX: -48, riseY: 310, duration: 5.2, delay: -1.0, sway: 16, pulseDuration: 1.7, coreColor: "#ff7b00", glowColor: "#cc0000", maxOpacity: 0.95 },
  { id: 15, left: "68%", bottom: "19%", size: 4.5, driftX: -62, riseY: 295, duration: 4.8, delay: -3.4, sway: 14, pulseDuration: 1.6, coreColor: "#ff6600", glowColor: "#d90000", maxOpacity: 0.9 },
  { id: 16, left: "76%", bottom: "18%", size: 4, driftX: -54, riseY: 280, duration: 4.5, delay: -2.5, sway: 13, pulseDuration: 1.5, coreColor: "#ff851a", glowColor: "#ff1e00", maxOpacity: 0.92 },
  { id: 17, left: "55%", bottom: "24%", size: 4.5, driftX: -38, riseY: 300, duration: 5.0, delay: -4.1, sway: 15, pulseDuration: 1.65, coreColor: "#ff7300", glowColor: "#b80000", maxOpacity: 0.9 },

  // Additional ambient sparks across the smoke column
  { id: 18, left: "44%", bottom: "25%", size: 2, driftX: -22, riseY: 230, duration: 3.2, delay: -0.3, sway: 8, pulseDuration: 1.0, coreColor: "#ffe082", glowColor: "#ff3b00", maxOpacity: 0.88 },
  { id: 19, left: "50%", bottom: "23%", size: 2.5, driftX: -28, riseY: 250, duration: 3.5, delay: -1.7, sway: 10, pulseDuration: 1.15, coreColor: "#ffca3a", glowColor: "#ff2b00", maxOpacity: 0.92 },
  { id: 20, left: "57%", bottom: "22%", size: 2, driftX: -36, riseY: 245, duration: 3.3, delay: -2.9, sway: 9, pulseDuration: 1.05, coreColor: "#ffd566", glowColor: "#ff3300", maxOpacity: 0.9 },
  { id: 21, left: "63%", bottom: "20%", size: 1.5, driftX: -42, riseY: 215, duration: 2.7, delay: -0.5, sway: 7, pulseDuration: 0.9, coreColor: "#fff0b3", glowColor: "#ff2000", maxOpacity: 0.85 },
  { id: 22, left: "69%", bottom: "18%", size: 2, driftX: -52, riseY: 235, duration: 3.0, delay: -2.2, sway: 9, pulseDuration: 1.0, coreColor: "#ffe080", glowColor: "#ff2800", maxOpacity: 0.9 },
  { id: 23, left: "75%", bottom: "20%", size: 2.5, driftX: -58, riseY: 255, duration: 3.6, delay: -3.8, sway: 11, pulseDuration: 1.2, coreColor: "#ffb84d", glowColor: "#ff1800", maxOpacity: 0.92 },
  { id: 24, left: "82%", bottom: "18%", size: 1.8, driftX: -64, riseY: 225, duration: 2.9, delay: -1.4, sway: 8, pulseDuration: 0.95, coreColor: "#ffd166", glowColor: "#ff2c00", maxOpacity: 0.88 },
  { id: 25, left: "87%", bottom: "16%", size: 2.2, driftX: -70, riseY: 210, duration: 3.1, delay: -0.2, sway: 9, pulseDuration: 1.0, coreColor: "#ffc44d", glowColor: "#ff3700", maxOpacity: 0.85 },
  { id: 26, left: "65%", bottom: "21%", size: 3.2, driftX: -46, riseY: 290, duration: 4.2, delay: -0.7, sway: 13, pulseDuration: 1.4, coreColor: "#ffa733", glowColor: "#ff1f00", maxOpacity: 0.94 },
  { id: 27, left: "71%", bottom: "19%", size: 2.8, driftX: -54, riseY: 270, duration: 3.9, delay: -2.6, sway: 12, pulseDuration: 1.3, coreColor: "#ffb040", glowColor: "#e61400", maxOpacity: 0.92 },
  { id: 28, left: "59%", bottom: "23%", size: 3.8, driftX: -41, riseY: 305, duration: 4.7, delay: -1.3, sway: 14, pulseDuration: 1.55, coreColor: "#ff7f0e", glowColor: "#c70000", maxOpacity: 0.93 },
];

export function FireEmbers() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Living flame light and warmth flickers along the stubble fire line */}
      <div className="fire-flicker-layer absolute inset-0" />
      <div className="fire-hearth-shimmer absolute inset-0" />

      {/* Red Angaare: glowing fire embers lifting through the billowing smoke */}
      {EMBERS.map((e) => (
        <span
          key={e.id}
          className="angaare-particle"
          style={
            {
              left: e.left,
              bottom: e.bottom,
              width: `${e.size}px`,
              height: `${e.size}px`,
              backgroundColor: e.coreColor,
              boxShadow: `0 0 ${e.size * 1.5}px ${e.glowColor}, 0 0 ${e.size * 3.5}px ${e.glowColor}, 0 0 ${e.size * 6}px rgba(255, 30, 0, 0.7)`,
              "--drift-x": `${e.driftX}px`,
              "--rise-y": `${e.riseY}px`,
              "--dur": `${e.duration}s`,
              "--delay": `${e.delay}s`,
              "--sway": `${e.sway}px`,
              "--pulse-dur": `${e.pulseDuration}s`,
              "--max-op": e.maxOpacity,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
