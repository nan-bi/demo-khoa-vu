# Backend nội bộ — Dashboard Khoa Vú v8

Node.js **22.14 trở lên**, Python **3.12**, SQLite tích hợp trong Node. Cài thư viện dữ liệu bằng `CAI-DAT-DU-LIEU-PYTHON.cmd`; không cần máy chủ cơ sở dữ liệu riêng. Không có lời gọi AI/cloud/HIS hoặc API bên ngoài. Các đường dẫn `/api/...` là giao tiếp nội bộ giữa dashboard và máy chủ này.

## Chạy trên máy

Trước lần chạy đầu, cài `npm ci`, chạy **CAI-DAT-DU-LIEU-PYTHON.cmd** và `npm run build`.

1. Chạy **TAO-TAI-KHOAN.cmd** ở thư mục v8. Nhập tên đăng nhập, vai trò `admin`, mật khẩu ít nhất 12 ký tự và xác nhận. Mật khẩu không hiện khi nhập. Không có tài khoản/mật khẩu mặc định.
2. Chạy **CHAY-BACKEND.cmd**.
3. Mở **http://127.0.0.1:4180/** và đăng nhập. Giữ cửa sổ máy chủ mở.
4. Tạo tài khoản `editor`, `reviewer`, `viewer` bằng cùng lệnh tạo tài khoản nếu cần. Dừng máy chủ bằng Ctrl+C.

Lệnh Terminal tương đương, chạy ở thư mục dự án:

```powershell
node backend/manage.mjs create-user
npm run backend
```

Nếu chỉnh code frontend, chạy `npm run build` trước khi mở backend. Bản clone từ Git không có `dist`; chạy `npm ci` và `npm run build` để tạo bản chạy. Node có thể in cảnh báo SQLite experimental ở phiên bản 22; đây là thông báo của runtime.

## Hai chế độ dữ liệu

Bản hiện tại tích hợp speech trong dashboard 4180, nhưng ca/bản nháp speech lưu IndexedDB ở 4173; không lưu cùng SQLite báo cáo. Xem README gốc để cài và chạy chung.

| Địa chỉ | Nguồn lưu | Tài khoản |
|---|---|---|
| 4173, CHAY-DEMO.cmd | localStorage riêng của trình duyệt | Vai trò mô phỏng |
| 4180, CHAY-BACKEND.cmd | SQLite trên máy chủ | Đăng nhập, kiểm tra quyền phía server |

Kho SQLite mới bắt đầu trống, không tự nạp dữ liệu dịch vụ. Kho đã có tiếp tục được giữ nguyên khi mở lại. Các chỉnh sửa/import đã lưu trong trình duyệt ở cổng 4173 **không tự chuyển** vào cơ sở dữ liệu mới. Cổng 4180 có kho riêng; chọn đúng chế độ khi làm việc. Việc đổi tên giao diện không tự biến dữ liệu giả lập thành dữ liệu HIS.

Dashboard ở chế độ backend lưu kho báo cáo, chỉnh sửa, cấu hình gói, snapshot và nhãn model vào SQLite. Trình duyệt gửi file Excel/CSV tới backend loopback; Python đọc trong bộ nhớ, chuẩn hóa và trả bản xem trước. Chỉ khi xác nhận, các dòng và nguồn truy vết mới được ghi vào SQLite qua kiểm tra quyền, revision và quy tắc phía server. Không lưu bytes file gốc lâu dài trên server. Nhãn đã xác nhận lưu cùng cấu hình kho; dự đoán model đơn lẻ không đủ căn cứ tính tiền.

## Phân quyền

| Vai trò | Đọc/xuất | Nhập/sửa/đối soát/gán nhãn | Tạo/gửi bản nháp | Duyệt/trả lại | Quản lý tài khoản và nhật ký hệ thống |
|---|---|---|---|---|---|
| admin | Có | Có | Có | Có | Có |
| editor | Có | Có | Có | Không | Không |
| reviewer | Có | Không | Không | Có | Không |
| viewer | Có | Không | Không | Không | Không |

Quyền đọc hiện áp dụng toàn bộ kho chung của Khoa Vú, **chưa giới hạn theo từng phòng hoặc từng bệnh nhân**. Admin có thể đổi góc nhìn vai trò trên giao diện; server vẫn kiểm tra tài khoản thực. Người dùng khác không đổi vai trò qua dropdown. Có thể quản lý danh sách/tạo tài khoản qua lệnh CLI; chưa có trang quản trị tài khoản riêng.

## Cấu trúc

```text
backend/
  server.mjs        HTTP nội bộ, phiên đăng nhập, phục vụ dashboard build
  database.mjs      Khởi tạo bảng SQLite, transaction, audit
  auth.mjs          Hash mật khẩu scrypt, phiên 8 giờ
  workspace.mjs     Phân quyền ghi, kiểm tra dòng, khóa revision và snapshot
  manage.mjs        Tạo tài khoản, liệt kê, sao lưu
  .env.example     Danh sách biến cấu hình tham khảo
  data/            SQLite/WAL, không đưa vào Git
src/features/backend/
  BackendGate.jsx  Đăng nhập và chọn chế độ dữ liệu
  client.mjs       Giao tiếp nội bộ, đồng bộ trạng thái
```

Bảng `users` lưu tài khoản/role, `sessions` lưu hash token phiên, `workspace` lưu trạng thái có revision, `snapshots` lưu báo cáo đã duyệt, `review_state` lưu nhãn, `audit` lưu sự kiện với danh tính thực. Kho v1 dùng JSON trong SQLite để tương thích dashboard hiện tại, chưa phải mô hình dữ liệu quan hệ cho HIS quy mô lớn.

Các lần ghi chạy trong transaction SQLite và kiểm tra revision; nguồn cũ trả 409. Snapshot tính lại ở server từ nguồn đã đối soát, không tin tổng tiền từ trình duyệt. Khóa nguồn giữ nguyên khi có bản nháp/chờ duyệt/đã duyệt. Nhật ký sửa giá lấy chênh lệch trước/sau từ server, kèm người dùng thật. Lịch sử và báo cáo lưu trữ không được ghi đè qua giao diện. Bảng audit là nhật ký ứng dụng, chưa chống chỉnh sửa trực tiếp bởi người có quyền quản trị file SQLite.

## Đường dẫn nội bộ

| Phương thức | Đường dẫn | Chức năng |
|---|---|---|
| GET | /api/health | Kiểm tra máy chủ, trả trạng thái và cờ setupRequired, không lộ dữ liệu |
| POST | /api/auth/login | Đăng nhập (giới hạn brute-force theo cả IP và tên tài khoản) |
| GET | /api/auth/session | Người dùng/CSRF/hạn phiên |
| POST | /api/auth/change-password | Người dùng đổi mật khẩu hiện tại (thu hồi phiên cũ) |
| POST | /api/auth/logout | Thu hồi phiên làm việc |
| GET / PUT | /api/workspace | Đọc/ghi trạng thái kèm expectedRevision |
| GET | /api/catalog | Danh mục dịch vụ |
| GET / PUT | /api/reviews | Đọc/gán nhãn, khóa revision riêng |
| GET | /api/snapshots | Danh sách snapshot đã duyệt |
| GET | /api/snapshots/:id | Snapshot cụ thể (bảo vệ ký tự đặc biệt/mã hóa URL) |
| GET / POST | /api/admin/users | Liệt kê / tạo tài khoản (admin) |
| PATCH | /api/admin/users/:id | Bật/tắt tài khoản (active), cập nhật vai trò (admin) |
| POST | /api/admin/users/:id/reset-password | Đặt lại mật khẩu tài khoản (admin) |
| GET | /api/admin/audit?before=ID | Nhật ký hệ thống 100 sự kiện/trang (admin) |

Phiên dùng cookie HttpOnly, SameSite=Strict; request ghi cần cùng origin và `X-CSRF-Token`. Token CSRF lấy từ login/session; không lưu token đăng nhập trong localStorage. Đăng nhập sai bị giới hạn kép theo IP và username (10 lần/15 phút, tự dọn dẹp bộ đếm). Toàn bộ HTTP headers bảo mật nâng cao được áp dụng: Content-Security-Policy (CSP), Permissions-Policy, Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy, X-Frame-Options: DENY và X-Content-Type-Options: nosniff. Cơ sở dữ liệu SQLite kích hoạt `PRAGMA secure_delete=FAST` đảm bảo dữ liệu nhạy cảm đã xóa được ghi đè vật lý trên đĩa.

## Quản trị và Lệnh dòng lệnh (CLI)

```powershell
# Tạo tài khoản mới (mật khẩu >= 12 ký tự, kết hợp nhóm ký tự)
node backend/manage.mjs create-user

# Đổi mật khẩu tài khoản
node backend/manage.mjs change-password

# Khóa / kích hoạt tài khoản
node backend/manage.mjs deactivate-user <username>
node backend/manage.mjs activate-user <username>

# Xem danh sách tài khoản
node backend/manage.mjs users

# Xem nhật ký kiểm toán (audit log) gần nhất
node backend/manage.mjs audit 50

# Sao lưu cơ sở dữ liệu an toàn (VACUUM INTO)
node backend/manage.mjs backup "D:/VinMecBackup/vinmec-backup.sqlite"
```

## Sao lưu và khôi phục

Cơ sở dữ liệu mặc định: `backend/data/vinmec.sqlite`. Không xóa file `.sqlite-wal` khi máy chủ đang chạy.

Tạo bản sao nhất quán bằng lệnh sau, chọn đường dẫn file mới trong thư mục đã có:

```powershell
node backend/manage.mjs backup "D:/VinMecBackup/vinmec-2026-11-12.sqlite"
```

Lệnh dùng SQLite `VACUUM INTO`, không sao chép thô database đang ghi, và từ chối ghi đè file đã tồn tại. Bản sao có cả tài khoản, nhãn và lịch sử, cần được bảo quản như dữ liệu gốc. Thử mở bản sao bằng `VINMEC_DB` ở một máy chủ kiểm thử. Để khôi phục, dừng máy chủ rồi cấu hình đường dẫn tới bản sao; không ghi đè database đang mở.

## Cấu hình triển khai nội bộ

`.env.example` chỉ là tài liệu tham khảo; máy chủ không tự nạp `.env`. Dùng biến môi trường PowerShell:

```powershell
$env:VINMEC_PORT='4180'
$env:VINMEC_DB='D:/VinMecData/vinmec.sqlite'
node backend/server.mjs
```

Mặc định chỉ lắng nghe loopback `127.0.0.1`; chưa mở ra LAN. Khi triển khai máy chủ nội bộ thật, quản trị hạ tầng cấu hình địa chỉ bind bằng `VINMEC_HOST`, HTTPS/reverse proxy và quyền truy cập mạng. Đặt `VINMEC_SECURE_COOKIE=1` khi người dùng truy cập qua HTTPS. Database không được phục vụ qua HTTP; chỉ `dist` là thư mục tĩnh.

## Kiểm tra

```powershell
node --test tests/backend.test.mjs
npm test
npm run build
```

Test dùng SQLite/tài khoản tạm riêng, không thêm tài khoản thử nghiệm vào cơ sở dữ liệu người dùng. Bao gồm đăng nhập/đăng xuất, CSRF/origin, vượt quyền, ghi stale, bảo toàn mã, số liệu snapshot do server tính, lịch sử bất biến, nhãn model, restart và sao lưu.
