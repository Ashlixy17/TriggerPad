<div align="center">

<img alt="TriggerPad logo" src="./UI/build-resources/TriggerPad.ico" width="256" height="256" />

# TriggerPad

<br>
<div>
    <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-ES2022-%23F7DF1E?logo=javascript&logoColor=black">
    <img alt="platform" src="https://img.shields.io/badge/platform-Windows-blueviolet">
</div>
<div>
    <img alt="license" src="https://img.shields.io/badge/license-Apache--2.0-%23D22128">
</div>

</div>

## 项目简介

TriggerPad 是一个面向 Counter-Strike 2（CS2）的事件驱动音频触发工具。它通过 Valve Game State Integration（GSI）监听游戏状态，将游戏事件与用户导入的本地音频关联起来，在事件发生时自动播放音频。

> [!CAUTION]
> 当前版本是 v0.1.0，
> 已经打通了“导入音频 → 选择事件 → 绑定音频 → 启动 GSI 监听”的基础演示流程，但难免有Bug的出现。

## 亮点功能

当前原型提供：

- CS2 GSI 自动配置和游戏事件监听；
- 支持的 CS2 事件展示与选择；
- 本地音频导入、试听、移除和清空；
- 将音频绑定到事件；
- 一键启动或停止事件监听；
- 音频格式的转换工具；
- 基础运行日志；
- 深色、浅色和跟随系统主题；
- 自动保存事件绑定和应用设置。


## 快速开始
> [!WARNING]
> 目前音频文件仅支持.wav/.mp3/.m4a格式，后续考虑增加其他音频格式的支持
1. 启动 TriggerPad，主界面点击主界面的启动按钮先生成配置信息。
2. 点击“导入音频”，选择需要在游戏事件发生时播放的本地音频文件。
3. 在事件列表中选择需要配置的事件规则。
4. 在事件详情中选择已导入的音频，并根据需要调整触发音量。
5. 点击“测试播放”，确认音频文件能够正常播放。
6. 点击“绑定音频”，保存事件与音频的关联关系。
7. 启动 CS2 并进入对局。当已绑定的事件发生时，TriggerPad 会尝试自动播放对应音频。
8. 如需确认事件接收或排查问题，可在“日志”页面查看运行记录。


## 支持的 GSI 事件
<details>

<summary>支持GSI事件列表</summary>



## 玩家类

### 玩家监测类

1. 监测玩家死亡（`PlayerDied`）
2. 玩家被闪光弹致盲（`PlayerFlashAmountChanged`）
3. 玩家混烟（0–255）（`PlayerSmokedAmountChanged`）
4. 玩家被燃烧弹伤害（`PlayerBurningAmountChanged`）

### 玩家行为类

1. 玩家主武器变化（`PlayerActiveWeaponChanged` ）
2. 玩家拾取武器（`PlayerWeaponsPickedUp`）
3. 玩家丢弃武器（含死亡时掉落）（`PlayerWeaponsDropped`）
4. 玩家击杀敌人（`PlayerGotKill`）


## 回合类

1. 回合时间耗尽，CT 方胜利、T 方失败（`RoundConcluded` + `CT_Win_Time`）
2. 敌方被全部歼灭，回合胜利（`RoundConcluded` + `*_Win_Elimination`）
3. 回合炸弹爆炸，T 胜利、CT 失败（`BombExploded` / `RoundConcluded` + `T_Win_Bomb`）
4. 回合炸弹被拆除，CT 胜利、T 失败（`BombDefused` / `RoundConcluded` + `CT_Win_Defuse`）
5. 回合失败（`TeamRoundLoss`）
6. 回合胜利 (`TeamRoundVictory`)
7. 游戏结束（`Gameover`）

</details>

这是 TriggerPad 当前事件目录及后续规则接入范围。当前 demo 已真正接通并可执行的是 `PlayerDied`；其他事件已根据 `CounterStrike2GSI` 的能力列入支持清单，仍需完成规则和动作接入后才能在界面中实际使用。
## 多语言规定

TriggerPad 以简体中文为第一语言，所有翻译词条均以简体中文原文及其语义为准。

## 许可证

项目使用 Apache-2.0 License，详见 [LICENSE](LICENSE)。
