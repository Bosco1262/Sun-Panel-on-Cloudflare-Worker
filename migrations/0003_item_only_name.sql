-- 项目唯一标识 (对齐上游 v1.8.1): 仅限英文, 可用作 OpenAPI 字段, 并可配合自定义 JS/CSS 美化卡片
ALTER TABLE item_icon ADD COLUMN only_name TEXT NOT NULL DEFAULT '';
