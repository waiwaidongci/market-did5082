# 002 批次结构版本与隔离记录

门岗 CSV 新增「班次」列后，`datasets` 需要记录每批采用的结构版本，并完整保留被隔离的原始记录。新部署由 SQLAlchemy 自动建表；已有数据库执行：

```sql
ALTER TABLE datasets
  ADD COLUMN schema_version VARCHAR(20) NOT NULL DEFAULT 'v1' AFTER checksum,
  ADD COLUMN quarantine JSON NULL AFTER row_count;

UPDATE datasets SET quarantine = JSON_ARRAY() WHERE quarantine IS NULL;
```

- 既有批次一律视为 `v1`（市场日口径），重算保持原日口径，不涉及班次汇总。
- 新导入批次按表头识别结构：含 `shift` 列为 `v2`（班次口径），否则为 `v1`。
- 去重指纹改为覆盖「结构版本 + 明细行 + 隔离记录」。迁移前已入库的批次仍按旧指纹去重；同一份 CSV 迁移后重新导入会生成一个新批次，而不是复用迁移前的批次。
- `runs.result` 快照保存当次运行采用的结构版本与隔离记录，重跑后仍可追溯同一版本。
