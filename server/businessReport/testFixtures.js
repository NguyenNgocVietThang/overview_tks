'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Du lieu mau dung chung cho test PGlite cua Bao cao kinh doanh (migration 0036 + bang KiotViet toi thieu).

const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '0036_business_monthly_sales.sql'), 'utf8');
const TEAMS_MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '0037_sale_teams.sql'), 'utf8');
const BASE = `
  CREATE TABLE customers(branch text, id bigint, code text, name text, raw jsonb);
  CREATE TABLE products(branch text, id bigint, code text, name text);
  CREATE TABLE invoices(branch text, id bigint, code text, purchase_date timestamptz, total numeric, status int, raw jsonb);
  CREATE TABLE invoice_details(branch text, invoice_id bigint, line_no int, product_id bigint, quantity numeric, price numeric, discount numeric, raw jsonb);
  CREATE TABLE returns(branch text, id bigint, code text, return_date timestamptz, total numeric, status int, raw jsonb);
  CREATE TABLE return_details(branch text, return_id bigint, line_no int, product_id bigint, quantity numeric, price numeric, raw jsonb);`;

async function seed(db) {
  await db.exec(BASE + MIGRATION + TEAMS_MIGRATION);
  await db.exec(`
    INSERT INTO customers VALUES
      ('hanoi', 1, 'KH1', 'Chị A', '{"groups":"Khang","comments":"Level 2"}'),
      ('saigon', 2, 'KH1', 'Anh B', '{"groups":"Trinh"}'),
      ('hanoi', 3, 'KH2', 'Cô C', '{}');
    INSERT INTO products VALUES ('hanoi', 10, 'SP1', 'Khay'), ('hanoi', 11, 'SP2', 'Bình');
    -- HD1 (HN, KH1, 30/09 23:00 gio VN): 2 dong 600+400 = 1000, giam ca don 100 => total 900
    INSERT INTO invoices VALUES ('hanoi', 101, 'HD1', '2026-09-30 23:00:00+00', 900, 1, '{"statusValue":"Hoàn thành","customerCode":"KH1","customerName":"Chị A"}');
    INSERT INTO invoice_details VALUES
      ('hanoi', 101, 1, 10, 2, 300, 0, '{"productCode":"SP1","subTotal":600}'),
      ('hanoi', 101, 2, 11, 1, 400, 0, '{"productCode":"SP2","subTotal":400}');
    -- HD2 (01/10 00:30 gio VN) thuoc thang 10, khong duoc tinh vao thang 9
    INSERT INTO invoices VALUES ('hanoi', 102, 'HD2', '2026-10-01 00:30:00+00', 500, 1, '{"statusValue":"Hoàn thành","customerCode":"KH1"}');
    INSERT INTO invoice_details VALUES ('hanoi', 102, 1, 10, 1, 500, 0, '{"productCode":"SP1","subTotal":500}');
    -- HD3 da huy: bo qua; HD4 khong ma KH, khop theo ten "Cô C" => KH2
    INSERT INTO invoices VALUES ('hanoi', 103, 'HD3', '2026-09-10 10:00:00+00', 777, 2, '{"statusValue":"Đã hủy","customerCode":"KH1"}');
    INSERT INTO invoices VALUES ('hanoi', 104, 'HD4', '2026-09-11 10:00:00+00', 200, 1, '{"statusValue":"Hoàn thành","customerName":"Cô C"}');
    INSERT INTO invoice_details VALUES ('hanoi', 104, 1, 11, 1, 200, 0, '{"productCode":"SP2","subTotal":200}');
    -- Tra hang TH1 thang 9 cua KH1 HN: dong 100, giam gia tra 10 => total 90
    INSERT INTO returns VALUES ('hanoi', 201, 'TH1', '2026-09-15 09:00:00+00', 90, 1, '{"statusValue":"Đã trả","customerCode":"KH1"}');
    INSERT INTO return_details VALUES ('hanoi', 201, 1, 10, 1, 100, '{"productCode":"SP1","subTotal":100}');`);
}

// Snapshot gia (dung cho test service / routes / export), cung dang voi repository.snapshot().
function serviceSnapshot() {
  return {
    today: '2026-10-06', currentMonth: '2026-10-01', day: 6,
    months: ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'],
    frozenMonths: ['2026-07-01', '2026-08-01', '2026-09-01'],
    computedAt: '2026-10-06T03:00:00.000Z',
    directory: [
      { branch: 'hanoi', code: 'KH1', name: 'Chị A', saleName: 'Khang', priceLevel: 'Level 2' },
      { branch: 'saigon', code: 'KH1', name: 'Anh B', saleName: 'Khang', priceLevel: '' },
      { branch: 'hanoi', code: 'KH2', name: 'Cô C', saleName: 'Chưa phân nhóm', priceLevel: '' },
      { branch: 'hanoi', code: 'KH9', name: 'Cũ', saleName: 'Trinh', priceLevel: '' }
    ],
    teams: [{ saleName: 'Khang', teamName: 'Team Khang' }, { saleName: 'Trinh', teamName: 'Team Trinh' }],
    customers: [
      { month: '2026-09-01', branch: 'hanoi', customerCode: 'KH1', customerName: 'Chị A', netRevenue: 500 },
      { month: '2026-10-01', branch: 'hanoi', customerCode: 'KH1', customerName: 'Chị A', netRevenue: 100 },
      { month: '2026-08-01', branch: 'saigon', customerCode: 'KH1', customerName: 'Anh B', netRevenue: 300 },
      { month: '2026-10-01', branch: 'hanoi', customerCode: '', customerName: 'Khách lẻ', netRevenue: 60 },
      { month: '2026-03-01', branch: 'hanoi', customerCode: 'KH9', customerName: 'Cũ', netRevenue: 999 }
    ],
    sales: [
      { month: '2026-08-01', saleName: 'Khang', netRevenue: 300 },
      { month: '2026-09-01', saleName: 'Khang', netRevenue: 500 }
    ],
    products: [
      { month: '2026-09-01', productCode: 'SP1', productName: 'Khay', netRevenue: 400, netQty: 4 },
      { month: '2026-10-01', productCode: 'SP1', productName: 'Khay', netRevenue: 160, netQty: 2 }
    ]
  };
}

module.exports = { seed, serviceSnapshot };
