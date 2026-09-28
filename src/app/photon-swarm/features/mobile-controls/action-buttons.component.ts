import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  inject,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subscription } from 'rxjs';

import { ControlIconName, getControlIcon } from '../../utils/control-icons';
import { ActionButtonEvent } from './mobile-controls.types';
import { TouchDetectionService } from './touch-detection.service';

/** Canonical weapon modes: 'shot' = projectile firing, 'beam' = continuous beam. */
export type WeaponMode = 'beam' | 'shot';

@Component({
  selector: 'app-action-buttons',
  standalone: true,
  imports: [],
  templateUrl: './action-buttons.component.html',
  styleUrls: ['./action-buttons.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionButtonsComponent implements OnInit, OnDestroy {
  @Output() readonly actionPress = new EventEmitter<ActionButtonEvent>();

  /** Current weapon mode — drives the weapon-toggle button label/icon/aria. */
  @Input() weaponMode: WeaponMode = 'beam';

  /**
   * Real on/off state of the mode-dependent secondary ability the FOCUS button drives:
   * Focus Fire in shot mode, Auto-Beam in beam mode. Fed from the parent's live player
   * state so the button reflects reality instead of a naive per-tap toggle (which desynced
   * on weapon-mode switches and made it look like "focus fire isn't working").
   */
  @Input() secondaryActive = false;

  /**
   * Parry cooldown as a fraction: 1 → cooldown just started, 0 → parry ready.
   * Drives the recovery ring + dimmed state on the parry button. Fed per-frame from
   * the parent (same live-player-state pattern as [secondaryActive]).
   */
  @Input() parryCooldown = 0;

  /**
   * Whether the Automap overlay is currently open — keeps the Map utility button lit
   * and its aria-label honest ("Close Map") while the overlay is on screen. Fed from
   * the parent's showMap state (desktop's M-key legend already toggles this way).
   */
  @Input() mapOpen = false;

  isVisible = false;
  activeButtons: Record<string, boolean> = {};

  private readonly touchDetection = inject(TouchDetectionService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly sanitizer = inject(DomSanitizer);
  private deviceSubscription: Subscription | undefined;

  /**
   * Pre-sanitized control-button SVG icons, keyed by name. Built once (the icons are
   * static) so the OnPush template can bind [innerHTML] without re-sanitizing per CD.
   * Note: 'burst' and 'auto-beam' omitted — Burst moved to the aim-stick press gesture;
   * Focus is always the focus icon (no longer morphs with weapon mode).
   */
  readonly icons: Record<string, SafeHtml> = {
    'weapon-beam': this.safeIcon('weapon-beam'),
    'weapon-shot': this.safeIcon('weapon-shot'),
    dash: this.safeIcon('dash'),
    parry: this.safeIcon('parry'),
    focus: this.safeIcon('focus'),
    map: this.safeIcon('map'),
  };

  private safeIcon(name: ControlIconName): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(getControlIcon(name));
  }

  ngOnInit(): void {
    this.deviceSubscription = this.touchDetection.getShowVirtualControls().subscribe((show) => {
      this.isVisible = show;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.deviceSubscription?.unsubscribe();
  }

  onPress(action: ActionButtonEvent['action'], event: TouchEvent): void {
    event.preventDefault();
    this.activeButtons[action] = true;
    this.actionPress.emit({ action, pressed: true });
  }

  onRelease(action: ActionButtonEvent['action'], event: TouchEvent): void {
    event.preventDefault();
    this.activeButtons[action] = false;
    this.actionPress.emit({ action, pressed: false });
  }

  /** Emit a Focus Fire / Auto-Beam toggle. The active state is reflected from the real
   *  player state via [secondaryActive], not a local toggle (which desynced on mode switch). */
  onFocusFirePress(event: TouchEvent): void {
    event.preventDefault();
    this.actionPress.emit({ action: 'focusFire', pressed: true });
  }
}
