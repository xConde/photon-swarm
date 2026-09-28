import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { FactionStandingBarComponent } from './faction-standing-bar.component';
import {
  FactionStanding,
  FactionStandingSystemService,
} from '../../../core/systems/gameplay/faction-standing-system.service';

describe('FactionStandingBarComponent', () => {
  let fixture: ComponentFixture<FactionStandingBarComponent>;
  let standings$: BehaviorSubject<FactionStanding[]>;

  // Production-style two-word king names so the shortLabel() de-truncation path is actually
  // exercised. A "King N" stub collapses to "King" for every chip, masking the real logic.
  const KING_NAMES = ['Crimson King', 'Azure King', 'Verdant King', 'Shadow King'];

  function chip(factionId: number, standing: number, relationship: FactionStanding['relationship']): FactionStanding {
    return {
      factionId,
      name: KING_NAMES[factionId - 1] ?? `King ${factionId}`,
      factionName: `Faction ${factionId}`,
      color: '#aabbcc',
      relationship,
      standing,
    };
  }

  beforeEach(async () => {
    standings$ = new BehaviorSubject<FactionStanding[]>([]);

    await TestBed.configureTestingModule({
      imports: [FactionStandingBarComponent],
      providers: [
        {
          provide: FactionStandingSystemService,
          useValue: { standings$: standings$.asObservable() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FactionStandingBarComponent);
  });

  it('renders nothing on a fresh run — every faction at zero standing', () => {
    standings$.next([chip(1, 0, 'neutral'), chip(2, 0, 'neutral'), chip(3, 0, 'neutral'), chip(4, 0, 'neutral')]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.faction-standing-bar')).toBeNull();
  });

  it('renders the strip once any faction has drifted off zero', () => {
    standings$.next([chip(1, -8, 'neutral'), chip(2, 0, 'neutral'), chip(3, 0, 'neutral'), chip(4, 0, 'neutral')]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.faction-standing-bar')).not.toBeNull();
    expect(host.querySelectorAll('.faction-chip').length).toBe(4);
  });

  it('applies the relationship class to each chip', () => {
    standings$.next([chip(1, 60, 'allied'), chip(2, -60, 'hostile'), chip(3, 0, 'neutral'), chip(4, 10, 'neutral')]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const chips = host.querySelectorAll<HTMLElement>('.faction-chip');
    expect(chips[0].classList.contains('allied')).toBeTrue();
    expect(chips[1].classList.contains('hostile')).toBeTrue();
    expect(chips[2].classList.contains('neutral')).toBeTrue();
    expect(chips[3].classList.contains('neutral')).toBeTrue();
  });

  it('renders the numeric standing inside each chip', () => {
    standings$.next([chip(1, -42, 'neutral'), chip(2, 0, 'neutral'), chip(3, 0, 'neutral'), chip(4, 0, 'neutral')]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const values = Array.from(host.querySelectorAll('.faction-value')).map((el) => el.textContent?.trim());
    expect(values).toEqual(['-42', '0', '0', '0']);
  });

  it('renders the de-truncated first word of each king name in the chip label', () => {
    standings$.next([chip(1, 20, 'neutral'), chip(2, -20, 'neutral'), chip(3, 15, 'neutral'), chip(4, -15, 'neutral')]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const names = Array.from(host.querySelectorAll('.faction-name')).map((el) => el.textContent?.trim());
    expect(names).toEqual(['Crimson', 'Azure', 'Verdant', 'Shadow']);
  });

  it('shortLabel() returns the first word, and the whole string when there is no space', () => {
    const comp = fixture.componentInstance;
    expect(comp.shortLabel('Crimson King')).toBe('Crimson');
    expect(comp.shortLabel('Shadow King')).toBe('Shadow');
    expect(comp.shortLabel('Solo')).toBe('Solo');
    expect(comp.shortLabel('')).toBe('');
  });

  it('writes a descriptive aria-label per chip so SR users can hear the relationship + standing', () => {
    standings$.next([chip(1, 60, 'allied'), chip(2, 0, 'neutral'), chip(3, 0, 'neutral'), chip(4, 0, 'neutral')]);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const firstChip = host.querySelector('.faction-chip');
    const label = firstChip?.getAttribute('aria-label') ?? '';
    // aria-label keeps the FULL king name (the shortLabel de-truncation is visual-only)
    expect(label).toContain('Crimson King');
    expect(label).toContain('allied');
    expect(label).toContain('60');
  });

  it('hides the strip again if standings drift back to zero (e.g. after a reset)', () => {
    standings$.next([chip(1, -20, 'neutral'), chip(2, 0, 'neutral'), chip(3, 0, 'neutral'), chip(4, 0, 'neutral')]);
    fixture.detectChanges();
    let host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.faction-standing-bar')).not.toBeNull();

    standings$.next([chip(1, 0, 'neutral'), chip(2, 0, 'neutral'), chip(3, 0, 'neutral'), chip(4, 0, 'neutral')]);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.faction-standing-bar')).toBeNull();
  });
});
