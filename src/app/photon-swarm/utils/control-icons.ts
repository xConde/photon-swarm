/**
 * SVG icons for the on-screen touch control buttons (mobile action cluster).
 *
 * Mirrors the upgrade-icons pattern: inline SVG strings, viewBox "0 0 256 256",
 * currentColor so the button's CSS `color` drives the icon. Injected via
 * [innerHTML] + DomSanitizer.bypassSecurityTrustHtml.
 *
 * Replaces the previous unicode/emoji glyphs (⚡ ◎ ⟐ ⟶ ∿ ∴ ▣) which read as
 * stray symbols against the SVG-icon language used everywhere else in the app.
 *
 * Parry / Burst / Focus reuse proven Phosphor paths (shield / star-four / crosshair).
 * Beam / Shot / Dash / Map are simple geometric icons tuned to stay legible at ~22px.
 */
export type ControlIconName =
  | 'weapon-beam'
  | 'weapon-shot'
  | 'dash'
  | 'parry'
  | 'burst'
  | 'focus'
  | 'auto-beam'
  | 'map';

const CONTROL_ICON_SVGS: Record<ControlIconName, string> = {
  // Beam weapon mode — continuous sine sweep (1.5 periods)
  'weapon-beam': `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"><path d="M24,128 Q56,72 88,128 T152,128 T216,128"/></svg>`,

  // Shot weapon mode — three-projectile spread (triangle of pellets)
  'weapon-shot': `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 256 256" fill="currentColor"><circle cx="128" cy="72" r="24"/><circle cx="74" cy="176" r="24"/><circle cx="182" cy="176" r="24"/></svg>`,

  // Dash — double chevron (fast-forward / blink)
  dash: `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"><polyline points="56,64 120,128 56,192"/><polyline points="136,64 200,128 136,192"/></svg>`,

  // Parry — shield (Phosphor "shield-fill")
  parry: `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 256 256" fill="currentColor"><path d="M208,40H48A16,16,0,0,0,32,56v58.78c0,89.61,75.82,119.34,91,124.39a15.53,15.53,0,0,0,10,0c15.2-5.05,91-34.78,91-124.39V56A16,16,0,0,0,208,40Zm-80,120H88a8,8,0,0,1,0-16h40a8,8,0,0,1,0,16Zm40-48H88a8,8,0,0,1,0-16h80a8,8,0,0,1,0,16Z"/></svg>`,

  // Burst — four-point nova (charged discharge)
  burst: `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 256 256" fill="currentColor"><path d="M240,128a15.79,15.79,0,0,1-10.5,15l-63.44,23.07L143,229.5a16,16,0,0,1-30,0L89.94,166.06,26.5,143a16,16,0,0,1,0-30L89.94,89.94,113,26.5a16,16,0,0,1,30,0l23.07,63.44L229.5,113A15.79,15.79,0,0,1,240,128Z"/></svg>`,

  // Focus — crosshair / bullseye (Phosphor "crosshair-fill")
  focus: `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 256 256" fill="currentColor"><path d="M232,120h-8.34A96.14,96.14,0,0,0,136,32.34V24a8,8,0,0,0-16,0v8.34A96.14,96.14,0,0,0,32.34,120H24a8,8,0,0,0,0,16h8.34A96.14,96.14,0,0,0,120,223.66V232a8,8,0,0,0,16,0v-8.34A96.14,96.14,0,0,0,223.66,136H232a8,8,0,0,0,0-16Zm-96,87.6V200a8,8,0,0,0-16,0v7.6A80.15,80.15,0,0,1,48.4,136H56a8,8,0,0,0,0-16H48.4A80.15,80.15,0,0,1,120,48.4V56a8,8,0,0,0,16,0V48.4A80.15,80.15,0,0,1,207.6,120H200a8,8,0,0,0,0,16h7.6A80.15,80.15,0,0,1,136,207.6ZM128,88a40,40,0,1,0,40,40A40,40,0,0,0,128,88Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,152Z"/></svg>`,

  // Auto-Beam — lock-on reticle (auto-targeting), distinct from the focus crosshair
  'auto-beam': `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"><polyline points="40,88 40,40 88,40"/><polyline points="168,40 216,40 216,88"/><polyline points="216,168 216,216 168,216"/><polyline points="88,216 40,216 40,168"/><circle cx="128" cy="128" r="15" fill="currentColor" stroke="none"/></svg>`,

  // Map — minimap frame with radar blips
  map: `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"><rect x="40" y="40" width="176" height="176" rx="28"/><circle cx="162" cy="96" r="13" fill="currentColor" stroke="none"/><circle cx="98" cy="158" r="9" fill="currentColor" stroke="none"/></svg>`,
};

/** SVG markup for a control icon. All icons use currentColor for theme/state coloring. */
export function getControlIcon(name: ControlIconName): string {
  return CONTROL_ICON_SVGS[name] ?? '';
}
