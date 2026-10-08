'use strict';
const {getPool}=require('../db/pool');
const {validDate}=require('./hrLeaveTiming');
function invalid(message) {return Object.assign(new Error(message),{statusCode:400,code:'INVALID_WORK_SCHEDULE'});}
function validate(employeeId,date) {
 if (!/^[1-9]\d*$/.test(String(employeeId)) || !validDate(date)) throw invalid('Nhân sự hoặc ngày làm việc không hợp lệ.');
}
const DEFAULT_MORNING_START='07:45';
const DEFAULT_AFTERNOON_START='12:30';
// Giờ cố định cho mọi nhân viên; dòng lịch riêng (nếu có) ghi đè từng buổi.
function shape(row) {return row ? {employeeId:String(row.employee_id),date:row.work_date,morningStart:row.morning_start ? row.morning_start.slice(0,5) : DEFAULT_MORNING_START,afternoonStart:row.afternoon_start ? row.afternoon_start.slice(0,5) : DEFAULT_AFTERNOON_START,version:String(row.version)} : null;}
function withDefault(employeeId,date,schedule) {return schedule || {employeeId:String(employeeId),date,morningStart:DEFAULT_MORNING_START,afternoonStart:DEFAULT_AFTERNOON_START,version:'0'};}
const columns='employee_id::text AS employee_id,work_date::text AS work_date,morning_start::text AS morning_start,afternoon_start::text AS afternoon_start,version::text AS version';
function createHrLeaveWorkSchedulesRepository({pool=getPool()}={}) {
 async function getSchedule(employeeId,date) {validate(employeeId,date);return withDefault(employeeId,date,shape((await pool.query(`SELECT ${columns} FROM hr_leave_work_schedules WHERE employee_id=$1 AND work_date=$2::date`,[employeeId,date])).rows[0]));}
 async function setSchedule(employeeId,{date,morningStart,afternoonStart}={}) {
  validate(employeeId,date);
  for(const value of [morningStart,afternoonStart]) if(value!==null && (typeof value!=='string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) throw invalid('Giờ bắt đầu phải có dạng HH:mm hoặc null.');
  return shape((await pool.query(`INSERT INTO hr_leave_work_schedules(employee_id,work_date,morning_start,afternoon_start) VALUES($1,$2::date,$3::time,$4::time) ON CONFLICT(employee_id,work_date) DO UPDATE SET morning_start=excluded.morning_start,afternoon_start=excluded.afternoon_start RETURNING ${columns}`,[employeeId,date,morningStart,afternoonStart])).rows[0]);
 }
 async function getEmployee(employeeId) {
  if(!/^[1-9]\d*$/.test(String(employeeId))) throw invalid('Nhân sự không hợp lệ.');
  return (await pool.query('SELECT id::text AS id,branch,bo_phan,ho_ten FROM hr_employees WHERE id=$1 AND is_active',[employeeId])).rows[0] || null;
 }
 async function resolveEmployee({employeeId,username}={}) {
  if(employeeId!=null && String(employeeId)!=='') return getEmployee(employeeId);
  if(typeof username!=='string' || !username.trim()) throw invalid('Vui lòng chọn nhân sự đã liên kết để cấu hình lịch nghỉ.');
  return (await pool.query(`SELECT e.id::text AS id,e.branch,e.bo_phan,e.ho_ten,u.id AS user_id,u.username FROM app_users u JOIN hr_employees e ON e.id=u.hr_employee_id WHERE lower(u.username)=lower($1) AND NOT u.is_deleted AND u.trang_thai='Đang hoạt động' AND e.is_active`,[username.trim()])).rows[0] || null;
 }
 return {getSchedule,setSchedule,getEmployee,resolveEmployee};
}
const repository=createHrLeaveWorkSchedulesRepository();
module.exports={createHrLeaveWorkSchedulesRepository,...repository};
