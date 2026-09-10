/**
 * 零件目录对外入口（保持与旧单文件 props.ts 相同的导入路径与 API）。
 * 实现：props/ 目录按域拆分（furniture/nature/environment/urban/vehicle/decor/ambient），
 * 注册表集中在 registry.ts——SceneSpec 的 type 字符串不受目录结构影响。
 */
export { buildProp, PROP_BUILDERS, PROP_TYPES } from "./registry";
export type { Params, PropBuilder } from "./shared";
