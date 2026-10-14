import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/db/src/index.js";
import { Service } from "../packages/core/src/index.js";
import { LocalStorage } from "../packages/storage/src/index.js";
import { GatewayClient } from "../packages/cloud-client/src/gateway.js";
let db: Database, service: Service, dir: string, c: any, asset: any;
const bytes = Buffer.from("reference-test-bytes");
const remote: any[] = [];
let fetcher: ReturnType<typeof vi.fn>, gateway: GatewayClient;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cloud-reference-"));
  db = await Database.open();
  service = new Service(db, new LocalStorage(dir));
  c = await service.authenticate((await service.createAccount("Local", 0)).key);
  asset = await service.registerAsset(c.accountId, bytes, {name:"reference.png", kind:"image", mime:"image/png", metadata:{width:16,height:16}, provenance:{license:"original",rightsConfirmed:true}});
  remote.length = 0;
  fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({Authorization:"Bearer cloud-test"});
    const path = new URL(url).pathname;
    if (path === "/v1/reference-uploads") return Response.json({id:"upload-1"});
    if (path === "/v1/reference-uploads/upload-1") {
      expect(Buffer.from(init.body as Uint8Array)).toEqual(bytes);
      return Response.json({id:"remote-asset",sha256:asset.sha256,bytes:asset.bytes});
    }
    const body = JSON.parse(init.body as string);
    remote.push(body);
    if (path === "/v1/quotes") return Response.json({id:"remote-quote",maxCents:5});
    if (path === "/v1/generations") return Response.json({id:"remote-job",status:"queued"});
    throw new Error(path);
  });
  gateway = new GatewayClient(service,"https://official.example", "cloud-test", fetcher as any);
});
afterEach(async () => { await db.close(); await rm(dir,{recursive:true,force:true}); });
const input = () => ({kind:"generate",model:"reference-model",mode:"image_to_video",prompt:"Animate the product",references:[{assetId:asset.id,role:"first_frame"}]});
it("uploads owned bytes once, binds remote references to the quote and retries without repurchasing",async()=>{
  const q = await gateway.quote(c,input());
  expect(remote[0].input.references).toEqual([{assetId:"remote-asset",role:"first_frame"}]);
  expect(remote[0].input.mode).toBe("image_to_video");
  const p = {input:input(),quoteId:q.id,idempotencyKey:"one"};
  const job = await gateway.submit(c,p);
  expect((await gateway.submit(c,p)).id).toBe(job.id);
  expect(remote.filter(r=>r.idempotencyKey)).toHaveLength(1);
  expect(remote[1].input).toEqual(remote[0].input);
  expect(job.input.references[0].assetId).toBe(asset.id);
  expect((await service.usage(c)).reservedCents).toBe(0);
  await gateway.quote(c,input());
  expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith("/upload-1"))).toHaveLength(1);
});
it("rejects foreign references before making any cloud call",async()=>{
  const other = await service.authenticate((await service.createAccount("Other",0)).key);
  await expect(gateway.quote(other,input())).rejects.toMatchObject({code:"NOT_FOUND"});
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects reference changes after quoting without purchasing",async()=>{
  const q = await gateway.quote(c,input());
  await db.transaction(tx=>tx.put({...asset,sha256:"0".repeat(64)}));
  await expect(gateway.submit(c,{input:input(),quoteId:q.id,idempotencyKey:"changed"})).rejects.toMatchObject({code:"REFERENCE_CHANGED"});
  expect(remote.filter(r=>r.idempotencyKey)).toHaveLength(0);
});
it("validates local storyboard review before upload and again before purchase",async()=>{
  const board = {id:"board",type:"storyboard",accountId:c.accountId,createdAt:new Date().toISOString(),version:1,shots:[{sourceShotId:"shot",review:{decision:"accepted",imageAssetId:asset.id,sha256:asset.sha256}}]};
  await db.transaction(tx=>tx.put(board));
  const operation = {...input(),storyboard:{storyboardId:"board",version:1,sourceShotId:"shot",stage:"video"}};
  const q = await gateway.quote(c,operation);
  expect(remote[0].input).not.toHaveProperty("storyboard");
  await db.transaction(tx=>tx.put({...board,version:2}));
  await expect(gateway.submit(c,{input:operation,quoteId:q.id,idempotencyKey:"stale"})).rejects.toMatchObject({code:"STORYBOARD_CONFLICT"});
  expect(remote.filter(r=>r.idempotencyKey)).toHaveLength(0);
});
