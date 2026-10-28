'use strict';
// Form in chung: chỉ lưu định dạng, không nhận HTML/text hoặc dữ liệu đơn.
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode});
const templates={order:9,delivery:7};
function assertTemplate(template){if(!Object.hasOwn(templates,template))throw fail(400,'Mẫu in không hợp lệ.');}
function validateLayout(template,input){
 assertTemplate(template);
 const invalid=()=>{throw fail(400,'Định dạng phiếu không hợp lệ.');};
 if(!input||!Array.isArray(input.widths)||!Array.isArray(input.heights)||!Array.isArray(input.fonts))invalid();
 const {widths,heights,fonts}=input;
 if(widths.length&&(widths.length!==templates[template]||widths.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<2||n>100)||Math.abs(widths.reduce((a,b)=>a+b,0)-100)>.1))invalid();
 if(heights.length>2000||heights.some(n=>n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<16||n>1200)))invalid();
 if(fonts.length>2000)invalid();
 const cleanFonts=fonts.map(op=>{
  if(!op||typeof op.path!=='string'||op.path.length>1200||(op.path!==''&&!/^([a-z][a-z0-9]*:nth-child\([1-9][0-9]*\))( > [a-z][a-z0-9]*:nth-child\([1-9][0-9]*\))*$/.test(op.path))||!Number.isSafeInteger(op.start)||!Number.isSafeInteger(op.end)||op.start<0||op.end<=op.start||op.end>100000||typeof op.size!=='number'||!Number.isFinite(op.size)||op.size<7||op.size>36)invalid();
  return {path:op.path,start:op.start,end:op.end,size:op.size};
 });
 return {widths:[...widths],heights:[...heights],fonts:cleanFonts};
}
async function readLayout(pool,template){
 assertTemplate(template);
 const {rows}=await pool.query('SELECT layout, version FROM shared_print_layouts WHERE template=$1',[template]);
 return rows[0]||{layout:null,version:0};
}
async function writeLayout(pool,template,input,userId){
 const layout=validateLayout(template,input?.layout),version=input?.version;
 if(!Number.isSafeInteger(version)||version<0||version>2147483646)throw fail(400,'Phiên bản mẫu in không hợp lệ.');
 const {rows}=await pool.query(`INSERT INTO shared_print_layouts(template,layout,version,updated_by)
 SELECT $1,$2::jsonb,1,$4 WHERE $3::integer=0 OR EXISTS(SELECT 1 FROM shared_print_layouts WHERE template=$1 AND version=$3)
 ON CONFLICT(template) DO UPDATE SET layout=EXCLUDED.layout,version=shared_print_layouts.version+1,updated_by=EXCLUDED.updated_by,updated_at=now()
 WHERE shared_print_layouts.version=$3 RETURNING layout,version`,[template,JSON.stringify(layout),version,String(userId)]);
 if(!rows.length)throw fail(409,'Form chung đã được người khác sửa. Đóng rồi mở lại phiếu để lấy form mới trước khi chỉnh tiếp.');
 return rows[0];
}
module.exports={validateLayout,readLayout,writeLayout};
