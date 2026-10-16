-- Yeu cau chuyen tien cho khach (2026-10-15). Thay Google Sheet "Yêu cầu ck cho khách":
-- bot Telegram (repo bot-yeu-cau-ck) day yeu cau len qua /api/transfer-bot/* (khoa bi mat),
-- Ke toan sua/duyet tren /transfers/, nguoi co quyen transfers.markPaid quet VietQR roi bam
-- "Đã chuyển". Bot hoi /api/transfer-bot/events de nhan su kien (fetch -> luu -> ack).
--
-- Luong trang thai: CHO_DUYET -> DA_DUYET -> DA_CHUYEN; DA_DUYET -> CHO_DUYET (bo duyet);
-- CHO_DUYET|DA_DUYET -> DA_HUY; DA_CHUYEN -> DA_DUYET (chi admin thu hoi, co ly do).
-- DA_HUY la trang thai cuoi.

-- Danh muc ngan hang theo ma BIN NAPAS (nguon: api.vietqr.io/v2/banks, 2026-10-15).
-- aliases da "fold" (bo dau, chu thuong, bo ky tu khac chu/so, bo tien to "nganhang"/"tmcp").
CREATE TABLE bank_bins (
  bin         TEXT PRIMARY KEY CHECK (bin ~ '^\d{6}$'),
  code        TEXT NOT NULL,
  short_name  TEXT NOT NULL,
  name        TEXT NOT NULL,
  aliases     TEXT[] NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO bank_bins (bin, code, short_name, name, aliases) VALUES
  ('970415', 'ICB', 'VietinBank', 'Ngân hàng TMCP Công thương Việt Nam', ARRAY['congthuong', 'congthuongvietnam', 'ctg', 'icb', 'vietin', 'vietinbank']::text[]),
  ('970436', 'VCB', 'Vietcombank', 'Ngân hàng TMCP Ngoại Thương Việt Nam', ARRAY['ngoaithuong', 'ngoaithuongvietnam', 'vcb', 'vietcom', 'vietcombank']::text[]),
  ('970418', 'BIDV', 'BIDV', 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam', ARRAY['bidv', 'dautuphattrien', 'dautuphattrienvietnam', 'dautuvaphattrienvietnam']::text[]),
  ('970405', 'VBA', 'Agribank', 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam', ARRAY['agri', 'agribank', 'nongnghiep', 'nongnghiepphattriennongthonvietnam', 'nongnghiepvaphattriennongthonvietnam', 'vba']::text[]),
  ('970448', 'OCB', 'OCB', 'Ngân hàng TMCP Phương Đông', ARRAY['ocb', 'phuongdong']::text[]),
  ('970422', 'MB', 'MBBank', 'Ngân hàng TMCP Quân đội', ARRAY['mb', 'mbbank', 'quandoi']::text[]),
  ('970407', 'TCB', 'Techcombank', 'Ngân hàng TMCP Kỹ thương Việt Nam', ARRAY['kythuongvietnam', 'tcb', 'techcom', 'techcombak', 'techcombang', 'techcombank']::text[]),
  ('970416', 'ACB', 'ACB', 'Ngân hàng TMCP Á Châu', ARRAY['acb', 'achau']::text[]),
  ('970432', 'VPB', 'VPBank', 'Ngân hàng TMCP Việt Nam Thịnh Vượng', ARRAY['vietnamthinhvuong', 'vp', 'vpb', 'vpbank']::text[]),
  ('970423', 'TPB', 'TPBank', 'Ngân hàng TMCP Tiên Phong', ARRAY['tienphong', 'tp', 'tpb', 'tpbank']::text[]),
  ('970403', 'STB', 'Sacombank', 'Ngân hàng TMCP Sài Gòn Tài Lộc', ARRAY['sacom', 'sacombank', 'saigontailoc', 'saigonthuongtin', 'stb']::text[]),
  ('970437', 'HDB', 'HDBank', 'Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh', ARRAY['hd', 'hdb', 'hdbank', 'phattrienthanhphohochiminh']::text[]),
  ('970454', 'VCCB', 'VietCapitalBank', 'Ngân hàng TMCP Bản Việt', ARRAY['banviet', 'bvbank', 'vccb', 'vietcapital', 'vietcapitalbank']::text[]),
  ('970429', 'SCB', 'SCB', 'Ngân hàng TMCP Sài Gòn', ARRAY['saigon', 'scb']::text[]),
  ('970441', 'VIB', 'VIB', 'Ngân hàng TMCP Quốc tế Việt Nam', ARRAY['quocte', 'quoctevietnam', 'vib']::text[]),
  ('970443', 'SHB', 'SHB', 'Ngân hàng TMCP Sài Gòn - Hà Nội', ARRAY['saigonhanoi', 'shb']::text[]),
  ('970431', 'EIB', 'Eximbank', 'Ngân hàng TMCP Xuất Nhập khẩu Việt Nam', ARRAY['eib', 'exim', 'eximbank', 'xuatnhapkhau', 'xuatnhapkhauvietnam']::text[]),
  ('970426', 'MSB', 'MSB', 'Ngân hàng TMCP Hàng Hải', ARRAY['hanghai', 'maritime', 'maritimebank', 'msb']::text[]),
  ('546034', 'CAKE', 'CAKE', 'TMCP Việt Nam Thịnh Vượng - Ngân hàng số CAKE by VPBank', ARRAY['cake', 'vietnamthinhvuongnganhangsocakebyvpbank']::text[]),
  ('546035', 'Ubank', 'Ubank', 'TMCP Việt Nam Thịnh Vượng - Ngân hàng số Ubank by VPBank', ARRAY['ubank', 'vietnamthinhvuongnganhangsoubankbyvpbank']::text[]),
  ('971005', 'VTLMONEY', 'ViettelMoney', 'Tổng Công ty Dịch vụ số Viettel - Chi nhánh tập đoàn công nghiệp viễn thông Quân Đội', ARRAY['tongcongtydichvusoviettelchinhanhtapdoancongnghiepvienthongquandoi', 'viettelmoney', 'vtlmoney']::text[]),
  ('963388', 'TIMO', 'Timo', 'Ngân hàng số Timo by Ban Viet Bank (Timo by Ban Viet Bank)', ARRAY['sotimobybanvietbanktimobybanvietbank', 'timo']::text[]),
  ('971011', 'VNPTMONEY', 'VNPTMoney', 'Trung tâm dịch vụ tài chính số VNPT- Chi nhánh Tổng công ty truyền thông (VNPT Fintech)', ARRAY['trungtamdichvutaichinhsovnptchinhanhtongcongtytruyenthongvnptfintech', 'vnptmoney']::text[]),
  ('970400', 'SGICB', 'SaigonBank', 'Ngân hàng TMCP Sài Gòn Công Thương', ARRAY['saigonbank', 'saigoncongthuong', 'sgicb']::text[]),
  ('970409', 'BAB', 'BacABank', 'Ngân hàng TMCP Bắc Á', ARRAY['bab', 'baca', 'bacabank']::text[]),
  ('971025', 'momo', 'MoMo', 'CTCP Dịch Vụ Di Động Trực Tuyến', ARRAY['ctcpdichvudidongtructuyen', 'momo', 'vimomo']::text[]),
  ('971133', 'PVDB', 'PVcomBank Pay', 'Ngân hàng số PVcomBank', ARRAY['pvcombankpay', 'pvdb', 'sopvcombank']::text[]),
  ('970412', 'PVCB', 'PVcomBank', 'Ngân hàng TMCP Đại Chúng Việt Nam', ARRAY['daichungvietnam', 'pvcb', 'pvcom', 'pvcombank']::text[]),
  ('970414', 'MBV', 'MBV', 'Ngân hàng TNHH MTV Việt Nam Hiện Đại', ARRAY['mbv', 'tnhhmtvvietnamhiendai']::text[]),
  ('970419', 'NCB', 'NCB', 'Ngân hàng TMCP Quốc Dân', ARRAY['ncb', 'quocdan']::text[]),
  ('970424', 'SHBVN', 'ShinhanBank', 'Ngân hàng TNHH MTV Shinhan Việt Nam', ARRAY['shbvn', 'shinhan', 'shinhanbank', 'tnhhmtvshinhanvietnam']::text[]),
  ('970425', 'ABB', 'ABBANK', 'Ngân hàng TMCP An Bình', ARRAY['abb', 'abbank', 'anbinh']::text[]),
  ('970427', 'VAB', 'VietABank', 'Ngân hàng TMCP Việt Á', ARRAY['vab', 'vieta', 'vietabank']::text[]),
  ('970428', 'NAB', 'NamABank', 'Ngân hàng TMCP Nam Á', ARRAY['nab', 'nama', 'namabank']::text[]),
  ('970430', 'PGB', 'PGBank', 'Ngân hàng TMCP Thịnh vượng và Phát triển', ARRAY['petrolimex', 'pg', 'pgb', 'pgbank', 'thinhvuongphattrien', 'thinhvuongvaphattrien']::text[]),
  ('970433', 'VIETBANK', 'VietBank', 'Ngân hàng TMCP Việt Nam Thương Tín', ARRAY['vietbank', 'vietnamthuongtin']::text[]),
  ('970438', 'BVB', 'BaoVietBank', 'Ngân hàng TMCP Bảo Việt', ARRAY['baoviet', 'baovietbank', 'bvb']::text[]),
  ('970440', 'SEAB', 'SeABank', 'Ngân hàng TMCP Đông Nam Á', ARRAY['dongnama', 'seab', 'seabank']::text[]),
  ('970446', 'COOPBANK', 'COOPBANK', 'Ngân hàng Hợp tác xã Việt Nam', ARRAY['coopbank', 'hoptacxavietnam']::text[]),
  ('970449', 'LPB', 'LPBank', 'Ngân hàng TMCP Lộc Phát Việt Nam', ARRAY['lienviet', 'lienvietpostbank', 'locphat', 'locphatvietnam', 'lpb', 'lpbank']::text[]),
  ('970452', 'KLB', 'KienLongBank', 'Ngân hàng TMCP Kiên Long', ARRAY['kienlong', 'kienlongbank', 'klb']::text[]),
  ('668888', 'KBank', 'KBank', 'Ngân hàng Đại chúng TNHH Kasikornbank', ARRAY['daichungtnhhkasikornbank', 'kbank']::text[]),
  ('533948', 'CITIBANK', 'Citibank', 'Ngân hàng Citibank, N.A. - Chi nhánh Hà Nội', ARRAY['citibank', 'citibanknachinhanhhanoi']::text[]),
  ('963326', 'TNEX', 'TNEX', 'TNEX by MSB', ARRAY['tnex', 'tnexbymsb']::text[]),
  ('999888', 'VBSP', 'VBSP', 'Ngân hàng Chính sách Xã hội', ARRAY['chinhsachxahoi', 'vbsp']::text[]),
  ('977777', 'MAFC', 'MAFC', 'Công ty Tài chính TNHH MTV Mirae Asset (Việt Nam) ', ARRAY['congtytaichinhtnhhmtvmiraeassetvietnam', 'mafc']::text[]),
  ('970467', 'KEBHANAHN', 'KEBHANAHN', 'Ngân hàng KEB Hana – Chi nhánh Hà Nội', ARRAY['kebhanachinhanhhanoi', 'kebhanahn']::text[]),
  ('970466', 'KEBHANAHCM', 'KEBHanaHCM', 'Ngân hàng KEB Hana – Chi nhánh Thành phố Hồ Chí Minh', ARRAY['kebhanachinhanhthanhphohochiminh', 'kebhanahcm']::text[]),
  ('555666', 'BIDC', 'BIDC', 'Ngân hàng Đầu Tư Và Phát Triển Campuchia - Chi nhánh Hà Nội', ARRAY['bidc', 'dautuvaphattriencampuchiachinhanhhanoi']::text[]),
  ('963666', 'BNP HCM', 'BNP HCM', 'Ngân hàng BNP Paribas – Chi nhánh Thành phố Hồ Chí Minh', ARRAY['bnphcm', 'bnpparibaschinhanhthanhphohochiminh']::text[]),
  ('963668', 'BNP HN', 'BNP HN', 'Ngân hàng BNP Paribas – Chi nhánh Hà Nội', ARRAY['bnphn', 'bnpparibaschinhanhhanoi']::text[]),
  ('963688', 'BOCHK', 'BOCHK', 'Ngân hàng Bank of China (Hong Kong) Limited – Chi nhánh Hồ Chí Minh', ARRAY['bankofchinahongkonglimitedchinhanhhochiminh', 'bochk']::text[]),
  ('970465', 'BSP', 'BSP', 'Ngân hàng SinoPac - Chi nhánh Thành phố Hồ Chí Minh', ARRAY['bsp', 'sinopacchinhanhthanhphohochiminh']::text[]),
  ('168999', 'CUBHCM', 'CUBHCM', 'Ngân hàng Cathay United Bank – Chi nhánh Hồ Chí Minh', ARRAY['cathayunitedbankchinhanhhochiminh', 'cubhcm']::text[]),
  ('963686', 'ESUN', 'ESUN', 'Ngân hàng Thương mại TNHH E.SUN – Chi nhánh Đồng Nai (ESUNBANK)', ARRAY['esun', 'thuongmaitnhhesunchinhanhdongnaiesunbank']::text[]),
  ('963669', 'ICBC', 'ICBC', 'Ngân hàng Công thương Trung Quốc – Chi nhánh thành phố Hà Nội', ARRAY['congthuongtrungquocchinhanhthanhphohanoi', 'icbc']::text[]),
  ('971032', 'MVAS', 'MVAS', 'Trung tâm Dịch vụ số Mobifone – Chi nhánh Tổng Công ty viễn thông Mobifone', ARRAY['mvas', 'trungtamdichvusomobifonechinhanhtongcongtyvienthongmobifone']::text[]),
  ('970444', 'CBB', 'CBBank', 'Ngân hàng Thương mại trách nhiệm hữu hạn một thành viên Ngoại thương Công nghệ số (Vietcombank Neo Limited)', ARRAY['cbb', 'cbbank', 'thuongmaitrachnhiemhuuhanmotthanhvienngoaithuongcongnghesovietcombankneolimited', 'xaydung']::text[]),
  ('970421', 'VRB', 'VRB', 'Ngân hàng Liên doanh Việt - Nga', ARRAY['liendoanhvietnga', 'vrb']::text[]),
  ('970439', 'PBVN', 'PublicBank', 'Ngân hàng TNHH MTV Public Việt Nam', ARRAY['pbvn', 'publicbank', 'tnhhmtvpublicvietnam']::text[]),
  ('801011', 'NHB HN', 'Nonghyup', 'Ngân hàng Nonghyup - Chi nhánh Hà Nội', ARRAY['nhbhn', 'nonghyup', 'nonghyupchinhanhhanoi']::text[]),
  ('970410', 'SCVN', 'StandardChartered', 'Ngân hàng TNHH MTV Standard Chartered Bank Việt Nam', ARRAY['scvn', 'standardchartered', 'tnhhmtvstandardcharteredbankvietnam']::text[]),
  ('422589', 'CIMB', 'CIMB', 'Ngân hàng TNHH MTV CIMB Việt Nam', ARRAY['cimb', 'tnhhmtvcimbvietnam']::text[]),
  ('970458', 'UOB', 'UnitedOverseas', 'Ngân hàng United Overseas - Chi nhánh TP. Hồ Chí Minh', ARRAY['unitedoverseas', 'unitedoverseaschinhanhtphochiminh', 'uob']::text[]),
  ('970406', 'Vikki', 'Vikki', 'Ngân hàng TNHH Một thành viên số Vikki', ARRAY['tnhhmotthanhviensovikki', 'vikki']::text[]),
  ('970434', 'IVB', 'IndovinaBank', 'Ngân hàng TNHH Indovina', ARRAY['indovinabank', 'ivb', 'tnhhindovina']::text[]),
  ('796500', 'DBS', 'DBSBank', 'DBS Bank Ltd - Chi nhánh Thành phố Hồ Chí Minh', ARRAY['dbs', 'dbsbank', 'dbsbankltdchinhanhthanhphohochiminh']::text[]),
  ('970408', 'GPB', 'GPBank', 'Ngân hàng Thương mại TNHH MTV Dầu Khí Toàn Cầu', ARRAY['gpb', 'gpbank', 'thuongmaitnhhmtvdaukhitoancau']::text[]),
  ('970457', 'WVN', 'Woori', 'Ngân hàng TNHH MTV Woori Việt Nam', ARRAY['tnhhmtvwoorivietnam', 'woori', 'wvn']::text[]),
  ('970462', 'KBHN', 'KookminHN', 'Ngân hàng Kookmin - Chi nhánh Hà Nội', ARRAY['kbhn', 'kookminchinhanhhanoi', 'kookminhn']::text[]),
  ('970463', 'KBHCM', 'KookminHCM', 'Ngân hàng Kookmin - Chi nhánh Thành phố Hồ Chí Minh', ARRAY['kbhcm', 'kookminchinhanhthanhphohochiminh', 'kookminhcm']::text[]),
  ('970456', 'IBK - HCM', 'IBKHCM', 'Ngân hàng Công nghiệp Hàn Quốc - Chi nhánh TP. Hồ Chí Minh', ARRAY['congnghiephanquocchinhanhtphochiminh', 'ibkhcm']::text[]),
  ('970455', 'IBK - HN', 'IBKHN', 'Ngân hàng Công nghiệp Hàn Quốc - Chi nhánh Hà Nội', ARRAY['congnghiephanquocchinhanhhanoi', 'ibkhn']::text[]),
  ('458761', 'HSBC', 'HSBC', 'Ngân hàng TNHH MTV HSBC (Việt Nam)', ARRAY['hsbc', 'tnhhmtvhsbcvietnam']::text[]),
  ('970442', 'HLBVN', 'HongLeong', 'Ngân hàng TNHH MTV Hong Leong Việt Nam', ARRAY['hlbvn', 'hongleong', 'tnhhmtvhongleongvietnam']::text[]);

CREATE TABLE transfer_requests (
  id                   BIGSERIAL PRIMARY KEY,
  request_code         TEXT NOT NULL UNIQUE CHECK (request_code ~ '^YC-\d{8}-\d{4,}$'),
  idempotency_key      TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  source               TEXT NOT NULL DEFAULT 'telegram' CHECK (source IN ('telegram', 'cutover')),
  input_kind           TEXT NOT NULL DEFAULT 'text' CHECK (input_kind IN ('text', 'qr_image', 'manual')),
  -- Sale: Telegram ID la khoa noi voi app_users.telegram_id; ten hien thi lay tu tai khoan
  -- web neu da gan, khong thi dung ten sale tu go trong bot (co the sai).
  sale_telegram_id     TEXT NOT NULL CHECK (sale_telegram_id ~ '^[1-9]\d{0,19}$'),
  sale_name_bot        TEXT NOT NULL DEFAULT '',
  customer_name        TEXT NOT NULL CHECK (length(btrim(customer_name)) BETWEEN 1 AND 150),
  amount_vnd           NUMERIC(15, 0) NOT NULL CHECK (amount_vnd > 0 AND amount_vnd < 1000000000000),
  bank_account         TEXT NOT NULL CHECK (bank_account ~ '^[0-9A-Za-z]{4,50}$'),
  account_type         TEXT NOT NULL DEFAULT 'ACCOUNT' CHECK (account_type IN ('ACCOUNT', 'CARD')),
  account_holder       TEXT NOT NULL CHECK (length(btrim(account_holder)) BETWEEN 1 AND 150),
  bank_bin             TEXT REFERENCES bank_bins (bin),   -- NULL = chua xac dinh, khong duyet duoc
  bank_name_raw        TEXT NOT NULL DEFAULT '',
  note                 TEXT NOT NULL DEFAULT '',
  accountant_note      TEXT NOT NULL DEFAULT '',
  qr_payload           TEXT,
  field_sources        JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(field_sources) = 'object'),
  status               TEXT NOT NULL DEFAULT 'CHO_DUYET'
                         CHECK (status IN ('CHO_DUYET', 'DA_DUYET', 'DA_CHUYEN', 'DA_HUY')),
  version              BIGINT NOT NULL DEFAULT 1,
  created_at           TIMESTAMPTZ NOT NULL,             -- luc sale bam Gui trong bot
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at          TIMESTAMPTZ,
  approved_by_user_id  TEXT,
  approved_by_name     TEXT,
  paid_at              TIMESTAMPTZ,
  paid_by_user_id      TEXT,
  paid_by_name         TEXT,
  canceled_at          TIMESTAMPTZ,
  canceled_by_type     TEXT CHECK (canceled_by_type IN ('SALE', 'ACCOUNTANT')),
  canceled_by_user_id  TEXT,
  canceled_by_name     TEXT,
  cancel_reason        TEXT,
  CHECK (status NOT IN ('DA_DUYET', 'DA_CHUYEN') OR (approved_at IS NOT NULL AND bank_bin IS NOT NULL)),
  CHECK (status <> 'DA_CHUYEN' OR (paid_at IS NOT NULL AND paid_by_name IS NOT NULL)),
  CHECK (status <> 'DA_HUY' OR (canceled_at IS NOT NULL AND canceled_by_type IS NOT NULL)),
  CHECK (canceled_by_type IS DISTINCT FROM 'ACCOUNTANT' OR length(btrim(coalesce(cancel_reason, ''))) > 0)
);

CREATE INDEX transfer_requests_status_idx ON transfer_requests (status, created_at DESC, id DESC);
CREATE INDEX transfer_requests_created_idx ON transfer_requests (created_at DESC, id DESC);
CREATE INDEX transfer_requests_sale_idx ON transfer_requests (sale_telegram_id, created_at DESC);

-- Rao chan cuoi cung o DB: tang version, chi cho phep buoc chuyen trang thai hop le,
-- thong tin chuyen tien chi sua duoc khi dang CHO_DUYET.
CREATE FUNCTION transfer_requests_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'DA_HUY' THEN
    RAISE EXCEPTION 'transfer request % is canceled', OLD.request_code;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'CHO_DUYET' AND NEW.status IN ('DA_DUYET', 'DA_HUY'))
    OR (OLD.status = 'DA_DUYET'  AND NEW.status IN ('CHO_DUYET', 'DA_CHUYEN', 'DA_HUY'))
    OR (OLD.status = 'DA_CHUYEN' AND NEW.status = 'DA_DUYET')
  ) THEN
    RAISE EXCEPTION 'invalid transfer status change % -> %', OLD.status, NEW.status;
  END IF;
  IF OLD.status = 'DA_CHUYEN' AND NEW.status = 'DA_CHUYEN' THEN
    RAISE EXCEPTION 'transfer request % is already paid', OLD.request_code;
  END IF;
  IF NOT (OLD.status = 'CHO_DUYET' AND NEW.status = 'CHO_DUYET') AND (
       NEW.customer_name  IS DISTINCT FROM OLD.customer_name
    OR NEW.amount_vnd     IS DISTINCT FROM OLD.amount_vnd
    OR NEW.bank_account   IS DISTINCT FROM OLD.bank_account
    OR NEW.account_type   IS DISTINCT FROM OLD.account_type
    OR NEW.account_holder IS DISTINCT FROM OLD.account_holder
    OR NEW.bank_bin       IS DISTINCT FROM OLD.bank_bin
    OR NEW.note           IS DISTINCT FROM OLD.note
  ) THEN
    RAISE EXCEPTION 'transfer details of % can only change while CHO_DUYET', OLD.request_code;
  END IF;
  IF NEW.request_code IS DISTINCT FROM OLD.request_code
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.sale_telegram_id IS DISTINCT FROM OLD.sale_telegram_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'transfer request identity is immutable';
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER transfer_requests_guard BEFORE UPDATE ON transfer_requests
  FOR EACH ROW EXECUTE FUNCTION transfer_requests_guard();

CREATE FUNCTION transfer_requests_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transfer requests cannot be deleted';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER transfer_requests_no_delete BEFORE DELETE ON transfer_requests
  FOR EACH ROW EXECUTE FUNCTION transfer_requests_no_delete();

-- Nhat ky thay doi (chi THEM). Moi thay doi cua yeu cau ghi dung 1 dong trong CUNG giao dich,
-- version = version moi cua yeu cau. Bot doc cac dong bot_delivered_at IS NULL roi ack.
CREATE TABLE transfer_request_events (
  id                BIGSERIAL PRIMARY KEY,
  request_id        BIGINT NOT NULL REFERENCES transfer_requests (id),
  version           BIGINT NOT NULL,
  event_type        TEXT NOT NULL CHECK (event_type IN
                      ('CREATED', 'IMPORTED', 'EDITED', 'APPROVED', 'UNAPPROVED', 'CANCELED', 'PAID', 'PAID_REVERTED')),
  actor_type        TEXT NOT NULL CHECK (actor_type IN ('SALE', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'SYSTEM')),
  actor_user_id     TEXT,
  actor_name        TEXT NOT NULL DEFAULT '',
  changes           JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changes) = 'array'),
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  bot_delivered_at  TIMESTAMPTZ,
  UNIQUE (request_id, version)
);
CREATE INDEX transfer_request_events_request_idx ON transfer_request_events (request_id, id);
CREATE INDEX transfer_request_events_undelivered_idx ON transfer_request_events (id) WHERE bot_delivered_at IS NULL;

CREATE FUNCTION transfer_request_events_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transfer request events are immutable';
  END IF;
  IF OLD.bot_delivered_at IS NOT NULL OR NEW.bot_delivered_at IS NULL
    OR (to_jsonb(NEW) - 'bot_delivered_at') IS DISTINCT FROM (to_jsonb(OLD) - 'bot_delivered_at') THEN
    RAISE EXCEPTION 'transfer request events are immutable';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER transfer_request_events_guard BEFORE UPDATE OR DELETE ON transfer_request_events
  FOR EACH ROW EXECUTE FUNCTION transfer_request_events_guard();

-- Chua so tai khoan ngan hang cua khach: khong lo qua Data API cua Supabase (server ket noi
-- bang chu so huu nen bo qua RLS) va khong cap cho reporting_readonly (migration 0010).
ALTER TABLE transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_request_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
  REVOKE SELECT ON transfer_requests, transfer_request_events FROM reporting_readonly;
 END IF;
END $$;
