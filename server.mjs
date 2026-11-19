import { randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import Stripe from 'stripe';
import { sql, ensureSchema, ensureProfile } from './db.mjs';
import { PASS_CENTS, FREE_RECIPES, DAILY_PAID_RECIPES, cleanText, ingredientList, validPreferences, recipeSchema, recipeCollectionSchema, validateRecipeCollection, farmRows } from './domain.mjs';

const APP_URL = process.env.APP_URL || 'https://plantedandplates.vercel.app';
let keySet, stripeClient;
export class HttpError extends Error { constructor(status,message,code='REQUEST_FAILED'){super(message);this.status=status;this.code=code;} }
function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new HttpError(503,'Checkout is temporarily unavailable. Please try again later.','PAYMENTS_NOT_CONFIGURED');
  return stripeClient ||= new Stripe(process.env.STRIPE_SECRET_KEY);
}
export async function authenticate(req) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!token || token.length > 12000) throw new HttpError(401,'Please log in to use your kitchen.','LOGIN_REQUIRED');
  const base = (process.env.NEON_AUTH_BASE_URL || process.env.VITE_NEON_AUTH_URL || '').replace(/\/$/,'');
  if (!base) throw new HttpError(503,'Account service is temporarily unavailable.','AUTH_NOT_CONFIGURED');
  try {
    const origin = new URL(base).origin;
    keySet ||= createRemoteJWKSet(new URL(base+'/.well-known/jwks.json'),{timeoutDuration:8000});
    const { payload } = await jwtVerify(token,keySet,{issuer:origin,audience:origin,algorithms:['EdDSA']});
    if (!payload.sub || typeof payload.email !== 'string' || payload.role === 'anonymous' || payload.banned) throw new Error('Not an account');
    return { id:payload.sub,email:payload.email,name:cleanText(payload.name,100) };
  } catch { throw new HttpError(401,'Your session has expired. Please log in again.','LOGIN_REQUIRED'); }
}
export async function rawBody(req,limit=100000) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks=[];let length=0;
  for await (const chunk of req) { length+=chunk.length; if(length>limit) throw new HttpError(413,'That request is too large.'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function body(req) {
  if (req.body && typeof req.body==='object' && !Buffer.isBuffer(req.body)) {
    if(JSON.stringify(req.body).length>100000) throw new HttpError(413,'That request is too large.');
    return req.body;
  }
  try { const data=await rawBody(req);return data.length?JSON.parse(data.toString()):{}; }
  catch(e){if(e.status)throw e;throw new HttpError(400,'Please check the information you entered.');}
}
async function reserve(userId,bucket,limit) {
  const db=sql();
  const rows=await db`INSERT INTO pp_usage(user_id,bucket,calls) VALUES (${userId},${bucket},1) ON CONFLICT(user_id,bucket) DO UPDATE SET calls=pp_usage.calls+1 WHERE pp_usage.calls<${limit} RETURNING calls`;
  if(!rows.length) throw new HttpError(429,'You’ve reached the limit for this feature. Please try again later.','USAGE_LIMIT');
}
async function release(userId,bucket) { const db=sql(); await db`UPDATE pp_usage SET calls=GREATEST(calls-1,0) WHERE user_id=${userId} AND bucket=${bucket}`; }
export function quota(profile,now=new Date()) {
  return profile.paid || profile.is_demo ? {bucket:'recipes:day:'+now.toISOString().slice(0,10),limit:DAILY_PAID_RECIPES} : {bucket:'recipes:free',limit:FREE_RECIPES};
}
async function profileData(profile) {
  const db=sql(), q=quota(profile);
  const usage=await db`SELECT calls FROM pp_usage WHERE user_id=${profile.user_id} AND bucket=${q.bucket}`;
  return {name:profile.name,email:profile.email,paid:profile.paid || profile.is_demo,demo:profile.is_demo,pantry:profile.pantry,preferences:profile.preferences,remaining:Math.max(0,q.limit-(usage[0]?.calls||0)),limit:q.limit};
}
async function createRecipe(user,profile,data) {
  if(!process.env.OPENAI_API_KEY) throw new HttpError(503,'The recipe kitchen is temporarily unavailable. Please try again later.','AI_NOT_CONFIGURED');
  const pantry=ingredientList(data.ingredients);
  if(!pantry.length) throw new HttpError(400,'Add at least one ingredient to start cooking.');
  const preferences=validPreferences(data),q=quota(profile),db=sql();
  try {await reserve(user.id,q.bucket,q.limit);}catch(e){if(e.code==='USAGE_LIMIT' && !profile.paid && !profile.is_demo)throw new HttpError(402,'You’ve used your three free recipes. A Kitchen Pass opens up more cooking.','UPGRADE_REQUIRED');throw e;}
  let stored=false;
  try {
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.OPENAI_API_KEY},signal:AbortSignal.timeout(40000),
      body:JSON.stringify({model:process.env.OPENAI_MODEL || 'gpt-4.1-mini',store:false,max_output_tokens:14000,
        instructions:'You are the experienced home cook behind Planted & Plated. Create a varied collection of 4 to 14 distinct, practical recipes, using four categories. Include 1 to 4 pantry recipes (collection=pantry): build around supplied ingredients and require no more than two additional shopping-list ingredients each. Include exactly 2 shopping recipes (collection=shopping): appealing dishes using the pantry plus three to eight worthwhile ingredients to buy. Include 1 to 3 longer recipes (collection=slow): more involved meals taking 91 to 240 minutes total, suitable for a relaxed weekend. Include 1 to 3 desserts (collection=dessert): genuinely varied sweet finishes, baking projects or simple treats; clearly mark all missing ingredients. Keep every recipe distinct and useful, not minor variations. Respect all dietary preferences and exclusions, scale exact quantities for requested servings, and never assume unlisted ingredients are in the pantry. The preferred time in the input applies to pantry and shopping recipes; longer recipes intentionally exceed 90 minutes. Desserts may be quick or involved and should show their actual total time. Mark every ingredient not supplied in the pantry as fromPantry=false, including oil, salt and spices unless listed. shoppingList must contain missing items with quantities. Give exact, realistic prep and cooking steps, temperatures and doneness cues. Flavor should come from good technique, balance and texture. Include a useful flavor tip. Seasonal advice must be conditional on local season, not invented availability. Never invent farms or claim any farm stocks an item. Keep recipes realistic and food-safe. No medical, nutritional, allergy-free or tested-recipe guarantees. Return only the specified JSON object.',
        input:JSON.stringify({pantry,...preferences,request:cleanText(data.request,500),location:cleanText(data.location,160),month:new Date().toLocaleString('en-US',{month:'long'})}),
        text:{format:{type:'json_schema',name:'farm_to_table_recipe_collection',strict:true,schema:recipeCollectionSchema}}
      })
    });
    if(!response.ok) throw new HttpError(502,'The recipe service couldn’t finish that meal. Please try again.','AI_PROVIDER_ERROR');
    const result=await response.json();
    if(result.status==='incomplete') throw new Error('Incomplete model output');
    const text=result.output?.flatMap(item=>item.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
    const collection=validateRecipeCollection(JSON.parse(text));
    const createdAt=new Date().toISOString();
    const records=collection.map(recipe=>({id:randomUUID(),recipe,saved:false,created_at:createdAt}));
    await db.transaction(records.map(record=>db`INSERT INTO pp_recipes(id,user_id,recipe) VALUES (${record.id},${user.id},${JSON.stringify(record.recipe)}::jsonb)`));
    stored=true;
    return records;
  } finally {if(!stored) await release(user.id,q.bucket).catch(()=>{});}
}
async function cached(key) {const db=sql();const rows=await db`SELECT value FROM pp_cache WHERE key=${key} AND expires_at>now()`;return rows[0]?.value;}
async function cache(key,value,seconds) {const db=sql();await db`INSERT INTO pp_cache(key,value,expires_at) VALUES (${key},${JSON.stringify(value)}::jsonb,now()+(${seconds}*interval '1 second')) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,expires_at=EXCLUDED.expires_at`;}
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter'
];

// Query a small batch at a time: one slow public mirror must not hold up the
// whole farm finder, and we avoid sending the same OSM query to every mirror.
async function fetchFarmData(query) {
  const failures = [];
  const batchSize = 2;
  for (let offset = 0; offset < OVERPASS_ENDPOINTS.length; offset += batchSize) {
    const batch = OVERPASS_ENDPOINTS.slice(offset, offset + batchSize);
    const controllers = batch.map(() => new AbortController());
    const attempts = batch.map(async (endpoint, index) => {
      const host = new URL(endpoint).host;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'PlantedAndPlated/1.0 (' + APP_URL + ')'
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.any([controllers[index].signal, AbortSignal.timeout(9000)])
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const result = await response.json();
        if (result.remark) throw new Error('query rejected: ' + String(result.remark).slice(0, 180));
        if (!Array.isArray(result.elements)) throw new Error('invalid response');
        return result;
      } catch (error) {
        const reason = error.name === 'TimeoutError' ? 'timed out after 9s' :
          error.name === 'AbortError' ? 'cancelled after another provider responded' :
          String(error.message || error.name || 'request failed').slice(0, 220);
        failures.push(host + ': ' + reason);
        throw error;
      }
    });
    try {
      const result = await Promise.any(attempts);
      controllers.forEach(controller => controller.abort());
      await Promise.allSettled(attempts);
      return result;
    } catch {
      await Promise.allSettled(attempts);
    }
  }
  console.error('All farm map providers failed', { failures, providerCount: OVERPASS_ENDPOINTS.length });
  throw new HttpError(502, 'The farm map providers are unavailable right now. Please try again shortly.', 'FARM_SEARCH_UNAVAILABLE');
}
// Convert Photon search results into the same OSM element shape used by farmRows.
export function photonFarmElements(features) {
  return (Array.isArray(features) ? features : []).flatMap(feature => {
    const properties = feature?.properties || {};
    const coordinates = feature?.geometry?.coordinates;
    const name = cleanText(properties.name, 160);
    const [lon, lat] = Array.isArray(coordinates) ? coordinates : [];
    const isFarmShop = properties.osm_key === 'shop' && properties.osm_value === 'farm';
    const isFarmMarket = properties.osm_key === 'amenity' && properties.osm_value === 'marketplace' && /farm|grower|market/i.test(name);
    const rawType = properties.osm_type;
    const type = rawType === 'N' ? 'node' : rawType === 'W' ? 'way' : rawType === 'R' ? 'relation' : rawType;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || !properties.osm_id || !['node','way','relation'].includes(type) || (!isFarmShop && !isFarmMarket)) return [];
    const tags = {
      name,
      ...(isFarmShop ? { shop: 'farm' } : { amenity: 'marketplace' }),
      website: properties.website,
      opening_hours: properties.opening_hours,
      'addr:street': properties.street,
      'addr:city': properties.city,
      'addr:postcode': properties.postcode
    };
    return [{ type, id: properties.osm_id, lat, lon, tags }];
  });
}

// Photon is a separate OpenStreetMap-backed search service, used when public
// Overpass mirrors reject or time out on requests from serverless deployments.
async function fetchPhotonFarmData(center) {
  const terms = ['farm', 'farmers market', 'farm shop'];
  const responses = await Promise.allSettled(terms.map(async term => {
    const params = new URLSearchParams({ q: term, lat: String(center.lat), lon: String(center.lon), limit: '25', lang: 'en' });
    const response = await fetch('https://photon.komoot.io/api/?' + params, {
      headers: { 'User-Agent': 'PlantedAndPlated/1.0 (' + APP_URL + ')', 'Accept': 'application/geo+json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('Photon HTTP ' + response.status);
    const data = await response.json();
    if (!Array.isArray(data.features)) throw new Error('Photon returned an invalid feature collection');
    return data.features;
  }));
  const successful = responses.filter(result => result.status === 'fulfilled');
  if (!successful.length) {
    console.error('Photon farm search fallback failed', { failures: responses.map(result => String(result.reason?.message || 'request failed').slice(0, 160)) });
    throw new HttpError(502, 'Local farm search providers are temporarily unavailable. Please try again shortly.', 'FARM_SEARCH_UNAVAILABLE');
  }
  return successful.flatMap(result => result.value);
}

async function farmSearch(user,data) {
  const location=cleanText(data.location,160),radius=Number(data.radius);
  if(!location || ![10,25,50,100].includes(radius)) throw new HttpError(400,'Enter a city and state or ZIP code, and choose a search distance.');
  await reserve(user.id,'farms:'+new Date().toISOString().slice(0,13),30);
  const geoKey='geo:'+location.toLowerCase();let center=await cached(geoKey);
  if(!center){
    const db=sql();
    const gate=await db`INSERT INTO pp_service_limits(key,next_at) VALUES ('geocode',now()+interval '1 second') ON CONFLICT(key) DO UPDATE SET next_at=now()+interval '1 second' WHERE pp_service_limits.next_at<=now() RETURNING key`;
    if(!gate.length)throw new HttpError(429,'The location finder is busy. Please try again in a few seconds.');
    const params=new URLSearchParams({q:location,format:'jsonv2',limit:'1',addressdetails:'1'});
    const response=await fetch('https://nominatim.openstreetmap.org/search?'+params,{headers:{'User-Agent':'PlantedAndPlated/1.0 ('+APP_URL+')','Accept-Language':'en'},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new HttpError(502,'We couldn’t look up that location. Please try again.');
    const places=await response.json();
    if(!places.length)throw new HttpError(404,'Location not found. Try including your state or country.');
    center={lat:Number(places[0].lat),lon:Number(places[0].lon),name:places[0].display_name};
    if(!Number.isFinite(center.lat)||!Number.isFinite(center.lon))throw new HttpError(502,'That location could not be resolved.');
    await cache(geoKey,center,604800);
  }
  const searchKey=`farms:${center.lat.toFixed(4)}:${center.lon.toFixed(4)}:${radius}`;
  const prior=await cached(searchKey);if(prior)return prior;
  const around=`around:${Math.ceil(radius*1609.344)},${center.lat},${center.lon}`;
  const query=`[out:json][timeout:22];(nwr(${around})["shop"="farm"];nwr(${around})["amenity"="marketplace"]["name"~"farm|grower",i];);out center tags;`;
  let result, source='OpenStreetMap contributors';
  try {
    result=await fetchFarmData(query);
  } catch (error) {
    console.warn('Overpass farm search unavailable; trying Photon fallback', { code: error.code || 'OVERPASS_UNAVAILABLE' });
    const features=await fetchPhotonFarmData(center);
    result={elements:photonFarmElements(features)};
    source='OpenStreetMap contributors (Photon fallback)';
  }
  const answer={center,radius,farms:farmRows(result.elements||[],center,radius),checkedAt:new Date().toISOString(),source,note:'Distances are straight-line miles. Community listings may be incomplete; check current opening hours and produce with each farm.'};
  await cache(searchKey,answer,86400);return answer;
}
export function paymentBelongsTo(session,userId) {return session.mode==='payment' && session.client_reference_id===userId && session.metadata?.user_id===userId && session.amount_total===PASS_CENTS && session.currency==='usd' && session.payment_status==='paid';}
async function syncPayment(session,userId) {
  if(!paymentBelongsTo(session,userId))throw new HttpError(400,'This checkout has not completed for your account.','PAYMENT_NOT_COMPLETE');
  const intent=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
  if(!intent)throw new HttpError(400,'Payment confirmation is not ready. Please try again.');
  const charge=typeof session.payment_intent==='object'?session.payment_intent?.latest_charge:null;
  const db=sql();
  if(charge && typeof charge==='object' && charge.refunded)await db`INSERT INTO pp_refunds(payment_intent) VALUES (${intent}) ON CONFLICT DO NOTHING`;
  await db.transaction([
    db`INSERT INTO pp_payments(session_id,user_id,payment_intent) VALUES (${session.id},${userId},${intent}) ON CONFLICT(session_id) DO NOTHING`,
    db`UPDATE pp_profiles SET paid=is_demo OR EXISTS(SELECT 1 FROM pp_payments p WHERE p.user_id=pp_profiles.user_id AND NOT EXISTS(SELECT 1 FROM pp_refunds r WHERE r.payment_intent=p.payment_intent)) WHERE user_id=${userId}`
  ]);
}
async function webhook(req) {
  if(!process.env.STRIPE_WEBHOOK_SECRET)throw new HttpError(503,'Payment updates are not connected yet.');
  if(!req.headers['stripe-signature'])throw new HttpError(400,'Missing payment signature.');
  let event;
  try {event=stripe().webhooks.constructEvent(await rawBody(req,1000000),req.headers['stripe-signature'],process.env.STRIPE_WEBHOOK_SECRET);}catch{throw new HttpError(400,'Invalid payment signature.');}
  await ensureSchema();const db=sql();
  if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)){
    const session=event.data.object;
    if(session.payment_status==='paid' && session.metadata?.user_id){
      const owner=await db`SELECT user_id FROM pp_profiles WHERE user_id=${session.metadata.user_id}`;
      if(owner.length) await syncPayment(session,owner[0].user_id);
    }
  }
  if(event.type==='charge.refunded'){
    const charge=event.data.object;
    if(charge.payment_intent && charge.amount_refunded>=charge.amount){
      await db.transaction([
        db`INSERT INTO pp_refunds(payment_intent) VALUES (${charge.payment_intent}) ON CONFLICT DO NOTHING`,
        db`UPDATE pp_profiles SET paid=is_demo OR EXISTS(SELECT 1 FROM pp_payments p WHERE p.user_id=pp_profiles.user_id AND NOT EXISTS(SELECT 1 FROM pp_refunds r WHERE r.payment_intent=p.payment_intent)) WHERE user_id IN(SELECT user_id FROM pp_payments WHERE payment_intent=${charge.payment_intent})`
      ]);
    }
  }
  return {received:true};
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
  try {
    const url=new URL(req.url,APP_URL),action=url.searchParams.get('action')||'profile';
    const methods={health:['GET'],webhook:['POST'],profile:['GET'],pantry:['PUT'],generate:['POST'],recipes:['GET','PATCH','DELETE'],farms:['POST'],checkout:['POST'],confirm:['POST']};
    if(!methods[action])throw new HttpError(404,'That kitchen feature could not be found.');
    if(!methods[action].includes(req.method)){res.setHeader('Allow',methods[action].join(', '));throw new HttpError(405,'That action is not supported.');}
    if(action==='health'){res.statusCode=200;res.end(JSON.stringify({ai:!!process.env.OPENAI_API_KEY,payments:!!process.env.STRIPE_SECRET_KEY,webhook:!!process.env.STRIPE_WEBHOOK_SECRET,database:!!(process.env.DATABASE_URL||process.env.POSTGRES_URL)}));return;}
    if(action==='webhook'){res.statusCode=200;res.end(JSON.stringify(await webhook(req)));return;}
    if(req.headers.origin && ![new URL(APP_URL).origin,`https://${process.env.VERCEL_URL}`,`http://localhost:5173`].includes(req.headers.origin))throw new HttpError(403,'This request is not allowed.');
    const user=await authenticate(req),profile=await ensureProfile(user),db=sql();
    let output;
    if(action==='profile')output=await profileData(profile);
    if(action==='pantry'){
      const data=await body(req),pantry=ingredientList(data.pantry),preferences=validPreferences(data.preferences);
      await db`UPDATE pp_profiles SET pantry=${JSON.stringify(pantry)}::jsonb,preferences=${JSON.stringify(preferences)}::jsonb WHERE user_id=${user.id}`;
      output={pantry,preferences};
    }
    if(action==='generate')output=await createRecipe(user,profile,await body(req));
    if(action==='recipes'){
      if(req.method==='GET')output=await db`SELECT id,recipe,saved,created_at FROM pp_recipes WHERE user_id=${user.id} ORDER BY created_at DESC LIMIT 150`;
      else{
        const data=await body(req);if(!/^[0-9a-f-]{36}$/i.test(data.id||''))throw new HttpError(400,'Choose a recipe from your recipe box.');
        const rows=req.method==='DELETE'?await db`DELETE FROM pp_recipes WHERE id=${data.id} AND user_id=${user.id} RETURNING id`:await db`UPDATE pp_recipes SET saved=${data.saved===true} WHERE id=${data.id} AND user_id=${user.id} RETURNING id,saved`;
        if(!rows.length)throw new HttpError(404,'That recipe is not in your recipe box.');output=rows[0];
      }
    }
    if(action==='farms')output=await farmSearch(user,await body(req));
    if(action==='checkout'){
      if(profile.paid||profile.is_demo)throw new HttpError(409,'Your Kitchen Pass is already active.');
      await reserve(user.id,'checkout:'+new Date().toISOString().slice(0,13),8);
      const session=await stripe().checkout.sessions.create({mode:'payment',client_reference_id:user.id,customer_email:user.email,metadata:{user_id:user.id},line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:PASS_CENTS,product_data:{name:'Planted & Plated — Founding Kitchen Pass',description:'One-time access to 30 AI recipes per day, saved recipes, pantry and local farm search.'}}}],success_url:APP_URL+'/kitchen.html?checkout=success&session_id={CHECKOUT_SESSION_ID}',cancel_url:APP_URL+'/kitchen.html?checkout=cancelled#pass'});
      output={url:session.url};
    }
    if(action==='confirm'){
      const data=await body(req);if(!/^cs_[a-zA-Z0-9_]+$/.test(data.sessionId||''))throw new HttpError(400,'Invalid checkout reference.');
      const session=await stripe().checkout.sessions.retrieve(data.sessionId,{expand:['payment_intent.latest_charge']});
      await syncPayment(session,user.id);const rows=await db`SELECT * FROM pp_profiles WHERE user_id=${user.id}`;output=await profileData(rows[0]);
    }
    res.statusCode=200;res.end(JSON.stringify(output));
  }catch(error){
    const status=error.status||500;res.statusCode=status;
    if(status>=500)console.error('Kitchen request failed',{code:error.code||error.name,status});
    res.end(JSON.stringify({error:status<500||error.status?error.message:'The kitchen is temporarily unavailable. Please try again.',code:error.code||'SERVICE_ERROR'}));
  }
}
