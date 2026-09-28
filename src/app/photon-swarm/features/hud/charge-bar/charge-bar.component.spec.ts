import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ChargeBarComponent } from './charge-bar.component';
import { PlayerUIData, UIQuerySystemService } from '../../../core/systems/gameplay';

describe('ChargeBarComponent', () => {
  let uiQuerySpy: jasmine.SpyObj<UIQuerySystemService>;
  let playerStats$: Subject<PlayerUIData | null>;

  beforeEach(async () => {
    playerStats$ = new Subject<PlayerUIData | null>();
    uiQuerySpy = jasmine.createSpyObj('UIQuerySystemService', ['getPlayerStats'], {
      playerStats$,
    });

    await TestBed.configureTestingModule({
      imports: [ChargeBarComponent],
      providers: [{ provide: UIQuerySystemService, useValue: uiQuerySpy }],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(ChargeBarComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    fixture.destroy();
  });

  it('should have displayedCharge initialized to 100 (full charge at game start)', () => {
    const fixture = TestBed.createComponent(ChargeBarComponent);
    expect(fixture.componentInstance.displayedCharge).toBe(100);
    fixture.destroy();
  });

  it('should start with isFullCharge true (player starts with full resource)', () => {
    const fixture = TestBed.createComponent(ChargeBarComponent);
    expect(fixture.componentInstance.isFullCharge).toBe(true);
    fixture.destroy();
  });

  it('should start with chargeFullPulse false', () => {
    const fixture = TestBed.createComponent(ChargeBarComponent);
    expect(fixture.componentInstance.chargeFullPulse).toBe(false);
    fixture.destroy();
  });

  it('should start with fireDrain false', () => {
    const fixture = TestBed.createComponent(ChargeBarComponent);
    expect(fixture.componentInstance.fireDrain).toBe(false);
    fixture.destroy();
  });

  it('should have activeChargeType initialized to "cooldown"', () => {
    const fixture = TestBed.createComponent(ChargeBarComponent);
    expect(fixture.componentInstance.activeChargeType).toBe('cooldown');
    fixture.destroy();
  });
});
