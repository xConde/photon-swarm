import { Projectile } from '../models/projectile.model';
import { Enemy } from '../models/enemy.model';

export interface EngineApi {
  // world helpers
  getWorldWidth(): number;
  getWorldHeight(): number;

  // projectiles
  getProjectiles(): Projectile[];
  eliminateProjectile(index: number): void;

  // enemies
  getEnemies(): Enemy[];
  eliminateEnemy(enemy: Enemy, index: number, now: number): void;

  // collision utility
  checkCircleRectCollision(
    cx: number,
    cy: number,
    cr: number,
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    padding?: number
  ): boolean;

  // visual particles
  addVisualEffectParticles(x: number, y: number, count: number, radius: number, time: number): void;

  // shard helpers
  removeShard(index: number): void;
  incrementShardCount(amount: number): void;
  notify(text: string, time: number, color: string): void;
  computeShardRadius(value: number): number;

  // effect removal
  removePickupEffect(index: number): void;
  removeDeathEffect(index: number): void;
  removeDischargeEffect(index: number): void;

  // shard config getters
  getShardAutoCollectRange(): number;
  getMagnetismRangeBonus(): number;

  // burn config
  getBurnChance(): number;
  getEffectChanceMultiplier(): number;
  getBurnDuration(): number;
  getBurnDamageMultiplier(): number;

  // territory helper
  getTerritoryId(x: number, y: number): number | null;
}
