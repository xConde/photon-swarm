import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ShipPreviewComponent } from './ship-preview.component';
import { PlayerService } from '../../core/player/player.service';

describe('ShipPreviewComponent', () => {
  let fixture: ComponentFixture<ShipPreviewComponent>;
  let component: ShipPreviewComponent;
  let mockPlayerService: jasmine.SpyObj<PlayerService>;

  const ALL_SHAPE_IDS = ['default-circle', 'triangle', 'hexagon', 'star', 'diamond', 'crescent', 'arrow', 'square'];

  beforeEach(async () => {
    mockPlayerService = jasmine.createSpyObj('PlayerService', ['renderShipPreview']);

    await TestBed.configureTestingModule({
      imports: [ShipPreviewComponent],
      providers: [{ provide: PlayerService, useValue: mockPlayerService }],
    }).compileComponents();

    fixture = TestBed.createComponent(ShipPreviewComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should call renderShipPreview on init', () => {
    component.shapeId = 'default-circle';
    component.fillColor = 'white';
    fixture.detectChanges();
    expect(mockPlayerService.renderShipPreview).toHaveBeenCalled();
  });

  it('should re-render when shapeId input changes', () => {
    fixture.detectChanges();
    const countAfterInit = (mockPlayerService.renderShipPreview as jasmine.Spy).calls.count();

    // Simulate Angular input binding change: set value + call ngOnChanges directly
    component.shapeId = 'triangle';
    component.ngOnChanges({});
    fixture.detectChanges();

    expect((mockPlayerService.renderShipPreview as jasmine.Spy).calls.count()).toBeGreaterThan(countAfterInit);
  });

  it('should re-render when fillColor input changes', () => {
    fixture.detectChanges();
    const countAfterInit = (mockPlayerService.renderShipPreview as jasmine.Spy).calls.count();

    component.fillColor = '#ff1a1a';
    component.ngOnChanges({});
    fixture.detectChanges();

    expect((mockPlayerService.renderShipPreview as jasmine.Spy).calls.count()).toBeGreaterThan(countAfterInit);
  });

  ALL_SHAPE_IDS.forEach((shapeId) => {
    it(`should render without throwing for shapeId="${shapeId}"`, () => {
      component.shapeId = shapeId;
      component.fillColor = 'white';
      expect(() => fixture.detectChanges()).not.toThrow();
    });
  });
});
