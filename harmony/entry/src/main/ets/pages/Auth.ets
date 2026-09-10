/**
 * 登录与注册（HarmonyOS 版）。与 frontend-demo/src/screens/Auth.tsx 同文案同交互，
 * 手机端只保留紧凑单列布局；桌面宽屏双栏留待后续响应式阶段。
 */
import { ApiError, login, register } from '../common/Api';
import {
  CLOUD_DEBUG_PASSWORD,
  CLOUD_DEBUG_TEST_LOGIN,
  CLOUD_DEBUG_USERNAME
} from 'BuildProfile';
import {
  ColorTokens,
  controlHeights,
  fontSizes,
  fontWeights,
  lineHeights,
  radii,
  shadows,
  spacing,
  themeOf,
  MindTheme
} from '../common/Theme';

@Entry
@Component
struct AuthPage {
  @StorageProp('isNight') isNight: boolean = false;
  @State mode: string = 'login';
  @State username: string = '';
  @State password: string = '';
  @State showPassword: boolean = false;
  @State hint: string = '';
  @State loading: boolean = false;
  @State cloudDebugAttempted: boolean = false;

  aboutToAppear(): void {
    if (this.isCloudDebugLoginAvailable() && !this.cloudDebugAttempted) {
      this.cloudDebugAttempted = true;
      void this.submitCloudDebugLogin();
    }
  }

  private getTheme(): MindTheme {
    return themeOf(this.isNight);
  }

  private colors(): ColorTokens {
    return this.getTheme().colors;
  }

  private isLogin(): boolean {
    return this.mode === 'login';
  }

  private switchMode(): void {
    this.mode = this.isLogin() ? 'register' : 'login';
    this.hint = '';
    this.password = '';
    this.showPassword = false;
  }

  private isCloudDebugLoginAvailable(): boolean {
    return CLOUD_DEBUG_TEST_LOGIN &&
      CLOUD_DEBUG_USERNAME.length >= 3 &&
      CLOUD_DEBUG_PASSWORD.length >= 6;
  }

  /**
   * 仅 cloudDebug product 可达：首次安装注册专属低权限账号，之后正常登录。
   * 账号仍走正式 Auth 契约，没有绕过后端鉴权，也不能读取其他用户数据。
   */
  private async submitCloudDebugLogin(): Promise<void> {
    if (this.loading || !this.isCloudDebugLoginAvailable()) {
      return;
    }
    this.hint = '正在进入云调试账号…';
    this.loading = true;
    try {
      try {
        await register(CLOUD_DEBUG_USERNAME, CLOUD_DEBUG_PASSWORD);
      } catch (err) {
        const e = err as Error;
        if (!e || e.message !== '用户名已被占用') {
          throw new ApiError(e && e.message ? e.message : '云调试账号注册失败');
        }
        await login(CLOUD_DEBUG_USERNAME, CLOUD_DEBUG_PASSWORD);
      }
      await this.getUIContext().getRouter().replaceUrl({ url: 'pages/Index' });
    } catch (err) {
      const e = err as Error;
      this.hint = e && e.message
        ? `云调试登录失败：${e.message}`
        : '云调试登录失败，请重试';
    } finally {
      this.loading = false;
    }
  }

  private async submit(): Promise<void> {
    if (this.loading) {
      return;
    }
    if (this.username.trim().length < 3) {
      this.hint = '用户名至少 3 个字符';
      return;
    }
    if (this.password.length < 6) {
      this.hint = '密码至少 6 位';
      return;
    }

    this.hint = '';
    this.loading = true;
    try {
      if (this.isLogin()) {
        await login(this.username.trim(), this.password);
      } else {
        await register(this.username.trim(), this.password);
      }
      await this.getUIContext().getRouter().replaceUrl({ url: 'pages/Index' });
    } catch (err) {
      const e = err as Error;
      this.hint = e && e.message ? e.message : '出了点问题，待会儿再试试';
    } finally {
      this.loading = false;
    }
  }

  build() {
    Scroll() {
      Column({ space: spacing.s8 }) {
        // ─── 品牌区 ─────────────────────────────────────────────────────
        Row({ space: spacing.s3 }) {
          Column() {
            Text('✦')
              .fontSize(24)
              .fontColor(this.colors().accent);
          }
          .width(52)
          .height(52)
          .borderRadius(radii.card)
          .borderWidth(1)
          .borderColor(this.colors().border)
          .backgroundColor(this.colors().accentSoft)
          .justifyContent(FlexAlign.Center)
          .alignItems(HorizontalAlign.Center)

          Column({ space: 2 }) {
            Text('喵灵')
              .fontSize(fontSizes.sectionTitle)
              .fontWeight(fontWeights.medium)
              .fontColor(this.colors().textPrimary);
            Text('陪你把心里的事，轻轻放下')
              .fontSize(fontSizes.caption)
              .fontColor(this.colors().textSecondary);
          }
          .alignItems(HorizontalAlign.Start)
        }
        .alignItems(VerticalAlign.Center)
        .width('100%')

        // ─── 表单卡 ─────────────────────────────────────────────────────
        Column() {
          Text(this.isLogin() ? '欢迎回来' : '第一次见面')
            .fontSize(fontSizes.pageTitle)
            .lineHeight(lineHeights.pageTitle)
            .fontWeight(fontWeights.medium)
            .fontColor(this.colors().textPrimary)
            .width('100%');
          Text(this.isLogin()
            ? '它一直在这儿，等你回来说话。'
            : '给自己起个名字，我们慢慢认识。')
            .fontSize(fontSizes.body)
            .lineHeight(lineHeights.body)
            .fontColor(this.colors().textSecondary)
            .margin({ top: spacing.s2, bottom: spacing.s6 })
            .width('100%');

          // 用户名
          Column({ space: 6 }) {
            Text('用户名')
              .fontSize(fontSizes.caption)
              .fontColor(this.colors().textSecondary);
            TextInput({ placeholder: this.isLogin() ? '你的名字' : '想让我怎么称呼你' })
              .height(controlHeights.large)
              .backgroundColor(this.colors().surface)
              .borderRadius(radii.control)
              .borderWidth(1)
              .borderColor(this.colors().border)
              .placeholderColor(this.colors().placeholder)
              .placeholderFont({ size: fontSizes.body })
              .fontColor(this.colors().textPrimary)
              .fontSize(fontSizes.body)
              .padding({ left: spacing.s4, right: spacing.s4 })
              .onChange((value: string) => {
                this.username = value;
                this.hint = '';
              })
              .width('100%');
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)

          // 密码
          Column({ space: 6 }) {
            Text('密码')
              .fontSize(fontSizes.caption)
              .fontColor(this.colors().textSecondary);
            Row() {
              TextInput({ placeholder: '悄悄话，只有你知道' })
                .height(controlHeights.large)
                .type(this.showPassword ? InputType.Normal : InputType.Password)
                .backgroundColor(this.colors().surface)
                .borderRadius(radii.control)
                .borderWidth(1)
                .borderColor(this.colors().border)
                .placeholderColor(this.colors().placeholder)
                .placeholderFont({ size: fontSizes.body })
                .fontColor(this.colors().textPrimary)
                .fontSize(fontSizes.body)
                .padding({ left: spacing.s4, right: spacing.s4 })
                .onChange((value: string) => {
                  this.password = value;
                  this.hint = '';
                })
                .onSubmit(() => {
                  void this.submit();
                })
                .layoutWeight(1);
              Text(this.showPassword ? '隐藏' : '显示')
                .fontSize(fontSizes.caption)
                .fontColor(this.colors().textMuted)
                .height(controlHeights.large)
                .padding({ left: spacing.s3, right: spacing.s1 })
                .textAlign(TextAlign.Center)
                .onClick(() => {
                  this.showPassword = !this.showPassword;
                });
            }
            .width('100%')
            .alignItems(VerticalAlign.Center)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .margin({ top: spacing.s4 })

          // 校验提示（常驻高度避免跳动）
          Column() {
            if (this.hint.length > 0) {
              Text(this.hint)
                .fontSize(fontSizes.caption)
                .fontColor(this.colors().warning);
            }
          }
          .width('100%')
          .height(24)
          .justifyContent(FlexAlign.Center)
          .margin({ top: spacing.s3, bottom: spacing.s3 })
          .alignItems(HorizontalAlign.Start)

          Button(this.loading
            ? (this.isLogin() ? '登录中…' : '创建中…')
            : (this.isLogin() ? '进来坐坐' : '开始吧'))
            .width('100%')
            .height(controlHeights.large)
            .backgroundColor(this.colors().accentSurface)
            .fontColor(this.colors().textOnAccent)
            .fontSize(fontSizes.bodyLarge)
            .fontWeight(fontWeights.medium)
            .borderRadius(radii.pill)
            .enabled(!this.loading)
            .opacity(this.loading ? 0.6 : 1)
            .onClick(() => {
              void this.submit();
            });

          if (this.isCloudDebugLoginAvailable()) {
            Button('使用云调试账号')
              .width('100%')
              .height(controlHeights.standard)
              .backgroundColor(this.colors().surface)
              .fontColor(this.colors().accent)
              .fontSize(fontSizes.caption)
              .borderRadius(radii.pill)
              .borderWidth(1)
              .borderColor(this.colors().border)
              .enabled(!this.loading)
              .opacity(this.loading ? 0.6 : 1)
              .margin({ top: spacing.s3 })
              .onClick(() => {
                void this.submitCloudDebugLogin();
              });
          }

          Row({ space: spacing.s2 }) {
            Text(this.isLogin() ? '还没有账号？' : '已经有账号了？')
              .fontSize(fontSizes.caption)
              .fontColor(this.colors().textSecondary);
            Text(this.isLogin() ? '创建一个' : '回来登录')
              .fontSize(fontSizes.caption)
              .fontWeight(fontWeights.medium)
              .fontColor(this.colors().accent)
              .onClick(() => this.switchMode());
          }
          .width('100%')
          .justifyContent(FlexAlign.Center)
          .margin({ top: spacing.s4 })

          if (!this.isLogin()) {
            Text('demo 版只需用户名与密码，无需验证码')
              .fontSize(fontSizes.label)
              .fontColor(this.colors().textMuted)
              .width('100%')
              .textAlign(TextAlign.Center)
              .margin({ top: spacing.s3 });
          }
        }
        .padding(spacing.s5)
        .backgroundColor(this.colors().surface)
        .borderRadius(radii.card)
        .shadow({
          radius: shadows.floating.radius,
          color: shadows.floating.color,
          offsetX: shadows.floating.offsetX,
          offsetY: shadows.floating.offsetY
        })
        .width('100%')
        .constraintSize({ maxWidth: 520 })
      }
      .width('100%')
      .constraintSize({ maxWidth: 560 })
      .padding({ left: spacing.s5, right: spacing.s5, top: spacing.s8, bottom: spacing.s8 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors().background)
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.Spring)
    .align(Alignment.Top)
  }
}
