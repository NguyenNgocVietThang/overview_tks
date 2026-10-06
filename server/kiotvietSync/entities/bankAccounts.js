'use strict';
const { value } = require('./entityUtils');

// Endpoint từng retailer riêng biệt nhưng ID tài khoản là khóa danh mục chung.
// Scheduler lấy mọi retailer đã cấu hình; branch chỉ là khóa checkpoint đồng bộ.
module.exports = {
  entity: 'cash_book_accounts', endpoint: 'bankaccounts', branchless: true,
  pollFullSnapshot: true, incrementalParam: null, hasUpperBound: false,
  async upsertPage(pgClient, _branch, items) {
    for (const item of items) {
      await pgClient.query(
        `INSERT INTO cash_book_accounts (id, bank_name, account_no, description, raw)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET bank_name=EXCLUDED.bank_name,
         account_no=EXCLUDED.account_no, description=EXCLUDED.description,
         raw=EXCLUDED.raw, synced_at=now()`,
        [value(item,'Id','id'),value(item,'BankName','bankName'),
         value(item,'AccountNumber','accountNumber'),value(item,'Description','description'),item]
      );
    }
  }
};
