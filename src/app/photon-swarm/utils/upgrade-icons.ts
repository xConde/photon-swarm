/**
 * SVG Icons for Upgrade Cards
 * Inspired by Phosphor Icons design system
 * https://phosphoricons.com/
 *
 * Icons use fill="currentColor" for CSS color inheritance.
 * All icons share viewBox="0 0 256 256" (standard Phosphor size).
 */

export type UpgradeIconName =
  | 'speed'
  | 'power'
  | 'shield'
  | 'magnet'
  | 'heal'
  | 'fire-rate'
  | 'dash'
  | 'kinetic'
  | 'emergency'
  | 'beam'
  | 'gyro'
  | 'tachyon'
  | 'velocity'
  | 'precision'
  | 'dual-beam'
  | 'burn'
  | 'glass-cannon'
  | 'berserker'
  | 'nova'
  | 'plasma'
  | 'wildfire'
  | 'void'
  | 'fracture'
  | 'shield-breaker';

// Phosphor Bold icon SVG paths (viewBox="0 0 256 256", fill="currentColor")
const ICON_SVGS: Record<UpgradeIconName, string> = {
  // Lightning bolt — Speed
  speed: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M215.79,118.17a8,8,0,0,0-5-5.66L153.18,90.9l14.66-73.33a8,8,0,0,0-13.69-7l-112,120a8,8,0,0,0,3,13l57.63,21.61L88.16,238.43a8,8,0,0,0,13.69,7l112-120A8,8,0,0,0,215.79,118.17Z"/></svg>`,

  // Crosshair — Power
  power: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M232,120h-8.34A96.14,96.14,0,0,0,136,32.34V24a8,8,0,0,0-16,0v8.34A96.14,96.14,0,0,0,32.34,120H24a8,8,0,0,0,0,16h8.34A96.14,96.14,0,0,0,120,223.66V232a8,8,0,0,0,16,0v-8.34A96.14,96.14,0,0,0,223.66,136H232a8,8,0,0,0,0-16Zm-96,87.6V200a8,8,0,0,0-16,0v7.6A80.15,80.15,0,0,1,48.4,136H56a8,8,0,0,0,0-16H48.4A80.15,80.15,0,0,1,120,48.4V56a8,8,0,0,0,16,0V48.4A80.15,80.15,0,0,1,207.6,120H200a8,8,0,0,0,0,16h7.6A80.15,80.15,0,0,1,136,207.6ZM128,88a40,40,0,1,0,40,40A40,40,0,0,0,128,88Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,152Z"/></svg>`,

  // Shield — Shield/Health
  shield: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208,40H48A16,16,0,0,0,32,56v58.78c0,89.61,75.82,119.34,91,124.39a15.53,15.53,0,0,0,10,0c15.2-5.05,91-34.78,91-124.39V56A16,16,0,0,0,208,40Zm-80,120H88a8,8,0,0,1,0-16h40a8,8,0,0,1,0,16Zm40-48H88a8,8,0,0,1,0-16h80a8,8,0,0,1,0,16Z"/></svg>`,

  // Magnet — Shard Collection
  magnet: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M207,50.25A87.46,87.46,0,0,0,144.6,24h-.33A87.48,87.48,0,0,0,82,49.81L20.61,112a16,16,0,0,0,.06,22.56l28.66,28.66a15.92,15.92,0,0,0,11.32,4.69h.09a16,16,0,0,0,11.36-4.82L133,100.69a32,32,0,0,1,45.19.4,32.77,32.77,0,0,1,0,45.27h0l-60.77,62.18a16,16,0,0,0,.07,22.53l28.67,28.67a16,16,0,0,0,22.62,0L230.12,199A87.88,87.88,0,0,0,207,50.25Z"/></svg>`,

  // First-aid / heart-half — Nanite Repair
  heal: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,56H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40V56H40A16,16,0,0,0,24,72V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V72A16,16,0,0,0,216,56ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8V56H96Zm64,104H140v20a12,12,0,0,1-24,0V144H96a12,12,0,0,1,0-24h20V100a12,12,0,0,1,24,0v20h20a12,12,0,0,1,0,24Z"/></svg>`,

  // Timer / gauge — Rapid Fire Rate
  'fire-rate': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,40a96,96,0,1,0,96,96A96.11,96.11,0,0,0,128,40Zm0,176a80,80,0,1,1,80-80A80.09,80.09,0,0,1,128,216ZM173.66,90.34a8,8,0,0,1,0,11.32l-40,40a8,8,0,0,1-11.32-11.32l40-40A8,8,0,0,1,173.66,90.34ZM96,16a8,8,0,0,1,8-8h48a8,8,0,0,1,0,16H104A8,8,0,0,1,96,16Z"/></svg>`,

  // Wind / arrow-right — Phase Dash
  dash: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M184,184a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H176A8,8,0,0,1,184,184Zm32-88H80a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Zm-40-32a8,8,0,0,0,8-8V48a8,8,0,0,0-16,0v8H40a8,8,0,0,0,0,16H168A8,8,0,0,0,176,64Z"/></svg>`,

  // Arrow-up-right — Kinetic Amplifier
  kinetic: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M200,64V168a8,8,0,0,1-16,0V83.31L69.66,197.66a8,8,0,0,1-11.32-11.32L172.69,72H88a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z"/></svg>`,

  // Warning / siren — Emergency Protocols
  emergency: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M240,200H224V96a96,96,0,0,0-192,0V200H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM48,96a80,80,0,0,1,160,0V200H48Zm88-40a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V64A8,8,0,0,0,136,56Zm0,88a12,12,0,1,0,12,12A12,12,0,0,0,136,144Z"/></svg>`,

  // Beam / ray — Photon Amplifier
  beam: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M200,48H136V16a8,8,0,0,0-16,0V48H56A16,16,0,0,0,40,64V176a16,16,0,0,0,16,16h64v48a8,8,0,0,0,16,0V192h64a16,16,0,0,0,16-16V64A16,16,0,0,0,200,48Zm0,128H56V64H200V176Zm-40-80v32a8,8,0,0,1-16,0V96a8,8,0,0,1,16,0Zm-32,0v32a8,8,0,0,1-16,0V96a8,8,0,0,1,16,0Zm-32,0v32a8,8,0,0,1-16,0V96a8,8,0,0,1,16,0Z"/></svg>`,

  // Compass / rotate — Gyroscopic Matrix
  gyro: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm40-88a40,40,0,1,1-40-40A40,40,0,0,1,168,128Zm-56,0a16,16,0,1,0,16-16A16,16,0,0,0,112,128Z"/></svg>`,

  // Rocket — Tachyon Infusion
  tachyon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M152,224a8,8,0,0,1-8,8H112a8,8,0,0,1,0-16h32A8,8,0,0,1,152,224Zm73.69-113.75a198.65,198.65,0,0,1-20.4,37.15l7.73,38.59a8,8,0,0,1-3.89,8.38l-32,18.29A8,8,0,0,1,166,209.22l-12.49-30.16c-7.57,5.17-14.85,9.28-21.51,12.56V224a8,8,0,0,1-16,0V188.82c-14.7-7-33.4-19.55-50.66-40.44a8,8,0,0,1,12.32-10.18C96.9,161.58,118.52,174,132,178.58c30.94-10.52,60.82-46.18,77.69-80.22C219.26,78.53,224,60.25,224,48c0-7.61-6.39-16-16-16-12.25,0-30.53,4.74-50.36,14.31-34,16.38-69.61,46.76-80.22,77.69C82,138.07,95.07,160.15,108.45,178a8,8,0,1,1-12.63,9.82C78.74,165.72,64,139.72,64,112c0-40.33,48.47-100.32,117.75-123.69A8,8,0,0,1,192,24c17.64,0,32,14.36,32,32C224,84.38,239.75,79.58,225.69,110.25Z"/></svg>`,

  // Shuffle / arrows — Velocity Matrix
  velocity: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M237.66,178.34a8,8,0,0,1,0,11.32l-24,24a8,8,0,0,1-11.32-11.32L212.69,192H200.94a72.12,72.12,0,0,1-58.59-30.15l-41.72-58.4A56.1,56.1,0,0,0,55.06,80H32a8,8,0,0,1,0-16H55.06a72.12,72.12,0,0,1,58.59,30.15l41.72,58.4A56.1,56.1,0,0,0,200.94,176h11.75l-10.35-10.34a8,8,0,0,1,11.32-11.32ZM143,107.35a8,8,0,0,0,11.16-1.86l1.2-1.67A56.1,56.1,0,0,1,200.94,80h11.75l-10.35,10.34a8,8,0,0,1,11.32,11.32l24,24a8,8,0,0,1,0,11.32l-24-24A56.1,56.1,0,0,0,55.06,176H32a8,8,0,0,1,0-16H55.06a72.12,72.12,0,0,1,18.74-2.57Z"/></svg>`,

  // Target / bullseye — Surgical Precision
  precision: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M221.87,83.16A104.1,104.1,0,1,1,172.84,34.13a8,8,0,0,1-5.68,14.86A88.13,88.13,0,1,0,216,128a87.53,87.53,0,0,0-3.85-25.81,8,8,0,0,1,15.3-4.63A104.16,104.16,0,0,1,232,128,103.44,103.44,0,0,1,221.87,83.16ZM128,88a40,40,0,1,0,40,40A40,40,0,0,0,128,88Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,152Zm103.2-91.34-56,56a8,8,0,0,1-11.32-11.32l56-56a8,8,0,0,1,11.32,11.32Z"/></svg>`,

  // Copy / split — Dual Beam
  'dual-beam': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M112,40v80a8,8,0,0,1-8,8H24a8,8,0,0,1-8-8V40a8,8,0,0,1,8-8h80A8,8,0,0,1,112,40ZM232,32H152a8,8,0,0,0-8,8v80a8,8,0,0,0,8,8h80a8,8,0,0,0,8-8V40A8,8,0,0,0,232,32ZM104,144H24a8,8,0,0,0-8,8v64a8,8,0,0,0,8,8h80a8,8,0,0,0,8-8V152A8,8,0,0,0,104,144Zm128,0H152a8,8,0,0,0-8,8v64a8,8,0,0,0,8,8h80a8,8,0,0,0,8-8V152A8,8,0,0,0,232,144Z"/></svg>`,

  // Flame — Thermal / Burn
  burn: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M173.79,51.48a221.25,221.25,0,0,0-41.67-34.34,8,8,0,0,0-8.24,0A221.25,221.25,0,0,0,82.21,51.48C54.59,90.21,40,132.83,40,176a88,88,0,0,0,176,0C216,132.83,201.41,90.21,173.79,51.48ZM96,200c0-22.06,18.71-44.76,32-56.44,13.27,11.67,32,34.38,32,56.44a32,32,0,0,1-64,0Z"/></svg>`,

  // Skull — Unstable Core / Glass Cannon
  'glass-cannon': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,16C70.65,16,24,60.86,24,116c0,34.1,18.27,66,48,85.24V216a16,16,0,0,0,16,16h80a16,16,0,0,0,16-16v-14.76c29.73-19.27,48-51.14,48-85.24C232,60.86,185.35,16,128,16Zm8,96a16,16,0,1,1,16-16A16,16,0,0,1,136,112Zm-32-16a16,16,0,1,1-16,16A16,16,0,0,1,104,96Z"/></svg>`,

  // Sword / axe — Berserker Protocol
  berserker: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,32V92.12a28,28,0,0,1-8.2,19.8l-23.8,23.8-44.69-44.69,23.8-23.8A28,28,0,0,1,183,59.07V48H200V32ZM169.57,147.43l-11.32,11.31-16-16L131,153.9l16,16-11.31,11.32L119.6,165.14,108.28,176.46l16.09,16.08-11.32,11.32-16.08-16.09L85.66,199l16.08,16.09-11.32,11.31L74.34,210.34,40,244.69A8,8,0,0,1,28.69,244L11.31,227.31A8,8,0,0,1,11.31,216l34.35-34.34L29.57,165.57l11.32-11.31L57,170.34,68.29,159l-16.08-16.08L63.54,131.6l16.08,16.09L91,136.37l-16-16,11.15-11.15,16,16Z"/></svg>`,

  // Explosion / star-four — Nova Discharge
  nova: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M240,128a15.79,15.79,0,0,1-10.5,15l-63.44,23.07L143,229.5a16,16,0,0,1-30,0L89.94,166.06,26.5,143a16,16,0,0,1,0-30L89.94,89.94,113,26.5a16,16,0,0,1,30,0l23.07,63.44L229.5,113A15.79,15.79,0,0,1,240,128Z"/></svg>`,

  // Fire-simple — Plasma Infuser
  plasma: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M143.38,17.85a8,8,0,0,0-12.63,3.41l-22,60.41L84.59,58.26a8,8,0,0,0-11.93,9.64L96,128.72V224a8,8,0,0,0,16,0V128.72l23.34-60.82L111.59,91.3a8,8,0,0,0,5.74,12.19l36.24,4.53a8,8,0,0,0,8.84-6.68l8-48A8,8,0,0,0,167.6,45.86Z"/></svg>`,

  // Broadcast / waves — Wildfire Protocol
  wildfire: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,88a40,40,0,1,0,40,40A40,40,0,0,0,128,88Zm0,64a24,24,0,1,1,24-24A24,24,0,0,1,128,152Zm75.06-40.07a8,8,0,0,1,0,11.31,71.62,71.62,0,0,1-101.24,0,8,8,0,0,1,11.32-11.32,55.61,55.61,0,0,0,78.6,0A8,8,0,0,1,203.06,111.93Zm22.62-33.94a8,8,0,0,1,0,11.32,119.87,119.87,0,0,1-169.56,0A8,8,0,0,1,67.44,78a103.85,103.85,0,0,0,146.92,0A8,8,0,0,1,225.68,78Z"/></svg>`,

  // Black-hole / spiral — Void Energy
  void: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,96a32,32,0,1,0,32,32A32,32,0,0,0,128,96Zm0,48a16,16,0,1,1,16-16A16,16,0,0,1,128,144Zm0-120A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm88,104a87.56,87.56,0,0,1-11.77,44.06L183.4,154.5a56,56,0,0,0-72.26-72.78l-8.67-15A88.12,88.12,0,0,1,216,128ZM76.26,100.86,97.09,137a56,56,0,0,0,62.6,72.44l8.7,15.06A88,88,0,0,1,40,128,87.59,87.59,0,0,1,76.26,100.86Z"/></svg>`,

  // Shield-slash — Shield Fracture (curse)
  fracture: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M53.92,34.62A8,8,0,1,0,42.08,45.38L64.72,70.29A253.87,253.87,0,0,0,32,114.67V56A16,16,0,0,1,48,40H208a16,16,0,0,1,14.35,8.89l-15.48,17A253.92,253.92,0,0,0,128,40c-1.06,0-2.12,0-3.18.05L89.33,70.21A16,16,0,0,0,80,56V40Zm148.16,187A8,8,0,0,1,192,226.31l-8.83-9.71A15.52,15.52,0,0,1,178,216c-15.18-5.05-91-34.78-91-124.39V88.67L53.92,34.62Z"/></svg>`,

  // Shield-plus / shield-checkered — Shield Breaker
  'shield-breaker': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208,40H48A16,16,0,0,0,32,56v58.78c0,89.61,75.82,119.34,91,124.39a15.53,15.53,0,0,0,10,0c15.2-5.05,91-34.78,91-124.39V56A16,16,0,0,0,208,40ZM128,224S48,201.22,48,114.78V56H128V224Zm80-109.22c0,36.86-18,66.21-40.3,86.62V56h40.3Z"/></svg>`,
};

/**
 * Get SVG markup for an upgrade icon by name.
 * All icons use currentColor for theme compatibility.
 */
export function getUpgradeIcon(name: UpgradeIconName): string {
  return ICON_SVGS[name] || ICON_SVGS.power;
}

/**
 * Map upgrade ID → icon name
 */
const UPGRADE_ICON_MAP: Record<string, UpgradeIconName> = {
  // Core
  core_speed: 'speed',
  core_power: 'power',
  core_shield: 'shield',
  core_magnet: 'magnet',
  // Uncommon
  health_regen: 'heal',
  fire_rate_boost: 'fire-rate',
  dash_efficiency: 'dash',
  kinetic_amplifier: 'kinetic',
  emergency_protocols: 'emergency',
  beam_damage: 'beam',
  beam_rotation: 'gyro',
  beam_speed: 'tachyon',
  // Rare
  velocity_matrix: 'velocity',
  surgical_precision: 'precision',
  double_beam: 'dual-beam',
  burn_chance: 'burn',
  glass_cannon: 'glass-cannon',
  shield_breaker: 'shield-breaker',
  // Epic
  berserker_protocol: 'berserker',
  discharge: 'nova',
  burn_damage: 'plasma',
  burn_spread: 'wildfire',
  void_beam: 'void',
  // Curses
  vulnerability: 'fracture',
};

export function getUpgradeIconByID(upgradeId: string): string {
  const iconName = UPGRADE_ICON_MAP[upgradeId];
  return iconName ? getUpgradeIcon(iconName) : '';
}
