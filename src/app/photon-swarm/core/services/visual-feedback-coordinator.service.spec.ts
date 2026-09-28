import { TestBed } from '@angular/core/testing';
import { VisualFeedbackCoordinatorService } from './visual-feedback-coordinator.service';
import { KillFeedComponent } from '../../features/kill-feed/kill-feed.component';
import { UpgradeNotificationsComponent } from '../../features/upgrade-notifications/upgrade-notifications.component';

describe('VisualFeedbackCoordinatorService', () => {
  let service: VisualFeedbackCoordinatorService;
  let mockKillFeed: jasmine.SpyObj<KillFeedComponent>;
  let mockUpgradeNotifications: jasmine.SpyObj<UpgradeNotificationsComponent>;

  beforeEach(() => {
    mockKillFeed = jasmine.createSpyObj('KillFeedComponent', ['addKill']);
    mockUpgradeNotifications = jasmine.createSpyObj('UpgradeNotificationsComponent', ['showUpgrade']);

    TestBed.configureTestingModule({
      providers: [VisualFeedbackCoordinatorService],
    });

    service = TestBed.inject(VisualFeedbackCoordinatorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('registerComponents', () => {
    it('should register kill feed component', () => {
      service.registerComponents(mockKillFeed);

      service.showKill('basic', 1, 10);

      expect(mockKillFeed.addKill).toHaveBeenCalledWith('basic', 1, 10);
    });

    it('should register upgrade notifications component', () => {
      service.registerComponents(undefined, mockUpgradeNotifications);

      service.showUpgrade('Speed Boost', 'Move 10% faster', 'buff', 'common');

      expect(mockUpgradeNotifications.showUpgrade).toHaveBeenCalledWith(
        'Speed Boost',
        'Move 10% faster',
        'buff',
        'common'
      );
    });

    it('should register both components', () => {
      service.registerComponents(mockKillFeed, mockUpgradeNotifications);

      service.showKill('boss', 2, 100);
      service.showUpgrade('Damage Up', '+20% damage', 'upgrade', 'rare');

      expect(mockKillFeed.addKill).toHaveBeenCalledWith('boss', 2, 100);
      expect(mockUpgradeNotifications.showUpgrade).toHaveBeenCalledWith('Damage Up', '+20% damage', 'upgrade', 'rare');
    });
  });

  describe('showKill', () => {
    it('should not throw when kill feed is not registered', () => {
      expect(() => service.showKill('basic', 1, 10)).not.toThrow();
    });

    it('should delegate to kill feed when registered', () => {
      service.registerComponents(mockKillFeed);

      service.showKill('tank', 3, 50);

      expect(mockKillFeed.addKill).toHaveBeenCalledWith('tank', 3, 50);
    });

    it('should pass correct parameters', () => {
      service.registerComponents(mockKillFeed);

      service.showKill('elite', 5, 75);

      expect(mockKillFeed.addKill).toHaveBeenCalledOnceWith('elite', 5, 75);
    });
  });

  describe('showUpgrade', () => {
    it('should not throw when upgrade notifications is not registered', () => {
      expect(() => service.showUpgrade('Test', 'Description', 'type')).not.toThrow();
    });

    it('should delegate to upgrade notifications when registered', () => {
      service.registerComponents(undefined, mockUpgradeNotifications);

      service.showUpgrade('Fire Rate', 'Shoot faster', 'buff');

      expect(mockUpgradeNotifications.showUpgrade).toHaveBeenCalledWith('Fire Rate', 'Shoot faster', 'buff', undefined);
    });

    it('should pass tier parameter correctly', () => {
      service.registerComponents(undefined, mockUpgradeNotifications);

      service.showUpgrade('Shield', 'Blocks damage', 'defense', 'legendary');

      expect(mockUpgradeNotifications.showUpgrade).toHaveBeenCalledWith(
        'Shield',
        'Blocks damage',
        'defense',
        'legendary'
      );
    });
  });

  describe('clear', () => {
    it('should clear kill feed reference', () => {
      service.registerComponents(mockKillFeed);
      service.clear();

      service.showKill('basic', 1, 10);

      expect(mockKillFeed.addKill).not.toHaveBeenCalled();
    });

    it('should clear upgrade notifications reference', () => {
      service.registerComponents(undefined, mockUpgradeNotifications);
      service.clear();

      service.showUpgrade('Test', 'Description', 'type');

      expect(mockUpgradeNotifications.showUpgrade).not.toHaveBeenCalled();
    });

    it('should clear both components', () => {
      service.registerComponents(mockKillFeed, mockUpgradeNotifications);
      service.clear();

      service.showKill('basic', 1, 10);
      service.showUpgrade('Test', 'Description', 'type');

      expect(mockKillFeed.addKill).not.toHaveBeenCalled();
      expect(mockUpgradeNotifications.showUpgrade).not.toHaveBeenCalled();
    });

    it('should allow re-registration after clear', () => {
      service.registerComponents(mockKillFeed, mockUpgradeNotifications);
      service.clear();
      service.registerComponents(mockKillFeed, mockUpgradeNotifications);

      service.showKill('basic', 1, 10);

      expect(mockKillFeed.addKill).toHaveBeenCalled();
    });
  });
});
