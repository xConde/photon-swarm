import { Injectable } from '@angular/core';
import { StorageService } from './storage.service';

export interface Cosmetic {
  id: string;
  name: string;
  description: string;
  type: CosmeticType;
  cost: number;
  unlocked: boolean;
  colors?: string[];
  preview?: string;
  active?: boolean;
  icon?: string;
}

export type CosmeticType = 'shipColor' | 'beamColor' | 'shipShape' | 'accessory';

@Injectable({
  providedIn: 'root',
})
export class CosmeticsService {
  private readonly COSMETICS_KEY = 'photon-swarm-cosmetics';
  private readonly ACTIVE_COSMETICS_KEY = 'photon-swarm-active-cosmetics';

  private cosmetics: Cosmetic[] = [];
  private activeCosmetics: Record<CosmeticType, string> = {
    shipColor: 'default-white',
    beamColor: 'default-cyan',
    shipShape: 'default-circle',
    accessory: 'none',
  };

  constructor(private storageService: StorageService) {
    this.initializeCosmetics();
    this.loadSavedCosmetics();
  }

  private initializeCosmetics(): void {
    this.cosmetics = [
      // Ship Colors
      {
        id: 'default-white',
        name: 'Default White',
        description: 'The standard ship color.',
        type: 'shipColor',
        cost: 0,
        unlocked: true,
        colors: ['white'],
        icon: 'fas fa-palette',
      },
      {
        id: 'neon-blue',
        name: 'Neon Blue',
        description: 'A bright blue ship that stands out in the darkness.',
        type: 'shipColor',
        cost: 1000,
        unlocked: false,
        colors: ['#00ddff'],
        icon: 'fas fa-palette',
      },
      {
        id: 'crimson',
        name: 'Crimson',
        description: 'A deep red ship that signals danger.',
        type: 'shipColor',
        cost: 1500,
        unlocked: false,
        colors: ['#ff1a1a'],
        icon: 'fas fa-palette',
      },
      {
        id: 'neon-green',
        name: 'Neon Green',
        description: 'A vibrant green ship that glows in the void.',
        type: 'shipColor',
        cost: 2000,
        unlocked: false,
        colors: ['#00ff66'],
        icon: 'fas fa-palette',
      },
      {
        id: 'royal-purple',
        name: 'Royal Purple',
        description: 'A regal purple ship fit for cosmic royalty.',
        type: 'shipColor',
        cost: 2500,
        unlocked: false,
        colors: ['#9900ff'],
        icon: 'fas fa-palette',
      },
      {
        id: 'sunset-orange',
        name: 'Sunset Orange',
        description: 'A warm orange ship reminiscent of distant suns.',
        type: 'shipColor',
        cost: 2800,
        unlocked: false,
        colors: ['#ff6600'],
        icon: 'fas fa-palette',
      },
      {
        id: 'golden',
        name: 'Golden',
        description: 'A prestigious golden ship.',
        type: 'shipColor',
        cost: 3000,
        unlocked: false,
        colors: ['#ffcc00'],
        icon: 'fas fa-palette',
      },
      {
        id: 'void-black',
        name: 'Void Black',
        description: 'A sleek black ship that blends with the darkness of space.',
        type: 'shipColor',
        cost: 5000,
        unlocked: false,
        colors: ['#000000'],
        icon: 'fas fa-palette',
      },
      {
        id: 'rainbow-ship',
        name: 'Rainbow Ship',
        description: 'Your ship cycles through colors of the rainbow.',
        type: 'shipColor',
        cost: 10000,
        unlocked: false,
        colors: ['#ff0000', '#ff9900', '#ffff00', '#00ff00', '#0099ff', '#6633ff'],
        icon: 'fas fa-palette',
      },

      // Beam Colors
      {
        id: 'default-cyan',
        name: 'Default Cyan',
        description: 'The standard beam color.',
        type: 'beamColor',
        cost: 0,
        unlocked: true,
        colors: ['cyan'],
        icon: 'fas fa-magic',
      },
      {
        id: 'solar-orange',
        name: 'Solar Orange',
        description: 'A beam that burns with the intensity of a star.',
        type: 'beamColor',
        cost: 4000,
        unlocked: false,
        colors: ['#ff7700'],
        icon: 'fas fa-magic',
      },
      {
        id: 'purple-beam',
        name: 'Purple Beam',
        description: 'A mystical purple beam.',
        type: 'beamColor',
        cost: 5000,
        unlocked: false,
        colors: ['#cc33ff'],
        icon: 'fas fa-magic',
      },
      {
        id: 'green-beam',
        name: 'Green Beam',
        description: 'A toxic green beam.',
        type: 'beamColor',
        cost: 5500,
        unlocked: false,
        colors: ['#33ff33'],
        icon: 'fas fa-magic',
      },
      {
        id: 'plasma-pink',
        name: 'Plasma Pink',
        description: 'A beam of superheated plasma with a distinctive pink glow.',
        type: 'beamColor',
        cost: 6000,
        unlocked: false,
        colors: ['#ff66cc'],
        icon: 'fas fa-magic',
      },
      {
        id: 'lightning-yellow',
        name: 'Lightning Yellow',
        description: 'A crackling beam that resembles lightning arcs.',
        type: 'beamColor',
        cost: 7500,
        unlocked: false,
        colors: ['#ffcc00'],
        icon: 'fas fa-magic',
      },
      {
        id: 'frost-white',
        name: 'Frost White',
        description: 'A beam of intense cold that leaves a trail of frost.',
        type: 'beamColor',
        cost: 8000,
        unlocked: false,
        colors: ['#ffffff'],
        icon: 'fas fa-magic',
      },
      {
        id: 'void-black-beam',
        name: 'Void Black Beam',
        description: 'A beam of dark energy that consumes everything.',
        type: 'beamColor',
        cost: 10000,
        unlocked: false,
        colors: ['#000000'],
        icon: 'fas fa-magic',
      },
      {
        id: 'rainbow-beam',
        name: 'Rainbow Beam',
        description: 'Your beam cycles through colors of the rainbow.',
        type: 'beamColor',
        cost: 15000,
        unlocked: false,
        colors: ['#ff0000', '#ff9900', '#ffff00', '#00ff00', '#0099ff', '#6633ff'],
        icon: 'fas fa-magic',
      },

      // Ship Shapes
      {
        id: 'default-circle',
        name: 'Default Circle',
        description: 'The standard ship shape.',
        type: 'shipShape',
        cost: 0,
        unlocked: true,
        icon: 'fas fa-circle',
      },
      {
        id: 'triangle',
        name: 'Triangle',
        description: 'A triangular ship with sharp edges.',
        type: 'shipShape',
        cost: 5000,
        unlocked: false,
        icon: 'fas fa-play',
      },
      {
        id: 'hexagon',
        name: 'Hexagon',
        description: 'A six-sided ship with perfect symmetry.',
        type: 'shipShape',
        cost: 7500,
        unlocked: false,
        icon: 'fas fa-shapes',
      },
      {
        id: 'star',
        name: 'Star',
        description: 'A star-shaped ship that stands out in the void.',
        type: 'shipShape',
        cost: 12500,
        unlocked: false,
        icon: 'fas fa-star',
      },
      {
        id: 'diamond',
        name: 'Diamond',
        description: 'A diamond-shaped ship that sparkles in the starlight.',
        type: 'shipShape',
        cost: 15000,
        unlocked: false,
        icon: 'fas fa-gem',
      },
      {
        id: 'crescent',
        name: 'Crescent',
        description: 'A crescent-shaped ship inspired by lunar forms.',
        type: 'shipShape',
        cost: 18000,
        unlocked: false,
        icon: 'fas fa-moon',
      },
      {
        id: 'arrow',
        name: 'Arrow',
        description: 'An arrow-shaped ship built for speed and precision.',
        type: 'shipShape',
        cost: 20000,
        unlocked: false,
        icon: 'fas fa-location-arrow',
      },
      {
        id: 'square',
        name: 'Square',
        description: 'A square ship with an industrial, utilitarian design.',
        type: 'shipShape',
        cost: 22500,
        unlocked: false,
        icon: 'fas fa-square',
      },

      // Accessories
      {
        id: 'none',
        name: 'None',
        description: 'No accessories.',
        type: 'accessory',
        cost: 0,
        unlocked: true,
        icon: 'fas fa-ban',
      },
      {
        id: 'santa-hat',
        name: 'Santa Hat',
        description: 'A festive Santa hat for your ship.',
        type: 'accessory',
        cost: 7500,
        unlocked: false,
        icon: 'fas fa-hat-wizard',
      },
      {
        id: 'energy-shield',
        name: 'Energy Shield',
        description: 'A translucent energy shield surrounds your ship.',
        type: 'accessory',
        cost: 10000,
        unlocked: false,
        icon: 'fas fa-shield-alt',
      },
      {
        id: 'satellite-orbiter',
        name: 'Satellite Orbiter',
        description: 'A small satellite orbits around your ship.',
        type: 'accessory',
        cost: 15000,
        unlocked: false,
        icon: 'fas fa-satellite',
      },
      {
        id: 'crown',
        name: 'Crown',
        description: 'A royal crown for your ship.',
        type: 'accessory',
        cost: 20000,
        unlocked: false,
        icon: 'fas fa-crown',
      },
      {
        id: 'trail-effect',
        name: 'Trail Effect',
        description: 'Your ship leaves a glowing trail as it moves.',
        type: 'accessory',
        cost: 22500,
        unlocked: false,
        icon: 'fas fa-route',
      },
      {
        id: 'halo',
        name: 'Halo',
        description: 'A divine halo for your ship.',
        type: 'accessory',
        cost: 25000,
        unlocked: false,
        icon: 'fas fa-ring',
      },
      {
        id: 'damage-aura',
        name: 'Damage Aura',
        description: 'A pulsing aura surrounds your ship, showing your power.',
        type: 'accessory',
        cost: 30000,
        unlocked: false,
        icon: 'fas fa-sun',
      },
      {
        id: 'sparkling-stars',
        name: 'Sparkling Stars',
        description: 'Tiny stars sparkle around your ship as you move.',
        type: 'accessory',
        cost: 35000,
        unlocked: false,
        icon: 'fas fa-star',
      },
    ];
  }

  private loadSavedCosmetics(): void {
    const savedCosmetics = this.storageService.get<Cosmetic[]>(this.COSMETICS_KEY);
    if (savedCosmetics) {
      // Merge saved unlocked status with default cosmetics
      this.cosmetics = this.cosmetics.map((defaultCosmetic) => {
        const savedCosmetic = savedCosmetics.find((c) => c.id === defaultCosmetic.id);
        return savedCosmetic ? { ...defaultCosmetic, unlocked: savedCosmetic.unlocked } : defaultCosmetic;
      });
    }

    const activeCosmetics = this.storageService.get<Record<CosmeticType, string>>(this.ACTIVE_COSMETICS_KEY);
    if (activeCosmetics) {
      this.activeCosmetics = activeCosmetics;
    }
  }

  saveCosmetics(): void {
    this.storageService.set(this.COSMETICS_KEY, this.cosmetics);
    this.storageService.set(this.ACTIVE_COSMETICS_KEY, this.activeCosmetics);
  }

  getCosmetics(type?: CosmeticType): Cosmetic[] {
    return type ? this.cosmetics.filter((c) => c.type === type) : this.cosmetics;
  }

  getUnlockedCosmetics(type?: CosmeticType): Cosmetic[] {
    return this.getCosmetics(type).filter((c) => c.unlocked);
  }

  unlockCosmetic(id: string): boolean {
    const cosmetic = this.cosmetics.find((c) => c.id === id);
    if (cosmetic && !cosmetic.unlocked) {
      cosmetic.unlocked = true;
      this.saveCosmetics();
      return true;
    }
    return false;
  }

  isUnlocked(id: string): boolean {
    const cosmetic = this.cosmetics.find((c) => c.id === id);
    return cosmetic ? cosmetic.unlocked : false;
  }

  setActiveCosmetic(type: CosmeticType, id: string): boolean {
    const cosmetic = this.cosmetics.find((c) => c.id === id && c.type === type);
    if (cosmetic && cosmetic.unlocked) {
      this.activeCosmetics[type] = id;
      this.saveCosmetics();
      return true;
    }
    return false;
  }

  getActiveCosmetic(type: CosmeticType): Cosmetic | undefined {
    const activeId = this.activeCosmetics[type];
    return this.cosmetics.find((c) => c.id === activeId && c.type === type);
  }

  getActiveCosmeticId(type: CosmeticType): string {
    return this.activeCosmetics[type] || '';
  }

  // Cosmetic effect methods moved from GameEngineService
  unlockRainbowBeam(): void {
    const rainbowBeamId = 'rainbow-beam';
    this.unlockCosmetic(rainbowBeamId);
    this.setActiveCosmetic('beamColor', rainbowBeamId);
    if (window.debugLogBridge) {
      window.debugLogBridge.log('COSMETIC_UNLOCK:', 'info', {
        type: 'rainbow_beam',
        timestamp: Date.now(),
      });
    }
  }

  unlockTemporaryShield(): void {
    // This is a gameplay effect rather than a cosmetic,
    // but keeping it here for compatibility
    if (window.debugLogBridge) {
      window.debugLogBridge.log('COSMETIC_UNLOCK:', 'info', {
        type: 'temporary_shield',
        timestamp: Date.now(),
      });
    }
    // Implement gameplay effect if needed
  }
}
