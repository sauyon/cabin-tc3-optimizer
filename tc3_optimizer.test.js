/**
 * Tests for tc3_optimizer.js
 *
 * Strategy: load the browser script into a Node.js vm context so all
 * function-declarations become accessible. top-level let/const are
 * rewritten to var so they appear as properties on the context object
 * and can be seeded with test fixtures before each suite.
 */

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const vm     = require('node:vm');
const fs     = require('node:fs');
const path   = require('node:path');

// ─── Patch & load source into vm context ──────────────────────

let src = fs.readFileSync(path.join(__dirname, 'tc3_optimizer.js'), 'utf8');

// Convert top-level let/const → var so vm context exposes them as properties.
// (var in a vm script is placed on the context object; let/const are block-scoped.)
src = src
  .replace(/\blet\b /g, 'var ')
  .replace(/\bconst\b /g, 'var ');

// Suppress the auto-run init() at the very end of the file.
src = src.replace(/^init\(\);?\s*$/m, '/* init() suppressed for testing */');

// Minimal browser-API stubs needed so the script doesn't throw at parse time.
const mockEl = () => ({ style: {}, innerHTML: '', textContent: '', value: '', focus() {} });
const ctx = vm.createContext({
  document:     { getElementById: () => mockEl(), querySelector: () => mockEl() },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch:        async () => ({ ok: false, json: async () => ({}) }),
  setTimeout:   (fn) => fn(),
  Promise, console, JSON, Math, Object, Array, String, Number,
  Set, Map, Date, Uint8Array, parseInt, parseFloat, isNaN, isFinite,
});

vm.runInContext(src, ctx);

// MODIFIER_DEFS is assigned inside init() without declaration – seed it now.
ctx.MODIFIER_DEFS = {};

// TRAIT_EFFECTS is assigned inside init() without declaration – seed it now.
ctx.TRAIT_EFFECTS = {};

// Convenience: pull commonly-tested functions out of the context.
const fn = (name) => ctx[name].bind(ctx);

// ══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ══════════════════════════════════════════════════════════════

describe('toTitleCase', () => {
  const f = fn('toTitleCase');

  it('capitalises the first letter of each word', () => {
    assert.equal(f('hello world'), 'Hello World');
  });

  it('handles single word', () => {
    assert.equal(f('iron'), 'Iron');
  });

  it('handles already capitalised input', () => {
    assert.equal(f('Iron'), 'Iron');
  });

  it('handles empty string', () => {
    assert.equal(f(''), '');
  });

  it('handles mixed separators', () => {
    assert.equal(f('pick head'), 'Pick Head');
  });
});

// ──────────────────────────────────────────────────────────────

describe('toRoman', () => {
  const f = fn('toRoman');

  it('converts 1 → I', () => assert.equal(f(1), 'I'));
  it('converts 2 → II', () => assert.equal(f(2), 'II'));
  it('converts 4 → IV', () => assert.equal(f(4), 'IV'));
  it('converts 5 → V', () => assert.equal(f(5), 'V'));
  it('converts 9 → IX', () => assert.equal(f(9), 'IX'));
  it('converts 10 → X', () => assert.equal(f(10), 'X'));

  it('falls back to string for numbers above 10', () => {
    assert.equal(f(11), '11');
    assert.equal(f(100), '100');
  });

  it('returns string "0" for 0 (falsy lookup falls through to String(n))', () => {
    assert.equal(f(0), '0');
  });
});

// ──────────────────────────────────────────────────────────────

describe('itemLabel', () => {
  const f = fn('itemLabel');

  it('strips namespace and underscores', () => {
    assert.equal(f('tconstruct:pick_head'), 'Pick Head');
  });

  it('works without a namespace', () => {
    assert.equal(f('broad_axe_head'), 'Broad Axe Head');
  });

  it('handles single-word items', () => {
    assert.equal(f('tconstruct:sword'), 'Sword');
  });
});

// ──────────────────────────────────────────────────────────────

describe('statTypeLabel', () => {
  const f = fn('statTypeLabel');

  it('maps known TC3 stat types', () => {
    assert.equal(f('tconstruct:head'),      'Head');
    assert.equal(f('tconstruct:handle'),    'Handle');
    assert.equal(f('tconstruct:binding'),   'Binding');
    assert.equal(f('tconstruct:limb'),      'Bow Limb');
    assert.equal(f('tconstruct:bowstring'), 'Bowstring');
    assert.equal(f('tconstruct:grip'),      'Grip');
  });

  it('title-cases unknown stat types', () => {
    assert.equal(f('tconstruct:skull'), 'Skull');
    assert.equal(f('tconstruct:maille'), 'Maille');
  });
});

// ══════════════════════════════════════════════════════════════
// PARSER FUNCTIONS
// ══════════════════════════════════════════════════════════════

describe('inferTier', () => {
  const f = fn('inferTier');

  it('returns 2 for null input (default iron tier)', () => {
    assert.equal(f(null), 2);
    assert.equal(f(undefined), 2);
  });

  it('returns 1 for wood', () => assert.equal(f({ mining_tier: 'minecraft:wood' }), 1));
  it('returns 1 for stone', () => assert.equal(f({ mining_tier: 'minecraft:stone' }), 1));
  it('returns 1 for gold', () => assert.equal(f({ mining_tier: 'minecraft:gold' }), 1));
  it('returns 2 for iron', () => assert.equal(f({ mining_tier: 'minecraft:iron' }), 2));
  it('returns 3 for diamond', () => assert.equal(f({ mining_tier: 'minecraft:diamond' }), 3));
  it('returns 4 for netherite', () => assert.equal(f({ mining_tier: 'minecraft:netherite' }), 4));

  it('returns 2 (default) for unknown tier string', () => {
    assert.equal(f({ mining_tier: 'minecraft:unknown_material' }), 2);
  });

  it('returns 2 when mining_tier key is missing', () => {
    assert.equal(f({}), 2);
  });
});

// ──────────────────────────────────────────────────────────────

describe('lookupTrait', () => {
  const f = fn('lookupTrait');

  const lang = {
    'modifier.tconstruct.haste':             'Haste',
    'modifier.tconstruct.haste.description': 'Increases mining speed.',
  };

  it('returns name with roman numeral and description from lang', () => {
    const result = f('tconstruct:haste', 2, lang);
    assert.equal(result.name, 'Haste II');
    assert.equal(result.desc, 'Increases mining speed.');
  });

  it('falls back to title-cased key when lang key is missing', () => {
    const result = f('tconstruct:magnetic', 1, {});
    assert.equal(result.name, 'Magnetic I');
    assert.equal(result.desc, '');
  });

  it('handles traits without namespace', () => {
    const result = f('sharp', 3, {});
    assert.equal(result.name, 'Sharp III');
  });

  it('appends roman numeral I for level 1', () => {
    const result = f('tconstruct:haste', 1, lang);
    assert.equal(result.name, 'Haste I');
  });
});

// ──────────────────────────────────────────────────────────────

describe('parseMaterial', () => {
  const f = fn('parseMaterial');

  const validStats = {
    stats: {
      'tconstruct:head': {
        durability: 200, melee_attack: 1.5, mining_speed: 6.0, mining_tier: 'minecraft:iron',
      },
      'tconstruct:handle': {
        durability: 1.2, melee_damage: 0.2, melee_speed: 0.1, mining_speed: 0.1,
      },
    },
  };

  const validTraits = {
    default: [{ name: 'tconstruct:magnetic', level: 1 }],
  };

  const validDef = { tier: 2 };

  const lang = {
    'material.tconstruct.iron': 'Iron',
    'modifier.tconstruct.magnetic': 'Magnetic',
  };

  it('returns null when statsJson is null', () => {
    assert.equal(f('iron', null, null, null, {}), null);
  });

  it('returns null when stats object is missing', () => {
    assert.equal(f('iron', {}, null, null, {}), null);
  });

  it('returns null for stats with no head, handle, or binding', () => {
    assert.equal(f('silk', { stats: { 'tconstruct:bowstring': {} } }, null, null, {}), null);
  });

  it('parses a full material correctly', () => {
    const mat = f('iron', validStats, validTraits, validDef, lang);
    assert.notEqual(mat, null);
    assert.equal(mat.display, 'Iron');
    assert.equal(mat.tier, 2);
    // Compare individual fields to avoid cross-vm realm deepStrictEqual issues
    assert.equal(mat.head.dur,  200);
    assert.equal(mat.head.atk,  1.5);
    assert.equal(mat.head.mspd, 6.0);
    assert.equal(mat.head.tier, 'minecraft:iron');
    assert.equal(mat.handle.durMult,  1.2);
    assert.equal(mat.handle.dmg,      0.2);
    assert.equal(mat.handle.spd,      0.1);
    assert.equal(mat.handle.mspdMult, 0.1);
    assert.equal(mat.traits.length, 1);
    assert.equal(mat.traits[0].name, 'Magnetic I');
    assert.equal(mat.traits[0].id, 'magnetic');
    assert.equal(mat.traits[0].level, 1);
  });

  it('infers tier from mining_tier when defJson has no tier', () => {
    const mat = f('iron', validStats, null, {}, lang);
    assert.equal(mat.tier, 2); // iron tier
  });

  it('uses defJson.tier when provided', () => {
    const mat = f('iron', validStats, null, { tier: 3 }, lang);
    assert.equal(mat.tier, 3);
  });

  it('falls back to title-cased name when lang key is missing', () => {
    const mat = f('manyullyn', validStats, null, validDef, {});
    assert.equal(mat.display, 'Manyullyn');
  });

  it('marks binding slot correctly', () => {
    const statsWithBinding = {
      stats: { 'tconstruct:binding': {}, 'tconstruct:head': validStats.stats['tconstruct:head'] },
    };
    const mat = f('iron', statsWithBinding, null, validDef, {});
    assert.equal(mat.binding, true);
  });

  it('allows binding-only materials (no head or handle)', () => {
    const bindingOnly = { stats: { 'tconstruct:binding': {} } };
    // parseMaterial returns null only if none of head, handle, or binding present
    // binding-only IS allowed (binding check: 'tconstruct:binding' in s)
    const mat = f('string_mat', bindingOnly, null, { tier: 1 }, {});
    assert.notEqual(mat, null);
    assert.equal(mat.binding, true);
    assert.equal(mat.head, null);
    assert.equal(mat.handle, null);
  });

  it('parses limbDur when limb stats are present', () => {
    const withLimb = {
      stats: {
        'tconstruct:head':   validStats.stats['tconstruct:head'],
        'tconstruct:handle': validStats.stats['tconstruct:handle'],
        'tconstruct:limb':   { durability: 150 },
      },
    };
    const mat = f('iron', withLimb, null, validDef, {});
    assert.equal(mat.limbDur, 150);
  });


});

// ──────────────────────────────────────────────────────────────

describe('parseTool', () => {
  const f = fn('parseTool');

  const pickaxeJson = {
    modules: [
      {
        type: 'tconstruct:part_stats',
        parts: [
          { item: 'tconstruct:pick_head',   scale: 1.0 },
          { item: 'tconstruct:tool_handle', scale: 1.0 },
          { item: 'tconstruct:tool_binding', scale: 1.0 },
        ],
      },
      {
        type: 'tconstruct:base_stats',
        stats: {
          'tconstruct:attack_damage': 1.0,
          'tconstruct:attack_speed':  1.2,
        },
      },
      {
        type: 'tconstruct:multiply_stats',
        multipliers: {
          'tconstruct:attack_damage': 1.0,
          'tconstruct:durability':    1.0,
          'tconstruct:mining_speed':  1.0,
        },
      },
      {
        type: 'tconstruct:modifier_slots',
        slots: { upgrades: 3, abilities: 1 },
      },
    ],
  };

  it('returns null when toolJson is null', () => {
    assert.equal(f('pickaxe', null, {}), null);
  });

  it('returns null when modules array is missing', () => {
    assert.equal(f('pickaxe', {}, {}), null);
  });

  it('returns null if no head or handle parts', () => {
    const bowOnly = {
      modules: [{
        type: 'tconstruct:part_stats',
        parts: [{ item: 'tconstruct:bow_limb', scale: 1.0 }],
      }],
    };
    assert.equal(f('crossbow', bowOnly, {}), null);
  });

  it('parses a pickaxe tool correctly', () => {
    const tool = f('pickaxe', pickaxeJson, {});
    assert.notEqual(tool, null);

    const headPart = tool.parts.find(p => p.statType === 'head');
    assert.ok(headPart, 'should have a head part');
    assert.equal(headPart.scale, 1.0);
    assert.match(headPart.label, /Pick Head/i);

    const handlePart = tool.parts.find(p => p.statType === 'handle');
    assert.ok(handlePart, 'should have a handle part');

    assert.equal(tool.baseAtk, 1.0);
    assert.equal(tool.baseAtkSpd, 1.2);
    assert.equal(tool.multiply.atk, 1.0);
    assert.equal(tool.multiply.dur, 1.0);
    assert.equal(tool.multiply.mspd, 1.0);
    assert.deepEqual(tool.slots, { upgrades: 3, abilities: 1 });
  });

  it('uses TOOL_META icon and group for known tools', () => {
    const tool = f('pickaxe', pickaxeJson, {});
    assert.equal(tool.icon, '⛏');
    assert.equal(tool.group, 'Mining');
  });

  it('labels duplicate parts with roman numerals', () => {
    const twoHeads = {
      modules: [{
        type: 'tconstruct:part_stats',
        parts: [
          { item: 'tconstruct:pick_head',   scale: 1.0 },
          { item: 'tconstruct:pick_head',   scale: 0.75 },
          { item: 'tconstruct:tool_handle', scale: 1.0 },
        ],
      }],
    };
    const tool = f('minotaur_axe', twoHeads, {});
    const heads = tool.parts.filter(p => p.statType === 'head');
    assert.equal(heads.length, 2);
    assert.match(heads[0].label, /I$/);
    assert.match(heads[1].label, /II/);
  });

  it('applies (×scale) label when scale < 1', () => {
    const scaledTool = {
      modules: [{
        type: 'tconstruct:part_stats',
        parts: [
          { item: 'tconstruct:pick_head',   scale: 0.5 },
          { item: 'tconstruct:tool_handle', scale: 1.0 },
        ],
      }],
    };
    const tool = f('war_pick', scaledTool, {});
    const head = tool.parts.find(p => p.statType === 'head');
    assert.match(head.label, /×0\.5/);
  });

  it('falls back to title-cased name for unknown tools', () => {
    const tool = f('unknown_weapon', pickaxeJson, {});
    assert.equal(tool.display, 'Unknown Weapon');
    assert.equal(tool.icon, '🔧');
  });
});

// ══════════════════════════════════════════════════════════════
// CALCULATION FUNCTIONS
// ══════════════════════════════════════════════════════════════

describe('applyModifierBonuses', () => {
  const f = fn('applyModifierBonuses');

  before(() => {
    ctx.MODIFIER_DEFS = {
      haste: {
        slot: 'upgrades', maxLevel: 5, display: 'Haste', desc: '',
        effects: [{ stat: 'mspd', op: 'add', flat: 0, eachLevel: 0.5 }],
      },
      sharpness: {
        slot: 'upgrades', maxLevel: 5, display: 'Sharpness', desc: '',
        effects: [{ stat: 'atk', op: 'add', flat: 0.5, eachLevel: 0.5 }],
      },
      reinforced: {
        slot: 'upgrades', maxLevel: 5, display: 'Reinforced', desc: '',
        effects: [{ stat: 'dur', op: 'multiply_base', flat: 0, eachLevel: 0.1 }],
      },
      necrotic: {
        slot: 'upgrades', maxLevel: 5, display: 'Necrotic', desc: '',
        effects: [{ stat: 'atkSpd', op: 'multiply_conditional', flat: 0, eachLevel: 0.05 }],
      },
      diamond: {
        slot: 'upgrades', maxLevel: 1, display: 'Diamond', desc: '',
        effects: [{ stat: 'tier', op: 'set_min', value: 'minecraft:diamond' }],
      },
    };
  });

  it('returns identity values for empty mods', () => {
    const b = f({});
    assert.equal(b.addDur, 0);
    assert.equal(b.addAtk, 0);
    assert.equal(b.addMspd, 0);
    assert.equal(b.mulDur, 1);
    assert.equal(b.mulAtk, 1);
    assert.equal(b.mulMspd, 1);
    assert.equal(b.mulAtkSpd, 1);
    assert.equal(b.tierBoosts.length, 0);
  });

  it('accumulates addMspd with eachLevel for haste', () => {
    const b = f({ haste: 3 });
    assert.equal(b.addMspd, 1.5); // 0.5 * 3
  });

  it('accumulates addAtk with flat + eachLevel for sharpness', () => {
    const b = f({ sharpness: 2 });
    // flat=0.5 + eachLevel=0.5 * level=2  → 0.5 + 1.0 = 1.5
    assert.equal(b.addAtk, 1.5);
  });

  it('applies multiply_base to mulDur', () => {
    const b = f({ reinforced: 2 });
    // (1 + eachLevel * level) = (1 + 0.1*2) = 1.2
    assert.equal(b.mulDur, 1.2);
  });

  it('applies multiply_conditional to mulAtkSpd', () => {
    const b = f({ necrotic: 4 });
    // (1 + 0.05*4) = 1.2
    assert.equal(b.mulAtkSpd, 1.2);
  });

  it('collects tier boost values', () => {
    const b = f({ diamond: 1 });
    assert.equal(b.tierBoosts.length, 1);
    assert.equal(b.tierBoosts[0], 'minecraft:diamond');
  });

  it('stacks multiple modifiers', () => {
    const b = f({ haste: 2, sharpness: 1, reinforced: 1 });
    assert.equal(b.addMspd, 1.0);  // 0.5*2
    assert.equal(b.addAtk, 1.0);   // 0.5 + 0.5*1
    assert.equal(b.mulDur, 1.1);   // 1 + 0.1*1
  });

  it('ignores mods with level 0', () => {
    const b = f({ haste: 0 });
    assert.equal(b.addMspd, 0);
  });

  it('ignores unknown modifier keys', () => {
    const b = f({ nonexistent_mod: 3 });
    assert.equal(b.addMspd, 0);
    assert.equal(b.addAtk, 0);
  });
});

// ──────────────────────────────────────────────────────────────

describe('calcStats', () => {
  const f = fn('calcStats');

  before(() => {
    ctx.MODIFIER_DEFS = {};

    ctx.MATERIALS = {
      iron: {
        display: 'Iron', tier: 2,
        head:   { dur: 200, atk: 1.5, mspd: 6.0, tier: 'minecraft:iron' },
        handle: { durMult: 1.0, dmg: 0.0, spd: 0.0, mspdMult: 0.0 },
        traits: [],
      },
      diamond: {
        display: 'Diamond', tier: 3,
        head:   { dur: 500, atk: 2.0, mspd: 8.0, tier: 'minecraft:diamond' },
        handle: { durMult: 1.5, dmg: 0.5, spd: 0.1, mspdMult: 0.2 },
        traits: [],
      },
      wood: {
        display: 'Wood', tier: 0,
        head:   { dur: 60, atk: 0.5, mspd: 2.0, tier: 'minecraft:wood' },
        handle: { durMult: 0.5, dmg: 0.0, spd: 0.0, mspdMult: 0.0 },
        traits: [],
      },
    };

    ctx.TOOLS = {
      pickaxe: {
        display: 'Pickaxe', icon: '⛏', group: 'Mining',
        parts: [
          { label: 'Pick Head', statType: 'head',   scale: 1.0 },
          { label: 'Handle',    statType: 'handle', scale: 1.0 },
        ],
        baseAtk: 1.0, baseAtkSpd: 1.2,
        multiply: { atk: 1.0, dur: 1.0, mspd: 1.0 },
        slots: { upgrades: 3, abilities: 1 },
        builtIn: [],
      },
    };
  });

  it('calculates iron pickaxe stats correctly', () => {
    const s = f('pickaxe', ['iron', 'iron']);
    // dur = round((200) * (1 + 1.0) * 1.0 * 1) = round(400) = 400
    assert.equal(s.dur, 400);
    // atk = (1.0 + 1.5 + 0) * (1 + 0.0) * 1.0 * 1 = 2.5
    assert.equal(s.atk, 2.5);
    // atkSpd = 1.2 * (1 + 0.0) * 1 = 1.2
    assert.equal(s.atkSpd, 1.2);
    // mspd = (6.0 + 0) * (1 + 0.0) * 1.0 * 1 = 6.0
    assert.equal(s.mspd, 6.0);
    // dps = 2.5 * 1.2 = 3.0
    assert.equal(s.dps, 3.0);
    assert.equal(s.tier, 'minecraft:iron');
  });

  it('picks the highest tier from multiple head parts', () => {
    // Put diamond head + wood handle
    const s = f('pickaxe', ['diamond', 'wood']);
    assert.equal(s.tier, 'minecraft:diamond');
  });

  it('applies tool multiply factors', () => {
    // Modify tool multipliers temporarily
    const origMul = ctx.TOOLS.pickaxe.multiply;
    ctx.TOOLS.pickaxe.multiply = { atk: 2.0, dur: 1.5, mspd: 1.0 };
    const s = f('pickaxe', ['iron', 'iron']);
    // dur = round(200 * (1+1.0) * 1.5) = round(600) = 600
    assert.equal(s.dur, 600);
    // atk = (1.0 + 1.5) * (1+0) * 2.0 = 5.0
    assert.equal(s.atk, 5.0);
    ctx.TOOLS.pickaxe.multiply = origMul;
  });

  it('applies modifier add bonuses', () => {
    ctx.MODIFIER_DEFS = {
      sharpness: {
        slot: 'upgrades', maxLevel: 5, display: 'Sharpness', desc: '',
        effects: [{ stat: 'atk', op: 'add', flat: 0.5, eachLevel: 0.5 }],
      },
    };
    const s = f('pickaxe', ['iron', 'iron'], { sharpness: 2 });
    // addAtk = 0.5 + 0.5*2 = 1.5
    // atk = (1.0 + 1.5 + 1.5) * (1+0) * 1.0 = 4.0
    assert.equal(s.atk, 4.0);
    ctx.MODIFIER_DEFS = {};
  });

  it('returns traits from materials', () => {
    ctx.MATERIALS.iron.traits = [{ name: 'Magnetic I', desc: 'Attracts items', src: 'default' }];
    const s = f('pickaxe', ['iron', 'iron']);
    assert.equal(s.traits.length, 1);
    assert.equal(s.traits[0].name, 'Magnetic I');
    ctx.MATERIALS.iron.traits = [];
  });

  it('handles missing material gracefully (skips part)', () => {
    // 'nonexistent' is not in MATERIALS — should not throw
    const s = f('pickaxe', ['iron', 'nonexistent']);
    assert.ok(typeof s.dur === 'number');
  });
});

// ──────────────────────────────────────────────────────────────

describe('scoreStats', () => {
  const f = fn('scoreStats');

  const baseStats = {
    dur: 500, atk: 5.0, atkSpd: 1.5, mspd: 8.0,
    dps: 7.5, tier: 'minecraft:diamond', traits: [],
  };

  it('scores dps goal by dps * 100', () => {
    assert.equal(f(baseStats, 'dps'), 750);
  });

  it('scores damage goal by atk * 100', () => {
    assert.equal(f(baseStats, 'damage'), 500);
  });

  it('scores durability goal by raw dur', () => {
    assert.equal(f(baseStats, 'durability'), 500);
  });

  it('scores mining goal by mspd, mining capability tier, and durability', () => {
    // baseStats has diamond tier (tierVal=3): mspd*40 + tierVal*30 + dur*0.05
    // = 8.0*40 + 3*30 + 500*0.05 = 320 + 90 + 25 = 435
    assert.equal(f(baseStats, 'mining'), 435);
  });

  it('scores balanced goal as dps*50 + dur*0.03 + mspd*5', () => {
    // 7.5*50 + 500*0.03 + 8.0*5 = 375 + 15 + 40 = 430
    const expected = +(7.5*50 + 500*0.03 + 8.0*5).toFixed(10);
    assert.equal(f(baseStats, 'balanced'), expected);
  });

  it('mining goal scores wood/gold tier lower than netherite tier', () => {
    const woodStats = { ...baseStats, tier: 'minecraft:wood' };   // tierVal=0
    const netherStats = { ...baseStats, tier: 'minecraft:netherite' }; // tierVal=4
    // wood: 8.0*40 + 0*30 + 500*0.05 = 345 ; netherite: 8.0*40 + 4*30 + 500*0.05 = 465
    assert.equal(f(woodStats, 'mining'), 345);
    assert.equal(f(netherStats, 'mining'), 465);
    assert.ok(f(netherStats, 'mining') > f(woodStats, 'mining'));
  });

  it('non-mining goals do not score tier — tier is displayed only', () => {
    const allTiers = ['minecraft:wood', 'minecraft:stone', 'minecraft:gold',
                      'minecraft:iron', 'minecraft:diamond', 'minecraft:netherite'];
    const goals = ['dps', 'damage', 'durability', 'balanced'];
    for (const goal of goals) {
      const scores = allTiers.map(tier => f({ ...baseStats, tier }, goal));
      assert.ok(scores.every(s => s === scores[0]),
        `Goal "${goal}" should not score tier, but got: ${scores.join(', ')}`);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════════════════

describe('materialOptions', () => {
  const f = fn('materialOptions');

  before(() => {
    ctx.MATERIALS = {
      iron:      { display: 'Iron',      tier: 2, head: { dur:200, atk:1.5, mspd:6, tier:'minecraft:iron' }, handle: null, limbDur: undefined, binding: false, traits: [] },
      diamond:   { display: 'Diamond',   tier: 3, head: { dur:500, atk:2.0, mspd:8, tier:'minecraft:diamond' }, handle: null, limbDur: undefined, binding: false, traits: [] },
      netherite: { display: 'Netherite', tier: 4, head: { dur:900, atk:3.0, mspd:9, tier:'minecraft:netherite' }, handle: null, limbDur: undefined, binding: false, traits: [] },
      copper:    { display: 'Copper',    tier: 1, head: { dur:100, atk:1.0, mspd:4, tier:'minecraft:stone' }, handle: null, limbDur: undefined, binding: false, traits: [] },
      oak:       { display: 'Oak',       tier: 1, head: null, handle: { durMult:0.9, dmg:0, spd:0, mspdMult:0 }, limbDur: undefined, binding: false, traits: [] },
      slime:     { display: 'Slime',     tier: 1, head: null, handle: null, limbDur: 80, binding: false, traits: [] },
      string_mat:{ display: 'String',    tier: 0, head: null, handle: null, limbDur: undefined, binding: true, traits: [] },
    };
  });

  it('filters head materials (have .head property)', () => {
    const opts = f('head');
    const keys = opts.map(([k]) => k);
    assert.ok(keys.includes('iron'));
    assert.ok(keys.includes('diamond'));
    assert.ok(!keys.includes('oak'));    // handle only
    assert.ok(!keys.includes('slime')); // limb only
  });

  it('filters handle materials', () => {
    const opts = f('handle');
    const keys = opts.map(([k]) => k);
    assert.ok(keys.includes('oak'));
    assert.ok(!keys.includes('iron'));
  });

  it('filters limb materials', () => {
    const opts = f('limb');
    const keys = opts.map(([k]) => k);
    assert.ok(keys.includes('slime'));
    assert.ok(!keys.includes('iron'));
  });

  it('filters binding materials (binding flag)', () => {
    const opts = f('binding');
    const keys = opts.map(([k]) => k);
    assert.ok(keys.includes('string_mat'));
    assert.ok(!keys.includes('iron'));
  });

  it('uses binding materials for bowstring slot', () => {
    const bowstring = f('bowstring');
    const binding   = f('binding');
    assert.deepEqual(
      bowstring.map(([k]) => k).sort(),
      binding.map(([k]) => k).sort(),
    );
  });

  it('uses handle materials for grip slot', () => {
    const grip   = f('grip');
    const handle = f('handle');
    assert.deepEqual(
      grip.map(([k]) => k).sort(),
      handle.map(([k]) => k).sort(),
    );
  });

  it('respects maxTier filter', () => {
    const opts = f('head', 2);
    const keys = opts.map(([k]) => k);
    assert.ok(!keys.includes('diamond'));   // tier 3
    assert.ok(!keys.includes('netherite')); // tier 4
    assert.ok(keys.includes('iron'));       // tier 2
    assert.ok(keys.includes('copper'));     // tier 1
  });

  it('sorts by tier descending then display ascending', () => {
    const opts = f('head', 4);
    const tiers = opts.map(([, m]) => m.tier);
    for (let i = 1; i < tiers.length; i++) {
      assert.ok(tiers[i] <= tiers[i - 1], 'should be sorted by tier descending');
    }
  });
});

// ══════════════════════════════════════════════════════════════
// OPTIMIZER HELPERS
// ══════════════════════════════════════════════════════════════

describe('slotDominates', () => {
  const f = fn('slotDominates');

  const high = {
    head:   { dur: 500, atk: 2.0, mspd: 8.0, tier: 'minecraft:diamond' },
    handle: { durMult: 1.5, dmg: 0.5, spd: 0.2, mspdMult: 0.3 },
    limbDur: 200,
  };
  const low = {
    head:   { dur: 200, atk: 1.5, mspd: 6.0, tier: 'minecraft:iron' },
    handle: { durMult: 1.0, dmg: 0.0, spd: 0.0, mspdMult: 0.0 },
    limbDur: 100,
  };
  const equal = {
    head:   { dur: 500, atk: 2.0, mspd: 8.0, tier: 'minecraft:diamond' },
    handle: { durMult: 1.5, dmg: 0.5, spd: 0.2, mspdMult: 0.3 },
  };

  it('returns true when high head strictly dominates low head', () => {
    assert.equal(f('head', high, low), true);
  });

  it('returns false when a dominates b equally (no strict advantage)', () => {
    assert.equal(f('head', equal, high), false);
  });

  it('returns false when low does not dominate high', () => {
    assert.equal(f('head', low, high), false);
  });

  it('returns true when handle dominates', () => {
    assert.equal(f('handle', high, low), true);
  });

  it('returns false when handles are equal', () => {
    assert.equal(f('handle', equal, high), false);
  });

  it('returns true when limbDur strictly greater', () => {
    assert.equal(f('limb', high, low), true);
  });

  it('returns false for limb when equal durability', () => {
    assert.equal(f('limb', { limbDur: 100 }, { limbDur: 100 }), false);
  });

  it('returns false for binding/bowstring/grip (no ordering)', () => {
    assert.equal(f('binding', high, low), false);
    assert.equal(f('bowstring', high, low), false);
    assert.equal(f('grip', high, low), false);
  });

  it('returns false when head is null', () => {
    assert.equal(f('head', { head: null }, low), false);
    assert.equal(f('head', high, { head: null }), false);
  });
});

// ──────────────────────────────────────────────────────────────

describe('pruneSlot', () => {
  const f = fn('pruneSlot');

  const dominated = ['mat_a', {
    head: { dur: 200, atk: 1.0, mspd: 4.0, tier: 'minecraft:iron' },
  }];
  const dominant = ['mat_b', {
    head: { dur: 500, atk: 2.0, mspd: 8.0, tier: 'minecraft:diamond' },
  }];
  const trade_off = ['mat_c', {
    head: { dur: 600, atk: 1.0, mspd: 3.0, tier: 'minecraft:iron' },
  }];

  it('removes clearly dominated materials for head slot', () => {
    const result = f('head', [dominated, dominant]);
    const keys = result.map(([k]) => k);
    assert.ok(!keys.includes('mat_a'));
    assert.ok(keys.includes('mat_b'));
  });

  it('keeps materials with trade-offs', () => {
    const result = f('head', [dominated, dominant, trade_off]);
    const keys = result.map(([k]) => k);
    assert.ok(!keys.includes('mat_a')); // mat_a dominated by mat_b
    assert.ok(keys.includes('mat_b'));
    assert.ok(keys.includes('mat_c')); // mat_c has higher dur than mat_b
  });

  it('returns all options unchanged for binding slot', () => {
    const opts = [['a', {}], ['b', {}]];
    assert.deepEqual(f('binding', opts), opts);
  });

  it('returns all options unchanged for bowstring slot', () => {
    const opts = [['a', {}], ['b', {}]];
    assert.deepEqual(f('bowstring', opts), opts);
  });

  it('handles single-item list', () => {
    assert.deepEqual(f('head', [dominant]), [dominant]);
  });

  it('handles empty list', () => {
    assert.deepEqual(f('head', []), []);
  });
});

// ──────────────────────────────────────────────────────────────

describe('paretoFilter', () => {
  const f = fn('paretoFilter');

  const mkResult = (dur, atk, atkSpd, mspd, tier = 'minecraft:iron') => ({
    combo: [],
    stats: { dur, atk, atkSpd, mspd, tier },
  });

  it('returns single result unchanged', () => {
    const r = [mkResult(500, 5, 1.5, 8)];
    assert.equal(f(r).length, 1);
  });

  it('removes clearly dominated results', () => {
    const best = mkResult(500, 5, 1.5, 8, 'minecraft:diamond');
    const worst = mkResult(200, 3, 1.0, 4, 'minecraft:iron');
    const kept = f([best, worst]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].stats.dur, 500);
  });

  it('keeps both results when there is a trade-off', () => {
    const highDur = mkResult(800, 3, 1.0, 4);
    const highAtk = mkResult(200, 8, 1.5, 4);
    const kept = f([highDur, highAtk]);
    assert.equal(kept.length, 2);
  });

  it('keeps all Pareto-optimal results', () => {
    const r1 = mkResult(800, 3, 1.0, 4);
    const r2 = mkResult(200, 8, 1.0, 4);
    const r3 = mkResult(200, 3, 1.0, 9);
    const dominated = mkResult(150, 2, 0.8, 3);
    const kept = f([r1, r2, r3, dominated]);
    assert.equal(kept.length, 3);
    assert.ok(!kept.includes(dominated));
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(f([]), []);
  });

  it('respects tier in dominance comparison', () => {
    const lowTierGoodStats  = mkResult(500, 5, 1.5, 8, 'minecraft:iron');
    const highTierBetterAll = mkResult(500, 5, 1.5, 8, 'minecraft:diamond');
    const kept = f([lowTierGoodStats, highTierBetterAll]);
    // highTierBetterAll dominates (same stats + higher tier)
    assert.equal(kept.length, 1);
    assert.equal(kept[0].stats.tier, 'minecraft:diamond');
  });
});

// ══════════════════════════════════════════════════════════════
// MISC PURE HELPERS
// ══════════════════════════════════════════════════════════════

describe('escHtml', () => {
  const f = fn('escHtml');

  it('escapes ampersand', () => assert.equal(f('a & b'), 'a &amp; b'));
  it('escapes less-than', () => assert.equal(f('<script>'), '&lt;script&gt;'));
  it('escapes greater-than', () => assert.equal(f('x > y'), 'x &gt; y'));
  it('escapes double quote', () => assert.equal(f('"hello"'), '&quot;hello&quot;'));
  it('handles multiple special chars', () => {
    assert.equal(f('<a href="x&y">'), '&lt;a href=&quot;x&amp;y&quot;&gt;');
  });
  it('leaves safe strings unchanged', () => assert.equal(f('Hello World'), 'Hello World'));
  it('converts non-strings via String()', () => assert.equal(f(42), '42'));
});

// ──────────────────────────────────────────────────────────────

describe('barHTML', () => {
  const f = fn('barHTML');

  it('produces a bar-track div containing a bar-fill', () => {
    const html = f('bar-durability', 50);
    assert.match(html, /class="bar-track"/);
    assert.match(html, /class="bar-fill bar-durability"/);
    assert.match(html, /width:50%/);
  });

  it('clamps percentage at 100%', () => {
    const html = f('bar-attack', 150);
    assert.match(html, /width:100%/);
  });

  it('allows 0%', () => {
    const html = f('bar-mining', 0);
    assert.match(html, /width:0%/);
  });
});

// ──────────────────────────────────────────────────────────────

describe('tierBadgeHTML', () => {
  const f = fn('tierBadgeHTML');

  it('renders iron tier badge with correct class and label', () => {
    const html = f('minecraft:iron');
    assert.match(html, /tier-iron/);
    assert.match(html, /Iron Tier/);
  });

  it('renders diamond tier badge', () => {
    const html = f('minecraft:diamond');
    assert.match(html, /tier-diamond/);
    assert.match(html, /Diamond Tier/);
  });

  it('handles unknown tier gracefully', () => {
    const html = f('minecraft:unknown');
    assert.match(html, /Tier/);
    // should not throw
  });
});
