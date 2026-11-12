---
status: verified
updated: 2026-11-11
triggers: 贡献者, contributor, 侧栏, sidebar, claude 还在, 去不掉, history rewrite, 改写历史, 缓存, cache, 默认分支, default branch, 无痕也不行, 保护分支, protected branch, GH006, 强制推送, 推不上去
---

# GitHub contributors sidebar has its own cache: toggle the default branch to purge it after a history rewrite

## 现象

用 `git filter-repo` / force-push 改写历史、把某个 AI 工具（如 `claude`）从提交作者里清掉后：

- `api.github.com/repos/<o>/<r>/contributors` → 已正确（少了那个条目）
- `github.com/<o>/<r>/graphs/contributors-data`（Insights 用的那份）→ 已正确
- **仓库首页右侧的 Contributors 卡片仍然显示旧的第 4 个贡献者**，无痕窗口也一样

无痕只绕浏览器缓存，绕不过 GitHub 服务端的独立缓存。等一天也不一定好。

## 根因

贡献者**数据**来自提交元数据，但**首页侧栏卡片是独立缓存的组件**，与 Insights 图表、REST API 不是同一条取数路径。历史改写只让它「数据过期」，不会立即重建组件缓存。

## 可靠解法（社区验证，本次实测有效）

**切换一次默认分支**，强制 GitHub 重算「默认分支可达的提交集合」：

1. 建临时分支并推送：`git checkout -b temp-cache-bust && git push -u origin temp-cache-bust`
2. 网页 Settings → General → Default branch，切到 `temp-cache-bust`
3. 再切回 `main`（**必须切走再切回**，两次切换）
4. 删临时分支：`git push origin --delete temp-cache-bust && git branch -D temp-cache-bust`

切换后刷新页面，侧栏立刻正确。

## 备选（较弱）

- 向默认分支推一个空提交会触发统计重算任务，但**本次合并了多个 PR（本身就是 push 事件）也没能刷新**，所以不可靠。
- 仍不行才开 support 工单请求清除缓存的贡献者列表。

## 预防

侧栏条目只能来自提交元数据。`Co-authored-by:` 尾注会被算作贡献者；GitHub App 以自身身份提交也算。
所以要么不装该 App，要么 CI 拦住工具署名（本仓库用 `scripts/check-commit-messages.py`，但**拦不住 App 作为 author 的提交**）。

Evidence: `改写后 API 返回 3 人（FrozenYty 89 / chemflowers 37 / Gtechson 16），graphs/contributors-data 同为 3 人，commits?author=claude|claude[bot]|anthropic 均 0 条；而首页侧栏仍显示 4 人，无痕窗口一致。按 community discussions/206602 与 /208456 的办法切换默认分支（temp-cache-bust 切走再切回）后，侧栏恢复为 3 人，用户确认「这次没有了」。`
