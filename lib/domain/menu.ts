/**
 * The FreshCrate menu: four dietary tracks, eight meals and five add-ons each.
 *
 * Add-on prices are flat by type, so one add-on costs the same wherever it
 * appears. Meals are all MEAL_LIST_PRICE_CENTS ($17.50) and are free as part of
 * a plan, so their price lives in lib/billing/pricing.ts, not here.
 *
 * TAGGING RULE: an item always carries its own track, and carries another track
 * only when nothing in it is excluded by that track. A `standard` item is NEVER
 * tagged into a specialist track, even when it would qualify on ingredients:
 * standard meals are not prepared under gluten-free or dairy-free controls, and
 * telling a coeliac customer otherwise is a claim we cannot stand behind.
 */

export const DIETARY_TRACKS = ["standard", "gluten-free", "vegetarian", "dairy-free"] as const;
export type DietaryTrack = (typeof DIETARY_TRACKS)[number];

export const ADDON_TYPES = ["side", "dessert", "drink"] as const;
export type AddOnType = (typeof ADDON_TYPES)[number];

/** Flat add-on pricing, by type. The only place these numbers live. */
export const ADDON_PRICE_CENTS: Record<AddOnType, number> = {
  side: 499,
  dessert: 599,
  drink: 349,
};

export interface Meal {
  code: string;
  name: string;
  description: string;
  /** The track this meal is offered on. */
  track: DietaryTrack;
  /** Every track this meal satisfies, its own first. */
  tags: DietaryTrack[];
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface AddOn {
  code: string;
  name: string;
  type: AddOnType;
  track: DietaryTrack;
  tags: DietaryTrack[];
  priceCents: number;
  kcal: number;
}

/** Tags are given home-track-first, so tags[0] is the track. */
type Tags = [DietaryTrack, ...DietaryTrack[]];

const M = (
  code: string,
  name: string,
  description: string,
  tags: Tags,
  macros: [number, number, number, number],
): Meal => ({
  code,
  name,
  description,
  track: tags[0],
  tags: [...tags],
  kcal: macros[0],
  protein: macros[1],
  carbs: macros[2],
  fat: macros[3],
});

const A = (code: string, name: string, type: AddOnType, tags: Tags, kcal: number): AddOn => ({
  code,
  name,
  type,
  track: tags[0],
  tags: [...tags],
  priceCents: ADDON_PRICE_CENTS[type],
  kcal,
});

export const MEAL_CATALOGUE: Meal[] = [
  // Standard - no restrictions, and no specialist guarantee.
  M("S1", "Herb Roast Chicken & Garlic Mash", "Half chicken breast, buttery mashed potato, green beans", ["standard"], [620, 48, 42, 28]),
  M("S2", "Beef Lasagne", "Layered pasta, beef ragù, béchamel, mozzarella", ["standard"], [710, 38, 58, 36]),
  M("S3", "Teriyaki Salmon Rice Bowl", "Glazed salmon fillet, jasmine rice, edamame, sesame", ["standard"], [580, 40, 55, 20]),
  M("S4", "Chicken Tikka Masala & Basmati", "Yoghurt-marinated chicken, tomato cream sauce, rice", ["standard"], [660, 42, 62, 26]),
  M("S5", "Beef Smash Burger & Fries", "Two beef patties, cheddar, brioche bun, seasoned fries", ["standard"], [890, 44, 68, 48]),
  M("S6", "Creamy Mushroom Chicken Pasta", "Penne, chicken thigh, cremini mushrooms, parmesan cream", ["standard"], [750, 45, 70, 30]),
  M("S7", "Lamb Kofta & Couscous", "Spiced lamb skewers, herbed couscous, tzatziki", ["standard"], [690, 40, 52, 34]),
  M("S8", "Turkey Meatball Marinara Sub", "Turkey meatballs, marinara, provolone, toasted roll", ["standard"], [640, 38, 60, 26]),

  // Gluten-free. G3 (mash) and G7 (frittata) stay dairy-ambiguous on purpose:
  // both commonly carry butter or milk and the catalogue does not say otherwise.
  M("G1", "Lemon Herb Grilled Chicken & Quinoa", "Chicken breast, quinoa pilaf, roast courgette", ["gluten-free", "dairy-free"], [540, 46, 40, 20]),
  M("G2", "Thai Green Curry with Jasmine Rice", "Chicken, coconut curry, bamboo shoots, basil", ["gluten-free", "dairy-free"], [610, 34, 58, 27]),
  M("G3", "Grilled Salmon & Sweet Potato Mash", "Salmon fillet, sweet potato, tenderstem broccoli", ["gluten-free"], [590, 38, 44, 26]),
  M("G4", "Beef Chilli & Rice Bowl", "Ground beef, kidney beans, tomato, brown rice", ["gluten-free", "dairy-free"], [640, 42, 56, 24]),
  M("G5", "Chicken Shawarma Rice Plate", "Spiced chicken thigh, turmeric rice, tahini, pickles", ["gluten-free", "dairy-free"], [680, 44, 54, 30]),
  M("G6", "Prawn & Chorizo-Free Paella", "Prawns, chicken, saffron rice, peas, peppers", ["gluten-free", "dairy-free"], [570, 36, 62, 16]),
  M("G7", "Turkey & Vegetable Frittata", "Egg bake with turkey, spinach, peppers, side salad", ["gluten-free"], [460, 40, 14, 27]),
  M("G8", "Corn Tortilla Beef Tacos (3)", "Seasoned beef, corn tortillas, salsa, avocado, lime", ["gluten-free", "dairy-free"], [620, 36, 50, 30]),

  // Vegetarian - contains dairy and eggs unless tagged dairy-free.
  M("V1", "Paneer Butter Masala & Basmati", "Paneer, tomato cream sauce, rice, coriander", ["vegetarian", "gluten-free"], [680, 26, 66, 34]),
  M("V2", "Wild Mushroom Risotto", "Arborio rice, mixed mushrooms, parmesan, thyme", ["vegetarian", "gluten-free"], [610, 18, 74, 25]),
  M("V3", "Halloumi & Roast Vegetable Grain Bowl", "Halloumi, farro, peppers, aubergine, pesto", ["vegetarian"], [640, 27, 58, 33]),
  M("V4", "Spinach & Ricotta Cannelloni", "Pasta tubes, ricotta, spinach, napoli sauce, mozzarella", ["vegetarian"], [660, 28, 62, 32]),
  M("V5", "Chickpea & Spinach Curry", "Chana masala, coconut yoghurt, basmati rice", ["vegetarian", "gluten-free", "dairy-free"], [560, 20, 78, 18]),
  M("V6", "Falafel Mezze Plate", "Falafel, hummus, tabbouleh, flatbread, pickled turnip", ["vegetarian", "dairy-free"], [620, 22, 70, 27]),
  M("V7", "Margherita Flatbread & Rocket", "Tomato, buffalo mozzarella, basil, rocket, balsamic", ["vegetarian"], [590, 24, 66, 24]),
  M("V8", "Black Bean & Sweet Corn Burrito Bowl", "Black beans, corn, rice, cheddar, salsa, sour cream", ["vegetarian", "gluten-free"], [630, 23, 80, 22]),

  // Dairy-free. D1/D6 use couscous and freekeh, D4/D7 use soy-based sauces and
  // soba, so none of those carry a gluten-free tag.
  M("D1", "Moroccan Chicken Tagine & Couscous", "Chicken thigh, apricot, chickpeas, warm spices", ["dairy-free"], [620, 44, 58, 22]),
  M("D2", "Coconut Chicken Curry & Rice", "Chicken, coconut milk, lemongrass, jasmine rice", ["dairy-free", "gluten-free"], [650, 40, 60, 27]),
  M("D3", "Grilled Sea Bass & Herb Potatoes", "Sea bass, olive oil potatoes, asparagus, lemon", ["dairy-free", "gluten-free"], [520, 40, 38, 22]),
  M("D4", "Beef Stir-Fry with Rice Noodles", "Beef strips, peppers, broccoli, soy-ginger sauce", ["dairy-free"], [590, 38, 62, 20]),
  M("D5", "Lentil & Vegetable Shepherd's Pie", "Green lentils, root veg, olive oil potato topping", ["dairy-free", "vegetarian", "gluten-free"], [480, 19, 68, 14]),
  M("D6", "Harissa Roast Chicken & Freekeh", "Chicken breast, freekeh, roast carrot, herb oil", ["dairy-free"], [580, 46, 52, 19]),
  M("D7", "Teriyaki Tofu & Soba Noodles", "Firm tofu, soba, pak choi, sesame, spring onion", ["dairy-free", "vegetarian"], [540, 26, 70, 17]),
  M("D8", "Cajun Prawn & Dirty Rice", "Prawns, cajun spice, rice, celery, peppers", ["dairy-free", "gluten-free"], [560, 38, 64, 15]),
];

export const ADDON_CATALOGUE: AddOn[] = [
  A("SA1", "Garlic Parmesan Bread", "side", ["standard"], 280),
  A("SA2", "Caesar Side Salad", "side", ["standard"], 220),
  A("SA3", "Chocolate Fudge Brownie", "dessert", ["standard"], 380),
  A("SA4", "Sparkling Lemonade (330 ml)", "drink", ["standard"], 120),
  A("SA5", "Mango Cheesecake Slice", "dessert", ["standard"], 420),

  A("GA1", "Rosemary Sweet Potato Fries", "side", ["gluten-free", "dairy-free", "vegetarian"], 300),
  A("GA2", "Greek Salad with Feta", "side", ["gluten-free", "vegetarian"], 250),
  A("GA3", "Flourless Chocolate Torte", "dessert", ["gluten-free", "vegetarian"], 350),
  A("GA4", "Cold-Pressed Green Juice (330 ml)", "drink", ["gluten-free", "dairy-free", "vegetarian"], 110),
  A("GA5", "Coconut Rice Pudding", "dessert", ["gluten-free", "dairy-free", "vegetarian"], 320),

  A("VA1", "Truffle Mac & Cheese Cup", "side", ["vegetarian"], 400),
  A("VA2", "Roasted Beet & Goat Cheese Salad", "side", ["vegetarian", "gluten-free"], 260),
  A("VA3", "Tiramisu-Style Coffee Cream Pot", "dessert", ["vegetarian"], 360),
  A("VA4", "Mango Lassi (300 ml)", "drink", ["vegetarian", "gluten-free"], 220),
  A("VA5", "Warm Apple Crumble & Custard", "dessert", ["vegetarian"], 420),

  A("DA1", "Rosemary Sea Salt Potato Wedges", "side", ["dairy-free", "vegetarian", "gluten-free"], 290),
  A("DA2", "Miso Glazed Aubergine", "side", ["dairy-free", "vegetarian"], 210),
  A("DA3", "Dark Chocolate & Almond Bark", "dessert", ["dairy-free", "vegetarian", "gluten-free"], 300),
  A("DA4", "Iced Oat Matcha Latte (350 ml)", "drink", ["dairy-free", "vegetarian"], 180),
  A("DA5", "Coconut Sorbet with Passionfruit", "dessert", ["dairy-free", "vegetarian", "gluten-free"], 240),
];

export function mealsForTrack(track: DietaryTrack): Meal[] {
  return MEAL_CATALOGUE.filter((m) => m.track === track);
}

export function addOnsForTrack(track: DietaryTrack): AddOn[] {
  return ADDON_CATALOGUE.filter((a) => a.track === track);
}

/** Look a meal up by the exact name stored on an order's `items`. */
export function mealByName(name: string): Meal | undefined {
  return MEAL_CATALOGUE.find((m) => m.name === name);
}

export function isDietaryTrack(value: unknown): value is DietaryTrack {
  return typeof value === "string" && (DIETARY_TRACKS as readonly string[]).includes(value);
}
