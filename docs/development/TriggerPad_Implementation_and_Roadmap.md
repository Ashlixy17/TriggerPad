# TriggerPad 实现说明与开发路线

本文档记录 TriggerPad 当前实现方式、架构边界、已完成步骤、后续开发路线和开发环境要求。产品范围及验收标准以 [TriggerPad PRD v0.1](../product/TriggerPad_PRD_v0.1_Template.md) 为准，关键架构决策以 [ADR-0001](../architecture/adr/ADR-0001-GSI核心与事件边界.md) 为准。

## 当前实现方式

项目采用 Electron + React + .NET 的本地桌面架构：

```text
CS2
  ↓ Valve GSI
CounterStrike2GSI Listener（Server/main.cs）
  ↓ 领域事件回调
TriggerPad Server
  ↓ 音频动作
本地音频播放

Electron Main Process（UI/electron/main.cjs）
  ↔ IPC
React UI（UI/src/App.jsx）
  ↔ config.json / audio/
```

主要模块：

- `UI/src/`：React 界面，包括事件、日志和设置页面。
- `UI/electron/main.cjs`：Electron 主进程，负责窗口、IPC、配置、音频文件和服务进程管理。
- `UI/electron/preload.cjs`：通过 `contextBridge` 向渲染进程暴露受控 API。
- `Server/main.cs`：.NET 8 GSI 监听服务，使用 `CounterStrike2GSI.dll` 接收并解析 CS2 状态。
- `config.json`：事件绑定和应用设置的本地配置文件。
- `audio/`：开发环境中的本地音频目录；打包版本使用应用运行时目录中的音频目录。

## 架构决策

项目采用 ADR-0001 的方案：复用 CS2 GSI 库的 JSON 解析和强类型事件回调，在本地增加适配层，再向上层提供统一的产品事件。

ADR 规划的目标边界是：

```text
CS2 GSI → Cs2GsiAdapter → GameEvent → Rule Engine → Audio System → Audio Router
```

当前源码仍处于最小原型阶段，`Server/main.cs` 直接订阅 `PlayerDied` 回调，统一 `GameEvent`、Rule Engine 和 Audio Router 尚未完整落地。后续扩展事件前，应先完成这层边界，避免 UI 和规则逻辑继续依赖具体 GSI 回调。

## 已完成的开发步骤

以下状态按照 PRD v0.1 和 ADR-0001 对照当前源码整理。

### 已完成或已有原型实现

- [x] 建立 Electron 桌面应用和自定义窗口界面。
- [x] 建立 React 主界面，包含事件、日志、设置三个页面。
- [x] 接入 .NET 8 GSI 服务和 `CounterStrike2GSI` 库。
- [x] 生成 CS2 GSI 配置文件并监听本地端口 `10086`。
- [x] 通过配置文件读取事件定义和音频绑定关系。
- [x] 支持本地音频导入、列表展示、试听、移除和清空。
- [x] 支持基础的事件选择和音频绑定持久化。
- [x] 接入 `PlayerDied` 回调，并提供玩家死亡后的音频播放原型。
- [x] 提供服务启动、停止和基础服务日志转发。
- [x] 提供基础主题设置和配置保存能力。
- [x] 保持产品边界：当前没有读取游戏内存、注入游戏进程或执行竞技辅助操作。

### 已预留但尚未完成

- [ ] `PlayerFlashAmountChanged` 的实际事件处理和音频动作。
- [ ] 统一的 `GameEvent` 数据模型和 GSI 适配层。
- [ ] 通用 Rule Engine，而不是在服务端硬编码 `PlayerDied`。
- [ ] 规则启用、停用、编辑、删除、条件校验和冷却时间。
- [ ] 音频输出设备和虚拟麦克风路由。
- [ ] 首次启动向导和 Health Check。

## 后续开发路线

更新顺序会优先保证“事件接收 → 规则匹配 → 音频执行 → 日志记录”这条主链路稳定，再扩展更多事件和体验功能。

### 第一优先级：补齐 MVP 主链路

1. **配置热加载**：绑定或修改音频后，让服务端立即获得最新配置，避免必须重启服务。
2. **统一音频播放方案**：统一 UI 试听与服务端触发使用的音频格式和播放引擎，明确支持的格式。
3. **本地玩家过滤**：使用 `Provider.SteamID` 初始化本地账号，并过滤观战状态下其他玩家的事件。
4. **事件适配层**：将 GSI 库回调转换为统一的 `GameEvent`，隔离第三方库模型。
5. **通用规则执行**：由规则配置决定触发器、音频动作、启停状态和冷却时间，不再只处理 `PlayerDied`。
6. **可靠状态和日志**：区分服务进程运行、GSI 监听成功、最近收到游戏数据等状态，并记录事件接收、规则匹配和播放结果。

### 第二优先级：达到 PRD MVP 验收要求

- 初始化向导：检查 Steam、CS2、GSI 和音频设备；
- Event Tree：按类别展示、搜索和说明可用事件；
- Rule Editor：创建、编辑、启停、删除规则，并校验重复和冲突；
- Sound Pool：展示格式、时长和可用状态，删除被引用音频前给出提示；
- Audio Router：选择实际输出设备或虚拟麦克风；
- 全局停止开关和规则级停止能力；
- GSI 断开、音频设备失效和规则引用失效时的明确提示；
- 自动化测试替身和可复现的 GSI 事件样本。

### 第三优先级：体验和扩展

- 配置和音频索引的导入/导出；
- 音频设备刷新和低风险 Auto Fix；
- 延迟测试（Latency Benchmark）；
- GSI 事件录制与回放（Replay）；
- 更完整的诊断筛选和日志保留策略；
- 在核心事件模型稳定后，扩展玩家闪光、受伤、复活、炸弹和回合等事件；
- 评估其他游戏适配和安全可控的扩展机制。

以下内容暂不属于当前 MVP：云端同步、在线音频市场、用户脚本、浏览器或第三方应用动作，以及任何可能影响游戏公平性的功能。

## 多语言规范

TriggerPad 以简体中文（`zh-CN`）为第一语言和默认语言，所有多语言词条均以简体中文原文及其语义为翻译基准。

## 开发与运行

开发环境需要：

- Node.js 和 npm；
- .NET 8 SDK；
- Windows 桌面环境；
- 已安装 Counter-Strike 2。

常用命令：

```powershell
# 安装前端依赖
cd UI
npm install

# 启动开发模式
npm run dev

# 构建前端
npm run build

# 构建服务端
cd ..\Server
dotnet build
```

## 参考文档

- [TriggerPad PRD v0.1](../product/TriggerPad_PRD_v0.1_Template.md)
- [ADR-0001：GSI 核心与事件边界](../architecture/adr/ADR-0001-GSI核心与事件边界.md)
- [CS2 GSI 实现路径](cs2-gsi/CS2_GSI_Development_Path.md)
- [CS2 GSI 中文说明](../reference/cs2-gsi/CounterStrike2GSI_XML_中文说明.md)
