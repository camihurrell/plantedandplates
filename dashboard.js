import { authReady, getUser, getToken, openAuth } from './auth.js';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params=new URLSearchParams(location.search);
let accountId=null,profile=null,recipes=[],activeRecipe=null,loadingAccount=false,farmMapInstance=null;
function note(text){$('#app-message').textContent=text;$('#app-message').hidden=!text;}
async function api(action,method='GET',data){
  const owner=getUser()?.id;
  const token=await getToken();
  const response=await fetch('/api/app?action='+action,{method,headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(action==='generate'?55000:45000)});
  const result=await response.json();
  if(owner!==getUser()?.id)throw new Error('Your account changed. Please try again.');
  if(!response.ok){if(result.code==='LOGIN_REQUIRED')openAuth('login');if(result.code==='UPGRADE_REQUIRED')switchTab('pass');throw new Error(result.error||'Something went wrong. Please try again.');}
  return result;
}
function switchTab(tab){
  if(!['cook','pantry','recipes','farms','pass'].includes(tab))tab='cook';
  document.querySelectorAll('.tab-panel').forEach(panel=>panel.hidden=panel.id!=='panel-'+tab);
  document.querySelectorAll('[data-tab]').forEach(link=>{link.classList.toggle('active',link.dataset.tab===tab);if(link.dataset.tab===tab)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  if(location.hash!=='#'+tab)history.replaceState(null,'',location.pathname+location.search+'#'+tab);
}
window.addEventListener('hashchange',()=>switchTab(location.hash.slice(1)));
document.querySelectorAll('[data-tab]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();switchTab(link.dataset.tab);}));
switchTab(params.get('tab')||location.hash.slice(1)||'cook');

function paintProfile(){
  $('#welcome').textContent=profile.name?`Welcome to your kitchen, ${profile.name.split(' ')[0]}.`:'Welcome to your kitchen.';
  $('#plan-label').textContent=profile.demo?'Demo Kitchen · Full access':profile.paid?'Kitchen Pass':'Free kitchen';
  $('#demo-notice').hidden=!profile.demo;
  $('#recipe-allowance').textContent=profile.paid?`${profile.remaining} of ${profile.limit} recipes left today. Resets at midnight UTC.`:`${profile.remaining} of ${profile.limit} free recipes remaining.`;
  $('#checkout-button').disabled=profile.paid;
  $('#checkout-button').textContent=profile.paid?'Your Kitchen Pass is active ✓':'Get my Kitchen Pass →';
  $('#pass-status').textContent=profile.demo?'Full paid access is included in this demo account.':profile.paid?'You’re all set. Make yourself at home.':'Secure checkout with Stripe. $5, paid once.';
}
function paintPantry(){
  $('#pantry-count').textContent=profile.pantry.length;
  $('#pantry-chips').replaceChildren(...profile.pantry.map(item=>{const chip=document.createElement('span');chip.textContent=item;return chip;}));
}
async function loadAccount(user){
  if(!user){accountId=null;profile=null;recipes=[];activeRecipe=null;$('#account-gate').hidden=false;$('#kitchen-app').hidden=false;$('#welcome').textContent='Your next good meal starts here.';$('#plan-label').textContent='Explore your kitchen';$('#generated-recipe').replaceChildren();$('#recipe-box').replaceChildren();$('#farm-list').replaceChildren();$('#farm-map').replaceChildren();$('#pantry-items').value='';$('#cook-ingredients').value=params.get('ingredients')||'';$('#farm-location').value=params.get('location')||'';$('#cook-avoid').value='';$('#cook-request').value='';$('#cook-diet').value='Any';$('#cook-servings').value='2';$('#cook-minutes').value='30';$('#pantry-chips').replaceChildren();$('#pantry-status').textContent='';$('#farm-status').textContent='';$('#recipe-allowance').textContent='Create an account for your three free recipes.';$('#demo-notice').hidden=true;$('#checkout-button').disabled=false;$('#checkout-button').textContent='Get my Kitchen Pass →';paintRecipes();note('');return;}
  if(accountId===user.id || loadingAccount)return;
  loadingAccount=true;accountId=user.id;$('#account-gate').hidden=true;$('#kitchen-app').hidden=false;note('Opening your kitchen…');
  try{
    profile=await api('profile');
    paintProfile();paintPantry();
    $('#pantry-items').value=profile.pantry.join(', ');
    $('#cook-ingredients').value=params.get('ingredients')||profile.pantry.join(', ');
    $('#farm-location').value=params.get('location')||'';
    if(['10','25','50','100'].includes(params.get('radius')))$('#farm-radius').value=params.get('radius');
    for(const [key,selector] of Object.entries({diet:'#cook-diet',servings:'#cook-servings',minutes:'#cook-minutes',avoid:'#cook-avoid'})){if(profile.preferences[key])$(selector).value=profile.preferences[key];}
    recipes=await api('recipes');paintRecipes();note('');
    if(params.get('checkout')==='success'&&params.get('session_id')){
      note('Confirming your payment with Stripe…');
      profile=await api('confirm','POST',{sessionId:params.get('session_id')});paintProfile();note(profile.paid?'Your Kitchen Pass is active. Let’s make something good.':'Your payment has been refunded.');
      history.replaceState(null,'',location.pathname+'#pass');switchTab('pass');
    }else if(params.get('checkout')==='cancelled'){note('Checkout was cancelled. Your free kitchen is still here.');}
  }catch(error){accountId=null;note(error.message);}
  finally{loadingAccount=false;}
}
window.addEventListener('kitchen-auth',event=>loadAccount(event.detail));
loadAccount(null);
authReady.then(()=>loadAccount(getUser()));

function preferences(){return {diet:$('#cook-diet').value,servings:Number($('#cook-servings').value),minutes:Number($('#cook-minutes').value),avoid:$('#cook-avoid').value};}
$('#pantry-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.submitter;button.disabled=true;$('#pantry-status').textContent='Saving your cupboard…';
  try{const result=await api('pantry','PUT',{pantry:$('#pantry-items').value,preferences:preferences()});profile.pantry=result.pantry;profile.preferences=result.preferences;paintPantry();$('#pantry-status').textContent='Saved to your account.';}
  catch(error){$('#pantry-status').textContent=error.message;}finally{button.disabled=false;}
});
$('#cook-from-pantry').addEventListener('click',()=>{$('#cook-ingredients').value=$('#pantry-items').value;switchTab('cook');$('#cook-ingredients').focus();});
document.querySelectorAll('[data-pantry-example]').forEach(button=>button.addEventListener('click',()=>{$('#cook-ingredients').value=button.dataset.pantryExample;$('#cook-ingredients').focus();}));
$('#cook-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('#generate-button');button.disabled=true;button.textContent='Putting a good meal together…';note('');
  try{
    const records=await api('generate','POST',{ingredients:$('#cook-ingredients').value,...preferences(),request:$('#cook-request').value,location:$('#farm-location').value});
    activeRecipe=records;recipes.unshift(...records);paintRecipes();paintActive();
    $('#generated-recipe').scrollIntoView({behavior:'smooth',block:'start'});
    profile=await api('profile');paintProfile();
  }catch(error){note(error.name==='TimeoutError'?'This recipe is taking longer than expected. Check your recipe box before trying again.':error.message);}
  finally{button.disabled=false;button.textContent='Make something delicious →';}
});
function recipeMarkup(record,modal=false){
  const r=record.recipe;
  return `<article class="recipe-sheet"><div class="recipe-sheet-top"><span class="eyebrow">FROM YOUR EVERYDAY KITCHEN</span><span class="recipe-meta">${r.minutes} minutes · Serves ${r.servings}</span></div><h2 ${modal?'id="detail-title"':''}>${esc(r.title)}</h2><p class="recipe-description">${esc(r.description)}</p><div class="recipe-toolbar"><button class="btn" data-action="save" data-id="${esc(record.id)}">${record.saved?'♥ Saved to your recipe box':'♡ Save this recipe'}</button><button class="btn light" data-action="print" data-id="${esc(record.id)}">Print recipe</button></div><div class="recipe-body"><div><h3>What you’ll need</h3><ul class="ingredient-list">${r.ingredients.map(i=>`<li><span><strong>${esc(i.quantity)}</strong> ${esc(i.name)}</span><small>${i.fromPantry?'In your pantry':'Pick up'}</small></li>`).join('')}</ul><div class="shopping-note"><h3>A small shopping list</h3>${r.shoppingList.length?`<ul>${r.shoppingList.map(i=>`<li>${esc(i)}</li>`).join('')}</ul><button class="btn light" data-action="copy" data-id="${esc(record.id)}">Copy shopping list</button>`:'<p>You have everything listed.</p>'}<p><a href="#farms" data-find-local>Find fresh additions nearby ↗</a></p></div></div><div><h3>Let’s cook</h3><ol class="cooking-steps">${r.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol><div class="flavor-note"><span class="eyebrow">MAKE IT REALLY GOOD</span><p>${esc(r.flavorTip)}</p></div><p class="seasonal-note"><strong>A farm-to-table thought</strong><br>${esc(r.seasonalTip)}</p></div></div><p class="small-note">AI-generated recipe. Check ingredients and adjust seasoning to your taste.</p></article>`;
}
function paintActive(){if(!Array.isArray(activeRecipe)||!activeRecipe.length)return;const groups=[{key:'pantry',title:'Cook with what you have',description:'Two ideas using your ingredients, with no more than two extras to pick up.'},{key:'shopping',title:'Worth a little shopping',description:'Two dishes with a few more ingredients to bring home.'},{key:'slow',title:'Take your time',description:'A longer weekend-style recipe, with a cook time over 1½ hours.'}];$('#generated-recipe').innerHTML=groups.map(group=>{const cards=activeRecipe.filter(record=>record.recipe.collection===group.key);return cards.length?'<section class="recipe-group"><div class="recipe-group-heading"><span class="eyebrow">'+group.key.toUpperCase()+'</span><h2>'+group.title+'</h2><p>'+group.description+'</p></div>'+cards.map(record=>recipeMarkup(record)).join('')+'</section>':'';}).join('');}
function paintRecipes(){
  const query=$('#recipe-search').value.trim().toLowerCase(),onlySaved=$('#saved-only').checked;
  const filtered=recipes.filter(record=>(!onlySaved||record.saved)&&(!query||[record.recipe.title,...record.recipe.ingredients.map(i=>i.name)].join(' ').toLowerCase().includes(query)));
  $('#recipe-box').innerHTML=filtered.length?filtered.map((record,index)=>`<article class="box-card"><span class="chapter-number">${String(index+1).padStart(2,'0')} / ${record.saved?'FAVORITE':'FROM YOUR KITCHEN'}</span><h3><button class="recipe-title" data-action="open" data-id="${esc(record.id)}">${esc(record.recipe.title)}</button></h3><p>${esc(record.recipe.description)}</p><div class="box-bottom"><span>${record.recipe.minutes} min · Serves ${record.recipe.servings}</span><button class="favorite-button" data-action="save" data-id="${esc(record.id)}" aria-label="${record.saved?'Unsave':'Save'} ${esc(record.recipe.title)}">${record.saved?'♥':'♡'}</button></div></article>`).join(''):`<div class="empty-state"><span class="eyebrow">ROOM FOR SOMETHING GOOD</span><h3>${query?'No recipes matched that search.':onlySaved?'Your favorites will live here.':'Your recipe box starts with supper.'}</h3><p>${query?'Try another ingredient or recipe name.':'Make a recipe, then tap the heart to keep a favorite.'}</p><a class="text-link" href="#cook">Make something delicious →</a></div>`;
}
$('#recipe-search').addEventListener('input',paintRecipes);$('#saved-only').addEventListener('change',paintRecipes);
document.addEventListener('click',async event=>{
  const local=event.target.closest('[data-find-local]');if(local){$('#detail-dialog').close();switchTab('farms');return;}
  const button=event.target.closest('[data-action]');if(!button)return;
  const record=recipes.find(r=>r.id===button.dataset.id);if(!record)return;
  if(button.dataset.action==='open'){$('#detail-content').innerHTML=recipeMarkup(record,true);$('#detail-dialog').showModal();return;}
  if(button.dataset.action==='save'){
    button.disabled=true;
    try{const result=await api('recipes','PATCH',{id:record.id,saved:!record.saved});record.saved=result.saved;paintRecipes();paintActive();if($('#detail-dialog').open)$('#detail-content').innerHTML=recipeMarkup(record,true);}
    catch(error){note(error.message);}finally{button.disabled=false;}
  }
  if(button.dataset.action==='copy'){
    try{await navigator.clipboard.writeText(record.recipe.shoppingList.join('\n'));button.textContent='Shopping list copied ✓';}catch{button.textContent='Select the list above to copy it.';}
  }
  if(button.dataset.action==='print'){
    const printable=document.createElement('section');printable.id='print-recipe';printable.innerHTML=recipeMarkup(record);document.body.append(printable);document.body.classList.add('printing-recipe');
    window.addEventListener('afterprint',()=>{printable.remove();document.body.classList.remove('printing-recipe');},{once:true});window.print();
  }
});
$('#detail-dialog .close').addEventListener('click',()=>$('#detail-dialog').close());
$('#detail-dialog').addEventListener('click',event=>{if(event.target===$('#detail-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
$('#local-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('#farm-button');button.disabled=true;button.textContent='Looking down the road…';$('#farm-status').textContent='Searching mapped farm shops and markets. This can take a moment.';$('#farm-list').replaceChildren();$('#farm-map').replaceChildren();
  try{
    const result=await api('farms','POST',{location:$('#farm-location').value,radius:Number($('#farm-radius').value)});
    $('#farm-status').textContent=`${result.farms.length} mapped ${result.farms.length===1?'place':'places'} within ${result.radius} miles of ${result.center.name}.`;
    const {lat,lon}=result.center;
    if(farmMapInstance){farmMapInstance.remove();farmMapInstance=null;}
    $('#farm-map').replaceChildren();
    if(!window.L)throw new Error('The map library could not load. Please refresh and try again.');
    const mapNode=document.createElement('div');mapNode.id='farm-leaflet-map';mapNode.setAttribute('role','region');mapNode.setAttribute('aria-label','Map showing each nearby farm and farmers market');$('#farm-map').append(mapNode);
    farmMapInstance=L.map(mapNode,{scrollWheelZoom:false}).setView([lat,lon],12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'}).addTo(farmMapInstance);
    L.circleMarker([lat,lon],{radius:7,color:'#526044',weight:2,fillColor:'#d8dfc4',fillOpacity:1}).addTo(farmMapInstance).bindPopup('<strong>'+esc(result.center.name)+'</strong><br>Search location');
    const farmMarkers=[];
    result.farms.forEach((farm,index)=>{
      if(!Number.isFinite(Number(farm.lat))||!Number.isFinite(Number(farm.lon)))return;
      const marker=L.marker([Number(farm.lat),Number(farm.lon)]).addTo(farmMapInstance);
      const popup='<strong>'+esc(farm.name)+'</strong><br>'+esc(farm.type)+' · '+esc(farm.miles)+' mi'+(farm.address?'<br>'+esc(farm.address):'')+'<br><a href="'+esc(farm.directions)+'" target="_blank" rel="noopener noreferrer">Directions</a>';
      marker.bindPopup(popup);farmMarkers.push(marker);
    });
    if(farmMarkers.length){const bounds=L.featureGroup(farmMarkers).getBounds().extend([lat,lon]);farmMapInstance.fitBounds(bounds.pad(.18),{maxZoom:13});}
    else{farmMapInstance.setView([lat,lon],11);}
    requestAnimationFrame(()=>farmMapInstance?.invalidateSize());
    $('#farm-list').innerHTML=result.farms.length?result.farms.map(farm=>`<article class="farm-card"><div class="farm-card-heading"><span class="eyebrow">${esc(farm.type)}</span><span class="distance">${farm.miles} mi</span></div><h3>${esc(farm.name)}</h3><p>${farm.address?esc(farm.address):'See the map for this location.'}</p>${farm.produce?`<p><strong>Listed produce:</strong> ${esc(farm.produce)}</p>`:''}${farm.hours?`<p class="small-note"><strong>Listed hours:</strong> ${esc(farm.hours)}</p>`:'<p class="small-note">Contact the farm for current hours and produce.</p>'}<div class="farm-links"><a class="text-link" href="${esc(farm.directions)}" target="_blank" rel="noopener noreferrer">Directions ↗</a>${farm.website?`<a class="text-link" href="${esc(farm.website)}" target="_blank" rel="noopener noreferrer">Website ↗</a>`:''}<a href="${esc(farm.source)}" target="_blank" rel="noopener noreferrer">Source listing</a></div></article>`).join(''):'<div class="empty-state"><h3>No matching places are mapped in this radius.</h3><p>Try a wider distance or a nearby town. This directory doesn’t include every farm.</p></div>';
  }catch(error){$('#farm-status').textContent=error.message;}finally{button.disabled=false;button.textContent='Find local →';}
});
$('#checkout-button').addEventListener('click',async()=>{
  const button=$('#checkout-button');button.disabled=true;$('#pass-status').textContent='Opening secure Stripe checkout…';
  try{const result=await api('checkout','POST',{});const target=new URL(result.url);if(target.hostname!=='checkout.stripe.com')throw new Error('Checkout could not be opened.');window.location.href=target.href;}
  catch(error){$('#pass-status').textContent=error.message;button.disabled=false;}
});
