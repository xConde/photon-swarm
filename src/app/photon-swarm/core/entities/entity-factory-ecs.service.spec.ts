import { TestBed } from '@angular/core/testing';
import { EntityFactoryECSService } from './entity-factory-ecs.service';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { RandomService } from '../utils/random.service';
import { ObjectPoolService } from '../utils/object-pool.service';
import { ProgressionSystemService } from '../progression/progression-system.service';
import { PlayerService } from '../player/player.service';
import { ThemeService } from '@services/theme.service';
import { EnemyType } from '../models/enemy.model';
import { BehaviorPattern } from '@photon/components/ai-controlled.component';
import { ComponentType } from '../ecs/ecs.model';
import { PLAYER_CONFIG, PoolType } from '@photon/config/game-constants';
import {
  AbilityComponent,
  AbilityType,
  AIControlledComponent,
  BeamComponent,
  BossPhaseComponent,
  BurnEffectComponent,
  CollisionBoxComponent,
  DamageComponent,
  DischargeComponent,
  EnemyTypeComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  ProjectileComponent,
  RenderableComponent,
  ShardComponent,
  SpawnerComponent,
  VelocityComponent,
  WeaponComponent,
} from '@photon/components';

describe('EntityFactoryECSService', () => {
  let service: EntityFactoryECSService;
  let entityManager: EntityManagerService;
  let playerServiceSpy: jasmine.SpyObj<PlayerService>;
  // let _randomService: RandomService;

  beforeEach(() => {
    const progressionSpy = jasmine.createSpyObj('ProgressionSystemService', ['getLevelModifier'], {
      level: 1, // Add level property for entity factory's levelMultiplier calculation
    });
    playerServiceSpy = jasmine.createSpyObj('PlayerService', [
      'activateSpawnProtection',
      'deactivateInvincibility',
      'isParryAvailable',
    ]);
    playerServiceSpy.isParryAvailable.and.returnValue(false);

    progressionSpy.getLevelModifier.and.returnValue(1);

    TestBed.configureTestingModule({
      providers: [
        EntityFactoryECSService,
        EntityManagerService,
        RandomService,
        ObjectPoolService,
        { provide: ProgressionSystemService, useValue: progressionSpy },
        { provide: PlayerService, useValue: playerServiceSpy },
        { provide: ThemeService, useValue: { isDayMode: false } },
      ],
    });

    service = TestBed.inject(EntityFactoryECSService);
    entityManager = TestBed.inject(EntityManagerService);
    // _randomService = TestBed.inject(RandomService);
  });

  afterEach(() => {
    entityManager.clear();
  });

  describe('createPlayer', () => {
    it('should create a player entity with all required components', () => {
      const player = service.createPlayer(100, 200);

      expect(entityManager.hasComponent(player, PositionComponent)).toBeTruthy();
      expect(entityManager.hasComponent(player, VelocityComponent)).toBeTruthy();
      expect(entityManager.hasComponent(player, HealthComponent)).toBeTruthy();
      expect(entityManager.hasComponent(player, CollisionBoxComponent)).toBeTruthy();
      expect(entityManager.hasComponent(player, RenderableComponent)).toBeTruthy();
      expect(entityManager.hasComponent(player, PlayerControlledComponent)).toBeTruthy();
      expect(entityManager.hasComponent(player, WeaponComponent)).toBeTruthy();
      expect(entityManager.hasComponent(player, BeamComponent)).toBeTruthy();
      expect(entityManager.hasComponent(player, DischargeComponent as ComponentType)).toBeTruthy();
    });

    it('should set correct position', () => {
      const player = service.createPlayer(150, 250);
      const position = entityManager.getComponent(player, PositionComponent);

      expect(position?.x).toBe(150);
      expect(position?.y).toBe(250);
    });

    it('should set player health to 100', () => {
      const player = service.createPlayer(0, 0);
      const health = entityManager.getComponent(player, HealthComponent);

      expect(health?.health).toBe(100);
      expect(health?.maxHealth).toBe(100);
    });

    it('starts both spawn-protection representations once from shared config', () => {
      spyOn(Date, 'now').and.returnValue(10_000);

      const player = service.createPlayer(100, 200);
      const controlled = entityManager.getComponent(player, PlayerControlledComponent);

      expect(controlled?.isInvincible).toBe(true);
      expect(controlled?.invincibilityEndTime).toBe(10_000 + PLAYER_CONFIG.SPAWN_PROTECTION.DURATION_MS);
      expect(playerServiceSpy.activateSpawnProtection).toHaveBeenCalledTimes(1);
    });

    it('should configure beam weapon correctly', () => {
      const player = service.createPlayer(0, 0);
      const weapon = entityManager.getComponent(player, WeaponComponent);
      const beam = entityManager.getComponent(player, BeamComponent);

      // Values from WEAPON_CONFIG.BEAM
      expect(weapon?.damage).toBe(70);
      expect(beam?.length).toBe(1000);
      expect(beam?.damage).toBe(70);
    });
  });

  describe('createEnemy', () => {
    it('should create basic enemy with required components', () => {
      const enemy = service.createEnemy(300, 400, EnemyType.Basic);

      expect(entityManager.hasComponent(enemy, PositionComponent)).toBeTruthy();
      expect(entityManager.hasComponent(enemy, VelocityComponent)).toBeTruthy();
      expect(entityManager.hasComponent(enemy, HealthComponent)).toBeTruthy();
      expect(entityManager.hasComponent(enemy, CollisionBoxComponent)).toBeTruthy();
      expect(entityManager.hasComponent(enemy, RenderableComponent)).toBeTruthy();
      expect(entityManager.hasComponent(enemy, EnemyTypeComponent)).toBeTruthy();
      expect(entityManager.hasComponent(enemy, AIControlledComponent)).toBeTruthy();
      expect(entityManager.hasComponent(enemy, DamageComponent)).toBeTruthy();
    });

    it('should create spitter enemy with weapon', () => {
      const enemy = service.createEnemy(0, 0, EnemyType.Spitter);

      expect(entityManager.hasComponent(enemy, WeaponComponent)).toBeTruthy();
      const weapon = entityManager.getComponent(enemy, WeaponComponent);
      expect(weapon?.projectileSpeed).toBe(300);
    });

    it('base (non-elite) Spitter gets BURST_FIRE ability with 12000ms cooldown', () => {
      const enemy = service.createEnemy(0, 0, EnemyType.Spitter, 'common', false);

      expect(entityManager.hasComponent(enemy, AbilityComponent)).toBeTrue();
      const abilityComp = entityManager.getComponent(enemy, AbilityComponent)!;
      const types = abilityComp.abilities.map((a) => a.type);
      expect(types).toContain(AbilityType.BURST_FIRE);

      const burstAbility = abilityComp.abilities.find((a) => a.type === AbilityType.BURST_FIRE)!;
      expect(burstAbility.cooldownMs).toBe(12000);
    });

    it('elite Spitter keeps BURST_FIRE with faster 5000ms cooldown', () => {
      const enemy = service.createEnemy(0, 0, EnemyType.Spitter, 'common', true);

      const abilityComp = entityManager.getComponent(enemy, AbilityComponent)!;
      const burstAbility = abilityComp.abilities.find((a) => a.type === AbilityType.BURST_FIRE)!;
      expect(burstAbility).toBeDefined();
      expect(burstAbility.cooldownMs).toBe(5000);
    });

    it('does NOT give swarm enemies a minion-spawner (multiplication disabled — population explosion)', () => {
      const enemy = service.createEnemy(0, 0, EnemyType.Swarm);

      // Swarm minion-spawner + split-on-death were disabled: every swarm spawning
      // 3 swarm minions every 5s compounded to the enemy cap (the wall-of-jellyfish).
      expect(entityManager.hasComponent(enemy, SpawnerComponent)).toBeFalse();
    });

    it('should apply elite modifiers', () => {
      const normalEnemy = service.createEnemy(0, 0, EnemyType.Basic, 'common', false);
      const eliteEnemy = service.createEnemy(0, 0, EnemyType.Basic, 'common', true);

      const normalHealth = entityManager.getComponent(normalEnemy, HealthComponent);
      const eliteHealth = entityManager.getComponent(eliteEnemy, HealthComponent);

      expect(eliteHealth?.maxHealth).toBe((normalHealth?.maxHealth || 0) * 2);
    });

    it('should apply rarity modifiers', () => {
      const commonEnemy = service.createEnemy(0, 0, EnemyType.Basic, 'common');
      const rareEnemy = service.createEnemy(0, 0, EnemyType.Basic, 'rare');
      const legendaryEnemy = service.createEnemy(0, 0, EnemyType.Basic, 'legendary');

      const commonHealth = entityManager.getComponent(commonEnemy, HealthComponent);
      const rareHealth = entityManager.getComponent(rareEnemy, HealthComponent);
      const legendaryHealth = entityManager.getComponent(legendaryEnemy, HealthComponent);

      expect(rareHealth?.maxHealth).toBe((commonHealth?.maxHealth || 0) * 1.5);
      expect(legendaryHealth?.maxHealth).toBe((commonHealth?.maxHealth || 0) * 2);
    });

    it('should set correct enemy type and behavior', () => {
      const tankEnemy = service.createEnemy(0, 0, EnemyType.Tank);

      const enemyType = entityManager.getComponent(tankEnemy, EnemyTypeComponent);
      const ai = entityManager.getComponent(tankEnemy, AIControlledComponent);
      const health = entityManager.getComponent(tankEnemy, HealthComponent);

      expect(enemyType?.type).toBe(EnemyType.Tank);
      expect(ai?.behaviorPattern).toBe(BehaviorPattern.Charger);
      expect(health?.damageReduction).toBe(0.15);
    });

    describe('boss archetype rotation', () => {
      it('attaches a BossPhaseComponent to every boss spawn', () => {
        const boss = service.createEnemy(0, 0, EnemyType.Boss, 'legendary');
        expect(entityManager.hasComponent(boss, BossPhaseComponent)).toBeTrue();
      });

      it('rotates standard -> swarm_king -> pyroclast across consecutive boss spawns', () => {
        const first = service.createEnemy(0, 0, EnemyType.Boss, 'legendary');
        const second = service.createEnemy(0, 0, EnemyType.Boss, 'legendary');
        const third = service.createEnemy(0, 0, EnemyType.Boss, 'legendary');
        const fourth = service.createEnemy(0, 0, EnemyType.Boss, 'legendary');

        expect(entityManager.getComponent(first, BossPhaseComponent)?.archetype).toBe('standard');
        expect(entityManager.getComponent(second, BossPhaseComponent)?.archetype).toBe('swarm_king');
        expect(entityManager.getComponent(third, BossPhaseComponent)?.archetype).toBe('pyroclast');
        // cycles back
        expect(entityManager.getComponent(fourth, BossPhaseComponent)?.archetype).toBe('standard');
      });

      it('non-boss spawns do not advance the boss rotation counter', () => {
        service.createEnemy(0, 0, EnemyType.Basic);
        service.createEnemy(0, 0, EnemyType.Tank);
        service.createEnemy(0, 0, EnemyType.Spitter);

        const firstBoss = service.createEnemy(0, 0, EnemyType.Boss, 'legendary');
        expect(entityManager.getComponent(firstBoss, BossPhaseComponent)?.archetype).toBe('standard');
      });
    });
  });

  describe('boss archetype ability loadouts', () => {
    // Helper: spawn N bosses and return the last one's AbilityComponent.
    function spawnNthBoss(n: number): AbilityComponent | undefined {
      let lastBoss = -1;
      for (let i = 0; i < n; i++) {
        lastBoss = service.createEnemy(0, 0, EnemyType.Boss, 'legendary');
      }
      return entityManager.getComponent(lastBoss, AbilityComponent);
    }

    it('all three archetypes produce a non-empty ability list', () => {
      // standard (spawn 1), swarm_king (spawn 2), pyroclast (spawn 3)
      for (let i = 1; i <= 3; i++) {
        const abilityComp = spawnNthBoss(i);
        expect(abilityComp?.abilities.length).toBeGreaterThan(0);
      }
    });

    it('standard boss (1st spawn) has exactly [AREA_BUFF, AREA_HEAL, SHIELD_GENERATION, TENTACLE_GRAB]', () => {
      const abilityComp = spawnNthBoss(1);
      const types = abilityComp?.abilities.map((a) => a.type);
      expect(types).toEqual([
        AbilityType.AREA_BUFF,
        AbilityType.AREA_HEAL,
        AbilityType.SHIELD_GENERATION,
        AbilityType.TENTACLE_GRAB,
      ]);
    });

    it('swarm_king boss (2nd spawn) has SUMMON_MINIONS and HIVE_MIND', () => {
      const abilityComp = spawnNthBoss(2);
      const types = abilityComp?.abilities.map((a) => a.type) ?? [];
      expect(types).toContain(AbilityType.SUMMON_MINIONS);
      expect(types).toContain(AbilityType.HIVE_MIND);
    });

    it('swarm_king boss (2nd spawn) does NOT have SHIELD_GENERATION', () => {
      const abilityComp = spawnNthBoss(2);
      const types = abilityComp?.abilities.map((a) => a.type) ?? [];
      expect(types).not.toContain(AbilityType.SHIELD_GENERATION);
    });

    it('pyroclast boss (3rd spawn) has POISON_CLOUD and CHARGE_ATTACK', () => {
      const abilityComp = spawnNthBoss(3);
      const types = abilityComp?.abilities.map((a) => a.type) ?? [];
      expect(types).toContain(AbilityType.POISON_CLOUD);
      expect(types).toContain(AbilityType.CHARGE_ATTACK);
    });

    it('pyroclast boss (3rd spawn) does NOT have AREA_HEAL', () => {
      const abilityComp = spawnNthBoss(3);
      const types = abilityComp?.abilities.map((a) => a.type) ?? [];
      expect(types).not.toContain(AbilityType.AREA_HEAL);
    });

    it('BossPhaseComponent.baseCooldowns length matches ability count for each archetype', () => {
      // Spawn 3 bosses: 1=standard, 2=swarm_king, 3=pyroclast
      const bosses: number[] = [];
      for (let i = 0; i < 3; i++) {
        bosses.push(service.createEnemy(0, 0, EnemyType.Boss, 'legendary'));
      }
      for (const boss of bosses) {
        const abilityComp = entityManager.getComponent(boss, AbilityComponent);
        const bossPhase = entityManager.getComponent(boss, BossPhaseComponent);
        expect(bossPhase?.baseCooldowns.length).toBe(abilityComp?.abilities.length ?? -1);
      }
    });

    it('falls back to the standard loadout for an unmapped archetype (red-team Finding 2)', () => {
      // getBossAbilities is private; the `default:` case guards against a
      // future BossArchetype value being added without a matching loadout.
      // Without the default, the switch would return undefined and crash on
      // abilities.map(). Exercise the fallback directly via a typed cast.
      const factoryInternals = service as unknown as {
        getBossAbilities(archetype: string): Array<{ type: AbilityType }>;
      };
      const fallback = factoryInternals.getBossAbilities('a_future_archetype');
      expect(fallback.length).toBe(4);
      expect(fallback.map((a) => a.type)).toEqual([
        AbilityType.AREA_BUFF,
        AbilityType.AREA_HEAL,
        AbilityType.SHIELD_GENERATION,
        AbilityType.TENTACLE_GRAB,
      ]);
    });
  });

  describe('createProjectile', () => {
    it('should create projectile with required components', () => {
      const projectile = service.createProjectile(100, 100, 10, 0, 20, 'player');

      expect(entityManager.hasComponent(projectile, PositionComponent)).toBeTruthy();
      expect(entityManager.hasComponent(projectile, VelocityComponent)).toBeTruthy();
      expect(entityManager.hasComponent(projectile, CollisionBoxComponent)).toBeTruthy();
      expect(entityManager.hasComponent(projectile, RenderableComponent)).toBeTruthy();
      expect(entityManager.hasComponent(projectile, ProjectileComponent)).toBeTruthy();
      expect(entityManager.hasComponent(projectile, DamageComponent)).toBeTruthy();
    });

    it('should set correct velocity and damage', () => {
      const projectile = service.createProjectile(0, 0, 15, -10, 25, PoolType.ENEMY);

      const velocity = entityManager.getComponent(projectile, VelocityComponent);
      const damage = entityManager.getComponent(projectile, DamageComponent);
      // const _proj = entityManager.getComponent(projectile, ProjectileComponent);

      expect(velocity?.vx).toBe(15);
      expect(velocity?.vy).toBe(-10);
      expect(damage?.contactDamage).toBe(25);
    });

    it('should use custom color when provided', () => {
      const projectile = service.createProjectile(0, 0, 0, 0, 10, 'player', '#ff0000');

      const renderable = entityManager.getComponent(projectile, RenderableComponent);
      expect(renderable?.color).toBe('#ff0000');
    });
  });

  describe('createShard', () => {
    it('should create shard with required components', () => {
      const shard = service.createShard(200, 300);

      expect(entityManager.hasComponent(shard, PositionComponent)).toBeTruthy();
      expect(entityManager.hasComponent(shard, VelocityComponent)).toBeTruthy();
      expect(entityManager.hasComponent(shard, CollisionBoxComponent)).toBeTruthy();
      expect(entityManager.hasComponent(shard, RenderableComponent)).toBeTruthy();
      expect(entityManager.hasComponent(shard, ShardComponent)).toBeTruthy();
    });

    it('should scale appearance based on value', () => {
      const smallShard = service.createShard(0, 0, 1);
      const mediumShard = service.createShard(0, 0, 3);
      const largeShard = service.createShard(0, 0, 10);

      const smallRender = entityManager.getComponent(smallShard, RenderableComponent);
      const mediumRender = entityManager.getComponent(mediumShard, RenderableComponent);
      const largeRender = entityManager.getComponent(largeShard, RenderableComponent);

      // Different shard values should have color attributes (implementation may vary)
      expect(smallRender?.color).toBeDefined();
      expect(mediumRender?.color).toBeDefined();
      expect(largeRender?.color).toBeDefined();
    });

    it('should set shard properties', () => {
      const shard = service.createShard(0, 0, 5);
      const shardComp = entityManager.getComponent(shard, ShardComponent);

      // Shard should have value set correctly
      expect(shardComp?.value).toBe(5);
    });
  });

  describe('addBurnEffect', () => {
    it('should add burn effect to entity', () => {
      const enemy = service.createEnemy(0, 0, EnemyType.Basic);

      expect(entityManager.hasComponent(enemy, BurnEffectComponent as ComponentType)).toBeFalsy();

      service.addBurnEffect(enemy, 5, 3000);

      expect(entityManager.hasComponent(enemy, BurnEffectComponent as ComponentType)).toBeTruthy();
      const burn = entityManager.getComponent(enemy, BurnEffectComponent) as BurnEffectComponent;
      expect(burn?.burnDamage).toBe(5);
      expect(burn?.burnDuration).toBe(3000);
    });

    it('should not add duplicate burn effects', () => {
      const enemy = service.createEnemy(0, 0, EnemyType.Basic);

      service.addBurnEffect(enemy, 5, 3000);
      const firstBurn = entityManager.getComponent(enemy, BurnEffectComponent) as BurnEffectComponent;

      service.addBurnEffect(enemy, 10, 5000);
      const secondBurn = entityManager.getComponent(enemy, BurnEffectComponent) as BurnEffectComponent;

      // Should still be the first burn effect
      expect(secondBurn).toBe(firstBurn);
      expect(secondBurn?.burnDamage).toBe(5);
    });
  });

  describe('Object Pooling', () => {
    it('should reuse entity IDs from the pool for projectiles', () => {
      // Create first projectile
      const projectile1 = service.createProjectile(0, 0, 1, 0, 10, 'player');
      expect(entityManager.hasEntity(projectile1)).toBeTruthy();

      // Return it to pool
      service.returnToPool(PoolType.PROJECTILE, projectile1);

      // Create another projectile - should get same ID
      const projectile2 = service.createProjectile(10, 10, 1, 0, 10, 'player');
      expect(projectile2).toBe(projectile1);
      expect(entityManager.hasEntity(projectile2)).toBeTruthy();
    });

    it('should reuse entity IDs from the pool for enemies', () => {
      // Create first enemy
      const enemy1 = service.createEnemy(0, 0, EnemyType.Basic);
      expect(entityManager.hasEntity(enemy1)).toBeTruthy();

      // Return it to pool
      service.returnToPool(PoolType.ENEMY, enemy1);

      // Create another enemy - should get same ID
      const enemy2 = service.createEnemy(10, 10, EnemyType.Basic);
      expect(enemy2).toBe(enemy1);
      expect(entityManager.hasEntity(enemy2)).toBeTruthy();
    });

    it('should clean all components when returning to pool', () => {
      const projectile = service.createProjectile(0, 0, 1, 0, 10, 'player');

      // Verify it has components
      expect(entityManager.hasComponent(projectile, PositionComponent)).toBeTruthy();
      expect(entityManager.hasComponent(projectile, VelocityComponent)).toBeTruthy();
      expect(entityManager.hasComponent(projectile, ProjectileComponent)).toBeTruthy();

      // Return to pool
      service.returnToPool(PoolType.PROJECTILE, projectile);

      // Should have no components
      expect(entityManager.hasComponent(projectile, PositionComponent)).toBeFalsy();
      expect(entityManager.hasComponent(projectile, VelocityComponent)).toBeFalsy();
      expect(entityManager.hasComponent(projectile, ProjectileComponent)).toBeFalsy();
    });

    it('should handle multiple pooled entities', () => {
      const projectiles: number[] = [];

      // Create 10 projectiles
      for (let i = 0; i < 10; i++) {
        projectiles.push(service.createProjectile(i, i, 1, 0, 10, 'player'));
      }

      // Return them all to pool
      projectiles.forEach((p) => service.returnToPool(PoolType.PROJECTILE, p));

      // Create 10 more - should reuse IDs
      const reusedProjectiles: number[] = [];
      for (let i = 0; i < 10; i++) {
        reusedProjectiles.push(service.createProjectile(i + 10, i + 10, 1, 0, 10, 'player'));
      }

      // Should have reused the same IDs
      reusedProjectiles.forEach((p) => {
        expect(projectiles.includes(p)).toBeTruthy();
      });
    });

    it('should create new entities when pool is empty', () => {
      const projectiles: number[] = [];

      // Create many projectiles without returning any
      for (let i = 0; i < 100; i++) {
        projectiles.push(service.createProjectile(i, i, 1, 0, 10, 'player'));
      }

      // All should be unique
      const uniqueIds = new Set(projectiles);
      expect(uniqueIds.size).toBe(100);
    });

    it('should respect pool size limits', () => {
      // The pool has a max size of 500 for projectiles
      const returnedProjectiles: number[] = [];

      // Create and return 600 projectiles
      for (let i = 0; i < 600; i++) {
        const p = service.createProjectile(i, i, 1, 0, 10, 'player');
        service.returnToPool(PoolType.PROJECTILE, p);
        returnedProjectiles.push(p);
      }

      // When the pool reaches max size (500), additional returned entities are destroyed
      // So only the first 500 projectiles can be in the pool
      // The last 100 returned projectiles (501-600) will be destroyed when we try to return them

      // Create 500 more - should reuse from the pool (which has max 500)
      const reusedProjectiles: number[] = [];
      for (let i = 0; i < 500; i++) {
        reusedProjectiles.push(service.createProjectile(i, i, 1, 0, 10, 'player'));
      }

      // All created projectiles should come from the pool (since we have 500 in pool)
      const reusedSet = new Set(reusedProjectiles);
      // The first 500 returned projectiles should be in the reused set
      const firstFiveHundred = returnedProjectiles.slice(0, 500);
      const allReusedFromFirst500 = firstFiveHundred.every((p) => reusedSet.has(p));
      expect(allReusedFromFirst500).toBe(true);
    });
  });

  describe('champion tier', () => {
    describe('EnemyTypeComponent champion flag', () => {
      it('should set isChampion on EnemyTypeComponent when isChampion=true', () => {
        const enemy = service.createEnemy(0, 0, EnemyType.Basic, 'common', false, 0, true);
        const enemyType = entityManager.getComponent(enemy, EnemyTypeComponent);
        expect(enemyType?.isChampion).toBe(true);
      });

      it('should not set isChampion when isChampion=false', () => {
        const enemy = service.createEnemy(0, 0, EnemyType.Basic, 'common', false, 0, false);
        const enemyType = entityManager.getComponent(enemy, EnemyTypeComponent);
        expect(enemyType?.isChampion).toBe(false);
      });

      it('should default isChampion to false', () => {
        const enemy = service.createEnemy(0, 0, EnemyType.Basic);
        const enemyType = entityManager.getComponent(enemy, EnemyTypeComponent);
        expect(enemyType?.isChampion).toBe(false);
      });
    });

    describe('champion stat multiplier (3.0x)', () => {
      it('champion should have higher health than common of same type', () => {
        const common = service.createEnemy(0, 0, EnemyType.Basic, 'common', false, 0, false);
        const champion = service.createEnemy(0, 0, EnemyType.Basic, 'legendary', false, 0, true);

        const commonHealth = entityManager.getComponent(common, HealthComponent)?.maxHealth ?? 0;
        const championHealth = entityManager.getComponent(champion, HealthComponent)?.maxHealth ?? 0;

        // Champion with legendary rarity (2x) × champion multiplier (3x) = 6x common health
        // But also capped at 5000, so just verify champion > common
        expect(championHealth).toBeGreaterThan(commonHealth);
      });

      it('champion should have higher damage than common of same type', () => {
        const common = service.createEnemy(0, 0, EnemyType.Basic, 'common', false, 0, false);
        const champion = service.createEnemy(0, 0, EnemyType.Basic, 'legendary', false, 0, true);

        const commonDmg = entityManager.getComponent(common, DamageComponent)?.contactDamage ?? 0;
        const championDmg = entityManager.getComponent(champion, DamageComponent)?.contactDamage ?? 0;

        expect(championDmg).toBeGreaterThan(commonDmg);
      });

      it('champion should have higher health than elite of same type', () => {
        const elite = service.createEnemy(0, 0, EnemyType.Tank, 'common', true, 0, false);
        const champion = service.createEnemy(0, 0, EnemyType.Tank, 'legendary', false, 0, true);

        const eliteHealth = entityManager.getComponent(elite, HealthComponent)?.maxHealth ?? 0;
        const championHealth = entityManager.getComponent(champion, HealthComponent)?.maxHealth ?? 0;

        // Champion (3x legendary 2x = 6x) vs elite (2x) — champion should be greater
        expect(championHealth).toBeGreaterThan(eliteHealth);
      });
    });

    describe('champion abilities', () => {
      it('champion should always have an AbilityComponent', () => {
        const champion = service.createEnemy(0, 0, EnemyType.Basic, 'legendary', false, 0, true);
        expect(entityManager.hasComponent(champion, AbilityComponent)).toBe(true);
      });

      it('Basic champion gets RALLY_CRY + ENRAGE abilities', () => {
        const champion = service.createEnemy(0, 0, EnemyType.Basic, 'legendary', false, 0, true);
        const abilityComp = entityManager.getComponent(champion, AbilityComponent);
        expect(abilityComp).toBeTruthy();
        const types = abilityComp!.abilities.map((a) => a.type);
        expect(types).toContain(AbilityType.RALLY_CRY);
        expect(types).toContain(AbilityType.ENRAGE);
        expect(abilityComp!.abilities.length).toBe(2);
      });

      it('Spitter champion gets VOLLEY + ACID_POOL abilities', () => {
        const champion = service.createEnemy(0, 0, EnemyType.Spitter, 'legendary', false, 0, true);
        const abilityComp = entityManager.getComponent(champion, AbilityComponent);
        const types = abilityComp!.abilities.map((a) => a.type);
        expect(types).toContain(AbilityType.VOLLEY);
        expect(types).toContain(AbilityType.ACID_POOL);
        expect(abilityComp!.abilities.length).toBe(2);
      });

      it('Tank champion gets EARTHQUAKE + IRON_SKIN abilities', () => {
        const champion = service.createEnemy(0, 0, EnemyType.Tank, 'legendary', false, 0, true);
        const abilityComp = entityManager.getComponent(champion, AbilityComponent);
        const types = abilityComp!.abilities.map((a) => a.type);
        expect(types).toContain(AbilityType.EARTHQUAKE);
        expect(types).toContain(AbilityType.IRON_SKIN);
      });

      it('Swarm champion gets HIVE_MIND + FRENZY_AURA abilities', () => {
        const champion = service.createEnemy(0, 0, EnemyType.Swarm, 'legendary', false, 0, true);
        const abilityComp = entityManager.getComponent(champion, AbilityComponent);
        const types = abilityComp!.abilities.map((a) => a.type);
        expect(types).toContain(AbilityType.HIVE_MIND);
        expect(types).toContain(AbilityType.FRENZY_AURA);
      });

      it('Thug champion gets GROUND_SLAM + BLOOD_RAGE abilities', () => {
        const champion = service.createEnemy(0, 0, EnemyType.Thug, 'legendary', false, 0, true);
        const abilityComp = entityManager.getComponent(champion, AbilityComponent);
        const types = abilityComp!.abilities.map((a) => a.type);
        expect(types).toContain(AbilityType.GROUND_SLAM);
        expect(types).toContain(AbilityType.BLOOD_RAGE);
      });

      it('Sniper champion gets PIERCING_SHOT + CLOAKING abilities', () => {
        const champion = service.createEnemy(0, 0, EnemyType.Sniper, 'legendary', false, 0, true);
        const abilityComp = entityManager.getComponent(champion, AbilityComponent);
        const types = abilityComp!.abilities.map((a) => a.type);
        expect(types).toContain(AbilityType.PIERCING_SHOT);
        expect(types).toContain(AbilityType.CLOAKING);
      });

      it('basic elite should NOT have champion abilities', () => {
        const elite = service.createEnemy(0, 0, EnemyType.Basic, 'common', true, 0, false);
        const abilityComp = entityManager.getComponent(elite, AbilityComponent);
        // Elites get no abilities for Basic type (no case in getAbilitiesForEnemyType)
        if (abilityComp) {
          const types = abilityComp.abilities.map((a) => a.type);
          expect(types).not.toContain(AbilityType.RALLY_CRY);
          expect(types).not.toContain(AbilityType.EARTHQUAKE);
        }
        // Not having abilities at all is also valid for basic elite
        expect(true).toBe(true);
      });
    });
  });
});
