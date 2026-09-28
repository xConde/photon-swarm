import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { XpBarComponent } from './xp-bar.component';
import { ProgressionSystemService } from '../../../core/progression/progression-system.service';
import { PlayerUIData, UIQuerySystemService } from '../../../core/systems/gameplay';

describe('XpBarComponent', () => {
  let progressionSpy: jasmine.SpyObj<ProgressionSystemService>;
  let uiQuerySpy: jasmine.SpyObj<UIQuerySystemService>;
  let playerStats$: Subject<PlayerUIData | null>;

  beforeEach(async () => {
    progressionSpy = jasmine.createSpyObj('ProgressionSystemService', ['getXpForNextLevel'], {
      level: 1,
      xp: 0,
    });
    progressionSpy.getXpForNextLevel.and.returnValue(100);

    playerStats$ = new Subject<PlayerUIData | null>();
    uiQuerySpy = jasmine.createSpyObj('UIQuerySystemService', ['getPlayerStats'], {
      playerStats$,
    });

    await TestBed.configureTestingModule({
      imports: [XpBarComponent],
      providers: [
        { provide: ProgressionSystemService, useValue: progressionSpy },
        { provide: UIQuerySystemService, useValue: uiQuerySpy },
      ],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(XpBarComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    fixture.destroy();
  });

  it('should have displayedProgress initialized to 0', () => {
    const fixture = TestBed.createComponent(XpBarComponent);
    // Before ngOnInit fires polling — the field is initialized to 0 in the class definition
    expect(fixture.componentInstance.displayedProgress).toBe(0);
    fixture.destroy();
  });

  it('should have currentLevel initialized to 1', () => {
    const fixture = TestBed.createComponent(XpBarComponent);
    expect(fixture.componentInstance.currentLevel).toBe(1);
    fixture.destroy();
  });

  describe('levelTier', () => {
    it('should return "early" for levels 1–10', () => {
      const fixture = TestBed.createComponent(XpBarComponent);
      const component = fixture.componentInstance;

      component.currentLevel = 1;
      expect(component.levelTier).toBe('early');

      component.currentLevel = 10;
      expect(component.levelTier).toBe('early');

      fixture.destroy();
    });

    it('should return "mid" for levels 11–25', () => {
      const fixture = TestBed.createComponent(XpBarComponent);
      const component = fixture.componentInstance;

      component.currentLevel = 11;
      expect(component.levelTier).toBe('mid');

      component.currentLevel = 25;
      expect(component.levelTier).toBe('mid');

      fixture.destroy();
    });

    it('should return "late" for levels 26–40', () => {
      const fixture = TestBed.createComponent(XpBarComponent);
      const component = fixture.componentInstance;

      component.currentLevel = 26;
      expect(component.levelTier).toBe('late');

      component.currentLevel = 40;
      expect(component.levelTier).toBe('late');

      fixture.destroy();
    });

    it('should return "max" for levels above 40', () => {
      const fixture = TestBed.createComponent(XpBarComponent);
      const component = fixture.componentInstance;

      component.currentLevel = 41;
      expect(component.levelTier).toBe('max');

      component.currentLevel = 99;
      expect(component.levelTier).toBe('max');

      fixture.destroy();
    });
  });
});
