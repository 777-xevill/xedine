/**
 * Recipes and ingredient prices for the demo orgs (ROADMAP Phase 3 test oracle). Fixture data only.
 *
 * Every price is a whole number of poisha per base unit and every line's quantity ÷ yield is a whole
 * number of base units, so a recipe's cost is an exact integer here and in SQL (private.recipe_unit_cost):
 * the manifest and the database can never disagree by a rounding step.
 *
 * Planted:
 *   S3 (full) — the Family Combo costs more than its net price less foodpanda's 30%, but not less Pathao's 25%.
 *   S4 — beef jumps from ৳720 to ৳1,040/kg for four weeks from week 20, pushing Beef Tehari above the
 *        40% food-cost target (34.6% → 44.9%).
 *   S5 — Kala Bhuna is a Puzzle (rarely ordered, high contribution); Shahi Tukra a Dog (rarely ordered, low).
 */
import { addDays } from '../../src/lib/time/business-date';
import { FIRST_DATE } from './config';

export type Base = 'g' | 'ml' | 'pcs';
export interface IngredientCfg {
  key: string;
  name: string;
  base: Base;
  /** Poisha per base unit (per gram, millilitre or piece). */
  poishaPerBase: number;
}
export interface LineCfg {
  ing: string;
  qty: number;
  /** Usable share of the quantity bought, %. Defaults to 100. */
  yieldPct?: number;
}
export interface OrgCosting {
  targetFoodCostBps: number;
  ingredients: IngredientCfg[];
  recipes: Record<string, LineCfg[]>;
  /** Price changes after FIRST_DATE: from this business day on, the ingredient costs this much. */
  priceChanges: { ing: string; from: string; poishaPerBase: number }[];
}

/** S4: weeks 20–23 of the seeded year. */
export const BEEF_SPIKE_FROM = addDays(FIRST_DATE, 133);
export const BEEF_SPIKE_TO = addDays(FIRST_DATE, 160);

const ing = (key: string, name: string, base: Base, poishaPerBase: number): IngredientCfg => ({
  key,
  name,
  base,
  poishaPerBase,
});

export const COSTING: Record<string, OrgCosting> = {
  demo_kacchi_house: {
    targetFoodCostBps: 4000,
    ingredients: [
      ing('mutton', 'Mutton', 'g', 110),
      ing('beef', 'Beef', 'g', 72),
      ing('chicken', 'Chicken', 'g', 32),
      ing('rice', 'Chinigura rice', 'g', 14),
      ing('potato', 'Potato', 'g', 4),
      ing('oil', 'Soybean oil', 'ml', 18),
      ing('ghee', 'Ghee', 'ml', 150),
      ing('spices', 'Spice mix', 'g', 60),
      ing('onion', 'Onion', 'g', 6),
      ing('yogurt', 'Yogurt', 'g', 12),
      ing('egg', 'Egg', 'pcs', 1300),
      ing('milk', 'Milk', 'ml', 10),
      ing('sugar', 'Sugar', 'g', 12),
      ing('bread', 'Bread slice', 'pcs', 1000),
      ing('soft', 'Soft drink (can)', 'pcs', 1800),
      ing('water', 'Mineral water (bottle)', 'pcs', 1000),
      ing('cucumber', 'Cucumber', 'g', 5),
      ing('mint', 'Mint', 'g', 40),
      ing('nuts', 'Nuts', 'g', 150),
    ],
    recipes: {
      kacchi_mutton: [
        { ing: 'mutton', qty: 81, yieldPct: 90 },
        { ing: 'rice', qty: 150 },
        { ing: 'potato', qty: 80 },
        { ing: 'ghee', qty: 10 },
        { ing: 'spices', qty: 8 },
      ],
      kacchi_half: [
        { ing: 'mutton', qty: 45, yieldPct: 90 },
        { ing: 'rice', qty: 100 },
        { ing: 'potato', qty: 50 },
        { ing: 'ghee', qty: 6 },
        { ing: 'spices', qty: 5 },
      ],
      tehari: [
        { ing: 'beef', qty: 63, yieldPct: 90 },
        { ing: 'rice', qty: 120 },
        { ing: 'oil', qty: 15 },
        { ing: 'onion', qty: 40 },
        { ing: 'spices', qty: 6 },
      ],
      morog_polao: [
        { ing: 'chicken', qty: 135, yieldPct: 90 },
        { ing: 'rice', qty: 150 },
        { ing: 'ghee', qty: 12 },
        { ing: 'spices', qty: 6 },
        { ing: 'egg', qty: 1 },
      ],
      chicken_roast: [
        { ing: 'chicken', qty: 108, yieldPct: 90 },
        { ing: 'oil', qty: 15 },
        { ing: 'onion', qty: 30 },
        { ing: 'spices', qty: 4 },
      ],
      beef_bhuna: [
        { ing: 'beef', qty: 90, yieldPct: 90 },
        { ing: 'oil', qty: 20 },
        { ing: 'onion', qty: 60 },
        { ing: 'spices', qty: 8 },
      ],
      chicken_kabab: [
        { ing: 'chicken', qty: 153, yieldPct: 90 },
        { ing: 'yogurt', qty: 30 },
        { ing: 'spices', qty: 6 },
        { ing: 'oil', qty: 10 },
      ],
      jali_kabab: [
        { ing: 'beef', qty: 36, yieldPct: 90 },
        { ing: 'egg', qty: 1 },
        { ing: 'onion', qty: 20 },
        { ing: 'oil', qty: 5 },
        { ing: 'spices', qty: 4 },
      ],
      plain_rice: [{ ing: 'rice', qty: 100 }],
      salad: [
        { ing: 'cucumber', qty: 150 },
        { ing: 'onion', qty: 40 },
      ],
      firni: [
        { ing: 'milk', qty: 150 },
        { ing: 'rice', qty: 20 },
        { ing: 'sugar', qty: 25 },
        { ing: 'nuts', qty: 5 },
      ],
      borhani: [
        { ing: 'yogurt', qty: 120 },
        { ing: 'mint', qty: 10 },
        { ing: 'sugar', qty: 10 },
        { ing: 'spices', qty: 3 },
      ],
      soft_drink: [{ ing: 'soft', qty: 1 }],
      water: [{ ing: 'water', qty: 1 }],
      family_combo: [
        { ing: 'mutton', qty: 360, yieldPct: 90 },
        { ing: 'rice', qty: 450 },
        { ing: 'chicken', qty: 300 },
        { ing: 'ghee', qty: 45 },
        { ing: 'potato', qty: 240 },
        { ing: 'spices', qty: 30 },
        { ing: 'soft', qty: 4 },
        { ing: 'egg', qty: 4 },
        { ing: 'milk', qty: 400 },
        { ing: 'sugar', qty: 10 },
      ],
      shahi_tukra: [
        { ing: 'bread', qty: 3 },
        { ing: 'ghee', qty: 30 },
        { ing: 'milk', qty: 200 },
        { ing: 'sugar', qty: 40 },
        { ing: 'nuts', qty: 20 },
      ],
      kala_bhuna: [
        { ing: 'beef', qty: 117, yieldPct: 90 },
        { ing: 'oil', qty: 20 },
        { ing: 'onion', qty: 60 },
        { ing: 'spices', qty: 10 },
      ],
    },
    priceChanges: [
      { ing: 'beef', from: BEEF_SPIKE_FROM, poishaPerBase: 104 },
      { ing: 'beef', from: addDays(BEEF_SPIKE_TO, 1), poishaPerBase: 72 },
    ],
  },
  demo_cafe: {
    targetFoodCostBps: 3500,
    ingredients: [
      ing('beans', 'Coffee beans', 'g', 250),
      ing('milk', 'Milk', 'ml', 10),
      ing('sugar', 'Sugar', 'g', 12),
      ing('icecream', 'Ice cream', 'g', 40),
      ing('tea', 'Tea leaves', 'g', 150),
      ing('lemon', 'Lemon', 'pcs', 500),
      ing('bread', 'Bread slice', 'pcs', 1000),
      ing('chicken', 'Chicken', 'g', 32),
      ing('mayo', 'Mayonnaise', 'g', 40),
      ing('lettuce', 'Lettuce', 'g', 10),
      ing('egg', 'Egg', 'pcs', 1300),
      ing('cheese', 'Cheese', 'g', 100),
      ing('pasta', 'Pasta', 'g', 25),
      ing('cream', 'Cream', 'ml', 50),
      ing('potato', 'Potato', 'g', 4),
      ing('oil', 'Oil', 'ml', 18),
      ing('flour', 'Flour', 'g', 8),
      ing('butter', 'Butter', 'g', 120),
      ing('chocolate', 'Chocolate', 'g', 90),
      ing('biscuit', 'Biscuit crumb', 'g', 30),
    ],
    recipes: {
      espresso: [{ ing: 'beans', qty: 18 }],
      cappuccino: [
        { ing: 'beans', qty: 18 },
        { ing: 'milk', qty: 180 },
      ],
      latte: [
        { ing: 'beans', qty: 18 },
        { ing: 'milk', qty: 220 },
      ],
      cold_coffee: [
        { ing: 'beans', qty: 15 },
        { ing: 'milk', qty: 200 },
        { ing: 'sugar', qty: 20 },
        { ing: 'icecream', qty: 50 },
      ],
      iced_tea: [
        { ing: 'tea', qty: 5 },
        { ing: 'sugar', qty: 25 },
        { ing: 'lemon', qty: 1 },
      ],
      chicken_sandwich: [
        { ing: 'bread', qty: 2 },
        { ing: 'chicken', qty: 80 },
        { ing: 'mayo', qty: 20 },
        { ing: 'lettuce', qty: 20 },
      ],
      club_sandwich: [
        { ing: 'bread', qty: 3 },
        { ing: 'chicken', qty: 80 },
        { ing: 'egg', qty: 1 },
        { ing: 'mayo', qty: 20 },
        { ing: 'cheese', qty: 20 },
      ],
      pasta_alfredo: [
        { ing: 'pasta', qty: 120 },
        { ing: 'cream', qty: 80 },
        { ing: 'chicken', qty: 60 },
        { ing: 'cheese', qty: 20 },
      ],
      fries: [
        { ing: 'potato', qty: 200 },
        { ing: 'oil', qty: 30 },
      ],
      croissant: [
        { ing: 'flour', qty: 60 },
        { ing: 'butter', qty: 30 },
      ],
      brownie: [
        { ing: 'chocolate', qty: 40 },
        { ing: 'flour', qty: 30 },
        { ing: 'sugar', qty: 30 },
        { ing: 'egg', qty: 1 },
      ],
      cheesecake: [
        { ing: 'cheese', qty: 80 },
        { ing: 'biscuit', qty: 30 },
        { ing: 'sugar', qty: 20 },
      ],
    },
    priceChanges: [],
  },
};

/** An ingredient's price per base unit on a business day. */
export function priceOn(orgKey: string, ingKey: string, date: string): number {
  const c = COSTING[orgKey]!;
  let price = c.ingredients.find((i) => i.key === ingKey)!.poishaPerBase;
  for (const change of c.priceChanges)
    if (change.ing === ingKey && change.from <= date) price = change.poishaPerBase;
  return price;
}

/** Recipe cost of one portion on a business day, in poisha — an exact integer by construction. */
export function unitCostOn(orgKey: string, itemKey: string, date: string): number {
  const lines = COSTING[orgKey]!.recipes[itemKey];
  if (!lines) throw new Error(`no recipe for ${orgKey}/${itemKey}`);
  return lines.reduce((sum, l) => {
    const effective = (l.qty * 100) / (l.yieldPct ?? 100);
    if (!Number.isInteger(effective))
      throw new Error(`${itemKey}: ${l.ing} is not a whole base unit`);
    return sum + effective * priceOn(orgKey, l.ing, date);
  }, 0);
}
