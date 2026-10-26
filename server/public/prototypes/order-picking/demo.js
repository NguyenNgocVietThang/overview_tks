window.PickingDemo = {
  orders: [
    { branch:'HN', orderCode:'DH-DEMO-001', customerName:'Cửa hàng Minh Anh · mô phỏng', saleName:'Nguyễn Hà', status:{code:'SENT_TO_ACCOUNTANT',label:'Đơn đã gửi kế toán'}, lines:[{productCode:'ADN3LYU',productName:'Ấm đun nước YUSSAIN 3L',quantity:30},{productCode:'BN2L',productName:'Bình giữ nhiệt 2L',quantity:45},{productCode:'0012',productName:'Đèn bàn',quantity:12}] },
    { branch:'HN', orderCode:'DH-DEMO-002', customerName:'Gia dụng An Phát · mô phỏng', saleName:'Trần Linh', status:{code:'SENT_TO_ACCOUNTANT',label:'Đơn đã gửi kế toán'}, lines:[{productCode:'BN2L',productName:'Bình giữ nhiệt 2L',quantity:120},{productCode:'CHUA-VT',productName:'Sản phẩm chưa có vị trí',quantity:6}] },
    { branch:'SG', orderCode:'DH-DEMO-003', customerName:'Cửa hàng Tân Bình · mô phỏng', saleName:'Lê An', status:{code:'SENT_TO_ACCOUNTANT',label:'Đơn đã gửi kế toán'}, lines:[{productCode:'ADN3LYU',productName:'Ấm đun nước YUSSAIN 3L',quantity:15}] },
    { branch:'HN', orderCode:'DH-DEMO-004', customerName:'Gia dụng Phương Nam · mô phỏng', saleName:'Nguyễn Hà', status:{code:'NOT_SENT',label:'Đơn chưa gửi kế toán'}, lines:[{productCode:'BN2L',productName:'Bình giữ nhiệt 2L',quantity:10}] }
  ],
  locations: [
    {branch:'HN',code:'ADN3LYU',location:'A01',available:20,notes:'2T x 10',arrivalDate:'15/10/2026'},
    {branch:'HN',code:'ADN3LYU',location:'B02',available:12,notes:'1T x 12',arrivalDate:'18/10/2026'},
    {branch:'HN',code:'ADN3LYU',location:'C03',available:8,notes:'1T x 8',arrivalDate:'20/10/2026'},
    {branch:'HN',code:'BN2L',location:'A01',available:70,notes:'7T x 10',arrivalDate:'12/10/2026'},
    {branch:'HN',code:'BN2L',location:'B02',available:50,notes:'5T x 10',arrivalDate:'19/10/2026'},
    {branch:'HN',code:'BN2L',location:'C03',available:40,notes:'4T x 10',arrivalDate:'20/10/2026'},
    {branch:'HN',code:'0012',location:'D04',available:12,notes:'1T x 12',arrivalDate:'17/10/2026'},
    {branch:'SG',code:'ADN3LYU',location:'E36',available:null,totalQuantity:'15',notes:'Cần xác nhận tồn thực tế; TỔNG SL đã đi không phải tồn',arrivalDate:'03/10/2026'}
  ]
};

// Additional orders share ONE location ledger per branch, never a stock copy per order.
(function(){
  const products=[
    {code:'COC123',carton:250,name:'Cốc thủy tinh 123',stock:[12000, 10000, 9000, 3000, 1000],stockSG:[8000, 7000, 5000, 2000, 800],price:3500,note:'40T x 250'},
    {code:'BINH500',carton:100,name:'Bình nước 500 ml',stock:[500, 420, 320, 100, 40],stockSG:[300, 240, 160, 80, 30],price:18000,note:'Thùng 100 chiếc'},
    {code:'HOP1000',carton:200,name:'Hộp thực phẩm 1.000 ml',stock:[1300, 1100, 960, 300, 100],stockSG:[750, 650, 450, 200, 80],price:6500,note:'Thùng 200 chiếc'},
    {code:'KEP78',carton:600,name:'Móc phơi đồ 1 kẹp K78',stock:[2200, 1700, 1230, 500, 300],stockSG:[1100, 900, 500, 300, 200],price:690,note:'Thùng 600 chiếc'},
    {code:'KHAN30',carton:100,name:'Khăn lau đa năng 30 cm',stock:[600, 500, 300, 150, 100],stockSG:[300, 250, 150, 100, 60],price:4200,note:'Thùng 100 chiếc'},
    {code:'THAU28',carton:60,name:'Thau nhựa 28 cm',stock:[300, 230, 150, 80, 40],stockSG:[150, 110, 80, 50, 30],price:12000,note:'Kiện 60 chiếc'},
    {code:'KETO3',carton:30,name:'Kệ để đồ 3 tầng',stock:[270, 230, 160, 60, 30],stockSG:[120, 90, 70, 40, 20],price:29000,note:'Thùng 30 chiếc'},
    {code:'BANCHAIGC',carton:300,name:'Bàn chải đánh răng GC',stock:[1400, 1100, 780, 300, 200],stockSG:[600, 500, 350, 200, 100],price:1800,note:'Thùng 300 chiếc'}
  ];
  /* Ghi chú hàng hóa là nguồn SL: mỗi khu một quy cách, chọn SL/thùng lớn nhất trong danh sách chia hết SL của khu. */
  const cartonNote=(qty,preferred)=>{const per=[preferred,500,250,200,100,60,50,30,25,20,10,5,2,1].find(p=>p&&qty%p===0);return qty/per+'T x '+per;};
  for(const branch of ['HN','SG'])products.forEach((product,i)=>(branch==='HN'?product.stock:product.stockSG).forEach((qty,j)=>{
    window.PickingDemo.locations.push({branch,code:product.code,location:['A','B','C','D','E'][j]+String(i+5).padStart(2,'0'),available:qty,notes:cartonNote(qty,product.carton),arrivalDate:'20/10/2026'});
  }));
  // Ví dụ thùng của người dùng: ABC ở hai khu khác quy cách (1T x 50 và 1T x 60), DEF một khu 1T x 50, cùng mã ở SG khu riêng.
  window.PickingDemo.locations.push(
    {branch:'HN',code:'ABC',location:'A01',available:50,notes:'1T x 50',arrivalDate:'20/10/2026'},
    {branch:'HN',code:'ABC',location:'B02',available:60,notes:'1T x 60',arrivalDate:'20/10/2026'},
    {branch:'HN',code:'DEF',location:'D01',available:50,notes:'1T x 50',arrivalDate:'20/10/2026'},
    {branch:'SG',code:'ABC',location:'A01',available:120,notes:'2T x 60',arrivalDate:'20/10/2026'},
    {branch:'HN',code:'GHI',location:'E05',available:100,notes:'1Tx50 + 2Tx25',arrivalDate:'20/10/2026'});
  window.PickingDemo.orders.push({branch:'HN',orderCode:'DH-DEMO-013',customerName:'Ví dụ thùng ABC/DEF · mô phỏng',saleName:'Nguyễn Hà',status:{code:'SENT_TO_ACCOUNTANT',label:'Đơn đã gửi kế toán'},lines:[{productCode:'ABC',productName:'Mặt hàng ABC',quantity:100,price:5000},{productCode:'DEF',productName:'Mặt hàng DEF',quantity:25,price:7000}]});
  const cases=[
    {id:'005',branch:'HN',name:'TEST TỒN · Đơn 1 · Minh Anh',qty:[10000,300,800,1200,300,180,120,600]},
    {id:'006',branch:'HN',name:'TEST TỒN · Đơn 2 · An Phát',qty:[10000,450,1000,1500,400,200,150,900]},
    {id:'007',branch:'HN',name:'Gia dụng Hoàng Mai',qty:[3000,120,300,600,100,60,30,300]},
    {id:'008',branch:'HN',name:'Siêu thị Văn Quán',qty:[2000,180,200,300,150,90,60,600]},
    {id:'009',branch:'HN',name:'Cửa hàng Long Biên',qty:[1000,50,400,900,200,120,90,150]},
    {id:'010',branch:'HN',name:'Gia dụng Hà Đông',qty:[5000,200,600,1200,250,150,180,900]},
    {id:'011',branch:'SG',name:'TEST TỒN SG · Đơn 1 · Tân Phú',qty:[10000,300,800,1200,300,180,120,600]},
    {id:'012',branch:'SG',name:'TEST TỒN SG · Đơn 2 · Bình Tân',qty:[10000,450,1000,1500,400,200,150,900]}
  ];
  for(const item of cases)window.PickingDemo.orders.push({
    branch:item.branch,orderCode:'DH-DEMO-'+item.id,customerName:item.name+' · mô phỏng',saleName:item.branch==='HN'?'Nguyễn Hà':'Lê An',
    status:{code:'SENT_TO_ACCOUNTANT',label:'Đơn đã gửi kế toán'},invoiceDiscount:0,priorDebt:0,
    note:'Dữ liệu thử tồn kho sỉ dùng chung. COC123: HN ban đầu 35.000 trải trên 5 khu A–E; đơn 005 lấy đủ 10.000 thì đơn 006 còn khả dụng 24.990. SG là nguồn tồn riêng.',
    lines:products.map((p,i)=>({productCode:p.code,productName:p.name,quantity:item.qty[i],price:p.price,note:p.note}))
  });
})();

// ID Telegram của sale: KiotViet lưu kèm trong tên ("<tên> - <ID>"), bản in ghi lại cạnh tên.
// Dữ liệu mô phỏng — không phải ID Telegram thật của ai.
(function(){
  const SALE_TELEGRAM = { 'Nguyễn Hà':'1000000001', 'Trần Linh':'1000000002', 'Lê An':'1000000003' };
  for (const order of window.PickingDemo.orders)
    order.saleTelegramId = order.saleTelegramId || SALE_TELEGRAM[order.saleName] || '';
})();
