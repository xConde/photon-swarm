import { discardPeriodicTasks, fakeAsync, TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import { EnemySpriteGeneratorService } from './enemy-sprite-generator.service';
import { EnemyType } from '../models/enemy.model';
import { ThemeService } from '@services/theme.service';
import { BossArchetype } from '../../components/boss-phase.component';

describe('EnemySpriteGeneratorService — boss archetype sprites', () => {
  let service: EnemySpriteGeneratorService;
  let themeChanges$: Subject<boolean>;

  beforeEach(fakeAsync(() => {
    themeChanges$ = new Subject<boolean>();

    const mockThemeService = {
      isDayMode: false,
      isDayMode$: themeChanges$.asObservable(),
    };

    TestBed.configureTestingModule({
      providers: [
        EnemySpriteGeneratorService,
        { provide: ThemeService, useValue: mockThemeService },
        {
          provide: NgZone,
          useValue: new NgZone({ enableLongStackTrace: false }),
        },
      ],
    });

    service = TestBed.inject(EnemySpriteGeneratorService);
    // Discard the periodic cleanup interval that was set up in the constructor
    discardPeriodicTasks();
  }));

  afterEach(() => {
    service.ngOnDestroy();
  });

  const BOSS_SIZE = 50; // matches SPRITE_SIZES[EnemyType.Boss]
  const EXPECTED_CANVAS_SIZE = BOSS_SIZE * 3; // 150
  const FACTION_ID = 1;
  const ANIMATION_TIME = 1000;

  describe('getSprite — boss archetype variants', () => {
    it('returns a valid canvas for the standard archetype', () => {
      const sprite = service.getSprite(EnemyType.Boss, FACTION_ID, ANIMATION_TIME, false, null, false, 'standard');

      expect(sprite).toBeTruthy();
      expect(sprite.width).toBe(EXPECTED_CANVAS_SIZE);
      expect(sprite.height).toBe(EXPECTED_CANVAS_SIZE);
    });

    it('returns a valid canvas for the swarm_king archetype', () => {
      const sprite = service.getSprite(EnemyType.Boss, FACTION_ID, ANIMATION_TIME, false, null, false, 'swarm_king');

      expect(sprite).toBeTruthy();
      expect(sprite.width).toBe(EXPECTED_CANVAS_SIZE);
      expect(sprite.height).toBe(EXPECTED_CANVAS_SIZE);
    });

    it('returns a valid canvas for the pyroclast archetype', () => {
      const sprite = service.getSprite(EnemyType.Boss, FACTION_ID, ANIMATION_TIME, false, null, false, 'pyroclast');

      expect(sprite).toBeTruthy();
      expect(sprite.width).toBe(EXPECTED_CANVAS_SIZE);
      expect(sprite.height).toBe(EXPECTED_CANVAS_SIZE);
    });

    it('returns a valid boss sprite when archetype is omitted (back-compat)', () => {
      // No archetype arg — must not throw and must return correct dimensions
      const sprite = service.getSprite(EnemyType.Boss, FACTION_ID, ANIMATION_TIME);

      expect(sprite).toBeTruthy();
      expect(sprite.width).toBe(EXPECTED_CANVAS_SIZE);
      expect(sprite.height).toBe(EXPECTED_CANVAS_SIZE);
    });

    it('pools swarm_king and pyroclast under distinct keys (no shared canvas)', () => {
      // Request swarm_king once, then pyroclast — they must be different canvas instances.
      // We verify behaviorally: the pool key differences ensure the generator is called
      // independently for each archetype, producing canvases with independent identity.
      const archetypes: BossArchetype[] = ['swarm_king', 'pyroclast', 'standard'];
      const sprites = archetypes.map((arch) =>
        service.getSprite(EnemyType.Boss, FACTION_ID, ANIMATION_TIME, false, null, false, arch)
      );

      // All three should be non-null with correct dimensions
      for (const sprite of sprites) {
        expect(sprite).toBeTruthy();
        expect(sprite.width).toBe(EXPECTED_CANVAS_SIZE);
        expect(sprite.height).toBe(EXPECTED_CANVAS_SIZE);
      }

      // The three pool entries must be distinct canvas instances
      expect(sprites[0]).not.toBe(sprites[1]);
      expect(sprites[1]).not.toBe(sprites[2]);
      expect(sprites[0]).not.toBe(sprites[2]);
    });

    it('does not throw for any of the three archetypes across multiple animation times', () => {
      const archetypes: BossArchetype[] = ['standard', 'swarm_king', 'pyroclast'];
      const times = [0, 500, 2500, 10000];

      for (const arch of archetypes) {
        for (const t of times) {
          expect(() => service.getSprite(EnemyType.Boss, FACTION_ID, t, false, null, false, arch)).not.toThrow();
        }
      }
    });
  });
});
