<div class="printBox">
  <div class="invoice-top">
    <table cellpadding="1" cellspacing="1" border="0" style="width: 100%" data-table-controls="off" data-table-sort="off" class="invoice-header">
      <tbody>
        <tr>
          <td class="invoice-order" style="text-align:left; width:53%">
            <p><span style=""><strong class="invoice-title">PHIẾU ĐẶT HÀNG</strong></span><br><span style="">Mã đơn hàng:&nbsp;</span><span style=""><strong>{Ma_Don_Hang}</strong></span><br></p>
            <table cellpadding="3" width="100%" style="border-collapse: collapse; width: 100%;" data-table-controls="off" data-table-sort="off" class="invoice-qr">
              <tbody>
                <tr>
                  <td><img alt="Mã QR thanh toán Nguyễn Văn Quân" src="https://cdn2-retail-images.kiotviet.vn/2026/10/05/chhanoi/f21f9e7c2de54f74ae9f4e20fd1a5b72.jpg"></td>
                  <td><img alt="Mã QR thanh toán Đặng Thị Anh Nguyệt" src="https://cdn2-retail-images.kiotviet.vn/2026/10/05/chhanoi/319a40a6042c42d8b060b8de556be120.jpg"></td>
                  <td><img alt="Mã QR thanh toán Nguyễn Ngọc Duy" src="https://cdn2-retail-images.kiotviet.vn/2026/10/05/chhanoi/ea96abd2bef74b4e89dc164eb814dba2.jpg"></td>
                </tr>
              </tbody>
            </table>
          </td>
          <td class="invoice-business" style="text-align:left; width:47%">
            <p><span style=""><strong class="invoice-brand">KHO SỈ TOKOSI</strong></span><br><span style="">Đ/c: Cụm CN Cầu Nổi, Hoài Đức, HN<br>ĐT: 0903 255 456 - 0343 468 468</span></p>
            <p class="invoice-seller">NV Bán hàng: <span style="">{Nhan_Vien_Ban_Hang}</span>&nbsp;|
              Zalo:&nbsp;{Dien_Thoai_Nguoi_Ban}</p>
          </td>
        </tr>
      </tbody>
    </table>
    <table style="margin: 10px 0px 15px; width: 100%;" data-table-controls="off" data-table-sort="off" class="invoice-customer">
      <tbody>
        <tr>
          <td style="text-align:left"><span style="">Khách hàng: {Khach_Hang}</span></td>
          <td style="width:3%">&nbsp;</td>
          <td style="text-align:left;width:40%"><span style="">SĐT khách: {So_Dien_Thoai}</span></td>
        </tr>
        <tr>
          <td colspan="3" style="text-align:left"><span style="">Địa chỉ: {Dia_Chi_Khach_Hang}</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <table cellpadding="3" cellspacing="0" border="1" style="border-collapse: collapse; width: 100%" data-table-controls="off" data-table-sort="off" class="invoice-goods"><colgroup><col style="width: 4%;"><col style="width: 22%;"><col style="width: 8%;"><col style="width: 9%;"><col style="width: 11%;"><col style="width: 11%;"><col style="width: 14%;"><col style="width: 11%;"><col style="width: 10%;"></colgroup><thead><tr>

        <td style="text-align: center; border-color: rgb(0, 0, 0);">
          <span style=""><strong>TT</strong></span></td>
        <td style="text-align: center; border-color: rgb(0, 0, 0);">
          <span style=""><strong>Tên hàng</strong></span></td>
        <td style="text-align: center; border-color: rgb(0, 0, 0);">
          <span style=""><strong>SL</strong></span></td>
        <td style="text-align: center; border-color: rgb(0, 0, 0);">
          <span style=""><strong>Đơn giá</strong></span></td>
        <td style="text-align: center; border-color: rgb(0, 0, 0);">
          <span style=""><strong>Thành tiền</strong></span></td>
        <td style="text-align: center; border-color: rgb(0, 0, 0);">
          <span style=""><strong>Ghi chú</strong></span></td>
        <td style="text-align: center; border-color: rgb(0, 0, 0);">
          <span style=""><strong>Vị trí</strong></span></td>
        <td style="text-align: center; border-color: rgb(0, 0, 0);" class="invoice-st">Thùng</td>
        <td style="">
          <p style="text-align: center;"><span style=""><strong>Thực nhặt</strong></span></p>
        </td>
      </tr></thead>
    <tbody>
      
      <tr>
        
        <td style="text-align: center; border-color: rgb(0, 0, 0);">
          <span style="">{STT}</span></td>
        <td style="border-color: rgb(0, 0, 0);">
          <span style="">{Ten_Hang_Hoa_Don_Gian}</span></td>
        <td style="text-align: right; border-color: rgb(0, 0, 0);">
          <span style="">{So_Luong}</span></td>
        <td style="text-align: right; border-color: rgb(0, 0, 0);">
          <span style="">{Don_Gia_Sau_Chiet_Khau}</span></td>
        <td style="text-align: right; border-color: rgb(0, 0, 0);">
          <span style="">{Thanh_Tien}</span></td>
        <td style="text-align: center; border-color: rgb(0, 0, 0);">
          <span style="">{Ghi_Chu_Hang_Hoa}</span></td>
        <td style="text-align: center; border-color: rgb(0, 0, 0);" class="invoice-location">
          <span style="">{Vi_Tri_Hang_Hoa}</span></td>
        <td style="text-align: right; border-color: rgb(0, 0, 0);" class="invoice-st">{ST}</td>
        <td style="" class="invoice-actual">{Thuc_Te_Nhat}</td>
      </tr>
    </tbody>
  </table>
</div>

<div class="printBox invoice-footer">
  <table cellpadding="1" cellspacing="1" border="0" style="width: 100%" data-table-controls="off" data-table-sort="off" class="invoice-summary"><colgroup><col style="width: 47%;"><col style="width: 20%;"><col style="width: 5%;"><col style="width: 28%;"></colgroup>
    <tbody>
      
      <tr>
        <td style="text-align: right;"><span style="">Tổng tiền hàng:&nbsp;</span></td>
        <td style="text-align: right;"><span style="">{Tong_Tien_Hang}</span></td>
        <td style="border-right: medium;"><br></td>
        <td style="text-align: right;">
          <p style="text-align: center;"><span style=""><strong><u>Người nhận
                  hàng</u></strong><u>&nbsp;</u></span></p>
        </td>
      </tr>
      <tr>
        <td style="text-align: right;"><span style="">Giảm giá hóa đơn:</span></td>
        <td style="text-align: right;"><span style="">{Chiet_Khau_Hoa_Don}</span></td>
        <td style="border-right: medium;"><br></td>
        <td style="text-align: right;">
          <p style="text-align: center;"></p>
        </td>
      </tr>
      <tr>
        <td style="text-align: right;"><span style=""><strong>Tổng thanh toán:</strong></span>
        </td>
        <td style="text-align: right;"><span style=""><strong>{Tong_Cong}</strong></span></td>
        <td style="border-right: medium;"><br></td>
        <td style="text-align: right;">&nbsp;</td>
      </tr>
      <tr>
        <td style="text-align: right;"><span style="">Công nợ cũ:</span></td>
        <td style="text-align: right;"><span style="">&nbsp;{Du_No_Truoc}</span></td>
        <td style="border-right: medium;"><br></td>
        <td style="text-align: right;">&nbsp;</td>
      </tr>
      <tr>
        <td style="text-align: right;"><span style=""><strong>Tổng công nợ:</strong></span>
        </td>
        <td style="text-align: right;"><span style=""><strong>{Du_No_Tam_Tinh}</strong></span>
        </td>
        <td style="border-right: medium;"><br></td>
        <td style="text-align: right;">&nbsp;</td>
      </tr>
    </tbody>
  </table>
  <p class="invoice-notes"><strong><u>Ghi chú: {Ghi_Chu}</u></strong></p>
  <table style="margin-top: 20px; width: 100%" data-table-controls="off" data-table-sort="off" class="invoice-signatures">
    <tbody>
      <tr>
        <td>&nbsp;</td>
        <td style="font-style:italic; text-align:center"><span style=""><em>Ngày {Ngay} tháng {Thang}
              năm {Nam}</em></span></td>
      </tr>
      <tr>
        <td width="50%" style="text-align:center"><span style=""><strong>Nhân viên nhặt
              hàng</strong></span></td>
        <td style="text-align:center"><span style=""><strong>Nhân viên xuất hàng</strong></span></td>
      </tr>
    </tbody>
  </table>
</div>



<p style="text-align: center;" class="invoice-notice"><span style=""><strong><em>Lưu
        ý: Vui lòng&nbsp;kiểm hàng thừa/thiếu/vỡ trong vòng 3 ngày.<br>Nếu có vấn đề vui lòng báo lại <u>kèm
          ảnh/video</u> nhận hàng.&nbsp;Xin cảm ơn !</em></strong></span></p>
