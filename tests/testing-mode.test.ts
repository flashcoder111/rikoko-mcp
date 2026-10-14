import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Database} from '../packages/db/src/index.js';
import {Service} from '../packages/core/src/index.js';
import {LocalStorage} from '../packages/storage/src/index.js';
import {FalProvider} from '../packages/providers/src/index.js';
const model={id:'test',endpoint:'fal-ai/test',kind:'image' as const,parameters:{},maxCostCents:0,hardBoundConfirmed:false,priceVersion:'test-unmetered'};
const input={kind:'generate' as const,model:'test',prompt:'test',parameters:{}};
it('allows explicitly configured testing with zero credit and no price cap, preserving unknown supplier cost',async()=>{
 const db=await Database.open(), dir=await mkdtemp(join(tmpdir(),'rikoko-testing-'));
 try{
  const provider=new FalProvider([model],'fixture',true,fetch,{testing:true});
  const service=new Service(db,new LocalStorage(dir),provider,'testing');
  const admin=await service.authenticate((await service.createAccount('Testing',0)).key);
  const c=await service.authenticate((await service.issueKey(admin,{name:'Test caller',scopes:['read','write'],budgetCents:0})).key);
  expect(provider.describe()[0].available).toBe(true);
  const q=await service.quote(c,input);
  expect(q).toMatchObject({billingSource:'testing',maxCents:0,providerMaxCostCents:null});
  const p={input,quoteId:q.id,idempotencyKey:'one'};
  const j=await service.submit(c,p);
  expect((await service.submit(c,p)).id).toBe(j.id);
  const claimed=await service.claim('test');
  await service.finish(j.id,claimed!.leaseToken,{status:'completed',outputs:['test-output']},null);
  expect(await service.get(c,'job',j.id)).toMatchObject({chargedCents:0,providerActualCostCents:null,providerCostStatus:'pending_reconciliation',providerCostOverrunCents:null});
  expect(await service.usage(c)).toMatchObject({balanceCents:0,reservedCents:0,billingSource:'testing'});
  service.billingSource='credits';
  await expect(service.submit(c,{...p,idempotencyKey:'different'})).rejects.toMatchObject({code:'PRICE_CHANGED'});
 }finally{await db.close();await rm(dir,{recursive:true,force:true});}
});
it('keeps unconfirmed profiles disabled outside testing and never bypasses credentials',()=>{
 expect(()=>new FalProvider([model],'fixture',true).validate(input)).toThrow();
 expect(()=>new FalProvider([model],undefined,true,fetch,{testing:true}).validate(input)).toThrow();
 expect(()=>new FalProvider([model],'fixture',false,fetch,{testing:true}).validate(input)).toThrow();
});
