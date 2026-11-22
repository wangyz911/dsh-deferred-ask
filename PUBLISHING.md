# 怎么把这个插件发出去

当前状态（2026-11-18）：

- npm 上已有公开包 **`dsh-deferred-ask@1.0.12`**（https://www.npmjs.com/package/dsh-deferred-ask），`latest` 指向 1.0.12，13 个文件 56.4 kB。
- 源码仓库 **https://github.com/wangyz911/dsh-deferred-ask**（公开，topics 已打 `dsh-plugin`、`deepseek`）。
- 还差最后一步：往精选列表 `awesome-dsh-plugin` 提 PR（见第三节）。**仓库要满 24 小时才能提**，当天建的会被 CI 拒。

DSH 自带的「发现」页只是一个索引阅读器，列出的是用户自己添加的索引源；真正有人逛的市场是社区做的 `dshmarket`，目录来自 GitHub 精选列表 `awesome-dsh-plugin`。所以「发到插件市场」实际等于：**发布公开包 → 把条目提进那份列表**。

## 一、包里的必填项（已完成，改版时别弄丢）

| 项 | 值 |
| --- | --- |
| `name` | `dsh-deferred-ask`（不带 scope；`--access public` 因此可省，但留着无害） |
| `private` | 已删除，否则 npm 拒绝发布 |
| `license` | `MIT` + 根目录 `LICENSE` 文件 |
| `repository` / `homepage` / `bugs` | 都指向 GitHub 仓库 |
| `keywords` | 必带 `dsh-plugin`，其余 `dsh`、`off-peak`、`pricing`、`queue` |
| `engines.dsh` | `>=0.2.2-rc.3`（实际验证过的版本） |
| `dsh.bundle.patch` | 指向根目录 `cordis.patch.yml`，收录的硬条件 |
| `files` | 含 `docs` 与 `README.md`，漏了 `docs` 详情页就会报文件缺失 |

`cordis.patch.yml` 里的 `name` 必须和 `package.json` 的包名完全一致（这里是 `dsh-deferred-ask`），否则从 npm 或源码安装后加载会失败——这是改名时最容易漏的一处。

打包前自查：

```sh
node scripts/check-bundle-names.mjs   # client.js 的 id、cordis.patch.yml 的 name、包名必须一致
npm pack --dry-run
```

第一条已挂在 `prepublishOnly` 上，`npm publish` 会先跑它：不一致就直接中止，不会把「装了但不生效」的包发出去。1.0.12 就是这么发出去的——`client.js` 的 id 还留着模板时代的 `@local/dsh-deferred-ask`，而包名是 `dsh-deferred-ask`，DSH 的 client-modules 拒绝加载，界面上什么都不显示，Host 侧却仍报 `fiberPhase: active`。

应当出现 13 个文件：`LICENSE`、`README.md`、`README.zh.md`、`client.js`、`cordis.patch.yml`、`docs/DETAIL.md`、`docs/DETAIL.zh.md`、`docs/preview.svg`、`icon.svg`、`index.js`、`locale/en.json`、`locale/zh.json`、`package.json`。

## 二、发版

本机没有全局 node/npm，用工作区里的便携版：

```sh
NODE_DIR="C:/Users/yizhouw/Documents/deepseek-harness/default-workspace/.work/tools/node-v26.13.1-win-x64"
export npm_config_cache="C:/Users/yizhouw/Documents/deepseek-harness/default-workspace/.work/npm-cache"
export NPM_CONFIG_USERCONFIG="C:/Users/yizhouw/Documents/deepseek-harness/default-workspace/.work/npmrc"
cd C:/Users/yizhouw/dsh-plugins/dsh-deferred-ask
"$NODE_DIR/node.exe" "$NODE_DIR/node_modules/npm/bin/npm-cli.js" version patch
"$NODE_DIR/node.exe" "$NODE_DIR/node_modules/npm/bin/npm-cli.js" publish --access public --otp=<码>
```

账号 `yizhouw` 的 2FA 只有**安全密钥**（`NPM_Happy_1992`，无 Authenticator），命令行没法自己扫码。做法：先跑一次 `publish` 拿到 `npm-notice` 里的 `https://www.npmjs.com/login/<uuid>`，在浏览器用安全密钥确认后页面会给一个 16 位 one-time password，再用 `--otp=<那串数字>` 重跑即可。

注意两点：`npm_config_cache` 一定要指到工作区，默认缓存目录会报 `EPERM ... _cacache\tmp`；发布后 registry 有几分钟「processing」，期间 `dsh-deferred-ask` 只显示占位版本 `0.0.0-stage`，等 `latest` 变成新版本号才算真正可用。

## 三、收录进市场

列表由 `awesome-dsh-plugin` 仓库维护：往 `data/plugins/` 下加**一个** YAML，文件名 `<owner>__<repo>.yml`，例如 `wangyz911__dsh-deferred-ask.yml`：

```yaml
url: https://github.com/wangyz911/dsh-deferred-ask
name: wangyz911/dsh-deferred-ask
category: workflow
description:
  en: 'Queues questions written in the composer and sends them only while DeepSeek bills at off-peak rates, with delivery driven by a 30-second clock check instead of a pre-scheduled trigger. Up to 50 items, localStorage persistence, retry with backoff, and a one-click send-now at peak price.'
  zh: '把输入框里的问题排进队列，只在 DeepSeek 低谷计价时段（半价）发出；不在入队时排死触发时间，而是每 30 秒确认处于低谷后才投递下一次，避开错过任务的补投落进高峰。最多 50 条、localStorage 持久化、失败指数退避重试，也可按高峰价立即发送。'
```

提交成 PR 即可。CI 的硬指标：

- 仓库**至少一天**历史（当天建会被拒，隔天不过期重跑即可，不用关 PR）；
- `package.json` 声明 `dsh.bundle`；
- 仓库带 `dsh-plugin` topic；
- `category` 是列表认可的值（已见 `workflow`、`education`、`fun`，以仓库 `contributing.md` 为准）；
- 描述只讲**做什么**，不要堆形容词。

注意文件名和放的位置：目录是 `data/plugins/`，仓库根目录下同名的旧文件不算数。

合并后站点与 `dshmarket` 一天内自动收录。

## 四、顺便：给原生「发现」页用的索引

不想进精选列表、只想让朋友手动添加的话，可以自己维护一份 format 1 索引，托管到任意 https 静态地址（`raw.githubusercontent.com` 或 jsDelivr 都行；索引 URL 不允许重定向）：

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
      "author": "wangyz911",
      "homepage": "https://github.com/wangyz911/dsh-deferred-ask",
      "repository": { "url": "https://github.com/wangyz911/dsh-deferred-ask" },
      "metadata": { "category": "workflow", "keywords": ["dsh-plugin"], "labels": [], "sortKeys": {} },
      "versions": [
        {
          "version": "1.0.12",
          "publishTimestamp": 1763510400,
          "source": { "type": "npm" },
          "engines": { "dsh": ">=0.2.2-rc.3" }
        }
      ]
    }
  ]
}
```

校验器会咬人的点：`title`/`description` 给对象时**必须含 `en`**；`publishTimestamp` 是 Unix 秒；版本按 SemVer 降序、不可重复；Git 来源的 `commit` 必须是 40 位小写十六进制；`metadata.category` 引用的分类 id 必须先在索引的 `metadata.categories` 里声明过。索引里的 `name` 要和 npm 包名一致，否则安装参数拼不出来。

用户添加方式：**插件 → 发现 → 索引源**，粘贴这份 JSON 的 URL。

## 五、发出去之后

- 每个版本的详情页读的都是包里的 `locale/*.json` 与 `docs/`，所以改文案要**重新发版**，改索引没用。npm 版本的文件走 jsDelivr / unpkg / npmmirror 读取，已验证 `https://cdn.jsdelivr.net/npm/dsh-deferred-ask@1.0.12/docs/DETAIL.md` 返回 200。
- 记得同步 README 与 `docs/preview.svg`：条目页在 `meta.detail` 失效时会回退到 README，两者不一致会显得敷衍。
- 用户装好之后的更新，来自他们自己的包管理器或市场按钮；从 Git 提交装的副本只会在同一仓库同一目录内更新。
