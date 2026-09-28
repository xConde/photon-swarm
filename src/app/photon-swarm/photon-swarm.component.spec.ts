import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PhotonSwarmComponent } from './photon-swarm.component';

// No existing spec covered this root component before WS4 (its dependency
// graph is large — full game engine/services init on a real <canvas>). This
// spec is intentionally narrow: it only proves the WS4 sr-only h1 addition
// renders, using CUSTOM_ELEMENTS_SCHEMA + a stripped imports override (like
// TheaterComponent's own spec pattern) so the many child game components
// don't need their own mocks for a single static-markup assertion.
describe('PhotonSwarmComponent (WS4: h1 smoke test)', () => {
  let fixture: ComponentFixture<PhotonSwarmComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PhotonSwarmComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(PhotonSwarmComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(PhotonSwarmComponent);
    fixture.detectChanges();
  });

  it('renders a visually-hidden h1 with the project title (projects-detail unmounts its own on demo launch)', () => {
    const h1 = (fixture.nativeElement as HTMLElement).querySelector('h1.sr-only');
    expect(h1?.textContent?.trim()).toBe('Photon Swarm');
  });
});
