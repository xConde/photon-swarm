import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IntroScreenComponent } from './intro-screen.component';
import { GameEngineService } from '../../core/engine/game-engine.service';
import { SaveGameAdapter } from '../../core/state/save-game.adapter';
import { CONTROL_CONSTANTS } from '../../core/controls/control-constants';

let saveSpyRef: jasmine.SpyObj<SaveGameAdapter>;

/** Minimal EventTarget-compatible stub for window.visualViewport in unit tests. */
class FakeVisualViewport extends EventTarget {
  height = 700;
}

describe('IntroScreenComponent', () => {
  let component: IntroScreenComponent;
  let fixture: ComponentFixture<IntroScreenComponent>;

  beforeEach(async () => {
    const engineSpy = jasmine.createSpyObj('GameEngineService', [
      'startGame',
      'loadGame',
      'setPlayerName',
      'generatePilotName',
    ]);
    engineSpy.generatePilotName.and.returnValue('Pilot-482910');
    const saveSpy = jasmine.createSpyObj('SaveGameAdapter', [
      'load',
      'save',
      'clearPlayerName',
      'loadPlayerName',
      'hasSave',
      'loadCheckpoint',
      'savePlayerName',
    ]);
    saveSpyRef = saveSpy;

    await TestBed.configureTestingModule({
      imports: [IntroScreenComponent],
      providers: [
        { provide: GameEngineService, useValue: engineSpy },
        { provide: SaveGameAdapter, useValue: saveSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IntroScreenComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should use centralized control constants', () => {
    expect(CONTROL_CONSTANTS.MOVEMENT_KEYS.includes('w')).toBe(true);
    expect(CONTROL_CONSTANTS.DASH_KEY).toBe(' ');
    expect(CONTROL_CONSTANTS.FLIGHT_MODE_KEY).toBe('shift');
  });

  it('onNotYou() forgets the persisted player and resets welcome state', () => {
    // Simulate a recognized returning player whose welcome typing finished.
    component.isReturningPlayer = true;
    component.playerName = 'Pilot-457288';
    component.displayedWelcomeText = 'Welcome back, Pilot-457288';
    component.fullWelcomeText = 'Welcome back, Pilot-457288';
    component.typingComplete = true;
    component.cursorBlinking = true;

    component.onNotYou();

    // The persisted name MUST be cleared — otherwise a reload resurrects the
    // "Welcome back" screen as if the click never happened.
    expect(saveSpyRef.clearPlayerName).toHaveBeenCalledTimes(1);
    expect(component.isReturningPlayer).toBeFalse();
    expect(component.playerName).toBe('');
    expect(component.displayedWelcomeText).toBe('');
    expect(component.typingComplete).toBeFalse();
    expect(component.cursorBlinking).toBeFalse();
  });

  describe('Empty-name submit (Pilot- fallback)', () => {
    it('onSubmit() advances past the name step even when playerName is empty', () => {
      component.playerName = '';

      component.onSubmit();

      expect(component.currentStep).toBe(1);
    });

    it('generates a Pilot- name via GameEngineService.generatePilotName() and adopts it as playerName when the field was blank', () => {
      const engine = TestBed.inject(GameEngineService) as jasmine.SpyObj<GameEngineService>;
      component.playerName = '';

      component.onSubmit();

      expect(engine.generatePilotName).toHaveBeenCalledTimes(1);
      expect(component.playerName).toBe('Pilot-482910');
    });

    it('does not generate a name when one was actually typed', () => {
      const engine = TestBed.inject(GameEngineService) as jasmine.SpyObj<GameEngineService>;
      component.playerName = 'Ace';

      component.onSubmit();

      expect(engine.generatePilotName).not.toHaveBeenCalled();
      expect(component.playerName).toBe('Ace');
    });

    it('blank submit renders the generated Pilot- name in the mission briefing header', () => {
      component.playerName = '';

      component.onSubmit();
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const missionHeading = host.querySelector('.mission-header h2');
      expect(missionHeading?.textContent?.trim()).toBe('Pilot-482910');
    });

    it('persists the generated name when advancing past the name step, same as a typed name would be', () => {
      component.playerName = '';

      component.onSubmit();

      expect(saveSpyRef.savePlayerName).toHaveBeenCalledWith('Pilot-482910');
    });

    it('the greeted name and the launched name are identical — no double generation between briefing and launch', () => {
      const engine = TestBed.inject(GameEngineService) as jasmine.SpyObj<GameEngineService>;
      component.playerName = '';

      // Blank submit — same seam the mission-briefing header renders from.
      component.onSubmit();
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const greetedName: string | undefined = host.querySelector('.mission-header h2')?.textContent?.trim();
      expect(greetedName).toMatch(/^Pilot-\d+$/);

      // Reach launch the way the real flow does after the briefing/tutorial/difficulty steps.
      component.instructionPhase = 'difficulty';
      component.onLaunchNewGame();

      expect(engine.generatePilotName).toHaveBeenCalledTimes(1); // generated exactly once, not regenerated at launch
      expect(engine.setPlayerName).toHaveBeenCalledWith(greetedName as string); // exact same string, unchanged
    });

    it('onLaunchNewGame() passes an empty name straight through to GameEngineService.setPlayerName, which auto-generates the Pilot- fallback (see game-state.service.spec.ts) — defense in depth if playerName is ever still blank at launch', () => {
      const engine = TestBed.inject(GameEngineService) as jasmine.SpyObj<GameEngineService>;
      let emittedName: string | undefined;
      component.startGame.subscribe((name) => (emittedName = name));
      component.playerName = '';

      component.onLaunchNewGame();

      expect(engine.setPlayerName).toHaveBeenCalledWith('');
      expect(saveSpyRef.savePlayerName).toHaveBeenCalledWith('');
      expect(emittedName).toBe('');
    });
  });

  describe('Intro typewriter skip hint', () => {
    it('is hidden before the typewriter starts', () => {
      component.instructionPhase = 'initial';
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.skip-hint')?.classList.contains('visible')).toBeFalsy();
    });

    it('is aria-hidden — a pointer-only affordance that stays in the DOM permanently', () => {
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.skip-hint')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('becomes visible while the mission text is typing', () => {
      component.instructionPhase = 'typing';
      component.instructionComplete = false;
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.skip-hint')?.classList.contains('visible')).toBeTrue();
    });

    it('disappears once typing completes', () => {
      component.instructionPhase = 'typing';
      component.instructionComplete = true;
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.skip-hint')?.classList.contains('visible')).toBeFalse();
    });

    it('disappears once the phase moves past typing (skipped or finished into controls)', () => {
      component.instructionPhase = 'controls';
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.skip-hint')?.classList.contains('visible')).toBeFalse();
    });
  });

  describe('iOS keyboard bounce fix — visualViewport listener', () => {
    let fakeViewport: FakeVisualViewport;
    let originalVisualViewport: VisualViewport | null;

    beforeEach(() => {
      fakeViewport = new FakeVisualViewport();
      originalVisualViewport = window.visualViewport;
      // Install a getter so TypeScript's read-only check is satisfied.
      Object.defineProperty(window, 'visualViewport', {
        get: () => fakeViewport,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(window, 'visualViewport', {
        get: () => originalVisualViewport,
        configurable: true,
      });
    });

    it('registers a resize listener on window.visualViewport during ngOnInit', () => {
      spyOn(fakeViewport, 'addEventListener').and.callThrough();

      fixture.detectChanges(); // triggers ngOnInit

      expect(fakeViewport.addEventListener).toHaveBeenCalledWith('resize', jasmine.any(Function));
    });

    it('removes the resize listener on ngOnDestroy', () => {
      spyOn(fakeViewport, 'removeEventListener').and.callThrough();

      fixture.detectChanges(); // triggers ngOnInit
      fixture.destroy(); // triggers ngOnDestroy

      expect(fakeViewport.removeEventListener).toHaveBeenCalledWith('resize', jasmine.any(Function));
    });

    it('sets --intro-vh on the host element during ngOnInit', () => {
      fakeViewport.height = 550;

      fixture.detectChanges(); // triggers ngOnInit

      const hostEl = fixture.nativeElement as HTMLElement;
      expect(hostEl.style.getPropertyValue('--intro-vh')).toBe('550px');
    });

    it('updates --intro-vh when the visualViewport fires a resize event', () => {
      fixture.detectChanges(); // triggers ngOnInit

      fakeViewport.height = 400;
      fakeViewport.dispatchEvent(new Event('resize'));

      const hostEl = fixture.nativeElement as HTMLElement;
      expect(hostEl.style.getPropertyValue('--intro-vh')).toBe('400px');
    });
  });
});
