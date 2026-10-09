/**
 * Host half of dsh-rightclick.
 *
 * Host 侧没有任何职责：区域判定、菜单渲染、八个动作全部在浏览器半完成，
 * 取「当前会话 id」也是读客户端已有的 sessions 投影。
 *
 * 这里保留一个空 apply，是为了让 bundle 的 patch 行能正常解析成 Host 插件行
 * （loader 会按 package.json 的 dsh.client 再把客户端模块装配起来）。
 * 后续若某个动作需要 Host 侧的统一入口（官方 user-actions 模式：一个 Host 服务
 * 方法 + remote.commands 走 UI + 同名 agent tool），实现落在这里。
 */

export const name = 'dsh-rightclick';

export function apply() {
  /* 无 Host 侧资源需要注册。 */
}
