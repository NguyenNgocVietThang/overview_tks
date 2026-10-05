'use strict';
(async function () {
 const app = window.Telegram && window.Telegram.WebApp;
 const reason=document.getElementById('reason'), submit=document.getElementById('submit'), feedback=document.getElementById('feedback');
 const params=new URLSearchParams(location.search);
 const credentials={initData:app && app.initData,requestId:params.get('requestId'),expectedVersion:params.get('expectedVersion')};
 let busy=false,ready=false;
 if(app){app.ready();app.expand();}
 async function api(action,body){const response=await fetch('/api/telegram/manager-leave/miniapp/'+action,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify({...credentials,...body})});const result=await response.json();if(!response.ok)throw new Error(result.error || 'Chưa thể lưu. Hãy thử lại.');return result;}
 reason.addEventListener('input',()=>{document.getElementById('counter').textContent=reason.value.length+'/500';});
 document.getElementById('cancel').addEventListener('click',()=>{if(busy)return;if(app)app.close();else feedback.textContent='Đã hủy. Trạng thái yêu cầu được giữ nguyên.';});
 document.getElementById('reject-form').addEventListener('submit',async event=>{event.preventDefault();if(busy || !ready)return;busy=true;submit.disabled=true;feedback.textContent='Đang lưu…';try{await api('reject',{note:reason.value.trim()});feedback.textContent='Đã từ chối yêu cầu.';ready=false;reason.disabled=true;}catch(error){feedback.textContent=error.message;}finally{busy=false;submit.disabled=!ready;}});
 try{if(!credentials.initData)throw new Error('Hãy mở từ nút Từ chối trong Telegram.');const {request}=await api('context',{});const title='Từ chối '+(request.ho_ten || 'đơn nghỉ phép');document.title=title;document.querySelector('h1').textContent=title;document.getElementById('context').textContent=[request.ho_ten,request.bo_phan,request.co_so,[request.thoi_gian_bat_dau,request.thoi_gian_ket_thuc].filter(Boolean).join(' → ')].filter(Boolean).join('\n');ready=true;submit.disabled=false;}catch(error){feedback.textContent=error.message;document.getElementById('context').textContent='';}
})();
