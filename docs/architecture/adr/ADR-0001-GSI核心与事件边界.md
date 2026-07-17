# ADR-0001：通过 CS2 GSI 事件监听器与 TriggerPad 业务模块解耦

- **状态：** 已接受
- **日期：** 2026-07-15
- **决策者：** TriggerPad 项目组
- **关联：** [`CS2_GSI_Development_Path.md`](../../development/cs2-gsi/CS2_GSI_Development_Path.md)、[`TriggerPad_PRD_v0.1_Template.md`](../../product/TriggerPad_PRD_v0.1_Template.md)

## 背景

TriggerPad 的 MVP 主链路为：

`CS2 GSI → CS2 GSI Library / Listener → Event System → Rule Engine → Audio System → Audio Router`

CS2 GSI 发送的是持续变化的原始 JSON 状态。当前选用的 CS2 GSI 库已负责解析 JSON，并通过强类型事件回调暴露状态变化；例如：

```csharp
listener.PlayerDied += gameEvent => { /* ... */ };
```

业务层真正需要的是可用于规则匹配的、稳定的“事件”，例如回合开始、玩家状态变化或炸弹状态变化。

若让 UI、规则引擎或音频模块直接依赖 GSI 库的 Payload、模型或回调，会使它们与 CS2 字段及具体库的 API 强耦合，也会增加测试、诊断和后续替换库的成本。

## 候选方案

1. **业务模块直接订阅并使用 GSI 库的回调**
   - 实现最快，但规则、音频和 UI 会依赖具体库的事件参数与模型。库替换、字段变化和业务语义适配需要在多个位置处理。

2. **独立 GSI 适配层，在进程内输出统一事件（采用）**
   - CS2 GSI 库负责接收、JSON 解析及其已提供的事件识别。适配层订阅库回调、转换为 TriggerPad 的统一事件，并提供诊断。

3. **首版将 GSI 接入做成独立 HTTP/WebSocket 服务**
   - 边界清晰，但会额外引入进程管理、通信协议和部署复杂度；当前 MVP 没有此需求。

## 决策

MVP 采用方案 2：**复用现有 CS2 GSI 库的 JSON 解析与事件回调能力，在本地进程内增加一个轻量适配层，并以最小统一事件接口向 TriggerPad 的 Event System 输出数据。**

CS2 GSI 库及适配层的职责如下：

- GSI 库接收并解析 CS2 GSI 请求/Payload，并产生其支持的领域回调。
- 适配层订阅所需回调（如 `PlayerDied`），将其转换为 TriggerPad 的 `GameEvent`。
- 适配层屏蔽具体库的事件参数、模型和版本差异。
- 适配层输出运行状态、错误和必要的诊断信息。

GSI 库适配层不得依赖 UI、Rule Engine、Audio System 或 Audio Router。上层模块不得直接依赖原始 GSI JSON，也不得直接订阅具体 GSI 库的回调。

MVP 不提供独立服务、HTTP/WebSocket 对外接口、跨语言协议或公共 SDK；是否需要这些能力在核心接口稳定且有明确需求后再另立 ADR 评估。

## 最小接口示意

接口签名随技术选型确定，但职责边界应保持如下：

```text
Cs2GsiAdapter
  订阅：CS2 GSI Library 的强类型回调（如 PlayerDied）
  输出：GameEvent、连接状态、诊断记录

EventSystemAdapter
  订阅：Cs2GsiAdapter 输出的 GameEvent
  转交：Rule Engine 与日志链路
```

`GameEvent` 至少应包含事件类型、发生时间、来源标识和事件数据；具体字段由后续事件清单和数据模型确定。

## 决策理由

- 复用已验证的 GSI JSON 解析与事件识别能力，避免重复实现。
- 使 Rule Engine 面向产品概念中的 Trigger/Event，而不是 CS2 原始字段或第三方库模型。
- 将库回调到产品事件的语义转换集中在一处，避免跨模块逻辑不一致。
- 可独立测试适配层的“库回调 → GameEvent”转换，无需每次启动 CS2。
- 保留未来接入其他游戏或增加服务层的空间，同时不为 MVP 预先承担额外复杂度。

## 影响与取舍

**正面影响：**

- 规则、音频和 UI 模块可独立测试和演进。
- 单次错误 Payload 不会直接中断规则与音频主链路。
- 日志可分别定位“原始数据接收”“事件转换”“规则执行”三个阶段。

**负面影响：**

- 需要先定义统一事件模型，并维护库事件到产品事件的映射。
- 首批接入范围必须受控；仅将已由所选库稳定支持且已验证的回调作为能力承诺。
- 新增事件需同时补充映射逻辑和转换测试。

## 实施约束与验收

- 优先支持 MVP 实际需要、已由所选库暴露且已验证的回调。
- 库报告的异常、断开或未知数据不得导致程序崩溃或阻塞 UI。
- Rule Engine 只能接收统一事件，不能读取原始 GSI JSON 或直接订阅 GSI 库。
- 至少为已接入的库回调保留可复现的测试数据或测试替身，用于验证事件转换。
- 从 GSI 库回调、事件转换、规则匹配到音频执行均应产生可关联的诊断日志。

## 后续决策

以下问题不在本 ADR 中确定，待原型验证后另行记录：

- 首批订阅的库回调清单及其与 `GameEvent` 的字段映射；
- 统一事件的具体数据结构和版本兼容策略；
- GSI 断开后的超时、重连与状态恢复策略；
- 是否引入独立服务层，以及其通信方式；
- 多规则并发时音频的排队、打断或混音策略。
