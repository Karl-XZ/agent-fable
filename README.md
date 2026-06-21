# Agent 的寓言

一个第一人称 3D 迷宫叙事游戏。玩家被困在由 Agent 管理的控制空间中，可以移动、跳跃、发送短信、破坏控制台、放置锚定桩，并尝试抵达那扇“通往未来的门”或用更危险的方法逃离边界。

项目当前使用 React、Three.js、Rapier 物理引擎和本地 Qwen 代理服务。Agent 会读取玩家位置、附近地图、寻路结果和历史事件，生成中文旁白，并在必要时真实修改地图方块。

## 核心玩法

- 第一人称探索：WASD 移动，Space 跳跃，鼠标视角，Esc 解放鼠标。
- 手机短信：按 Enter 打开左下角输入框，再按 Enter 发送消息给 Agent。
- 场景交互：按 F 破坏控制台、拾取或放置锚定桩、进入门。
- AI 旁白：Agent 会根据玩家行为给出路线、批评、催促或异常反馈。
- AI 改图：Agent 可以选择封路、开路、生成或移除墙体，系统会做真实方块修改。
- 寻路提示：后端上下文会提供玩家到门、边界裂缝的真实路径距离和下一步方向。
- 多结局：进入门触发门结局；越过地图边界或坠落出世界触发逃离结局。

## 技术栈

- React 19 + TypeScript
- Three.js / @react-three/fiber / @react-three/drei
- @react-three/rapier 物理引擎
- Zustand 状态管理
- p5.js 标题界面流动背景
- Node.js Qwen 代理服务
- Playwright 自动化测试

## 快速开始

安装依赖：

```bash
pnpm install
```

复制环境变量模板：

```bash
cp .env.example .env.local
```

在 `.env.local` 中填写：

```bash
VITE_LLM_ENABLED=true
VITE_AI_ENDPOINT=http://127.0.0.1:8787/api/ai/director
```

Qwen API Key 不建议写进前端环境文件。启动代理时通过命令行环境变量传入：

```bash
QWEN_API_KEY=your_qwen_api_key_here QWEN_MODEL=qwen3-max pnpm run ai:server
```

Windows PowerShell 示例：

```powershell
$env:QWEN_API_KEY="your_qwen_api_key_here"
$env:QWEN_MODEL="qwen3-max"
pnpm run ai:server
```

启动游戏：

```bash
pnpm dev --host 127.0.0.1 --port 5231
```

打开：

```txt
http://127.0.0.1:5231
```

## 常用命令

```bash
pnpm exec tsc --noEmit
pnpm test:e2e
pnpm test:llm
pnpm test:ai-map
pnpm run build
```

说明：

- `test:e2e` 使用本地降级模式测试基础流程、移动交互、短信、指南针、结局和寻路。
- `test:llm` 需要 `QWEN_API_KEY`，用于测试真实模型响应。
- `test:ai-map` 需要 `QWEN_API_KEY`，用于验证真实模型链路能触发地图修改。

## 目录结构

```txt
public/                  图标和静态资源
server/                  Qwen 代理服务
src/                     游戏前端源码
src/components/          3D 场景、玩家、AI 管理器
src/game/                游戏状态、寻路、音效、类型和 AI 逻辑
src/store/               Zustand 游戏状态
src/ui/                  HUD、手机、设置、标题界面
tests/                   Playwright 与 LLM 测试脚本
docs/                    需求文档
```

## 安全说明

- 不要提交 `.env`、`.env.local` 或任何真实 API Key。
- Qwen Key 只应通过本机环境变量传给 `server/qwen-proxy.mjs`。
- `runtime/` 是运行时数据目录，默认不纳入版本库。

## 当前状态

- 已接入真实 Qwen 代理。
- 已实现 3D 迷宫、AI 旁白、路线封锁/开路、边界逃离、控制台与锚定桩机制。
- 已加入中文 README、自动化测试和真实 AI 地图修改测试。
