import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { KillFeedComponent } from './kill-feed.component';

describe('KillFeedComponent', () => {
  let component: KillFeedComponent;
  let fixture: ComponentFixture<KillFeedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KillFeedComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(KillFeedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('pulse creation', () => {
    it('should start with no active pulses', () => {
      expect(component.activePulses()).toEqual([]);
    });

    it('should add a pulse when addKill is called', () => {
      component.addKill('basic', 1, 25);
      fixture.detectChanges();

      expect(component.activePulses().length).toBe(1);
    });

    it('should assign incrementing IDs to pulses', () => {
      component.addKill('basic', 1, 10);
      component.addKill('tank', 2, 20);

      const pulses = component.activePulses();
      expect(pulses[0].id).toBe(0);
      expect(pulses[1].id).toBe(1);
    });

    it('should use faction color for pulse color', () => {
      component.addKill('basic', 1, 10);
      component.addKill('basic', 2, 10);
      component.addKill('basic', 3, 10);
      component.addKill('basic', 4, 10);

      const pulses = component.activePulses();
      expect(pulses[0].color).toBe('#e74c3c'); // Crimson — FACTION_BRAND_COLORS[1].dark
      expect(pulses[1].color).toBe('#3498db'); // Azure   — FACTION_BRAND_COLORS[2].dark
      expect(pulses[2].color).toBe('#27ae60'); // Verdant — FACTION_BRAND_COLORS[3].dark
      expect(pulses[3].color).toBe('#8e44ad'); // Shadow  — FACTION_BRAND_COLORS[4].dark
    });

    it('should fall back to cyan for unknown faction IDs', () => {
      component.addKill('basic', 99, 10);
      expect(component.activePulses()[0].color).toBe('#44ffff');
    });

    it('should cycle edges in right → top → left → bottom order', () => {
      component.addKill('basic', 1, 10);
      component.addKill('basic', 1, 10);
      component.addKill('basic', 1, 10);
      component.addKill('basic', 1, 10);

      const pulses = component.activePulses();
      expect(pulses[0].edge).toBe('right');
      expect(pulses[1].edge).toBe('top');
      expect(pulses[2].edge).toBe('left');
      expect(pulses[3].edge).toBe('bottom');
    });

    it('should wrap edge rotation after 4 kills', () => {
      for (let i = 0; i < 5; i++) {
        component.addKill('basic', 1, 10);
      }
      expect(component.activePulses()[4].edge).toBe('right');
    });

    it('should scale opacity based on XP (low XP → low opacity)', () => {
      component.addKill('basic', 1, 0);
      const pulse = component.activePulses()[0];
      // opacity = Math.min(0.6, 0.2 + (0/50)*0.4) = 0.2
      expect(pulse.opacity).toBeCloseTo(0.2);
    });

    it('should scale opacity based on XP (high XP → high opacity)', () => {
      component.addKill('basic', 1, 50);
      const pulse = component.activePulses()[0];
      // opacity = Math.min(0.6, 0.2 + (50/50)*0.4) = 0.6
      expect(pulse.opacity).toBeCloseTo(0.6);
    });

    it('should cap opacity at 0.6 for very high XP', () => {
      component.addKill('boss', 1, 500);
      const pulse = component.activePulses()[0];
      expect(pulse.opacity).toBeCloseTo(0.6);
    });
  });

  describe('MAX_PULSES cap', () => {
    it('should cap at 6 simultaneous pulses', () => {
      for (let i = 0; i < 9; i++) {
        component.addKill('basic', 1, 10);
      }
      expect(component.activePulses().length).toBe(6);
    });

    it('should retain the most recently added pulses when capped', () => {
      for (let i = 0; i < 8; i++) {
        component.addKill('basic', 1, i * 10);
      }
      const pulses = component.activePulses();
      // Last pulse added has xp=70, opacity = min(0.6, 0.2 + (70/50)*0.4) = 0.6
      expect(pulses[pulses.length - 1].opacity).toBeCloseTo(0.6);
    });
  });

  describe('auto-removal after timeout', () => {
    it('should fire cleanup on the 200ms interval', fakeAsync(() => {
      component.addKill('basic', 1, 10);
      expect(component.activePulses().length).toBe(1);

      // Not expired yet — pulse lifetime is 400ms, only 200ms elapsed
      tick(200);
      fixture.detectChanges();
      expect(component.activePulses().length).toBe(1);
    }));

    it('should remove pulses older than 400ms', () => {
      component.addKill('basic', 1, 10);
      component.addKill('tank', 2, 20);

      const privateComp = component as unknown as {
        pulses: { update: (fn: (e: unknown[]) => unknown[]) => void };
      };

      // Backdate pulse 0 to be 500ms old; leave pulse 1 as recent
      privateComp.pulses.update((entries: unknown[]) => {
        const typed = entries as Array<{ timestamp: number }>;
        typed[0] = { ...typed[0], timestamp: Date.now() - 500 };
        return typed;
      });

      (component as unknown as { cleanupExpiredPulses(): void }).cleanupExpiredPulses();
      fixture.detectChanges();

      expect(component.activePulses().length).toBe(1);
      expect(component.activePulses()[0].color).toBe('#3498db'); // Azure — FACTION_BRAND_COLORS[2].dark
    });

    it('should retain pulses within 400ms lifetime', () => {
      component.addKill('basic', 1, 10);
      component.addKill('tank', 2, 20);

      const privateComp = component as unknown as {
        pulses: { update: (fn: (e: unknown[]) => unknown[]) => void };
      };

      // Backdate pulse 0 to be 300ms old — still within lifetime
      privateComp.pulses.update((entries: unknown[]) => {
        const typed = entries as Array<{ timestamp: number }>;
        typed[0] = { ...typed[0], timestamp: Date.now() - 300 };
        return typed;
      });

      (component as unknown as { cleanupExpiredPulses(): void }).cleanupExpiredPulses();
      fixture.detectChanges();

      expect(component.activePulses().length).toBe(2);
    });

    it('should remove all pulses when all are expired', () => {
      component.addKill('basic', 1, 10);
      component.addKill('tank', 2, 20);

      const privateComp = component as unknown as {
        pulses: { update: (fn: (e: unknown[]) => unknown[]) => void };
      };

      privateComp.pulses.update((entries: unknown[]) => {
        const typed = entries as Array<{ timestamp: number }>;
        return typed.map((e) => ({ ...e, timestamp: Date.now() - 1000 }));
      });

      (component as unknown as { cleanupExpiredPulses(): void }).cleanupExpiredPulses();
      fixture.detectChanges();

      expect(component.activePulses().length).toBe(0);
    });
  });

  describe('signal reactivity', () => {
    it('should update activePulses signal reactively', () => {
      expect(component.activePulses().length).toBe(0);

      component.addKill('basic', 1, 10);
      expect(component.activePulses().length).toBe(1);

      component.addKill('fast', 3, 50);
      expect(component.activePulses().length).toBe(2);
    });
  });
});
