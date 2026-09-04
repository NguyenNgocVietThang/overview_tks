'use strict';

const OUT_OF_STOCK_LEVEL = 0; // dashboardData.js:10

// statusFilter: 'all' | true | false. true/false map truc tiep vao
// products.is_active (dashboardData.js dung nhan text 'Dang kinh doanh'/
// 'Ngung kinh doanh' doc tu Sheet, con productsSync.js ghi thang bool
// IsActive cua KiotViet vao is_active - xem kiotvietSync/entities/productsSync.js:78).
async function getProductsSection(pool, branchId, statusFilter) {
  const activeParam = statusFilter === 'all' ? null : statusFilter;

  const { rows: productRows } = await pool.query(
    `SELECT p.id, p.product_code AS code, p.name, p.is_active,
            COALESCE(inv.on_hand, 0) AS stock,
            COALESCE(inv.reserved, 0) AS reserved,
            COALESCE(inv.stock_value, 0) AS stock_value,
            root.root_name AS category_name
     FROM products p
     LEFT JOIN LATERAL (
       SELECT SUM(on_hand) AS on_hand, SUM(reserved) AS reserved, SUM(on_hand * COALESCE(cost, 0)) AS stock_value
       FROM product_inventory
       WHERE product_id = p.id
     ) inv ON true
     LEFT JOIN LATERAL (
       WITH RECURSIVE cat_root AS (
         SELECT id, name, parent_category_id FROM categories WHERE id = p.category_id
         UNION ALL
         SELECT c.id, c.name, c.parent_category_id
         FROM categories c JOIN cat_root cr ON c.id = cr.parent_category_id
       )
       SELECT name AS root_name FROM cat_root WHERE parent_category_id IS NULL
     ) root ON true
     WHERE p.branch_id = $1
       AND ($2::boolean IS NULL OR p.is_active = $2)
     ORDER BY stock DESC`,
    [branchId, activeParam]
  );

  let totalStock = 0;
  let inStockCodes = 0;
  let activeProducts = 0;
  let inactiveProducts = 0;
  const lowStock = [];
  const categoryMap = new Map();

  const allProducts = productRows.map((r) => {
    const stock = Number(r.stock);
    const reserved = Number(r.reserved);
    totalStock += stock;
    if (stock > 0) inStockCodes++;
    if (r.is_active) activeProducts++; else inactiveProducts++;
    if (stock === OUT_OF_STOCK_LEVEL) {
      lowStock.push({ code: r.code, name: r.name, status: r.is_active ? 'Đang kinh doanh' : 'Ngừng kinh doanh' });
    }

    const categoryName = r.category_name || 'Chưa xác định';
    if (!categoryMap.has(categoryName)) {
      categoryMap.set(categoryName, { name: categoryName, stock: 0, stockValue: 0, productCount: 0 });
    }
    const cat = categoryMap.get(categoryName);
    cat.stock += Math.max(stock, 0);
    cat.stockValue += Number(r.stock_value);
    cat.productCount += 1;

    return {
      code: r.code,
      name: r.name,
      stock,
      reserved,
      status: r.is_active ? 'Đang kinh doanh' : 'Ngừng kinh doanh'
    };
  });

  const withPct = allProducts.map((p) => ({
    ...p,
    pct: totalStock > 0 ? (p.stock / totalStock) * 100 : 0
  }));

  lowStock.sort((a, b) => a.code.localeCompare(b.code));

  const categoryList = Array.from(categoryMap.values());
  const stockByCategory = categoryList.filter((c) => c.stock > 0).sort((a, b) => b.stock - a.stock);
  const stockValueByCategory = categoryList
    .filter((c) => c.stockValue > 0 || c.stock > 0)
    .sort((a, b) => b.stockValue - a.stockValue || b.stock - a.stock);

  return {
    totalProducts: productRows.length,
    activeProducts,
    inactiveProducts,
    totalStock,
    inStockCodes,
    lowStock,
    allProducts: withPct,
    stockByCategory,
    stockValueByCategory
  };
}

module.exports = { getProductsSection };
