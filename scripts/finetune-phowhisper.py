"""Offline LoRA fine-tuning scaffold for PhoWhisper-small (Khoa Vú domain).

Trains on local de-identified doctor recordings (WAV 16kHz mono + transcript CSV)
using HuggingFace PEFT/LoRA so the model adapts to regional Vietnamese accents
(Bắc / Trung / Nam) and clinical breast-oncology terminology.

Requirements (install in a separate training venv if not present):
    pip install transformers datasets peft accelerate torchaudio ctranslate2

Usage:
    python scripts/finetune-phowhisper.py \\
        --manifest speech-training/manifest.csv \\
        --output-dir speech-models/phowhisper-small-khoavu-lora \\
        --epochs 5 --batch-size 4

Manifest CSV format (UTF-8, no patient identifiers):
    audio_path,transcript,accent_region
    clips/bs_a_001.wav,"Siêu âm vú phải vị trí 10 giờ có khối giảm âm kích thước 12 × 8 mm BI-RADS 4A.",Nam
"""
from __future__ import annotations
import argparse
import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED_COLUMNS = {'audio_path', 'transcript'}


def validate_manifest(manifest_path: Path) -> list[dict]:
    """Validate CSV manifest without touching model weights or patient PII."""
    if not manifest_path.exists():
        raise FileNotFoundError(f'Không tìm thấy manifest: {manifest_path}')
    rows: list[dict] = []
    with manifest_path.open('r', encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames or not REQUIRED_COLUMNS.issubset(set(reader.fieldnames)):
            raise ValueError(f'Manifest cần ít nhất 2 cột: {sorted(REQUIRED_COLUMNS)}')
        for idx, row in enumerate(reader, start=2):
            audio = (row.get('audio_path') or '').strip()
            text = (row.get('transcript') or '').strip()
            if not audio or not text:
                raise ValueError(f'Dòng {idx} thiếu audio_path hoặc transcript')
            rows.append({
                'audio_path': str((manifest_path.parent / audio).resolve()),
                'transcript': text,
                'accent_region': (row.get('accent_region') or 'unknown').strip(),
            })
    if len(rows) < 10:
        raise ValueError(f'Cần tối thiểu 10 mẫu để kiểm tra (khuyến nghị 200+ câu); hiện có {len(rows)}.')
    return rows


def main():
    parser = argparse.ArgumentParser(description='Offline LoRA fine-tuning for PhoWhisper-small (Khoa Vú)')
    parser.add_argument('--manifest', type=Path, required=True, help='Đường dẫn file CSV (audio_path, transcript)')
    parser.add_argument('--base-model', type=str, default='vinai/PhoWhisper-small', help='Model gốc (local cache hoặc HF)')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'speech-models/phowhisper-small-khoavu-lora')
    parser.add_argument('--epochs', type=int, default=5)
    parser.add_argument('--batch-size', type=int, default=4)
    parser.add_argument('--lr', type=float, default=1e-4)
    parser.add_argument('--dry-run', action='store_true', help='Chỉ kiểm tra manifest, chưa chạy training')
    args = parser.parse_args()

    rows = validate_manifest(args.manifest)
    print(f'[OK] Manifest hợp lệ: {len(rows)} mẫu.')
    if args.dry_run:
        return

    try:
        import torch
        from datasets import Dataset, Audio
        from peft import LoraConfig, get_peft_model
        from transformers import (
            Seq2SeqTrainer,
            Seq2SeqTrainingArguments,
            WhisperForConditionalGeneration,
            WhisperProcessor,
        )
    except ImportError as exc:
        raise SystemExit(
            f'Thiếu thư viện huấn luyện ({exc}). Cài đặt: '
            'pip install transformers datasets peft accelerate torchaudio'
        ) from exc

    processor = WhisperProcessor.from_pretrained(args.base_model, language='vi', task='transcribe', local_files_only=True)
    model = WhisperForConditionalGeneration.from_pretrained(args.base_model, local_files_only=True)
    lora_cfg = LoraConfig(r=16, lora_alpha=32, target_modules=['q_proj', 'v_proj'], lora_dropout=0.05, bias='none')
    model = get_peft_model(model, lora_cfg)
    model.print_trainable_parameters()

    ds = Dataset.from_list(rows).cast_column('audio_path', Audio(sampling_rate=16000))

    def prepare(batch):
        audio = batch['audio_path']
        batch['input_features'] = processor.feature_extractor(audio['array'], sampling_rate=16000).input_features[0]
        batch['labels'] = processor.tokenizer(batch['transcript']).input_ids
        return batch

    ds = ds.map(prepare, remove_columns=ds.column_names)
    training_args = Seq2SeqTrainingArguments(
        output_dir=str(args.output_dir),
        per_device_train_batch_size=args.batch_size,
        learning_rate=args.lr,
        num_train_epochs=args.epochs,
        fp16=torch.cuda.is_available(),
        logging_steps=10,
        save_strategy='epoch',
        predict_with_generate=False,
        report_to='none',
    )
    trainer = Seq2SeqTrainer(model=model, args=training_args, train_dataset=ds)
    trainer.train()
    merged = model.merge_and_unload()
    merged.save_pretrained(str(args.output_dir / 'merged'))
    processor.save_pretrained(str(args.output_dir / 'merged'))
    print(f'[DONE] Đã lưu model merged tại {args.output_dir / "merged"}. Chuyển sang CTranslate2 INT8 để dùng với speech-server.py.')


if __name__ == '__main__':
    main()
