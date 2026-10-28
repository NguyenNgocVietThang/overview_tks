'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {validateLayout,readLayout,writeLayout}=require('./printLayouts');
const layout={widths:[4,22,8,10,13,10,13,10,10],heights:[40,null],fonts:[{path:'table:nth-child(1) > tbody:nth-child(2) > tr:nth-child(1) > td:nth-child(2)',start:0,end:4,size:13}]};
test('shared layout accepts only formatting and valid template geometry',()=>{
 assert.deepEqual(validateLayout('order',layout),layout);
 for(const input of [{...layout,widths:[100]}, {...layout,heights:[-1]}, {...layout,fonts:[{...layout.fonts[0],path:'script'}]}, {...layout,fonts:[{...layout.fonts[0],size:99}]}])assert.throws(()=>validateLayout('order',input),{statusCode:400});
 assert.throws(()=>validateLayout('unknown',layout),{statusCode:400});
 assert.deepEqual(validateLayout('order',{...layout,html:'<script>bad</script>'}),layout);
});
test('two users share persisted form; templates isolated; stale writes rejected and reset persisted',async()=>{
 const db=new PGlite();
 try{
  await db.exec('CREATE ROLE reporting_readonly');
  await db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/0100_shared_print_layouts.sql'),'utf8'));
  assert.deepEqual(await readLayout(db,'order'),{layout:null,version:0});
  const first=await writeLayout(db,'order',{layout,version:0},'user-a');
  assert.equal(first.version,1);
  assert.deepEqual((await readLayout(db,'order')).layout,layout);
  assert.deepEqual(await readLayout(db,'delivery'),{layout:null,version:0});
  await assert.rejects(writeLayout(db,'order',{layout,version:0},'user-b'),{statusCode:409});
  const second=await writeLayout(db,'order',{layout:{widths:[],heights:[],fonts:[]},version:1},'user-b');
  assert.equal(second.version,2);
  assert.equal((await db.query('SELECT updated_by FROM shared_print_layouts')).rows[0].updated_by,'user-b');
  assert.deepEqual((await readLayout(db,'order')).layout,{widths:[],heights:[],fonts:[]});
 }finally{await db.close();}
});
