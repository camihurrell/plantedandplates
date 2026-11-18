import { ensureSchema, sql } from './db.mjs';
const configured=!!(process.env.DATABASE_URL||process.env.POSTGRES_URL);
if(!configured){console.log('Database setup deferred until DATABASE_URL is available.');}
else {
  await ensureSchema();
  if(process.env.VERCEL_ENV==='production'||process.env.SEED_DEMO_ACCOUNT==='true'){
    try{await seedDemo();console.log('Demo account provisioned and verified.');}
    catch(error){console.warn('Demo setup pending:',error.message);}
  }
}
async function seedDemo(){
  const db=sql(),base=(process.env.NEON_AUTH_BASE_URL||process.env.VITE_NEON_AUTH_URL||'').replace(/\/$/,'');
  if(!base)throw new Error('Authentication URL is missing.');
  const email='demo@demo.com',password='password123!',origin=process.env.APP_URL||'https://plantedandplates.vercel.app';
  const headers={'Content-Type':'application/json',Origin:origin};
  let rows=await db`SELECT id,"emailVerified" FROM neon_auth."user" WHERE lower(email)=${email}`;
  if(!rows.length){
    const response=await fetch(base+'/sign-up/email',{method:'POST',headers,body:JSON.stringify({email,password,name:'Demo Kitchen',callbackURL:origin+'/kitchen.html'}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Allow the production website domain in Neon Auth, then run demo setup again.');
    rows=await db`SELECT id,"emailVerified" FROM neon_auth."user" WHERE lower(email)=${email}`;
    if(!rows.length)throw new Error('Demo registration did not produce an account.');
  }
  const demo=rows[0];
  await db`UPDATE neon_auth."user" SET "emailVerified"=true WHERE id=${demo.id}`;
  let valid=false;
  try{
    const response=await fetch(base+'/sign-in/email',{method:'POST',headers,body:JSON.stringify({email,password}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    valid=response.ok&&result.user?.id===demo.id;
  }finally{
    if(!valid&&!demo.emailVerified)await db`UPDATE neon_auth."user" SET "emailVerified"=false WHERE id=${demo.id}`;
  }
  if(!valid)throw new Error('The existing demo account could not log in with the required password; reset only that account in Neon.');
  await db`INSERT INTO pp_profiles(user_id,email,name,is_demo,paid,pantry) VALUES (${demo.id},${email},'Demo Kitchen',true,true,'["chickpeas","spinach","rice","lemon","olive oil","garlic"]'::jsonb) ON CONFLICT(user_id) DO UPDATE SET is_demo=true,paid=true`;
}
