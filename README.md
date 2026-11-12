# Maple Leaves

maple0leaves 的个人网站，使用 Hexo 构建，计划发布在 GitHub Pages：<https://maple0leaves.github.io/>。

## 本地预览

首次下载项目后，安装 [Node.js](https://nodejs.org/) 和 [Git](https://git-scm.com/)，然后在此目录运行：

```powershell
npm install
npm run server
```

浏览器打开 <http://localhost:4000/>。按 `Ctrl+C` 停止预览。

## 写文章

```powershell
npx hexo new post "文章标题"
```

编辑 `source/_posts/` 下生成的 `.md` 文件。文章开头的 `title`、`date`、`categories`、`tags` 是文章信息，下面是 Markdown 正文。

发布前运行 `npm run build` 检查生成结果，运行 `npm run deploy` 发布。发布脚本会读取这台 Windows 电脑的代理设置，并依次清理、生成和上传网页。当前部署目标写在 `_config.yml` 的 `deploy` 部分，生成网页推送到 `gh-pages` 分支。

修改文章或网站样式后，还应把源项目同步到仓库的 `main` 分支作为备份：

```powershell
git add .
git commit -m "更新网站"
git -c http.version=HTTP/1.1 -c http.sslBackend=schannel push origin main
```

## 网站设置

- 网站名称、网址、部署目标：项目根目录的 `_config.yml`
- 首页、文章页、关于页样式：`themes/maple/`
- 关于页内容：`source/about/index.md`
- 文章：`source/_posts/`
- Windows 发布脚本：`tools/deploy.ps1`

网站目前有一篇示例开篇文章，欢迎按自己的经历修改或删除。
