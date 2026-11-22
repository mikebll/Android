/* MINICRAFT — renderer & browser shell.
 * The simulation (world, physics, inventory, crafting, mobs) is Rust/WASM.
 * This file turns its snapshots into a hand-drawn pixel world.
 */
(() => {
  'use strict';

  // Tile + item ids shared with engine/src/lib.rs
  const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, WOOD = 4, LEAVES = 5, PLANK = 6,
    TORCH = 7, COAL = 8, IRON = 9, GOLD = 10, BEDROCK = 11, SAND = 12,
    FLOWER = 13, TABLE = 14, BRICK = 15;
  const STICK = 20, PICKAXE = 21, AXE = 22, SWORD = 23, GEL = 24, BANDAGE = 25;

  const FLAG_WOOD = 1 << 0, FLAG_TABLE = 1 << 1, FLAG_PICK = 1 << 2,
    FLAG_COAL = 1 << 3, FLAG_TORCH = 1 << 4, FLAG_NIGHT = 1 << 5,
    FLAG_SWORD = 1 << 6, FLAG_IRON = 1 << 7, FLAG_DEEP = 1 << 8, FLAG_SLIME = 1 << 9;

  const EV_JUMP = 1 << 0, EV_LAND = 1 << 1, EV_HURT = 1 << 2, EV_BREAK = 1 << 3,
    EV_PLACE = 1 << 4, EV_CRAFT = 1 << 5, EV_ATTACK = 1 << 6, EV_MOB_DIE = 1 << 7,
    EV_NEW_DAY = 1 << 8, EV_DEAD = 1 << 9;

  const ITEM_NAMES = {
    [DIRT]: 'Tierra', [GRASS]: 'Césped', [STONE]: 'Piedra', [WOOD]: 'Madera',
    [LEAVES]: 'Hojas', [PLANK]: 'Tabla', [TORCH]: 'Antorcha', [COAL]: 'Carbón',
    [IRON]: 'Hierro', [GOLD]: 'Oro', [SAND]: 'Arena', [FLOWER]: 'Flor',
    [TABLE]: 'Mesa de trabajo', [BRICK]: 'Ladrillo', [STICK]: 'Palo',
    [PICKAXE]: 'Pico', [AXE]: 'Hacha', [SWORD]: 'Espada', [GEL]: 'Gel',
    [BANDAGE]: 'Venda'
  };
  const TILE_NAMES = {
    [GRASS]: 'Césped', [DIRT]: 'Tierra', [STONE]: 'Piedra', [WOOD]: 'Tronco',
    [LEAVES]: 'Hojas', [PLANK]: 'Tablas', [TORCH]: 'Antorcha', [COAL]: 'Carbón',
    [IRON]: 'Hierro', [GOLD]: 'Oro', [SAND]: 'Arena', [FLOWER]: 'Flor',
    [TABLE]: 'Mesa de trabajo', [BRICK]: 'Ladrillo'
  };

  const RECIPES = [
    { id: 0, name: 'Tablas', out: PLANK, n: 4, req: [[WOOD, 1]], table: false },
    { id: 1, name: 'Palos', out: STICK, n: 4, req: [[PLANK, 1]], table: false },
    { id: 2, name: 'Mesa de trabajo', out: TABLE, n: 1, req: [[PLANK, 4]], table: false },
    { id: 3, name: 'Pico', out: PICKAXE, n: 1, req: [[PLANK, 3], [STICK, 2]], table: true },
    { id: 4, name: 'Espada', out: SWORD, n: 1, req: [[PLANK, 2], [STICK, 1]], table: true },
    { id: 5, name: 'Hacha', out: AXE, n: 1, req: [[PLANK, 3], [STICK, 2]], table: true },
    { id: 6, name: 'Antorchas', out: TORCH, n: 4, req: [[STICK, 1], [COAL, 1]], table: false },
    { id: 7, name: 'Venda', out: BANDAGE, n: 1, req: [[GEL, 2], [LEAVES, 2]], table: false },
    { id: 8, name: 'Ladrillos', out: BRICK, n: 4, req: [[STONE, 4]], table: false }
  ];

  const QUESTS = [
    { flag: FLAG_WOOD, text: 'Consigue madera' },
    { flag: FLAG_TABLE, text: 'Coloca una mesa de trabajo' },
    { flag: FLAG_PICK, text: 'Fabrica un pico' },
    { flag: FLAG_COAL, text: 'Encuentra carbón' },
    { flag: FLAG_TORCH, text: 'Coloca 3 antorchas' },
    { flag: FLAG_NIGHT, text: 'Sobrevive a la noche' }
  ];

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const lightCanvas = document.createElement('canvas');
  const lightCtx = lightCanvas.getContext('2d');
  const lowLight = document.createElement('canvas');
  const lowCtx = lowLight.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 1, H = 1, DPR = 1, TS = 38, mobile = false;
  let wasm = null, memory = null, memBuffer = null;
  let stateView = null, invView = null, mobView = null, viewView = null;
  let running = false, booted = false;
  let mode = 'loading';              // loading | title | playing | paused | crafting | help | dead
  let helpReturn = 'title';
  let last = performance.now(), visualClock = 0, hudClock = 0, craftClock = 0;
  let soundOn = true;
  let toastTimer = 0;
  let shake = 0, flash = 0;
  let mouseX = 0, mouseY = 0, pointerInside = false;
  let mouseHeld = false, touchMining = false, touchMode = 'mine';
  let mining = { x: 0, y: 0, progress: 0, active: false };
  let cursor = { x: 0, y: 0, valid: false };
  let cam = { x: 0, y: 44 };
  let camInit = false;
  let hotbarSig = '';
  let questSig = '';
  let lastErrorToast = 0;
  let recipeHtml = '';
  let deathShown = false;
  let touch = { left: false, right: false, jump: false };
  let particles = [];
  let fireflies = [];
  let torchEmbers = 0;
  let audio = null;
  let noiseBuffer = null;
  let stepPhase = 0;
  let worldSeed = 0;
  let pausedForOverlay = false;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263 + worldSeed * 1442695041) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };

  // ------------------------------------------------------------------ Textures
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; return [c, x]; }
  function px(c, x, y, w, h, color) { c.fillStyle = color; c.fillRect(x, y, w, h); }
  function speckle(c, r, colors, count, x0 = 0, y0 = 0, w = 16, h = 16) {
    for (let i = 0; i < count; i++) px(c, x0 + ((r() * w) | 0), y0 + ((r() * h) | 0), 1, 1, colors[(r() * colors.length) | 0]);
  }
  function bevel(c, light, dark, x = 0, y = 0, w = 16, h = 16) {
    c.fillStyle = light; c.fillRect(x, y, w, 1); c.fillRect(x, y, 1, h);
    c.fillStyle = dark; c.fillRect(x, y + h - 1, w, 1); c.fillRect(x + w - 1, y, 1, h);
  }

  const texCache = new Map();
  const wallCache = new Map();
  const iconCache = new Map();

  function makeTexture(id, variant) {
    const [c, x] = newCanvas(16, 16);
    const r = rng(id * 7919 + variant * 3571 + 41);
    const grass = id === GRASS;
    if (grass) {
      px(x, 0, 0, 16, 16, '#75492a');
      speckle(x, r, ['#5b371f', '#895a34', '#9b7350', '#4d2e1b'], 32);
      px(x, 0, 0, 16, 5, '#4c8f37');
      px(x, 0, 0, 16, 2, '#7fc853');
      px(x, 0, 2, 16, 1, '#65aa43');
      for (let i = 0; i < 16; i += 2) {
        if (r() > 0.45) px(x, i, 4 + ((r() * 2) | 0), 1, 1, '#4b8a36');
        if (r() > 0.72) px(x, i, 2, 1, 1, '#9ade65');
      }
      px(x, 0, 0, 16, 1, '#a4e46b');
      px(x, 0, 15, 16, 1, '#4a2b18');
    } else if (id === DIRT) {
      px(x, 0, 0, 16, 16, '#75492a');
      speckle(x, r, ['#5b371f', '#895a34', '#9b7350', '#4d2e1b', '#674024'], 48);
      for (let i = 0; i < 4; i++) px(x, 2 + ((r() * 12) | 0), 3 + ((r() * 10) | 0), 2, 1, '#a18161');
      bevel(x, '#8c5d39', '#4c2c18');
    } else if (id === STONE) {
      px(x, 0, 0, 16, 16, '#727b8a');
      speckle(x, r, ['#5c6574', '#858f9e', '#68717f', '#939dab'], 42);
      for (let i = 0; i < 3; i++) {
        let cx = 2 + ((r() * 11) | 0), cy = 3 + ((r() * 10) | 0);
        px(x, cx, cy, 3, 1, '#505866');
        if (r() > 0.5) px(x, cx + 1, cy + 1, 1, 2, '#505866');
      }
      bevel(x, '#939dab', '#4d5563');
    } else if (id === WOOD) {
      px(x, 0, 0, 16, 16, '#764925');
      for (let i = 0; i < 5; i++) px(x, 1 + i * 3, 0, 1, 16, i % 2 ? '#5b351b' : '#8b5a2f');
      px(x, 0, 0, 16, 1, '#9b6939');
      px(x, 0, 15, 16, 1, '#4e2d17');
      const kx = 4 + ((r() * 7) | 0), ky = 4 + ((r() * 6) | 0);
      px(x, kx, ky, 3, 2, '#3f2413'); px(x, kx + 1, ky + 2, 2, 1, '#a16c3c');
      px(x, 0, 0, 1, 16, '#8c5a30'); px(x, 15, 0, 1, 16, '#4e2d17');
    } else if (id === LEAVES) {
      x.clearRect(0, 0, 16, 16);
      const greens = ['#2f6b30', '#3e843a', '#4c9b43', '#5dae4f', '#285c2a'];
      for (let i = 0; i < 28; i++) {
        const bx = 1 + ((r() * 13) | 0), by = 1 + ((r() * 13) | 0);
        px(x, bx, by, 2 + ((r() * 2) | 0), 2, greens[(r() * greens.length) | 0]);
      }
      for (let i = 0; i < 6; i++) x.clearRect(1 + ((r() * 14) | 0), 1 + ((r() * 14) | 0), 1, 1);
      px(x, 3, 2, 1, 1, '#8ccf63'); px(x, 10, 5, 1, 1, '#75c35a'); px(x, 6, 11, 1, 1, '#78c45a');
    } else if (id === PLANK) {
      px(x, 0, 0, 16, 16, '#b37b43');
      for (let i = 0; i < 3; i++) {
        px(x, 0, i * 5, 16, 1, '#6d441f');
        px(x, 0, i * 5 + 1, 16, 1, '#c78e52');
        px(x, 0, i * 5 + 4, 16, 1, '#956130');
      }
      px(x, 5, 1, 1, 4, '#82552b'); px(x, 12, 6, 1, 4, '#82552b'); px(x, 8, 11, 1, 4, '#82552b');
      speckle(x, r, ['#9c672f', '#c18a4f', '#7d5027'], 18);
      px(x, 0, 0, 16, 1, '#d09a5d'); px(x, 0, 15, 16, 1, '#6b411e');
    } else if (id === TORCH) {
      x.clearRect(0, 0, 16, 16);
      px(x, 7, 7, 3, 8, '#6b4020'); px(x, 7, 7, 1, 8, '#a56d36'); px(x, 9, 7, 1, 8, '#4a2a14');
      px(x, 6, 4, 5, 4, '#e25d24'); px(x, 7, 2, 3, 5, '#ff9f38'); px(x, 8, 1, 1, 5, '#ffe58a');
      px(x, 5, 5, 1, 1, '#ffbf4b'); px(x, 11, 5, 1, 1, '#ff7b2c'); px(x, 8, 7, 1, 1, '#fff2b0');
      px(x, 6, 15, 1, 1, '#3d2310'); px(x, 10, 15, 1, 1, '#3d2310');
    } else if (id === COAL) {
      px(x, 0, 0, 16, 16, '#727b8a'); speckle(x, r, ['#5c6574', '#858f9e', '#68717f'], 32);
      for (let i = 0; i < 5; i++) {
        const bx = 2 + ((r() * 10) | 0), by = 2 + ((r() * 10) | 0);
        px(x, bx, by, 3, 3, '#282b33'); px(x, bx + 1, by + 1, 1, 1, '#4b505c');
      }
      bevel(x, '#939dab', '#4d5563');
    } else if (id === IRON) {
      px(x, 0, 0, 16, 16, '#727b8a'); speckle(x, r, ['#5c6574', '#858f9e', '#68717f'], 32);
      for (let i = 0; i < 5; i++) {
        const bx = 2 + ((r() * 10) | 0), by = 2 + ((r() * 10) | 0);
        px(x, bx, by, 3, 3, '#c58e68'); px(x, bx, by, 2, 1, '#ecc3a3'); px(x, bx + 2, by + 2, 1, 1, '#8e5b40');
      }
      bevel(x, '#939dab', '#4d5563');
    } else if (id === GOLD) {
      px(x, 0, 0, 16, 16, '#727b8a'); speckle(x, r, ['#5c6574', '#858f9e', '#68717f'], 32);
      for (let i = 0; i < 5; i++) {
        const bx = 2 + ((r() * 10) | 0), by = 2 + ((r() * 10) | 0);
        px(x, bx, by, 3, 3, '#e8b93e'); px(x, bx, by, 2, 1, '#fff2a3'); px(x, bx + 2, by + 2, 1, 1, '#a97616');
      }
      bevel(x, '#939dab', '#4d5563');
    } else if (id === BEDROCK) {
      px(x, 0, 0, 16, 16, '#30333d');
      speckle(x, r, ['#20232a', '#444854', '#555a67', '#191b20'], 44);
      px(x, 2, 3, 5, 2, '#1a1c22'); px(x, 9, 9, 4, 2, '#1a1c22'); px(x, 4, 12, 2, 2, '#555a67');
      bevel(x, '#555a67', '#1c1e24');
    } else if (id === SAND) {
      px(x, 0, 0, 16, 16, '#ddc27e');
      speckle(x, r, ['#c9ac66', '#ecd99b', '#b99b58', '#f1e2ad'], 46);
      for (let i = 0; i < 3; i++) px(x, 2 + ((r() * 12) | 0), 3 + ((r() * 10) | 0), 2, 1, '#a88b50');
      bevel(x, '#f3e5b2', '#b49453');
    } else if (id === FLOWER) {
      x.clearRect(0, 0, 16, 16);
      px(x, 7, 8, 2, 7, '#4b8f3c'); px(x, 9, 11, 2, 1, '#65ad4c'); px(x, 6, 10, 2, 1, '#65ad4c');
      px(x, 6, 5, 2, 2, '#f3d24b'); px(x, 9, 4, 2, 2, '#f3d24b'); px(x, 5, 7, 2, 2, '#f3d24b'); px(x, 10, 7, 2, 2, '#f3d24b');
      px(x, 7, 6, 3, 3, '#ff7d5e'); px(x, 8, 7, 1, 1, '#ffe9a0');
      px(x, 7, 15, 2, 1, '#3f7333');
    } else if (id === TABLE) {
      px(x, 0, 0, 16, 16, '#9d6737');
      px(x, 1, 1, 14, 8, '#c38a50'); px(x, 1, 1, 14, 1, '#dfaa68'); px(x, 1, 8, 14, 1, '#74471f');
      px(x, 2, 2, 4, 3, '#9b6636'); px(x, 7, 2, 4, 3, '#9b6636'); px(x, 12, 2, 2, 3, '#9b6636');
      px(x, 2, 6, 12, 1, '#74471f'); px(x, 4, 10, 2, 5, '#70421e'); px(x, 10, 10, 2, 5, '#70421e');
      px(x, 3, 3, 1, 1, '#e2b577'); px(x, 8, 3, 1, 1, '#e2b577');
      px(x, 0, 0, 16, 1, '#d7a05f'); px(x, 0, 15, 16, 1, '#4f2e15');
    } else if (id === BRICK) {
      px(x, 0, 0, 16, 16, '#7a7f89');
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 2; col++) {
          const bx = col * 8 + (row % 2 ? 4 : 0) - 4;
          px(x, bx + 1, row * 4 + 1, 7, 3, row % 2 ? '#8a909b' : '#949aa5');
          px(x, bx + 1, row * 4 + 1, 6, 1, '#aab0ba');
        }
      }
      bevel(x, '#aab0ba', '#555b66');
    } else {
      px(x, 0, 0, 16, 16, '#ff00ff');
    }
    return c;
  }

  function tileTex(id, variant = 0) {
    const key = id * 10 + variant;
    let c = texCache.get(key);
    if (!c) { c = makeTexture(id, variant); texCache.set(key, c); }
    return c;
  }

  function makeWall(kind, variant) {
    const [c, x] = newCanvas(16, 16);
    const r = rng(kind * 991 + variant * 173 + 7);
    if (kind === 1) {
      px(x, 0, 0, 16, 16, '#35241c');
      speckle(x, r, ['#281a14', '#432d22', '#4d372a', '#1f1410'], 42);
      px(x, 3, 2, 1, 7, '#5a3c2b'); px(x, 4, 8, 2, 1, '#5a3c2b'); px(x, 11, 5, 1, 6, '#2a1b14');
    } else {
      px(x, 0, 0, 16, 16, '#2c313d');
      speckle(x, r, ['#242933', '#363c49', '#3f4654', '#1f232b'], 44);
      px(x, 2, 4, 4, 1, '#1e222a'); px(x, 5, 5, 1, 3, '#1e222a'); px(x, 10, 11, 3, 1, '#3f4654');
      px(x, 11, 2, 1, 5, '#1e222a');
    }
    return c;
  }
  function wallTex(kind, variant = 0) {
    const key = kind * 10 + variant;
    let c = wallCache.get(key);
    if (!c) { c = makeWall(kind, variant); wallCache.set(key, c); }
    return c;
  }

  function makeIcon(item) {
    const [c, x] = newCanvas(32, 32);
    if (item >= 1 && item <= 15) {
      x.drawImage(tileTex(item, 0), 0, 0, 16, 16, 0, 0, 32, 32);
      return c;
    }
    const rect = (a, b, w, h, col) => px(x, a, b, w, h, col);
    if (item === STICK) {
      for (let i = 0; i < 20; i++) rect(6 + i, 25 - i, 4, 4, i < 2 ? '#a26c38' : '#81522a');
      rect(5, 25, 3, 3, '#5c391c'); rect(23, 7, 3, 3, '#c18b50');
    } else if (item === PICKAXE) {
      for (let i = 0; i < 18; i++) rect(8 + i, 27 - i, 3, 3, i % 3 ? '#81522a' : '#a26c38');
      rect(5, 5, 21, 4, '#9aa4b2'); rect(3, 7, 5, 4, '#7b8494'); rect(23, 7, 6, 4, '#7b8494');
      rect(6, 4, 16, 2, '#c4ccd7'); rect(25, 6, 3, 2, '#5d6674');
    } else if (item === AXE) {
      for (let i = 0; i < 20; i++) rect(8 + i, 27 - i, 3, 3, i % 3 ? '#81522a' : '#a26c38');
      rect(17, 4, 10, 11, '#9aa4b2'); rect(20, 3, 8, 3, '#c4ccd7'); rect(16, 6, 5, 7, '#7b8494');
      rect(25, 7, 3, 6, '#5d6674'); rect(18, 5, 2, 7, '#d7dee8');
    } else if (item === SWORD) {
      for (let i = 0; i < 22; i++) rect(7 + i, 25 - i, 3, 3, i < 18 ? '#c7d2e2' : '#8793a7');
      for (let i = 0; i < 18; i++) rect(8 + i, 24 - i, 1, 1, '#f4f7ff');
      rect(5, 22, 8, 3, '#d8a33d'); rect(11, 19, 3, 3, '#b47d28');
      rect(3, 25, 5, 4, '#70421e'); rect(1, 27, 4, 3, '#4f2e15');
    } else if (item === GEL) {
      const r = rng(44);
      x.fillStyle = '#5fbf5c'; x.beginPath(); x.ellipse(16, 18, 11, 9, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#8fe477'; x.beginPath(); x.ellipse(12, 14, 5, 4, -0.4, 0, Math.PI * 2); x.fill();
      for (let i = 0; i < 9; i++) rect(8 + ((r() * 16) | 0), 12 + ((r() * 12) | 0), 2, 2, 'rgba(40,100,45,.35)');
      rect(20, 12, 3, 3, '#d9ffd0');
    } else if (item === BANDAGE) {
      rect(5, 9, 22, 15, '#efe8d5'); rect(7, 7, 18, 19, '#f7f2e4');
      rect(13, 10, 6, 13, '#e26464'); rect(9, 14, 14, 5, '#e26464');
      rect(7, 7, 18, 2, '#ffffff'); rect(6, 22, 20, 2, '#c9c0aa');
      rect(21, 9, 3, 2, '#d6ccb6');
    }
    return c;
  }

  function iconURL(item) {
    if (iconCache.has(item)) return iconCache.get(item);
    const url = makeIcon(item).toDataURL('image/png');
    iconCache.set(item, url);
    return url;
  }

  // ------------------------------------------------------------------ Audio
  function ensureAudio() {
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio = new AC();
      const len = Math.floor(audio.sampleRate * 0.5);
      noiseBuffer = audio.createBuffer(1, len, audio.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (audio.state === 'suspended') audio.resume();
  }
  function tone(freq, dur, type = 'sine', vol = 0.05, slide = 0) {
    if (!audio || !soundOn) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, audio.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), audio.currentTime + dur);
    g.gain.setValueAtTime(vol, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + dur);
  }
  function noiseSfx(dur, vol, cutoff) {
    if (!audio || !soundOn || !noiseBuffer) return;
    const s = audio.createBufferSource(), g = audio.createGain(), f = audio.createBiquadFilter();
    s.buffer = noiseBuffer; f.type = 'lowpass'; f.frequency.value = cutoff;
    g.gain.setValueAtTime(vol, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(audio.destination);
    s.start(); s.stop(audio.currentTime + dur);
  }
  function sfx(name) {
    if (!audio || !soundOn) return;
    if (name === 'jump') tone(290, 0.10, 'triangle', 0.045, 170);
    else if (name === 'step') noiseSfx(0.045, 0.018, 700);
    else if (name === 'break') { noiseSfx(0.12, 0.055, 1100); tone(150, 0.07, 'square', 0.02, -40); }
    else if (name === 'place') { tone(180, 0.06, 'square', 0.028, 20); noiseSfx(0.04, 0.018, 900); }
    else if (name === 'craft') { [420, 560, 760].forEach((f, i) => setTimeout(() => tone(f, 0.10, 'triangle', 0.035, 40), i * 65)); }
    else if (name === 'hurt') { tone(150, 0.18, 'sawtooth', 0.055, -80); noiseSfx(0.10, 0.035, 500); }
    else if (name === 'attack') { noiseSfx(0.08, 0.04, 1500); tone(240, 0.06, 'square', 0.025, -60); }
    else if (name === 'mob') { tone(110, 0.20, 'triangle', 0.05, -50); }
    else if (name === 'day') { [392, 523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'sine', 0.035), i * 110)); }
    else if (name === 'click') tone(520, 0.04, 'square', 0.018, 20);
    else if (name === 'error') tone(180, 0.09, 'square', 0.025, -30);
  }

  // ------------------------------------------------------------------ Canvas
  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(W * DPR));
    canvas.height = Math.max(1, Math.floor(H * DPR));
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
    lightCanvas.width = Math.max(1, Math.floor(W));
    lightCanvas.height = Math.max(1, Math.floor(H));
    lightCtx.imageSmoothingEnabled = true;
    mobile = W <= 760;
    const minTS = mobile ? 29 : 33;
    TS = Math.max(minTS, Math.min(46, Math.min(W / 34, H / 22)));
    TS = Math.max(TS, W / 92, H / 60);
    TS = Math.min(48, TS);
    $('touch-controls').classList.toggle('hidden', !(mobile && (mode === 'playing' || mode === 'paused')));
    $('hud').classList.toggle('hidden', !(mode === 'playing' || mode === 'paused' || mode === 'crafting' || mode === 'help' || mode === 'dead'));
    if (stateView) camInit = false;
  }

  function views() {
    if (memBuffer !== memory.buffer) {
      memBuffer = memory.buffer;
      stateView = new Float32Array(memBuffer, wasm.get_state_ptr(), 16);
      invView = new Uint32Array(memBuffer, wasm.get_inventory_ptr(), 18);
      mobView = new Float32Array(memBuffer, wasm.get_mobs_ptr(), wasm.mob_capacity() * 8);
      viewView = new Uint32Array(memBuffer, wasm.get_view_ptr(), 96 * 64);
    }
  }

  // ------------------------------------------------------------------ Sky & palette
  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb(a) { return `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})`; }
  function mixHex(a, b, t) {
    const A = hexRgb(a), B = hexRgb(b);
    return rgb([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)]);
  }
  function mixArr(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

  const SKY_STOPS = [
    [0.00, '#070b1d', '#111a3a'],
    [0.17, '#141a3b', '#34345f'],
    [0.24, '#5a4a75', '#ec9a6b'],
    [0.30, '#72b9e4', '#c9efff'],
    [0.50, '#54ace3', '#d8f3ff'],
    [0.69, '#67b4df', '#ffe1ad'],
    [0.77, '#c4646b', '#f6a05d'],
    [0.84, '#242a54', '#65476e'],
    [1.00, '#070b1d', '#111a3a']
  ];

  function skyAt(t) {
    let a = SKY_STOPS[0], b = SKY_STOPS[1];
    for (let i = 0; i < SKY_STOPS.length - 1; i++) {
      if (t >= SKY_STOPS[i][0] && t <= SKY_STOPS[i + 1][0]) {
        a = SKY_STOPS[i]; b = SKY_STOPS[i + 1]; break;
      }
    }
    const f = smoothstep(0, 1, (t - a[0]) / Math.max(0.0001, b[0] - a[0]));
    return { top: mixHex(a[1], b[1], f), bottom: mixHex(a[2], b[2], f) };
  }

  function nightFactor(t) {
    if (t < 0.19) return 1;
    if (t < 0.29) return 1 - smoothstep(0.19, 0.29, t);
    if (t < 0.70) return 0;
    if (t < 0.82) return smoothstep(0.70, 0.82, t);
    if (t < 0.92) return 1;
    return 1;
  }

  function drawSky(t, night) {
    const colors = skyAt(t);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, colors.top);
    g.addColorStop(0.72, colors.bottom);
    g.addColorStop(1, mixHex(colors.bottom, '#1a1824', 0.45));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (night > 0.02) {
      const r = rng(1337);
      for (let i = 0; i < 110; i++) {
        const sx = r() * W, sy = r() * H * 0.72;
        const tw = 0.55 + 0.45 * Math.sin(visualClock * 1.7 + i * 2.1);
        ctx.fillStyle = `rgba(226,236,255,${night * (0.20 + 0.65 * tw) * (1 - sy / H * 0.35)})`;
        const size = r() > 0.92 ? 2 : 1;
        ctx.fillRect(sx, sy, size, size);
      }
    }

    const horizon = (wasm.surface_at_export(Math.floor(cam.x)) - cam.y) * TS + H / 2;
    const isDay = t > 0.23 && t < 0.79;
    const p = isDay ? (t - 0.23) / 0.56 : (((t + 0.21) % 1) / 0.44);
    const cx = W * (0.08 + 0.84 * p);
    const cy = horizon - Math.sin(Math.PI * clamp(p, 0, 1)) * H * 0.56 - H * 0.06;
    const radius = TS * (isDay ? 1.1 : 0.9);
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius * 5.5);
    if (isDay) {
      glow.addColorStop(0, 'rgba(255,240,180,.5)');
      glow.addColorStop(0.35, 'rgba(255,215,120,.16)');
      glow.addColorStop(1, 'rgba(255,215,120,0)');
      ctx.fillStyle = glow; ctx.fillRect(cx - radius * 6, cy - radius * 6, radius * 12, radius * 12);
      ctx.fillStyle = '#ffe9a0'; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff7d1'; ctx.beginPath(); ctx.arc(cx - radius * 0.25, cy - radius * 0.25, radius * 0.55, 0, Math.PI * 2); ctx.fill();
    } else {
      glow.addColorStop(0, 'rgba(180,205,255,.28)');
      glow.addColorStop(0.45, 'rgba(120,155,255,.08)');
      glow.addColorStop(1, 'rgba(120,155,255,0)');
      ctx.fillStyle = glow; ctx.fillRect(cx - radius * 6, cy - radius * 6, radius * 12, radius * 12);
      ctx.fillStyle = '#dfe8ff'; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(135,153,196,.35)'; ctx.beginPath(); ctx.arc(cx + radius * .3, cy - radius * .18, radius * .22, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx - radius * .22, cy + radius * .26, radius * .16, 0, Math.PI * 2); ctx.fill();
    }

    // Slow pixel clouds.
    const cloudCol = mixHex('#f5fbff', '#7e90b5', night * 0.55);
    ctx.fillStyle = cloudCol;
    for (let i = 0; i < 5; i++) {
      const span = W + 420;
      let x = ((i * 263 + visualClock * (4 + i) - cam.x * TS * 0.025) % span + span) % span - 210;
      const y = H * (0.12 + i * 0.075) + Math.sin(i * 2.1) * 15;
      const s = 0.7 + (i % 3) * 0.22;
      ctx.globalAlpha = 0.22 + night * 0.06;
      ctx.fillRect(x, y, 72 * s, 8 * s);
      ctx.fillRect(x + 14 * s, y - 8 * s, 34 * s, 10 * s);
      ctx.fillRect(x + 32 * s, y - 4 * s, 26 * s, 8 * s);
      ctx.fillRect(x - 12 * s, y + 2 * s, 20 * s, 6 * s);
    }
    ctx.globalAlpha = 1;

    // Layered mountain silhouettes.
    const far = mixArr(hexRgb('#8db6cd'), hexRgb('#1a2340'), night);
    const mid = mixArr(hexRgb('#6289a4'), hexRgb('#121c36'), night);
    const near = mixArr(hexRgb('#4c7865'), hexRgb('#0c1b21'), night);
    drawRidge(horizon - 14, H * 0.20, `rgb(${far.join(',')})`, 0.16, 0.4, 1.0, 24);
    drawRidge(horizon - 3, H * 0.14, `rgb(${mid.join(',')})`, 0.32, 2.2, 1.45, 18);
    drawRidge(horizon + 14, H * 0.09, `rgb(${near.join(',')})`, 0.56, 4.5, 1.9, 14);

    // Small trees on the closest ridge.
    ctx.fillStyle = `rgba(${near[0] * 0.62 | 0},${near[1] * 0.7 | 0},${near[2] * 0.66 | 0},.85)`;
    for (let i = 0; i < 26; i++) {
      const x = ((i * 83 - cam.x * TS * 0.56) % (W + 160) + W + 160) % (W + 160) - 80;
      const y = horizon + 12 + Math.sin(i * 1.7) * 4;
      const h = 11 + (i % 4) * 3;
      ctx.fillRect(x - 1, y - h * .45, 2, h * .45);
      ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x - h * .36, y - h * .28); ctx.lineTo(x + h * .36, y - h * .28); ctx.fill();
    }
  }

  function drawRidge(baseY, amp, color, parallax, phase, freq, step) {
    const off = cam.x * TS * parallax;
    ctx.beginPath();
    ctx.moveTo(-30, H + 30);
    for (let x = -30; x <= W + 30; x += step) {
      const u = (x + off) * 0.006;
      const y = baseY - (0.52 + 0.48 * Math.sin(u * freq + phase)) * amp
        - Math.sin(u * freq * 2.7 + phase * 2) * amp * 0.22;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W + 30, H + 30);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // ------------------------------------------------------------------ World
  function drawWorld(state, night) {
    const cols = Math.min(96, Math.ceil(W / TS) + 4);
    const rows = Math.min(64, Math.ceil(H / TS) + 4);
    const x0 = Math.floor(cam.x - W / (2 * TS)) - 2;
    const y0 = Math.floor(cam.y - H / (2 * TS)) - 2;
    wasm.fill_view(x0, y0, cols, rows);
    views();
    const torches = [];

    // Cave walls first.
    for (let j = 0; j < rows; j++) {
      const sy = (y0 + j - cam.y) * TS + H / 2;
      for (let i = 0; i < cols; i++) {
        const v = viewView[j * cols + i];
        const tile = v & 255, wall = (v >> 8) & 255;
        if (wall === 0) continue;
        const sx = (x0 + i - cam.x) * TS + W / 2;
        const variant = (Math.abs(x0 + i) * 3 + Math.abs(y0 + j) * 7) % 3;
        ctx.drawImage(wallTex(wall, variant), sx, sy, TS + 0.5, TS + 0.5);
        if (tile === AIR) {
          ctx.fillStyle = 'rgba(4,7,15,.16)';
          ctx.fillRect(sx, sy, TS + 0.5, TS + 0.5);
        }
      }
    }

    // Solid tiles & decorations.
    for (let j = 0; j < rows; j++) {
      const wy = y0 + j;
      const sy = (wy - cam.y) * TS + H / 2;
      for (let i = 0; i < cols; i++) {
        const wx = x0 + i;
        const v = viewView[j * cols + i];
        const tile = v & 255;
        if (tile === AIR) continue;
        const sx = (wx - cam.x) * TS + W / 2;
        const variant = (Math.abs(wx) * 5 + Math.abs(wy) * 3) % 3;
        ctx.drawImage(tileTex(tile, variant), sx, sy, TS + 0.6, TS + 0.6);
        if (tile === TORCH) {
          torches.push({ x: wx + 0.5, y: wy + 0.5, sx: sx + TS / 2, sy: sy + TS / 2, phase: (wx * 7 + wy * 13) % 10 });
          if (Math.random() < 0.012 && particles.length < 260) spawnEmber(wx + 0.5, wy + 0.3);
        }
      }
    }
    return torches;
  }

  // ------------------------------------------------------------------ Actors
  function drawPlayer(state) {
    const sx = (state[0] - cam.x) * TS + W / 2;
    const sy = (state[1] - cam.y) * TS + H / 2;
    const invuln = state[8] > 0 && Math.floor(state[8] * 18) % 2 === 0;
    const moving = Math.abs(state[2]) > 0.3 && state[6] > 0.5;
    if (moving) stepPhase += Math.abs(state[2]) * 0.045;

    ctx.save();
    ctx.fillStyle = 'rgba(3,6,12,.32)';
    ctx.beginPath();
    ctx.ellipse(sx, sy + 1, TS * 0.36, TS * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(sx, sy);
    ctx.scale(state[7] < 0 ? -1 : 1, 1);
    const sw = TS * 0.76, sh = TS * 1.72;
    const u = sw / 16;
    const v = sh / 30;
    const swing = Math.sin(stepPhase) * (moving ? 3.2 : 0);
    const bob = moving ? Math.abs(Math.sin(stepPhase)) * 1.0 : 0;
    if (invuln) ctx.globalAlpha = 0.45;

    const skin = '#e0a06e', skin2 = '#b9764e', hair = '#3b2a27';
    const shirt = '#2c9b9a', shirt2 = '#1e7477', pants = '#3d4a74', pants2 = '#2a3454';
    const draw = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x * u), Math.round((y - bob) * v), Math.ceil(w * u), Math.ceil(h * v)); };

    // backpack
    draw(1.1, 11.5, 2.5, 7, '#75512e');
    // legs
    draw(4, 19, 3.2, 8.3, pants);
    draw(8.8, 19, 3.2, 8.3, pants);
    draw(3.4, 26, 4, 3, '#2a1f20');
    draw(8.8, 26, 4, 3, '#2a1f20');
    draw(4.1, 19, 1, 7, pants2);
    draw(9, 19, 1, 7, pants2);
    // torso
    draw(4, 10.2, 8, 9.3, shirt);
    draw(4, 10.2, 2, 8.5, '#39b0ad');
    draw(10.2, 10.2, 1.8, 8.5, shirt2);
    draw(4, 18, 8, 1.3, '#1d5d60');
    // head
    draw(4.2, 2.2, 7.8, 8.4, skin);
    draw(4, 1.5, 8.2, 2.3, hair);
    draw(4, 2.8, 1.6, 5.3, hair);
    draw(10.7, 3.2, 1.4, 4.4, hair);
    draw(6.4, 5.6, 1.2, 1.4, '#2a2028');
    draw(9.3, 5.6, 1.2, 1.4, '#2a2028');
    draw(8.2, 8.1, 2.1, 0.8, '#a65f46');
    // arms
    draw(2.2, 11.3, 2.2, 7.1, skin2);
    draw(12.1, 11.2, 2.3, 7.2, skin);
    draw(1.9, 10.9, 2.5, 2.2, shirt);
    draw(12, 10.9, 2.5, 2.2, shirt);
    // hands
    draw(1.8, 17.5, 2.5, 1.8, skin);
    draw(12.1, 17.6, 2.5, 1.8, skin);

    // Held tool / torch.
    const item = invView ? invView[state[12] * 2] : 0;
    const handX = 13.2, handY = 17.2;
    if (item === PICKAXE) {
      draw(handX, handY - 1.5, 1.4, 8.2, '#8b5a2f');
      draw(handX - 2.8, handY - 2.5, 7.3, 1.6, '#9da7b5');
      draw(handX - 3.2, handY - 1.7, 1.8, 2.4, '#7a8494');
    } else if (item === AXE) {
      draw(handX, handY - 1.5, 1.4, 8.2, '#8b5a2f');
      draw(handX - 1.8, handY - 3.3, 4.2, 4.4, '#9da7b5');
      draw(handX - 1.6, handY - 3.1, 2.2, 3.6, '#c3ccd7');
    } else if (item === SWORD) {
      draw(handX, handY - 4.0, 1.2, 7.8, '#c3ccd7');
      draw(handX + .8, handY - 4.0, .5, 6.8, '#f1f5ff');
      draw(handX - 1.5, handY + 1.8, 4.2, 1.2, '#d8a33d');
      draw(handX - .4, handY + 2.8, 1.8, 2.4, '#6d421f');
    } else if (item === TORCH) {
      draw(handX, handY - 2.5, 1.2, 7.4, '#7c4a24');
      draw(handX - 1.2, handY - 4.1, 3.3, 2.4, '#ff8f32');
      draw(handX - .5, handY - 5.2, 1.9, 2.7, '#ffe278');
    } else if (item === BANDAGE) {
      draw(handX - 1.4, handY - 1.0, 3.4, 2.5, '#f0e7d3');
      draw(handX - .2, handY - .9, .9, 2.1, '#dd6262');
    }

    ctx.restore();

    // Mining arm swing cue.
    if (mining.active && mining.progress > 0) {
      const p = mining.progress / 100;
      ctx.save();
      ctx.strokeStyle = `rgba(255,244,205,${0.35 + p * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx + state[7] * TS * 0.25, sy - TS * 0.9, TS * 0.42, -0.8, 0.5);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawMobs() {
    for (let i = 0; i < wasm.mob_capacity(); i++) {
      const o = i * 8;
      if (mobView[o + 6] < 0.5) continue;
      const wx = mobView[o], wy = mobView[o + 1], hp = mobView[o + 2], maxHp = mobView[o + 3], flash = mobView[o + 5];
      const sx = (wx - cam.x) * TS + W / 2;
      const sy = (wy - cam.y) * TS + H / 2;
      const squish = 1 + Math.sin(visualClock * 7 + i) * 0.09;
      const bodyW = TS * 0.86, bodyH = TS * 0.68 * squish;
      ctx.save();
      ctx.fillStyle = 'rgba(3,6,12,.3)';
      ctx.beginPath(); ctx.ellipse(sx, sy + 1, bodyW * .45, TS * .10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.translate(sx, sy - bodyH * 0.52);
      ctx.fillStyle = flash > 0 ? '#f8ffe0' : '#63c95f';
      ctx.beginPath(); ctx.ellipse(0, 0, bodyW * .5, bodyH * .5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = flash > 0 ? '#ffffff' : '#8ee47d';
      ctx.beginPath(); ctx.ellipse(-bodyW * .13, -bodyH * .16, bodyW * .22, bodyH * .19, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#203c24';
      ctx.beginPath(); ctx.arc(-bodyW * .16, -bodyH * .05, Math.max(1.4, TS * .045), 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(bodyW * .16, -bodyH * .05, Math.max(1.4, TS * .045), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f3ffd4';
      ctx.fillRect(-bodyW * .18, -bodyH * .07, 1.5, 1.5);
      ctx.fillRect(bodyW * .14, -bodyH * .07, 1.5, 1.5);
      ctx.restore();
      if (hp < maxHp) {
        const bw = TS * .75;
        ctx.fillStyle = 'rgba(4,7,14,.75)';
        ctx.fillRect(sx - bw / 2, sy - bodyH - TS * .34, bw, 4);
        ctx.fillStyle = '#9be86c';
        ctx.fillRect(sx - bw / 2 + 1, sy - bodyH - TS * .34 + 1, (bw - 2) * clamp(hp / maxHp, 0, 1), 2);
      }
    }
  }

  // ------------------------------------------------------------------ FX
  function spawnParticle(x, y, vx, vy, life, color, size, gravity = 18, glow = false) {
    if (particles.length > 340) particles.shift();
    particles.push({ x, y, vx, vy, life, max: life, color, size, gravity, glow });
  }
  function tileColor(tile) {
    return {
      [GRASS]: '#6bc24a', [DIRT]: '#81522f', [STONE]: '#8d97a6', [WOOD]: '#956132',
      [LEAVES]: '#4d9b43', [PLANK]: '#c08a50', [TORCH]: '#ffab3f', [COAL]: '#32343c',
      [IRON]: '#d9a17b', [GOLD]: '#f5cf5b', [SAND]: '#e4cd8a', [FLOWER]: '#ff7d5e',
      [TABLE]: '#c08a50', [BRICK]: '#9aa0aa'
    }[tile] || '#9a8a72';
  }
  function burstBlock(wx, wy, tile) {
    const col = tileColor(tile);
    for (let i = 0; i < 11; i++) {
      spawnParticle(wx + .2 + Math.random() * .6, wy + .2 + Math.random() * .6,
        (Math.random() - .5) * 4.5, -Math.random() * 5.2, .45 + Math.random() * .55, col,
        2 + Math.random() * 3, 20);
    }
  }
  function spawnEmber(x, y) {
    spawnParticle(x + (Math.random() - .5) * .25, y, (Math.random() - .5) * .35, -.5 - Math.random() * .8,
      .8 + Math.random() * 1.1, Math.random() > .45 ? '#ffbe4d' : '#ff7b2e', 1.5 + Math.random() * 1.5, -1.4, true);
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 1.6 * dt;
    }
  }
  function drawParticles() {
    for (const p of particles) {
      const sx = (p.x - cam.x) * TS + W / 2;
      const sy = (p.y - cam.y) * TS + H / 2;
      if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
      const a = clamp(p.life / p.max, 0, 1);
      if (p.glow) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * .7;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(sx, sy, p.size * 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(sx, sy, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function ensureFireflies() {
    if (fireflies.length === 0) {
      const r = rng(8123);
      for (let i = 0; i < 26; i++) {
        fireflies.push({ x: stateView[0] + (r() - .5) * 36, y: stateView[1] - 4 + (r() - .5) * 16, phase: r() * 10, speed: .2 + r() * .5 });
      }
    }
    for (const f of fireflies) {
      f.phase += .016 * f.speed;
      f.x += Math.sin(f.phase) * .003;
      f.y += Math.cos(f.phase * 1.3) * .002;
      if (Math.abs(f.x - stateView[0]) > 24 || Math.abs(f.y - stateView[1]) > 15) {
        f.x = stateView[0] + (Math.random() - .5) * 36;
        f.y = stateView[1] - 3 + (Math.random() - .5) * 14;
      }
    }
  }
  function drawFireflies(night) {
    if (night < 0.08) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const f of fireflies) {
      const sx = (f.x - cam.x) * TS + W / 2;
      const sy = (f.y - cam.y) * TS + H / 2;
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      const a = night * (0.35 + 0.55 * (0.5 + 0.5 * Math.sin(f.phase * 2.6)));
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 7);
      g.addColorStop(0, `rgba(218,255,146,${a})`);
      g.addColorStop(1, 'rgba(160,255,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - 7, sy - 7, 14, 14);
      ctx.fillStyle = `rgba(235,255,185,${a})`;
      ctx.fillRect(sx, sy, 1.4, 1.4);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------------ Lighting
  function drawLighting(torches, night, state) {
    const cols = Math.min(96, Math.ceil(W / TS) + 4);
    const rows = Math.min(64, Math.ceil(H / TS) + 4);
    const x0 = Math.floor(cam.x - W / (2 * TS)) - 2;
    const y0 = Math.floor(cam.y - H / (2 * TS)) - 2;
    if (lowLight.width !== cols || lowLight.height !== rows) {
      lowLight.width = cols; lowLight.height = rows;
    }
    lowCtx.clearRect(0, 0, cols, rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const v = viewView[j * cols + i];
        const wall = (v >> 8) & 255;
        let a;
        if (wall === 0) a = 0.02 + night * 0.43;
        else if (wall === 1) a = 0.52;
        else a = 0.86;
        // A soft glow follows the player even underground.
        if (a > 0.3) {
          const dx = (x0 + i + .5) - state[0];
          const dy = (y0 + j + .5) - (state[1] - .9);
          const d = Math.sqrt(dx * dx + dy * dy);
          a *= clamp((d - 2.0) / 5.0, 0, 1);
        }
        lowCtx.fillStyle = `rgba(4,6,18,${a.toFixed(3)})`;
        lowCtx.fillRect(i, j, 1, 1);
      }
    }
    lightCtx.globalCompositeOperation = 'source-over';
    lightCtx.clearRect(0, 0, W, H);
    lightCtx.imageSmoothingEnabled = true;
    lightCtx.drawImage(lowLight, 0, 0, W, H);

    const cut = (sx, sy, radius, strength) => {
      const g = lightCtx.createRadialGradient(sx, sy, 0, sx, sy, radius);
      g.addColorStop(0, `rgba(0,0,0,${strength})`);
      g.addColorStop(0.38, `rgba(0,0,0,${strength * .92})`);
      g.addColorStop(0.75, `rgba(0,0,0,${strength * .35})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      lightCtx.globalCompositeOperation = 'destination-out';
      lightCtx.fillStyle = g;
      lightCtx.beginPath();
      lightCtx.arc(sx, sy, radius, 0, Math.PI * 2);
      lightCtx.fill();
    };

    const psx = (state[0] - cam.x) * TS + W / 2;
    const psy = (state[1] - 0.9 - cam.y) * TS + H / 2;
    cut(psx, psy, TS * 6.1, 0.86);
    for (const t of torches) cut(t.sx, t.sy, TS * 4.9, 0.94);

    ctx.drawImage(lightCanvas, 0, 0, W, H);

    // Warm pools of light + a cool lantern aura.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const aura = ctx.createRadialGradient(psx, psy, 0, psx, psy, TS * 5.6);
    aura.addColorStop(0, `rgba(116,148,255,${0.09 + night * 0.10})`);
    aura.addColorStop(0.5, `rgba(76,104,210,${0.035 + night * 0.04})`);
    aura.addColorStop(1, 'rgba(76,104,210,0)');
    ctx.fillStyle = aura;
    ctx.fillRect(psx - TS * 6, psy - TS * 6, TS * 12, TS * 12);
    for (const t of torches) {
      const flicker = 0.88 + Math.sin(visualClock * 9 + t.phase) * 0.08;
      const g = ctx.createRadialGradient(t.sx, t.sy, 0, t.sx, t.sy, TS * 4.5 * flicker);
      g.addColorStop(0, 'rgba(255,183,82,.26)');
      g.addColorStop(0.35, 'rgba(255,138,54,.11)');
      g.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(t.sx - TS * 5, t.sy - TS * 5, TS * 10, TS * 10);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ Cursor & overlays
  function tileAtScreen(sx, sy) {
    return {
      x: Math.floor(cam.x + (sx - W / 2) / TS),
      y: Math.floor(cam.y + (sy - H / 2) / TS)
    };
  }
  function playerCenter(state) { return { x: state[0], y: state[1] - 0.9 }; }
  function inReach(state, tx, ty) {
    const p = playerCenter(state);
    return Math.abs(tx + .5 - p.x) <= 6.8 && Math.abs(ty + .5 - p.y) <= 6.8;
  }

  function drawCursor(state) {
    if (mobile || !pointerInside || mode !== 'playing') return;
    const tx = cursor.x, ty = cursor.y;
    if (!inReach(state, tx, ty)) return;
    const sx = (tx - cam.x) * TS + W / 2;
    const sy = (ty - cam.y) * TS + H / 2;
    const selected = invView[state[12] * 2];
    const canPlace = selected >= 1 && selected <= 15;
    const color = canPlace ? 'rgba(185,239,105,.9)' : 'rgba(255,219,120,.9)';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx + 1.5, sy + 1.5, TS - 3, TS - 3);
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.strokeRect(sx + 3.5, sy + 3.5, TS - 7, TS - 7);
    const corner = 7;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy + corner); ctx.lineTo(sx, sy); ctx.lineTo(sx + corner, sy);
    ctx.moveTo(sx + TS - corner, sy); ctx.lineTo(sx + TS, sy); ctx.lineTo(sx + TS, sy + corner);
    ctx.moveTo(sx, sy + TS - corner); ctx.lineTo(sx, sy + TS); ctx.lineTo(sx + corner, sy + TS);
    ctx.moveTo(sx + TS - corner, sy + TS); ctx.lineTo(sx + TS, sy + TS); ctx.lineTo(sx + TS, sy + TS - corner);
    ctx.stroke();
    if (mining.active && mining.progress > 0) {
      const p = mining.progress / 100;
      ctx.strokeStyle = `rgba(255,247,220,${0.35 + p * .55})`;
      ctx.lineWidth = 1.2;
      const rr = rng(tx * 97 + ty * 31);
      for (let i = 0; i < 6; i++) {
        const ax = sx + 3 + rr() * (TS - 6), ay = sy + 3 + rr() * (TS - 6);
        ctx.beginPath(); ctx.moveTo(ax, ay);
        ctx.lineTo(ax + (rr() - .5) * TS * .35, ay + (rr() - .5) * TS * .35); ctx.stroke();
      }
    }
    const v = viewView[(ty - Math.floor(cam.y - H / (2 * TS)) - 2) * Math.min(96, Math.ceil(W / TS) + 4) + (tx - Math.floor(cam.x - W / (2 * TS)) - 2)];
    const tile = v & 255;
    if (tile !== AIR) {
      const label = TILE_NAMES[tile] || 'Bloque';
      ctx.font = '700 10px "Courier New", monospace';
      const tw = ctx.measureText(label).width + 16;
      let bx = sx + TS + 8, by = sy - 6;
      if (bx + tw > W - 8) bx = sx - tw - 8;
      if (by < 8) by = 8;
      ctx.fillStyle = 'rgba(7,11,24,.88)';
      ctx.fillRect(bx, by, tw, 23);
      ctx.strokeStyle = 'rgba(170,200,255,.22)'; ctx.lineWidth = 1;
      ctx.strokeRect(bx + .5, by + .5, tw - 1, 22);
      ctx.fillStyle = '#e9eedb'; ctx.fillText(label, bx + 8, by + 15);
    }
    ctx.restore();
  }

  function drawMiningCracks() {
    // Cracks are drawn in screen space by drawCursor; world tiles remain intact
    // until the Rust simulation confirms a break.
  }

  function render() {
    if (!wasm) return;
    views();
    if (!stateView) return;
    const state = stateView;
    const t = state[9], night = nightFactor(t);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Camera follows smoothly; on the title screen the hero is framed to the right.
    const targetX = mode === 'title' ? state[0] - W * 0.16 / TS : state[0];
    const targetY = state[1] - 1.35;
    if (!camInit) { cam.x = targetX; cam.y = targetY; camInit = true; }
    else {
      const follow = reduceMotion ? 1 : 1 - Math.pow(0.00008, 1 / 60);
      cam.x = lerp(cam.x, targetX, follow);
      cam.y = lerp(cam.y, targetY, follow * 0.9);
    }
    if (shake > 0.02) {
      cam.x += (Math.random() - .5) * shake;
      cam.y += (Math.random() - .5) * shake * 0.7;
      shake *= 0.88;
    }

    drawSky(t, night);
    const torches = drawWorld(state, night);
    ensureFireflies();
    drawFireflies(night);
    drawMobs();
    drawPlayer(state);
    drawParticles();
    drawLighting(torches, night, state);
    drawCursor(state);
    drawMiningCracks();

    if (flash > 0.01) {
      ctx.fillStyle = `rgba(255,50,60,${flash * .22})`;
      ctx.fillRect(0, 0, W, H);
      flash *= 0.86;
    }
  }

  // ------------------------------------------------------------------ UI shell
  function setMode(next) {
    mode = next;
    syncShell();
  }

  function syncShell() {
    const showHud = ['playing', 'paused', 'crafting', 'help', 'dead'].includes(mode);
    $('hud').classList.toggle('hidden', !showHud);
    $('touch-controls').classList.toggle('hidden', !(mobile && mode === 'playing'));
    $('start-screen').classList.toggle('hidden', !(mode === 'title' || (mode === 'help' && helpReturn === 'title')));
    $('pause-screen').classList.toggle('hidden', mode !== 'paused');
    $('death-screen').classList.toggle('hidden', mode !== 'dead');
    $('craft-screen').classList.toggle('hidden', mode !== 'crafting');
    $('help-screen').classList.toggle('hidden', mode !== 'help');
    canvas.style.cursor = mode === 'playing' ? 'crosshair' : 'default';
  }

  function clearInputs() {
    mouseHeld = false;
    touchMining = false;
    touch.left = touch.right = touch.jump = false;
    document.querySelectorAll('.touch-btn.held').forEach(b => b.classList.remove('held'));
    if (wasm) wasm.set_input(0);
    if (wasm) wasm.cancel_mine();
    mining.active = false;
    mining.progress = 0;
  }

  function startGame() {
    ensureAudio();
    setMode('playing');
    $('start-screen').classList.add('hidden');
    clearInputs();
    sfx('click');
    showToast('Golpea un árbol con clic izquierdo para conseguir madera.', 'good', 3.4);
  }

  function pauseGame() {
    if (mode !== 'playing') return;
    clearInputs();
    setMode('paused');
  }

  function resumeGame() {
    if (mode !== 'paused') return;
    clearInputs();
    setMode('playing');
    sfx('click');
  }

  function openCraft() {
    if (mode !== 'playing') return;
    clearInputs();
    setMode('crafting');
    refreshRecipes();
    sfx('click');
  }

  function closeCraft() {
    if (mode !== 'crafting') return;
    setMode('playing');
    sfx('click');
  }

  function openHelp(from) {
    helpReturn = from;
    if (from === 'playing') clearInputs();
    if (from === 'paused') $('pause-screen').classList.add('hidden');
    setMode('help');
    sfx('click');
  }

  function closeHelp() {
    if (mode !== 'help') return;
    if (helpReturn === 'paused') {
      setMode('paused');
    } else if (helpReturn === 'title') {
      setMode('title');
    } else {
      setMode('playing');
    }
    sfx('click');
  }

  function showDeath() {
    if (deathShown) return;
    deathShown = true;
    clearInputs();
    setMode('dead');
    sfx('mob');
  }

  function respawnGame() {
    if (!wasm) return;
    wasm.respawn();
    views();
    deathShown = false;
    particles.length = 0;
    setMode('playing');
    showToast('Has vuelto a la superficie. Esta vez, prepara antorchas.', 'good', 3);
    sfx('click');
  }

  function newWorld(play) {
    if (!wasm) return;
    const seed = new Uint32Array(1);
    crypto.getRandomValues(seed);
    worldSeed = seed[0];
    wasm.init(worldSeed);
    views();
    camInit = false;
    deathShown = false;
    particles.length = 0;
    fireflies.length = 0;
    mining.active = false;
    mining.progress = 0;
    hotbarSig = '';
    questSig = '';
    clearInputs();
    if (play) {
      setMode('playing');
      showToast('Nuevo mundo generado. Encuentra madera y sobrevive.', 'good', 3.2);
    } else {
      setMode('title');
    }
    sfx('click');
  }

  function showToast(msg, type = '', duration = 2.5) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show ' + type;
    toastTimer = duration;
  }

  function updateToast(dt) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) $('toast').classList.remove('show');
    }
  }

  function buildHUD() {
    const hearts = $('hearts');
    hearts.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const h = document.createElement('span');
      h.className = 'heart';
      hearts.appendChild(h);
    }
    const list = $('quest-list');
    list.innerHTML = '';
    for (const q of QUESTS) {
      const li = document.createElement('li');
      li.dataset.flag = q.flag;
      li.innerHTML = `<span class="check"></span><span>${q.text}</span>`;
      list.appendChild(li);
    }
    hotbarSig = '';
    questSig = '';
  }

  function updateHUD() {
    if (!wasm) return;
    views();
    if (!stateView || !invView) return;
    const s = stateView;
    const health = clamp(Math.ceil(s[4]), 0, 10);
    const hearts = $('hearts').children;
    for (let i = 0; i < hearts.length; i++) {
      const filled = i < health;
      hearts[i].classList.toggle('empty', !filled);
      hearts[i].classList.toggle('beat', filled && i === health - 1 && s[8] > 0);
    }
    const flags = s[11] | 0;
    if (questSig !== flags) {
      let done = 0;
      for (const li of $('quest-list').children) {
        const f = Number(li.dataset.flag);
        const ok = (flags & f) !== 0;
        li.classList.toggle('done', ok);
        if (ok) done++;
      }
      $('quest-count').textContent = `${done}/${QUESTS.length}`;
      questSig = flags;
    }
    $('day-label').textContent = `DÍA ${Math.max(1, s[10] | 0)}`;
    const totalMin = Math.floor(s[9] * 24 * 60);
    const hh = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
    const mm = String(totalMin % 60).padStart(2, '0');
    $('time-label').textContent = `${hh}:${mm}`;
    $('time-icon').textContent = s[15] > .5 ? '☾' : '☀';
    const depth = Math.max(0, Math.round(s[13]));
    $('depth-label').textContent = depth > 0 ? `${depth} m` : 'Superficie';
    const t = s[9];
    $('weather-label').textContent = t > .79 || t < .21 ? 'Noche cerrada' : t < .30 ? 'Amanecer' : t > .72 ? 'Atardecer' : 'Despejado';

    const sig = Array.from({ length: 9 }, (_, i) => `${invView[i * 2]}:${invView[i * 2 + 1]}`).join('|') + '#' + (s[12] | 0);
    if (sig !== hotbarSig) {
      hotbarSig = sig;
      const bar = $('hotbar');
      let html = '';
      for (let i = 0; i < 9; i++) {
        const id = invView[i * 2], count = invView[i * 2 + 1];
        const sel = (s[12] | 0) === i ? ' selected' : '';
        if (id === 0) html += `<button class="slot empty${sel}" data-slot="${i}" aria-label="Ranura ${i + 1} vacía"><span class="num">${i + 1}</span></button>`;
        else html += `<button class="slot${sel}" data-slot="${i}" aria-label="${ITEM_NAMES[id] || 'Objeto'}"><span class="num">${i + 1}</span><img src="${iconURL(id)}" alt=""><span class="count">${count > 1 ? count : ''}</span></button>`;
      }
      bar.innerHTML = html;
      const sel = invView[(s[12] | 0) * 2];
      $('selected-label').textContent = sel ? (ITEM_NAMES[sel] || 'Objeto') : 'Manos';
    }
  }

  function refreshRecipes() {
    if (mode !== 'crafting' || !wasm) return;
    views();
    const bar = $('recipe-grid');
    let html = '';
    let available = 0;
    for (const rec of RECIPES) {
      const status = wasm.can_craft(rec.id);
      if (status === 1) available++;
      const reqs = rec.req.map(([id, n]) => {
        let have = 0;
        for (let i = 0; i < 9; i++) if (invView[i * 2] === id) have += invView[i * 2 + 1];
        return `<span class="${have >= n ? 'ok' : 'bad'}">${ITEM_NAMES[id]} ${have}/${n}</span>`;
      }).join('');
      const statusText = status === 1 ? 'Fabricar ▸' : status === 2 ? 'Requiere mesa cerca' : status === 4 ? 'Inventario lleno' : 'Faltan materiales';
      const cls = status === 1 ? 'craftable' : 'unavailable';
      html += `<button class="recipe ${cls}" data-recipe="${rec.id}">
        <span class="recipe-icon"><img src="${iconURL(rec.out)}" alt=""></span>
        <span><span class="recipe-name">${rec.name}<small>×${rec.n}</small></span>
        <span class="req">${reqs}</span>
        ${rec.table ? '<span class="recipe-badge">MESA</span>' : ''}
        <span class="recipe-status">${statusText}</span></span>
      </button>`;
    }
    if (html !== recipeHtml) { bar.innerHTML = html; recipeHtml = html; }
    $('craft-note').textContent = available > 0 ? `${available} receta${available === 1 ? '' : 's'} disponible${available === 1 ? '' : 's'}` : 'Consigue más materiales';
  }

  function handleCraft(id) {
    if (!wasm) return;
    const result = wasm.craft(id);
    views();
    const rec = RECIPES.find(r => r.id === id);
    if (result === 1) {
      sfx('craft');
      showToast(`Fabricado: ${rec ? rec.name : 'objeto'}`, 'good', 1.6);
      updateHUD();
      refreshRecipes();
    } else if (result === 2) {
      sfx('error');
      showToast('Necesitas una mesa de trabajo cerca. Colócala y vuelve.', 'warn', 2.4);
    } else if (result === 3) {
      sfx('error');
      showToast('Faltan materiales para esa receta.', 'warn', 2);
    } else if (result === 4) {
      sfx('error');
      showToast('Tu inventario está lleno.', 'warn', 2);
    }
  }

  // ------------------------------------------------------------------ Actions
  function handlePlace(tx, ty) {
    const r = wasm.place_at(tx, ty);
    views();
    if (r === 1) {
      sfx('place');
      for (let i = 0; i < 4; i++) spawnParticle(tx + .5, ty + .6, (Math.random() - .5) * 2, -Math.random() * 1.5, .35, '#d8cfae', 2, 10);
      updateHUD();
    } else if (r === -4) {
      sfx('error');
      showToast('Selecciona un bloque colocable (1–9).', 'warn', 1.5);
    } else if (r === -5) {
      showToast('No puedes colocarlo encima de ti.', 'warn', 1.4);
    } else if (r === -6) {
      sfx('error');
      showToast('Necesita un bloque o pared de apoyo.', 'warn', 1.6);
    } else if (r === -2) {
      sfx('error');
      showToast('Ese espacio está ocupado.', 'warn', 1.4);
    }
  }

  function handleAttack() {
    const dir = pointerInside ? Math.sign(cursor.x + .5 - stateView[0]) || 1 : stateView[7];
    const hits = wasm.attack(dir);
    views();
    if (hits > 0) {
      sfx('attack');
      shake = Math.max(shake, 2.2);
      for (let i = 0; i < 8; i++) spawnParticle(stateView[0] + dir * .9, stateView[1] - 1.0, dir * (1 + Math.random() * 3), -Math.random() * 3, .3, '#d9ff9a', 2, 15, true);
    } else {
      sfx('step');
    }
  }

  function mineTick(dt) {
    if (mode !== 'playing' || !(mouseHeld || touchMining)) {
      if (mining.active) wasm.cancel_mine();
      mining.active = false;
      mining.progress = 0;
      return;
    }
    if (!inReach(stateView, cursor.x, cursor.y)) {
      mining.active = false;
      mining.progress = 0;
      return;
    }
    const result = wasm.mine_at(cursor.x, cursor.y, dt);
    views();
    if (result >= 1000) {
      const item = result - 1000;
      const tile = wasm.get_tile_export(cursor.x, cursor.y);
      burstBlock(cursor.x, cursor.y, tile);
      sfx('break');
      shake = Math.max(shake, 1.2);
      if (item > 0) showToast(`+1 ${ITEM_NAMES[item] || 'bloque'}`, 'good', 1.0);
      mining.active = false;
      mining.progress = 0;
      updateHUD();
    } else if (result >= 0) {
      mining.active = true;
      mining.progress = result;
      mining.x = cursor.x;
      mining.y = cursor.y;
      if (result > 0 && Math.random() < 0.12) {
        spawnParticle(cursor.x + .5, cursor.y + .5, (Math.random() - .5) * 1.5, -Math.random(), .3, tileColor(wasm.get_tile_export(cursor.x, cursor.y)), 1.5, 8);
      }
    } else if (result === -2) {
      mining.active = false;
      mining.progress = 0;
      if (performance.now() - lastErrorToast > 1800) {
        lastErrorToast = performance.now();
        showToast('La roca madre no se puede romper.', 'warn', 1.6);
      }
    } else if (result === -3) {
      mining.active = false;
      mining.progress = 0;
      if (performance.now() - lastErrorToast > 1800) {
        lastErrorToast = performance.now();
        showToast('Inventario lleno. Suelta o usa algo primero.', 'warn', 1.8);
      }
    } else {
      mining.active = false;
      mining.progress = 0;
    }
  }

  function processEvents(ev) {
    if (!ev) return;
    views();
    if (ev & EV_JUMP) sfx('jump');
    if (ev & EV_LAND) {
      sfx('step');
      for (let i = 0; i < 2; i++) spawnParticle(stateView[0] + (Math.random() - .5) * .5, stateView[1] - .1, (Math.random() - .5) * 1.4, -Math.random(), .3, 'rgba(210,200,170,.75)', 1.5, 6);
    }
    if (ev & EV_HURT) {
      sfx('hurt'); shake = Math.max(shake, 6); flash = 1;
      for (let i = 0; i < 8; i++) spawnParticle(stateView[0], stateView[1] - 1, (Math.random() - .5) * 3, -Math.random() * 2, .35, '#ff6b70', 2, 14);
    }
    if (ev & EV_BREAK) sfx('break');
    if (ev & EV_PLACE) sfx('place');
    if (ev & EV_CRAFT) sfx('craft');
    if (ev & EV_ATTACK) { sfx('attack'); shake = Math.max(shake, 2); }
    if (ev & EV_MOB_DIE) { sfx('mob'); showToast('¡Slime derrotado! Conseguiste gel.', 'good', 1.7); }
    if (ev & EV_NEW_DAY) {
      sfx('day');
      showToast(`Amanece el día ${Math.max(1, stateView[10] | 0)}. Has sobrevivido a la noche.`, 'good', 3.5);
    }
    if ((ev & EV_DEAD) && !deathShown) showDeath();
  }

  // ------------------------------------------------------------------ Input
  const keys = new Set();
  function inputBits() {
    let b = 0;
    if (keys.has('a') || keys.has('arrowleft') || touch.left) b |= 1;
    if (keys.has('d') || keys.has('arrowright') || touch.right) b |= 2;
    if (keys.has(' ') || keys.has('w') || keys.has('arrowup') || touch.jump) b |= 4;
    if (keys.has('shift')) b |= 8;
    return b;
  }
  function syncInput() { if (wasm) wasm.set_input(mode === 'playing' ? inputBits() : 0); }

  function updatePointer(e) {
    const r = canvas.getBoundingClientRect();
    mouseX = e.clientX - r.left;
    mouseY = e.clientY - r.top;
    pointerInside = mouseX >= 0 && mouseX <= r.width && mouseY >= 0 && mouseY <= r.height;
    const t = tileAtScreen(mouseX, mouseY);
    cursor.x = t.x; cursor.y = t.y;
  }

  function chooseSlot(i) {
    if (!wasm) return;
    wasm.set_selected(i);
    updateHUD();
    sfx('click');
  }

  function onPointerDown(e) {
    if (mode !== 'playing') return;
    updatePointer(e);
    const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (isTouch) {
      if (touchMode === 'mine') {
        touchMining = true;
        mining.active = true;
      } else if (touchMode === 'place') {
        handlePlace(cursor.x, cursor.y);
      } else if (touchMode === 'attack') {
        handleAttack();
      }
      e.preventDefault();
      return;
    }
    if (e.button === 0) {
      const sel = invView ? invView[(stateView[12] | 0) * 2] : 0;
      if (sel === SWORD) handleAttack();
      else {
        mouseHeld = true;
        mining.active = true;
        mining.x = cursor.x; mining.y = cursor.y;
      }
    } else if (e.button === 2) {
      handlePlace(cursor.x, cursor.y);
    }
    e.preventDefault();
  }

  function onPointerUp() {
    mouseHeld = false;
    touchMining = false;
    mining.active = false;
    mining.progress = 0;
  }

  function onKeyDown(e) {
    const k = e.key.toLowerCase();
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    if (e.repeat) {
      if (mode === 'playing' && (k === 'a' || k === 'd' || k === ' ' || k === 'w' || k.startsWith('arrow'))) keys.add(k === 'shift' ? 'shift' : k);
      syncInput();
      return;
    }
    if (mode === 'title' && (k === 'enter' || k === ' ')) { startGame(); return; }
    if (mode === 'dead' && k === 'enter') { respawnGame(); return; }
    if (k === 'escape') {
      if (mode === 'playing') pauseGame();
      else if (mode === 'paused') resumeGame();
      else if (mode === 'crafting') closeCraft();
      else if (mode === 'help') closeHelp();
      return;
    }
    if (k === 'h') {
      if (mode === 'playing') openHelp('playing');
      else if (mode === 'paused') openHelp('paused');
      else if (mode === 'title') openHelp('title');
      else if (mode === 'help') closeHelp();
      return;
    }
    if (mode === 'playing') {
      if (k >= '1' && k <= '9') { chooseSlot(Number(k) - 1); return; }
      if (k === 'c' || k === 'e') { openCraft(); return; }
      if (k === 'f') { handleAttack(); return; }
      if (k === 'r') {
        const r = wasm.use_selected();
        views();
        if (r === 1) { sfx('craft'); showToast('Venda usada: +3 corazones.', 'good', 1.6); updateHUD(); }
        else if (r === -1) showToast('Ya tienes la vida al máximo.', '', 1.4);
        else if (r === 0) showToast('Ese objeto no se puede usar así.', '', 1.4);
        return;
      }
      if (k === 'm') { toggleSound(); return; }
    }
    if (['a', 'd', 'w', ' ', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      keys.add(k);
      syncInput();
    }
  }

  function onKeyUp(e) {
    const k = e.key.toLowerCase();
    keys.delete(k);
    syncInput();
  }

  function toggleSound() {
    soundOn = !soundOn;
    const b = $('sound-btn');
    b.textContent = soundOn ? '♪' : '×';
    b.classList.toggle('muted', !soundOn);
    b.setAttribute('aria-label', soundOn ? 'Silenciar sonido' : 'Activar sonido');
    try { localStorage.setItem('minicraft-sound', soundOn ? '1' : '0'); } catch (err) { /* ignore */ }
    if (soundOn) { ensureAudio(); sfx('click'); }
  }

  function bindInput() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { keys.clear(); clearInputs(); });
    canvas.addEventListener('pointermove', (e) => { if (mode === 'playing') updatePointer(e); });
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', () => { pointerInside = false; onPointerUp(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      if (mode !== 'playing') return;
      e.preventDefault();
      const cur = wasm.get_selected();
      chooseSlot((cur + (e.deltaY > 0 ? 1 : 8)) % 9);
    }, { passive: false });

    $('hotbar').addEventListener('click', (e) => {
      const slot = e.target.closest('[data-slot]');
      if (slot) chooseSlot(Number(slot.dataset.slot));
    });
    $('recipe-grid').addEventListener('click', (e) => {
      const card = e.target.closest('[data-recipe]');
      if (card) handleCraft(Number(card.dataset.recipe));
    });

    $('play-btn').addEventListener('click', startGame);
    $('how-btn').addEventListener('click', () => openHelp('title'));
    $('help-close').addEventListener('click', closeHelp);
    $('help-ok').addEventListener('click', closeHelp);
    $('help-btn').addEventListener('click', () => openHelp(mode === 'paused' ? 'paused' : 'playing'));
    $('sound-btn').addEventListener('click', toggleSound);
    $('craft-btn').addEventListener('click', openCraft);
    $('craft-close').addEventListener('click', closeCraft);
    $('resume-btn').addEventListener('click', resumeGame);
    $('pause-help-btn').addEventListener('click', () => openHelp('paused'));
    $('restart-btn').addEventListener('click', () => newWorld(true));
    $('respawn-btn').addEventListener('click', respawnGame);
    $('death-restart-btn').addEventListener('click', () => newWorld(true));

    document.querySelectorAll('[data-move]').forEach(btn => {
      const dir = btn.dataset.move;
      const down = (e) => {
        e.preventDefault();
        if (dir === 'jump') touch.jump = true;
        else if (dir === 'left') touch.left = true;
        else if (dir === 'right') touch.right = true;
        btn.classList.add('held');
        syncInput();
      };
      const up = (e) => {
        e.preventDefault();
        if (dir === 'jump') touch.jump = false;
        else if (dir === 'left') touch.left = false;
        else if (dir === 'right') touch.right = false;
        btn.classList.remove('held');
        syncInput();
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    });
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        touchMode = btn.dataset.mode;
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));
        sfx('click');
      });
    });
  }

  // ------------------------------------------------------------------ Loop
  let lastHudUpdate = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    visualClock += dt;
    if (!wasm || !stateView) return;

    views();
    if (mode === 'playing' && !deathShown) {
      syncInput();
      wasm.update(dt);
      views();
      const ev = wasm.take_events();
      processEvents(ev);
      if (stateView[4] <= 0 && !deathShown) showDeath();
      updateParticles(dt);
      mineTick(dt);
    } else {
      wasm.set_input(0);
      updateParticles(dt);
    }

    render();

    if (now - lastHudUpdate > 100) {
      lastHudUpdate = now;
      updateHUD();
      if (mode === 'crafting') refreshRecipes();
    }
    updateToast(dt);
  }

  // ------------------------------------------------------------------ Boot
  async function boot() {
    resize();
    bindInput();
    buildHUD();
    try { soundOn = localStorage.getItem('minicraft-sound') !== '0'; } catch (err) { /* ignore */ }
    $('sound-btn').textContent = soundOn ? '♪' : '×';
    $('sound-btn').classList.toggle('muted', !soundOn);
    try {
      $('loading-fill').style.width = '18%';
      const res = await fetch('minicraft.wasm');
      if (!res.ok) throw new Error(`HTTP ${res.status} al cargar el motor`);
      $('loading-fill').style.width = '52%';
      $('loading-text').textContent = 'Compilando el terreno…';
      const bytes = await res.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      wasm = instance.exports;
      memory = wasm.memory;
      views();
      $('loading-fill').style.width = '84%';
      $('loading-text').textContent = 'Plantando árboles y encendiendo antorchas…';
      const seed = new Uint32Array(1);
      crypto.getRandomValues(seed);
      worldSeed = seed[0];
      wasm.init(worldSeed);
      views();
      buildHUD();
      window.__mc = {
        state: () => Array.from(stateView),
        inv: () => Array.from(invView),
        info: () => ({ mode, mouseHeld, touchMining, pointerInside, cursor: { ...cursor }, mining: { ...mining }, cam: { ...cam }, ts: TS, w: W, h: H }),
        mineAt: (x, y, dt = 0.05) => wasm.mine_at(x, y, dt),
        placeAt: (x, y) => wasm.place_at(x, y),
        attack: (d) => wasm.attack(d),
        craft: (id) => wasm.craft(id),
        select: (i) => wasm.set_selected(i),
        getTile: (x, y) => wasm.get_tile_export(x, y),
        setMode,
        startGame
      };
      $('loading-fill').style.width = '100%';
      setTimeout(() => {
        $('loading').classList.add('hidden');
        booted = true;
        setMode('title');
      }, 180);
      requestAnimationFrame(frame);
    } catch (err) {
      console.error(err);
      $('loading-text').textContent = 'No se pudo cargar el motor WebAssembly. ' + err.message;
      $('loading-fill').style.width = '100%';
      $('loading-fill').style.background = '#ff6b6b';
    }
  }

  window.addEventListener('resize', resize);
  boot();
})();
