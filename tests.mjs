import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { ingredientList, validPreferences, milesBetween, farmRows, validateRecipe, validateRecipeCollection, PASS_CENTS } from './domain.mjs';
import handler, { authenticate, paymentBelongsTo, quota, rawBody, photonFarmElements } from './server.mjs';
import vercelFunction from './api/app.js';

test('pantry input normalizes duplicates and bounds inputs',()=>{
  assert.deepEqual(ingredientList(' Eggs, eggs, potatoes, , cheddar '),['eggs','potatoes','cheddar']);
  assert.equal(ingredientList(Array.from({length:100},(_,i)=>'item'+i)).length,50);
  assert.deepEqual(validPreferences({servings:999,minutes:123,diet:'invented',avoid:'tomato'}),{servings:8,minutes:30,diet:'Any',avoid:'tomato'});
  assert.equal(validPreferences({minutes:180}).minutes,180);
});
test('farm distances use the actual search origin and exclude out-of-radius places',()=>{
  assert.equal(milesBetween({lat:40,lon:-77},{lat:40,lon:-77}),0);
  const rows=farmRows([
    {type:'node',id:1,lat:40.01,lon:-77,tags:{name:'Near Farm',shop:'farm',website:'javascript:alert(1)'}},
    {type:'way',id:2,center:{lat:41,lon:-77},tags:{name:'Far Farm',shop:'farm'}},
    {type:'node',id:3,lat:40,lon:-77,tags:{}},
    {type:'way',id:4,center:{lat:40.01001,lon:-77},tags:{name:'Near Farm',shop:'farm'}}
  ],{lat:40,lon:-77},10);
  assert.equal(rows.length,1);assert.equal(rows[0].name,'Near Farm');assert.equal(rows[0].website,null);assert.ok(rows[0].miles<1);assert.match(rows[0].source,/openstreetmap.org\/node\/1$/);
});
test('Photon fallback keeps named OSM farm shops and relevant markets only',()=>{
  const elements=photonFarmElements([
    {type:'Feature',geometry:{type:'Point',coordinates:[-77.85,40.79]},properties:{name:'Happy Valley Farm',osm_key:'shop',osm_value:'farm',osm_type:'N',osm_id:42,street:'Farm Lane',city:'State College'}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-77.86,40.80]},properties:{name:'State College Farmers Market',osm_key:'amenity',osm_value:'marketplace',osm_type:'W',osm_id:43}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-77.87,40.81]},properties:{name:'Coffee Shop',osm_key:'amenity',osm_value:'cafe',osm_type:'N',osm_id:44}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-77.87,40.81]},properties:{name:'Unnamed Farm',osm_key:'shop',osm_value:'farm',osm_type:'N',osm_id:45}},
    {type:'Feature',geometry:{type:'Point',coordinates:[-77.87,40.81]},properties:{name:'Broken location',osm_key:'shop',osm_value:'farm',osm_type:'N',osm_id:46}}
  ]);
  assert.equal(elements.length,2);
  assert.equal(elements[0].type,'node');
  assert.equal(elements[0].tags.shop,'farm');
  assert.equal(elements[0].tags['addr:city'],'State College');
  assert.equal(elements[1].type,'way');
  assert.equal(elements[1].tags.amenity,'marketplace');
});
test('payment completion is bound to owner, amount, currency and actual paid status',()=>{
  const valid={mode:'payment',client_reference_id:'user-a',metadata:{user_id:'user-a'},amount_total:PASS_CENTS,currency:'usd',payment_status:'paid'};
  assert.equal(paymentBelongsTo(valid,'user-a'),true);
  assert.equal(paymentBelongsTo(valid,'user-b'),false);
  for(const change of [{payment_status:'unpaid'},{currency:'eur'},{amount_total:1},{metadata:{user_id:'user-b'}},{mode:'subscription'}])assert.equal(paymentBelongsTo({...valid,...change},'user-a'),false);
});
test('demo email alone never grants a paid allowance',()=>{
  assert.equal(quota({email:'demo@demo.com',paid:false,is_demo:false}).limit,3);
  assert.equal(quota({paid:true},new Date('2026-11-18T01:00:00Z')).bucket,'recipes:day:2026-11-18');
  assert.equal(quota({is_demo:true}).limit,30);
});
test('incomplete and malformed AI outputs are rejected instead of saved',()=>{
  assert.throws(()=>validateRecipe({title:'Dinner'}));
  const recipe={title:'Lemony beans',description:'Warm beans and greens.',servings:2,minutes:20,ingredients:[{name:'beans',quantity:'1 can',fromPantry:true},{name:'lemon',quantity:'1/2',fromPantry:false}],steps:['Warm the beans.','Add lemon and serve.'],flavorTip:'Brown the beans first.',seasonalTip:'Use local greens when available.',shoppingList:['1 lemon']};
  assert.equal(validateRecipe(recipe),recipe);
  assert.throws(()=>validateRecipe({...recipe,servings:100}));
  assert.throws(()=>validateRecipe({...recipe,steps:['One step']}));
});

test('recipe collections support flexible counts, longer meals, and desserts',()=>{
  const base={title:'A good dinner',description:'A practical, flavorful dish.',servings:2,minutes:35,ingredients:[{name:'beans',quantity:'1 can',fromPantry:true},{name:'onion',quantity:'1',fromPantry:true}],steps:['Cook the onion.','Add beans and finish.'],flavorTip:'Brown the onion well.',seasonalTip:'Use local greens when available.',shoppingList:[]};
  const recipes=[
    {...base,collection:'pantry'},
    {...base,title:'Pantry supper two',collection:'pantry'},
    {...base,title:'Shop dish',collection:'shopping',shoppingList:['1 lemon','fresh parsley','olive oil']},
    {...base,title:'Sunday braise',collection:'slow',minutes:150},
    {...base,title:'Apple crumble',collection:'dessert',minutes:55}
  ];
  assert.equal(validateRecipeCollection({recipes}).length,5);
  assert.throws(()=>validateRecipeCollection({recipes:recipes.map((r,i)=>i===3?{...r,minutes:90}:r)}));
  assert.throws(()=>validateRecipeCollection({recipes:recipes.map((r,i)=>i===0?{...r,shoppingList:['one','two','three']}:r)}));
  assert.throws(()=>validateRecipeCollection({recipes:recipes.filter(r=>r.collection!=='dessert')}));
});
test('raw Stripe webhook bytes retain exact whitespace and body limits apply',async()=>{
  const bytes=Buffer.from('{ "id": "evt_test" }\n');
  assert.deepEqual(await rawBody(Readable.from([bytes])),bytes);
  await assert.rejects(()=>rawBody(Readable.from([Buffer.alloc(100)]),20),e=>e.status===413);
});
test('server rejects unsigned accounts and unsupported methods before touching database',async()=>{
  for(const [method,url,status] of [['GET','/api/app?action=profile',401],['POST','/api/app?action=profile',405],['GET','/api/app?action=missing',404]]){
    const req=Readable.from([]);req.method=method;req.url=url;req.headers={};
    const res={headers:{},setHeader(k,v){this.headers[k]=v},end(value){this.body=JSON.parse(value)}};
    await handler(req,res);assert.equal(res.statusCode,status);assert.ok(res.body.error);
  }
});
test('Vercel web-standard adapter serves JSON and rejects forged webhook signatures',async()=>{
  const health=await vercelFunction.fetch(new Request('http://localhost/api/app?action=health'));
  assert.equal(health.status,200);assert.equal(typeof (await health.json()).ai,'boolean');
  process.env.STRIPE_SECRET_KEY='sk_test_example';process.env.STRIPE_WEBHOOK_SECRET='whsec_example';
  try{
    const result=await vercelFunction.fetch(new Request('http://localhost/api/app?action=webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':'t=1,v1=forged'},body:'{ "id": "evt_fake" }\n'}));
    assert.equal(result.status,400);assert.match((await result.json()).error,/signature/);
  }finally{delete process.env.STRIPE_SECRET_KEY;delete process.env.STRIPE_WEBHOOK_SECRET;}
});
test('signed Neon tokens require trusted key, issuer, audience and an actual user',async()=>{
  const keys=await generateKeyPair('EdDSA'),jwk=await exportJWK(keys.publicKey);jwk.kid='trusted';
  const jwks=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({keys:[jwk]}));});
  await new Promise(resolve=>jwks.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+jwks.address().port;
  process.env.NEON_AUTH_BASE_URL=origin+'/auth';
  const token=async(payload={},issuer=origin,audience=origin,key=keys.privateKey)=>new SignJWT({email:'cook@example.com',name:'Cook',role:'authenticated',...payload}).setProtectedHeader({alg:'EdDSA',kid:'trusted'}).setSubject('user-a').setIssuer(issuer).setAudience(audience).setExpirationTime('5m').sign(key);
  try{
    const user=await authenticate({headers:{authorization:'Bearer '+await token()}});assert.equal(user.id,'user-a');
    for(const invalid of [await token({},'https://attacker.test'),await token({},origin,'wrong-audience'),await token({role:'anonymous'}),await token({banned:true}),await token({email:null})])await assert.rejects(()=>authenticate({headers:{authorization:'Bearer '+invalid}}),e=>e.status===401);
    const attacker=await generateKeyPair('EdDSA');
    await assert.rejects(()=>token({},origin,origin,attacker.privateKey).then(value=>authenticate({headers:{authorization:'Bearer '+value}})),e=>e.status===401);
  }finally{jwks.close();delete process.env.NEON_AUTH_BASE_URL;}
});
