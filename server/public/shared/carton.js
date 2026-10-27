(function(root){
  'use strict';
  const round6=v=>Math.round(v*1e6)/1e6;
  const number=text=>Number(String(text).replace(',','.'));
  const NUM='\\d+(?:[.,]\\d+)?';
  // Hậu tố c (cái) sau SL/thùng chỉ là đơn vị, không đổi nghĩa số: 50c = 50. Có thể c hoa/thường, có hoặc không có khoảng trắng.
  const TERM=new RegExp('^\\s*('+NUM+')\\s*[Tt](?:\\s*[xX*×]\\s*|\\s+)('+NUM+')(\\s*[cC])?\\s*$');
  const LOOSE=new RegExp('^(.*?)\\s*[-−]\\s*('+NUM+')\\s*[cC]?\\s*$');
  // Dấu nối nhiều quy cách: + hoặc dấu phẩy ngay sau SL/thùng của số hạng trước (9tx14, 5tx 14). Dấu phẩy thập phân (0,5Tx100) không bị tách. Khi ghi lại ghi chú, dấu nối được chuẩn hóa thành ' + '.
  const SEPARATOR=/\s*\+\s*|(?<=[xX*×Tt]\s*\d+(?:[.,]\d+)?\s*[cC]?)\s*,\s*/;
  // Ghi chú của vị trí đã nhặt hết: SL = 0, không cảnh báo, chưa có quy cách để chỉ định.
  const EMPTY_NOTE='Hết hàng';
  const positiveInt=n=>Number.isInteger(n)&&n>0;
  // Đọc cú pháp, chưa kiểm số: trả {terms, loose} hoặc null nếu không đúng dạng <thùng>T x <SL/thùng> (+ ...) (- N).
  function scan(text){
    let body=String(text??''),loose=0;
    const tail=LOOSE.exec(body);
    if(tail){body=tail[1];loose=number(tail[2]);}
    const terms=[];
    for(const part of body.split(SEPARATOR)){
      const m=TERM.exec(part);if(!m)return null;
      terms.push({cartons:number(m[1]),perCarton:number(m[2]),suffix:m[3]?m[3].trim().toLowerCase():''});
    }
    return {terms,loose};
  }
  /* Quy cách thùng trong "Ghi chú hàng hóa": một hoặc nhiều số hạng <số thùng>T x <SL/thùng> nối bằng dấu +,
     có thể kèm phần trừ lẻ " - N" ở cuối. Ví dụ 5T x 100 = 500; 1Tx50 + 2Tx25 = 100; 1Tx50 + 2Tx25 - 30 = 70.
     Chịu T hoa/thường, dấu x hoặc * hoặc ×, khoảng trắng, hậu tố c (cái) sau SL/thùng (1Tx50c). Số thùng, SL/thùng và phần trừ lẻ phải là số nguyên dương
     và SL còn lại không âm; ngoài ra (mô tả tự do, 0.5Tx100, 0Tx50, rỗng) trả null để cảnh báo, không tự đoán SL. */
  function parseSpec(text){
    // Ghi chú rỗng (hoặc chỉ có khoảng trắng) và "Hết hàng" là hợp lệ: SL 0, không cảnh báo, chưa có hàng để chỉ định nhặt.
    const trimmed=String(text??'').trim();
    if(trimmed===''||trimmed===EMPTY_NOTE)return {terms:[],loose:0,quantity:0,cartons:0,perCarton:null,multi:false,empty:true};
    const s=scan(text);if(!s)return null;
    if(!s.terms.every(t=>positiveInt(t.cartons)&&positiveInt(t.perCarton)))return null;
    if(s.loose!==0&&!positiveInt(s.loose))return null;
    const quantity=s.terms.reduce((sum,t)=>sum+t.cartons*t.perCarton,0)-s.loose;
    if(quantity<0)return null;
    // Số hạng cùng SL/thùng gộp thành một (cộng thùng, giữ thứ tự xuất hiện đầu tiên); nhiều quy cách tính sau khi gộp.
    const terms=[];for(const t of s.terms){const same=terms.find(x=>x.perCarton===t.perCarton);if(same)same.cartons+=t.cartons;else terms.push({...t});}
    return {terms,loose:s.loose,quantity,cartons:terms.reduce((sum,t)=>sum+t.cartons,0),perCarton:terms[0].perCarton,multi:terms.length>1};
  }
  /* formatSpec(spec) hoặc formatSpec(số thùng, SL/thùng). Số hạng hết thùng bị bỏ; hết sạch thì ghi "Hết hàng".
     Không bao giờ sinh số thùng thập phân: phần không tròn thùng đi vào phần trừ lẻ " - N". */
  function formatSpec(spec,perCarton){
    if(typeof spec==='number')return spec+'T x '+perCarton;
    const terms=spec.terms.filter(t=>t.cartons>0);
    if(!terms.length)return EMPTY_NOTE;
    // Mỗi số hạng giữ hậu tố c như người dùng đã nhập; phần trừ lẻ " - N" thêm mới luôn không có c (đơn giản, không đoán phong cách).
    const text=terms.map(t=>t.cartons+'T x '+t.perCarton+(t.suffix||'')).join(' + ')+(spec.loose>0?' - '+spec.loose:'');
    return parseSpec(text)&&parseSpec(text).quantity>0?text:EMPTY_NOTE;
  }
  /* Chuẩn hóa ghi chú khi lưu: đọc được thì về dạng <thùng>T x <SL/thùng> nối ' + ', phần trừ ' - N', T hoa, c thường, bỏ khoảng trắng thừa;
     sai định dạng thì giữ chữ người dùng gõ, chỉ cắt đầu/cuối và gộp khoảng trắng liên tiếp; rỗng giữ rỗng. */
  function normalizeNote(text){
    const raw=String(text??''),spec=parseSpec(raw);
    if(!spec||spec.empty)return raw.trim().replace(/\s+/g,' ');
    return spec.terms.map(t=>t.cartons+'T x '+t.perCarton+(t.suffix||'')).join(' + ')+(spec.loose>0?' - '+spec.loose:'');
  }
  const cartonsOf=(quantity,perCarton)=>perCarton>0&&Number.isFinite(quantity)?round6(quantity/perCarton):null;
  const isWhole=n=>Math.abs(n-Math.round(n))<1e-4;
  /* Trừ hàng khỏi ghi chú. SL lấy khớp trọn số thùng của một quy cách (và chưa có phần trừ lẻ) thì giảm số thùng
     của quy cách đó, về 0 thì bỏ số hạng. Không khớp, hoặc đã có phần trừ lẻ, thì cộng dồn vào " - N".
     taken = số thùng đã lấy (ST): thùng nguyên theo từng quy cách, phần lẻ chia SL/thùng của số hạng đầu (có thể lẻ). */
  function deduct(spec,quantity){
    if(!spec.terms.length||!(quantity>=0)||quantity>spec.quantity+1e-6)return null;
    const terms=spec.terms.map(t=>({...t}));
    let loose=spec.loose,taken;
    const hit=loose>0?-1:terms.findIndex(t=>t.cartons>0&&isWhole(quantity/t.perCarton)&&Math.round(quantity/t.perCarton)<=t.cartons);
    if(hit>=0){taken=Math.round(quantity/terms[hit].perCarton);terms[hit].cartons-=taken;}
    else{loose+=Math.round(quantity);taken=round6(quantity/terms[0].perCarton);}
    const text=formatSpec({terms,loose});
    return {spec:parseSpec(text),text,taken};
  }
  // Số thùng (ST) của một lượt nhặt trước khi nhặt, theo cùng quy tắc trừ.
  const cartonsFor=(spec,quantity)=>{const d=deduct(spec,quantity);return d?d.taken:null;};
  /* Cộng trả lại khi hoàn tác mà ghi chú đã bị lượt khác thay đổi (không khôi phục nguyên chuỗi được):
     ưu tiên giảm phần trừ lẻ, phần còn lại cộng vào thùng của quy cách chia hết, không thì thêm 1 thùng gồm phần còn lại. */
  function restore(spec,quantity){
    const terms=spec.terms.map(t=>({...t}));
    let loose=spec.loose,rest=Math.round(quantity);
    const fromLoose=Math.min(loose,rest);loose-=fromLoose;rest-=fromLoose;
    if(rest>0){
      const hit=terms.find(t=>isWhole(rest/t.perCarton));
      if(hit)hit.cartons+=Math.round(rest/hit.perCarton);else terms.push({cartons:1,perCarton:rest});
    }
    const text=formatSpec({terms,loose});
    return {spec:parseSpec(text),text};
  }
  /* Gợi ý theo thùng nguyên. candidates: [{id, available, perCarton}] hoặc [{id, available, terms:[{cartons,perCarton}]}].
     Có tổ hợp thùng nguyên cộng đúng SL cần thì lấy (ít vị trí nhất); không có thì lấy tổng nhỏ nhất vượt SL cần.
     Trả null khi không áp dụng được (thiếu quy cách, SL không nguyên, đã có phần trừ lẻ, không đủ thùng nguyên, bài toán quá lớn). */
  function suggest(need,candidates){
    if(!Number.isInteger(need)||need<=0)return null;
    const live=candidates.filter(c=>c.available>0);
    if(!live.length)return null;
    const items=[];
    for(const c of live){
      const terms=c.terms||(c.perCarton>0?[{cartons:Math.floor(c.available/c.perCarton+1e-9),perCarton:c.perCarton}]:null);
      if(!terms||c.loose>0||terms.some(t=>!Number.isInteger(t.perCarton)||t.perCarton<=0))return null;
      terms.forEach(t=>items.push({id:c.id,p:t.perCarton,cartons:Math.min(Math.floor(t.cartons+1e-9),Math.floor(c.available/t.perCarton+1e-9))}));
    }
    const sorted=items.map((it,i)=>({...it,order:i})).sort((a,b)=>b.cartons*b.p-a.cartons*a.p||a.id.localeCompare(b.id));
    const limit=need+Math.max(...sorted.map(it=>it.p));
    if(limit>400000)return null;
    let layer=new Map([[0,{counts:[],ids:new Set()}]]),work=0;
    for(const it of sorted){
      const next=new Map();
      for(const [sum,state] of layer)for(let k=0;k<=it.cartons;k++){
        const total=sum+k*it.p;if(total>limit)break;
        if(++work>4e6)return null;
        const ids=k>0?new Set([...state.ids,it.id]):state.ids,old=next.get(total);
        if(!old||ids.size<old.ids.size)next.set(total,{counts:[...state.counts,k],ids});
      }
      layer=next;
    }
    let target=layer.has(need)?need:null;
    if(target===null)for(const sum of layer.keys())if(sum>need&&(target===null||sum<target))target=sum;
    if(target===null)return null;
    const chosen=layer.get(target),byId=new Map();
    sorted.forEach((it,i)=>byId.set(it.id,(byId.get(it.id)||0)+chosen.counts[i]*it.p));
    for(const c of live)if((byId.get(c.id)||0)>c.available+1e-9)return null;
    return {picks:[...byId].filter(([,q])=>q>0).map(([id,quantity])=>({id,quantity})),shortage:0};
  }
  /* Một nơi duy nhất quyết định dòng vị trí có đáng cảnh báo hay không (bôi đỏ, bộ lọc Cảnh báo và số đếm cùng dùng).
     SL luôn suy ra từ ghi chú nên không có cảnh báo "lệch SL". Gồm:
     'multi' = ghi chú nhiều quy cách (vẫn tính được SL);
     'loose' = ghi chú có phần trừ lẻ " - N", kể cả chỉ một quy cách (vẫn tính được SL, vẫn chỉ định nhặt được);
     'unreadable' = ghi chú có chữ nhưng sai định dạng (không tính được SL, không chỉ định nhặt được); ghi chú rỗng là hợp lệ, SL 0;
     'badnumber' = đúng dạng nhưng số thùng hoặc SL/thùng không phải số nguyên dương (0.5Tx100, 0Tx50);
     'unknowncode' = (chỉ khi context.unknownCode) mã hàng nhập tay chưa có trong danh mục nên không tra được tên. */
  function warnings(notes,context={}){
    const spec=parseSpec(notes),reasons=[];
    if(spec){
      if(spec.multi)reasons.push('multi');
      // Phần trừ lẻ " - N" vẫn tính đúng SL nhưng là ghi chú chưa gọn: cảnh báo để người dùng gộp lại (vd 1Tx70).
      if(spec.loose>0)reasons.push('loose');
    }
    else{
      const s=scan(notes);
      const numbers=s?[...s.terms.flatMap(t=>[t.cartons,t.perCarton]),...(s.loose?[s.loose]:[])]:[];
      reasons.push(numbers.some(n=>!positiveInt(n))?'badnumber':'unreadable');
    }
    // Dòng nhập tay có mã hàng chưa tra được tên trong danh mục của prototype.
    if(context.unknownCode)reasons.push('unknowncode');
    return reasons;
  }
  const WARNING_LABEL={multi:'Nhiều quy cách',loose:'Có phần trừ lẻ',unreadable:'Ghi chú sai định dạng',badnumber:'Số thùng và SL/thùng phải là số nguyên dương',unknowncode:'Mã hàng chưa có trong danh mục'};
  const api={normalizeNote,EMPTY_NOTE,warnings,WARNING_LABEL,parseSpec,formatSpec,cartonsOf,isWhole,deduct,cartonsFor,restore,suggest};
  if(typeof module!=='undefined')module.exports=api;
  else root.PickingCarton=api;
})(typeof window!=='undefined'?window:globalThis);
