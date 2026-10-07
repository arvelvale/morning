/**
 * 陪伴模块入口（barrel）：拆分后各页面独立成文件，此处统一 re-export，
 * 保持 `../screens/Companion` 导入路径不变。
 * - CompanionJournal 往日手帐
 * - CompanionChat    聊天页
 * - ModeSheet        模式选择浮层
 */
export { CompanionJournal } from "./companion/CompanionJournal";
export { CompanionChat } from "./companion/CompanionChat";
export { ModeSheet } from "./companion/ModeSheet";
