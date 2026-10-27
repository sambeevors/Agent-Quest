import * as Phaser from 'phaser';
import { eventBridge } from '../EventBridge';
import { Building } from '../entities/Building';
import { HeroSprite } from '../entities/HeroSprite';
import { BUILDING_DEFS, VILLAGE_GATE, WORLD_WIDTH, WORLD_HEIGHT, getBuildingForActivity } from '../data/building-layout';
import { TerrainRenderer, PROCEDURAL_WATER_BOUNDS } from '../terrain/TerrainRenderer';
import { renderMapConfig } from '../terrain/MapConfigRenderer';
import { ensureAssetsLoaded } from '../data/asset-loader';
import { setRoadNetworkFromDesire } from '../data/road-network';
import { buildDesireNetwork, type DesireNode, type Rect } from '../data/desire-paths';
import { planRoads, type RoadSite } from '../data/building-plan';
import { buildPathTilemap } from '../data/path-tiles';
import { renderPathTiles } from '../terrain/PathTileRenderer';
import { generateScenery } from '../data/scenery';
import { renderScenery } from '../terrain/SceneryRenderer';
import { largestClearRect, waterKeepOut } from '../data/water';
import { Critter } from '../entities/Critter';
import { ArenaFighters } from '../entities/ArenaFighters';
import { FarmWork } from '../entities/FarmWork';
import type { AgentState } from '../../types/agent';
import { heroNameFor } from '../../naming/hero-names';
import type { AssetManifest, MapConfig, BuildingPosition } from '../data/map-config';
import { SERVER_URL as API_BASE } from '../../config';
import { getActiveTheme, rebaseSavedScale } from '../themes/registry';
import { sceneRenderScale } from '../dpr';
import { declutterLabels } from '../data/label-declutter';

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

/** Grid spacing between heroes at the same building. Still narrower than a
 * name (~95px), but wide enough that the label declutter pass can spread a
 * rank of three names up to ~104px side by side with each hero still
 * standing under its own (see declutterHeroLabels) — the old 40px grid
 * forced the names into a column over the roof. A 3×3 crowd spans ±68px,
 * which keeps it on the forecourt the door's road arrives at. */
const GRID_SPACING_X = 68;
const GRID_SPACING_Y = 36;

export class VillageScene extends Phaser.Scene {
  private buildings: Building[] = [];
  private heroes = new Map<string, HeroSprite>();
  private onAgentsUpdated: ((agents: unknown) => void) | null = null;
  private onCameraFollow: ((agentId: unknown) => void) | null = null;
  private onSelectionChanged: ((agentId: unknown) => void) | null = null;
  private onBackgroundPointerDown: ((pointer: Phaser.Input.Pointer, hits: Phaser.GameObjects.GameObject[]) => void) | null = null;

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

  /** Rendered desire-path roads. Rebuilt whenever the set of buildings changes. */
  private roadLayer: Phaser.GameObjects.Container | null = null;

  /** Generated scenery sprites, regenerated alongside the roads. */
  private scenerySprites: Phaser.GameObjects.GameObject[] = [];

  /** Wandering ambient animals (meadow critters + lake ducks). */
  private critters: Critter[] = [];

  /** The arena's resident goblin and skeleton — spar while a hero is inside. */
  private arenaFighters: ArenaFighters | null = null;

  /** The farm's work roster — stations its heroes on the crops and moves
   *  them from bed to bed. Owns the farm's positions outright. */
  private farmWork: FarmWork | null = null;

  /**
   * Heroes that have finished walking to their station. An assigned hero is
   * still crossing the village for a second or two, and until it gets there
   * the building is not occupied — no smoke over a cold forge, no fighters
   * swinging at nobody. Every occupancy tell keys off arrival, never off the
   * slot assignment.
   */
  private arrived = new Set<string>();

  /** Water keep-out rects — also where the ducks live. */
  private waterRects: Rect[] = [];

  /** Placed floors (the jetty) — kept clear of swimming ducks. */
  private floorRects: Rect[] = [];

  /** Ground the generator must leave alone — water and other placed features. */
  private sceneryExclusions: Rect[] = [];

  /** World rect the camera fits. */
  private contentBounds: Phaser.Geom.Rectangle | null = null;


  /** Hero sprite scale — defaults to the active theme's baseline.
   * MapConfig-saved overrides are stored against the original Tiny Swords
   * baseline and rebased through `rebaseSavedScale` so they render
   * proportionally under the current art. */
  private heroScale = getActiveTheme().heroScale;

  /** Spawn point used for new heroes. Overridden by MapConfig.spawn when present. */
  private heroSpawn: { x: number; y: number } = { x: VILLAGE_GATE.x, y: VILLAGE_GATE.y };

  /** True once bootstrapWorld() has finished spawning buildings. */
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

    // Signal React that the village is up so it can reveal the HTML overlays
    // (TopBar, PartyBar, etc.) that should stay hidden during the BootScene.
    eventBridge.emit('village:ready');

    // Load the shipped village; fall back to the procedural terrain if the
    // request fails. This is fire-and-forget — the rest of create() (input,
    // overlays, listeners) doesn't depend on it.
    void this.bootstrapWorld();

    // Set world bounds and fit the village into the viewport, then center the
    // map inside it. Anchoring on the world center (rather than a hardcoded
    // point near the gate) keeps the map visually centred regardless of the
    // fitted zoom level.
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.fitCamera();
    this.cameras.main.centerToBounds();

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

    // Pan the camera to a hero when the Activity Feed requests it
    // (user clicks an agent sprite in the feed).
    this.onCameraFollow = (agentId: unknown) => {
      if (typeof agentId !== 'string') return;
      try { if (!this.sys.isActive()) return; } catch { return; }
      const hero = this.heroes.get(agentId);
      if (hero === undefined) return;
      this.cameras.main.pan(hero.x, hero.y, 600, 'Sine.easeInOut');
    };
    eventBridge.on('camera:follow', this.onCameraFollow);

    // Apply outline/tint to the selected hero whenever selection changes.
    this.onSelectionChanged = (agentId: unknown) => {
      const selectedId = typeof agentId === 'string' ? agentId : null;
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
      this.roadLayer?.destroy();
      this.roadLayer = null;
      for (const sprite of this.scenerySprites) sprite.destroy();
      this.scenerySprites = [];
      this.sceneryExclusions = [];
      this.contentBounds = null;
    };
    this.events.on('shutdown', cleanup);
    this.events.on('destroy', cleanup);
  }

  // ---------------------------------------------------------------------------
  // World bootstrap — prefer saved MapConfig, fall back to procedural terrain
  // ---------------------------------------------------------------------------

  private async bootstrapWorld(): Promise<void> {
    let mapConfig: MapConfig | null = null;
    let manifest: AssetManifest | null = null;
    let mapStatus: number | string = 'n/a';
    let manifestStatus: number | string = 'n/a';
    let fetchError: unknown = null;
    try {
      const mapRes = await fetch(`${API_BASE}/api/map`);
      mapStatus = mapRes.status;
      if (mapRes.status === 200) {
        mapConfig = await mapRes.json() as MapConfig;

        // Single-theme project — the server serves one manifest, so no
        // runtime switch is possible.
        const activeTheme = getActiveTheme().id;

        // Fetch the asset manifest for the (now aligned) theme so
        // decorations/buildings referenced by mapConfig resolve correctly.
        const manRes = await fetch(`${API_BASE}/api/assets/manifest?theme=${encodeURIComponent(activeTheme)}`);
        manifestStatus = manRes.status;
        if (manRes.ok) manifest = await manRes.json() as AssetManifest;
      }
    } catch (err) {
      fetchError = err;
    }

    console.log('[VillageScene] bootstrapWorld', {
      mapStatus,
      manifestStatus,
      mapConfigLoaded: mapConfig !== null,
      manifestLoaded: manifest !== null,
      terrainTiles: mapConfig ? Object.keys(mapConfig.terrain ?? {}).length : 0,
      buildings: mapConfig?.buildings?.length ?? 0,
      mapName: mapConfig?.meta?.name,
      fetchError: fetchError ? String(fetchError) : null,
    });

    try { if (!this.sys.isActive()) return; } catch { return; }

    if (mapConfig !== null && manifest !== null) {
      console.log('[VillageScene] rendering the village from /api/map');
      await ensureAssetsLoaded(this, manifest, mapConfig);
      try { if (!this.sys.isActive()) return; } catch { return; }
      const rendered = renderMapConfig(this, mapConfig, manifest);
      // Placed features are keep-out ground for the scenery generator, and so
      // is the painted water: the lake is terrain tiles, not a feature, so
      // nothing in `featureBounds` describes it.
      this.waterRects = waterKeepOut(mapConfig.terrain);
      this.floorRects = rendered.floorBounds;
      this.sceneryExclusions = [...rendered.featureBounds, ...this.waterRects];
      this.spawnBuildings(mapConfig.buildings);

      // Apply hero scale from map settings
      if (mapConfig.settings?.heroScale) {
        this.heroScale = rebaseSavedScale(mapConfig.settings.heroScale);
      }

      this.heroSpawn = mapConfig.spawn
        ? { x: mapConfig.spawn.x, y: mapConfig.spawn.y }
        : { x: VILLAGE_GATE.x, y: VILLAGE_GATE.y };
    } else {
      console.warn('[VillageScene] FALLBACK → procedural TerrainRenderer', {
        reason: mapConfig === null ? 'mapConfig is null' : 'manifest is null',
        mapStatus,
        manifestStatus,
      });
      new TerrainRenderer(this).render();
      this.waterRects = PROCEDURAL_WATER_BOUNDS.map((r) => ({ ...r }));
      this.sceneryExclusions = this.waterRects.map((r) => ({ ...r }));
      this.spawnBuildings(null);
    }

    // The arena's cast stands inside the enclosure that just spawned; created
    // here (after heroScale is settled) so the fighters match hero size.
    this.setupArenaFighters();
    this.setupFarmWork();

    // Roads are generated, not painted. Any `paths` in a saved MapConfig are
    // ignored — see rebuildRoads().
    this.rebuildRoads();

    // Buildings are now spawned — process any buffered updates
    this.buildingsReady = true;
    if (this.pendingAgentUpdate !== null) {
      const pending = this.pendingAgentUpdate;
      this.pendingAgentUpdate = null;
      this.handleAgentUpdate(pending);
    }
  }

  /** Place (or re-place) the arena's resident goblin and skeleton. */
  private setupArenaFighters(): void {
    this.arenaFighters?.destroy();
    this.arenaFighters = null;
    const npcs = getActiveTheme().getArenaNpcs?.();
    const arena = this.buildings.find((b) => b.def.id === 'arena');
    const interior = arena?.interiorWorldRect() ?? null;
    if (npcs === undefined || interior === null) return;
    this.arenaFighters = new ArenaFighters(this, npcs, interior, this.heroScale);
  }

  /** Place (or re-place) the farm's work roster over its tilled beds. */
  private setupFarmWork(): void {
    this.farmWork?.destroy();
    this.farmWork = null;
    const beds = this.buildings.find((b) => b.def.id === 'farm')?.cropWorldPoints() ?? null;
    if (beds === null) return;
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

  // ---------------------------------------------------------------------------
  // Desire-path roads
  // ---------------------------------------------------------------------------

  /**
   * Regenerate and redraw the road network from whatever is currently standing.
   *
   * Called once the world boots. Any `paths` painted in the map editor are deliberately ignored:
   * the whole point of generating roads is that they follow the buildings, and
   * mixing a stale hand-drawn layer underneath would contradict them.
   */
  private rebuildRoads(): void {
    const sites: RoadSite[] = [];
    for (const b of this.buildings) {
      sites.push({ id: `b:${b.def.id}`, door: { x: b.doorX, y: b.doorY }, keepOut: b.footprint });
    }
    const cell = (getActiveTheme().terrain?.tileSize ?? 64) / 2;
    // Keep-out rects, door leads and the jetty gate — shared with the tests
    // that lay out the shipped map, so both route the same roads.
    const { nodes, obstacles, clearance } = planRoads(sites, this.heroSpawn, cell);

    const network = buildDesireNetwork(nodes, obstacles, { clearance });

    this.roadLayer?.destroy();
    const terrain = getActiveTheme().terrain;
    const road = terrain?.road;
    // Rasterised even with no road art to draw it with: the scenery keeps off
    // this surface, and the tiles are the honest width of a track.
    const tilemap = buildPathTilemap(network, {
      cell,
      tilesetColumns: road?.columns,
      roadBlockFrame: road?.blockFrame,
      gravelFrame: road?.gravelFrame,
      tuftFrame: road?.tuftFrame,
      bounds: { x: 0, y: 0, w: WORLD_WIDTH, h: WORLD_HEIGHT },
    });
    this.roadLayer = terrain !== undefined && road !== undefined
      ? renderPathTiles(this, tilemap, road.tilesetKey, terrain.tileSize)
      : null;
    setRoadNetworkFromDesire(network.waypoints, network.edges);

    // Scenery is generated against the road tiles that were just laid and the
    // building sprites as drawn, so no sprite can end up sitting on either.
    for (const sprite of this.scenerySprites) sprite.destroy();
    const items = generateScenery({
      bounds: { x: 0, y: 0, w: WORLD_WIDTH, h: WORLD_HEIGHT },
      buildings: obstacles,
      buildingSprites: this.buildings.map((b) => ({
        x: b.def.x - b.image.displayWidth / 2,
        y: b.def.y - b.image.displayHeight,
        w: b.image.displayWidth,
        h: b.image.displayHeight,
      })),
      roads: tilemap,
      // Placed features (the lake's rocks and jetty) and the water.
      exclusions: this.sceneryExclusions,
    });
    // Animals become moving critters rather than static scatter — the
    // generator still owns WHERE they live (clearances, spacing, seed).
    this.scenerySprites = renderScenery(this, items.filter((i) => i.kind !== 'animal'));
    this.spawnCritters(items.filter((i) => i.kind === 'animal'));

    this.updateContentBounds(nodes);
  }

  /**
   * Wandering ambience: meadow critters at the scenery generator's animal
   * placements, plus ducks paddling on each big enough body of water. Ducks
   * are seeded off their rect's geometry so the same lake always keeps the
   * same flock.
   */
  private spawnCritters(animals: ReturnType<typeof generateScenery>): void {
    for (const c of this.critters) c.destroy();
    this.critters = [];
    for (const a of animals) {
      this.critters.push(new Critter(this, {
        textureKey: `animal-${a.variant}`,
        x: a.x,
        y: a.y,
        scale: a.scale,
        roamRadius: 50,
      }));
    }
    // waterKeepOut rects reach ~24px past the shoreline onto land, so the
    // inset has to clear that margin AND keep a body's width of open water.
    // That inset is measured to the duck's FEET (its origin): the body above
    // them is ~25px tall and ~30 wide at this scale, so it stays well clear of
    // the waterline, and of the jetty by FLOOR_CLEARANCE.
    const SHORE_INSET = 88;
    const FLOOR_CLEARANCE = 24;
    const floors = this.floorRects.map((f) => ({
      x: f.x - FLOOR_CLEARANCE,
      y: f.y - FLOOR_CLEARANCE,
      w: f.w + FLOOR_CLEARANCE * 2,
      h: f.h + FLOOR_CLEARANCE * 2,
    }));
    for (const r of this.waterRects) {
      const inner = largestClearRect({
        x: r.x + SHORE_INSET,
        y: r.y + SHORE_INSET,
        w: r.w - SHORE_INSET * 2,
        h: r.h - SHORE_INSET * 2,
      }, floors);
      if (inner.w < 64 || inner.h < 64) continue;
      const count = Math.max(1, Math.min(3, Math.floor((inner.w * inner.h) / 150_000)));
      let seed = (Math.round(r.x) * 73856093) ^ (Math.round(r.y) * 19349663) ^ Math.round(r.w * 7);
      const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 0xffffffff;
      };
      for (let i = 0; i < count; i++) {
        this.critters.push(new Critter(this, {
          textureKey: 'duck',
          x: inner.x + rand() * inner.w,
          y: inner.y + rand() * inner.h,
          scale: 0.45,
          roamRadius: 120,
          bounds: inner,
        }));
      }
    }
  }

  /**
   * Track the world rect worth looking at and re-fit the camera when it
   * changes, so the view frames what's actually standing.
   */
  private updateContentBounds(nodes: DesireNode[]): void {
    if (nodes.length === 0) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const PAD = 190;
    const next = new Phaser.Geom.Rectangle(
      Math.min(...xs) - PAD,
      Math.min(...ys) - PAD * 1.4, // extra headroom: buildings are drawn upward from their door
      Math.max(...xs) - Math.min(...xs) + PAD * 2,
      Math.max(...ys) - Math.min(...ys) + PAD * 2.2,
    );

    const changed = this.contentBounds === null
      || Math.abs(next.width - this.contentBounds.width) > 1
      || Math.abs(next.height - this.contentBounds.height) > 1
      || Math.abs(next.x - this.contentBounds.x) > 1
      || Math.abs(next.y - this.contentBounds.y) > 1;
    this.contentBounds = next;
    if (changed) {
      this.fitCamera();
      this.cameras.main.centerOn(next.centerX, next.centerY);
    }
  }


  /** Calculate zoom so the village area (~1100×700 centred at 1400,780) fills the viewport. */
  /**
   * Zoom so everything standing fits the viewport. Falls back to the built-in
   * village footprint until `contentBounds` is known (i.e. before bootstrap).
   */
  private fitCamera(): void {
    const cam = this.cameras.main;
    const villageW = this.contentBounds?.width ?? 1100;
    const villageH = this.contentBounds?.height ?? 700;
    const zoomX = cam.width / villageW;
    const zoomY = cam.height / villageH;
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

  private spawnBuildings(overrides: BuildingPosition[] | null): void {
    for (const def of BUILDING_DEFS) {
      const override = overrides?.find((p) => p.id === def.id);
      const resolved = override !== undefined
        ? { ...def, x: override.x, y: override.y }
        : def;
      this.buildings.push(new Building(this, resolved));
    }
  }

  // ---------------------------------------------------------------------------
  // Grid position calculation
  // ---------------------------------------------------------------------------

  private calcGridPositions(doorX: number, doorY: number, count: number): Array<{ x: number; y: number }> {
    if (count === 0) return [];
    if (count === 1) return [{ x: doorX, y: doorY }];

    const cols = Math.ceil(Math.sqrt(count));
    const positions: Array<{ x: number; y: number }> = [];
    const offsetX = ((cols - 1) * GRID_SPACING_X) / 2;

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.push({
        x: doorX - offsetX + col * GRID_SPACING_X,
        y: doorY + row * GRID_SPACING_Y,
      });
    }
    return positions;
  }

  /**
   * Grid positions INSIDE an enclosure's interior rect — heroes walk in
   * through the gate and stand on the floor rather than gathering at the
   * door. The arena's heroes keep to the west side, because the goblin and
   * skeleton they spar with hold the east. Positions clamp to the rect so a
   * crowd compresses against the fence instead of standing in it.
   *
   * The farm reaches this only as a fallback, under a theme whose art
   * declares no crop beds; normally `FarmWork` stations its heroes on the
   * beds themselves.
   */
  private calcInteriorPositions(
    rect: { x: number; y: number; w: number; h: number },
    count: number,
    buildingId: string,
  ): Array<{ x: number; y: number }> {
    if (count === 0) return [];
    const cx = rect.x + rect.w * (buildingId === 'arena' ? 0.32 : 0.5);
    const cy = rect.y + rect.h * 0.55;
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const positions: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.push({
        x: Phaser.Math.Clamp(cx + (col - (cols - 1) / 2) * GRID_SPACING_X, rect.x, rect.x + rect.w),
        y: Phaser.Math.Clamp(cy + (row - (rows - 1) / 2) * GRID_SPACING_Y, rect.y, rect.y + rect.h),
      });
    }
    return positions;
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

    const buildingDef = BUILDING_DEFS.find((b) => b.id === buildingId);
    if (buildingDef === undefined) return;

    const building = this.buildings.find((b) => b.def.id === buildingId);
    const doorX = building?.doorX ?? buildingDef.x;
    const doorY = building?.doorY ?? buildingDef.y + 60;

    // Enclosures station their heroes inside; the road network ends at the
    // gate, so the final leg of the walk passes through it naturally.
    const interior = building?.interiorWorldRect() ?? null;
    const positions = interior !== null
      ? this.calcInteriorPositions(interior, slots.length, buildingId)
      : this.calcGridPositions(doorX, doorY, slots.length);

    const focusX = this.stationFocusX(buildingId, doorX, interior !== null);

    for (let i = 0; i < slots.length; i++) {
      const heroId = slots[i]!;
      const hero = this.heroes.get(heroId);
      if (hero === undefined) continue;
      const pos = positions[i]!;

      // Inside an enclosure the grid point is where the hero's FEET go, so
      // the clamp to the interior rect keeps the hero standing in the yard
      // rather than its centre. At a door the point is the sprite centre,
      // as the road network's endpoints are.
      const y = interior !== null ? pos.y - hero.footOffset : pos.y;
      hero.gridBaseX = pos.x;
      hero.gridBaseY = y;
      // Arrival is cleared by removeFromSlot, which runs when a hero changes
      // building — the only case where it genuinely isn't there. Heroes
      // already at this building are just shuffling to make room for a new
      // arrival and stay counted, or the chimney would puff out every time
      // the building gained a hero.
      hero.moveTo(pos.x, y, hero.currentActivity, () => {
        this.arrived.add(heroId);
        if (focusX !== null) hero.faceTowards(focusX);
        this.refreshOccupancy(buildingId);
      });
    }

    this.refreshOccupancy(buildingId);
  }

  /**
   * What a hero stationed here turns to look at, or null to keep the
   * direction it walked in. A hero freezing mid-stride tends to end up with
   * its back to the anvil it is supposedly hammering, so the arena's heroes
   * face the fighters they spar with and everyone else faces the door they
   * are working at. The farm is the exception: its heroes stand on the beds
   * they water, so there is nothing to turn towards.
   */
  private stationFocusX(buildingId: string, doorX: number, isEnclosure: boolean): number | null {
    if (buildingId === 'arena') return this.arenaFighters?.focusX() ?? null;
    return isEnclosure ? null : doorX;
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
   * Drive a building's ambience from whether a hero is actually standing at
   * it: smoke from its chimney, and in the arena the goblin and skeleton
   * squaring up. Both stop the moment the last hero leaves.
   */
  private refreshOccupancy(buildingId: string): void {
    const slots = this.buildingSlots.get(buildingId) ?? [];
    const occupied = slots.some((id) => this.arrived.has(id));
    this.buildings.find((b) => b.def.id === buildingId)?.setSmoking(occupied);
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
          heroNameFor(agent.id),
          agent.heroClass,
          agent.heroColor,
          this.heroSpawn.x,
          this.heroSpawn.y,
          agent.id.startsWith('agent-'),
          agent.source,
        );
        hero.setHeroScale(this.heroScale);
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

    // Ambience marks an occupied building — meaningful state: the chimney
    // smokes (and the arena's cast spars) while a hero stands there, and
    // stops the moment the last one leaves. Arrivals raise it via their own
    // callback; this sweep is what lowers it, since a hero that walked off or
    // vanished fires no arrival for the building it left.
    for (const building of this.buildings) {
      this.refreshOccupancy(building.def.id);
    }
    this.farmWork?.setWorkers(this.buildingSlots.get('farm') ?? []);
  }
}
