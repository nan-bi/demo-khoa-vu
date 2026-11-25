# Dashboard Khoa Vú · VMTC-KHOA-VU

Hệ thống dashboard nội bộ chạy hoàn toàn **local / offline** phục vụ nhập và đối soát dữ liệu dịch vụ, tính toán doanh thu theo phạm vi Khoa Vú, lập báo cáo giao ban (Excel & PowerPoint) và chép lời đọc kết quả siêu âm bằng giọng nói tiếng Việt. Không sử dụng API AI đám mây, không gửi dữ liệu bệnh nhân ra ngoài máy nội bộ.

> **Cập nhật 25/11/2026 (v8):** Gia cố bảo mật toàn diện (NIST SP 800-63B, CSP, dual rate-limiter, SQLite secure delete), tối ưu nhận dạng giọng nói cho môi trường nhiễu quạt gió 0 dB / micro yếu / giọng đọc dồn dập, bổ sung hậu xử lý thuật ngữ y tế và phân loại nhóm dịch vụ từ lời đọc.

---

## 1. Tính năng chính

- **Tổng quan, chi tiết & biểu đồ doanh thu:** Lọc theo ngày/khoảng ngày, bóc tách sản lượng và doanh thu theo từng dịch vụ, truy nguồn từng dòng dữ liệu gốc, chỉnh sửa có lý do bắt buộc và lưu lịch sử kiểm toán.
- **Nhập Excel/CSV hoặc thư mục đa sheet:** Tự động đọc nhiều sheet, xem trước và đối chiếu trước khi xác nhận; chống trùng tệp bằng SHA-256, phát hiện và cách ly dòng nghi trùng hoặc thiếu căn cứ.
- **AI phân loại doanh thu & dịch vụ local:**
  - Mô hình Naive Bayes offline (`src/features/intelligence/revenueAI.mjs`) học từ cặp `khoa chỉ định / khoa thực hiện` đã xác nhận. Phạm vi doanh thu chuẩn là **dịch vụ do Khoa Vú chỉ định (nội khoa và gửi ngoại khoa)**.
  - Tự động nhận diện 7 nhóm dịch vụ Khoa Vú được nhắc tới trong văn bản đọc (`detectServiceFromSpeech`: Siêu âm, X-quang vú, MRI/CT, Can thiệp/tiểu phẫu, Khám vú, Giải phẫu bệnh/di truyền, Phẫu thuật).
- **Bóc tách dịch vụ & gói combo:** Phân tách chính xác Khám, Siêu âm vú, X-quang 2D/3D theo từng cơ chế giá: `SKTQ`, `SLUT 1` (khám + siêu âm), `SLUT 2` (khám + X-quang + siêu âm) và `CK/lẻ`.
- **Xuất báo cáo giao ban đồng nhất:** Chốt snapshot dữ liệu đã đối soát, xuất Excel theo mẫu chuẩn và slide PowerPoint giao ban từ cùng một nguồn đã khóa.
- **Đọc kết quả siêu âm offline (PhoWhisper-small INT8):** Thu âm trực tiếp trên trình duyệt, hiển thị bản nháp theo thời gian thực khi đang đọc, hậu xử lý chuẩn hóa đơn vị đo (`mm`, `cm`, `×`) và thuật ngữ chuyên khoa (`BI-RADS`, `Doppler`, `sinh thiết`, `giải phẫu`...) có ghi log minh bạch cho bác sĩ rà soát.

---

## 2. Yêu cầu hệ thống & Cài đặt

- **Node.js:** phiên bản `>= 22.14` (kèm `npm`)
- **Python:** phiên bản `3.12` (dùng cho pipeline dữ liệu và speech local)
- **Trình duyệt:** Chrome hoặc Edge truy cập địa chỉ local để cấp quyền micro

> Internet chỉ cần ở bước cài đặt thư viện và tải model lần đầu. Sau khi hoàn tất, toàn bộ xử lý dữ liệu và nhận dạng giọng nói chạy 100% offline.

```powershell
git clone https://github.com/nan-bi/VMTC-KHOA-VU.git
cd VMTC-KHOA-VU
npm ci
.\CAI-DAT-DU-LIEU-PYTHON.cmd
npm run build
```

*Lưu ý: Kho Git không đóng gói `dist/`, `node_modules/`, model AI hoặc môi trường `.speech-venv/`. Bắt buộc chạy `npm run build` sau khi clone; không mở trực tiếp file HTML bằng cách nhấp đúp.*

---

## 3. Khởi chạy hệ thống

### 3.1. Tạo tài khoản và chạy Dashboard

```powershell
node backend/manage.mjs create-user
npm run backend
```

Hoặc trên Windows sử dụng `TAO-TAI-KHOAN.cmd` rồi `CHAY-BACKEND.cmd`. Sau đó mở trình duyệt tại **`http://127.0.0.1:4180/`**.

- Tài khoản quản trị (`admin`) yêu cầu mật khẩu dài từ 12 ký tự trở lên đáp ứng chính sách NIST SP 800-63B.
- Quản lý tài khoản và nhật ký qua CLI:
  - `node backend/manage.mjs change-password`
  - `node backend/manage.mjs deactivate-user` / `activate-user`
  - `node backend/manage.mjs audit`
  - `node backend/manage.mjs backup`

### 3.2. Chạy Dashboard tích hợp Speech-to-Text

1. Chạy **`CAI-DAT-SPEECH.cmd`** một lần để tạo `.speech-venv`, tải và lượng tử hóa PhoWhisper-small sang INT8 CPU.
2. Chạy **`CHAY-DASHBOARD-SPEECH.cmd`**.
3. Đăng nhập **`http://127.0.0.1:4180/`** và chọn mục **Đọc kết quả siêu âm**.

| Cổng | Thành phần | Vai trò |
| :--- | :--- | :--- |
| `4180` | Dashboard Backend (Node.js + SQLite) | Xác thực, phân quyền, kho dữ liệu, đối soát & báo cáo |
| `4173` | Speech UI + Loopback Proxy | Thu micro, hiển thị bản chép, lưu nháp trình duyệt (IndexedDB) |
| `4181` | PhoWhisper Local Server (Python) | Tiền xử lý tín hiệu, VAD, giải mã WAV trong bộ nhớ RAM |

---

## 4. Đường ống xử lý giọng nói & Môi trường nhiễu

Để đảm bảo tính ổn định trong điều kiện phòng khám có tiếng quạt gió lớn (0 dB SNR), micro độ nhạy thấp hoặc bác sĩ đọc dồn dập:

1. **Phía trình duyệt ([`local-dictation.mjs`](src/features/speech/local-dictation.mjs)):**
   - Kích hoạt `autoGainControl: true`, `echoCancellation: true`, `noiseSuppression: true` từ WebRTC.
   - Chèn bộ lọc thông cao **`BiquadFilterNode` ($85\text{ Hz}, Q = 0.7$)** loại bỏ tiếng ù động cơ quạt và nhiễu điện lưới $50\text{ Hz}$ trước khi đóng gói PCM.
   - **Adaptive Noise Floor Tracker:** tự động bám mức ồn nền động ($\text{clamp}(0.008, 0.035, \text{noiseFloor} \times 1.35)$) để không bị kẹt bộ đếm im lặng khi quạt kêu to.
   - Rút ngắn ngưỡng ngắt câu xuống **`450 ms`** (sau tối thiểu $1.2\text{ s}$ đọc) để bắt kịp nhịp đọc dồn dập.
2. **Phía server ([`speech-server.py`](scripts/speech-server.py), [`speech_config.py`](scripts/speech_config.py)):**
   - Khử trôi DC và rung tần số thấp $< 85\text{ Hz}$ bằng phép tích chập NumPy.
   - **Dynamic Peak Gain Boost:** tự động khuếch đại tín hiệu micro yếu ($0.01 < \text{peak} < 0.5$) lên mức mục tiêu $0.75$ (tối đa $5\times$ / $+14\text{ dB}$), chống méo/vỡ âm.
   - Tinh chỉnh **Silero VAD** (`threshold=0.45`, `min_speech_duration_ms=100`, `min_silence_duration_ms=450`, `speech_pad_ms=350`) bảo toàn phụ âm đầu và âm tiết đơn ngắn.
3. **Hậu xử lý an toàn y khoa ([`speech_postprocess.py`](scripts/speech_postprocess.py)):**
   - Chuẩn hóa đơn vị đo (`mi li mét` → `mm`, `centi mét` → `cm`, `nhân` → `×`) và các lỗi phát âm phổ biến (`bai rát` → `BI-RADS`, `sinh tiệc` → `sinh thiết`...).
   - Mọi thay đổi được ghi rõ vào `corrections[]`; phát hiện lặp từ ảo giác hoặc mất dấu tiếng Việt sẽ bật cảnh báo cho bác sĩ đối soát chứ **không tự động sửa nội dung lâm sàng mơ hồ**.

---

## 5. Bảo mật hệ thống

- **Xác thực & Mật khẩu ([`backend/auth.mjs`](backend/auth.mjs)):** Băm `scrypt` ($N=16384, r=8, p=1$), kiểm tra độ phức tạp theo chuẩn NIST SP 800-63B (tối thiểu 12 ký tự, phân loại ký tự), hỗ trợ thu hồi toàn bộ phiên đăng nhập khi đổi mật khẩu hoặc vô hiệu hóa tài khoản.
- **Chống tấn công Brute-force & HTTP ([`backend/server.mjs`](backend/server.mjs)):** `LoginRateLimiter` giới hạn đồng thời theo IP và tên đăng nhập; kiểm tra `Content-Length` trước khi đọc body; chặn `Prototype Pollution`; từ chối URI sai định dạng (`400 Bad Request`).
- **Headers bảo mật nghiêm ngặt:** Đầy đủ `Content-Security-Policy`, `frame-ancestors 'none'`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`.
- **Cơ sở dữ liệu local ([`backend/database.mjs`](backend/database.mjs)):** Bật `PRAGMA secure_delete = FAST`, giới hạn quyền thư mục dữ liệu `0o700`, tối ưu chỉ mục cho bảng `sessions` và `audit`.

---

## 6. Nơi lưu dữ liệu & Giới hạn nhập nguồn

| Dữ liệu | Nơi lưu | Đưa lên Git |
| :--- | :--- | :--- |
| Nguồn nhập, cấu hình, báo cáo, tài khoản | SQLite trong `backend/data/` | Không |
| Ca bệnh & bản nháp speech | IndexedDB tại origin `http://127.0.0.1:4173` | Không |
| Âm thanh thu âm khi nhận dạng | Bộ nhớ RAM tạm thời (xóa ngay sau khi chép) | Không |
| Model PhoWhisper & môi trường Python | `speech-models/`, `.speech-venv/` | Không |
| Dữ liệu tổng hợp & fixtures kiểm thử | `data_gialap/`, `tests/fixtures/` | Có (dữ liệu giả lập) |

**Giới hạn nhập nguồn:** tối đa 100 MB/file, 100 file hoặc 500 MB/lần chọn thư mục, 100.000 dòng/sheet và toàn kho nguồn; JSON state backend tối đa 256 MB.

---

## 7. Cấu trúc thư mục

```text
src/
  features/reports/       Tính doanh thu, bóc tách combo, đối soát, xuất Excel/PPT
  features/intelligence/  Nhập liệu, routing khoa, revenueAI & nhận diện dịch vụ
  features/speech/        Thu âm Web Audio, streaming loopback & kho IndexedDB
backend/                  HTTP server, xác thực, phân quyền, SQLite & CLI quản trị
scripts/                  PhoWhisper server, tiền/hậu xử lý audio, launcher & công cụ đo
tests/                    Kiểm thử tự động Node.js và Python
docs/                     Tài liệu vận hành, kiểm toán và quy chuẩn kỹ thuật
```

---

## 8. Kiểm thử & Xây dựng

```powershell
# Chạy toàn bộ 286 kiểm thử Node.js
npm test

# Chạy toàn bộ 99 kiểm thử Python
.\.speech-venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"

# Đóng gói bản production
npm run build
```

**Trạng thái kiểm chứng hiện tại:**
- **Node.js Test Runner:** `286 / 286` đạt (0 lỗi)
- **Python Unit Tests:** `99 / 99` đạt (0 lỗi)
- **Vite Production Build:** thành công

---

## 9. Phạm vi sử dụng & Tài liệu liên quan

Hệ thống hiện hoạt động độc lập, chưa kết nối trực tiếp HIS/EMR hoặc chữ ký số. Speech-to-text dù đã được lọc nhiễu và hậu xử lý vẫn là công cụ hỗ trợ — **bác sĩ cần rà soát kỹ bên vú (trái/phải), từ phủ định, số đo/đơn vị và phân độ BI-RADS** trước khi chốt kết quả lâm sàng.

- [Backend và phân quyền](backend/README.md)
- [AI phân loại doanh thu local](docs/AI-DOANH-THU-LOCAL.md)
- [PhoWhisper local và cách đối chiếu](docs/33-PHOWHISPER.md)
- [Bóc tách dịch vụ / combo](docs/16-BOC-TACH-DICH-VU-COMBO.md)
- [Vận hành nội bộ và lưu ca trình duyệt](docs/20-VAN-HANH-NOI-BO.md)
- [Báo cáo doanh thu các khoa](docs/35-DOANH-THU-CAC-KHOA.md)
