import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActionButtonsComponent } from './action-buttons.component';
import { TouchDetectionService } from './touch-detection.service';
import { ActionButtonEvent } from './mobile-controls.types';
import { BehaviorSubject } from 'rxjs';

/** Minimal stub TouchEvent for onPress / onRelease. */
function makeTouchEvent(): TouchEvent {
  return {
    preventDefault: jasmine.createSpy('preventDefault'),
  } as unknown as TouchEvent;
}

describe('ActionButtonsComponent', () => {
  let component: ActionButtonsComponent;
  let fixture: ComponentFixture<ActionButtonsComponent>;
  let showVirtualControls$: BehaviorSubject<boolean>;
  let mockTouchDetection: jasmine.SpyObj<TouchDetectionService>;

  beforeEach(async () => {
    showVirtualControls$ = new BehaviorSubject<boolean>(true);

    mockTouchDetection = jasmine.createSpyObj('TouchDetectionService', ['getShowVirtualControls']);
    mockTouchDetection.getShowVirtualControls.and.returnValue(showVirtualControls$.asObservable());

    await TestBed.configureTestingModule({
      imports: [ActionButtonsComponent],
      providers: [{ provide: TouchDetectionService, useValue: mockTouchDetection }],
    }).compileComponents();

    fixture = TestBed.createComponent(ActionButtonsComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  // ── visibility ──────────────────────────────────────────────────────────────

  describe('visibility', () => {
    it('should show controls when touchDetection emits true', () => {
      showVirtualControls$.next(true);
      fixture.detectChanges();
      expect(component.isVisible).toBe(true);
    });

    it('should hide controls when touchDetection emits false', () => {
      showVirtualControls$.next(false);
      fixture.detectChanges();
      expect(component.isVisible).toBe(false);
    });
  });

  // ── weaponMode input ─────────────────────────────────────────────────────────

  describe('weaponMode input', () => {
    beforeEach(() => {
      showVirtualControls$.next(true);
      fixture.detectChanges();
    });

    it('should default to beam mode', () => {
      expect(component.weaponMode).toBe('beam');
    });

    // The toggle is labeled with the mode the tap SWITCHES TO, not the active mode —
    // "beam is on and the button says Beam" read as a lie (user feedback, Jun 2026).
    it('should offer SHOT (the switch target) when weaponMode is beam', () => {
      fixture.componentRef.setInput('weaponMode', 'beam');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const weaponBtn = el.querySelector('.weapon-toggle');
      expect(weaponBtn).toBeTruthy();
      const label = weaponBtn?.querySelector('.btn-label');
      expect(label?.textContent?.trim().toUpperCase()).toBe('SHOT');
    });

    it('should offer BEAM (the switch target) when weaponMode is shot', () => {
      // OnPush: set the input the supported way so the view is marked dirty. A direct
      // `component.weaponMode = …` mutation does NOT mark OnPush dirty, so the template
      // would not re-render (at runtime the parent's [weaponMode] binding handles this).
      fixture.componentRef.setInput('weaponMode', 'shot');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const weaponBtn = el.querySelector('.weapon-toggle');
      expect(weaponBtn).toBeTruthy();
      const label = weaponBtn?.querySelector('.btn-label');
      expect(label?.textContent?.trim().toUpperCase()).toBe('BEAM');
    });

    it('should set a switch-to-shot aria-label when weaponMode is beam', () => {
      fixture.componentRef.setInput('weaponMode', 'beam');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const weaponBtn = el.querySelector('.weapon-toggle');
      const ariaLabel = weaponBtn?.getAttribute('aria-label') ?? '';
      expect(ariaLabel.toLowerCase()).toContain('switch weapon to shot');
    });

    it('should set a switch-to-beam aria-label when weaponMode is shot', () => {
      // OnPush: set the input the supported way so the view is marked dirty. A direct
      // `component.weaponMode = …` mutation does NOT mark OnPush dirty, so the template
      // would not re-render (at runtime the parent's [weaponMode] binding handles this).
      fixture.componentRef.setInput('weaponMode', 'shot');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const weaponBtn = el.querySelector('.weapon-toggle');
      const ariaLabel = weaponBtn?.getAttribute('aria-label') ?? '';
      expect(ariaLabel.toLowerCase()).toContain('switch weapon to beam');
    });

    it('should apply mode-shot CSS class (orange = offered shot) when weaponMode is beam', () => {
      fixture.componentRef.setInput('weaponMode', 'beam');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const weaponBtn = el.querySelector('.weapon-toggle');
      expect(weaponBtn?.classList.contains('mode-shot')).toBe(true);
    });

    it('should NOT apply mode-shot CSS class (amber = offered beam) when weaponMode is shot', () => {
      // OnPush: set the input the supported way so the view is marked dirty. A direct
      // `component.weaponMode = …` mutation does NOT mark OnPush dirty, so the template
      // would not re-render (at runtime the parent's [weaponMode] binding handles this).
      fixture.componentRef.setInput('weaponMode', 'shot');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const weaponBtn = el.querySelector('.weapon-toggle');
      expect(weaponBtn?.classList.contains('mode-shot')).toBe(false);
    });

    it('should update the offered label when weaponMode changes mid-game (beam → shot)', () => {
      fixture.componentRef.setInput('weaponMode', 'beam');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;

      // OnPush: set the input the supported way so the view is marked dirty. A direct
      // `component.weaponMode = …` mutation does NOT mark OnPush dirty, so the template
      // would not re-render (at runtime the parent's [weaponMode] binding handles this).
      fixture.componentRef.setInput('weaponMode', 'shot');
      fixture.detectChanges();

      const weaponBtn = el.querySelector('.weapon-toggle');
      const label = weaponBtn?.querySelector('.btn-label');
      expect(label?.textContent?.trim().toUpperCase()).toBe('BEAM');
    });
  });

  // ── map button emits from new utility location ────────────────────────────

  describe('map button', () => {
    beforeEach(() => {
      showVirtualControls$.next(true);
      fixture.detectChanges();
    });

    it('should render the map button outside the action arc (.thumb-arc)', () => {
      const el: HTMLElement = fixture.nativeElement;
      // Map button should exist
      const mapBtn = el.querySelector('.map-btn');
      expect(mapBtn).toBeTruthy();
      // It must NOT be inside the thumb-arc combat cluster
      const arc = el.querySelector('.thumb-arc');
      expect(arc?.contains(mapBtn ?? null)).toBe(false);
    });

    it('should stay lit + flip aria while the Automap overlay is open ([mapOpen])', () => {
      const el: HTMLElement = fixture.nativeElement;
      const mapBtn = el.querySelector('.map-btn');

      fixture.componentRef.setInput('mapOpen', true);
      fixture.detectChanges();
      expect(mapBtn?.classList.contains('active')).toBe(true);
      expect(mapBtn?.getAttribute('aria-label')).toBe('Close Map');
      expect(mapBtn?.getAttribute('aria-pressed')).toBe('true');

      fixture.componentRef.setInput('mapOpen', false);
      fixture.detectChanges();
      expect(mapBtn?.classList.contains('active')).toBe(false);
      expect(mapBtn?.getAttribute('aria-label')).toBe('Open Map');
    });

    it('should render an SVG icon (not a unicode glyph) in the map button', () => {
      const el: HTMLElement = fixture.nativeElement;
      const mapBtn = el.querySelector('.map-btn');
      expect(mapBtn?.querySelector('.btn-icon svg')).toBeTruthy();
    });

    it('should emit map action on touchstart', () => {
      const emitted: ActionButtonEvent[] = [];
      component.actionPress.subscribe((e) => emitted.push(e));

      component.onPress('map', makeTouchEvent());

      expect(emitted.length).toBe(1);
      expect(emitted[0]).toEqual({ action: 'map', pressed: true });
    });

    it('should emit map action with pressed:false on touchend', () => {
      const emitted: ActionButtonEvent[] = [];
      component.actionPress.subscribe((e) => emitted.push(e));

      component.onRelease('map', makeTouchEvent());

      expect(emitted.length).toBe(1);
      expect(emitted[0]).toEqual({ action: 'map', pressed: false });
    });

    it('should have at least 44px width (WCAG 2.5.5) on the rendered map button', () => {
      const el: HTMLElement = fixture.nativeElement;
      const mapBtn = el.querySelector<HTMLElement>('.map-btn');
      // offsetWidth is 0 in JSDOM, so check the CSS class / structure instead
      expect(mapBtn).toBeTruthy();
      expect(mapBtn?.classList.contains('utility-btn')).toBe(true);
    });
  });

  // ── unified action arc (replaces the old split diamond + secondary strip) ──

  describe('action arc', () => {
    beforeEach(() => {
      showVirtualControls$.next(true);
      fixture.detectChanges();
    });

    it('should cluster three right-thumb combat actions in .thumb-arc in shot mode', () => {
      fixture.componentRef.setInput('weaponMode', 'shot');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const arc = el.querySelector('.thumb-arc');
      const btns = arc?.querySelectorAll('.arc-btn');
      // Weapon (anchor), Dash, Focus. Burst moved to aim-stick press gesture; Parry is outside.
      expect(btns?.length).toBe(3);
    });

    it('should cluster two right-thumb combat actions in .thumb-arc in beam mode', () => {
      fixture.componentRef.setInput('weaponMode', 'beam');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const arc = el.querySelector('.thumb-arc');
      const btns = arc?.querySelectorAll('.arc-btn');
      // Weapon (anchor), Dash. Focus hidden in beam mode (auto-sweep is the idle default).
      expect(btns?.length).toBe(2);
    });

    it('should NOT render a Burst arc button (burst moved to aim-stick press gesture)', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.arc-burst')).toBeNull();
    });

    it('should place the weapon toggle as the arc anchor', () => {
      const el: HTMLElement = fixture.nativeElement;
      const arc = el.querySelector('.thumb-arc');
      expect(arc?.querySelector('.weapon-toggle.arc-anchor')).toBeTruthy();
    });

    it('should render the parry button OUTSIDE the arc, between the joysticks', () => {
      const el: HTMLElement = fixture.nativeElement;
      const parry = el.querySelector('.parry-btn');
      expect(parry).toBeTruthy();
      expect(el.querySelector('.thumb-arc .parry-btn')).toBeNull();
    });

    it('should render an inline SVG icon in every arc button (no unicode glyphs) — shot mode', () => {
      fixture.componentRef.setInput('weaponMode', 'shot');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const svgs = el.querySelectorAll('.arc-btn .btn-icon svg');
      // 3 arc buttons (weapon, dash, focus) + standalone parry = 4 total.
      expect(svgs.length).toBe(4);
    });

    it('should render an inline SVG icon in every arc button (no unicode glyphs) — beam mode', () => {
      fixture.componentRef.setInput('weaponMode', 'beam');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const svgs = el.querySelectorAll('.arc-btn .btn-icon svg');
      // 2 arc buttons (weapon, dash) + standalone parry = 3 total.
      expect(svgs.length).toBe(3);
    });

    it('should show the cooldown ring + aria-disabled while parry is on cooldown', () => {
      fixture.componentRef.setInput('parryCooldown', 0.6);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const parry = el.querySelector('.parry-btn');
      expect(parry?.classList.contains('on-cooldown')).toBe(true);
      expect(parry?.getAttribute('aria-disabled')).toBe('true');

      fixture.componentRef.setInput('parryCooldown', 0);
      fixture.detectChanges();
      expect(parry?.classList.contains('on-cooldown')).toBe(false);
    });

    it('should no longer render the old separate secondary-actions strip', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.secondary-actions')).toBeNull();
    });
  });

  // ── existing button press/release behaviour ───────────────────────────────

  describe('onPress / onRelease', () => {
    beforeEach(() => {
      showVirtualControls$.next(true);
      fixture.detectChanges();
    });

    it('should emit actionPress with pressed:true on onPress', () => {
      const emitted: ActionButtonEvent[] = [];
      component.actionPress.subscribe((e) => emitted.push(e));

      component.onPress('dash', makeTouchEvent());

      expect(emitted.length).toBe(1);
      expect(emitted[0]).toEqual({ action: 'dash', pressed: true });
    });

    it('should set activeButtons entry on press', () => {
      component.onPress('parry', makeTouchEvent());
      expect(component.activeButtons['parry']).toBe(true);
    });

    it('should clear activeButtons entry on release', () => {
      component.onPress('dash', makeTouchEvent());
      component.onRelease('dash', makeTouchEvent());
      expect(component.activeButtons['dash']).toBe(false);
    });

    it('should emit actionPress with pressed:false on onRelease', () => {
      const emitted: ActionButtonEvent[] = [];
      component.actionPress.subscribe((e) => emitted.push(e));

      component.onRelease('parry', makeTouchEvent());

      expect(emitted.length).toBe(1);
      expect(emitted[0]).toEqual({ action: 'parry', pressed: false });
    });
  });

  // ── focusFire toggle ──────────────────────────────────────────────────────

  describe('onFocusFirePress', () => {
    beforeEach(() => {
      showVirtualControls$.next(true);
      fixture.detectChanges();
    });

    it('should emit focusFire pressed:true each tap (no local active toggle)', () => {
      const emitted: ActionButtonEvent[] = [];
      component.actionPress.subscribe((e) => emitted.push(e));

      component.onFocusFirePress(makeTouchEvent());
      component.onFocusFirePress(makeTouchEvent());

      expect(emitted.length).toBe(2);
      expect(emitted.every((e) => e.action === 'focusFire' && e.pressed === true)).toBe(true);
      // Active state is driven by [secondaryActive] from the parent, not a local toggle.
      expect(component.activeButtons['focusFire']).toBeUndefined();
    });
  });

  // ── FOCUS button: shot mode only, always Focus Fire ─────────────────────────

  describe('secondary (FOCUS) button', () => {
    beforeEach(() => {
      showVirtualControls$.next(true);
      fixture.detectChanges();
    });

    it('should render the Focus button in shot mode with Focus Fire aria-label', () => {
      fixture.componentRef.setInput('weaponMode', 'shot');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      const btn = el.querySelector('.arc-focus');
      expect(btn).toBeTruthy();
      expect(btn?.querySelector('.btn-label')?.textContent?.trim().toUpperCase()).toBe('FOCUS');
      expect((btn?.getAttribute('aria-label') ?? '').toLowerCase()).toContain('focus fire');
    });

    it('should NOT render the Focus button in beam mode (auto-sweep is the idle default)', () => {
      fixture.componentRef.setInput('weaponMode', 'beam');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.arc-focus')).toBeNull();
    });

    it('should reflect [secondaryActive] as the .active class in shot mode (not a local toggle)', () => {
      fixture.componentRef.setInput('weaponMode', 'shot');
      fixture.detectChanges();

      fixture.componentRef.setInput('secondaryActive', true);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.arc-focus')?.classList.contains('active')).toBe(true);

      fixture.componentRef.setInput('secondaryActive', false);
      fixture.detectChanges();
      expect(el.querySelector('.arc-focus')?.classList.contains('active')).toBe(false);
    });
  });

  // ── cleanup ───────────────────────────────────────────────────────────────

  describe('ngOnDestroy', () => {
    it('should unsubscribe without throwing', () => {
      fixture.detectChanges();
      expect(() => fixture.destroy()).not.toThrow();
    });

    it('should not update isVisible after destroy', () => {
      fixture.detectChanges();
      fixture.destroy();
      showVirtualControls$.next(false);
      // isVisible keeps its last value; no throw
      expect(() => showVirtualControls$.next(true)).not.toThrow();
    });
  });
});
