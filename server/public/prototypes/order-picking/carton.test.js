'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('./carton.js');
const pick=s=>({terms:s.terms,loose:s.loose,quantity:s.quantity});
test('parseSpec đọc <số thùng>T x <SL/thùng>, chịu hoa thường, dấu x * ×, khoảng trắng và dấu phẩy thập phân',()=>{
  assert.deepEqual(pick(C.parseSpec('5Tx100')),{terms:[{cartons:5,perCarton:100,suffix:''}],loose:0,quantity:500});
  assert.equal(C.parseSpec(' 40T x 250 ').quantity,10000);
  assert.equal(C.parseSpec('3tx35').quantity,105);
  assert.equal(C.parseSpec('5T*80').quantity,400);
  assert.equal(C.parseSpec('2 T × 60').quantity,120);
  const one=C.parseSpec('2T x 50');assert.equal(one.cartons,2);assert.equal(one.perCarton,50);assert.equal(one.multi,false);
});
test('parseSpec nhiều quy cách nối bằng +, và phần trừ lẻ tùy chọn',()=>{
  const multi=C.parseSpec('1Tx50 + 2Tx25');
  assert.equal(multi.quantity,100);assert.equal(multi.multi,true);assert.equal(multi.terms.length,2);assert.equal(multi.perCarton,50,'quy cách đầu');
  assert.equal(C.parseSpec('1Tx50 + 2Tx25 - 30').quantity,70);
  assert.equal(C.parseSpec('1Tx50 + 2Tx25 - 30').loose,30);
  assert.equal(C.parseSpec('1tx50+2TX25−30').quantity,70,'không cần khoảng trắng, chịu dấu trừ −');
  const single=C.parseSpec('1Tx50 - 30');assert.equal(single.quantity,20);assert.equal(single.multi,false,'một quy cách kèm trừ lẻ vẫn là một quy cách');
});
test('parseSpec từ chối chuỗi không đúng quy cách, số thùng hoặc SL/thùng không nguyên dương, hoặc trừ quá SL',()=>{
  for(const bad of ['0.5T x 100','0,5Tx100','0T x 50','1T x 50.5','1Tx50 - 0.5','abc','Thùng 100 chiếc','Dãy cửa kho','5T','x100','5T x 0','-1T x 5','5T x 100 ghi chú','1T x 50 / 2T x 60','1Tx50 +','+ 1Tx50','1Tx50 + hàng lẻ','1Tx50 - 60','- 30'])assert.equal(C.parseSpec(bad),null,String(bad));
});
test('formatSpec và cartonsOf làm tròn số thùng, không để lộ sai số số thực',()=>{
  assert.equal(C.formatSpec(3,100),'3T x 100');
  assert.equal(C.formatSpec(C.parseSpec('1tx50+2tx25-30')),'1T x 50 + 2T x 25 - 30');
  assert.equal(C.cartonsOf(110,55),2);
  assert.equal(C.cartonsOf(50,60),0.833333);
  assert.equal(C.cartonsOf(5,0),null);
  assert.equal(C.cartonsOf(5,null),null);
  assert.equal(C.isWhole(2),true);assert.equal(C.isWhole(0.5),false);assert.equal(C.isWhole(1.9999999),true);
});
test('không bao giờ tự sinh số thùng thập phân vào ghi chú',()=>{
  for(const [text,q] of [['1Tx50',25],['5Tx100',150],['2Tx60',30],['1Tx50 + 2Tx25',30]]){
    const d=C.deduct(C.parseSpec(text),q);assert.doesNotMatch(d.text,/d.d|0T/,text+' - '+q);
    assert.equal(d.spec.quantity,C.parseSpec(text).quantity-q);
  }
  assert.equal(C.deduct(C.parseSpec('5Tx100'),150).text,'5T x 100 - 150','không tròn thùng thì ghi vào phần trừ lẻ');
});
test('trừ thùng: 5T x 100 lấy 200 còn 3T x 100; hết thùng thì bỏ số hạng',()=>{
  const spec=C.parseSpec('5T x 100');
  const d=C.deduct(spec,200);assert.equal(d.text,'3T x 100');assert.equal(d.taken,2);assert.equal(d.spec.quantity,300);
  const multi=C.deduct(C.parseSpec('1Tx50 + 2Tx25'),50);
  assert.equal(multi.text,'2T x 25','lấy nguyên thùng 50 làm số hạng đầu biến mất');assert.equal(multi.taken,1);
  assert.equal(C.deduct(C.parseSpec('1Tx50'),50).text,'Hết hàng','hết hẳn: ghi chú Hết hàng, SL 0, không sinh 0T');
  assert.equal(C.parseSpec('Hết hàng').quantity,0);assert.deepEqual(C.warnings('Hết hàng'),[]);
});
test('bốc lẻ ghi vào phần trừ lẻ và cộng dồn',()=>{
  const first=C.deduct(C.parseSpec('1Tx50 + 2Tx25'),30);
  assert.equal(first.text,'1T x 50 + 2T x 25 - 30');assert.equal(first.spec.quantity,70);
  assert.equal(first.taken,0.6,'phần lẻ 30 chia SL/thùng của số hạng đầu (50)');
  const second=C.deduct(first.spec,25);
  assert.equal(second.text,'1T x 50 + 2T x 25 - 55','đã có phần trừ lẻ thì cộng dồn, kể cả khi 25 vừa một thùng');
  assert.equal(second.spec.quantity,45);
  assert.equal(C.deduct(C.parseSpec('1Tx50'),25).text,'1T x 50 - 25');
  assert.equal(C.deduct(C.parseSpec('1Tx50'),25).taken,0.5);
  assert.equal(C.deduct(C.parseSpec('1Tx50'),60),null,'không trừ quá tồn');
});
test('ST của một lượt nhặt theo từng quy cách',()=>{
  assert.equal(C.cartonsFor(C.parseSpec('1Tx50'),50),1);
  assert.equal(C.cartonsFor(C.parseSpec('1Tx60'),60),1);
  assert.equal(C.cartonsFor(C.parseSpec('1Tx50'),25),0.5);
  assert.equal(C.cartonsFor(C.parseSpec('1Tx50 + 2Tx25'),25),1,'25 khớp một thùng của quy cách thứ hai');
  assert.equal(C.cartonsFor(C.parseSpec('1Tx50'),999),null);
});
test('restore cộng trả lại khi không khôi phục nguyên chuỗi được',()=>{
  assert.equal(C.restore(C.parseSpec('1T x 50 + 2T x 25 - 55'),25).text,'1T x 50 + 2T x 25 - 30');
  assert.equal(C.restore(C.parseSpec('3T x 100'),200).text,'5T x 100');
  assert.equal(C.restore(C.parseSpec('Hết hàng'),50).text,'1T x 50');
});
test('suggest dùng tổ hợp thùng nguyên cộng đúng SL cần nếu có',()=>{
  const r=C.suggest(100,[{id:'a',available:200,perCarton:50},{id:'b',available:120,perCarton:60}]);
  assert.deepEqual(r.picks,[{id:'a',quantity:100}],'ưu tiên ít vị trí nhất');
  assert.equal(r.shortage,0);
  const two=C.suggest(110,[{id:'a',available:50,perCarton:50},{id:'b',available:60,perCarton:60}]);
  assert.deepEqual(two.picks.map(p=>[p.id,p.quantity]).sort(),[['a',50],['b',60]]);
});
test('suggest làm tròn lên thùng nguyên khi không có tổ hợp tròn (ví dụ ABC cần 100 = 50 + 60)',()=>{
  const r=C.suggest(100,[{id:'A01',available:50,perCarton:50},{id:'B02',available:60,perCarton:60}]);
  assert.deepEqual(r.picks.map(p=>[p.id,p.quantity]).sort(),[['A01',50],['B02',60]]);
  assert.equal(r.shortage,0);
  const over=C.suggest(120,[{id:'a',available:500,perCarton:100}]);
  assert.deepEqual(over.picks,[{id:'a',quantity:200}],'cần 120 từ 100/thùng thì lấy 2 thùng');
});
test('suggest với khu nhiều quy cách gộp các số hạng cùng một vị trí',()=>{
  const r=C.suggest(75,[{id:'m',available:100,terms:[{cartons:1,perCarton:50},{cartons:2,perCarton:25}]}]);
  assert.deepEqual(r.picks,[{id:'m',quantity:75}]);
});
test('suggest trả null khi không áp dụng được để quay về gợi ý theo SL',()=>{
  assert.equal(C.suggest(100,[{id:'a',available:500,perCarton:null}]),null,'có vị trí chưa rõ quy cách');
  assert.equal(C.suggest(100,[{id:'a',available:60,perCarton:60}]),null,'tổng thùng nguyên không đủ');
  assert.equal(C.suggest(10.5,[{id:'a',available:500,perCarton:50}]),null,'SL cần không nguyên');
  assert.equal(C.suggest(30,[{id:'a',available:70,loose:30,terms:[{cartons:1,perCarton:50},{cartons:2,perCarton:25}]}]),null,'đã có phần trừ lẻ thì không đoán thùng');
});
test('warnings: nhiều quy cách, sai định dạng (kể cả rỗng), số không nguyên dương; quy cách đơn kể cả có trừ lẻ thì sạch',()=>{
  assert.deepEqual(C.warnings('1Tx50 + 2Tx25'),['multi']);
  assert.deepEqual(C.warnings('1Tx50 + 2Tx25 - 30'),['multi','loose']);
  assert.deepEqual(C.warnings('1Tx100 - 30'),['loose'],'một quy cách kèm trừ lẻ cũng cảnh báo');
  assert.equal(C.parseSpec('1Tx100 - 30').quantity,70,'nhưng SL vẫn tính đúng');
  assert.deepEqual(C.warnings('1Tx70'),[],'sửa về dạng sạch thì hết cảnh báo');
  assert.equal(C.WARNING_LABEL.loose,'Có phần trừ lẻ');
  assert.deepEqual(C.warnings('5T x 100'),[]);
  assert.deepEqual(C.warnings('5T'),['unreadable']);
  assert.deepEqual(C.warnings('Dãy cửa kho'),['unreadable'],'mô tả tự do không tính được SL');
  assert.deepEqual(C.warnings(''),[],'ghi chú rỗng là hợp lệ, SL 0, không cảnh báo');
  assert.deepEqual(C.warnings('   '),[],'chỉ có khoảng trắng cũng là rỗng');
  assert.deepEqual(C.warnings(null),[]);assert.deepEqual(C.warnings(undefined),[]);
  assert.deepEqual(C.warnings('abc'),['unreadable'],'có chữ nhưng sai định dạng vẫn cảnh báo');
  for(const blank of ['',' ',null,undefined,'Hết hàng']){const spec=C.parseSpec(blank);assert.equal(spec.quantity,0,String(blank));assert.equal(spec.multi,false);}
  assert.deepEqual(C.warnings('1Tx50 - 60'),['unreadable'],'trừ quá SL');
  assert.deepEqual(C.warnings('0.5Tx100'),['badnumber'],'số thùng thập phân');
  assert.deepEqual(C.warnings('0Tx50'),['badnumber']);
  assert.deepEqual(C.warnings('2Tx0'),['badnumber']);
  assert.deepEqual(C.warnings('1Tx50.5'),['badnumber']);
  assert.deepEqual(C.warnings('1Tx50'),[],'sửa thành số nguyên dương thì hết cảnh báo');
  assert.deepEqual(C.warnings('5T x 100',{unknownCode:true}),['unknowncode']);
  assert.deepEqual(C.warnings('abc',{unknownCode:true}),['unreadable','unknowncode']);
  assert.deepEqual(C.warnings('',{unknownCode:true}),['unknowncode']);
  assert.deepEqual(C.warnings('5T x 100',{unknownCode:false}),[]);
  assert.equal(C.WARNING_LABEL.unknowncode,'Mã hàng chưa có trong danh mục');
  assert.equal(C.WARNING_LABEL.unreadable,'Ghi chú sai định dạng');assert.equal(C.WARNING_LABEL.multi,'Nhiều quy cách');
});
test('hậu tố c (cái) sau SL/thùng chỉ là đơn vị: 50c = 50, chịu c hoa/thường và khoảng trắng',()=>{
  for(const text of ['1T x 50c','1Tx50c','1Tx50 c','1tx50C','1T X 50 C'])assert.equal(C.parseSpec(text).quantity,50,text);
  assert.equal(C.parseSpec('5Tx100c').quantity,500);
  const multi=C.parseSpec('1Tx50c + 2Tx25c - 30');assert.equal(multi.quantity,70);assert.equal(multi.multi,true);
  assert.equal(C.parseSpec('1Tx50c - 30c').quantity,20,'phần trừ lẻ cũng chịu c');
  assert.deepEqual(C.warnings('1T x 50c'),[]);assert.deepEqual(C.warnings('1Tx50c + 2Tx25c - 30'),['multi','loose']);
  for(const bad of ['1T x 50cm','1T x c','1T x 50 cc','1Tx50c ghi chú','1/10 đi sửa','vỏ','1t','1b*200'])assert.notEqual(C.warnings(bad).length,0,bad);
});
test('trừ thùng giữ hậu tố c của từng số hạng; phần trừ lẻ thêm mới không có c',()=>{
  assert.equal(C.deduct(C.parseSpec('5T x 100c'),200).text,'3T x 100c');
  assert.equal(C.deduct(C.parseSpec('1Tx50c + 2Tx25'),50).text,'2T x 25','số hạng có c biến mất, số hạng không c giữ nguyên');
  assert.equal(C.deduct(C.parseSpec('1Tx50c + 2Tx25c'),50).text,'2T x 25c');
  assert.equal(C.deduct(C.parseSpec('1T x 50c'),25).text,'1T x 50c - 25');
  assert.equal(C.deduct(C.parseSpec('1Tx50c - 25'),10).text,'1T x 50c - 35');
  assert.equal(C.restore(C.parseSpec('3T x 100c'),200).text,'5T x 100c');
});
