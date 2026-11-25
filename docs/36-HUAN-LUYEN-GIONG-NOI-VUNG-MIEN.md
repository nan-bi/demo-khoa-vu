# Lộ trình huấn luyện AI Speech-to-Text vượt rào cản vùng miền & tiếng ồn + Kiểm soát doanh thu 99,99%

> **Nguyên tắc an toàn y khoa:** Không có mô hình STT hay AI nào đạt 100% tuyệt đối về mặt vật lý trong môi trường phòng khám ồn ào. Để kết quả xuất ra đạt **≥ 99,99%**, hệ thống kết hợp **AI cục bộ (offline) + Cảnh báo tin cậy thấp tức thì + Đối chiếu 1 chạm của thư ký y khoa / bác sĩ**.

---

## Phần 1: Vượt rào cản giọng vùng miền & tiếng ồn (Speech-to-Text)

### 1.1. Tiền xử lý tín hiệu & hậu xử lý vùng miền (Đã tích hợp sẵn)
- **Lọc nhiễu phần cứng + DSP:** Biquad High-pass 85 Hz (`local-dictation.mjs`) + khử DC/rè quạt 50 Hz bằng NumPy + Dynamic Peak Gain Boost (`speech-server.py`).
- **Quy tắc hậu xử lý giọng 3 miền (`scripts/speech_postprocess.py`):**
  - **Miền Nam:** `xiêu âm / siêu xm → siêu âm`, `u sơ → u xơ`, `nhủ hoa → nhũ hoa`, `bú phải/trái → vú phải/trái`, `khôn → không`, `sinh tiêt → sinh thiết`.
  - **Miền Trung:** `bưu → bướu`, `siêu ôm → siêu âm`, `giải fẫu → giải phẫu`, `năng nước → nang nước`.
  - **Miền Bắc:** `dải/rải phẫu → giải phẫu`, `dópler/rópler → Doppler`, `u dú → u vú`, `birát → BI-RADS`.
- **Cảnh báo tức thì cho thư ký y khoa (`SpeechDashboard`):**
  - Mọi chỉnh sửa đều **không sửa ngầm**: giao diện hiển thị **Độ tin cậy (%)**, **Vùng giọng phát hiện**, **Đối chiếu bản gốc vs bản chuẩn hóa** kèm 2 nút:
    - `✓ Xác nhận đúng` (xác nhận trong 1 giây khi đông bệnh nhân)
    - `↶ Khôi phục bản gốc` (trả lại nguyên văn nếu bác sĩ đọc đúng ý khác)

### 1.2. Fine-tune PhoWhisper-small bằng giọng bác sĩ thực tế (LoRA Offline)
Để giảm tỷ lệ lỗi từ (WER) từ ~15% xuống ~5–6% với giọng đặc thù của từng bác sĩ tại khoa:
1. **Thu thập mẫu (không chứa định danh bệnh nhân):** Thu 200–500 câu đọc mẫu (16 kHz mono WAV) của các bác sĩ Bắc / Trung / Nam trong điều kiện phòng khám thực tế.
2. **Tạo file `speech-training/manifest.csv`:**
   ```csv
   audio_path,transcript,accent_region
   clips/bs_01.wav,"Siêu âm vú phải vị trí 10 giờ có khối giảm âm 12 × 8 mm BI-RADS 4A.",Nam
   ```
3. **Kiểm tra dữ liệu trước khi train:**
   ```powershell
   .\.speech-venv\Scripts\python.exe scripts\finetune-phowhisper.py --manifest speech-training\manifest.csv --dry-run
   ```
4. **Chạy huấn luyện LoRA offline & xuất model CTranslate2 INT8:**
   ```powershell
   .\.speech-venv\Scripts\python.exe scripts\finetune-phowhisper.py --manifest speech-training\manifest.csv --epochs 5
   ct2-transformers-converter --model speech-models\phowhisper-small-khoavu-lora\merged --output_dir speech-models\phowhisper-small-int8 --quantization int8
   ```

---

## Phần 2: AI Phân loại Dịch vụ Doanh thu & Cảnh báo Sai sót Tức thì

- **Phân loại 100% offline (`src/features/intelligence/revenueAI.mjs`):** Sử dụng Naive Bayes (`VU-REVENUE-NB-1`) kết hợp danh mục khoa chuẩn.
- **Ngưỡng cảnh báo tin cậy (`CONFIDENCE_THRESHOLD = 0.75`):**
  - Mọi dòng chưa có căn cứ xác nhận hoặc điểm tin cậy AI `< 75%` tự động gắn cờ `needs_review = true`.
  - Trên màn hình **Phân loại phạm vi doanh thu (`RevenueAI.jsx`)**:
    - Hiển thị **Banner cảnh báo đỏ/vàng** ngay đầu trang với tổng số dòng cần kiểm tra.
    - Cột **So sánh AI vs Nguồn** đặt cạnh cột **Xác nhận để học**, giúp kế toán / thư ký đối chiếu ngay lập tức và lưu nhãn (`validateLearning`) để AI học vĩnh viễn cho các lần sau.
- **Độ chính xác tính tiền:** Bộ tính doanh thu (`audit.mjs`) chạy phép nhân/cộng xác định, sai số tương đối `maxRelativeErrorPercent: 0`.
