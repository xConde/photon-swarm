export interface Asteroid {
  id: number; // entity ID — deterministic render-geometry seed
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'medium' | 'large';
  color: string;
  isDiscovered: boolean;
  miniX?: number; // Position on minimap
  miniY?: number; // Position on minimap
  health?: number; // Current health
  maxHealth?: number; // Maximum health
  lastHitTime?: number; // Time of last hit for visual feedback
  vx?: number; // Horizontal velocity
  vy?: number; // Vertical velocity
  orbitCenterX?: number; // X coordinate of orbit center
  orbitCenterY?: number; // Y coordinate of orbit center
  orbitRadius?: number; // Distance from center to asteroid in orbit
  orbitSpeed?: number; // Angular velocity of orbit (radians per ms)
  isMoving?: boolean; // Whether the asteroid is in motion
}
