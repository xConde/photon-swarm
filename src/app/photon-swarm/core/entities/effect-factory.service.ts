import { Injectable } from '@angular/core';
import { EffectsSystemService } from './effects-system.service';
import {
  BlendMode,
  Color,
  EffectPerformanceStats,
  EffectType,
  EmitterConfig,
  ParticleType,
  Vector2D,
} from '../models/effects.model';
import { EntityManagerService } from '../ecs/entity-manager.service';
import {
  DischargeEffectComponent,
  FloatingTextComponent,
  PositionComponent,
  RenderableComponent,
  VelocityComponent,
} from '@photon/components';
import { ThemeService } from '@services/theme.service';
import { getFactionColors, TERRITORY_SYSTEM_CONFIG } from '@photon/config/game-constants';
import { PaletteService } from '../../services/palette.service';
import { AbilityType } from '@photon/components/ability.component';

/**
 * Effect Factory Service
 *
 * Adobe-style presets and easy creation methods
 * Like having a library of After Effects compositions ready to use
 */
@Injectable({ providedIn: 'root' })
export class EffectFactoryService {
  // Static spread directions for damage number fan pattern — allocated once, never recreated
  private static readonly DAMAGE_NUMBER_DIRECTIONS = [
    { x: 0, y: -25 }, // First: straight up
    { x: -30, y: -15 }, // Second: up-left
    { x: 30, y: -15 }, // Third: up-right
    { x: -45, y: -35 }, // Fourth: far up-left
    { x: 45, y: -35 }, // Fifth: far up-right
    { x: 0, y: -50 }, // Sixth: far up
    { x: -60, y: -20 }, // Additional positions
    { x: 60, y: -20 },
  ];

  // Track recent damage numbers to prevent "pringles" stacking effect
  private recentDamageNumbers: { x: number; y: number; time: number }[] = [];

  // Per-frame cap to prevent 100+ damage number spam during heavy beam/burn combat
  private damageNumbersThisFrame = 0;
  private lastDamageNumberFrame = 0;

  constructor(
    private effectsSystem: EffectsSystemService,
    private entityManager: EntityManagerService,
    private themeService: ThemeService,
    private paletteService: PaletteService
  ) {}

  /**
   * Get smart position for damage numbers to avoid stacking ("pringles" effect)
   * Offsets new numbers based on recent ones at similar positions
   *
   * FIX: Now tracks SPAWN position (x, y) instead of OFFSET position.
   * This prevents stale tracking data since damage numbers move during their lifetime.
   * Also returns velocity modifier to spread numbers as they float up.
   */
  private getSmartDamageNumberPosition(
    x: number,
    y: number,
    isCritical: boolean
  ): { pos: Vector2D; velocityModX: number } | null {
    const now = Date.now();
    const baseY = y - 15;

    // Clean old entries (400ms window - slightly longer to catch rapid hits)
    this.recentDamageNumbers = this.recentDamageNumbers.filter((entry) => now - entry.time < 400);

    // Count how many recent numbers are near this spawn position (60px radius)
    let stackCount = 0;
    for (const recent of this.recentDamageNumbers) {
      const dx = Math.abs(x - recent.x);
      const dy = Math.abs(y - recent.y);
      if (dx < 60 && dy < 60) {
        stackCount++;
      }
    }

    // Spatial density suppression: if this area already has enough recent numbers,
    // skip creation. Criticals always show (important build feedback).
    // The 8 directions fan pattern becomes unreadable beyond ~4 in a cluster,
    // so suppress once we've exhausted the useful spread positions.
    if (stackCount >= 4 && !isCritical) {
      return null;
    }

    // Alternating spread pattern - left/right/up based on stack count
    const directions = EffectFactoryService.DAMAGE_NUMBER_DIRECTIONS;
    const dirIndex = stackCount % directions.length;
    const offsetX = directions[dirIndex].x + (Math.random() - 0.5) * 10;
    const offsetY = directions[dirIndex].y + (Math.random() - 0.5) * 10;

    const finalPos = { x: x + offsetX, y: baseY + offsetY };

    // Velocity modifier to spread numbers as they rise (alternate left/right)
    const velocityModX = (dirIndex % 2 === 0 ? -1 : 1) * (10 + stackCount * 8);

    // Track SPAWN position (x, y), not the final offset position
    this.recentDamageNumbers.push({ x: x, y: y, time: now });

    // Limit array size
    if (this.recentDamageNumbers.length > 20) {
      this.recentDamageNumbers.shift();
    }

    return { pos: finalPos, velocityModX };
  }

  // === COMBAT EFFECTS ===

  /**
   * Enemy death explosion - subtle pop effect
   */
  public createEnemyExplosion(position: Vector2D, intensity: number = 1): string {
    // Much more subtle pop effect - reduced from 15 to 5-8 particles
    const particleCount = Math.floor(5 + 3 * intensity);
    const radius = 8 * intensity; // Reduced from 20 to 8
    const duration = 400; // Reduced from 1000ms to 400ms for quicker pop

    return this.effectsSystem.createParticleEffect(
      EffectType.ENEMY_EXPLOSION,
      position,
      particleCount,
      radius,
      duration,
      { intensity, type: 'combat' }
    );
  }

  /**
   * Enhanced enemy death particles - more dramatic effect for special enemies.
   * tierMultiplier scales visual intensity proportional to enemy difficulty:
   *   1.0 = elite (default), 1.5 = enhanced elite, 2.5 = boss
   */
  public createDeathParticles(
    position: Vector2D,
    _enemyType: string = 'basic',
    eliteStatus: boolean = false,
    tierMultiplier: number = 1.0
  ): string {
    // Create multiple particle bursts for dramatic effect
    const effects: string[] = [];

    // Main explosion burst — scaled by tierMultiplier
    const baseParticles = eliteStatus ? 20 : 12;
    const baseRadius = eliteStatus ? 30 : 20;
    const baseSize = eliteStatus ? 6 : 4;
    const baseLifetime = 800;

    const mainParticles = Math.floor(baseParticles * tierMultiplier);
    const mainRadius = baseRadius * tierMultiplier;
    const mainSize = Math.min(baseSize * tierMultiplier, baseSize * 2); // cap at 2x
    const mainLifetime = baseLifetime * Math.min(tierMultiplier, 1.5); // cap lifetime scaling

    const mainEmitter: EmitterConfig = {
      emissionRate: 0,
      burstCount: mainParticles,
      duration: 100,
      spawnPosition: position,
      spawnRadius: 5,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.ENEMY_DEATH,
      particleLifetime: mainLifetime,
      particleLifetimeVariation: 200,
      initialSpeed: mainRadius * 0.5,
      initialSpeedVariation: mainRadius * 0.3,
      initialDirection: { x: 0, y: 0 },
      gravity: { x: 0, y: 50 }, // Gravity effect
      drag: 0.1,
      startSize: mainSize,
      endSize: 0,
      startColor: eliteStatus ? { r: 255, g: 200, b: 0, a: 1 } : { r: 255, g: 100, b: 100, a: 1 },
      endColor: { r: 200, g: 50, b: 50, a: 0 },
      startOpacity: 1,
      endOpacity: 0,
      blendMode: BlendMode.ADDITIVE,
      layer: 5,
    };

    // Note: createEmitter returns a string ID, not the emitter
    effects.push(this.effectsSystem.createEmitter(mainEmitter));

    // Secondary spark burst for extra flair
    if (eliteStatus || Math.random() < 0.3) {
      const sparkEmitter: EmitterConfig = {
        emissionRate: 0,
        burstCount: 8,
        duration: 50,
        spawnPosition: position,
        spawnRadius: 10,
        spawnAngle: 0,
        spawnAngleVariation: Math.PI * 2,
        particleType: ParticleType.SPARK,
        particleLifetime: 600,
        particleLifetimeVariation: 100,
        initialSpeed: 40,
        initialSpeedVariation: 20,
        initialDirection: { x: 0, y: 0 },
        gravity: { x: 0, y: 100 },
        drag: 0.05,
        startSize: 2,
        endSize: 0,
        startColor: { r: 255, g: 255, b: 200, a: 1 },
        endColor: { r: 255, g: 100, b: 0, a: 0 },
        startOpacity: 1,
        endOpacity: 0,
        blendMode: BlendMode.ADDITIVE,
        layer: 6,
      };

      // Note: createEmitter returns a string ID
      effects.push(this.effectsSystem.createEmitter(sparkEmitter));
    }

    // Return first effect ID (main explosion)
    return effects[0] || ''; // Return empty string if no effects were created
  }

  /**
   * Shard collection sparkle - satisfying pickup effect.
   * Particle intensity and burst radius scale with shard value.
   */
  public createShardCollection(position: Vector2D, shardValue: number = 1): string {
    const particleCount = Math.min(6 + shardValue * 3, 24);
    const radius = Math.min(12 + shardValue * 2, 25);
    const duration = 500 + Math.min(shardValue * 30, 300);

    return this.effectsSystem.createParticleEffect(
      EffectType.SHARD_COLLECTION,
      position,
      particleCount,
      radius,
      duration,
      { shardValue, type: 'pickup' }
    );
  }

  /**
   * Shard pickup floating text - shows "+N" at collection point.
   * Uses green color to convey currency gain, smaller font than damage numbers.
   */
  public createShardPickupText(position: Vector2D, shardValue: number): void {
    const entity = this.entityManager.createEntity();

    // Slight random horizontal offset so stacked pickups spread out
    const offsetX = (Math.random() - 0.5) * 24;
    const velocityX = (Math.random() - 0.5) * 15;
    const velocityY = -40 - Math.random() * 10;

    this.entityManager.addComponent(entity, new PositionComponent(position.x, position.y));
    this.entityManager.addComponent(entity, new VelocityComponent(velocityX, velocityY));

    // Tier-colored text: high → emerald, medium → gold, low → cyan
    const colors = this.paletteService.getCanvas();
    const shardColor = shardValue > 5 ? colors.SHARD_HIGH : shardValue > 2 ? colors.SHARD_MED : colors.SHARD_LOW;

    // Slightly larger font for high-value drops
    const fontSize = shardValue > 5 ? 14 : 12;

    this.entityManager.addComponent(
      entity,
      new FloatingTextComponent(
        // Display as a whole number — shard multipliers can make shardValue fractional.
        `+${Math.round(shardValue)}`,
        shardColor,
        fontSize,
        800,
        undefined,
        offsetX,
        -10,
        velocityX,
        velocityY,
        0.5,
        1.0
      )
    );
  }

  /**
   * Shard Synthesis buff callout — shows buff name at player position when triggered.
   * Color-coded by buff type: speed → cyan, damage → orange, firerate → yellow.
   */
  public createSynthesisBuffText(position: Vector2D, buffId: string, description: string): void {
    const entity = this.entityManager.createEntity();

    const colorMap: Record<string, string> = {
      shard_speed: '#00e5ff',
      shard_damage: '#ff6b35',
      shard_firerate: '#ffd700',
    };
    const color = colorMap[buffId] || '#ffffff';

    this.entityManager.addComponent(entity, new PositionComponent(position.x, position.y));
    this.entityManager.addComponent(entity, new VelocityComponent(0, -25));

    this.entityManager.addComponent(
      entity,
      new FloatingTextComponent(description.toUpperCase(), color, 11, 1200, undefined, 0, -25, 0, -25, 0.4, 1.0)
    );
  }

  /**
   * Beam impact effect - energy discharge
   */
  public createBeamImpact(position: Vector2D, damage: number = 10): string {
    const intensity = Math.min(damage / 10, 5);
    // Scale particle count with damage (2-12 particles)
    const particleCount = Math.floor(2.5 * intensity);

    const emitterConfig: EmitterConfig = {
      emissionRate: 60, // Reduced from 200 — one-per-frame instead of 3x per frame
      burstCount: Math.min(particleCount, 4), // Cap at 4 particles per tick (was 2)
      duration: 150,
      spawnPosition: position,
      spawnRadius: 3,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.BEAM_HIT,
      particleLifetime: 200, // Reduced from 300ms to 200ms
      particleLifetimeVariation: 50, // Reduced from 100ms to 50ms
      initialSpeed: 30 * intensity, // Reduced from 100 to 30 (70% reduction)
      initialSpeedVariation: 10, // Reduced from 40 to 10
      initialDirection: { x: 1, y: 0 },
      startSize: 0.5 + 0.3 * intensity, // Scale size with damage intensity
      endSize: 0,
      startColor: { r: 100, g: 255, b: 255, a: 1 },
      endColor: { r: 255, g: 255, b: 255, a: 0 },
      startOpacity: 0.65, // Raised from 0.3 for better impact visibility
      endOpacity: 0,
      gravity: { x: 0, y: 0 },
      drag: 0.05,
      blendMode: BlendMode.ADDITIVE,
      layer: 2,
    };

    return this.effectsSystem.createCustomEffect(position, [emitterConfig], 500, { damage, type: 'combat' });
  }

  /**
   * Critical hit effect - enhanced impact
   */
  public createCriticalHit(position: Vector2D, damage: number = 20): string {
    const mainBurst: EmitterConfig = {
      emissionRate: 300,
      burstCount: 12,
      duration: 100,
      spawnPosition: position,
      spawnRadius: 5,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.BEAM_HIT,
      particleLifetime: 600,
      particleLifetimeVariation: 200,
      initialSpeed: 150,
      initialSpeedVariation: 50,
      initialDirection: { x: 1, y: 0 },
      startSize: 4,
      endSize: 1,
      startColor: { r: 255, g: 255, b: 100, a: 1 },
      endColor: { r: 255, g: 100, b: 0, a: 0 },
      startOpacity: 1,
      endOpacity: 0,
      gravity: { x: 0, y: 20 },
      drag: 0.02,
      blendMode: BlendMode.ADDITIVE,
      layer: 3,
    };

    const sparkles: EmitterConfig = {
      emissionRate: 100,
      burstCount: 8,
      duration: 200,
      spawnPosition: position,
      spawnRadius: 15,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.SPARK,
      particleLifetime: 800,
      particleLifetimeVariation: 300,
      initialSpeed: 80,
      initialSpeedVariation: 40,
      initialDirection: { x: 0, y: -1 },
      startSize: 1,
      endSize: 3,
      startColor: { r: 255, g: 255, b: 255, a: 1 },
      endColor: { r: 255, g: 255, b: 100, a: 0 },
      startOpacity: 1,
      endOpacity: 0,
      gravity: { x: 0, y: -30 },
      drag: 0.01,
      blendMode: BlendMode.ADDITIVE,
      layer: 4,
    };

    return this.effectsSystem.createCustomEffect(position, [mainBurst, sparkles], 1000, {
      damage,
      type: 'critical',
      isCritical: true,
    });
  }

  /**
   * Discharge wave effect - pink cyber bubble that expands and pops
   */
  public createDischargeWave(position: Vector2D, radius: number = 100): string {
    // Increased cap for more impressive area attack
    const cappedRadius = Math.min(radius, 400);

    // Create discharge effect entity for the pink bubble
    const effectEntity = this.entityManager.createEntity();

    // Add position component
    this.entityManager.addComponent(effectEntity, new PositionComponent(position.x, position.y));

    // Add discharge effect component with bubble animation timing
    // Duration of 0.5 seconds for bubble expansion and pop
    const dischargeEffect = new DischargeEffectComponent(
      0, // start radius
      cappedRadius, // max radius
      cappedRadius * 2, // expansion rate (pixels per second)
      0.5, // duration (500ms for full animation)
      0 // elapsed time
    );
    this.entityManager.addComponent(effectEntity, dischargeEffect);

    // Add renderable component for ECS visibility (minimal setup)
    const renderable = new RenderableComponent('#FF1493', 'effects', true, 1, 0);
    this.entityManager.addComponent(effectEntity, renderable);

    // Also create some particle effects for extra pizzazz
    // Inner glow particles
    const centerBurst: EmitterConfig = {
      emissionRate: 200,
      burstCount: 20,
      duration: 100,
      spawnPosition: position,
      spawnRadius: 10,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.GLOW,
      particleLifetime: 300,
      particleLifetimeVariation: 100,
      initialSpeed: 50,
      initialSpeedVariation: 20,
      initialDirection: { x: 1, y: 0 },
      startSize: 10,
      endSize: 0,
      startColor: { r: 255, g: 20, b: 147, a: 1 }, // Deep pink
      endColor: { r: 255, g: 105, b: 180, a: 0 }, // Light pink
      startOpacity: 1,
      endOpacity: 0,
      gravity: { x: 0, y: 0 },
      drag: 0.05,
      blendMode: BlendMode.ADDITIVE,
      layer: 2,
    };

    // Create the particle effects too
    this.effectsSystem.createCustomEffect(position, [centerBurst], 500, {
      type: 'discharge',
      radius: cappedRadius,
    });

    // Return the effect entity ID as a string
    return effectEntity.toString();
  }

  // === DISRUPTOR EFFECTS ===

  /**
   * EMP Pulse ring effect — expanding purple ring VFX for Disruptor enemies.
   *
   * Uses DischargeEffectComponent for the expanding ring (same rendering path
   * as discharge wave) tinted via particle sparks. NO shadowBlur, NO per-frame
   * gradients — only solid strokeStyle arcs in the renderer.
   */
  public createEmpPulseEffect(position: Vector2D, radius: number): string {
    const cappedRadius = Math.min(radius, 200);

    // Create expanding ring entity (same as discharge wave but purple-tinted)
    const effectEntity = this.entityManager.createEntity();

    this.entityManager.addComponent(effectEntity, new PositionComponent(position.x, position.y));

    const dischargeEffect = new DischargeEffectComponent(
      0, // start radius
      cappedRadius, // max radius
      cappedRadius * (1000 / 300), // expand to full radius in 300ms
      0.3, // duration 300ms
      0 // elapsed
    );
    this.entityManager.addComponent(effectEntity, dischargeEffect);

    // Purple tint — renderer checks RenderableComponent color for discharge effects
    const renderable = new RenderableComponent('#9B30FF', 'effects', true, 1, 0);
    this.entityManager.addComponent(effectEntity, renderable);

    // Ring-edge particle sparks (5 sparks spread around perimeter)
    const sparkBurst: EmitterConfig = {
      emissionRate: 200,
      burstCount: 5,
      duration: 80,
      spawnPosition: position,
      spawnRadius: cappedRadius * 0.9,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.SPARK,
      particleLifetime: 250,
      particleLifetimeVariation: 80,
      initialSpeed: 30,
      initialSpeedVariation: 15,
      initialDirection: { x: 1, y: 0 },
      startSize: 6,
      endSize: 0,
      startColor: { r: 155, g: 48, b: 255, a: 1 }, // Purple
      endColor: { r: 200, g: 150, b: 255, a: 0 }, // Pale purple fade
      startOpacity: 1,
      endOpacity: 0,
      gravity: { x: 0, y: 0 },
      drag: 0.08,
      blendMode: BlendMode.ADDITIVE,
      layer: 2,
    };

    this.effectsSystem.createCustomEffect(position, [sparkBurst], 300, {
      type: 'emp_pulse',
      radius: cappedRadius,
    });

    return effectEntity.toString();
  }

  // === UI EFFECTS ===

  /**
   * Level up celebration effect
   */
  public createLevelUpBurst(position: Vector2D, newLevel: number = 1): string {
    const intensity = Math.min(newLevel / 5, 2);
    const particleCount = Math.floor(20 * intensity);

    const starBurst: EmitterConfig = {
      emissionRate: 400,
      burstCount: particleCount,
      duration: 200,
      spawnPosition: position,
      spawnRadius: 8,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.LEVEL_UP,
      particleLifetime: 1200,
      particleLifetimeVariation: 400,
      initialSpeed: 120,
      initialSpeedVariation: 60,
      initialDirection: { x: 1, y: 0 },
      startSize: 3,
      endSize: 6,
      startColor: { r: 255, g: 215, b: 0, a: 1 },
      endColor: { r: 255, g: 255, b: 255, a: 0 },
      startOpacity: 1,
      endOpacity: 0,
      gravity: { x: 0, y: -40 },
      drag: 0.015,
      blendMode: BlendMode.ADDITIVE,
      layer: 5,
    };

    return this.effectsSystem.createCustomEffect(position, [starBurst], 1500, { newLevel, type: 'ui' });
  }

  /**
   * Healing effect - gentle restoration
   */
  public createHealEffect(position: Vector2D, healAmount: number = 10): string {
    const intensity = Math.min(healAmount / 20, 2);
    const particleCount = Math.floor(8 * intensity);

    const healingAura: EmitterConfig = {
      emissionRate: 150,
      burstCount: particleCount,
      duration: 300,
      spawnPosition: position,
      spawnRadius: 12,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.GLOW,
      particleLifetime: 1000,
      particleLifetimeVariation: 300,
      initialSpeed: 40,
      initialSpeedVariation: 20,
      initialDirection: { x: 0, y: -1 },
      startSize: 2,
      endSize: 4,
      startColor: { r: 100, g: 255, b: 100, a: 1 },
      endColor: { r: 200, g: 255, b: 200, a: 0 },
      startOpacity: 0.8,
      endOpacity: 0,
      gravity: { x: 0, y: -25 },
      drag: 0.02,
      blendMode: BlendMode.ADDITIVE,
      layer: 3,
    };

    return this.effectsSystem.createCustomEffect(position, [healingAura], 800, { healAmount, type: 'heal' });
  }

  /**
   * Damage number popup effect - Creates BOTH floating text AND particles
   * Uses smart positioning to prevent "pringles" stacking effect
   */
  public createDamageNumber(position: Vector2D, damage: number, isCritical: boolean = false): string | null {
    // Per-frame cap: reset counter when entering a new frame (~16ms), then enforce max 8
    const currentFrame = window.performance.now();
    if (currentFrame - this.lastDamageNumberFrame > 16) {
      this.damageNumbersThisFrame = 0;
      this.lastDamageNumberFrame = currentFrame;
    }
    if (this.damageNumbersThisFrame >= 8) {
      return null; // Skip excess damage numbers this frame
    }

    // Get smart position — returns null if this area is spatially saturated
    // (4+ recent numbers within 60px). Criticals bypass spatial suppression
    // but not the per-frame cap above.
    const smartResult = this.getSmartDamageNumberPosition(position.x, position.y, isCritical);
    if (!smartResult) {
      return null;
    }
    this.damageNumbersThisFrame++;

    const { pos: smartPos, velocityModX } = smartResult;

    const entity = this.entityManager.createEntity();

    // Add position using smart offset
    this.entityManager.addComponent(entity, new PositionComponent(smartPos.x, smartPos.y));

    // CRITICAL FIX: Calculate smart velocity values ONCE
    // These MUST be passed to FloatingTextComponent, not just VelocityComponent,
    // because FloatingTextSystemService copies FloatingTextComponent velocities
    // to VelocityComponent every frame (lines 53-56), overwriting any values we set here.
    const smartVelocityX = velocityModX + (Math.random() - 0.5) * 10;
    const smartVelocityY = -45 - Math.random() * 15;

    // Add velocity component (will be synced from FloatingTextComponent by FloatingTextSystemService)
    this.entityManager.addComponent(entity, new VelocityComponent(smartVelocityX, smartVelocityY));

    // Add floating text component - ensure damage is shown as integer (theme-aware)
    const colors = this.paletteService.getCanvas();
    const textColor = isCritical ? colors.DAMAGE_CRITICAL : colors.DAMAGE_NORMAL;
    const fontSize = isCritical ? 20 : 16;
    const roundedDamage = Math.round(damage);
    const text = isCritical ? `${roundedDamage}!` : `${roundedDamage}`;

    // CRITICAL FIX: Pass ALL args including velocityX (arg 7) and velocityY (arg 8)
    // Previously we only passed 4 args, so velocityX/Y defaulted to 0/-50
    // which caused all damage numbers to float straight up identically
    this.entityManager.addComponent(
      entity,
      new FloatingTextComponent(
        text, // arg 0: text
        textColor, // arg 1: color
        fontSize, // arg 2: fontSize
        1000, // arg 3: duration (1 second)
        undefined, // arg 4: startTime (use default = now)
        0, // arg 5: offsetX
        -15, // arg 6: offsetY (start above entity)
        smartVelocityX, // arg 7: CRITICAL - horizontal velocity for spread
        smartVelocityY, // arg 8: CRITICAL - varied vertical velocity
        0.7, // arg 9: fadeStart
        isCritical ? 1.3 : 1.0 // arg 10: scale
      )
    );

    // Also create particle effect for extra visual flair
    const color: Color = isCritical ? { r: 255, g: 255, b: 100, a: 1 } : { r: 255, g: 100, b: 100, a: 1 };

    const size = isCritical ? 6 : 4;

    const numberEffect: EmitterConfig = {
      emissionRate: 1,
      burstCount: 3, // A few particles for impact
      duration: 50,
      spawnPosition: smartPos,
      spawnRadius: 5,
      spawnAngle: Math.PI / 2,
      spawnAngleVariation: 0.3,
      particleType: ParticleType.SPARK,
      particleLifetime: 500,
      particleLifetimeVariation: 100,
      initialSpeed: 80,
      initialSpeedVariation: 30,
      initialDirection: { x: 0, y: -1 },
      startSize: size,
      endSize: size * 0.3,
      startColor: color,
      endColor: { ...color, a: 0 },
      startOpacity: 0.8,
      endOpacity: 0,
      gravity: { x: 0, y: 50 },
      drag: 0.05,
      blendMode: BlendMode.ADDITIVE,
      layer: 6,
    };

    return this.effectsSystem.createCustomEffect(smartPos, [numberEffect], 1500, {
      damage,
      isCritical,
      type: 'damage_number',
    });
  }

  /**
   * Floating label popup — shows a short text string at a world position.
   * Modeled on createDamageNumber but takes a string instead of a damage value.
   * Used for events like parry feedback ("PARRY!") where we want a word, not a number.
   */
  public createFloatingLabel(position: Vector2D, text: string, color: string): void {
    const entity = this.entityManager.createEntity();

    this.entityManager.addComponent(entity, new PositionComponent(position.x, position.y - 15));
    this.entityManager.addComponent(entity, new VelocityComponent(0, -40));
    this.entityManager.addComponent(
      entity,
      new FloatingTextComponent(
        text, // text string
        color, // color
        16, // fontSize
        900, // duration (ms)
        undefined, // startTime — default = now
        0, // offsetX
        -10, // offsetY
        0, // velocityX
        -40, // velocityY
        0.6, // fadeStart
        1.1 // scale
      )
    );
  }

  // === ENVIRONMENTAL EFFECTS ===

  /**
   * Asteroid destruction effect
   */
  public createAsteroidBreak(position: Vector2D, asteroidSize: number = 1): string {
    const particleCount = Math.floor(10 * asteroidSize);
    const radius = 15 * asteroidSize;

    const rockChunks: EmitterConfig = {
      emissionRate: 300,
      burstCount: particleCount,
      duration: 100,
      spawnPosition: position,
      spawnRadius: radius * 0.5,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.SMOKE,
      particleLifetime: 1200,
      particleLifetimeVariation: 400,
      initialSpeed: 80 * asteroidSize,
      initialSpeedVariation: 40,
      initialDirection: { x: 1, y: 0 },
      startSize: 2 * asteroidSize,
      endSize: 0.5,
      startColor: { r: 150, g: 150, b: 150, a: 1 },
      endColor: { r: 100, g: 100, b: 100, a: 0 },
      startOpacity: 1,
      endOpacity: 0,
      gravity: { x: 0, y: 100 },
      drag: 0.04,
      blendMode: BlendMode.NORMAL,
      layer: 1,
    };

    const dustCloud: EmitterConfig = {
      emissionRate: 150,
      burstCount: Math.floor(6 * asteroidSize),
      duration: 200,
      spawnPosition: position,
      spawnRadius: radius,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.SMOKE,
      particleLifetime: 2000,
      particleLifetimeVariation: 500,
      initialSpeed: 30,
      initialSpeedVariation: 15,
      initialDirection: { x: 1, y: 0 },
      startSize: 4 * asteroidSize,
      endSize: 8 * asteroidSize,
      startColor: { r: 120, g: 120, b: 120, a: 0.6 },
      endColor: { r: 80, g: 80, b: 80, a: 0 },
      startOpacity: 0.6,
      endOpacity: 0,
      gravity: { x: 0, y: -10 },
      drag: 0.01,
      blendMode: BlendMode.NORMAL,
      layer: 0,
    };

    return this.effectsSystem.createCustomEffect(position, [rockChunks, dustCloud], 2500, {
      asteroidSize,
      type: 'environmental',
    });
  }

  /**
   * Territory transition effect
   */
  public createTerritoryChange(position: Vector2D, fromColor: Color, toColor: Color): string {
    const transitionWave: EmitterConfig = {
      emissionRate: 200,
      burstCount: 20,
      duration: 300,
      spawnPosition: position,
      spawnRadius: 30,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.GLOW,
      particleLifetime: 1500,
      particleLifetimeVariation: 500,
      initialSpeed: 100,
      initialSpeedVariation: 50,
      initialDirection: { x: 1, y: 0 },
      startSize: 3,
      endSize: 1,
      startColor: fromColor,
      endColor: toColor,
      startOpacity: 0.8,
      endOpacity: 0,
      gravity: { x: 0, y: 0 },
      drag: 0.02,
      blendMode: BlendMode.ADDITIVE,
      layer: 2,
    };

    return this.effectsSystem.createCustomEffect(position, [transitionWave], 1800, {
      fromColor,
      toColor,
      type: 'territory',
    });
  }

  // === CONTINUOUS EFFECTS ===

  /**
   * Player aura effect - continuous glow
   */
  public createPlayerAura(position: Vector2D, color: Color = { r: 100, g: 200, b: 255, a: 0.5 }): string {
    const auraGlow: EmitterConfig = {
      emissionRate: 20,
      duration: -1, // Infinite
      spawnPosition: position,
      spawnRadius: 8,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.GLOW,
      particleLifetime: 800,
      particleLifetimeVariation: 200,
      initialSpeed: 20,
      initialSpeedVariation: 10,
      initialDirection: { x: 1, y: 0 },
      startSize: 2,
      endSize: 4,
      startColor: color,
      endColor: { ...color, a: 0 },
      startOpacity: color.a ?? 1,
      endOpacity: 0,
      gravity: { x: 0, y: -15 },
      drag: 0.01,
      blendMode: BlendMode.ADDITIVE,
      layer: 1,
    };

    return this.effectsSystem.createCustomEffect(
      position,
      [auraGlow],
      -1, // Infinite duration
      { color, type: 'aura', continuous: true }
    );
  }

  /**
   * Beam trail effect - follows projectiles
   */
  public createBeamTrail(
    startPos: Vector2D,
    endPos: Vector2D,
    color: Color = { r: 100, g: 255, b: 255, a: 0.8 }
  ): string | null {
    const deltaX = endPos.x - startPos.x;
    const deltaY = endPos.y - startPos.y;
    const trailLength = Math.hypot(deltaX, deltaY);
    if (!Number.isFinite(trailLength) || trailLength < 0.001) return null;

    const particleCount = Math.floor(trailLength / 10);

    const beamTrail: EmitterConfig = {
      emissionRate: 200,
      burstCount: particleCount,
      duration: 50,
      spawnPosition: startPos,
      spawnRadius: 2,
      spawnAngle: Math.atan2(deltaY, deltaX),
      spawnAngleVariation: 0.1,
      particleType: ParticleType.TRAIL,
      particleLifetime: 300,
      particleLifetimeVariation: 100,
      initialSpeed: trailLength / 0.3, // Reach end in 0.3 seconds
      initialSpeedVariation: 20,
      initialDirection: {
        x: deltaX / trailLength,
        y: deltaY / trailLength,
      },
      startSize: 2,
      endSize: 0,
      startColor: color,
      endColor: { ...color, a: 0 },
      startOpacity: color.a ?? 1,
      endOpacity: 0,
      gravity: { x: 0, y: 0 },
      drag: 0.02,
      blendMode: BlendMode.ADDITIVE,
      layer: 1,
    };

    return this.effectsSystem.createCustomEffect(startPos, [beamTrail], 400, {
      startPos,
      endPos,
      color,
      type: 'trail',
    });
  }

  /**
   * Player death effect - dramatic explosion
   */
  public createPlayerDeath(position: Vector2D): string {
    // Core explosion
    const mainExplosion: EmitterConfig = {
      emissionRate: 500,
      burstCount: 30,
      duration: 100,
      spawnPosition: position,
      spawnRadius: 10,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.ENEMY_DEATH,
      particleLifetime: 1200,
      particleLifetimeVariation: 400,
      initialSpeed: 200,
      initialSpeedVariation: 100,
      initialDirection: { x: 1, y: 0 },
      startSize: 8,
      endSize: 2,
      startColor: { r: 255, g: 100, b: 100, a: 1 },
      endColor: { r: 255, g: 0, b: 0, a: 0 },
      startOpacity: 1,
      endOpacity: 0,
      gravity: { x: 0, y: 50 },
      drag: 0.03,
      blendMode: BlendMode.ADDITIVE,
      layer: 5,
    };

    // Energy ring
    const energyRing: EmitterConfig = {
      emissionRate: 1,
      burstCount: 1,
      duration: 50,
      spawnPosition: position,
      spawnRadius: 0,
      spawnAngle: 0,
      spawnAngleVariation: 0,
      particleType: ParticleType.CIRCLE,
      particleLifetime: 800,
      particleLifetimeVariation: 0,
      initialSpeed: 0,
      initialSpeedVariation: 0,
      initialDirection: { x: 0, y: 0 },
      startSize: 20,
      endSize: 200,
      startColor: { r: 255, g: 255, b: 255, a: 0.8 },
      endColor: { r: 255, g: 100, b: 100, a: 0 },
      startOpacity: 0.8,
      endOpacity: 0,
      gravity: { x: 0, y: 0 },
      drag: 0,
      blendMode: BlendMode.ADDITIVE,
      layer: 4,
    };

    return this.effectsSystem.createCustomEffect(position, [mainExplosion, energyRing], 1200, { type: 'player_death' });
  }

  /**
   * Enemy spawn effect - portal appearance
   */
  public createEnemySpawn(position: Vector2D, enemyType: string = 'normal', factionId: number = 0): string {
    const factionColors = getFactionColors(factionId, this.themeService.isDayMode);

    // Parse hex primary color → RGB
    const primaryHex = factionColors.primary.replace('#', '');
    const pr = parseInt(primaryHex.slice(0, 2), 16);
    const pg = parseInt(primaryHex.slice(2, 4), 16);
    const pb = parseInt(primaryHex.slice(4, 6), 16);

    // Parse hex glow color → RGB
    const glowHex = factionColors.glow.replace('#', '');
    const gr = parseInt(glowHex.slice(0, 2), 16);
    const gg = parseInt(glowHex.slice(2, 4), 16);
    const gb = parseInt(glowHex.slice(4, 6), 16);

    const spawnPortal: EmitterConfig = {
      emissionRate: 100,
      burstCount: 20,
      duration: 400,
      spawnPosition: position,
      spawnRadius: 30,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.CIRCLE,
      particleLifetime: 500,
      particleLifetimeVariation: 100,
      initialSpeed: 50,
      initialSpeedVariation: 30,
      initialDirection: { x: 0, y: -1 },
      startSize: 3,
      endSize: 0,
      startColor: { r: pr, g: pg, b: pb, a: 1 },
      endColor: { r: gr, g: gg, b: gb, a: 0 },
      startOpacity: 0.8,
      endOpacity: 0,
      gravity: { x: 0, y: -20 },
      drag: 0.02,
      blendMode: BlendMode.ADDITIVE,
      layer: 2,
    };

    return this.effectsSystem.createCustomEffect(position, [spawnPortal], 500, { type: 'enemy_spawn', enemyType });
  }

  /**
   * Projectile trail effect - continuous trail
   */
  public createProjectileTrail(position: Vector2D, velocity: Vector2D, color?: Color): string {
    const trailColor = color || { r: 255, g: 255, b: 100, a: 0.8 };

    const trail: EmitterConfig = {
      emissionRate: 60,
      burstCount: 1,
      duration: 5000, // 5 seconds — longer than any projectile's natural lifetime
      spawnPosition: position,
      spawnRadius: 2,
      spawnAngle: Math.atan2(-velocity.y, -velocity.x),
      spawnAngleVariation: 0.2,
      particleType: ParticleType.CIRCLE,
      particleLifetime: 300,
      particleLifetimeVariation: 100,
      initialSpeed: 20,
      initialSpeedVariation: 10,
      initialDirection: {
        x: -velocity.x / Math.sqrt(velocity.x ** 2 + velocity.y ** 2),
        y: -velocity.y / Math.sqrt(velocity.x ** 2 + velocity.y ** 2),
      },
      startSize: 4,
      endSize: 0,
      startColor: trailColor,
      endColor: { ...trailColor, a: 0 },
      startOpacity: 0.6,
      endOpacity: 0,
      gravity: { x: 0, y: 0 },
      drag: 0.05,
      blendMode: BlendMode.ADDITIVE,
      layer: 1,
    };

    return this.effectsSystem.createCustomEffect(
      position,
      [trail],
      5000, // 5 seconds — longer than any projectile's natural lifetime
      { type: 'projectile_trail' }
    );
  }

  /**
   * Shield hit effect - energy ripple
   */
  public createShieldHit(position: Vector2D, damage: number = 10): string {
    const ripple: EmitterConfig = {
      emissionRate: 200,
      burstCount: 15,
      duration: 100,
      spawnPosition: position,
      spawnRadius: 5,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.CIRCLE,
      particleLifetime: 400,
      particleLifetimeVariation: 100,
      initialSpeed: 80,
      initialSpeedVariation: 20,
      initialDirection: { x: 1, y: 0 },
      startSize: 3,
      endSize: 1,
      startColor: { r: 100, g: 200, b: 255, a: 1 },
      endColor: { r: 50, g: 150, b: 255, a: 0 },
      startOpacity: 0.8,
      endOpacity: 0,
      gravity: { x: 0, y: 0 },
      drag: 0.08,
      blendMode: BlendMode.ADDITIVE,
      layer: 3,
    };

    return this.effectsSystem.createCustomEffect(position, [ripple], 500, { type: 'shield_hit', damage });
  }

  /**
   * Weapon fire muzzle flash
   */
  public createMuzzleFlash(position: Vector2D, direction: Vector2D, weaponType: string = 'default'): string {
    const flash: EmitterConfig = {
      emissionRate: 1,
      burstCount: 1,
      duration: 50,
      spawnPosition: position,
      spawnRadius: 0,
      spawnAngle: Math.atan2(direction.y, direction.x),
      spawnAngleVariation: 0.2,
      particleType: ParticleType.CIRCLE,
      particleLifetime: 100,
      particleLifetimeVariation: 20,
      initialSpeed: 0,
      initialSpeedVariation: 0,
      initialDirection: direction,
      startSize: 15,
      endSize: 5,
      startColor: { r: 255, g: 255, b: 200, a: 1 },
      endColor: { r: 255, g: 200, b: 100, a: 0 },
      startOpacity: 0.9,
      endOpacity: 0,
      gravity: { x: 0, y: 0 },
      drag: 0,
      blendMode: BlendMode.ADDITIVE,
      layer: 4,
    };

    return this.effectsSystem.createCustomEffect(position, [flash], 150, { type: 'muzzle_flash', weaponType });
  }

  // === UTILITY METHODS ===

  /**
   * Get effect performance stats
   */
  public getPerformanceStats(): EffectPerformanceStats {
    return this.effectsSystem.getPerformanceStats();
  }

  /**
   * Destroy specific effect
   */
  public destroyEffect(effectId: string): void {
    this.effectsSystem.destroyEffect(effectId);
  }

  /**
   * Reset all effects
   */
  public resetAllEffects(): void {
    this.effectsSystem.reset();
  }

  // === ABILITY EFFECTS ===

  /**
   * Create visual effect for ability use — distinct per AbilityType so players
   * can read boss/elite telegraphs at a glance.
   */
  public createAbilityEffect(position: { x: number; y: number }, abilityType: AbilityType): void {
    const pos: Vector2D = { x: position.x, y: position.y };

    switch (abilityType) {
      // --- Boss abilities ---
      case AbilityType.AREA_BUFF: {
        // Orange expanding ring
        const ring: EmitterConfig = {
          emissionRate: 0,
          burstCount: 16,
          duration: 50,
          spawnPosition: pos,
          spawnRadius: 5,
          spawnAngle: 0,
          spawnAngleVariation: Math.PI * 2,
          particleType: ParticleType.GLOW,
          particleLifetime: 700,
          particleLifetimeVariation: 100,
          initialSpeed: 60,
          initialSpeedVariation: 15,
          initialDirection: { x: 1, y: 0 },
          startSize: 4,
          endSize: 1,
          startColor: { r: 255, g: 165, b: 0, a: 1 },
          endColor: { r: 255, g: 100, b: 0, a: 0 },
          startOpacity: 0.9,
          endOpacity: 0,
          gravity: { x: 0, y: 0 },
          drag: 0.03,
          blendMode: BlendMode.ADDITIVE,
          layer: 4,
        };
        this.effectsSystem.createCustomEffect(pos, [ring], 800, { type: 'ability', ability: abilityType });
        break;
      }

      case AbilityType.AREA_HEAL: {
        // Green particles radiating outward
        const heal: EmitterConfig = {
          emissionRate: 0,
          burstCount: 14,
          duration: 50,
          spawnPosition: pos,
          spawnRadius: 8,
          spawnAngle: 0,
          spawnAngleVariation: Math.PI * 2,
          particleType: ParticleType.GLOW,
          particleLifetime: 900,
          particleLifetimeVariation: 200,
          initialSpeed: 40,
          initialSpeedVariation: 15,
          initialDirection: { x: 0, y: -1 },
          startSize: 3,
          endSize: 5,
          startColor: { r: 50, g: 255, b: 80, a: 1 },
          endColor: { r: 150, g: 255, b: 150, a: 0 },
          startOpacity: 0.9,
          endOpacity: 0,
          gravity: { x: 0, y: -20 },
          drag: 0.02,
          blendMode: BlendMode.ADDITIVE,
          layer: 3,
        };
        this.effectsSystem.createCustomEffect(pos, [heal], 1000, { type: 'ability', ability: abilityType });
        break;
      }

      case AbilityType.SHIELD_GENERATION: {
        // Blue shimmer burst
        const shield: EmitterConfig = {
          emissionRate: 0,
          burstCount: 12,
          duration: 50,
          spawnPosition: pos,
          spawnRadius: 6,
          spawnAngle: 0,
          spawnAngleVariation: Math.PI * 2,
          particleType: ParticleType.GLOW,
          particleLifetime: 600,
          particleLifetimeVariation: 100,
          initialSpeed: 35,
          initialSpeedVariation: 10,
          initialDirection: { x: 1, y: 0 },
          startSize: 3,
          endSize: 1,
          startColor: { r: 80, g: 160, b: 255, a: 1 },
          endColor: { r: 50, g: 120, b: 255, a: 0 },
          startOpacity: 0.85,
          endOpacity: 0,
          gravity: { x: 0, y: 0 },
          drag: 0.04,
          blendMode: BlendMode.ADDITIVE,
          layer: 3,
        };
        this.effectsSystem.createCustomEffect(pos, [shield], 700, { type: 'ability', ability: abilityType });
        break;
      }

      case AbilityType.TENTACLE_GRAB: {
        // Red warning pulse — medium radius
        const grab: EmitterConfig = {
          emissionRate: 0,
          burstCount: 10,
          duration: 50,
          spawnPosition: pos,
          spawnRadius: 4,
          spawnAngle: 0,
          spawnAngleVariation: Math.PI * 2,
          particleType: ParticleType.GLOW,
          particleLifetime: 500,
          particleLifetimeVariation: 100,
          initialSpeed: 50,
          initialSpeedVariation: 15,
          initialDirection: { x: 1, y: 0 },
          startSize: 5,
          endSize: 2,
          startColor: { r: 255, g: 40, b: 40, a: 1 },
          endColor: { r: 200, g: 0, b: 0, a: 0 },
          startOpacity: 0.9,
          endOpacity: 0,
          gravity: { x: 0, y: 0 },
          drag: 0.05,
          blendMode: BlendMode.ADDITIVE,
          layer: 4,
        };
        this.effectsSystem.createCustomEffect(pos, [grab], 600, { type: 'ability', ability: abilityType });
        break;
      }

      // --- Enemy abilities ---
      case AbilityType.BURST_FIRE: {
        // Bright red flash
        this.effectsSystem.createParticleEffect(EffectType.ENEMY_EXPLOSION, pos, 8, 12, 350, {
          intensity: 0.8,
          type: 'ability',
        });
        break;
      }

      case AbilityType.CHARGE_ATTACK: {
        // Yellow trail — large burst
        const charge: EmitterConfig = {
          emissionRate: 0,
          burstCount: 14,
          duration: 50,
          spawnPosition: pos,
          spawnRadius: 6,
          spawnAngle: 0,
          spawnAngleVariation: Math.PI * 2,
          particleType: ParticleType.TRAIL,
          particleLifetime: 600,
          particleLifetimeVariation: 150,
          initialSpeed: 70,
          initialSpeedVariation: 25,
          initialDirection: { x: 1, y: 0 },
          startSize: 5,
          endSize: 1,
          startColor: { r: 255, g: 230, b: 50, a: 1 },
          endColor: { r: 255, g: 180, b: 0, a: 0 },
          startOpacity: 0.9,
          endOpacity: 0,
          gravity: { x: 0, y: 0 },
          drag: 0.03,
          blendMode: BlendMode.ADDITIVE,
          layer: 4,
        };
        this.effectsSystem.createCustomEffect(pos, [charge], 700, { type: 'ability', ability: abilityType });
        break;
      }

      case AbilityType.ENRAGE: {
        // Deep red expanding aura — slower, larger
        const enrage: EmitterConfig = {
          emissionRate: 0,
          burstCount: 18,
          duration: 100,
          spawnPosition: pos,
          spawnRadius: 10,
          spawnAngle: 0,
          spawnAngleVariation: Math.PI * 2,
          particleType: ParticleType.GLOW,
          particleLifetime: 1000,
          particleLifetimeVariation: 200,
          initialSpeed: 25,
          initialSpeedVariation: 10,
          initialDirection: { x: 1, y: 0 },
          startSize: 5,
          endSize: 8,
          startColor: { r: 180, g: 0, b: 0, a: 1 },
          endColor: { r: 120, g: 0, b: 0, a: 0 },
          startOpacity: 0.85,
          endOpacity: 0,
          gravity: { x: 0, y: 0 },
          drag: 0.01,
          blendMode: BlendMode.ADDITIVE,
          layer: 3,
        };
        this.effectsSystem.createCustomEffect(pos, [enrage], 1100, { type: 'ability', ability: abilityType });
        break;
      }

      case AbilityType.SHELL_RETREAT: {
        // Gray shield particles
        const shell: EmitterConfig = {
          emissionRate: 0,
          burstCount: 10,
          duration: 50,
          spawnPosition: pos,
          spawnRadius: 6,
          spawnAngle: 0,
          spawnAngleVariation: Math.PI * 2,
          particleType: ParticleType.SMOKE,
          particleLifetime: 600,
          particleLifetimeVariation: 100,
          initialSpeed: 30,
          initialSpeedVariation: 10,
          initialDirection: { x: 1, y: 0 },
          startSize: 4,
          endSize: 2,
          startColor: { r: 180, g: 180, b: 190, a: 0.9 },
          endColor: { r: 120, g: 120, b: 130, a: 0 },
          startOpacity: 0.8,
          endOpacity: 0,
          gravity: { x: 0, y: 0 },
          drag: 0.04,
          blendMode: BlendMode.NORMAL,
          layer: 3,
        };
        this.effectsSystem.createCustomEffect(pos, [shell], 700, { type: 'ability', ability: abilityType });
        break;
      }

      case AbilityType.CLAW_SLAM: {
        // White impact flash
        const slam: EmitterConfig = {
          emissionRate: 0,
          burstCount: 12,
          duration: 50,
          spawnPosition: pos,
          spawnRadius: 4,
          spawnAngle: 0,
          spawnAngleVariation: Math.PI * 2,
          particleType: ParticleType.SPARK,
          particleLifetime: 400,
          particleLifetimeVariation: 80,
          initialSpeed: 60,
          initialSpeedVariation: 20,
          initialDirection: { x: 1, y: 0 },
          startSize: 4,
          endSize: 0,
          startColor: { r: 255, g: 255, b: 255, a: 1 },
          endColor: { r: 200, g: 200, b: 220, a: 0 },
          startOpacity: 1,
          endOpacity: 0,
          gravity: { x: 0, y: 30 },
          drag: 0.06,
          blendMode: BlendMode.ADDITIVE,
          layer: 5,
        };
        this.effectsSystem.createCustomEffect(pos, [slam], 500, { type: 'ability', ability: abilityType });
        break;
      }

      case AbilityType.POISON_CLOUD: {
        // Green-toned slow lingering cloud burst
        const cloud: EmitterConfig = {
          emissionRate: 0,
          burstCount: 14,
          duration: 80,
          spawnPosition: pos,
          spawnRadius: 12,
          spawnAngle: 0,
          spawnAngleVariation: Math.PI * 2,
          particleType: ParticleType.SMOKE,
          particleLifetime: 1400,
          particleLifetimeVariation: 400,
          initialSpeed: 15,
          initialSpeedVariation: 8,
          initialDirection: { x: 0, y: -1 },
          startSize: 8,
          endSize: 14,
          startColor: { r: 40, g: 200, b: 60, a: 0.55 },
          endColor: { r: 20, g: 120, b: 30, a: 0 },
          startOpacity: 0.55,
          endOpacity: 0,
          gravity: { x: 0, y: -8 },
          drag: 0.02,
          blendMode: BlendMode.ADDITIVE,
          layer: 3,
        };
        this.effectsSystem.createCustomEffect(pos, [cloud], 1500, { type: 'ability', ability: abilityType });
        break;
      }

      case AbilityType.TELEPORT_BLINK: {
        // Cyan implosion shimmer — particles converge inward
        const shimmer: EmitterConfig = {
          emissionRate: 0,
          burstCount: 16,
          duration: 50,
          spawnPosition: pos,
          spawnRadius: 20,
          spawnAngle: 0,
          spawnAngleVariation: Math.PI * 2,
          particleType: ParticleType.GLOW,
          particleLifetime: 350,
          particleLifetimeVariation: 100,
          initialSpeed: -30, // negative = inward implosion
          initialSpeedVariation: 10,
          initialDirection: { x: 0, y: 1 },
          startSize: 3,
          endSize: 0,
          startColor: { r: 0, g: 230, b: 255, a: 1 },
          endColor: { r: 80, g: 200, b: 255, a: 0 },
          startOpacity: 0.9,
          endOpacity: 0,
          gravity: { x: 0, y: 0 },
          drag: 0.08,
          blendMode: BlendMode.ADDITIVE,
          layer: 5,
        };
        this.effectsSystem.createCustomEffect(pos, [shimmer], 400, { type: 'ability', ability: abilityType });
        break;
      }

      case AbilityType.LURE_STUN:
      case AbilityType.PREDICTION_SHOT:
      default: {
        // Generic small explosion fallback
        this.createEnemyExplosion(pos, 0.5);
        break;
      }
    }
  }

  /**
   * Create buff visual effect with buff-type-specific colors.
   */
  public createBuffEffect(position: { x: number; y: number }, buffType: string): void {
    const pos: Vector2D = { x: position.x, y: position.y };

    let color: Color;
    switch (buffType) {
      case 'ability':
        color = { r: 0, g: 255, b: 255, a: 1 }; // cyan
        break;
      case 'damage':
        color = { r: 255, g: 60, b: 60, a: 1 }; // red
        break;
      case 'speed':
        color = { r: 60, g: 120, b: 255, a: 1 }; // blue
        break;
      case 'shield':
        color = { r: 255, g: 230, b: 50, a: 1 }; // yellow
        break;
      case 'heal':
        color = { r: 50, g: 255, b: 80, a: 1 }; // green
        break;
      default:
        color = { r: 255, g: 255, b: 255, a: 1 }; // white
        break;
    }

    const buff: EmitterConfig = {
      emissionRate: 0,
      burstCount: 8,
      duration: 50,
      spawnPosition: pos,
      spawnRadius: 5,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.GLOW,
      particleLifetime: 500,
      particleLifetimeVariation: 100,
      initialSpeed: 30,
      initialSpeedVariation: 10,
      initialDirection: { x: 1, y: 0 },
      startSize: 3,
      endSize: 1,
      startColor: color,
      endColor: { ...color, a: 0 },
      startOpacity: 0.8,
      endOpacity: 0,
      gravity: { x: 0, y: 0 },
      drag: 0.04,
      blendMode: BlendMode.ADDITIVE,
      layer: 3,
    };

    this.effectsSystem.createCustomEffect(pos, [buff], 600, { type: 'buff', buffType });
  }

  /**
   * Create heal visual effect (simple version for abilities)
   */
  public createHealEffectSimple(position: { x: number; y: number }): void {
    this.createBuffEffect(position, 'heal');
  }

  /**
   * Create shield visual effect
   */
  public createShieldEffect(position: { x: number; y: number }): void {
    this.createBuffEffect(position, 'shield');
  }

  /**
   * Create grab effect line
   */
  public createGrabEffect(from: { x: number; y: number }, to: { x: number; y: number }): void {
    // Create particles along the line
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pos = {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      };
      this.createEnemyExplosion(pos, 0.2);
    }
  }

  /**
   * Create poison cloud entity (handled by game systems)
   */
  public createPoisonCloud(x: number, y: number): number {
    // This would create an actual entity with damage over time
    // For now, just create a visual effect
    this.createBuffEffect({ x, y }, 'poison');
    return -1; // Placeholder entity ID
  }

  /**
   * Create burst fire effect
   */
  public createBurstEffect(position: { x: number; y: number }): void {
    // Create burst visual using explosion effect
    this.createEnemyExplosion(position, 0.3);
  }

  /**
   * Create shell retreat effect
   */
  public createShellEffect(position: { x: number; y: number }): void {
    this.createShieldEffect(position);
  }

  /**
   * Create charge attack effect
   */
  public createChargeEffect(from: { x: number; y: number }, to: { x: number; y: number }): void {
    this.createGrabEffect(from, to);
  }

  /**
   * Create slam effect
   */
  public createSlamEffect(position: { x: number; y: number }, radius: number): void {
    // Create expanding ring effect
    // Create shockwave using explosion effect
    this.createEnemyExplosion(position, radius / 50);
  }

  /**
   * Create enrage effect
   */
  public createEnrageEffect(position: { x: number; y: number }): void {
    this.createBuffEffect(position, 'damage');
  }

  /**
   * Create a boss phase transition effect - expanding ring with color intensity based on phase.
   * Phase 2 = orange, Phase 3 = red-orange, Phase 4 = deep red.
   */
  public createPhaseTransitionEffect(position: { x: number; y: number }, phase: number): void {
    const pos: Vector2D = { x: position.x, y: position.y };

    // Color intensifies with each phase
    const phaseColors: Color[] = [
      { r: 255, g: 180, b: 50, a: 1 }, // Phase 2: orange
      { r: 255, g: 80, b: 30, a: 1 }, // Phase 3: red-orange
      { r: 255, g: 30, b: 30, a: 1 }, // Phase 4: deep red
    ];
    const color = phaseColors[Math.min(phase - 2, phaseColors.length - 1)] ?? phaseColors[0];

    // Expanding shockwave ring
    const shockwave: EmitterConfig = {
      emissionRate: 0,
      burstCount: 20 + phase * 5,
      duration: 50,
      spawnPosition: pos,
      spawnRadius: 10,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.GLOW,
      particleLifetime: 800,
      particleLifetimeVariation: 200,
      initialSpeed: 60 + phase * 20,
      initialSpeedVariation: 15,
      initialDirection: { x: 1, y: 0 },
      startSize: 4 + phase,
      endSize: 1,
      startColor: color,
      endColor: { ...color, a: 0 },
      startOpacity: 1.0,
      endOpacity: 0,
      gravity: { x: 0, y: 0 },
      drag: 0.03,
      blendMode: BlendMode.ADDITIVE,
      layer: 4,
    };

    this.effectsSystem.createCustomEffect(pos, [shockwave], 1000, {
      type: 'boss_phase_transition',
      phase,
    });
  }

  // === NPC FACTION COMBAT EFFECTS ===

  /**
   * Convert hex color string to rgb() format for floating text.
   * FloatingTextComponent parses this at creation time to avoid string manipulation in render loop.
   */
  private hexToRgb(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${r}, ${g}, ${b})`;
  }

  /**
   * Convert hex color string to Color type for emitter configs.
   */
  private hexToColor(hex: string): Color {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
      a: 1,
    };
  }

  /**
   * NPC-vs-NPC damage number — smaller, transparent, faction-colored.
   * Uses attacker's faction primary color in rgb() format for proper opacity fading.
   * No accompanying particle burst (keeps NPC combat visually subordinate to player combat).
   */
  public createNpcDamageNumber(position: Vector2D, damage: number, factionHexColor: string): string {
    const config = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.VISUAL;
    const smartResult = this.getSmartDamageNumberPosition(position.x, position.y, false);
    if (!smartResult) {
      return ''; // Spatially suppressed
    }
    const { pos: smartPos, velocityModX } = smartResult;

    const entity = this.entityManager.createEntity();
    this.entityManager.addComponent(entity, new PositionComponent(smartPos.x, smartPos.y));

    const smartVelocityX = velocityModX + (Math.random() - 0.5) * 8;
    const smartVelocityY = config.DAMAGE_NUMBER_VELOCITY_Y_MIN - Math.random() * config.DAMAGE_NUMBER_VELOCITY_Y_RANGE;

    this.entityManager.addComponent(entity, new VelocityComponent(smartVelocityX, smartVelocityY));

    const roundedDamage = Math.round(damage);
    this.entityManager.addComponent(
      entity,
      new FloatingTextComponent(
        `${roundedDamage}`, // text
        this.hexToRgb(factionHexColor), // color in rgb() for opacity support
        config.DAMAGE_NUMBER_FONT_SIZE, // 11px (70% of normal 16px)
        config.DAMAGE_NUMBER_DURATION_MS, // 800ms
        undefined, // startTime (default = now)
        0, // offsetX
        -15, // offsetY (above entity)
        smartVelocityX, // velocityX
        smartVelocityY, // velocityY
        config.DAMAGE_NUMBER_FADE_START, // 0.5 (earlier fade)
        1.0 // scale
      )
    );

    return entity.toString();
  }

  /**
   * Clash sparks at midpoint between NPC attacker and target.
   * Small particle burst in attacker's faction color.
   */
  public createNpcClashSparks(position: Vector2D, factionHexColor: string): string {
    const config = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.VISUAL;
    const color = this.hexToColor(factionHexColor);
    const sparkCount =
      config.CLASH_SPARK_COUNT_MIN +
      Math.floor(Math.random() * (config.CLASH_SPARK_COUNT_MAX - config.CLASH_SPARK_COUNT_MIN + 1));

    const sparkEmitter: EmitterConfig = {
      emissionRate: 0,
      burstCount: sparkCount,
      duration: 50,
      spawnPosition: position,
      spawnRadius: 4,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.SPARK,
      particleLifetime: config.CLASH_SPARK_LIFETIME_MS,
      particleLifetimeVariation: 50,
      initialSpeed: config.CLASH_SPARK_SPEED,
      initialSpeedVariation: 25,
      initialDirection: { x: 0, y: 0 },
      gravity: { x: 0, y: 30 },
      drag: 0.08,
      startSize: 2.5,
      endSize: 0,
      startColor: { ...color, a: 0.9 },
      endColor: { ...color, a: 0 },
      startOpacity: 0.9,
      endOpacity: 0,
      blendMode: BlendMode.ADDITIVE,
      layer: 5,
    };

    return this.effectsSystem.createEmitter(sparkEmitter);
  }

  /**
   * NPC kill death effect — faction-colored variant of enemy death pop.
   */
  public createNpcDeathEffect(position: Vector2D, factionHexColor: string): string {
    const config = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.VISUAL;
    const color = this.hexToColor(factionHexColor);

    const deathBurst: EmitterConfig = {
      emissionRate: 0,
      burstCount: config.DEATH_PARTICLE_COUNT,
      duration: 50,
      spawnPosition: position,
      spawnRadius: 5,
      spawnAngle: 0,
      spawnAngleVariation: Math.PI * 2,
      particleType: ParticleType.ENEMY_DEATH,
      particleLifetime: config.DEATH_PARTICLE_LIFETIME_MS,
      particleLifetimeVariation: 100,
      initialSpeed: 10,
      initialSpeedVariation: 8,
      initialDirection: { x: 0, y: 0 },
      gravity: { x: 0, y: 40 },
      drag: 0.08,
      startSize: 4,
      endSize: 0,
      startColor: color,
      endColor: { ...color, a: 0 },
      startOpacity: 0.8,
      endOpacity: 0,
      blendMode: BlendMode.ADDITIVE,
      layer: 5,
    };

    return this.effectsSystem.createEmitter(deathBurst);
  }

  /**
   * Shield Breaker hit label — "+SHIELD BREAK" floating text above an elite enemy.
   * Called whenever a beam or projectile hit triggers the Shield Breaker 3x multiplier.
   */
  public createShieldBreakLabel(position: Vector2D): void {
    const entity = this.entityManager.createEntity();
    this.entityManager.addComponent(entity, new PositionComponent(position.x, position.y));

    const velocityX = (Math.random() - 0.5) * 10;
    const velocityY = -50 - Math.random() * 15;
    this.entityManager.addComponent(entity, new VelocityComponent(velocityX, velocityY));

    // Theme-aware orange: bright orange in dark mode, dark orange-brown in light mode for cream bg
    const shieldBreakColor = this.themeService.isDayMode ? 'rgb(194, 65, 12)' : 'rgb(255, 140, 0)';

    this.entityManager.addComponent(
      entity,
      new FloatingTextComponent(
        '+SHIELD BREAK', // text
        shieldBreakColor, // orange (theme-aware)
        13, // fontSize — slightly larger than shard pickup, smaller than crits
        900, // duration ms
        undefined, // startTime (default = now)
        0, // offsetX
        -30, // offsetY — appear above the enemy
        velocityX, // velocityX
        velocityY, // velocityY
        0.6, // fadeStart
        1.1 // scale
      )
    );
  }

  /**
   * Gold "+X XP" floating text shown on enemy kill.
   * Floats upward and fades out — distinct from damage numbers and shards.
   */
  public createXpText(position: Vector2D, xpAmount: number): void {
    if (xpAmount <= 0) return;

    const entity = this.entityManager.createEntity();

    const offsetX = (Math.random() - 0.5) * 24;
    const velocityX = (Math.random() - 0.5) * 12;
    const velocityY = -38 - Math.random() * 12;

    this.entityManager.addComponent(entity, new PositionComponent(position.x, position.y));
    this.entityManager.addComponent(entity, new VelocityComponent(velocityX, velocityY));

    // Theme-aware gold: bright gold in dark mode, dark amber-gold in light mode for cream bg
    const xpColor = this.themeService.isDayMode ? 'rgb(161, 98, 7)' : 'rgb(255, 215, 0)';
    this.entityManager.addComponent(
      entity,
      new FloatingTextComponent(
        `+${xpAmount} XP`, // text
        xpColor, // gold (theme-aware)
        11, // fontSize — slightly smaller than damage numbers
        900, // duration ms
        undefined, // startTime (default = now)
        offsetX, // offsetX
        -15, // offsetY (start above entity)
        velocityX, // velocityX
        velocityY, // velocityY
        0.55, // fadeStart (slightly earlier fade for subtlety)
        1.0 // scale
      )
    );
  }
}
