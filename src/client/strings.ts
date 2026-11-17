/**
 * Locale dictionaries and the translate fallback.
 *
 * Both dictionaries are registered with the Client locale service at
 * activation, so DSH owns locale switching. The `zh` table is also the
 * fallback the components use when the framework `t` seat is absent or does not
 * know a key, which is what keeps the page readable instead of showing raw keys
 * if composition changes.
 *
 * The product name lives in two files on purpose, and they must agree:
 * `locale/<lang>.json` `meta.title` is the name DSH shows in its plugin
 * inventory, and `panel` here is the name the sidebar entry and the directory
 * column draw. `check:client` compares them, because "the plugin is called one
 * thing in the list and another on the page" is a drift nobody notices until they
 * are looking for the plugin.
 */
export const NS = 'notebook'

export const zh = {
  panel: '笔记本',
  /** The directory column's own heading, which is the product's name. */
  library: '笔记本',
  newFile: '新建文件',
  newDir: '新建目录',
  refresh: '刷新目录',
  reveal: '在资源管理器中打开',
  revealFailed: '无法打开系统资源管理器',
  fileName: '文件名',
  dirName: '目录名',
  untitled: '未命名',
  saved: '已保存',
  unsaved: '未保存',
  chars: '字',
  style: '渲染风格',
  unwritableTitle: '工作区不可写',
  chatNoHost: '这个界面没有提供会话席位，无法在这里嵌入 Harness 对话。',
  resizeSide: '拖动调整目录区宽度（也可用左右方向键）',
  resizeChat: '拖动调整对话区宽度（也可用左右方向键）',
  writing: '写作',
  source: '源码',
  fontSize: '字号',
  /* The picker is a row of single characters — 黑, 宋, 霞, 阿 — with the full
     family name on the button's title, because four long names in a 268px column
     wrap into three lines and stop reading as one control. */
  fontSystem: '黑',
  fontSong: '宋',
  fontKai: '霞',
  fontPuhuiti: '阿',
  fontSystemName: '黑体（系统默认：微软雅黑 / 苹方）',
  fontSongName: '宋体',
  fontKaiName: '霞鹜文楷',
  fontPuhuitiName: '阿里巴巴普惠体',
  paperPlain: '简白',
  paperElegant: '雅致',
  paperNight: '黑夜',
  paperGreen: '绿荫',
  showChat: '显示对话区',
  hideChat: '隐藏对话区',
  /** The tab strip's accessible name; the tabs themselves are file names. */
  openFiles: '打开的文件',
  closeFile: '关闭文件',
  /** Appended to a tab's accessible name when that tab has unsaved changes. */
  unsavedSuffix: '，未保存',
  /** The editor column with no tab open. */
  openHint: '从左侧目录打开一个文件，或点目录标题行的「新建文件」。',
  /** A tab whose file is still being read. */
  loadingFile: '正在读取…',
  /* The directory tree's right-click menu. */
  rename: '重命名',
  delete: '删除',
  renameHint: '回车确认，Esc 取消',
  /* The heading's two edit actions, which act on the entry last taken hold of.
     They say which one, because the tree has no third "selected" mark to read it
     from. */
  renameEntry: '重命名「{name}」',
  deleteEntry: '删除「{name}」',
  /** Deletion is the one thing here that typing cannot undo, so it asks first. */
  deleteTitle: '删除',
  deleteFileQuestion: '确定删除「{name}」？此操作无法撤销。',
  deleteFolderQuestion: '确定删除文件夹「{name}」及其中全部内容？此操作无法撤销。',
  deleteConfirm: '删除',
  cancel: '取消',
  /** Shown when the folder's size could not be read; the question still stands. */
  deleteUnknownSize: '无法统计其中的文件数量。',
  deleteFolderCount: '其中共 {count} 个文件。',
} as const

export type StringKey = keyof typeof zh

/** A translate function over this plugin's key set. */
export type T = (key: StringKey) => string

export const en: Record<StringKey, string> = {
  panel: 'Notebook',
  library: 'Notebook',
  newFile: 'New file',
  newDir: 'New folder',
  refresh: 'Refresh the folder',
  reveal: 'Open in the file manager',
  revealFailed: 'Could not open the file manager',
  fileName: 'File name',
  dirName: 'Folder name',
  untitled: 'Untitled',
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  chars: 'chars',
  style: 'Render style',
  unwritableTitle: 'The workspace is not writable',
  chatNoHost: 'This shell exposes no conversation seat, so the harness chat cannot be embedded here.',
  resizeSide: 'Drag to resize the directory column (or use the arrow keys)',
  resizeChat: 'Drag to resize the conversation column (or use the arrow keys)',
  writing: 'Write',
  source: 'Source',
  fontSize: 'Size',
  fontSystem: 'Hei',
  fontSong: 'Song',
  fontKai: 'Kai',
  fontPuhuiti: 'AHP',
  fontSystemName: 'Hei (system default: Microsoft YaHei / PingFang)',
  fontSongName: 'Song (SimSun)',
  fontKaiName: 'LXGW WenKai',
  fontPuhuitiName: 'Alibaba PuHuiTi',
  paperPlain: 'Plain',
  paperElegant: 'Elegant',
  paperNight: 'Night',
  paperGreen: 'Green shade',
  showChat: 'Show the conversation',
  hideChat: 'Hide the conversation',
  openFiles: 'Open files',
  closeFile: 'Close file',
  unsavedSuffix: ', unsaved',
  openHint: 'Open a file from the directory on the left, or use “New file” in its heading.',
  loadingFile: 'Reading…',
  rename: 'Rename',
  delete: 'Delete',
  renameHint: 'Enter to confirm, Esc to cancel',
  renameEntry: 'Rename “{name}”',
  deleteEntry: 'Delete “{name}”',
  deleteTitle: 'Delete',
  deleteFileQuestion: 'Delete “{name}”? This cannot be undone.',
  deleteFolderQuestion: 'Delete the folder “{name}” and everything in it? This cannot be undone.',
  deleteConfirm: 'Delete',
  cancel: 'Cancel',
  deleteUnknownSize: 'The number of files inside could not be counted.',
  deleteFolderCount: '{count} file(s) inside.',
}

/** Resolve a key without the framework seat, falling back to Chinese. */
export function fallbackT(key: StringKey): string {
  return zh[key]
}

/** The dictionary set registered with the locale service. */
export const DICTS: Record<string, Record<string, string>> = {
  zh: { ...zh },
  en: { ...en },
}
