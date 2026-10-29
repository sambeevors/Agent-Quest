import * as Phaser from 'phaser';
import { eventBridge } from '../EventBridge';
import { Building } from '../entities/Building';
import { HeroSprite } from '../entities/HeroSprite';
import { BUILDING_DEFS, getBuildingForActivity } from '../data/building-layout';
import { ArenaFighters } from '../entities/ArenaFighters';
import { FarmWork } from '../entities/FarmWork';
import type { AgentState } from '../../types/agent';
import { heroNameFor, trainerFor } from '../../naming/hero-names';
import { sceneRenderScale } from '../dpr';
import { ARENA_NPCS, SPRITE_SCALE, TOWN_GROUND_KEY, TOWN_OVERHEAD_KEY } from '../pokemon';
import { footOf, SPAWN_TILE, tileRectToWorld, VIEW_RECT, WORLD_HEIGHT, WORLD_WIDTH, type Point } from '../town/town';
import { declutterLabels } from '../data/label-declutter';
import { iconTextureKey } from '../pokemon';
import { STATION_ITEMS } from '../../progress/stations';
import { speciesName } from '../../progress/evolution';
import type { ProgressEvent } from '../../progress/tally';
import type { PartnerStates } from '../../hooks/useProgress';

/** Set `cam.zoom` to `newZoom` while keeping the world point currently
 * under screen coordinates (sx, sy) pinned to the same screen spot.
 * Without this, Phaser's setZoom() zooms around the camera's center and
 * the map appears to slide while zooming. */
function zoomAroundPointer(cam: Phaser.Cameras.Scene2D.Camera, sx: number, sy: number, newZoom: number): void {
  const before = cam.getWorldPoint(sx, sy);
  cam.setZoom(newZoom);
  const after = cam.getWorldPoint(sx, sy);
  cam.scrollX += before.x - after.x;
  cam.scrollY += before.y - after.y;
}

/** Hide agents idle for longer than this from the Phaser scene (kept in PartyBar). */
const IDLE_HIDE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/** How often parked heroes' name labels are re-spread to clear each other. */
const LABEL_DECLUTTER_INTERVAL_MS = 200;

/** The town's overhead layer — roof eaves and tree crowns, drawn over every
 * sprite as the GBA draws its top background. Above the deepest foot y,
 * below the name labels. */
const OVERHEAD_DEPTH = 3000;

const PROGRESS_EVENTS: readonly ProgressEvent['kind'][] = ['earned', 'levelup', 'evolve'];

export class VillageScene extends Phaser.Scene {
  private buildings: Building[] = [];
  private heroes = new Map<string, HeroSprite>();
  private onAgentsUpdated: ((agents: unknown) => void) | null = null;
  private onCameraFollow: ((agentId: unknown) => void) | null = null;
  private onSelectionChanged: ((agentId: unknown) => void) | null = null;
  private onBackgroundPointerDown: ((pointer: Phaser.Input.Pointer, hits: Phaser.GameObjects.GameObject[]) => void) | null = null;
  private onProgress: ((e: unknown) => void) | null = null;
  private onPartners: ((partners: unknown) => void) | null = null;

  /** Every live hero's partner as progress/ last reported it — read when a hero spawns. */
  private partners: PartnerStates = {};

  /** Tracks which hero IDs are at each building, in arrival order. */
  private buildingSlots = new Map<string, string[]>();

  /** Tracks which building each hero is currently assigned to. */
  private heroBuildingMap = new Map<string, string>();

  /** Atmospheric effects */
  private nightOverlay: Phaser.GameObjects.Graphics | null = null;
  private rainEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private rainEmitZone: Phaser.Geom.Rectangle | null = null;
  private rainSplashEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private rainSplashZone: Phaser.Geom.Rectangle | null = null;
  private rainDarkenOverlay: Phaser.GameObjects.Graphics | null = null;
  private lightningTimer: Phaser.Time.TimerEvent | null = null;
  private onNightToggle: ((on: unknown) => void) | null = null;
  private onRainToggle: ((on: unknown) => void) | null = null;

  /** The Pokémon on Nugget Bridge — battle while a trainer is on it. */
  private arenaFighters: ArenaFighters | null = null;

  /** The farm's work roster — stations its heroes on the crops and moves
   *  them from bed to bed. Owns the farm's positions outright. */
  private farmWork: FarmWork | null = null;

  /**
   * Heroes that have finished walking to their station. An assigned hero is
   * still crossing town for a second or two, and until it gets there the
   * building is not occupied — no door swinging open for nobody, no Pokémon
   * swinging at nobody. Every occupancy tell keys off arrival, never off the
   * slot assignment.
   */
  private arrived = new Set<string>();

  /** The hero the camera is following, if any. Dropped when the user drags
   *  the map, the selection moves elsewhere, or the hero leaves town. */
  private followedId: string | null = null;

  /** World rect the camera fits. */
  private contentBounds: Phaser.Geom.Rectangle | null = null;


  /** Where new trainers appear — feet on the west edge, along Route 4. */
  private heroSpawn: Point = footOf(SPAWN_TILE);

  /** True once buildWorld() has placed the town. */
  private buildingsReady = false;

  /** Agent updates received before buildings were ready — replayed once ready. */
  private pendingAgentUpdate: AgentState[] | null = null;

  constructor() {
    super({ key: 'VillageScene' });
  }

  create(): void {
    // Out-of-map background: black so the area beyond world bounds reads as
    // empty space instead of a green field. The actual map fills the world
    // rect with its own ground layer (procedural or MapConfig tileset), so
    // this colour is only visible past the map edges or during zoom-out.
    this.cameras.main.setBackgroundColor('#000000');

    // Signal React that the town is up so it can reveal the HTML overlays
    // (TopBar, PartyBar, etc.) that should stay hidden during the BootScene.
    eventBridge.emit('village:ready');

    // The town is baked (BootScene loaded it), so the world is built here
    // and now, then the camera opens on the town itself.
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.buildWorld();

    // Re-fit when the browser/window resizes. Re-centering on bounds after
    // the zoom change keeps the map anchored in the middle of the new
    // viewport instead of drifting to the top-left.
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height);
      this.fitCamera();
      if (this.contentBounds !== null) {
        this.cameras.main.centerOn(this.contentBounds.centerX, this.contentBounds.centerY);
      } else {
        this.cameras.main.centerToBounds();
      }
    });

    // Drag to pan (mouse + touch, with threshold to avoid interfering with building clicks)
    let dragStartX = 0;
    let dragStartY = 0;
    let isDragging = false;
    let pinchStartDist = 0;
    let pinchStartZoom = 0;

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      dragStartX = pointer.x;
      dragStartY = pointer.y;
      isDragging = false;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      // Skip if two fingers are touching (pinch gesture)
      if (this.input.pointer1.isDown && this.input.pointer2.isDown) return;

      const dx = pointer.x - dragStartX;
      const dy = pointer.y - dragStartY;
      if (!isDragging && Math.abs(dx) + Math.abs(dy) > 8) {
        isDragging = true;
      }
      if (isDragging) {
        const cam = this.cameras.main;
        this.stopFollowing();
        cam.scrollX -= (pointer.x - pointer.prevPosition.x) / cam.zoom;
        cam.scrollY -= (pointer.y - pointer.prevPosition.y) / cam.zoom;
      }
    });

    // Mouse wheel to zoom — anchored on the pointer. We capture the world
    // point under the cursor before changing zoom and then shift scroll so
    // that same world point lines up under the cursor afterwards; without
    // this the camera zooms around its current center, which feels like the
    // map is locked to the top-left corner while the viewport scales.
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _gameObjects: unknown[], _deltaX: number, deltaY: number) => {
      const cam = this.cameras.main;
      const newZoom = Phaser.Math.Clamp(cam.zoom - deltaY * 0.001 * sceneRenderScale(this), this.minZoom(), this.maxZoom());
      zoomAroundPointer(cam, pointer.x, pointer.y, newZoom);
    });

    // Pinch to zoom (touch) — anchored on the midpoint between the two
    // pointers, same rationale as the wheel handler.
    this.input.addPointer(1); // enable second pointer for multi-touch
    this.events.on('update', () => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (pinchStartDist === 0) {
          pinchStartDist = dist;
          pinchStartZoom = this.cameras.main.zoom;
        } else {
          const scale = dist / pinchStartDist;
          const newZoom = Phaser.Math.Clamp(pinchStartZoom * scale, this.minZoom(), this.maxZoom());
          const mx = (p1.x + p2.x) / 2;
          const my = (p1.y + p2.y) / 2;
          zoomAroundPointer(this.cameras.main, mx, my, newZoom);
        }
      } else {
        pinchStartDist = 0;
      }
    });

    // --- Night overlay ---
    this.nightOverlay = this.add.graphics();
    this.nightOverlay.fillStyle(0x000040, 0.35);
    // Pad beyond world bounds so the overlay still covers the screen when the
    // camera is zoomed out far enough to see past the map edges.
    this.nightOverlay.fillRect(-WORLD_WIDTH, -WORLD_HEIGHT, WORLD_WIDTH * 3, WORLD_HEIGHT * 3);
    // Depth must exceed the maximum Y-sorted sprite depth (~WORLD_HEIGHT) so
     // buildings and decorations placed near the bottom of the map stay covered.
    this.nightOverlay.setDepth(5000);
    this.nightOverlay.setVisible(false);

    this.onNightToggle = (on: unknown) => {
      try { if (!this.sys.isActive()) return; } catch { return; }
      this.nightOverlay?.setVisible(on as boolean);
    };
    eventBridge.on('effect:night:toggle', this.onNightToggle);

    // --- Rain particle emitter ---
    // Short thin raindrop texture with a soft gradient — small streaks feel
    // more natural than long lines.
    if (!this.textures.exists('raindrop')) {
      const canvasTex = this.textures.createCanvas('raindrop', 2, 7);
      if (canvasTex) {
        const ctx = canvasTex.getContext();
        const grad = ctx.createLinearGradient(0, 0, 0, 7);
        grad.addColorStop(0, 'rgba(210, 225, 245, 0.0)');
        grad.addColorStop(0.5, 'rgba(210, 225, 245, 0.7)');
        grad.addColorStop(1, 'rgba(230, 240, 255, 0.9)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 2, 7);
        canvasTex.refresh();
      }
    }

    // Ground splash texture — small bright dot that fades out
    if (!this.textures.exists('rainsplash')) {
      const splashTex = this.textures.createCanvas('rainsplash', 6, 6);
      if (splashTex) {
        const ctx = splashTex.getContext();
        const g = ctx.createRadialGradient(3, 3, 0, 3, 3, 3);
        g.addColorStop(0, 'rgba(220, 235, 255, 0.9)');
        g.addColorStop(1, 'rgba(220, 235, 255, 0.0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 6, 6);
        splashTex.refresh();
      }
    }

    // Emit above the current camera worldView; the Rectangle object is mutated
    // each frame so the rain always covers whatever portion of the map the
    // player is looking at (rain stays in world space, but tracks the camera).
    this.rainEmitZone = new Phaser.Geom.Rectangle(0, 0, WORLD_WIDTH, 1);
    // Drops fall across the entire viewport — lifespan calibrated to cover the
    // full visible height at typical zoom without dying prematurely.
    this.rainEmitter = this.add.particles(0, 0, 'raindrop', {
      emitZone: { source: this.rainEmitZone as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource, type: 'random' },
      speedY: { min: 650, max: 900 },
      speedX: { min: 70, max: 130 },
      lifespan: 2500,
      alpha: { start: 0.8, end: 0.7 },
      scale: { min: 0.7, max: 1.1 },
      rotate: 8,
      quantity: 7,
      frequency: 10,
      emitting: false,
    });
    this.rainEmitter.setDepth(5001);

    // Ground splashes — short-lived puffs emitted across the viewport floor.
    this.rainSplashZone = new Phaser.Geom.Rectangle(0, 0, WORLD_WIDTH, 1);
    this.rainSplashEmitter = this.add.particles(0, 0, 'rainsplash', {
      emitZone: { source: this.rainSplashZone as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource, type: 'random' },
      speedY: { min: -30, max: -10 },
      lifespan: 350,
      alpha: { start: 0.6, end: 0 },
      scale: { start: 0.4, end: 1.1 },
      quantity: 2,
      frequency: 45,
      emitting: false,
    });
    this.rainSplashEmitter.setDepth(5000);

    // Storm darkening overlay — activates with rain, independent from night mode.
    this.rainDarkenOverlay = this.add.graphics();
    this.rainDarkenOverlay.fillStyle(0x1a2a3a, 0.30);
    this.rainDarkenOverlay.fillRect(-WORLD_WIDTH, -WORLD_HEIGHT, WORLD_WIDTH * 3, WORLD_HEIGHT * 3);
    this.rainDarkenOverlay.setDepth(4997);
    this.rainDarkenOverlay.setVisible(false);

    // Keep emit zones aligned with the current camera worldView, but clamped
    // to the world bounds so rain doesn't fall outside the map when zoomed out.
    this.events.on('update', () => {
      if (this.rainEmitZone !== null) {
        const view = this.cameras.main.worldView;
        const margin = 80;
        // Drops drift right (~speedX.max * lifespan) after spawn — pull xEnd
        // back so drifted drops still die inside the world bounds.
        const driftCompensation = 325;
        const xStart = Math.max(0, view.x - margin);
        const xEnd = Math.min(WORLD_WIDTH - driftCompensation, view.x + view.width + margin);
        this.rainEmitZone.setTo(xStart, view.y - margin, Math.max(0, xEnd - xStart), 1);
      }
      if (this.rainSplashZone !== null) {
        const view = this.cameras.main.worldView;
        const bandTop = view.y + view.height * 0.72;
        const bandHeight = view.height * 0.26;
        const xStart = Math.max(0, view.x);
        const xEnd = Math.min(WORLD_WIDTH, view.x + view.width);
        this.rainSplashZone.setTo(xStart, bandTop, Math.max(0, xEnd - xStart), bandHeight);
      }
    });

    this.onRainToggle = (on: unknown) => {
      try { if (!this.sys.isActive()) return; } catch { return; }
      if (on as boolean) {
        this.rainEmitter?.start();
        this.rainSplashEmitter?.start();
        this.rainDarkenOverlay?.setVisible(true);
        this.scheduleLightning();
      } else {
        this.rainEmitter?.stop();
        this.rainSplashEmitter?.stop();
        this.rainDarkenOverlay?.setVisible(false);
        this.lightningTimer?.remove();
        this.lightningTimer = null;
      }
    };
    eventBridge.on('effect:rain:toggle', this.onRainToggle);

    // Listen for agent updates from React
    this.onAgentsUpdated = (agents: unknown) => {
      try { if (!this.sys.isActive()) return; } catch { return; }
      this.handleAgentUpdate(agents as AgentState[]);
    };
    eventBridge.on('agents:updated', this.onAgentsUpdated);

    // Follow a hero around town when the Party Bar asks (user clicks a
    // trainer there). The lerp glides the camera over from wherever it was,
    // then keeps the trainer centred as it walks.
    this.onCameraFollow = (agentId: unknown) => {
      if (typeof agentId !== 'string') return;
      try { if (!this.sys.isActive()) return; } catch { return; }
      const hero = this.heroes.get(agentId);
      if (hero === undefined) return;
      this.followedId = agentId;
      this.cameras.main.startFollow(hero, true, 0.08, 0.08);
    };
    eventBridge.on('camera:follow', this.onCameraFollow);

    // Apply outline/tint to the selected hero whenever selection changes.
    this.onSelectionChanged = (agentId: unknown) => {
      const selectedId = typeof agentId === 'string' ? agentId : null;
      if (this.followedId !== null && this.followedId !== selectedId) this.stopFollowing();
      for (const [id, hero] of this.heroes) {
        hero.setSelected(id === selectedId);
      }
    };
    eventBridge.on('selection:changed', this.onSelectionChanged);

    // Click on TRULY empty map (no interactive object at all) → deselect
    // whatever is currently selected. We used to emit this whenever the hit
    // wasn't a hero, but that racing with the building's own `building:clicked`
    // meant clicking a building wiped its info panel the moment it opened
    // (App.handleSelectAgent(null) clears `selectedBuildingId` too). Now the
    // building's own pointerdown is responsible for switching selection.
    this.onBackgroundPointerDown = (_p, hits) => {
      if (hits.length === 0) {
        eventBridge.emit('hero:clicked', null);
      }
    };
    this.input.on('pointerdown', this.onBackgroundPointerDown);

    // Items earned, levels gained and evolutions, from useProgress — popups
    // over the hero that earned them.
    this.onProgress = (e: unknown) => {
      try { if (!this.sys.isActive()) return; } catch { return; }
      this.handleProgress(e as ProgressEvent);
    };
    for (const kind of PROGRESS_EVENTS) eventBridge.on(`progress:${kind}`, this.onProgress);
    this.onPartners = (partners: unknown) => {
      this.partners = partners as PartnerStates;
      try { if (!this.sys.isActive()) return; } catch { return; }
      for (const [id, hero] of this.heroes) {
        const species = this.partners[id]?.species;
        if (species !== undefined) hero.setPartnerSpecies(species);
      }
    };
    eventBridge.on('progress:partners', this.onPartners);

    // The scene clock is torn down with the scene, so no cleanup entry.
    this.time.addEvent({
      delay: LABEL_DECLUTTER_INTERVAL_MS,
      loop: true,
      callback: () => this.declutterHeroLabels(),
    });

    const cleanup = () => {
      if (this.onAgentsUpdated !== null) {
        eventBridge.off('agents:updated', this.onAgentsUpdated);
        this.onAgentsUpdated = null;
      }
      if (this.onNightToggle !== null) {
        eventBridge.off('effect:night:toggle', this.onNightToggle);
        this.onNightToggle = null;
      }
      if (this.onRainToggle !== null) {
        eventBridge.off('effect:rain:toggle', this.onRainToggle);
        this.onRainToggle = null;
      }
      if (this.onCameraFollow !== null) {
        eventBridge.off('camera:follow', this.onCameraFollow);
        this.onCameraFollow = null;
      }
      if (this.onSelectionChanged !== null) {
        eventBridge.off('selection:changed', this.onSelectionChanged);
        this.onSelectionChanged = null;
      }
      if (this.onBackgroundPointerDown !== null) {
        this.input.off('pointerdown', this.onBackgroundPointerDown);
        this.onBackgroundPointerDown = null;
      }
      if (this.onProgress !== null) {
        for (const kind of PROGRESS_EVENTS) eventBridge.off(`progress:${kind}`, this.onProgress);
        this.onProgress = null;
      }
      if (this.onPartners !== null) {
        eventBridge.off('progress:partners', this.onPartners);
        this.onPartners = null;
      }
      this.lightningTimer?.remove();
      this.lightningTimer = null;
      for (const hero of this.heroes.values()) {
        hero.destroy();
      }
      this.heroes.clear();
      this.buildings = [];
      this.buildingSlots.clear();
      this.heroBuildingMap.clear();
      this.arenaFighters?.destroy();
      this.arenaFighters = null;
      this.farmWork?.destroy();
      this.farmWork = null;
      this.arrived.clear();
      this.followedId = null;
      this.contentBounds = null;
    };
    this.events.on('shutdown', cleanup);
    this.events.on('destroy', cleanup);
  }

  /** Pop what a hero just earned over its head. */
  private handleProgress(e: ProgressEvent): void {
    const hero = this.heroes.get(e.agentId);
    if (hero === undefined) return;
    switch (e.kind) {
      case 'earned':
        hero.showPopup({ iconKey: iconTextureKey(STATION_ITEMS[e.activity].icon), text: `+${e.count}`, color: '#FFFFFF' });
        break;
      case 'levelup':
        hero.showPopup({ iconKey: null, text: `Lv. ${e.level}!`, color: '#FFD700' });
        break;
      case 'evolve':
        hero.evolvePartner(e.to, () => {
          hero.showPopup({ iconKey: null, text: `${speciesName(e.to)}!`, color: '#88E08A' });
        });
        break;
    }
  }

  /** Let go of the followed hero; the camera stays where it is. */
  private stopFollowing(): void {
    if (this.followedId === null) return;
    this.followedId = null;
    this.cameras.main.stopFollow();
  }

  // ---------------------------------------------------------------------------
  // The town
  // ---------------------------------------------------------------------------

  /**
   * Lay out Cerulean City: the baked ground under everything, the overhead
   * layer over every sprite, a hotspot per building, the bridge's Pokémon and
   * the flower bed's roster. Nothing is generated — the town is the game's
   * own map (see town/town.ts).
   */
  private buildWorld(): void {
    this.add.image(0, 0, TOWN_GROUND_KEY).setOrigin(0, 0).setDepth(0);
    this.add.image(0, 0, TOWN_OVERHEAD_KEY).setOrigin(0, 0).setDepth(OVERHEAD_DEPTH);

    for (const def of BUILDING_DEFS) this.buildings.push(new Building(this, def));
    this.setupArenaFighters();
    this.setupFarmWork();

    const view = tileRectToWorld(VIEW_RECT);
    this.contentBounds = new Phaser.Geom.Rectangle(view.x, view.y, view.w, view.h);
    this.fitCamera();
    this.cameras.main.centerOn(this.contentBounds.centerX, this.contentBounds.centerY);

    this.buildingsReady = true;
    if (this.pendingAgentUpdate !== null) {
      const pending = this.pendingAgentUpdate;
      this.pendingAgentUpdate = null;
      this.handleAgentUpdate(pending);
    }
  }

  /** Place the Pokémon facing the trainers on Nugget Bridge. */
  private setupArenaFighters(): void {
    this.arenaFighters?.destroy();
    this.arenaFighters = null;
    const bridge = this.buildings.find((b) => b.def.id === 'arena');
    const spots = bridge?.place.fighters?.map(footOf) ?? [];
    if (bridge === undefined || spots.length === 0) return;
    const rect = tileRectToWorld(bridge.place.rect);
    this.arenaFighters = new ArenaFighters(this, ARENA_NPCS, spots, rect.x + rect.w / 2, SPRITE_SCALE);
  }

  /** Put the flower bed's work roster over its patches. */
  private setupFarmWork(): void {
    this.farmWork?.destroy();
    this.farmWork = null;
    const beds = this.buildings.find((b) => b.def.id === 'farm')?.slotFeet() ?? [];
    if (beds.length === 0) return;
    this.farmWork = new FarmWork(
      this,
      beds,
      (heroId) => this.heroes.get(heroId),
      (heroId) => {
        this.arrived.add(heroId);
        this.refreshOccupancy('farm');
      },
    );
  }

  /** Zoom so the town's view rect fits the viewport. */
  private fitCamera(): void {
    const cam = this.cameras.main;
    const viewW = this.contentBounds?.width ?? WORLD_WIDTH;
    const viewH = this.contentBounds?.height ?? WORLD_HEIGHT;
    const zoomX = cam.width / viewW;
    const zoomY = cam.height / viewH;
    cam.setZoom(Phaser.Math.Clamp(Math.min(zoomX, zoomY) * 0.95, this.minZoom(), this.maxZoom()));
  }

  /** Upper zoom bound. 1.5 was tuned for a 1:1 (CSS pixel) framebuffer; the
   * canvas now renders at physical pixels (see dpr.ts), so camera zoom values
   * carry an extra devicePixelRatio factor and the cap scales with it to keep
   * the same apparent maximum magnification. */
  private maxZoom(): number {
    return 1.5 * sceneRenderScale(this);
  }

  /** Lower zoom bound: the larger of the two viewport/world ratios, so the
   * world always fully covers the viewport — zooming out past this would
   * expose the canvas background past the tile grid, which the user has
   * asked to avoid. */
  private minZoom(): number {
    const cam = this.cameras.main;
    if (WORLD_WIDTH <= 0 || WORLD_HEIGHT <= 0) return 0.35;
    return Math.max(cam.width / WORLD_WIDTH, cam.height / WORLD_HEIGHT);
  }

  /** Queue the next lightning strike at a random interval while rain is on. */
  private scheduleLightning(): void {
    this.lightningTimer?.remove();
    const delay = Phaser.Math.Between(5000, 13000);
    this.lightningTimer = this.time.delayedCall(delay, () => {
      this.triggerLightning();
      // Reschedule only if rain is still active.
      if (this.rainDarkenOverlay?.visible === true) this.scheduleLightning();
    });
  }

  /** Fire a bright camera flash, occasionally followed by a dimmer afterflash. */
  private triggerLightning(): void {
    try { if (!this.sys.isActive()) return; } catch { return; }
    const cam = this.cameras.main;
    cam.flash(140, 225, 232, 255, true);
    if (Math.random() < 0.55) {
      this.time.delayedCall(180, () => {
        try { if (!this.sys.isActive()) return; } catch { return; }
        cam.flash(90, 200, 215, 255, true);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Slot management
  // ---------------------------------------------------------------------------

  private addToSlot(buildingId: string, heroId: string): void {
    let slots = this.buildingSlots.get(buildingId);
    if (slots === undefined) {
      slots = [];
      this.buildingSlots.set(buildingId, slots);
    }
    if (!slots.includes(heroId)) {
      slots.push(heroId);
    }
    this.heroBuildingMap.set(heroId, buildingId);
  }

  private removeFromSlot(heroId: string): string | undefined {
    const oldBuildingId = this.heroBuildingMap.get(heroId);
    if (oldBuildingId !== undefined) {
      const slots = this.buildingSlots.get(oldBuildingId);
      if (slots !== undefined) {
        const idx = slots.indexOf(heroId);
        if (idx !== -1) slots.splice(idx, 1);
      }
      this.heroBuildingMap.delete(heroId);
    }
    this.arrived.delete(heroId);
    return oldBuildingId;
  }

  private repositionBuilding(buildingId: string): void {
    const slots = this.buildingSlots.get(buildingId);
    if (slots === undefined || slots.length === 0) return;

    // The farm's heroes don't stand on a grid — they work the beds. Its
    // roster decides where each one goes and when it moves on. (Departures
    // reach the roster through the sweep in handleAgentUpdate, which runs
    // even when the last farmer leaves and there is nothing left to lay out.)
    if (buildingId === 'farm' && this.farmWork !== null) {
      this.farmWork.setWorkers(slots);
      return;
    }

    const building = this.buildings.find((b) => b.def.id === buildingId);
    if (building === undefined) return;
    // One trainer per tile, the doorstep first — a crowd queues outward
    // from the door. Past the last baked slot, latecomers share the doorstep.
    const spots = building.slotFeet();

    for (let i = 0; i < slots.length; i++) {
      const heroId = slots[i]!;
      const hero = this.heroes.get(heroId);
      if (hero === undefined) continue;
      const spot = spots[i] ?? spots[0]!;
      // Arrival is cleared by removeFromSlot, which runs when a hero changes
      // building — the only case where it genuinely isn't there. Heroes
      // already at this building are just shuffling to make room for a new
      // arrival and stay counted, or the door would swing shut every time
      // the building gained a trainer.
      const door = building.doorFor(spot, hero.doorway);
      if (door !== null) {
        // A building's trainers go in; the slot is where their partner
        // waits outside. Arrival is the doorstep, so the door is open by
        // the time they step through it.
        hero.goInside(door, spot, hero.currentActivity, () => {
          this.arrived.add(heroId);
          this.refreshOccupancy(buildingId);
        });
        continue;
      }
      hero.moveTo(spot.x, spot.y, hero.currentActivity, () => {
        this.arrived.add(heroId);
        const focus = this.stationFocus(building.def.id, spot);
        if (focus !== null) hero.faceTowards(focus);
        // On the bridge the front row's partners go out to fight the Pokémon
        // their trainers face. Further back, the tile in front is another
        // trainer's, so the partner stays at heel.
        if (buildingId === 'arena') hero.setBattling(spot.y === spots[0]!.y ? focus : null);
        this.refreshOccupancy(buildingId);
      });
    }

    this.refreshOccupancy(buildingId);
  }

  /**
   * What a trainer stationed out of doors turns to look at, or null to keep
   * the direction it walked in. One on Nugget Bridge faces the nearest of
   * the Pokémon it battles; the flower bed's own roster turns its trainers.
   */
  private stationFocus(buildingId: string, feet: Point): Point | null {
    if (buildingId === 'arena') return this.arenaFighters?.nearest(feet) ?? null;
    return null;
  }

  /**
   * Spread the names of parked heroes so none prints over another — a crowd
   * at a door stands closer together than a name is wide. Walking heroes are
   * left out (their names sit on their heads; a passer-by shouldn't make a
   * whole crowd's labels jump) and reset their own offset when they set off.
   * Runs on a timer rather than on arrival because the farm's heroes hop
   * between beds on their own schedule.
   */
  private declutterHeroLabels(): void {
    const parked = [...this.heroes.values()].filter((h) => !h.isMoving);
    const offsets = declutterLabels(parked.map((h) => h.labelBox()));
    for (const hero of parked) hero.setLabelOffset(offsets.get(hero.id) ?? { dx: 0, lift: 0 });
  }

  /**
   * Drive a place's ambience from whether a trainer has actually got there:
   * the door standing open, and on Nugget Bridge the Pokémon squaring up.
   * Both stop the moment the last trainer leaves.
   */
  private refreshOccupancy(buildingId: string): void {
    const slots = this.buildingSlots.get(buildingId) ?? [];
    const occupied = slots.some((id) => this.arrived.has(id));
    this.buildings.find((b) => b.def.id === buildingId)?.setOccupied(occupied);
    if (buildingId === 'arena') this.arenaFighters?.setFighting(occupied);
  }

  // ---------------------------------------------------------------------------
  // Agent update handler
  // ---------------------------------------------------------------------------

  private handleAgentUpdate(agents: AgentState[]): void {
    // Defer processing until buildings are spawned — otherwise heroes walk
    // to the hardcoded BUILDING_DEFS positions instead of the map overrides.
    if (!this.buildingsReady) {
      this.pendingAgentUpdate = agents;
      return;
    }

    const now = Date.now();

    // Show active + idle-recent (< 2h), hide completed/error and idle > 2h
    const visible = agents.filter((a) => {
      if (a.status === 'completed' || a.status === 'error') return false;
      if (a.status === 'idle' && now - a.lastEvent > IDLE_HIDE_THRESHOLD_MS) return false;
      return true;
    });

    // Mixed-provider mode: show source badges only when both Claude and Codex
    // have a LIVE hero. Completed/error sessions don't count, so the badge
    // disappears the moment the last non-dormant Codex hero finishes. Mirrors
    // the flag computed in App.tsx — keep these two in sync.
    const liveAgents = agents.filter((a) => a.status !== 'completed' && a.status !== 'error');
    const hasClaude = liveAgents.some((a) => a.source === 'claude');
    const hasCodex = liveAgents.some((a) => a.source === 'codex');
    const showSourceBadge = hasClaude && hasCodex;

    // Remove heroes no longer visible
    for (const [id, hero] of this.heroes) {
      if (!visible.some((a) => a.id === id)) {
        const oldBuilding = this.removeFromSlot(id);
        if (this.followedId === id) this.stopFollowing();
        hero.destroy();
        this.heroes.delete(id);
        if (oldBuilding !== undefined) {
          this.repositionBuilding(oldBuilding);
        }
      }
    }

    // Track which buildings need repositioning
    const buildingsToReposition = new Set<string>();

    for (const agent of visible) {
      const existing = this.heroes.get(agent.id);
      const buildingDef = getBuildingForActivity(agent.currentActivity);

      if (existing === undefined) {
        // New hero: spawn at configured spawn point then assign to building
        const hero = new HeroSprite(
          this,
          agent.id,
          heroNameFor(agent.id, agent.source),
          trainerFor(agent.id, agent.source),
          agent.heroColor,
          this.heroSpawn.x,
          this.heroSpawn.y,
          agent.id.startsWith('agent-'),
          agent.source,
          this.partners[agent.id]?.species,
        );
        hero.setActivity(agent.currentActivity);
        hero.setStatus(agent.status);
        hero.setErrorTimestamp(agent.lastErrorAt);
        this.heroes.set(agent.id, hero);
        hero.setInteractiveForSelection(() => {
          eventBridge.emit('hero:clicked', agent.id);
        });
        this.addToSlot(buildingDef.id, agent.id);
        buildingsToReposition.add(buildingDef.id);
      } else {
        existing.setStatus(agent.status);
        existing.setErrorTimestamp(agent.lastErrorAt);

        const currentBuildingId = this.heroBuildingMap.get(agent.id);

        if (currentBuildingId !== buildingDef.id) {
          // Hero changed building — update activity before repositioning
          existing.setActivity(agent.currentActivity);
          const oldBuilding = this.removeFromSlot(agent.id);
          this.addToSlot(buildingDef.id, agent.id);

          if (oldBuilding !== undefined) {
            buildingsToReposition.add(oldBuilding);
          }
          buildingsToReposition.add(buildingDef.id);
        } else if (existing.currentActivity !== agent.currentActivity) {
          // Same building, different activity — update label
          existing.setActivity(agent.currentActivity);
        }
      }
    }

    // Propagate mixed-mode state to every hero (including ones not touched by
    // this update), so the badge flips on/off as the fleet composition changes.
    for (const hero of this.heroes.values()) {
      hero.setSourceBadgeVisible(showSourceBadge);
    }

    for (const buildingId of buildingsToReposition) {
      this.repositionBuilding(buildingId);
    }

    // Ambience marks an occupied building — meaningful state: the door
    // stands open (and the bridge's Pokémon battle) while a trainer is there, and
    // stops the moment the last one leaves. Arrivals raise it via their own
    // callback; this sweep is what lowers it, since a hero that walked off or
    // vanished fires no arrival for the building it left.
    for (const building of this.buildings) {
      this.refreshOccupancy(building.def.id);
    }
    this.farmWork?.setWorkers(this.buildingSlots.get('farm') ?? []);
  }
}
