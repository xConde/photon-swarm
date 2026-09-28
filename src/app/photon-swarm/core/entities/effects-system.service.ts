import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import {
  AnimationProperty,
  BlendMode,
  Color,
  EffectInstance,
  EffectPerformanceStats,
  EffectPreset,
  EffectSystemConfig,
  EffectType,
  EmitterConfig,
  ParticleData,
  ParticleEmitter,
  ParticleType,
  Vector2D,
} from '../models/effects.model';
import { EngineApi } from '../utils/engine-api';
import { isCoarseTouchDevice } from '../utils/touch-device.util';

@Injectable({
  providedIn: 'root',
})
export class EffectsSystemService {
  engine!: EngineApi;

  // Hard cap: any effect older than this is force-removed regardless of active state
  private readonly MAX_EFFECT_LIFETIME_MS = 10000; // 10 seconds absolute max

  // Touch detection — set once at construction; guards all touch-only budget cuts.
  private readonly isTouch: boolean = isCoarseTouchDevice();

  // Configuration
  private config: EffectSystemConfig = {
    poolSize: 100,
    maxParticles: this.isTouch ? 50 : 100, // Touch: halved budget to reduce GPU particle load
    maxEmitters: this.isTouch ? 15 : 30, // Touch: halved emitter budget
    maxEffects: this.isTouch ? 8 : 15, // Touch: halved effect budget
    cullingDistance: 800, // Reduced from 1000 for more aggressive culling
    updateFrequency: 60,
    renderLayers: 10,
    performanceMode: false,
  };

  // Object pools and collections
  private particlePool: ParticleData[] = [];
  private activeParticles: ParticleData[] = [];
  private activeEmitters: ParticleEmitter[] = [];
  private activeEffects: EffectInstance[] = [];
  private renderLayers: Map<number, ParticleData[]> = new Map();

  // Damage number tracking
  private damageNumberMap: Map<string, number> = new Map();

  // FIX: Track last cleanup time to prevent memory leaks from orphaned damage number entries
  private lastDamageMapCleanup = 0;
  private readonly DAMAGE_MAP_CLEANUP_INTERVAL_MS = 2000; // Clean up every 2 seconds
  private readonly MAX_DAMAGE_MAP_SIZE = 200; // Force cleanup if map exceeds this size

  // Performance tracking
  private performanceStats: EffectPerformanceStats = {
    activeParticles: 0,
    activeEmitters: 0,
    activeEffects: 0,
    poolUtilization: 0,
    renderTime: 0,
    updateTime: 0,
    memoryUsage: 0,
  };

  // Perf: frame counter to throttle stat updates to every 2nd frame
  private statsFrameCounter = 0;

  // Event streams
  private effectCreated$ = new Subject<EffectInstance>();
  private effectDestroyed$ = new Subject<string>();
  private performanceUpdate$ = new Subject<EffectPerformanceStats>();

  public readonly effectCreated: Observable<EffectInstance> = this.effectCreated$.asObservable();
  public readonly effectDestroyed: Observable<string> = this.effectDestroyed$.asObservable();
  public readonly performanceUpdate: Observable<EffectPerformanceStats> = this.performanceUpdate$.asObservable();

  constructor() {
    this.initializeParticlePool();
    this.initializeRenderLayers();
  }

  public setGameEngine(engine: EngineApi): void {
    this.engine = engine;
  }

  private initializeParticlePool(): void {
    for (let i = 0; i < this.config.poolSize; i++) {
      this.particlePool.push(this.createEmptyParticle());
    }
  }

  private initializeRenderLayers(): void {
    // Initialize 10 render layers (0-9)
    for (let i = 0; i < 10; i++) {
      this.renderLayers.set(i, []);
    }
  }

  // === EFFECT CREATION ===

  public createParticleEffect(
    type: EffectType,
    position: Vector2D,
    count: number = 10,
    radius: number = 20,
    duration: number = 1000,
    metadata?: Record<string, unknown>
  ): string {
    const preset = this.getEffectPreset(type);
    if (!preset) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log(`No preset found for effect type: ${type}`, 'warning', {
          source: 'effects_system',
          effectType: type,
        });
      }
      return '';
    }

    // Create effect instance
    const now = window.performance.now();
    const effect: EffectInstance = {
      id: this.generateId(),
      type,
      position: { ...position },
      startTime: now,
      createdAt: now,
      duration,
      isActive: true,
      metadata,
      emitters: [],
    };

    // Create emitters based on preset
    preset.emitterConfigs.forEach((config) => {
      const adjustedConfig = {
        ...config,
        spawnPosition: position,
        burstCount: Math.min(count, config.burstCount || 1),
        spawnRadius: radius,
      };

      const emitterId = this.generateId();
      const emitter: ParticleEmitter = {
        id: emitterId,
        config: adjustedConfig,
        particles: [],
        createdAt: now,
        lastEmissionTime: now,
        totalEmitted: 0,
        isActive: true,
        position: { ...adjustedConfig.spawnPosition },
        parentEffect: effect,
      };
      effect.emitters.push(emitter);
      this.activeEmitters.push(emitter);
    });

    this.activeEffects.push(effect);
    this.effectCreated$.next(effect);

    return effect.id;
  }

  public createCustomEffect(
    position: Vector2D,
    emitterConfigs: EmitterConfig[],
    duration: number = 1000,
    metadata?: Record<string, unknown>
  ): string {
    const now = window.performance.now();
    const effect: EffectInstance = {
      id: this.generateId(),
      type: EffectType.CUSTOM,
      position: { ...position },
      startTime: now,
      createdAt: now,
      duration,
      isActive: true,
      metadata,
      emitters: [],
    };

    emitterConfigs.forEach((config) => {
      const emitterId = this.generateId();
      const emitter: ParticleEmitter = {
        id: emitterId,
        config: {
          ...config,
          spawnPosition: position,
        },
        particles: [],
        createdAt: now,
        lastEmissionTime: now,
        totalEmitted: 0,
        isActive: true,
        position: { ...position },
        parentEffect: effect,
      };
      effect.emitters.push(emitter);
      this.activeEmitters.push(emitter);
    });

    this.activeEffects.push(effect);
    this.effectCreated$.next(effect);

    return effect.id;
  }

  public destroyEffect(effectId: string): void {
    const effectIndex = this.activeEffects.findIndex((e) => e.id === effectId);
    if (effectIndex !== -1) {
      const effect = this.activeEffects[effectIndex];

      // Deactivate all emitters
      effect.emitters.forEach((emitter) => {
        emitter.isActive = false;
      });

      effect.isActive = false;
      this.activeEffects.splice(effectIndex, 1);
      this.effectDestroyed$.next(effectId);
    }
  }

  // === UPDATE LOOP ===

  public update(deltaTime: number): void {
    const startTime = window.performance.now();

    this.updateEffects(deltaTime);
    this.updateEmitters(deltaTime);
    this.updateParticles(deltaTime);
    this.cullDeadObjects();
    this.updateRenderLayers();

    const updateTime = window.performance.now() - startTime;

    // Perf: throttle stat updates to every 2nd frame (30fps is sufficient for stats display)
    this.statsFrameCounter++;
    if (this.statsFrameCounter % 2 === 0) {
      this.updatePerformanceStats(updateTime);
    }
  }

  private updateEffects(_deltaTime: number): void {
    const currentTime = window.performance.now();

    this.activeEffects.forEach((effect) => {
      // duration === -1 means infinite — skip normal expiry check
      if (effect.duration !== -1) {
        const elapsed = currentTime - effect.startTime;
        if (elapsed >= effect.duration) {
          effect.isActive = false;
          effect.emitters.forEach((emitter) => {
            emitter.isActive = false;
          });
        }
      }
    });
  }

  private updateEmitters(_deltaTime: number): void {
    const currentTime = window.performance.now();

    this.activeEmitters.forEach((emitter) => {
      if (!emitter.isActive) return;

      // Check if emitter should emit particles
      if (this.shouldEmitParticles(emitter, currentTime)) {
        this.emitParticles(emitter, currentTime);
      }

      // Update emitter duration — skip when duration is -1 (infinite).
      // Use createdAt (not lastEmissionTime) as the start reference.
      if (emitter.config.duration !== -1) {
        const elapsed = currentTime - emitter.createdAt;
        if (elapsed >= emitter.config.duration) {
          emitter.isActive = false;
        }
      }
    });
  }

  private updateParticles(deltaTime: number): void {
    this.activeParticles.forEach((particle) => {
      if (!particle.isAlive) return;

      // Update age
      particle.age += deltaTime;
      if (particle.age >= particle.maxAge) {
        particle.isAlive = false;
        return;
      }

      // Update physics
      this.updateParticlePhysics(particle, deltaTime);

      // Update visual properties
      this.updateParticleVisuals(particle);
    });
  }

  private updateParticlePhysics(particle: ParticleData, deltaTime: number): void {
    const dt = deltaTime / 1000; // Convert to seconds

    // Apply gravity
    particle.velocity.x += particle.gravity.x * dt;
    particle.velocity.y += particle.gravity.y * dt;

    // Apply drag
    particle.velocity.x *= 1 - particle.drag * dt;
    particle.velocity.y *= 1 - particle.drag * dt;

    // Update position
    particle.position.x += particle.velocity.x * dt;
    particle.position.y += particle.velocity.y * dt;
  }

  private updateParticleVisuals(particle: ParticleData): void {
    const normalizedAge = particle.age / particle.maxAge;

    // Update size over time
    if (particle.sizeOverTime) {
      particle.size = this.evaluateAnimationProperty(particle.sizeOverTime, normalizedAge);
    }

    // Update color over time
    if (particle.colorOverTime) {
      particle.color = this.evaluateAnimationProperty(particle.colorOverTime, normalizedAge);

      // PERF: Only rebuild the CSS string when the interpolated color has actually changed.
      // Compare channels individually — avoids per-frame string allocation on static colors.
      const snap = particle.cssColorSnapshot;
      const c = particle.color;
      const ca = c.a ?? 1;
      if (c.r !== snap.r || c.g !== snap.g || c.b !== snap.b || ca !== (snap.a ?? 1)) {
        particle.cssColor = `rgba(${c.r},${c.g},${c.b},${ca})`;
        particle.cssColorGlow = `rgba(${c.r},${c.g},${c.b},${ca * 0.4})`;
        snap.r = c.r;
        snap.g = c.g;
        snap.b = c.b;
        snap.a = ca;
      }
    }

    // Update opacity over time
    if (particle.opacityOverTime) {
      particle.opacity = this.evaluateAnimationProperty(particle.opacityOverTime, normalizedAge);
    }
  }

  // === PARTICLE POOL MANAGEMENT ===

  private getParticleFromPool(): ParticleData | null {
    const particle = this.particlePool.pop();
    if (particle) {
      this.resetParticle(particle);
      this.activeParticles.push(particle);
      return particle;
    }

    // Pool exhausted, check if we can create more
    if (this.activeParticles.length < this.config.maxParticles) {
      const newParticle = this.createEmptyParticle();
      this.activeParticles.push(newParticle);
      return newParticle;
    }

    return null; // System at capacity
  }

  private createEmptyParticle(): ParticleData {
    const color: Color = { r: 255, g: 255, b: 255, a: 1 };
    return {
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      acceleration: { x: 0, y: 0 },
      size: 1,
      rotation: 0,
      color,
      opacity: 1,
      blendMode: BlendMode.NORMAL,
      glowIntensity: 0,
      age: 0,
      maxAge: 1000,
      isAlive: false,
      mass: 1,
      drag: 0,
      gravity: { x: 0, y: 0 },
      id: this.generateId(),
      type: ParticleType.CUSTOM,
      layer: 0,
      cssColor: 'rgba(255,255,255,1)',
      cssColorGlow: 'rgba(255,255,255,0.4)',
      cssColorSnapshot: { ...color },
    };
  }

  private resetParticle(particle: ParticleData): void {
    // PERF: Mutate existing sub-objects in place — avoids 5 per-call object allocations.
    particle.position.x = 0;
    particle.position.y = 0;
    particle.velocity.x = 0;
    particle.velocity.y = 0;
    particle.acceleration.x = 0;
    particle.acceleration.y = 0;
    particle.size = 1;
    particle.rotation = 0;
    particle.color.r = 255;
    particle.color.g = 255;
    particle.color.b = 255;
    particle.color.a = 1;
    particle.opacity = 1;
    particle.age = 0;
    particle.maxAge = 1000;
    particle.isAlive = false;
    particle.mass = 1;
    particle.drag = 0;
    particle.gravity.x = 0;
    particle.gravity.y = 0;
    particle.layer = 0;
    particle.sizeOverTime = undefined;
    particle.colorOverTime = undefined;
    particle.opacityOverTime = undefined;
    particle.cssColor = 'rgba(255,255,255,1)';
    particle.cssColorGlow = 'rgba(255,255,255,0.4)';
    particle.cssColorSnapshot.r = 255;
    particle.cssColorSnapshot.g = 255;
    particle.cssColorSnapshot.b = 255;
    particle.cssColorSnapshot.a = 1;
  }

  // === EMITTER MANAGEMENT ===

  public createEmitter(config: EmitterConfig): string {
    const emitterId = this.generateId();
    const now = window.performance.now();
    const emitter: ParticleEmitter = {
      id: emitterId,
      config,
      particles: [],
      createdAt: now,
      lastEmissionTime: now,
      totalEmitted: 0,
      isActive: true,
      position: { ...config.spawnPosition },
      parentEffect: undefined,
    };
    this.activeEmitters.push(emitter);
    return emitterId;
  }

  private shouldEmitParticles(emitter: ParticleEmitter, currentTime: number): boolean {
    if (!emitter.isActive) return false;

    const timeSinceLastEmission = currentTime - emitter.lastEmissionTime;
    const emissionInterval = 1000 / emitter.config.emissionRate; // ms between emissions

    return timeSinceLastEmission >= emissionInterval;
  }

  private emitParticles(emitter: ParticleEmitter, currentTime: number): void {
    const particlesToEmit = emitter.config.burstCount || 1;

    for (let i = 0; i < particlesToEmit; i++) {
      const particle = this.getParticleFromPool();
      if (!particle) break; // Pool exhausted

      this.initializeParticle(particle, emitter.config, emitter);
      emitter.particles.push(particle);
      emitter.totalEmitted++;
    }

    emitter.lastEmissionTime = currentTime;
  }

  private initializeParticle(particle: ParticleData, config: EmitterConfig, emitter?: ParticleEmitter): void {
    // Position with radius variation
    const angle = config.spawnAngle + (Math.random() - 0.5) * config.spawnAngleVariation;
    const distance = Math.random() * config.spawnRadius;

    particle.position.x = config.spawnPosition.x + Math.cos(angle) * distance;
    particle.position.y = config.spawnPosition.y + Math.sin(angle) * distance;

    // Velocity
    const speed = config.initialSpeed + (Math.random() - 0.5) * config.initialSpeedVariation;
    particle.velocity.x = config.initialDirection.x * speed;
    particle.velocity.y = config.initialDirection.y * speed;

    // Visual properties
    particle.size = config.startSize;
    // PERF: Mutate existing sub-object in place — avoids per-spawn allocation (matches resetParticle pattern).
    particle.color.r = config.startColor.r;
    particle.color.g = config.startColor.g;
    particle.color.b = config.startColor.b;
    particle.color.a = config.startColor.a;
    particle.opacity = config.startOpacity;

    // Lifecycle
    particle.maxAge = config.particleLifetime + (Math.random() - 0.5) * config.particleLifetimeVariation;
    particle.age = 0;
    particle.isAlive = true;

    // Physics
    // PERF: Mutate existing sub-object in place — avoids per-spawn allocation (matches resetParticle pattern).
    particle.gravity.x = config.gravity.x;
    particle.gravity.y = config.gravity.y;
    particle.drag = config.drag;

    // Metadata
    particle.type = config.particleType;
    particle.layer = config.layer;

    // PERF: Build the CSS color strings once at spawn — avoids per-frame template literals
    const spawnA = particle.color.a ?? 1;
    particle.cssColor = `rgba(${particle.color.r},${particle.color.g},${particle.color.b},${spawnA})`;
    particle.cssColorGlow = `rgba(${particle.color.r},${particle.color.g},${particle.color.b},${spawnA * 0.4})`;
    // PERF: Mutate existing sub-object in place — avoids per-spawn allocation (matches resetParticle pattern).
    particle.cssColorSnapshot.r = particle.color.r;
    particle.cssColorSnapshot.g = particle.color.g;
    particle.cssColorSnapshot.b = particle.color.b;
    particle.cssColorSnapshot.a = particle.color.a;

    // Store damage value for damage number particles
    if (config.particleType === ParticleType.DAMAGE_NUMBER && emitter?.parentEffect?.metadata) {
      const damage = emitter.parentEffect.metadata['damage'];
      if (typeof damage === 'number') {
        this.damageNumberMap.set(particle.id, damage);
      }
    }

    // Set up animation properties
    this.setupParticleAnimations(particle, config);

    // PERF: Add to render layer once at spawn instead of rebuilding every frame
    this.addParticleToRenderLayer(particle);
  }

  private setupParticleAnimations(particle: ParticleData, config: EmitterConfig): void {
    // Size animation
    if (config.startSize !== config.endSize) {
      particle.sizeOverTime = {
        keyframes: [
          { time: 0, value: config.startSize },
          { time: 1, value: config.endSize },
        ],
        currentValue: config.startSize,
      };
    }

    // Color animation
    if (!this.colorsEqual(config.startColor, config.endColor)) {
      particle.colorOverTime = {
        keyframes: [
          { time: 0, value: { ...config.startColor } },
          { time: 1, value: { ...config.endColor } },
        ],
        currentValue: { ...config.startColor },
      };
    }

    // Opacity animation
    if (config.startOpacity !== config.endOpacity) {
      particle.opacityOverTime = {
        keyframes: [
          { time: 0, value: config.startOpacity },
          { time: 1, value: config.endOpacity },
        ],
        currentValue: config.startOpacity,
      };
    }
  }

  // === ANIMATION UTILITIES ===

  private evaluateAnimationProperty<T>(property: AnimationProperty<T>, time: number): T {
    const keyframes = property.keyframes;
    if (keyframes.length === 0) return property.currentValue;
    if (keyframes.length === 1) return keyframes[0].value;

    // Find surrounding keyframes
    let startFrame = keyframes[0];
    let endFrame = keyframes[keyframes.length - 1];

    for (let i = 0; i < keyframes.length - 1; i++) {
      if (time >= keyframes[i].time && time <= keyframes[i + 1].time) {
        startFrame = keyframes[i];
        endFrame = keyframes[i + 1];
        break;
      }
    }

    // Guard the 0/0 case (two keyframes at the same time): NaN here would poison the
    // in-place color mutation below with rgba(NaN,...) and make the particle invisible
    // for the rest of its life. progress=1 matches the old `return end` fallback.
    const keyframeSpan = endFrame.time - startFrame.time;
    const progress = keyframeSpan > 0 ? (time - startFrame.time) / keyframeSpan : 1;

    // PERF: Color values are mutated in place to avoid per-call object allocation.
    if (
      property.currentValue !== null &&
      typeof property.currentValue === 'object' &&
      'r' in (property.currentValue as object)
    ) {
      return this.interpolateColorInPlace(
        property as unknown as AnimationProperty<Color>,
        startFrame.value as unknown as Color,
        endFrame.value as unknown as Color,
        progress
      ) as unknown as T;
    }

    return this.interpolateValue(startFrame.value, endFrame.value, progress);
  }

  private interpolateValue<T>(start: T, end: T, progress: number): T {
    if (typeof start === 'number' && typeof end === 'number') {
      return (start + (end - start) * progress) as T;
    }

    return end; // Fallback for unsupported types
  }

  /**
   * PERF: Mutate a Color AnimationProperty's currentValue in place instead of
   * allocating a new {r,g,b,a} object on every call.  Returns currentValue so
   * the caller can still assign `particle.color = result` — both references then
   * point to the same object, which is safe because the cssColorSnapshot diff
   * check in updateParticleVisuals compares individual fields.
   */
  private interpolateColorInPlace(
    property: AnimationProperty<Color>,
    start: Color,
    end: Color,
    progress: number
  ): Color {
    const out = property.currentValue;
    out.r = Math.round(start.r + (end.r - start.r) * progress);
    out.g = Math.round(start.g + (end.g - start.g) * progress);
    out.b = Math.round(start.b + (end.b - start.b) * progress);
    out.a = (start.a ?? 1) + ((end.a ?? 1) - (start.a ?? 1)) * progress;
    return out;
  }

  // === CLEANUP ===

  private cullDeadObjects(): void {
    const currentTime = window.performance.now();

    // Prune dead particles from each emitter's tracking array. Dead particles are removed from
    // the render layers and the global activeParticles list elsewhere, but were NEVER removed
    // from emitter.particles — so the cull conditions below (emitter.particles.length === 0)
    // could never be met once an emitter had emitted, and every finite emitting effect lingered
    // until the 10s force-cull backstop. emitter.particles is read ONLY for these length checks
    // (never iterated for update/render), so an in-place isAlive filter is safe; a particle the
    // pool has recycled into another emitter simply re-counts there and the worst case is the
    // unchanged 10s backstop.
    for (let i = 0; i < this.activeEmitters.length; i++) {
      const parts = this.activeEmitters[i].particles;
      let writeIdx = 0;
      for (let readIdx = 0; readIdx < parts.length; readIdx++) {
        if (parts[readIdx].isAlive) parts[writeIdx++] = parts[readIdx];
      }
      parts.length = writeIdx;
    }

    // PERF: In-place compaction for activeEffects — avoids allocating a replacement array
    // each frame.  Same logic as the .filter() it replaces.
    {
      let writeIdx = 0;
      for (let readIdx = 0; readIdx < this.activeEffects.length; readIdx++) {
        const effect = this.activeEffects[readIdx];
        // Infinite-duration effects (duration === -1) are exempt from the lifetime cap —
        // they persist until explicitly destroyed (e.g., player aura, shield glow)
        const isInfinite = effect.duration === -1;
        const overLifetimeCap = !isInfinite && currentTime - effect.createdAt >= this.MAX_EFFECT_LIFETIME_MS;
        if (!effect.isActive && effect.emitters.every((e) => e.particles.length === 0)) {
          this.effectDestroyed$.next(effect.id);
          continue; // drop
        }
        if (overLifetimeCap) {
          // Hard kill: deactivate all emitters so their particles expire naturally
          for (let ei = 0; ei < effect.emitters.length; ei++) {
            effect.emitters[ei].isActive = false;
          }
          effect.isActive = false;
          this.effectDestroyed$.next(effect.id);
          if (window.debugLogBridge) {
            window.debugLogBridge.log('Force-culled effect exceeding max lifetime', 'warning', {
              source: 'effects_system',
              effectId: effect.id,
              effectType: effect.type,
              ageMs: Math.round(currentTime - effect.createdAt),
            });
          }
          continue; // drop
        }
        this.activeEffects[writeIdx++] = effect;
      }
      this.activeEffects.length = writeIdx;
    }

    // PERF: In-place compaction for activeEmitters — avoids allocating a replacement array.
    {
      let writeIdx = 0;
      for (let readIdx = 0; readIdx < this.activeEmitters.length; readIdx++) {
        const emitter = this.activeEmitters[readIdx];
        const isInfiniteEmitter = emitter.config.duration === -1;
        const overLifetimeCap = !isInfiniteEmitter && currentTime - emitter.createdAt >= this.MAX_EFFECT_LIFETIME_MS;
        if (overLifetimeCap) {
          emitter.isActive = false;
        }
        if (!emitter.isActive && emitter.particles.length === 0) {
          continue; // drop
        }
        this.activeEmitters[writeIdx++] = emitter;
      }
      this.activeEmitters.length = writeIdx;
    }

    // PERF: In-place dead-particle reclaim — single forward pass avoids the
    // deadParticles[] intermediate array allocation.  Pool-return logic is inlined
    // (damageNumberMap delete + resetParticle + particlePool push) so there is no
    // O(n) indexOf needed.
    {
      let writeIdx = 0;
      for (let readIdx = 0; readIdx < this.activeParticles.length; readIdx++) {
        const particle = this.activeParticles[readIdx];
        if (!particle.isAlive) {
          // Inline returnParticleToPool — skip the indexOf/splice since we own the compaction
          this.damageNumberMap.delete(particle.id);
          this.resetParticle(particle);
          this.particlePool.push(particle);
        } else {
          this.activeParticles[writeIdx++] = particle;
        }
      }
      this.activeParticles.length = writeIdx;
    }

    // FIX: Periodic cleanup of damageNumberMap to prevent memory leaks
    // This catches orphaned entries from particles that weren't properly cleaned up
    this.cleanupDamageNumberMap();
  }

  /**
   * FIX: Clean up orphaned damage number entries to prevent memory leaks
   * Called periodically or when map size exceeds threshold
   */
  private cleanupDamageNumberMap(): void {
    const currentTime = window.performance.now();

    // Check if cleanup is needed (time-based or size-based)
    const timeSinceLastCleanup = currentTime - this.lastDamageMapCleanup;
    const shouldCleanup =
      timeSinceLastCleanup >= this.DAMAGE_MAP_CLEANUP_INTERVAL_MS ||
      this.damageNumberMap.size > this.MAX_DAMAGE_MAP_SIZE;

    if (!shouldCleanup) return;

    // Perf: build Set without intermediate array allocation from .map()
    const activeParticleIds = new Set<string>();
    for (let i = 0; i < this.activeParticles.length; i++) {
      activeParticleIds.add(this.activeParticles[i].id);
    }

    // Remove entries that don't correspond to active particles
    let removedCount = 0;
    for (const [particleId] of this.damageNumberMap) {
      if (!activeParticleIds.has(particleId)) {
        this.damageNumberMap.delete(particleId);
        removedCount++;
      }
    }

    this.lastDamageMapCleanup = currentTime;

    // Log cleanup if significant entries were removed (for debugging)
    if (removedCount > 10 && window.debugLogBridge) {
      window.debugLogBridge.log('Cleaned up orphaned damage number entries', 'info', {
        source: 'effects_system',
        removedCount,
        remainingEntries: this.damageNumberMap.size,
      });
    }
  }

  /**
   * PERF: Incremental render layer update — only remove dead particles
   * instead of clearing and rebuilding all layers every frame.
   * Particles are added to their layer at spawn time (see addParticleToRenderLayer).
   */
  private updateRenderLayers(): void {
    this.renderLayers.forEach((particles) => {
      // In-place filter: remove dead particles
      let writeIdx = 0;
      for (let readIdx = 0; readIdx < particles.length; readIdx++) {
        if (particles[readIdx].isAlive) {
          particles[writeIdx++] = particles[readIdx];
        }
      }
      particles.length = writeIdx;
    });
  }

  /** Add a particle to its render layer. Called once at spawn time. */
  private addParticleToRenderLayer(particle: ParticleData): void {
    const layer = this.renderLayers.get(particle.layer);
    if (layer) {
      layer.push(particle);
    }
  }

  // === PERFORMANCE MONITORING ===

  private updatePerformanceStats(updateTime: number): void {
    // Perf: for-loop counts avoid the intermediate array allocation from .filter()
    let aliveParticles = 0;
    for (let i = 0; i < this.activeParticles.length; i++) {
      if (this.activeParticles[i].isAlive) aliveParticles++;
    }
    let activeEmitters = 0;
    for (let i = 0; i < this.activeEmitters.length; i++) {
      if (this.activeEmitters[i].isActive) activeEmitters++;
    }
    let activeEffects = 0;
    for (let i = 0; i < this.activeEffects.length; i++) {
      if (this.activeEffects[i].isActive) activeEffects++;
    }

    this.performanceStats = {
      activeParticles: aliveParticles,
      activeEmitters: activeEmitters,
      activeEffects: activeEffects,
      poolUtilization: (this.config.poolSize - this.particlePool.length) / this.config.poolSize,
      renderTime: 0, // Updated by renderer
      updateTime,
      memoryUsage: this.estimateMemoryUsage(),
    };

    this.performanceUpdate$.next(this.performanceStats);
  }

  private estimateMemoryUsage(): number {
    const particleSize = 200; // Rough estimate in bytes
    const emitterSize = 100;
    const effectSize = 150;

    return (
      this.activeParticles.length * particleSize +
      this.activeEmitters.length * emitterSize +
      this.activeEffects.length * effectSize
    );
  }

  // === EFFECT PRESETS ===

  private getEffectPreset(type: EffectType): EffectPreset | null {
    const presets: Partial<Record<EffectType, EffectPreset>> = {
      [EffectType.ENEMY_EXPLOSION]: {
        name: 'Enemy Pop',
        type: EffectType.ENEMY_EXPLOSION,
        duration: 400,
        description: 'Subtle pop effect when enemy dies',
        emitterConfigs: [
          {
            emissionRate: 0, // No continuous emission, just burst
            burstCount: 6, // Reduced from 15 to 6 for subtlety
            duration: 100, // Quick burst
            spawnPosition: { x: 0, y: 0 },
            spawnRadius: 3, // Tighter spawn area
            spawnAngle: 0,
            spawnAngleVariation: Math.PI * 2,
            particleType: ParticleType.ENEMY_DEATH,
            particleLifetime: 300, // Much shorter lifetime for "pop"
            particleLifetimeVariation: 50,
            initialSpeed: 80, // Slower, more gentle pop
            initialSpeedVariation: 20,
            initialDirection: { x: 1, y: 0 },
            startSize: 4, // Slightly larger start
            endSize: 0,
            startColor: { r: 255, g: 255, b: 255, a: 1 }, // White pop instead of fire
            endColor: { r: 200, g: 200, b: 255, a: 0 }, // Fade to light blue
            startOpacity: 0.8, // Not fully opaque for subtlety
            endOpacity: 0,
            gravity: { x: 0, y: 20 }, // Less gravity for floatier feel
            drag: 0.05, // More drag for quicker stop
            blendMode: BlendMode.NORMAL, // Normal blend for subtlety
            layer: 2,
          },
        ],
      },
    };

    return presets[type] || this.createDefaultPreset(type);
  }

  private createDefaultPreset(type: EffectType): EffectPreset {
    return {
      name: `Default ${type}`,
      type,
      duration: 800,
      description: `Default effect for ${type}`,
      emitterConfigs: [
        {
          emissionRate: 50,
          burstCount: 8,
          duration: 150,
          spawnPosition: { x: 0, y: 0 },
          spawnRadius: 8,
          spawnAngle: 0,
          spawnAngleVariation: Math.PI * 2,
          particleType: ParticleType.SPARK,
          particleLifetime: 600,
          particleLifetimeVariation: 200,
          initialSpeed: 100,
          initialSpeedVariation: 40,
          initialDirection: { x: 1, y: 0 },
          startSize: 2,
          endSize: 0,
          startColor: { r: 255, g: 255, b: 255, a: 1 },
          endColor: { r: 255, g: 255, b: 255, a: 0 },
          startOpacity: 1,
          endOpacity: 0,
          gravity: { x: 0, y: 20 },
          drag: 0.02,
          blendMode: BlendMode.ADDITIVE,
          layer: 2,
        },
      ],
    };
  }

  // === UTILITY METHODS ===

  private generateId(): string {
    return `effect_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private colorsEqual(a: Color, b: Color): boolean {
    return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
  }

  // === PUBLIC GETTERS ===

  public getActiveParticles(): ParticleData[] {
    return this.activeParticles.filter((p) => p.isAlive);
  }

  public getParticlesByLayer(layer: number): ParticleData[] {
    return this.renderLayers.get(layer) || [];
  }

  public getPerformanceStats(): EffectPerformanceStats {
    return { ...this.performanceStats };
  }

  public getConfig(): EffectSystemConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<EffectSystemConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  // === CLEANUP ===

  public reset(): void {
    // Return all particles to pool
    this.activeParticles.forEach((particle) => {
      particle.isAlive = false;
    });
    this.cullDeadObjects();

    // Clear all collections
    this.activeEffects.length = 0;
    this.activeEmitters.length = 0;

    // Clear render layers
    this.renderLayers.forEach((layer) => (layer.length = 0));
  }

  public destroy(): void {
    this.reset();
    this.particlePool.length = 0;
    this.renderLayers.clear();
    this.damageNumberMap.clear();
  }

  /**
   * Get damage value for a particle
   */
  public getDamageValue(particleId: string): number | undefined {
    return this.damageNumberMap.get(particleId);
  }

  /**
   * Render all particles to the canvas
   */
  public render(ctx: CanvasRenderingContext2D): void {
    const startTime = window.performance.now();

    // PERFORMANCE: No save/restore needed — only style changes, no transforms
    // PERF: Track last-written GPU state to skip redundant ctx writes.
    // null / -1 are sentinel values that guarantee the first particle always writes correct state.
    let lastBlendMode: string | null = null;
    let lastAlpha = -1;

    // Render particles by layer (back to front)
    for (let layer = 0; layer < this.config.renderLayers; layer++) {
      const particles = this.renderLayers.get(layer);
      if (!particles || particles.length === 0) continue;

      for (const particle of particles) {
        if (!particle.isAlive) continue;

        // Resolve blend mode string for this particle
        let blendMode: string;
        switch (particle.blendMode) {
          case BlendMode.ADDITIVE:
            blendMode = 'lighter';
            break;
          case BlendMode.MULTIPLY:
            blendMode = 'multiply';
            break;
          case BlendMode.SCREEN:
            blendMode = 'screen';
            break;
          default:
            blendMode = 'source-over';
        }

        // PERF: Only write globalCompositeOperation when the value actually changes
        if (blendMode !== lastBlendMode) {
          ctx.globalCompositeOperation = blendMode as GlobalCompositeOperation;
          lastBlendMode = blendMode;
        }

        // PERF: Only write globalAlpha when the value has changed by more than 0.01
        const opacity = particle.opacity;
        if (Math.abs(opacity - lastAlpha) > 0.01) {
          ctx.globalAlpha = opacity;
          lastAlpha = opacity;
        }

        // Draw particle based on type
        switch (particle.type) {
          case ParticleType.CIRCLE:
          default:
            // PERF: Use pre-cached cssColor — no per-frame template-literal allocation.
            // Glow: two concentric arc-fills at stepped alpha instead of createRadialGradient.
            if (particle.glowIntensity > 0) {
              const glowRadius = particle.size * (1 + particle.glowIntensity);

              // TOUCH: skip the outer halo arc on touch devices — halves draw calls for glow particles
              if (!this.isTouch) {
                // Outer halo — 40% alpha, covers full glow radius (no per-frame string, uses cached cssColorGlow)
                ctx.fillStyle = particle.cssColorGlow;
                ctx.beginPath();
                ctx.arc(particle.position.x, particle.position.y, glowRadius, 0, Math.PI * 2);
                ctx.fill();
              }

              // Inner core — full alpha, covers only the solid radius
              ctx.fillStyle = particle.cssColor;
              ctx.beginPath();
              ctx.arc(particle.position.x, particle.position.y, particle.size, 0, Math.PI * 2);
              ctx.fill();
            } else {
              ctx.fillStyle = particle.cssColor;
              ctx.beginPath();
              ctx.arc(particle.position.x, particle.position.y, particle.size, 0, Math.PI * 2);
              ctx.fill();
            }
            break;

          case ParticleType.SQUARE:
            // PERF: Use pre-cached cssColor
            ctx.fillStyle = particle.cssColor;
            ctx.fillRect(
              particle.position.x - particle.size / 2,
              particle.position.y - particle.size / 2,
              particle.size,
              particle.size
            );
            break;

          case ParticleType.SPARK:
            // PERF: Use pre-cached cssColor
            ctx.strokeStyle = particle.cssColor;
            ctx.lineWidth = particle.size;
            ctx.beginPath();
            ctx.moveTo(particle.position.x, particle.position.y);
            ctx.lineTo(
              particle.position.x - particle.velocity.x * 0.1,
              particle.position.y - particle.velocity.y * 0.1
            );
            ctx.stroke();
            break;
        }
      }
    }

    // Reset state after rendering
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0;

    // Update render time
    this.performanceStats.renderTime = window.performance.now() - startTime;
  }
}
