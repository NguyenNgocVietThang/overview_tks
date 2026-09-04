'use strict';

const { parseKiotVietDateTime } = require('../vietnamTime');

function pick(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
}

function parseModifiedDate(raw) {
  return raw ? parseKiotVietDateTime(raw) : null;
}

async function upsertCustomer(pool, branch, customer) {
  const kiotvietId = pick(customer, ['id', 'Id', 'customerId', 'CustomerId']);
  const customerCode = pick(customer, ['code', 'Code', 'customerCode', 'CustomerCode']);
  const name = pick(customer, ['name', 'Name', 'customerName', 'CustomerName']);
  const contactNumber = pick(customer, ['contactNumber', 'ContactNumber']);
  const subContactNumber = pick(customer, ['subContactNumber', 'SubContactNumber', 'subNumber', 'SubNumber']);
  const address = pick(customer, ['address', 'Address']);
  const organization = pick(customer, ['organization', 'Organization']);
  const groupNames = pick(customer, ['groups', 'Groups', 'groupName', 'GroupName']);
  const gender = pick(customer, ['gender', 'Gender']);
  const birthday = pick(customer, ['birthDate', 'BirthDate']);
  const debt = pick(customer, ['debt', 'Debt', 'totalDebt', 'TotalDebt']) || 0;
  const totalInvoiced = pick(customer, ['totalInvoiced', 'TotalInvoiced']) || 0;
  const totalRevenue = pick(customer, ['totalRevenue', 'TotalRevenue']) || 0;
  const modifiedAt = parseModifiedDate(pick(customer, ['modifiedDate', 'ModifiedDate']));

  await pool.query(
    `INSERT INTO customers (
       branch_id, kiotviet_id, customer_code, name, contact_number, sub_contact_number,
       address, organization, customer_group_names, gender, birthday,
       debt_amount, total_invoiced, total_revenue, kiotviet_modified_at, kiotviet_synced_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), now())
     ON CONFLICT (branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL DO UPDATE SET
       customer_code = EXCLUDED.customer_code,
       name = EXCLUDED.name,
       contact_number = EXCLUDED.contact_number,
       sub_contact_number = EXCLUDED.sub_contact_number,
       address = EXCLUDED.address,
       organization = EXCLUDED.organization,
       customer_group_names = EXCLUDED.customer_group_names,
       gender = EXCLUDED.gender,
       birthday = EXCLUDED.birthday,
       debt_amount = EXCLUDED.debt_amount,
       total_invoiced = EXCLUDED.total_invoiced,
       total_revenue = EXCLUDED.total_revenue,
       kiotviet_modified_at = EXCLUDED.kiotviet_modified_at,
       kiotviet_synced_at = now(),
       updated_at = now()`,
    [
      branch.id, kiotvietId, customerCode, name, contactNumber, subContactNumber,
      address, organization, groupNames, gender, birthday,
      debt, totalInvoiced, totalRevenue, modifiedAt
    ]
  );
  return 1;
}

function buildQuery(sinceIso) {
  const query = { includeTotal: 'true', includeCustomerGroup: 'true', includeCustomerSocial: 'true' };
  if (sinceIso) query.lastModifiedFrom = sinceIso;
  return query;
}

async function syncCustomers(pool, kiotVietClient, branch, sinceIso, options = {}) {
  let fetched = 0;
  let upserted = 0;

  await kiotVietClient.fetchAllPages('customers', buildQuery(sinceIso), async (items, meta) => {
    fetched += items.length;
    for (const item of items) {
      upserted += await upsertCustomer(pool, branch, item);
    }
    if (options.onProgress && meta && typeof meta.nextItem === 'number') {
      await options.onProgress(meta.nextItem);
    }
  }, { startItem: options.startItem || 0 });

  return { fetched, upserted };
}

module.exports = { syncCustomers, upsertCustomer };
