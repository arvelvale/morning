/** 仅在服务器确认后应用设置；网络失败时保留原值，不显示虚假的「已关闭」。 */
export async function saveConfirmedPreferences<P, S>(
  patch: P,
  save: (patch: P) => Promise<S>,
  apply: (saved: S) => void,
): Promise<void> {
  const saved = await save(patch);
  apply(saved);
}
