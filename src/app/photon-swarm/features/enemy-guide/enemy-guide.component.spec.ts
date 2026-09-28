import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EnemyGuideComponent } from './enemy-guide.component';
import { EnemySpriteGeneratorService } from '../../core/rendering/enemy-sprite-generator.service';
import { EnemyType } from '../../core/models/enemy.model';
import { ENEMY_DEFINITIONS } from './enemy-definitions';
import { PaletteService } from '../../services/palette.service';

describe('EnemyGuideComponent', () => {
  let fixture: ComponentFixture<EnemyGuideComponent>;
  let component: EnemyGuideComponent;

  beforeEach(async () => {
    // Stub the sprite generator — return a tiny real canvas so drawIcon's drawImage path runs.
    const spriteStub: Partial<EnemySpriteGeneratorService> = {
      getSprite: () => {
        const c = document.createElement('canvas');
        c.width = 32;
        c.height = 32;
        return c;
      },
    };

    await TestBed.configureTestingModule({
      imports: [EnemyGuideComponent],
      providers: [
        { provide: EnemySpriteGeneratorService, useValue: spriteStub },
        {
          provide: PaletteService,
          useValue: { getCanvas: () => ({ ACCENT_CYAN: '#00ffff' }) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EnemyGuideComponent);
    component = fixture.componentInstance;
  });

  it('populates the unlocked list BEFORE first render (the @for is not empty)', () => {
    component.playerLevel = 25; // 25 is beyond the highest minLevel (Sentinel = 22)
    fixture.detectChanges(); // runs ngOnInit + first render

    expect(component.unlocked.length).toBe(ENEMY_DEFINITIONS.length);
    const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('.enemy-entry');
    expect(cards.length).toBe(ENEMY_DEFINITIONS.length);
  });

  it('level-gates the roster — only enemies at or below the player level appear', () => {
    component.playerLevel = 5;
    fixture.detectChanges();

    const expected = ENEMY_DEFINITIONS.filter((e) => e.minLevel <= 5).length;
    expect(component.unlocked.length).toBe(expected);
    expect(component.unlocked.every((e) => e.minLevel <= 5)).toBeTrue();
  });

  it('derives threat tiers: HP sets the base, ranged/swarm/shield punch up, boss is its own tier', () => {
    const tierFor = (type: EnemyType, health: number): string =>
      component.threatTier({
        type,
        name: 'x',
        minLevel: 1,
        health,
        speed: 'Slow',
        xpValue: 1,
        description: '',
      }).label;

    expect(tierFor(EnemyType.Basic, 2)).toBe('Low'); // fodder
    expect(tierFor(EnemyType.Tank, 10)).toBe('Medium'); // HP alone
    expect(tierFor(EnemyType.Spitter, 4)).toBe('Medium'); // low HP but ranged → bumped
    expect(tierFor(EnemyType.Swarm, 3)).toBe('Medium'); // dangerous in numbers → bumped
    expect(tierFor(EnemyType.Disruptor, 45)).toBe('High'); // high HP
    expect(tierFor(EnemyType.Sentinel, 65)).toBe('High');
    expect(tierFor(EnemyType.Boss, 350)).toBe('Boss');
    expect(tierFor(EnemyType.Basic, 120)).toBe('Boss'); // anything ≥100 HP reads as a boss
  });

  it('emits close on backdrop / close click', () => {
    let closed = false;
    component.close.subscribe(() => (closed = true));
    component.onBackdropClick();
    expect(closed).toBeTrue();
  });
});
