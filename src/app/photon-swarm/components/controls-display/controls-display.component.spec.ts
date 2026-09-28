import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ControlsDisplayComponent, SimpleControl } from './controls-display.component';
import {
  ControlMapping,
  CooldownState,
  GameControlsService,
  PlayerActionState,
} from '../../core/controls/game-controls.service';
import { of } from 'rxjs';

describe('ControlsDisplayComponent', () => {
  let component: ControlsDisplayComponent;
  let fixture: ComponentFixture<ControlsDisplayComponent>;
  let mockGameControls: jasmine.SpyObj<GameControlsService>;

  const defaultControls: ControlMapping[] = [
    { key: 'W/A/S/D', action: 'Move', category: 'movement' },
    { key: 'SPACE', action: 'Dash', cooldownKey: 'DASH', category: 'movement' },
  ];

  const pauseControls: ControlMapping[] = [
    { key: 'ESC', action: 'Resume', category: 'interface' },
    { key: 'M', action: 'Map', category: 'interface' },
  ];

  beforeEach(async () => {
    mockGameControls = jasmine.createSpyObj('GameControlsService', [
      'getControlsForState',
      'getCooldowns',
      'getPlayerActionState',
    ]);
    mockGameControls.getControlsForState.and.callFake((state: string) => {
      if (state === 'pause') return pauseControls;
      return defaultControls;
    });
    mockGameControls.getCooldowns.and.returnValue(of(new Map<string, CooldownState>()));
    mockGameControls.getPlayerActionState.and.returnValue(
      of({
        isMoving: false,
        isDashing: false,
        isTargeting: false,
        isCombat: false,
        mapOpened: false,
        dashCooldownPercent: 0,
      } as PlayerActionState)
    );

    await TestBed.configureTestingModule({
      imports: [ControlsDisplayComponent],
      providers: [{ provide: GameControlsService, useValue: mockGameControls }],
    }).compileComponents();

    fixture = TestBed.createComponent(ControlsDisplayComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Signal Reactivity', () => {
    it('should update resolvedControls when controls input changes', () => {
      // Initially no controls provided, so resolvedControls falls back to service
      fixture.componentRef.setInput('displayMode', 'modal-hint');
      fixture.detectChanges();

      const initialControls = component.resolvedControls();
      expect(initialControls).toEqual(defaultControls);

      // Set explicit controls via signal input
      const customControls: SimpleControl[] = [
        { key: 'ESC', action: 'Close' },
        { key: 'ENTER', action: 'Confirm' },
      ];
      fixture.componentRef.setInput('controls', customControls);
      fixture.detectChanges();

      const updatedControls = component.resolvedControls();
      expect(updatedControls).toEqual(customControls);
      expect(updatedControls.length).toBe(2);
      expect(updatedControls[0].key).toBe('ESC');
    });

    it('should update resolvedDisplayMode when displayMode input changes', () => {
      // Default displayMode is 'gameplay'
      fixture.componentRef.setInput('displayMode', 'gameplay');
      fixture.detectChanges();

      expect(component.resolvedDisplayMode()).toBe('gameplay');

      // Change to modal-hint
      fixture.componentRef.setInput('displayMode', 'modal-hint');
      fixture.detectChanges();

      expect(component.resolvedDisplayMode()).toBe('modal-hint');

      // Change to pause-menu
      fixture.componentRef.setInput('displayMode', 'pause-menu');
      fixture.detectChanges();

      expect(component.resolvedDisplayMode()).toBe('pause-menu');
    });

    it('should resolve to pause-menu when gameState is pause and displayMode is gameplay', () => {
      fixture.componentRef.setInput('displayMode', 'gameplay');
      fixture.componentRef.setInput('gameState', 'pause');
      fixture.detectChanges();

      expect(component.resolvedDisplayMode()).toBe('pause-menu');
    });

    it('should not override non-gameplay displayMode when gameState is pause', () => {
      fixture.componentRef.setInput('displayMode', 'modal-hint');
      fixture.componentRef.setInput('gameState', 'pause');
      fixture.detectChanges();

      expect(component.resolvedDisplayMode()).toBe('modal-hint');
    });

    it('should reflect position signal changes in template', () => {
      fixture.componentRef.setInput('displayMode', 'modal-hint');
      fixture.detectChanges();

      const hintEl = fixture.nativeElement.querySelector('.controls-modal-hint') as HTMLElement;
      expect(hintEl).toBeTruthy();

      // Default position is bottom-right
      expect(hintEl.classList.contains('position-bottom-right')).toBe(true);

      // Change position
      fixture.componentRef.setInput('position', 'top-left');
      fixture.detectChanges();

      expect(hintEl.classList.contains('position-top-left')).toBe(true);
      expect(hintEl.classList.contains('position-bottom-right')).toBe(false);
    });

    it('should fall back to service controls when input controls is empty', () => {
      fixture.componentRef.setInput('displayMode', 'modal-hint');
      fixture.componentRef.setInput('controls', []);
      fixture.detectChanges();

      // Empty array should trigger service fallback
      const resolved = component.resolvedControls();
      expect(mockGameControls.getControlsForState).toHaveBeenCalled();
      expect(resolved).toEqual(defaultControls);
    });

    it('should use pause controls from service when resolvedDisplayMode is pause-menu', () => {
      fixture.componentRef.setInput('displayMode', 'gameplay');
      fixture.componentRef.setInput('gameState', 'pause');
      fixture.detectChanges();

      expect(component.resolvedDisplayMode()).toBe('pause-menu');
      const resolved = component.resolvedControls();
      expect(mockGameControls.getControlsForState).toHaveBeenCalledWith('pause');
      expect(resolved).toEqual(pauseControls);
    });
  });
});
