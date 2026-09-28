import { TestBed } from '@angular/core/testing';
import {
  type DamageEvent,
  DebugLogBridgeService,
  type HealEvent,
  LogLevel,
  type LogType,
} from './debug-log-bridge.service';

describe('DebugLogBridgeService', () => {
  let service: DebugLogBridgeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DebugLogBridgeService);
    // Ensure debug is enabled (tests run in dev mode)
    service.setDebugEnabled(true);
    service.setLogLevel(LogLevel.DEBUG);
    service.clearHistories();
  });

  // -----------------------------------------------------------------------
  // isDebugEnabled / setDebugEnabled
  // -----------------------------------------------------------------------

  it('should be debug-enabled by default in non-production', () => {
    expect(service.isDebugEnabled()).toBeTrue();
  });

  it('setDebugEnabled should return true in dev mode', () => {
    expect(service.setDebugEnabled(false)).toBeTrue();
    expect(service.isDebugEnabled()).toBeFalse();
    service.setDebugEnabled(true); // restore
  });

  // -----------------------------------------------------------------------
  // Log level
  // -----------------------------------------------------------------------

  it('should default to INFO log level', () => {
    const fresh = new DebugLogBridgeService();
    expect(fresh.getLogLevel()).toBe(LogLevel.INFO);
  });

  it('setLogLevel and getLogLevel round-trip', () => {
    service.setLogLevel(LogLevel.ERROR);
    expect(service.getLogLevel()).toBe(LogLevel.ERROR);
  });

  it('log() at DEBUG level should be filtered when current level is WARNING', () => {
    service.setLogLevel(LogLevel.WARNING);

    const emitted: string[] = [];
    service.debugLog$.subscribe((entry) => emitted.push(entry.message));

    service.log('a debug message', 'info');
    expect(emitted.length).toBe(0);
  });

  it('log() at ERROR level should always be emitted regardless of filter', () => {
    service.setLogLevel(LogLevel.ERROR);

    const emitted: string[] = [];
    service.debugLog$.subscribe((entry) => emitted.push(entry.message));

    service.log('critical problem', 'error');
    expect(emitted).toContain('critical problem');
  });

  // -----------------------------------------------------------------------
  // general log()
  // -----------------------------------------------------------------------

  it('log() emits entry on debugLog$ with correct type', () => {
    const received: { message: string; type: LogType }[] = [];
    service.debugLog$.subscribe((entry) => received.push({ message: entry.message, type: entry.type }));

    service.log('hello world', 'info');

    expect(received.length).toBe(1);
    expect(received[0].message).toBe('hello world');
    expect(received[0].type).toBe('info');
  });

  it('log() does nothing when debugEnabled is false', () => {
    service.setDebugEnabled(false);

    const emitted: string[] = [];
    service.debugLog$.subscribe((entry) => emitted.push(entry.message));

    service.log('should not appear', 'info');
    expect(emitted.length).toBe(0);

    service.setDebugEnabled(true); // restore
  });

  // -----------------------------------------------------------------------
  // logDamage()
  // -----------------------------------------------------------------------

  it('logDamage() adds event to damage history', () => {
    service.logDamage({ amount: 25, source: 'enemy', healthBefore: 100, healthAfter: 75 }, false);
    const history = service.getDamageHistory();
    expect(history.length).toBe(1);
    expect(history[0].amount).toBe(25);
    expect(history[0].source).toBe('enemy');
  });

  it('logDamage() marks suspicious events with SUSPICIOUS_DAMAGE label', () => {
    service.logDamage({ amount: 999, source: 'cheat', healthBefore: 100, healthAfter: 0 }, true);
    const history = service.getDamageHistory();
    expect(history[0].label).toBe('SUSPICIOUS_DAMAGE');
    expect(history[0].suspicious).toBeTrue();
  });

  it('logDamage() emits on debugLog$ with error type when suspicious', () => {
    const types: LogType[] = [];
    service.debugLog$.subscribe((entry) => types.push(entry.type));

    service.logDamage({ amount: 50 }, true);
    expect(types).toContain('error');
  });

  it('logDamage() emits on debugLog$ with warning type when not suspicious', () => {
    const types: LogType[] = [];
    service.debugLog$.subscribe((entry) => types.push(entry.type));

    service.logDamage({ amount: 10, source: 'bullet' }, false);
    expect(types).toContain('warning');
  });

  it('logDamage() caps history at MAX_HISTORY (100)', () => {
    for (let i = 0; i < 105; i++) {
      service.logDamage({ amount: i }, false);
    }
    expect(service.getDamageHistory().length).toBe(100);
  });

  // -----------------------------------------------------------------------
  // logHeal()
  // -----------------------------------------------------------------------

  it('logHeal() adds event to heal history', () => {
    service.logHeal({ amount: 30, source: 'potion', healthBefore: 50, healthAfter: 80 }, false);
    const history = service.getHealHistory();
    expect(history.length).toBe(1);
    expect(history[0].amount).toBe(30);
    expect(history[0].label).toBe('HEAL_APPLIED');
  });

  it('logHeal() marks suspicious heals with SUSPICIOUS_HEAL label', () => {
    service.logHeal({ amount: 500 }, true);
    const history = service.getHealHistory();
    expect(history[0].label).toBe('SUSPICIOUS_HEAL');
    expect(history[0].suspicious).toBeTrue();
  });

  it('logHeal() falls back to valueBefore/valueAfter aliases', () => {
    service.logHeal({ valueBefore: 20, valueAfter: 60, amount: 40 }, false);
    const history = service.getHealHistory();
    // healthBefore sourced from valueBefore when healthBefore is undefined
    expect(history[0].healthBefore).toBe(20);
    expect(history[0].healthAfter).toBe(60);
  });

  it('logHeal() caps history at MAX_HISTORY (100)', () => {
    for (let i = 0; i < 105; i++) {
      service.logHeal({ amount: i }, false);
    }
    expect(service.getHealHistory().length).toBe(100);
  });

  // -----------------------------------------------------------------------
  // clearHistories()
  // -----------------------------------------------------------------------

  it('clearHistories() empties both damage and heal histories', () => {
    service.logDamage({ amount: 10 }, false);
    service.logHeal({ amount: 10 }, false);
    service.clearHistories();
    expect(service.getDamageHistory().length).toBe(0);
    expect(service.getHealHistory().length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // getSuspiciousEvents()
  // -----------------------------------------------------------------------

  it('getSuspiciousEvents() returns only events flagged suspicious', () => {
    service.logDamage({ amount: 5 }, false);
    service.logDamage({ amount: 999 }, true);
    service.logHeal({ amount: 5 }, false);
    service.logHeal({ amount: 999 }, true);

    const suspicious = service.getSuspiciousEvents();
    expect(suspicious.damage.length).toBe(1);
    expect(suspicious.heal.length).toBe(1);
    expect(suspicious.damage[0].suspicious).toBeTrue();
  });

  // -----------------------------------------------------------------------
  // exportHealthEventData()
  // -----------------------------------------------------------------------

  it('exportHealthEventData() returns correct totals and suspicious counts', () => {
    service.logDamage({ amount: 5 }, false);
    service.logDamage({ amount: 999 }, true);
    service.logHeal({ amount: 10 }, false);

    const exported = service.exportHealthEventData();
    expect(exported.damageHistory.total).toBe(2);
    expect(exported.damageHistory.suspicious).toBe(1);
    expect(exported.healHistory.total).toBe(1);
    expect(exported.healHistory.suspicious).toBe(0);
    expect(exported.exportTime).toBeGreaterThan(0);
  });

  it('getDamageHistory() returns a copy, not the internal array', () => {
    service.logDamage({ amount: 10 }, false);
    const copy = service.getDamageHistory();
    copy.push({} as DamageEvent);
    expect(service.getDamageHistory().length).toBe(1);
  });

  it('getHealHistory() returns a copy, not the internal array', () => {
    service.logHeal({ amount: 10 }, false);
    const copy = service.getHealHistory();
    copy.push({} as HealEvent);
    expect(service.getHealHistory().length).toBe(1);
  });
});
