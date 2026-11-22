#![allow(static_mut_refs)]
//! Minicraft — a tiny, scalable side-scrolling survival sandbox.
//!
//! The whole simulation lives in Rust and is compiled to a dependency-free
//! WebAssembly module. The JavaScript layer only renders snapshots and feeds
//! input back in, which keeps the game loop fast and the world easy to extend.

use std::collections::BTreeMap;

const WORLD_H: i32 = 128;
const BEDROCK: i32 = 116;
const DAY_LENGTH: f32 = 260.0;
const MAX_MOBS: usize = 14;
const VIEW_W: usize = 96;
const VIEW_H: usize = 64;

// Tiles (placeable ids double as item ids).
const AIR: u8 = 0;
const GRASS: u8 = 1;
const DIRT: u8 = 2;
const STONE: u8 = 3;
const WOOD: u8 = 4;
const LEAVES: u8 = 5;
const PLANK: u8 = 6;
const TORCH: u8 = 7;
const COAL: u8 = 8;
const IRON: u8 = 9;
const GOLD: u8 = 10;
const BEDROCK_TILE: u8 = 11;
const SAND: u8 = 12;
const FLOWER: u8 = 13;
const TABLE: u8 = 14;
const BRICK: u8 = 15;

// Items that are not tiles.
const STICK: u16 = 20;
const PICKAXE: u16 = 21;
const AXE: u16 = 22;
const SWORD: u16 = 23;
const GEL: u16 = 24;
const BANDAGE: u16 = 25;

const FLAG_WOOD: u32 = 1 << 0;
const FLAG_TABLE: u32 = 1 << 1;
const FLAG_PICK: u32 = 1 << 2;
const FLAG_COAL: u32 = 1 << 3;
const FLAG_TORCH: u32 = 1 << 4;
const FLAG_NIGHT: u32 = 1 << 5;
const FLAG_SWORD: u32 = 1 << 6;
const FLAG_IRON: u32 = 1 << 7;
const FLAG_DEEP: u32 = 1 << 8;
const FLAG_SLIME: u32 = 1 << 9;

const EV_JUMP: u32 = 1 << 0;
const EV_LAND: u32 = 1 << 1;
const EV_HURT: u32 = 1 << 2;
const EV_BREAK: u32 = 1 << 3;
const EV_PLACE: u32 = 1 << 4;
const EV_CRAFT: u32 = 1 << 5;
const EV_ATTACK: u32 = 1 << 6;
const EV_MOB_DIE: u32 = 1 << 7;
const EV_NEW_DAY: u32 = 1 << 8;
const EV_DEAD: u32 = 1 << 9;

const INPUT_LEFT: u32 = 1;
const INPUT_RIGHT: u32 = 2;
const INPUT_JUMP: u32 = 4;
const INPUT_SPRINT: u32 = 8;

const PLAYER_HALF_W: f32 = 0.36;
const PLAYER_H: f32 = 1.72;

#[derive(Clone, Copy)]
struct Player {
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
    facing: f32,
    health: f32,
    invuln: f32,
    attack_cd: f32,
    coyote: f32,
    jump_buffer: f32,
    regen: f32,
    on_ground: bool,
}

impl Player {
    const fn new() -> Self {
        Self {
            x: 0.5,
            y: 44.0,
            vx: 0.0,
            vy: 0.0,
            facing: 1.0,
            health: 10.0,
            invuln: 0.0,
            attack_cd: 0.0,
            coyote: 0.0,
            jump_buffer: 0.0,
            regen: 0.0,
            on_ground: false,
        }
    }
}

#[derive(Clone, Copy)]
struct Mob {
    active: bool,
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
    hp: f32,
    max_hp: f32,
    flash: f32,
    attack_cd: f32,
    hop_cd: f32,
    kind: f32,
    on_ground: bool,
}

impl Mob {
    const EMPTY: Self = Self {
        active: false,
        x: 0.0,
        y: 0.0,
        vx: 0.0,
        vy: 0.0,
        hp: 0.0,
        max_hp: 0.0,
        flash: 0.0,
        attack_cd: 0.0,
        hop_cd: 0.0,
        kind: 0.0,
        on_ground: false,
    };
}

static mut SEED: u32 = 0x1234_5678;
static mut EDITS: BTreeMap<(i32, i32), u8> = BTreeMap::new();
static mut PLAYER: Player = Player::new();
static mut INPUT: u32 = 0;
static mut PREV_INPUT: u32 = 0;
static mut EVENTS: u32 = 0;
static mut TIME: f32 = 0.30;
static mut DAY: u32 = 1;
static mut FLAGS: u32 = 0;
static mut SELECTED: usize = 0;
static mut INV_ID: [u16; 9] = [0; 9];
static mut INV_CNT: [u16; 9] = [0; 9];
static mut MOBS: [Mob; MAX_MOBS] = [Mob::EMPTY; MAX_MOBS];
static mut MOB_TIMER: f32 = 4.0;
static mut RNG: u32 = 0x9e37_79b9;
static mut SPAWN_X: f32 = 0.5;
static mut TORCHES_PLACED: u32 = 0;
static mut MINE_X: i32 = i32::MIN;
static mut MINE_Y: i32 = i32::MIN;
static mut MINE_PROGRESS: f32 = 0.0;
static mut FOOTSTEP: f32 = 0.0;
static mut VIEW: [u32; VIEW_W * VIEW_H] = [0; VIEW_W * VIEW_H];
static mut PACK: [f32; 16] = [0.0; 16];
static mut MOB_PACK: [f32; MAX_MOBS * 8] = [0.0; MAX_MOBS * 8];
static mut INV_PACK: [u32; 18] = [0; 18];

// ---------------------------------------------------------------------------
// Deterministic procedural world
// ---------------------------------------------------------------------------

#[inline]
fn hash2(x: i32, y: i32) -> u32 {
    let seed = unsafe { SEED };
    let mut h = (x as u32)
        .wrapping_mul(0x27d4_eb2d)
        .wrapping_add((y as u32).wrapping_mul(0x1656_67b1))
        .wrapping_add(seed.wrapping_mul(0x9e37_79b9));
    h ^= h >> 15;
    h = h.wrapping_mul(0x85eb_ca6b);
    h ^= h >> 13;
    h = h.wrapping_mul(0xc2b2_ae35);
    h ^= h >> 16;
    h
}

#[inline]
fn rand01(x: i32, y: i32) -> f32 {
    (hash2(x, y) & 0x00ff_ffff) as f32 / 16_777_215.0
}

#[inline]
fn smooth(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

fn noise1(x: f32) -> f32 {
    let x0 = x.floor() as i32;
    let f = smooth(x - x0 as f32);
    let a = rand01(x0, 1337);
    let b = rand01(x0 + 1, 1337);
    a + (b - a) * f
}

fn noise2(x: f32, y: f32) -> f32 {
    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    let fx = smooth(x - x0 as f32);
    let fy = smooth(y - y0 as f32);
    let a = rand01(x0, y0);
    let b = rand01(x0 + 1, y0);
    let c = rand01(x0, y0 + 1);
    let d = rand01(x0 + 1, y0 + 1);
    let ab = a + (b - a) * fx;
    let cd = c + (d - c) * fx;
    ab + (cd - ab) * fy
}

fn is_desert(x: i32) -> bool {
    let n = noise1(x as f32 * 0.0085 + 71.3);
    n > 0.67
}

fn surface_at(x: i32) -> i32 {
    let xf = x as f32;
    let phase = (unsafe { SEED } & 255) as f32 * 0.01;
    let broad = (xf * 0.017 + phase).sin() * 5.6;
    let mid = (xf * 0.051 + 1.7).sin() * 2.4;
    let fine = (xf * 0.13 + 0.4).sin() * 0.85;
    let n = (noise1(xf * 0.075 + 100.0) - 0.5) * 5.0;
    (46.0 + broad + mid + fine + n).round().clamp(30.0, 60.0) as i32
}

fn tree_tile(ox: i32, x: i32, y: i32) -> u8 {
    if is_desert(ox) {
        return AIR;
    }
    // Sparse, deterministic tree origins. Checking a small neighbourhood keeps
    // tile generation independent from chunk generation order.
    if rand01(ox, 991) > 0.135 {
        return AIR;
    }
    let h = surface_at(ox);
    let trunk_h = 3 + (hash2(ox, 42) % 3) as i32;
    let top = h - trunk_h;
    if x == ox && y >= top && y < h {
        return WOOD;
    }
    let dx = (x - ox).abs();
    let dy = y - top;
    if dx <= 2 && dy >= -2 && dy <= 1 {
        if dy == -2 && dx > 1 {
            return AIR;
        }
        if dy == 1 && dx == 2 {
            return AIR;
        }
        if dx == 2 && dy == -1 && (hash2(x, y) & 1) == 0 {
            return AIR;
        }
        return LEAVES;
    }
    AIR
}

fn cave_at(x: i32, y: i32, h: i32) -> bool {
    let depth = y - h;
    if depth < 5 {
        return false;
    }
    let n1 = noise2(x as f32 * 0.105, y as f32 * 0.155);
    let n2 = noise2(x as f32 * 0.31 + 19.0, y as f32 * 0.37 + 7.0);
    let n3 = noise2(x as f32 * 0.047 + 80.0, y as f32 * 0.065 + 30.0);
    let threshold = 0.665 - (depth as f32 * 0.0012).min(0.085);
    n1 * 0.52 + n2 * 0.23 + n3 * 0.25 > threshold
}

fn base_tile(x: i32, y: i32) -> u8 {
    if y < 0 || y >= WORLD_H {
        return AIR;
    }
    let h = surface_at(x);
    if y < h {
        for ox in (x - 2)..=(x + 2) {
            let t = tree_tile(ox, x, y);
            if t != AIR {
                return t;
            }
        }
        if y == h - 1 && rand01(x, 771) < 0.075 {
            return FLOWER;
        }
        return AIR;
    }
    if y == h {
        return if is_desert(x) { SAND } else { GRASS };
    }
    if y >= BEDROCK || (y >= BEDROCK - 4 && rand01(x, y) < 0.45) {
        return BEDROCK_TILE;
    }
    if cave_at(x, y, h) {
        return AIR;
    }
    let depth = y - h;
    if depth <= 3 {
        return if is_desert(x) { SAND } else { DIRT };
    }
    // Small ore pockets scattered through the stone.
    let ore_roll = rand01(x.wrapping_mul(3) + 17, y.wrapping_mul(5) + 41);
    if depth > 8 && ore_roll < 0.022 {
        return COAL;
    }
    if depth > 17 && ore_roll > 0.978 {
        return IRON;
    }
    if depth > 33 && ore_roll > 0.994 {
        return GOLD;
    }
    STONE
}

fn wall_at(x: i32, y: i32) -> u8 {
    let h = surface_at(x);
    if y <= h {
        0
    } else if y <= h + 4 {
        1
    } else {
        2
    }
}

fn get_tile(x: i32, y: i32) -> u8 {
    if let Some(&t) = unsafe { EDITS.get(&(x, y)) } {
        return t;
    }
    base_tile(x, y)
}

fn set_tile(x: i32, y: i32, tile: u8) {
    let base = base_tile(x, y);
    unsafe {
        if tile == base {
            EDITS.remove(&(x, y));
        } else {
            EDITS.insert((x, y), tile);
        }
    }
}

// ---------------------------------------------------------------------------
// Tile helpers
// ---------------------------------------------------------------------------

fn is_solid(t: u8) -> bool {
    matches!(
        t,
        GRASS | DIRT | STONE | WOOD | PLANK | COAL | IRON | GOLD | BEDROCK_TILE | SAND | TABLE | BRICK
    )
}

fn is_replaceable(t: u8) -> bool {
    matches!(t, AIR | LEAVES | FLOWER | TORCH)
}

fn is_wood(t: u8) -> bool {
    matches!(t, WOOD | PLANK | LEAVES | TABLE)
}

fn hardness(t: u8) -> f32 {
    match t {
        FLOWER | TORCH => 0.08,
        LEAVES => 0.30,
        SAND => 0.45,
        GRASS | DIRT => 0.55,
        PLANK => 0.68,
        WOOD => 0.85,
        TABLE => 0.90,
        STONE => 1.35,
        COAL => 1.55,
        IRON => 1.95,
        GOLD => 2.35,
        BRICK => 1.60,
        BEDROCK_TILE => 999.0,
        _ => 1.0,
    }
}

fn drop_of(t: u8) -> u16 {
    match t {
        GRASS => DIRT as u16,
        AIR | BEDROCK_TILE => 0,
        _ => t as u16,
    }
}

fn item_to_tile(id: u16) -> u8 {
    match id {
        1..=15 => id as u8,
        _ => AIR,
    }
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

fn max_stack(id: u16) -> u16 {
    match id {
        PICKAXE | AXE | SWORD => 1,
        BANDAGE => 16,
        _ => 99,
    }
}

fn count_item(id: u16) -> u32 {
    let mut n = 0;
    unsafe {
        for i in 0..9 {
            if INV_ID[i] == id {
                n += INV_CNT[i] as u32;
            }
        }
    }
    n
}

fn can_add_item(id: u16, count: u16) -> bool {
    if id == 0 || count == 0 {
        return true;
    }
    let mut left = count;
    unsafe {
        for i in 0..9 {
            if INV_ID[i] == id && INV_CNT[i] < max_stack(id) {
                left = left.saturating_sub(max_stack(id) - INV_CNT[i]);
            }
        }
        for i in 0..9 {
            if INV_ID[i] == 0 {
                left = left.saturating_sub(max_stack(id));
            }
        }
    }
    left == 0
}

fn add_item(id: u16, count: u16) -> bool {
    if id == 0 || count == 0 {
        return true;
    }
    if !can_add_item(id, count) {
        return false;
    }
    let mut left = count;
    unsafe {
        for i in 0..9 {
            if INV_ID[i] == id && INV_CNT[i] < max_stack(id) {
                let space = max_stack(id) - INV_CNT[i];
                let put = left.min(space);
                INV_CNT[i] += put;
                left -= put;
                if left == 0 {
                    break;
                }
            }
        }
        for i in 0..9 {
            if left == 0 {
                break;
            }
            if INV_ID[i] == 0 {
                let put = left.min(max_stack(id));
                INV_ID[i] = id;
                INV_CNT[i] = put;
                left -= put;
            }
        }
    }
    if left == 0 {
        if id == WOOD as u16 {
            unsafe { FLAGS |= FLAG_WOOD };
        } else if id == COAL as u16 {
            unsafe { FLAGS |= FLAG_COAL };
        } else if id == IRON as u16 {
            unsafe { FLAGS |= FLAG_IRON };
        }
        true
    } else {
        false
    }
}

fn remove_item(id: u16, count: u16) -> bool {
    if count_item(id) < count as u32 {
        return false;
    }
    let mut left = count;
    unsafe {
        for i in 0..9 {
            if INV_ID[i] == id {
                let take = left.min(INV_CNT[i]);
                INV_CNT[i] -= take;
                left -= take;
                if INV_CNT[i] == 0 {
                    INV_ID[i] = 0;
                }
                if left == 0 {
                    break;
                }
            }
        }
    }
    true
}

fn selected_item() -> (u16, u16) {
    unsafe { (INV_ID[SELECTED], INV_CNT[SELECTED]) }
}

// ---------------------------------------------------------------------------
// Collision & movement
// ---------------------------------------------------------------------------

fn box_hits(x: f32, y: f32, half_w: f32, height: f32) -> bool {
    let left = (x - half_w).floor() as i32;
    let right = (x + half_w - 0.001).floor() as i32;
    let top = (y - height).floor() as i32;
    let bottom = (y - 0.001).floor() as i32;
    for ty in top..=bottom {
        for tx in left..=right {
            if is_solid(get_tile(tx, ty)) {
                return true;
            }
        }
    }
    false
}

fn player_hits(x: f32, y: f32) -> bool {
    box_hits(x, y, PLAYER_HALF_W, PLAYER_H)
}

fn move_player_x(p: &mut Player, dx: f32) {
    if dx == 0.0 {
        return;
    }
    let steps = (dx.abs() / 0.22).ceil().max(1.0) as i32;
    let step = dx / steps as f32;
    for _ in 0..steps {
        let nx = p.x + step;
        if !player_hits(nx, p.y) {
            p.x = nx;
        } else {
            if step > 0.0 {
                p.x = (nx + PLAYER_HALF_W).floor() - PLAYER_HALF_W - 0.002;
            } else {
                p.x = (nx - PLAYER_HALF_W).floor() + 1.0 + PLAYER_HALF_W + 0.002;
            }
            p.vx = 0.0;
            break;
        }
    }
}

fn move_player_y(p: &mut Player, dy: f32, impact: f32) {
    if dy == 0.0 {
        return;
    }
    let steps = (dy.abs() / 0.22).ceil().max(1.0) as i32;
    let step = dy / steps as f32;
    for _ in 0..steps {
        let ny = p.y + step;
        if !player_hits(p.x, ny) {
            p.y = ny;
        } else {
            if step > 0.0 {
                p.y = ny.floor() - 0.002;
                p.on_ground = true;
                if impact > 20.0 {
                    let dmg = (((impact - 20.0) / 6.0).floor() + 1.0).min(5.0);
                    p.health = (p.health - dmg).max(0.0);
                    p.invuln = 0.85;
                    p.regen = 0.0;
                    unsafe {
                        EVENTS |= EV_HURT;
                        if p.health <= 0.0 {
                            EVENTS |= EV_DEAD;
                        }
                    }
                } else if impact > 8.0 {
                    unsafe { EVENTS |= EV_LAND };
                }
            } else {
                p.y = (ny - PLAYER_H).floor() + 1.0 + PLAYER_H + 0.002;
            }
            p.vy = 0.0;
            break;
        }
    }
}

fn damage_player(amount: f32, dir: f32) {
    let mut p = unsafe { PLAYER };
    if p.invuln > 0.0 || p.health <= 0.0 {
        return;
    }
    p.health = (p.health - amount).max(0.0);
    p.invuln = 0.85;
    p.regen = 0.0;
    p.vx = dir * 5.5;
    p.vy = -5.0;
    unsafe {
        PLAYER = p;
        EVENTS |= EV_HURT;
        if p.health <= 0.0 {
            EVENTS |= EV_DEAD;
        }
    }
}

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

fn is_night() -> bool {
    let t = unsafe { TIME };
    t > 0.78 || t < 0.22
}

fn mob_hits(x: f32, y: f32) -> bool {
    box_hits(x, y, 0.42, 0.78)
}

fn spawn_slime() {
    let mut rng = unsafe { RNG };
    rng ^= rng << 13;
    rng ^= rng >> 17;
    rng ^= rng << 5;
    unsafe { RNG = rng };
    let p = unsafe { PLAYER };
    let sign = if rng & 1 == 0 { -1.0 } else { 1.0 };
    let distance = 10.0 + (rng % 9) as f32;
    let x = (p.x + sign * distance).round() as i32;
    let h = surface_at(x);
    if is_solid(get_tile(x, h)) && get_tile(x, h - 1) == AIR && get_tile(x, h - 2) == AIR {
        for i in 0..MAX_MOBS {
            let m = unsafe { MOBS[i] };
            if !m.active {
                let mut mob = Mob::EMPTY;
                mob.active = true;
                mob.x = x as f32 + 0.5;
                mob.y = h as f32;
                mob.hp = 5.0;
                mob.max_hp = 5.0;
                mob.kind = 1.0;
                mob.hop_cd = 0.25 + (rng % 40) as f32 * 0.01;
                unsafe { MOBS[i] = mob };
                break;
            }
        }
    }
}

fn update_mobs(dt: f32) {
    let p = unsafe { PLAYER };
    let night = is_night();
    unsafe {
        if night {
            MOB_TIMER -= dt;
            if MOB_TIMER <= 0.0 {
                MOB_TIMER = 4.5 + (RNG % 30) as f32 * 0.1;
                let active = MOBS.iter().filter(|m| m.active).count();
                if active < 5 {
                    spawn_slime();
                }
            }
        } else {
            MOB_TIMER = 4.0;
        }
    }

    for i in 0..MAX_MOBS {
        let mut m = unsafe { MOBS[i] };
        if !m.active {
            continue;
        }
        if m.flash > 0.0 {
            m.flash -= dt;
        }
        if m.attack_cd > 0.0 {
            m.attack_cd -= dt;
        }
        if m.hop_cd > 0.0 {
            m.hop_cd -= dt;
        }
        let dx = p.x - m.x;
        let dy = (p.y - 0.9) - (m.y - 0.4);
        let dist = (dx * dx + dy * dy).sqrt();

        // Daylight burns surface slimes away.
        if !night && get_tile(m.x.floor() as i32, (m.y - 2.0).floor() as i32) == AIR {
            m.hp -= dt * 3.2;
            m.flash = 0.08;
            if m.hp <= 0.0 {
                m.active = false;
                unsafe { MOBS[i] = m };
                continue;
            }
        }

        if dist > 34.0 || m.y > 112.0 || m.y < -8.0 {
            m.active = false;
            unsafe { MOBS[i] = m };
            continue;
        }

        // Slimes hop toward the player, then slide a little.
        if m.on_ground && m.hop_cd <= 0.0 && dist < 22.0 {
            let dir = if dx.abs() > 0.15 { dx.signum() } else { 0.0 };
            m.vx = dir * 2.35;
            m.vy = -6.0;
            m.on_ground = false;
            m.hop_cd = 0.72 + (hash2(i as i32, (unsafe { TIME } * 100.0) as i32) % 35) as f32 * 0.01;
        }
        m.vy = (m.vy + 32.0 * dt).min(28.0);
        m.vx *= 1.0 - (1.6 * dt).min(0.4);

        // X movement.
        let nx = m.x + m.vx * dt;
        if !mob_hits(nx, m.y) {
            m.x = nx;
        } else {
            m.vx = -m.vx * 0.25;
        }
        // Y movement.
        m.on_ground = false;
        let ny = m.y + m.vy * dt;
        if !mob_hits(m.x, ny) {
            m.y = ny;
        } else {
            if m.vy > 0.0 {
                m.y = ny.floor() - 0.002;
                m.on_ground = true;
            } else {
                m.y = (ny - 0.78).floor() + 1.0 + 0.78 + 0.002;
            }
            m.vy = 0.0;
        }

        // Touch damage.
        if m.attack_cd <= 0.0 && (m.x - p.x).abs() < 0.82 && (m.y - p.y).abs() < 1.15 {
            let dir = if p.x < m.x { -1.0 } else { 1.0 };
            damage_player(1.0, dir);
            m.attack_cd = 1.15;
        }
        unsafe { MOBS[i] = m };
    }
}

// ---------------------------------------------------------------------------
// Public game actions
// ---------------------------------------------------------------------------

fn recipe(id: u32) -> Option<(u16, u16, u16, u16, u16, u16, bool)> {
    // out, out_count, req1, count1, req2, count2, needs_table
    Some(match id {
        0 => (PLANK as u16, 4, WOOD as u16, 1, 0, 0, false),
        1 => (STICK, 4, PLANK as u16, 1, 0, 0, false),
        2 => (TABLE as u16, 1, PLANK as u16, 4, 0, 0, false),
        3 => (PICKAXE, 1, PLANK as u16, 3, STICK, 2, true),
        4 => (SWORD, 1, PLANK as u16, 2, STICK, 1, true),
        5 => (AXE, 1, PLANK as u16, 3, STICK, 2, true),
        6 => (TORCH as u16, 4, STICK, 1, COAL as u16, 1, false),
        7 => (BANDAGE, 1, GEL, 2, LEAVES as u16, 2, false),
        8 => (BRICK as u16, 4, STONE as u16, 4, 0, 0, false),
        _ => return None,
    })
}

fn table_nearby() -> bool {
    let p = unsafe { PLAYER };
    let px = p.x.floor() as i32;
    let py = (p.y - 0.9).floor() as i32;
    for y in (py - 4)..=(py + 4) {
        for x in (px - 5)..=(px + 5) {
            if get_tile(x, y) == TABLE {
                return true;
            }
        }
    }
    false
}

fn craft_status(id: u32) -> i32 {
    let Some((_out, _n, r1, c1, r2, c2, needs_table)) = recipe(id) else {
        return 5;
    };
    if needs_table && !table_nearby() {
        return 2;
    }
    if count_item(r1) < c1 as u32 || (r2 != 0 && count_item(r2) < c2 as u32) {
        return 3;
    }
    let (out, out_count, _, _, _, _, _) = recipe(id).unwrap();
    if !can_add_item(out, out_count) {
        return 4;
    }
    1
}

fn mining_speed(t: u8) -> f32 {
    let pick = count_item(PICKAXE) > 0;
    let axe = count_item(AXE) > 0;
    if t == TORCH || t == FLOWER {
        3.4
    } else if matches!(t, STONE | COAL | IRON | GOLD | BRICK) {
        if pick { 2.35 } else { 0.85 }
    } else if is_wood(t) {
        if axe { 2.65 } else { 1.05 }
    } else if t == LEAVES {
        if axe { 3.4 } else { 1.8 }
    } else {
        1.35
    }
}

#[no_mangle]
pub extern "C" fn init(seed: u32) {
    unsafe {
        SEED = seed;
        EDITS.clear();
        PLAYER = Player::new();
        INPUT = 0;
        PREV_INPUT = 0;
        EVENTS = 0;
        TIME = 0.30;
        DAY = 1;
        FLAGS = 0;
        SELECTED = 0;
        INV_ID = [0; 9];
        INV_CNT = [0; 9];
        MOBS = [Mob::EMPTY; MAX_MOBS];
        MOB_TIMER = 5.0;
        RNG = seed ^ 0xa53c_91e7;
        TORCHES_PLACED = 0;
        MINE_X = i32::MIN;
        MINE_Y = i32::MIN;
        MINE_PROGRESS = 0.0;
        FOOTSTEP = 0.0;

        // Find a pleasant, unobstructed spawn on grass with a tree within
        // arm's reach, so the first minute of play is never a dead end.
        let mut sx = 0;
        let mut found = false;
        'search: for radius in 0..320 {
            for sign in [1, -1] {
                let x = radius * sign;
                let h = surface_at(x);
                if base_tile(x, h) != GRASS
                    || base_tile(x, h - 1) != AIR
                    || base_tile(x, h - 2) != AIR
                    || base_tile(x, h - 3) != AIR
                {
                    continue;
                }
                let mut tree_near = false;
                for ox in (x - 5)..=(x + 5) {
                    if ox != x && tree_tile(ox, ox, surface_at(ox) - 1) == WOOD {
                        tree_near = true;
                        break;
                    }
                }
                if tree_near {
                    sx = x;
                    found = true;
                    break 'search;
                }
            }
        }
        if !found {
            for x in 0..80 {
                let h = surface_at(x);
                if base_tile(x, h) == GRASS && base_tile(x, h - 1) == AIR {
                    sx = x;
                    break;
                }
            }
        }
        let h = surface_at(sx);
        PLAYER.x = sx as f32 + 0.5;
        PLAYER.y = h as f32;
        PLAYER.health = 10.0;
        SPAWN_X = PLAYER.x;
        // A small starter kit: enough light to survive the first cave.
        INV_ID[0] = TORCH as u16;
        INV_CNT[0] = 2;
        update_pack();
    }
}

#[no_mangle]
pub extern "C" fn update(dt: f32) {
    let dt = dt.clamp(0.0, 0.05);
    if dt <= 0.0 {
        update_pack();
        return;
    }
    let mut p = unsafe { PLAYER };
    if p.health > 0.0 {
        let input = unsafe { INPUT };
        let jump_held = input & INPUT_JUMP != 0;
        let jump_pressed = jump_held && (unsafe { PREV_INPUT } & INPUT_JUMP == 0);
        if jump_pressed {
            p.jump_buffer = 0.14;
        }
        p.jump_buffer -= dt;
        if p.on_ground {
            p.coyote = 0.10;
        } else {
            p.coyote -= dt;
        }

        let dir = if input & INPUT_LEFT != 0 { -1.0 } else { 0.0 }
            + if input & INPUT_RIGHT != 0 { 1.0 } else { 0.0 };
        let sprint = input & INPUT_SPRINT != 0;
        let max_speed = if sprint { 6.5 } else { 4.7 };
        let accel = if p.on_ground { 46.0 } else { 20.0 };
        if dir != 0.0 {
            p.vx += dir * accel * dt;
            p.facing = dir;
            p.vx = p.vx.clamp(-max_speed, max_speed);
        } else if p.on_ground {
            let drag = (1.0 - 13.0 * dt).max(0.0);
            p.vx *= drag;
        } else {
            p.vx *= 1.0 - 0.9 * dt;
        }

        if p.jump_buffer > 0.0 && p.coyote > 0.0 {
            p.vy = -12.4;
            p.on_ground = false;
            p.coyote = 0.0;
            p.jump_buffer = 0.0;
            unsafe { EVENTS |= EV_JUMP };
        }
        if !jump_held && p.vy < -4.0 {
            p.vy += 25.0 * dt;
        }
        p.vy = (p.vy + 36.0 * dt).min(30.0);

        let impact = p.vy;
        let dx = p.vx * dt;
        let dy = p.vy * dt;
        p.on_ground = false;
        move_player_x(&mut p, dx);
        move_player_y(&mut p, dy, impact);

        if p.on_ground && p.vx.abs() > 0.4 {
            unsafe { FOOTSTEP -= dt };
            if unsafe { FOOTSTEP } <= 0.0 {
                unsafe { FOOTSTEP = if sprint { 0.19 } else { 0.30 } };
                unsafe { EVENTS |= EV_LAND };
            }
        }

        if p.invuln > 0.0 {
            p.invuln -= dt;
        }
        if p.attack_cd > 0.0 {
            p.attack_cd -= dt;
        }
        // Slow daytime regeneration.
        let t = unsafe { TIME };
        if p.health < 10.0 && p.invuln <= 0.0 && t > 0.22 && t < 0.78 {
            p.regen += dt;
            if p.regen > 7.0 {
                p.health = (p.health + 0.5).min(10.0);
                p.regen = 0.0;
            }
        } else {
            p.regen = 0.0;
        }

        unsafe { PLAYER = p };
    }

    unsafe {
        PREV_INPUT = INPUT;
        TIME += dt / DAY_LENGTH;
        if TIME >= 1.0 {
            TIME -= 1.0;
            DAY += 1;
            EVENTS |= EV_NEW_DAY;
            if PLAYER.health > 0.0 {
                FLAGS |= FLAG_NIGHT;
            }
        }
        let p = PLAYER;
        let depth = (p.y as i32) - surface_at(p.x as i32);
        if depth > 24 {
            FLAGS |= FLAG_DEEP;
        }
        update_mobs(dt);
        update_pack();
    }
}

fn update_pack() {
    let p = unsafe { PLAYER };
    unsafe {
        PACK[0] = p.x;
        PACK[1] = p.y;
        PACK[2] = p.vx;
        PACK[3] = p.vy;
        PACK[4] = p.health;
        PACK[5] = 10.0;
        PACK[6] = if p.on_ground { 1.0 } else { 0.0 };
        PACK[7] = p.facing;
        PACK[8] = p.invuln;
        PACK[9] = TIME;
        PACK[10] = DAY as f32;
        PACK[11] = FLAGS as f32;
        PACK[12] = SELECTED as f32;
        PACK[13] = (p.y as i32 - surface_at(p.x as i32)) as f32;
        PACK[14] = p.attack_cd;
        PACK[15] = if is_night() { 1.0 } else { 0.0 };

        for i in 0..9 {
            INV_PACK[i * 2] = INV_ID[i] as u32;
            INV_PACK[i * 2 + 1] = INV_CNT[i] as u32;
        }
        for i in 0..MAX_MOBS {
            let m = MOBS[i];
            let o = i * 8;
            MOB_PACK[o] = m.x;
            MOB_PACK[o + 1] = m.y;
            MOB_PACK[o + 2] = m.hp;
            MOB_PACK[o + 3] = m.max_hp;
            MOB_PACK[o + 4] = m.kind;
            MOB_PACK[o + 5] = m.flash;
            MOB_PACK[o + 6] = if m.active { 1.0 } else { 0.0 };
            MOB_PACK[o + 7] = m.vx;
        }
    }
}

#[no_mangle]
pub extern "C" fn set_input(bits: u32) {
    unsafe { INPUT = bits };
}

#[no_mangle]
pub extern "C" fn take_events() -> u32 {
    let e = unsafe { EVENTS };
    unsafe { EVENTS = 0 };
    e
}

#[no_mangle]
pub extern "C" fn get_state_ptr() -> *const f32 {
    unsafe { PACK.as_ptr() }
}

#[no_mangle]
pub extern "C" fn get_inventory_ptr() -> *const u32 {
    unsafe { INV_PACK.as_ptr() }
}

#[no_mangle]
pub extern "C" fn get_mobs_ptr() -> *const f32 {
    unsafe { MOB_PACK.as_ptr() }
}

#[no_mangle]
pub extern "C" fn mob_capacity() -> u32 {
    MAX_MOBS as u32
}

#[no_mangle]
pub extern "C" fn get_view_ptr() -> *const u32 {
    unsafe { VIEW.as_ptr() }
}

#[no_mangle]
pub extern "C" fn fill_view(x0: i32, y0: i32, w: i32, h: i32) -> i32 {
    if w <= 0 || h <= 0 || w > VIEW_W as i32 || h > VIEW_H as i32 {
        return 0;
    }
    unsafe {
        for j in 0..h {
            let y = y0 + j;
            for i in 0..w {
                let x = x0 + i;
                let t = get_tile(x, y);
                let wall = wall_at(x, y);
                let idx = (j * w + i) as usize;
                VIEW[idx] = t as u32 | ((wall as u32) << 8);
            }
        }
    }
    (w * h) as i32
}

#[no_mangle]
pub extern "C" fn surface_at_export(x: i32) -> i32 {
    surface_at(x)
}

#[no_mangle]
pub extern "C" fn get_tile_export(x: i32, y: i32) -> u32 {
    get_tile(x, y) as u32
}

#[no_mangle]
pub extern "C" fn tile_name(tile: u32) -> u32 {
    match tile as u8 {
        GRASS => 1,
        DIRT => 2,
        STONE => 3,
        WOOD => 4,
        LEAVES => 5,
        PLANK => 6,
        TORCH => 7,
        COAL => 8,
        IRON => 9,
        GOLD => 10,
        SAND => 12,
        FLOWER => 13,
        TABLE => 14,
        BRICK => 15,
        _ => 0,
    }
}

#[no_mangle]
pub extern "C" fn mine_at(x: i32, y: i32, dt: f32) -> i32 {
    let p = unsafe { PLAYER };
    if p.health <= 0.0 {
        return -1;
    }
    let cx = p.x;
    let cy = p.y - 0.9;
    let dx = (x as f32 + 0.5 - cx).abs();
    let dy = (y as f32 + 0.5 - cy).abs();
    if dx > 6.8 || dy > 6.8 {
        return -1;
    }
    let t = get_tile(x, y);
    if t == AIR {
        return -1;
    }
    if t == BEDROCK_TILE {
        return -2;
    }
    if x as f32 + 0.5 > p.x {
        unsafe { PLAYER.facing = 1.0 };
    } else if x as f32 + 0.5 < p.x {
        unsafe { PLAYER.facing = -1.0 };
    }
    unsafe {
        if MINE_X != x || MINE_Y != y {
            MINE_X = x;
            MINE_Y = y;
            MINE_PROGRESS = 0.0;
        }
        let speed = mining_speed(t);
        MINE_PROGRESS += dt * speed / hardness(t);
        if MINE_PROGRESS >= 1.0 {
            let drop = drop_of(t);
            if drop != 0 && !can_add_item(drop, 1) {
                MINE_PROGRESS = 0.0;
                return -3;
            }
            set_tile(x, y, AIR);
            if drop != 0 {
                add_item(drop, 1);
            }
            MINE_PROGRESS = 0.0;
            MINE_X = i32::MIN;
            MINE_Y = i32::MIN;
            EVENTS |= EV_BREAK;
            return 1000 + drop as i32;
        }
        (MINE_PROGRESS * 100.0).clamp(0.0, 99.0) as i32
    }
}

#[no_mangle]
pub extern "C" fn cancel_mine() {
    unsafe {
        MINE_X = i32::MIN;
        MINE_Y = i32::MIN;
        MINE_PROGRESS = 0.0;
    }
}

#[no_mangle]
pub extern "C" fn place_at(x: i32, y: i32) -> i32 {
    let p = unsafe { PLAYER };
    if p.health <= 0.0 {
        return -1;
    }
    let (id, count) = selected_item();
    if id == 0 || count == 0 {
        return -4;
    }
    let tile = item_to_tile(id);
    if tile == AIR {
        return -4;
    }
    let cx = p.x;
    let cy = p.y - 0.9;
    if (x as f32 + 0.5 - cx).abs() > 6.8 || (y as f32 + 0.5 - cy).abs() > 6.8 {
        return -1;
    }
    let current = get_tile(x, y);
    if !is_replaceable(current) {
        return -2;
    }
    // Don't suffocate the player.
    let pl = p.x - PLAYER_HALF_W;
    let pr = p.x + PLAYER_HALF_W;
    let pt = p.y - PLAYER_H;
    let pb = p.y;
    if pr > x as f32 && pl < x as f32 + 1.0 && pb > y as f32 && pt < y as f32 + 1.0 {
        return -5;
    }
    // Require something to build against (a neighbour or a cave wall).
    let supported = is_solid(get_tile(x - 1, y))
        || is_solid(get_tile(x + 1, y))
        || is_solid(get_tile(x, y - 1))
        || is_solid(get_tile(x, y + 1))
        || wall_at(x, y) != 0;
    if !supported {
        return -6;
    }
    if tile == TORCH {
        let torch_support = is_solid(get_tile(x - 1, y))
            || is_solid(get_tile(x + 1, y))
            || is_solid(get_tile(x, y - 1))
            || is_solid(get_tile(x, y + 1));
        if !torch_support {
            return -6;
        }
    }
    if !remove_item(id, 1) {
        return -4;
    }
    set_tile(x, y, tile);
    unsafe {
        EVENTS |= EV_PLACE;
        if tile == TABLE {
            FLAGS |= FLAG_TABLE;
        }
        if tile == TORCH {
            TORCHES_PLACED += 1;
            if TORCHES_PLACED >= 3 {
                FLAGS |= FLAG_TORCH;
            }
        }
        update_pack();
    }
    1
}

#[no_mangle]
pub extern "C" fn attack(dir_x: f32) -> i32 {
    let mut p = unsafe { PLAYER };
    if p.health <= 0.0 || p.attack_cd > 0.0 {
        return 0;
    }
    let dir = if dir_x.abs() > 0.1 { dir_x.signum() } else { p.facing };
    p.facing = dir;
    p.attack_cd = 0.36;
    let sword = count_item(SWORD) > 0;
    let damage = if sword { 3.0 } else { 1.0 };
    let mut hits = 0;
    for i in 0..MAX_MOBS {
        let mut m = unsafe { MOBS[i] };
        if !m.active {
            continue;
        }
        let dx = m.x - p.x;
        let dy = (m.y - 0.4) - (p.y - 0.9);
        if dx * dir > -0.5 && dx * dir < 2.7 && dy.abs() < 1.9 {
            m.hp -= damage;
            m.flash = 0.18;
            m.vx = dir * 6.5;
            m.vy = -4.5;
            hits += 1;
            if m.hp <= 0.0 {
                m.active = false;
                add_item(GEL, 1 + (hash2(i as i32, unsafe { DAY } as i32) % 2) as u16);
                unsafe {
                    FLAGS |= FLAG_SLIME;
                    EVENTS |= EV_MOB_DIE;
                }
            }
            unsafe { MOBS[i] = m };
        }
    }
    unsafe {
        PLAYER = p;
        if hits > 0 {
            EVENTS |= EV_ATTACK;
        }
        update_pack();
    }
    hits
}

#[no_mangle]
pub extern "C" fn craft(id: u32) -> i32 {
    let status = craft_status(id);
    if status != 1 {
        return status;
    }
    let Some((out, out_count, r1, c1, r2, c2, _)) = recipe(id) else {
        return 5;
    };
    remove_item(r1, c1);
    if r2 != 0 {
        remove_item(r2, c2);
    }
    add_item(out, out_count);
    unsafe {
        if out == PICKAXE {
            FLAGS |= FLAG_PICK;
        }
        if out == SWORD {
            FLAGS |= FLAG_SWORD;
        }
        EVENTS |= EV_CRAFT;
        update_pack();
    }
    1
}

#[no_mangle]
pub extern "C" fn can_craft(id: u32) -> i32 {
    craft_status(id)
}

#[no_mangle]
pub extern "C" fn set_selected(index: u32) {
    unsafe { SELECTED = (index as usize).min(8) };
    update_pack();
}

#[no_mangle]
pub extern "C" fn get_selected() -> u32 {
    unsafe { SELECTED as u32 }
}

#[no_mangle]
pub extern "C" fn use_selected() -> i32 {
    let (id, count) = selected_item();
    if count == 0 {
        return 0;
    }
    if id == BANDAGE {
        let p = unsafe { PLAYER };
        if p.health >= 10.0 {
            return -1;
        }
        remove_item(BANDAGE, 1);
        unsafe {
            PLAYER.health = (PLAYER.health + 3.0).min(10.0);
            EVENTS |= EV_CRAFT;
            update_pack();
        }
        return 1;
    }
    if id == SWORD {
        return attack(unsafe { PLAYER.facing });
    }
    0
}

#[no_mangle]
pub extern "C" fn respawn() {
    unsafe {
        let h = surface_at(SPAWN_X as i32);
        PLAYER.x = SPAWN_X;
        PLAYER.y = h as f32;
        PLAYER.vx = 0.0;
        PLAYER.vy = 0.0;
        PLAYER.health = 10.0;
        PLAYER.invuln = 2.0;
        PLAYER.attack_cd = 0.0;
        MOBS = [Mob::EMPTY; MAX_MOBS];
        EVENTS = 0;
        update_pack();
    }
}

