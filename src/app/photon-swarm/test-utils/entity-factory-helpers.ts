/**
 * Test helpers for entity factory methods
 *
 * The entity factory methods changed from accepting objects to individual parameters.
 * These helpers provide convenient wrappers for tests.
 */

import { EntityFactoryECSService } from '../core/entities/entity-factory-ecs.service';
import { Entity } from '../core/ecs/ecs.model';
import { EnemyType } from '../core/models/enemy.model';

type Rarity = 'common' | 'rare' | 'legendary';

// Default values for entity creation
const DEFAULTS = {
  PROJECTILE: {
    SPEED: 100,
    DAMAGE: 5,
    FACTION: 'player' as const,
  },
  CHARGED_PROJECTILE: {
    SPEED: 150,
    DAMAGE: 20,
  },
  ENEMY: {
    TYPE: EnemyType.Basic,
    RARITY: 'common' as Rarity,
    IS_ELITE: false,
  },
} as const;

export interface ProjectileOptions {
  x: number;
  y: number;
  angle?: number;
  speed?: number;
  damage?: number;
  faction?: 'player' | 'enemy';
}

export interface EnemyOptions {
  x: number;
  y: number;
  type?: keyof typeof EnemyType | EnemyType;
  rarity?: Rarity;
  isElite?: boolean;
}

export interface ChargedProjectileOptions {
  x: number;
  y: number;
  chargeLevel: number;
  angle?: number;
  speed?: number;
  damage?: number;
}

/**
 * Helper to create projectile from options object
 * Converts polar coordinates (angle/speed) to cartesian velocity (vx/vy)
 * @param factory - The entity factory service
 * @param options - Projectile creation options
 * @returns The created entity ID
 */
export function createProjectileFromOptions(factory: EntityFactoryECSService, options: ProjectileOptions): Entity {
  const angle = options.angle ?? 0;
  const speed = options.speed ?? DEFAULTS.PROJECTILE.SPEED;

  // Convert polar to cartesian coordinates
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;

  return factory.createProjectile(
    options.x,
    options.y,
    vx,
    vy,
    options.damage ?? DEFAULTS.PROJECTILE.DAMAGE,
    options.faction ?? DEFAULTS.PROJECTILE.FACTION
  );
}

/**
 * Helper to create enemy from options object
 * @param factory - The entity factory service
 * @param options - Enemy creation options
 * @returns The created entity ID
 */
export function createEnemyFromOptions(factory: EntityFactoryECSService, options: EnemyOptions): Entity {
  // Handle both string keys and enum values for type
  let enemyType: EnemyType;
  if (options.type !== undefined) {
    if (typeof options.type === 'string') {
      // Map string keys to enum values manually (const enums can't be accessed dynamically)
      // Support both PascalCase keys ('Spitter') and enum values ('spitter')
      const typeMap: Record<string, EnemyType> = {
        Basic: EnemyType.Basic,
        basic: EnemyType.Basic,
        Spitter: EnemyType.Spitter,
        spitter: EnemyType.Spitter,
        Tank: EnemyType.Tank,
        tank: EnemyType.Tank,
        Swarm: EnemyType.Swarm,
        swarm: EnemyType.Swarm,
        Thug: EnemyType.Thug,
        thug: EnemyType.Thug,
        Sniper: EnemyType.Sniper,
        sniper: EnemyType.Sniper,
        Boss: EnemyType.Boss,
        boss: EnemyType.Boss,
      };
      enemyType = typeMap[options.type] ?? DEFAULTS.ENEMY.TYPE;
    } else {
      enemyType = options.type;
    }
  } else {
    enemyType = DEFAULTS.ENEMY.TYPE;
  }

  return factory.createEnemy(
    options.x,
    options.y,
    enemyType,
    options.rarity ?? DEFAULTS.ENEMY.RARITY,
    options.isElite ?? DEFAULTS.ENEMY.IS_ELITE
  );
}

/**
 * Helper to create charged projectile from options object
 * @param factory - The entity factory service
 * @param options - Charged projectile creation options
 * @returns The created entity ID
 */
export function createChargedProjectileFromOptions(
  factory: EntityFactoryECSService,
  options: ChargedProjectileOptions
): Entity {
  const angle = options.angle ?? 0;
  const speed = options.speed ?? DEFAULTS.CHARGED_PROJECTILE.SPEED;

  // Convert polar to cartesian coordinates
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;

  // Validate charge level
  if (options.chargeLevel < 0 || options.chargeLevel > 1) {
    throw new Error(`Invalid charge level: ${options.chargeLevel}. Must be between 0 and 1.`);
  }

  return factory.createChargedProjectile(
    options.x,
    options.y,
    vx,
    vy,
    options.damage ?? DEFAULTS.CHARGED_PROJECTILE.DAMAGE,
    options.chargeLevel,
    DEFAULTS.PROJECTILE.FACTION // Always player for charged projectiles
  );
}
