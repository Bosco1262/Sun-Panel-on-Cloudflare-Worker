-- 分组级卡片样式设置 (对齐上游 v1.8.1: 分组可独立设置卡片风格/文字颜色/隐藏描述)
-- card_style: -1=跟随全局设置, 0=详情图标(长条形), 1=小图标(正方形)
-- text_color: 空字符串=跟随全局设置
-- hide_description: 0=显示描述, 1=隐藏描述
ALTER TABLE item_icon_group ADD COLUMN card_style INTEGER NOT NULL DEFAULT -1;
ALTER TABLE item_icon_group ADD COLUMN text_color TEXT NOT NULL DEFAULT '';
ALTER TABLE item_icon_group ADD COLUMN hide_description INTEGER NOT NULL DEFAULT 0;
