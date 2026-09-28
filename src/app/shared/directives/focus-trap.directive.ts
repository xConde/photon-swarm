import { booleanAttribute, DestroyRef, Directive, effect, ElementRef, inject, input, signal } from '@angular/core';

export type FocusTrapInitialTarget = 'first' | 'container';

/**
 * Keeps keyboard focus inside an active modal surface and restores the trigger
 * when the surface closes.
 *
 * The default moves focus to the first interactive descendant. Canvas-led or
 * read-only dialogs can opt into `focusTrapInitial="container"` so the dialog
 * itself is announced before any controls.
 */
@Directive({
  selector: '[appFocusTrap]',
  standalone: true,
  host: {
    '(keydown.tab)': 'onTab($event)',
    '(keydown.shift.tab)': 'onShiftTab($event)',
  },
})
export class FocusTrapDirective {
  readonly appFocusTrap = input(false, { transform: booleanAttribute });
  readonly focusTrapInitial = input<FocusTrapInitialTarget>('first');

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly previouslyFocused = signal<HTMLElement | null>(null);
  private focusRequest = 0;
  private destroyed = false;

  private static readonly FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  constructor() {
    effect(() => {
      const enabled = this.appFocusTrap();
      // Read the initial-target input in the same reactive context so a mode
      // change while open deliberately repositions focus.
      const initialTarget = this.focusTrapInitial();

      if (enabled) {
        if (!this.previouslyFocused()) {
          const active = document.activeElement;
          this.previouslyFocused.set(active instanceof HTMLElement ? active : null);
        }
        this.requestInitialFocus(initialTarget);
      } else {
        this.cancelPendingFocus();
        this.restorePreviousFocus();
      }
    });

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.cancelPendingFocus();
      this.restorePreviousFocus();
    });
  }

  onTab(event: Event): void {
    this.wrapFocus(event, false);
  }

  onShiftTab(event: Event): void {
    this.wrapFocus(event, true);
  }

  private wrapFocus(event: Event, backwards: boolean): void {
    if (!this.appFocusTrap()) return;

    const host = this.element.nativeElement;
    const focusable = this.getFocusable();
    const active = document.activeElement;

    if (focusable.length === 0) {
      event.preventDefault();
      host.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const focusIsOutside = !(active instanceof Node) || !host.contains(active);

    if (backwards && (active === first || active === host || focusIsOutside)) {
      event.preventDefault();
      last.focus();
    } else if (!backwards && (active === last || focusIsOutside)) {
      event.preventDefault();
      first.focus();
    }
  }

  private getFocusable(): HTMLElement[] {
    return Array.from(
      this.element.nativeElement.querySelectorAll<HTMLElement>(FocusTrapDirective.FOCUSABLE_SELECTOR)
    ).filter(
      (node) =>
        node.isConnected &&
        !node.matches(':disabled') &&
        !node.closest('[hidden], [aria-hidden="true"]') &&
        node.tabIndex !== -1 &&
        !node.closest('[inert]') &&
        node.getClientRects().length > 0 &&
        getComputedStyle(node).visibility !== 'hidden'
    );
  }

  private requestInitialFocus(initialTarget: FocusTrapInitialTarget): void {
    const request = ++this.focusRequest;
    queueMicrotask(() => {
      if (this.destroyed || request !== this.focusRequest || !this.appFocusTrap()) return;

      const host = this.element.nativeElement;
      if (!host.isConnected) return;

      if (initialTarget === 'container') {
        this.focusContainer();
        return;
      }

      const first = this.getFocusable()[0];
      if (first) {
        first.focus();
      } else {
        this.focusContainer();
      }
    });
  }

  private focusContainer(): void {
    const host = this.element.nativeElement;
    if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '-1');
    host.focus();
  }

  private cancelPendingFocus(): void {
    this.focusRequest++;
  }

  private restorePreviousFocus(): void {
    const previous = this.previouslyFocused();
    if (previous?.isConnected && typeof previous.focus === 'function') {
      previous.focus();
    }
    this.previouslyFocused.set(null);
  }
}
