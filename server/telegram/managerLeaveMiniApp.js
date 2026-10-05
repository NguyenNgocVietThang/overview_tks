'use strict';
const express = require('express');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { BRANCHES } = require('../branch/branches');
function invalid(message, statusCode = 403) { return Object.assign(new Error(message), { statusCode }); }
function verifyInitData(initData, token, now = Math.floor(Date.now() / 1000)) {
 if (typeof initData !== 'string' || !token || initData.length > 16384) throw invalid('Phiên Telegram không hợp lệ.');
 const values = new URLSearchParams(initData); const seen = new Set();
 for (const [key] of values) { if (seen.has(key)) throw invalid('Phiên Telegram không hợp lệ.'); seen.add(key); }
 const hash = values.get('hash');
 if (!/^[a-fA-F0-9]{64}$/.test(hash || '')) throw invalid('Phiên Telegram không hợp lệ.');
 values.delete('hash');
 const check = [...values.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,value]) => `${key}=${value}`).join('\n');
 const secret = createHmac('sha256', 'WebAppData').update(token).digest();
 const expected = createHmac('sha256', secret).update(check).digest();
 if (!timingSafeEqual(expected, Buffer.from(hash,'hex'))) throw invalid('Phiên Telegram không hợp lệ.');
 const date = values.get('auth_date');
 if (!/^\d+$/.test(date || '') || !Number.isSafeInteger(Number(date)) || Number(date) > now || now - Number(date) > 900) throw invalid('Phiên Telegram hết hạn. Hãy mở lại từ thông báo.');
 let user; try { user = JSON.parse(values.get('user')); } catch { throw invalid('Phiên Telegram không hợp lệ.'); }
 if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) throw invalid('Phiên Telegram không hợp lệ.');
 return user;
}
function createManagerLeaveMiniApp({ enabled, token, getManager, leaveRepo = require('../hr/hrLeaveRepository'), authorization, decide, now } = {}) {
 const router = express.Router();
 const access = authorization || require('../hr/hrLeaveAuthorization').createHrLeaveAuthorization();
 const decision = decide || require('../hr/hrLeaveDecisionService').createHrLeaveDecisionService({authorization:access}).decide;
 async function context(req) {
  if (!enabled) throw invalid('Bot chưa được bật.',404);
  const identity = verifyInitData(req.body && req.body.initData,token,now && now());
  const user = await getManager(identity.id);
  if (!user || String(user.telegramId) !== String(identity.id)) throw invalid('Tài khoản Telegram chưa có quyền quản lý nghỉ phép.');
  const id = req.body.requestId; const version = req.body.expectedVersion;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || !/^(0|[1-9]\d*)$/.test(String(version ?? ''))) throw invalid('Yêu cầu không hợp lệ.',400);
  const request = await leaveRepo.getLeaveRequestById(id,[BRANCHES.HANOI,BRANCHES.SAIGON]);
  if (!request) throw invalid('Không tìm thấy yêu cầu.',404);
  const currentUser = await access.authorize(user,request);
  if(String(currentUser.telegramId)!==String(identity.id))throw invalid('Liên kết Telegram đã thay đổi.');
  if (request.loai_yeu_cau !== 'Xin nghỉ phép') throw invalid('Bot chỉ xử lý yêu cầu Xin nghỉ phép.',400);
  if (!['Chưa duyệt','Vi phạm'].includes(request.trang_thai) || String(request.decision_version) !== String(version)) throw invalid('Yêu cầu đã thay đổi hoặc đã kết thúc. Hãy mở lại thông báo mới nhất.',409);
  return {user:currentUser,request,expectedVersion:String(version)};
 }
 function route(path, handler) { router.post(path,async (req,res) => {
  res.set('Cache-Control','no-store');
  try { const ctx = await context(req); return res.json(await handler(ctx,req)); }
  catch(error) { return res.status(error.statusCode || 503).json({error:error.statusCode ? error.message : 'Chưa thể lưu. Hãy thử lại.'}); }
 }); }
 route('/api/telegram/manager-leave/miniapp/context',async ({request}) => ({request:{request_id:request.request_id,ho_ten:request.ho_ten,bo_phan:request.bo_phan,co_so:request.co_so,thoi_gian_bat_dau:request.thoi_gian_bat_dau,thoi_gian_ket_thuc:request.thoi_gian_ket_thuc,decision_version:String(request.decision_version)}}));
 route('/api/telegram/manager-leave/miniapp/reject',async ({user,request,expectedVersion},req) => {
  if (req.body.note != null && typeof req.body.note !== 'string') throw invalid('Lý do phải là chuỗi ký tự.',400);
  const note = (req.body.note || '').trim(); if(note.length > 500) throw invalid('Lý do tối đa 500 ký tự.',400);
  const updated = await decision({requestId:request.request_id,user,status:'Từ chối',note,channel:'telegram',expectedVersion});
  return {ok:true,status:updated.trang_thai};
 });
 return router;
}
module.exports = {verifyInitData,createManagerLeaveMiniApp};
