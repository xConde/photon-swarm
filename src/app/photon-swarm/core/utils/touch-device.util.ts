/**
 * Single source of truth for the "GPU-limited coarse-touch device" check that gates
 * mobile render-quality reductions (particle counts, star density, bake cadence,
 * glow/halo cuts). Requires BOTH touch capability AND a coarse primary pointer so
 * touchscreen laptops/desktops (fine primary pointer) keep full desktop visuals —
 * they don't get the renderScale reduction, so they must not get the quality cuts.
 */
export function isCoarseTouchDevice(): boolean {
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  return hasTouch && window.matchMedia('(pointer: coarse)').matches;
}
