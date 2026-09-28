import { TrailData } from '../models/projectile.model';

/**
 * Generic object pool for reducing allocations and GC pressure
 * Used for frequently created/destroyed objects like enemies, projectiles, effects
 */
export class ObjectPool<T> {
  private pool: T[] = [];
  private activeObjects = new Set<T>();
  private createFn: () => T;
  private resetFn: (obj: T) => void;
  private maxSize: number;

  // Performance tracking
  private stats = {
    created: 0,
    reused: 0,
    returned: 0,
    resized: 0,
  };

  constructor(createFn: () => T, resetFn: (obj: T) => void, initialSize: number = 10, maxSize: number = 1000) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.maxSize = maxSize;

    // Pre-populate pool
    this.grow(initialSize);
  }

  /**
   * Get an object from the pool
   */
  acquire(): T {
    let obj: T;

    if (this.pool.length > 0) {
      const pooledObj = this.pool.pop();
      if (pooledObj !== undefined) {
        obj = pooledObj;
        this.stats.reused++;
      } else {
        obj = this.createFn();
        this.stats.created++;
      }
    } else {
      obj = this.createFn();
      this.stats.created++;
    }

    this.activeObjects.add(obj);
    return obj;
  }

  /**
   * Return an object to the pool
   */
  release(obj: T): void {
    if (!this.activeObjects.has(obj)) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Attempting to release object not from this pool', 'warning', {
          source: 'object_pool',
        });
      }
      return;
    }

    this.activeObjects.delete(obj);
    this.resetFn(obj);

    if (this.pool.length < this.maxSize) {
      this.pool.push(obj);
      this.stats.returned++;
    }
  }

  /**
   * Release all active objects back to pool
   */
  releaseAll(): void {
    const active = Array.from(this.activeObjects);
    active.forEach((obj) => this.release(obj));
  }

  /**
   * Grow the pool by creating new objects
   */
  private grow(count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.pool.length >= this.maxSize) break;
      this.pool.push(this.createFn());
      this.stats.created++;
    }
    this.stats.resized++;
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    return {
      poolSize: this.pool.length,
      activeCount: this.activeObjects.size,
      totalCreated: this.stats.created,
      totalReused: this.stats.reused,
      reuseRate: this.stats.reused / (this.stats.created + this.stats.reused),
      ...this.stats,
    };
  }

  /**
   * Clear the pool
   */
  clear(): void {
    this.pool = [];
    this.activeObjects.clear();
  }
}

export interface PoolStats {
  poolSize: number;
  activeCount: number;
  totalCreated: number;
  totalReused: number;
  reuseRate: number;
  created: number;
  reused: number;
  returned: number;
  resized: number;
}

/**
 * Specific pools for game objects
 */

// Enemy render object pool
export interface PooledEnemy {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: string;
  health: number;
  maxHealth: number;
  radius: number;
  color: string;
  eliteStatus: boolean;
  isChampion: boolean;
  isDancing?: boolean;
  danceStage?: 'bounce' | 'spin';
  spinAngle?: number;

  // Visual effect cache (populated in RenderingSystemService.getEnemies())
  isKnockedBack?: boolean;
  hitFlashIntensity?: number; // 0-1, pre-computed from HitFlashComponent
  factionId?: number; // 1-4, for faction-based sprite selection
  isInNpcCombat?: boolean; // true when NPC has an active faction battle target
  bossPhaseData?: import('../models/enemy.model').BossPhaseRenderData; // set only for boss entities
  shieldArcData?: import('../models/enemy.model').ShieldArcRenderData; // set only for sentinel entities
}

export function createEnemyPool(): ObjectPool<PooledEnemy> {
  return new ObjectPool<PooledEnemy>(
    () => ({
      id: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      type: '',
      health: 0,
      maxHealth: 100,
      radius: 20,
      color: '#ff0000',
      eliteStatus: false,
      isChampion: false,
      isDancing: false,
      danceStage: undefined,
      spinAngle: 0,
      // Visual effect cache defaults
      isKnockedBack: false,
      hitFlashIntensity: 0,
      factionId: 0,
      isInNpcCombat: false,
    }),
    (enemy) => {
      enemy.id = 0;
      enemy.x = 0;
      enemy.y = 0;
      enemy.vx = 0;
      enemy.vy = 0;
      enemy.health = 0;
      enemy.maxHealth = 100;
      enemy.isDancing = false;
      enemy.danceStage = undefined;
      enemy.spinAngle = 0;
      enemy.isChampion = false;
      // Reset visual effect cache
      enemy.isKnockedBack = false;
      enemy.hitFlashIntensity = 0;
      enemy.factionId = 0;
      enemy.isInNpcCombat = false;
      enemy.bossPhaseData = undefined;
      enemy.shieldArcData = undefined;
    },
    50, // Initial size
    500 // Max size
  );
}

// Projectile render object pool
export interface PooledProjectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  lifetime: number;
  damage: number;
  spawnTime: number;
  health: number;
  radius: number;
  isCharged: boolean;
  chargeLevel: number;
  color: string;
  glowIntensity: number;
  shouldEmitTrail: boolean;
  trailData: TrailData;
}

export function createProjectilePool(): ObjectPool<PooledProjectile> {
  return new ObjectPool<PooledProjectile>(
    () => ({
      id: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      speed: 100,
      lifetime: 5000,
      damage: 0,
      spawnTime: 0,
      health: 1,
      radius: 5,
      isCharged: false,
      chargeLevel: 0,
      color: '#00ffff',
      glowIntensity: 0,
      shouldEmitTrail: false,
      trailData: { points: [], opacity: 1, width: 2, color: '#00ffff' },
    }),
    (proj) => {
      proj.id = 0;
      proj.x = 0;
      proj.y = 0;
      proj.vx = 0;
      proj.vy = 0;
      proj.damage = 0;
      proj.spawnTime = 0;
      proj.health = 1;
      proj.isCharged = false;
      proj.chargeLevel = 0;
      proj.glowIntensity = 0;
      proj.shouldEmitTrail = false;
      proj.trailData.points = [];
    },
    100, // Initial size
    1000 // Max size
  );
}

// Effect render object pool
export interface PooledEffect {
  x: number;
  y: number;
  currentRadius: number;
  maxRadius: number;
  opacity: number;
}

export function createEffectPool(): ObjectPool<PooledEffect> {
  return new ObjectPool<PooledEffect>(
    () => ({
      x: 0,
      y: 0,
      currentRadius: 0,
      maxRadius: 100,
      opacity: 1,
    }),
    (effect) => {
      effect.x = 0;
      effect.y = 0;
      effect.currentRadius = 0;
      effect.maxRadius = 100;
      effect.opacity = 1;
    },
    20, // Initial size
    100 // Max size
  );
}
