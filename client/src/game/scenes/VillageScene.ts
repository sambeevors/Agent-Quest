import * as Phaser from 'phaser';
import { eventBridge } from '../EventBridge';
import { Building } from '../entities/Building';
import { HeroSprite } from '../entities/HeroSprite';
import { BUILDING_DEFS, VILLAGE_GATE, WORLD_WIDTH, WORLD_HEIGHT, computeVillageAnnexes, getBuildingForActivity } from '../data/building-layout';
import type { VillageAnnexes } from '../data/building-layout';
import { TerrainRenderer, PROCEDURAL_WATER_BOUNDS } from '../terrain/TerrainRenderer';
import { renderMapConfig } from '../terrain/MapConfigRenderer';
import { ensureAssetsLoaded } from '../data/asset-loader';
import { setRoadNetworkFromDesire } from '../data/road-network';
import { buildDesireNetwork, type DesireNode, type Rect } from '../data/desire-paths';
import { buildPathTilemap } from '../data/path-tiles';
import { renderPathTiles } from '../terrain/PathTileRenderer';
import { generateScenery } from '../data/scenery';
import { renderScenery } from '../terrain/SceneryRenderer';
import { waterKeepOut } from '../data/water';
import { ConstructionSite } from '../entities/ConstructionSite';
import type { AgentState, LinearProject } from '../../types/agent';
import { heroNameFor } from '../../naming/hero-names';
import type { AssetManifest, MapConfig, BuildingPosition } from '../data/map-config';
import { SERVER_URL as API_BASE } from '../../config';
import { getActiveTheme, rebaseSavedScale } from '../themes/registry';
import { sceneRenderScale } from '../dpr';

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

/** Grid spacing between heroes at the same building. */
const GRID_SPACING_X = 40;
const GRID_SPACING_Y = 35;

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

  /** Linear construction sites, keyed by project id. */
  private constructionSites = new Map<string, ConstructionSite>();
  /** Which plot index each site occupies, so a site never migrates or collides. */
  private sitePlots = new Map<string, number>();
  private onLinearUpdated: ((projects: unknown) => void) | null = null;
  private onConstructionFocus: ((projectId: unknown) => void) | null = null;
  /** Projects received before the world was ready — replayed once it is. */
  private pendingProjects: LinearProject[] | null = null;

  /** Construction-plot placement derived from the spawned buildings. Null pre-bootstrap. */
  private annexes: VillageAnnexes | null = null;

  /** Rendered desire-path roads. Rebuilt whenever the set of buildings changes. */
  private roadLayer: Phaser.GameObjects.Container | null = null;

  /** Generated scenery sprites, regenerated alongside the roads. */
  private scenerySprites: Phaser.GameObjects.Image[] = [];

  /** Ground the generator must leave alone — water and other placed features. */
  private sceneryExclusions: Rect[] = [];

  /** World rect the camera fits, widened once the Linear hamlet is populated. */
  private contentBounds: Phaser.Geom.Rectangle | null = null;


  /** Hero sprite scale — overridden by MapConfig settings if available. */
  /** Hero sprite scale — defaults to the active theme's baseline (0.5 for
   * Tiny Swords / CC0 edition). MapConfig-saved overrides are rebased
   * through `rebaseSavedScale` so they're stored once against the Tiny
   * Swords baseline and render proportionally under any theme. */
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

    // Linear projects → construction sites. Buffered until bootstrapWorld()
    // finishes, same as agent updates, since both need the world to exist.
    this.onLinearUpdated = (projects: unknown) => {
      try { if (!this.sys.isActive()) return; } catch { return; }
      if (!Array.isArray(projects)) return;
      this.handleLinearUpdate(projects as LinearProject[]);
    };
    eventBridge.on('linear:updated', this.onLinearUpdated);

    // Pan to a construction site when the panel asks for it.
    this.onConstructionFocus = (projectId: unknown) => {
      if (typeof projectId !== 'string') return;
      try { if (!this.sys.isActive()) return; } catch { return; }
      const site = this.constructionSites.get(projectId);
      if (site === undefined) return;
      const { x, y } = site.position;
      this.cameras.main.pan(x, y, 600, 'Sine.easeInOut');
    };
    eventBridge.on('construction:focus', this.onConstructionFocus);

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
      if (this.onLinearUpdated !== null) {
        eventBridge.off('linear:updated', this.onLinearUpdated);
        this.onLinearUpdated = null;
      }
      if (this.onConstructionFocus !== null) {
        eventBridge.off('construction:focus', this.onConstructionFocus);
        this.onConstructionFocus = null;
      }
      for (const site of this.constructionSites.values()) site.destroy();
      this.constructionSites.clear();
      this.sitePlots.clear();
      this.roadLayer?.destroy();
      this.roadLayer = null;
      for (const sprite of this.scenerySprites) sprite.destroy();
      this.scenerySprites = [];
      this.sceneryExclusions = [];
      this.contentBounds = null;
      this.annexes = null;
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

        // Single-theme project — the server lazy-migrates legacy ids to
        // 'tiny-swords-cc0' on load, so no runtime switch is possible.
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
      // Annexes are derived from the map's building positions, which are known
      // before anything is drawn.
      this.annexes = computeVillageAnnexes(mapConfig.buildings);
      const rendered = renderMapConfig(this, mapConfig, manifest);
      // Placed features are keep-out ground for the scenery generator, and so
      // is the painted water: the lake is terrain tiles, not a feature, so
      // nothing in `featureBounds` describes it.
      this.sceneryExclusions = [...rendered.featureBounds, ...waterKeepOut(mapConfig.terrain)];
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
      this.sceneryExclusions = PROCEDURAL_WATER_BOUNDS.map((r) => ({ ...r }));
      this.spawnBuildings(null);
    }

    // The procedural branch has no saved positions to read ahead of time, so
    // the hamlet is derived from the buildings that just spawned.
    this.annexes ??= computeVillageAnnexes(this.buildings.map((b) => ({ x: b.def.x, y: b.def.y })));

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
    if (this.pendingProjects !== null) {
      const pending = this.pendingProjects;
      this.pendingProjects = null;
      this.handleLinearUpdate(pending);
    }
  }

  // ---------------------------------------------------------------------------
  // Desire-path roads
  // ---------------------------------------------------------------------------

  /**
   * Regenerate and redraw the road network from whatever is currently standing.
   *
   * Called after the world boots and again whenever the Linear hamlet gains or
   * loses a site, because a settlement that appears with no track to it looks
   * abandoned. Any `paths` painted in the map editor are deliberately ignored:
   * the whole point of generating roads is that they follow the buildings, and
   * mixing a stale hand-drawn layer underneath would contradict them.
   */
  private rebuildRoads(): void {
    const nodes: DesireNode[] = [];
    const obstacles: Rect[] = [];

    for (const b of this.buildings) {
      nodes.push({ id: `b:${b.def.id}`, x: b.doorX, y: b.doorY });
      obstacles.push(b.footprint);
    }
    for (const [id, site] of this.constructionSites) {
      const door = site.door;
      nodes.push({ id: `c:${id}`, x: door.x, y: door.y });
      obstacles.push(site.footprint);
    }
    // The gate is where heroes arrive, so it needs a track even though nothing
    // stands there.
    nodes.push({ id: 'gate', x: this.heroSpawn.x, y: this.heroSpawn.y });

    const network = buildDesireNetwork(nodes, obstacles);

    this.roadLayer?.destroy();
    const terrain = getActiveTheme().terrain;
    const road = terrain?.road;
    if (terrain !== undefined && road !== undefined) {
      const tilemap = buildPathTilemap(network, {
        cell: terrain.tileSize / 2,
        tilesetColumns: road.columns,
        roadBlockFrame: road.blockFrame,
        gravelFrame: road.gravelFrame,
        tuftFrame: road.tuftFrame,
        bounds: { x: 0, y: 0, w: WORLD_WIDTH, h: WORLD_HEIGHT },
      });
      this.roadLayer = renderPathTiles(this, tilemap, road.tilesetKey, terrain.tileSize);
    } else {
      this.roadLayer = null;
    }
    setRoadNetworkFromDesire(network.waypoints, network.edges);

    // Scenery is generated against the roads that were just laid, so it can
    // never end up sitting on one.
    for (const sprite of this.scenerySprites) sprite.destroy();
    this.scenerySprites = renderScenery(this, generateScenery({
      bounds: { x: 0, y: 0, w: WORLD_WIDTH, h: WORLD_HEIGHT },
      buildings: obstacles,
      roads: network.roads.map((r) => r.points),
      // Placed features (the lake, the mines) plus the hamlet's own ground,
      // so its plots stand in a meadow rather than having to clear-fell a
      // wood the moment a Linear project appears.
      exclusions: this.annexes === null
        ? this.sceneryExclusions
        : [...this.sceneryExclusions, this.annexes.clearing],
    }));

    this.updateContentBounds(nodes);
  }

  /**
   * Track the world rect worth looking at and re-fit the camera when it grows.
   *
   * The hamlet sits well west of the village, so a view framed on the village
   * alone would cut it off — but framing for it before any sites exist would
   * zoom out over empty forest for no reason. Fitting to what's actually
   * standing handles both.
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

  // ---------------------------------------------------------------------------
  // Linear construction sites
  // ---------------------------------------------------------------------------

  /**
   * Reconcile the construction yard against the latest project list: update
   * sites that persist, tear down ones whose project is gone, raise new ones on
   * whichever plots are free. Projects beyond the available plots aren't placed
   * — the panel still lists every one of them.
   *
   * A site KEEPS its plot for as long as its project is in progress, even when
   * the sort order shifts underneath it. Re-deriving the plot from the list
   * index each poll would make buildings hop around the map whenever one
   * project overtook another, and would let two sites claim the same plot.
   */
  private handleLinearUpdate(projects: LinearProject[]): void {
    const annexes = this.annexes;
    if (!this.buildingsReady || annexes === null) {
      this.pendingProjects = projects;
      return;
    }

    const byId = new Map(projects.map((p) => [p.id, p]));

    // Retire sites whose project is no longer in progress, freeing their plots.
    let retired = false;
    for (const [id, site] of this.constructionSites) {
      if (byId.has(id)) continue;
      site.destroy();
      this.constructionSites.delete(id);
      this.sitePlots.delete(id);
      retired = true;
    }

    // Update the sites that survived, in place.
    for (const [id, site] of this.constructionSites) {
      const project = byId.get(id);
      if (project !== undefined) site.update(project);
    }

    // Fill free plots with new projects, most-built first (the list already
    // arrives sorted that way).
    const takenPlots = new Set(this.sitePlots.values());
    let membershipChanged = false;
    for (const project of projects) {
      if (this.constructionSites.has(project.id)) continue;
      const plotIndex = annexes.plots.findIndex((_, i) => !takenPlots.has(i));
      if (plotIndex === -1) break; // hamlet is full
      const plot = annexes.plots[plotIndex]!;
      takenPlots.add(plotIndex);
      this.sitePlots.set(project.id, plotIndex);
      this.constructionSites.set(project.id, new ConstructionSite(this, project, plot, plotIndex));
      membershipChanged = true;
    }

    // Only regenerate when the hamlet actually gained or lost a building.
    // Progress ticking on an existing site changes how it looks, not where the
    // tracks run, and rebuilding on every poll would rewrite the whole road
    // layer for nothing.
    if (membershipChanged || retired) this.rebuildRoads();
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
    return oldBuildingId;
  }

  private repositionBuilding(buildingId: string): void {
    const slots = this.buildingSlots.get(buildingId);
    if (slots === undefined || slots.length === 0) return;

    const buildingDef = BUILDING_DEFS.find((b) => b.id === buildingId);
    if (buildingDef === undefined) return;

    const building = this.buildings.find((b) => b.def.id === buildingId);
    const doorX = building?.doorX ?? buildingDef.x;
    const doorY = building?.doorY ?? buildingDef.y + 60;

    const positions = this.calcGridPositions(doorX, doorY, slots.length);

    for (let i = 0; i < slots.length; i++) {
      const hero = this.heroes.get(slots[i]!);
      if (hero === undefined) continue;
      const pos = positions[i]!;

      hero.gridBaseX = pos.x;
      hero.gridBaseY = pos.y;
      hero.moveTo(pos.x, pos.y, hero.currentActivity);
    }
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
  }
}
