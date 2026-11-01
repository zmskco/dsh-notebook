/**
 * The README the panel writes into a workspace the first time it is opened.
 *
 * @module notebook/story/readme
 */

/**
 * The workspace's README, written on first open.
 *
 * Fixed text on purpose: it names the plugin and lists what the panel does,
 * which is what someone opening an unknown directory wants to know. It is
 * created only when absent — a workspace that already has a `README.md` keeps
 * its own.
 * @returns the markdown.
 */
export function workspaceReadme(): string {
  return `# dsh-notepad

deepseek harness 简易的markdown笔记插件

- 支持目录树浏览，创建文件夹，创建文件
- 支持字体样式，大小，背景颜色调整
- 支持字数显示，自动保存
- 支持AI对话框功能
- 重命名，删除，需要在系统资源管理器完成，或提示AI操作
`
}
