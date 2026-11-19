export const PASS_CENTS = 500;
export const FREE_RECIPES = 3;
export const DAILY_PAID_RECIPES = 30;
export function cleanText(value, max = 300) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
export function ingredientList(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.filter(x => typeof x === 'string').map(x => cleanText(x, 70).toLowerCase()).filter(Boolean))].slice(0, 50);
}
export function validPreferences(body = {}) {
  const minutes = [15, 30, 45, 60, 90, 120, 180, 240].includes(Number(body.minutes)) ? Number(body.minutes) : 30;
  return { diet: ['Any', 'Vegetarian', 'Vegan', 'Pescatarian', 'Gluten-free', 'Dairy-free'].includes(body.diet) ? body.diet : 'Any', avoid: cleanText(body.avoid, 300), servings: Math.min(8, Math.max(1, Math.round(Number(body.servings)) || 2)), minutes, includeSlow: minutes > 90 };
}
export function milesBetween(a, b) {
  const rad = n => n * Math.PI / 180;
  const dLat = rad(b.lat-a.lat), dLon = rad(b.lon-a.lon);
  const x = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-Math.min(1,x)));
}
export function farmRows(elements, center, radius) {
  return elements.flatMap(item => {
    const point = item.center || item;
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || !item.tags?.name) return [];
    const distance = milesBetween(center, point);
    if (distance > radius) return [];
    const tags = item.tags;
    let website = null;
    try { const parsed = new URL(tags.website || tags['contact:website']); if (['https:', 'http:'].includes(parsed.protocol)) website = parsed.href; } catch {}
    return [{ id: `${item.type}/${item.id}`, name: tags.name, lat: point.lat, lon: point.lon, miles: Math.round(distance * 10) / 10, type: tags.shop === 'farm' ? 'Farm shop / farm stand' : 'Farmers market', address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(' '), hours: tags.opening_hours || null, produce: tags.produce || tags.products || null, website, source: `https://www.openstreetmap.org/${item.type}/${item.id}`, directions: `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lon}` }];
  }).sort((a,b) => a.miles-b.miles).filter((item,index,array) => array.findIndex(other => other.name.toLowerCase() === item.name.toLowerCase() && milesBetween(other,item) < .1) === index).slice(0,30);
}
const strings = { type: 'array', items: { type: 'string' } };
export const recipeSchema = { type: 'object', additionalProperties: false, required: ['title','description','servings','minutes','ingredients','steps','flavorTip','seasonalTip','shoppingList'], properties: {
  title: { type:'string' }, description:{ type:'string' }, servings:{type:'integer'}, minutes:{type:'integer'},
  ingredients: {type:'array',items:{type:'object',additionalProperties:false,required:['name','quantity','fromPantry'],properties:{name:{type:'string'},quantity:{type:'string'},fromPantry:{type:'boolean'}}}},
  steps:strings, flavorTip:{type:'string'},seasonalTip:{type:'string'},shoppingList:strings
}};

const recipeCardSchema = { ...recipeSchema, required: [...recipeSchema.required, 'collection'], properties: { ...recipeSchema.properties, collection: { type: 'string', enum: ['pantry', 'shopping', 'slow', 'dessert'] } } };
export const recipeCollectionSchema = { type: 'object', additionalProperties: false, required: ['recipes'], properties: { recipes: { type: 'array', items: recipeCardSchema } } };
export const dessertCollectionSchema = { type: 'object', additionalProperties: false, required: ['recipes'], properties: { recipes: { type: 'array', items: recipeCardSchema } } };
export function validateDessertCollection(value) {
  if (!value || !Array.isArray(value.recipes) || value.recipes.length < 3 || value.recipes.length > 4) throw new Error('The dessert collection was incomplete. Please try again.');
  for (const recipe of value.recipes) {
    validateRecipe(recipe);
    if (recipe.collection !== 'dessert') throw new Error('The dessert collection included a non-dessert recipe.');
  }
  return value.recipes;
}
export function validateRecipeCollection(value, options = {}) {
  if (!value || !Array.isArray(value.recipes) || value.recipes.length < 3 || value.recipes.length > 14) throw new Error('The recipe collection was incomplete. Please try again.');
  const counts = { pantry: 0, shopping: 0, slow: 0, dessert: 0 };
  for (const recipe of value.recipes) {
    validateRecipe(recipe);
    if (!Object.hasOwn(counts, recipe.collection)) throw new Error('Invalid recipe collection category.');
    counts[recipe.collection]++;
    if (recipe.collection === 'pantry' && recipe.shoppingList.length > 2) throw new Error('Pantry-friendly recipes must use no more than two extra ingredients.');
    if (recipe.collection === 'shopping' && (recipe.shoppingList.length < 3 || recipe.shoppingList.length > 8)) throw new Error('Shopping recipes need a useful, manageable shopping list.');
    if (recipe.collection === 'slow' && recipe.minutes <= 90) throw new Error('The slow recipe must take longer than 90 minutes.');
  }
  if (counts.pantry < 1 || counts.pantry > 4 || counts.shopping !== 2 || (options.includeSlow !== false ? counts.slow < 1 || counts.slow > 3 : counts.slow !== 0) || (options.includeDesserts !== false ? counts.dessert < 1 || counts.dessert > 3 : counts.dessert !== 0)) throw new Error('The recipe collection did not match the selected categories.');
  return value.recipes;
}

export function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object' || typeof recipe.title !== 'string' || !recipe.title.trim() || recipe.title.length > 180 || !Number.isInteger(recipe.servings) || recipe.servings < 1 || recipe.servings > 8 || !Number.isInteger(recipe.minutes) || recipe.minutes < 1 || recipe.minutes > 240) throw new Error('Recipe response was incomplete. Please try again.');
  for (const field of ['description','flavorTip','seasonalTip']) if (typeof recipe[field] !== 'string' || recipe[field].length > 2500) throw new Error('Invalid recipe details.');
  if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length < 2 || recipe.ingredients.length > 30 || recipe.ingredients.some(i => typeof i.name !== 'string' || typeof i.quantity !== 'string' || typeof i.fromPantry !== 'boolean' || i.name.length > 200 || i.quantity.length > 200)) throw new Error('Invalid ingredient list.');
  if (!Array.isArray(recipe.steps) || recipe.steps.length < 2 || recipe.steps.length > 20 || recipe.steps.some(s => typeof s !== 'string' || s.length > 2500)) throw new Error('Invalid recipe instructions.');
  if (!Array.isArray(recipe.shoppingList) || recipe.shoppingList.length > 30 || recipe.shoppingList.some(s => typeof s !== 'string' || s.length > 300)) throw new Error('Invalid shopping list.');
  return recipe;
}
