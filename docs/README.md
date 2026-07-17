# TriggerPad 文档索引与分类规范

本目录按文档用途分类。新增文档前先选择最贴近的现有目录；不要直接在 `docs/` 根目录创建业务文档。

## 目录结构

```text
docs/
├── README.md                    # 本索引与分类规则
├── product/                     # 产品需求、用户流程和范围定义
├── architecture/
│   └── adr/                     # 架构决策记录（ADR）
├── development/
│   ├── TriggerPad_Implementation_and_Roadmap.md
│   └── cs2-gsi/                 # 面向实现的开发路径与技术设计
└── reference/
    └── cs2-gsi/                 # 外部资料的整理、翻译与字段参考
```

## 新增文档规则

1. 产品需求、流程说明、验收标准放入 `product/`。
2. 影响架构、兼容性、安全性或长期维护成本的技术决策，以 `ADR-编号-简短主题.md` 命名，放入 `architecture/adr/`。
3. 实现方案、开发路径、模块接口和测试设计放入 `development/`；与 CS2 GSI 直接相关的内容放入 `development/cs2-gsi/`。
4. 第三方资料的翻译、字段字典、样本说明和调研结论放入 `reference/`；与 CS2 GSI 相关的内容放入 `reference/cs2-gsi/`。
5. 新增类别前，先创建对应的一级用途目录，并在本文件的“目录结构”中补充说明。
6. 新增或移动文档后，更新本文档索引和受影响的相对链接。

## 当前文档

- `product/`
  - `TriggerPad_PRD_v0.1_Template.md`：产品需求框架草案。
  - `TriggerPad_Project_Flow_Understanding.md`：基于 PRD 的项目流程理解。
- `architecture/adr/`
  - `ADR-0001-GSI核心与事件边界.md`：GSI 核心与业务模块的边界决策。
- `development/`
  - `TriggerPad_Implementation_and_Roadmap.md`：当前实现说明、开发进度、后续路线和运行方式。
- `development/cs2-gsi/`
  - `CS2_GSI_Development_Path.md`：CS2 GSI 实现路径草案。
- `reference/cs2-gsi/`
  - `CounterStrike2GSI_XML_中文说明.md`：CounterStrike2GSI 回调中文说明。
