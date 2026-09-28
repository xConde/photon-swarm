import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { WaveAnnouncementComponent } from './wave-announcement.component';
import { SpawnSystemService } from '../../core/systems/enemy-ai';
import { AudioService } from '../../core/audio/audio.service';
import { EncounterResolution, WaveType } from '../../core/models/encounter.model';

/** Query helpers operating on the host element — avoids accessing protected signals. */
function getResolvedEl(fixture: ComponentFixture<WaveAnnouncementComponent>): HTMLElement | null {
  return fixture.nativeElement.querySelector('.event-resolved-text');
}

function getResolvedText(fixture: ComponentFixture<WaveAnnouncementComponent>): string {
  return getResolvedEl(fixture)?.textContent?.trim() ?? '';
}

describe('WaveAnnouncementComponent', () => {
  let component: WaveAnnouncementComponent;
  let fixture: ComponentFixture<WaveAnnouncementComponent>;

  let waveStarted$: Subject<{ waveNumber: number; waveType: 'normal'; factionName?: string }>;
  let newThreatUnlocked$: Subject<{ type: string; waveNumber: number }>;
  let waveWarning$: Subject<{ waveNumber: number }>;
  let encounterResolved$: Subject<EncounterResolution>;
  let sectorAlert$: Subject<{ message: string }>;

  beforeEach(async () => {
    waveStarted$ = new Subject();
    newThreatUnlocked$ = new Subject();
    waveWarning$ = new Subject();
    encounterResolved$ = new Subject();
    sectorAlert$ = new Subject();

    const spawnSpy = jasmine.createSpyObj('SpawnSystemService', [], {
      waveStarted$,
      newThreatUnlocked$,
      waveWarning$,
      sectorAlert$,
      encounterObjectives: { resolved$: encounterResolved$ },
    });

    const audioSpy = jasmine.createSpyObj('AudioService', ['playWaveWarning']);

    await TestBed.configureTestingModule({
      imports: [WaveAnnouncementComponent],
      providers: [
        { provide: SpawnSystemService, useValue: spawnSpy },
        { provide: AudioService, useValue: audioSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WaveAnnouncementComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('event-resolved FIFO queue', () => {
    const SHOW_MS = 1000;
    const FADE_MS = 300;

    const resolve = (type: WaveType, title: string, overrides: Partial<EncounterResolution> = {}): void => {
      encounterResolved$.next({
        waveNumber: 1,
        type,
        title,
        success: true,
        rewardGranted: false,
        reward: { shards: 7, xp: 13 },
        ...overrides,
      });
    };

    it('should show the first resolved message immediately', fakeAsync(() => {
      resolve('faction_invasion', 'Crimson Invasion');
      fixture.detectChanges();

      expect(getResolvedEl(fixture)).not.toBeNull();
      expect(getResolvedText(fixture)).toBe('INVASION REPELLED');

      tick(SHOW_MS + FADE_MS);
      fixture.detectChanges();
    }));

    it('should queue a second event and show it after the first expires', fakeAsync(() => {
      // First message
      resolve('faction_invasion', 'Crimson Invasion');
      fixture.detectChanges();
      expect(getResolvedText(fixture)).toBe('INVASION REPELLED');

      // Second message arrives while first is still visible
      resolve('guardian_surge', 'Guardian Surge');
      fixture.detectChanges();
      // First message still showing
      expect(getResolvedText(fixture)).toBe('INVASION REPELLED');

      // Let first message expire (show + fade)
      tick(SHOW_MS + FADE_MS);
      fixture.detectChanges();

      // Second message should now be visible
      expect(getResolvedEl(fixture)).not.toBeNull();
      expect(getResolvedText(fixture)).toBe('SURGE CLEARED');

      // Clean up remaining timers
      tick(SHOW_MS + FADE_MS);
      fixture.detectChanges();
    }));

    it('should show both events in order when two arrive simultaneously', fakeAsync(() => {
      resolve('blackout', 'Blackout');
      resolve('boss_rush', 'Boss Rush');
      fixture.detectChanges();

      // First in queue shows first
      expect(getResolvedText(fixture)).toBe('BLACKOUT LIFTED');

      tick(SHOW_MS + FADE_MS);
      fixture.detectChanges();

      // Second follows
      expect(getResolvedEl(fixture)).not.toBeNull();
      expect(getResolvedText(fixture)).toBe('BOSS RUSH SURVIVED');

      tick(SHOW_MS + FADE_MS);
      fixture.detectChanges();
    }));

    it('should drop the oldest queued message when a third arrives (max 2 queued)', fakeAsync(() => {
      // First — currently displayed
      resolve('faction_invasion', 'Crimson Invasion');
      fixture.detectChanges();
      expect(getResolvedText(fixture)).toBe('INVASION REPELLED');

      // Queue fills up to max 2
      sectorAlert$.next({ message: 'SECTOR ALERT: ZONE GATES ACTIVE' });
      sectorAlert$.next({ message: 'SECOND SECTOR ALERT' });
      // Overflow: one more — should drop oldest queued entry
      sectorAlert$.next({ message: 'THIRD SECTOR ALERT' });
      fixture.detectChanges();

      // First message still showing
      expect(getResolvedText(fixture)).toBe('INVASION REPELLED');

      // Expire first
      tick(SHOW_MS + FADE_MS);
      fixture.detectChanges();

      // Oldest queued ('SECTOR ALERT: ZONE GATES ACTIVE') was dropped; next is 'SECOND SECTOR ALERT'
      expect(getResolvedText(fixture)).toBe('SECOND SECTOR ALERT');

      tick(SHOW_MS + FADE_MS);
      fixture.detectChanges();

      expect(getResolvedText(fixture)).toBe('THIRD SECTOR ALERT');

      tick(SHOW_MS + FADE_MS);
      fixture.detectChanges();
    }));

    it('should handle sectorAlert$ messages through the same queue', fakeAsync(() => {
      sectorAlert$.next({ message: 'SECTOR ALERT: ZONE GATES ACTIVE' });
      fixture.detectChanges();

      expect(getResolvedEl(fixture)).not.toBeNull();
      expect(getResolvedText(fixture)).toBe('SECTOR ALERT: ZONE GATES ACTIVE');

      tick(SHOW_MS + FADE_MS);
      fixture.detectChanges();
    }));

    it('should acknowledge normal directives and only claim rewards that were granted', fakeAsync(() => {
      resolve('normal', 'Scout Screen', { rewardGranted: true, reward: { shards: 4, xp: 10 } });
      fixture.detectChanges();

      expect(getResolvedText(fixture)).toBe('SCOUT SCREEN CLEARED · +4 SHARDS · +10 XP');

      tick(SHOW_MS + FADE_MS);
      resolve('normal', 'Hunt Pack', { success: false });
      fixture.detectChanges();

      expect(getResolvedText(fixture)).toBe('HUNT PACK FAILED');

      tick(SHOW_MS + FADE_MS);
      fixture.detectChanges();
    }));
  });
});
