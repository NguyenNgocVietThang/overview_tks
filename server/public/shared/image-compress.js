// ==========================================
// IMAGE-COMPRESS.JS — nén ảnh client-side bằng Canvas API.
// Không cần thư viện ngoài. Dùng chung cho dispatch.js và mobile.js.
//
// Cách dùng:
//   <script src="/shared/image-compress.js"></script>
//   const blob = await TKSImageCompress.compress(file, 1280, 0.7);
//   formData.append('file', blob, 'photo.jpg');
// ==========================================
(function () {
  'use strict';

  var TKSImageCompress = {};

  /**
   * Nén ảnh: resize cạnh dài về ≤ maxPx, encode JPEG với quality.
   * @param {File|Blob} file  — ảnh gốc
   * @param {number}    maxPx — cạnh dài tối đa (mặc định 1280)
   * @param {number}    quality — chất lượng JPEG 0–1 (mặc định 0.7)
   * @returns {Promise<Blob>}
   */
  TKSImageCompress.compress = function compress(file, maxPx, quality) {
    maxPx   = maxPx   || 1280;
    quality = quality || 0.7;

    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function (e) {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var w = img.naturalWidth;
          var h = img.naturalHeight;

          // Tính tỷ lệ thu nhỏ
          if (w > maxPx || h > maxPx) {
            var ratio = Math.min(maxPx / w, maxPx / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }

          var canvas = document.createElement('canvas');
          canvas.width  = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);

          canvas.toBlob(function (blob) {
            if (!blob) { reject(new Error('Không thể nén ảnh.')); return; }
            resolve(blob);
          }, 'image/jpeg', quality);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  };

  window.TKSImageCompress = TKSImageCompress;
})();
