'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const repo = require('./hrLeaveRepository');
const { buildLeaveRequestsWorkbook } = require('./hrLeaveExportService');
const { BRANCHES } = require('../branch/branches');

async function withFakeLeaveRequests(items, fn) {
  const original = repo.getLeaveRequests;
  repo.getLeaveRequests = async () => items;
  try {
    await fn();
  } finally {
    repo.getLeaveRequests = original;
  }
}

test('buildLeaveRequestsWorkbook: header freeze, khong to mau, chu den, an gridline, full border', async () => {
  await withFakeLeaveRequests([{ request_id: 'R1', ho_ten: 'Nguyễn Văn A' }], async () => {
    const { buffer, fileName } = await buildLeaveRequestsWorkbook({}, BRANCHES.HANOI);
    assert.match(fileName, /^HN_nghi-phep_/);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];

    assert.equal(sheet.views[0].state, 'frozen');
    assert.equal(sheet.views[0].ySplit, 1);
    assert.equal(sheet.views[0].showGridLines, false);

    const header = sheet.getRow(1);
    assert.equal(header.font.color.argb, 'FF000000');
    header.eachCell(cell => {
      assert.equal(cell.fill === undefined || cell.fill.pattern === 'none', true);
      assert.ok(cell.border && cell.border.top && cell.border.left && cell.border.bottom && cell.border.right);
    });

    const dataRow = sheet.getRow(2);
    dataRow.eachCell(cell => {
      assert.ok(cell.border && cell.border.top && cell.border.left && cell.border.bottom && cell.border.right);
    });
  });
});

test('buildLeaveRequestsWorkbook: ten file gan tien to SG_ cho co so Sai Gon', async () => {
  await withFakeLeaveRequests([], async () => {
    const { fileName } = await buildLeaveRequestsWorkbook({}, BRANCHES.SAIGON);
    assert.match(fileName, /^SG_nghi-phep_/);
  });
});
