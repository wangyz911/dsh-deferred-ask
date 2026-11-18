# 怎么把这个插件发出去

当前状态：`@local/dsh-deferred-ask` 是个 `private: true` 的本地包，通过 `link:` 挂在你自己的 profile 里。能装、能看，但别人装不到——包名 `@local/...` 不能发布，`private: true` 也会被 npm 拒绝。

想分享，要先决定走哪条路。**现在没有"官方"插件市场索引**：DSH 自带的「发现」页只是一个索引阅读器，它列出的是用户自己添加的索引源。真正有人逛的市场是社区做的 `dshmarket`，它的目录来自 GitHub 上的精选列表 `awesome-dsh-plugin`。所以"发到插件市场"实际上等于：**发布一个公开包 → 把插件条目提进那份精选列表**。

## 一、发布前的改动

| 项 | 现在 | 要改成 |
| --- | --- | --- |
| `name` | `@local/dsh-deferred-ask` | `dsh-deferred-ask`（或你自己的 scope：`@yourname/dsh-deferred-ask`） |
| `private` | `true` | 删掉这一行，或 `false` |
| `license` | 无 | `MIT` 之类，并放一个 `LICENSE` 文件 |
| `repository` | 无 | `{"type": "git", "url": "git+https://github.com/<you>/dsh-deferred-ask.git"}` |
| `homepage` | 无 | 仓库地址即可 |
| `keywords` | 无 | 必带 `"dsh-plugin"`，其余随意（`off-peak`、`pricing`、`queue`） |
| `engines` | 无 | `{"dsh": ">=0.2.2-rc.3"}`（按你实际验证过的 DSH 版本写） |

`dsh.bundle.patch` 与 `dsh.client` 已经在 `package.json` 里声明了，这是收录的硬条件之一，不用动。

改名的副作用：你 profile 里那行 `"@local/dsh-deferred-ask": "link:..."` 和 `dsh.profile.bundles` 里的同名条目都要跟着改，否则桌面端下次启动会找不到插件。想两边都留着，就等发布成功后再切换。

打包前自查：

```sh
npm pack --dry-run
```

列表里应当出现 `index.js`、`client.js`、`cordis.patch.yml`、`icon.svg`、`locale/*.json`、`docs/DETAIL.md`、`docs/DETAIL.zh.md`、`docs/preview.svg`、`README.md`。`files` 里已经有了 `docs` 和 `README.md`；漏了 `docs` 的话，插件详情页会报文件缺失。

## 二、发布

```sh
npm publish --access public
```

如果是 scope 包，`--access public` 不能省，否则发布出去仍是私有。发布完再去 GitHub 建一个**公开**仓库，同一份代码推上去，并给仓库打上 **`dsh-plugin`** topic（收录条件之一）。

## 三、收录进市场

市场里的列表由 `awesome-dsh-plugin/awesome-dsh-plugin` 仓库维护。做法是往 `data/plugins/` 下加**一个** YAML 文件，文件名 `<owner>__<repo>.yml`，形如 `yourname__dsh-deferred-ask.yml`：

```yaml
url: https://github.com/yourname/dsh-deferred-ask
name: yourname/dsh-deferred-ask
category: workflow
description:
  en: 'Queues questions written in the composer and sends them only while DeepSeek bills at off-peak rates, with delivery driven by a 30-second clock check instead of a pre-scheduled trigger. Up to 50 items, localStorage persistence, retry with backoff, and a one-click send-now at peak price.'
  zh: '把输入框里的问题排进队列，只在 DeepSeek 低谷计价时段（半价）发出；不在入队时排死触发时间，而是每 30 秒确认处于低谷后才投递下一次，避开错过任务的补投落进高峰。最多 50 条、localStorage 持久化、失败指数退避重试，也可按高峰价立即发送。'
```

提交成 PR 即可。CI 会检查这些硬指标：

- 仓库里**至少一天**的历史（当天建的仓库会被拒，隔天自动重跑，不用重新提交）；
- `package.json` 声明了 `dsh.bundle`（本插件已满足）；
- 仓库带 `dsh-plugin` topic；
- `category` 是列表认可的值（已见 `workflow`、`education`、`fun`；以仓库的 `contributing.md` 为准，本插件建议 `workflow`）；
- 描述只讲**做什么**，不要形容词堆砌。

合并后站点和 `dshmarket` 会自动收录，通常一天内生效。

## 四、顺便：给原生「发现」页用的索引

不想进精选列表、只想让朋友手动添加的话，也可以自己维护一份 format 1 索引，托管到任意 https 静态地址（`raw.githubusercontent.com` 或 jsDelivr 都行；索引 URL 不允许重定向）：

```json
{
  "format": 1,
  "title": { "en": "Deferred ask", "zh": "低谷待发" },
  "description": { "en": "A plugin index." },
  "metadata": {
    "categories": { "workflow": { "title": { "en": "Workflow", "zh": "工作流" } } },
    "labels": {},
    "sortKeys": {}
  },
  "plugins": [
    {
      "name": "dsh-deferred-ask",
      "title": { "en": "Deferred ask", "zh": "低谷待发" },
      "description": { "en": "Queue a question and send it off-peak.", "zh": "把问题排到低谷时段再发。" },
      "author": "yourname",
      "homepage": "https://github.com/yourname/dsh-deferred-ask",
      "repository": { "url": "https://github.com/yourname/dsh-deferred-ask" },
      "metadata": { "category": "workflow", "keywords": ["dsh-plugin"], "labels": [], "sortKeys": {} },
      "versions": [
        {
          "version": "1.0.13",
          "publishTimestamp": 1763510400,
          "source": { "type": "npm" },
          "engines": { "dsh": ">=0.2.2-rc.3" }
        }
      ]
    }
  ]
}
```

几个校验器会咬人的点：`title`/`description` 给对象时必须含 `en`；`publishTimestamp` 是 Unix 秒；版本按 SemVer 降序、不可重复；Git 来源的 `commit` 必须是 40 位小写十六进制；`metadata.category` 引用的分类 id 必须先在索引的 `metadata.categories` 里声明过（模板里已经声明了 `workflow`，要加别的分类就照抄一行）。索引里的 `name` 要和 npm 上的包名一致，否则安装参数拼不出来。

用户添加方式：**插件 → 发现 → 索引源**，粘贴这份 JSON 的 URL。

## 五、发出去之后

- 每个版本的详情页读的都是包里的 `locale/*.json` 与 `docs/`，所以以后改文案要重新发版，不是改索引。
- 记得同步 README 与 `docs/preview.svg`——条目页在没有 `meta.detail` 时会回退到 README，两者不一致会显得敷衍。
- 用户装了之后，更新走他们自己的包管理器或市场的更新按钮；从 Git 提交装的副本只会在同一仓库同一目录内更新。
