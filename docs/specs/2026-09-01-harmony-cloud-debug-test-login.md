# 鸿蒙云调试测试登录与会话恢复规格

日期：2026-09-01  
状态：已实现并完成本机构建/接口验证

## 背景与结论

AGC 云调试重新安装 APP 时会清空应用沙箱，AssetStoreKit 中的 token 也随之消失；同时云设备因隐私安全策略可能黑屏，只能借助控件树操作登录。仅增强 token 持久化无法跨卸载恢复，因此新增独立 `cloudDebug` product，在登录页首次出现时自动完成测试账号注册或登录。

## 架构决策

- `default`：正式 product。`CLOUD_DEBUG_TEST_LOGIN=false`，账号和密码构建字段为空；Release 环境未配置 HTTPS 时继续拒绝请求。
- `cloudDebug`：AGC 云调试 product。仍使用 Release 证书签名，但构建常量显式启用测试登录并连接开发服务器。
- 测试账号：只存测试数据、无管理权限，仍走 `/api/v1/auth/register`、`/auth/login` 与 `/users/me`，不新增后端免鉴权接口。
- 凭据来源：`harmony/cloud-debug.local.json`，被 Git 忽略；构建脚本通过 Hvigor 参数注入。仓库只保留无真实凭据的 example 文件。
- 会话：登录成功后继续使用既有 AssetStoreKit 加密 token、refresh single-flight 和 401 失效清理。它覆盖重启；自动测试登录覆盖云调试重装。

## 用户路径

1. 上传 `harmony-cloudDebug-signed.app` 到 AGC 云调试。
2. APP 首次启动发现没有会话，进入 Auth 页面。
3. `cloudDebug` 构建自动尝试注册测试账号；若用户名已存在则正常登录。
4. 登录成功自动进入 Index；若失败，页面显示原因并保留“使用云调试账号”重试按钮。

## 安全边界

- 不在仓库、日志或最终汇报中输出测试密码和 token。
- 正式 product 的生成 `BuildProfile.ets` 必须满足：测试登录 `false`、用户名长度 0、密码长度 0。
- cloudDebug APP 不用于对外分发；测试账号不得存放真实用户隐私。
- 后端没有新增 debug backdoor，测试账号只能读取自己的用户隔离数据。

## 构建与验收

```powershell
cd D:\bigproject\AdventureX\harmony
.\scripts\build-cloud-debug.ps1
```

已验证：

- 鸿蒙签名/SDK/Profile/Bundle 预检通过。
- `cloudDebug/release` 重复构建成功，APP 完成 `SignHap` 与 `SignApp`。
- `default/release` 构建成功。
- cloudDebug 生成常量启用且注入非空凭据；default 生成常量关闭且凭据长度为 0。
- 测试账号经正常注册接口建立，`/users/me` 身份一致且账号启用。

尚需在 AGC 云真机确认：黑屏场景下无需控件树输入即可自动进入首页。
