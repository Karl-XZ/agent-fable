# 当前版本与 old 的比较

比较基线：旧版原始提交 `7754911837483d81ed722d1027db1f656636a3cb`；当前版本为本次导入的 `checkpoint/responsive-care`。本次是源码比较，没有重新安装或试玩 old，也没有将下面的建议自动合入游戏。

## 最值得借鉴：AI 选意图，程序生成并复核行动方案

旧版的 [`buildLocalMapContext`](https://github.com/Karl-XZ/agent-fable/blob/old/src/game/aiLogic.ts#L125) 先计算玩家周围哪些路可走、哪些位置可以开路或封路，再给模型一组 `routeControlOptions`。模型返回 `routeId`；[`operationsForRouteAction`](https://github.com/Karl-XZ/agent-fable/blob/old/src/game/aiLogic.ts#L205) 执行时重新查询现场并生成具体方块，找不到合法选项就拒绝该 routeId 方案。不过外层 `applyDirectorOutput` 在方案为空时仍可退回 `output.operations` 或 `action.positions`，所以旧版整体并不是“方案无效就绝不执行坐标”的完整安全执行器；借鉴时应去掉这种绕过通道。

当前版已具备真实寻路、工具执行校验、锚定和活动时效校验，但多数建筑工具仍直接接收模型填写的坐标和尺寸。最有价值的后续改进是扩展为：程序给出当前可执行的照护方案，静决定是否做、做哪一项，执行器再验证并落实，而不让她凭文字猜几何。

例如受困时提供“解锁指定门”“打开已验证的通路”，高处求助时提供“在当前落脚点旁生成合规台阶”。方案必须绑定观察或场景版本，执行时检查支撑、净空、锚定和当前需求；过期方案重新规划。语言仍由静按照性格表达，不把人物变成机械选单。此建议是从旧版 routeId 机制延伸，旧版本身没有完成当前四层照护场景的这些能力。

## 同样有用的实现思路

| 旧版的具体做法 | 当前已有能力 | 借鉴方式与限制 |
|---|---|---|
| [`filterBlockedOperations`](https://github.com/Karl-XZ/agent-fable/blob/old/src/game/aiLogic.ts#L246) 统一过滤玩家周围、控制台和锚定桩保护区 | 当前工具已有锚定检查、挤压处理、参数限制和结果凭据 | 可以把跨工具共有的空间前置检查整理成一个稳定入口；不要直接复制固定 3×3 禁改区，否则会阻止玩家脚边所需的救援台阶。 |
| `localGrid`、`walkableNeighbors` 与推荐方向集中组织成局部地图信息 | 当前有三维、多楼层、楼梯和电梯寻路，以及完整 ASCII 图 | 为日常交谈提供更精简的“当前可见对象与可用帮助”，需要导航才扩展路线；保留当前跨楼层算法，不退回旧版二维寻路。 |
| `Player`、`Map`、HUD、设置与输入分别有组件/状态边界 | 当前已有 Player、World、Agent、Interaction、Audio 等模块，但 main.ts 仍承担大量感知、交互与演出编排 | 后续优先将感知、交互触发、结局编排从 main.ts 拆到清楚的边界；借鉴职责划分即可，没有必要为此整体改回 React 或更换物理引擎。 |
| [`ai-map-edit.mjs`](https://github.com/Karl-XZ/agent-fable/blob/old/tests/ai-map-edit.mjs#L58) 从页面发消息，再检查实际地图方块是否改变 | 当前有工具回执、真实引擎、模型与语音分层测试 | 新增高层动作时同时验“玩家请求→AI 决策→实际场景变化→一次播报”，不要只断言模型 JSON。旧测试使用专用 AI_MAP_EDIT_TEST 提示，只证明链路，不证明普通自然语言场景的能力。 |

## 不应照搬的部分

1. **有路口就强制封路、开路。** [`shouldRequireSeal`](https://github.com/Karl-XZ/agent-fable/blob/old/server/qwen-proxy.mjs#L152) 在存在候选动作却没有选动作时，再发一次模型请求要求执行。它会把人物重新变成催玩家去门的机器，还增加延迟；当前版应保留等待、照护、交谈和不行动的选择。
2. **固定间隔主动旁白。** [`AIManager`](https://github.com/Karl-XZ/agent-fable/blob/old/src/components/AIManager.tsx#L5) 定时调用 narrator，不等于理解用户此刻是否想听；不能替代当前的持续等待约定、活动观察和新请求抢先处理。
3. **按一秒间隔排字幕。** [`drainSubtitleQueue`](https://github.com/Karl-XZ/agent-fable/blob/old/src/game/aiLogic.ts#L46) 解决了部分覆盖问题，但没有使用当前阿里云语音的实际结束事件。当前播放完成、普通回复排队、真实危险可打断的机制更适合现在的游戏。
4. **把所有决策塞进忙碌锁。** 旧版 `tickAI` 在 `isAITicking` 时直接返回，没有当前版针对新问题取消旧推理的处理；不能用它替换现有调度。
5. **直接复制旧角色、世界观或构建配置。** 旧版是方块迷宫与权限损坏叙事，当前是三定律照护、失忆门、废城逃离及角色卡。`ci.yaml` 还引用了旧仓库未包含的 `scripts/build.sh`，不能因存在 CI 文件就认为可直接沿用。

## 建议顺序

先给“救援与开门”加入可执行方案，再做覆盖普通玩家语言的场景测试；之后整理 main.ts 的职责边界。保持当前人物、世界观、语音和角色卡规则。本次仓库迁移只保留并记录这些发现，没有改变现有游戏行为。
