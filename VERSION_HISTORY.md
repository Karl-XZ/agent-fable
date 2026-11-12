# 可恢复的版本节点

远端原始主分支保存在 [`old`](https://github.com/Karl-XZ/agent-fable/tree/old)，原始提交为 `7754911837483d81ed722d1027db1f656636a3cb`。

下面的五个提交于本次整理时创建，不伪造过去的提交时间。它们是从本地当前源文件与 `.runtime/before-*` 的部分备份反向重建的功能节点，不声称是当时整个目录的逐字快照。未被备份覆盖的共同模块沿用现有文件；测试、文档和入口按该节点的功能集整理，移除依赖未来功能的测试。

| 顺序 | checkpoint 标签 | 功能 |
|---|---|---|
| 1 | `pre-interaction` | 尚未加入互动模式 |
| 2 | `interaction-modes` | 15 种互动模式初版 |
| 3 | `pre-character-card` | 语音队列与持续等待修复，尚未加入角色卡 |
| 4 | `character-card` | 角色卡初版 |
| 5 | `responsive-care` | 最新人设与响应修复 |

Git 标签的完整名称为 `checkpoint/<上表标签>`。在这些提交之前，main 的父提交仍是原仓库的原始提交；旧实现没有从历史中删除。

## 查看或恢复

```bash
# 查看各版本及提交关系
git log --oneline --decorate --all

# 从未加入角色卡的版本创建独立恢复分支
git switch -c restore/pre-character-card checkpoint/pre-character-card

# 从未加入互动模式的版本创建独立恢复分支
git switch -c restore/pre-interaction checkpoint/pre-interaction

# 返回最新版（如有未提交修改，先自行保存）
git switch main
```

没有使用强制推送，也没有把本机真实 .env、运行日志、node_modules 或构建目录提交到仓库。`.env.example` 只列变量名称；API 密钥需要自行填写。浏览器 localStorage 中的角色卡和解锁记录不在 Git 中。

各节点的恢复来源、差异和本次检查结果见 `docs/version-history/`。完整历史的离线备份另保存在整理工作目录，不依赖网页查看。
