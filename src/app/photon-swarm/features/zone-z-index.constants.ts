/**
 * Z-index hierarchy for photon-swarm zone progression UI components.
 *
 * Each zone UI component binds its host z-index via `@HostBinding('style.zIndex')`
 * to a value imported from this file, making this the runtime source of truth.
 *
 * Values mirror the design system tiers in `photon-swarm/styles/_design-system.scss`:
 *   $z-content: 10  $z-overlay: 100  $z-modal: 1000
 */
export const ZONE_Z_INDEX = {
  // ---------------------------------------------------------------------------
  // HUD tier — sits with persistent gameplay UI (xp-bar, charge-bar)
  // Equivalent to design-system $z-content + 5 = 15.
  // ---------------------------------------------------------------------------

  /** Zone progress panel (top-left HUD). */
  ZONE_PROGRESS: 15,

  /** Gate proximity tooltip (bottom-center, contextual). */
  ZONE_GATE_TOOLTIP: 15,

  // ---------------------------------------------------------------------------
  // Overlay tier — temporary banners and notifications.
  // Above the pause overlay ($z-overlay = 100), below wave-announcement (600).
  // Within the tier, severity orders the stack: complete > locked > entry.
  // ---------------------------------------------------------------------------

  /** Zone entry banner ("NEBULA EXPANSE / The calm before the storm"). */
  ZONE_ANNOUNCEMENT: 110,

  /** Cache discovery notification (player approaches an unopened cache). */
  CACHE_DISCOVERED: 110,

  /** Locked-zone warning toast (player crossed a locked boundary). */
  ZONE_LOCKED_WARNING: 115,

  /** Zone clear celebration (highest priority — visible over warnings). */
  ZONE_COMPLETE: 120,
} as const;
