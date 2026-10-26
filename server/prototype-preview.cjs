'use strict';
// Local read-only preview. Reuse actual public assets; never start DB, auth or background jobs.
const express=require('express');
const path=require('node:path');
const app=express();
require('./prototype-build.cjs').build();
app.get('/',(req,res)=>res.redirect('/prototypes/order-picking/'));
app.use('/api',(req,res)=>res.status(503).json({error:'Local preview không kết nối API thật. Mở prototype trong hệ thống đã đăng nhập hoặc nhập JSON.'}));
app.use(express.static(path.join(__dirname,'public')));
app.listen(4178,'127.0.0.1',()=>console.log('Prototype http://127.0.0.1:4178/prototypes/order-picking/'));
