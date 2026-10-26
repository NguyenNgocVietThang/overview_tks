'use strict';
const fs=require('node:fs'),path=require('node:path');
const publicDir=path.join(__dirname,'public');
const asset=url=>path.join(publicDir,decodeURIComponent(url.split('?')[0]).replace(/^\//,''));
function embedImage(url){const p=asset(url);if(!fs.existsSync(p))return url;const type=/\.png$/i.test(p)?'image/png':'image/jpeg';return 'data:'+type+';base64,'+fs.readFileSync(p).toString('base64');}
let html=require('./prototype-build.cjs').build();
html=html.replace(/<link\b[^>]*href="(https:[^"]*)"[^>]*>/g,'');
html=html.replace(/<link\b[^>]*href="(\/[^"?]+\.css(?:\?[^\"]*)?)"[^>]*>/g,(_,url)=>{
  let css=fs.readFileSync(asset(url),'utf8');css=css.replace(/url\(['"]?(\/[^)'"\s]+)['"]?\)/g,(_m,u)=>'url("'+embedImage(u)+'")');return '<style>'+css+'</style>';
});
html=html.replace(/<script\b[^>]*src="(\/[^\"]+)"[^>]*><\/script>/g,(_,url)=>'<script>'+fs.readFileSync(asset(url),'utf8').replace(/<\/script/gi,'<\\/script')+'</script>');
html=html.replace(/(src|href)="(\/Logo\.jpg)"/g,(_,attr,url)=>attr+'="'+embedImage(url)+'"');
html=html.replace('<head>','<head><script>window.__TKS_SHOOTING_STAR_INITIALIZED__=true;</script>');
const output=path.join(__dirname,'..','TOKOSI-prototype-nhat-don.html');
fs.writeFileSync(output,html);console.log(output+' · '+Math.round(Buffer.byteLength(html)/1024)+' KB');
