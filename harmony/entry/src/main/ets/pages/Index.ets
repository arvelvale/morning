/**
 * 主框架：登录态检查 + 底部 Tab 壳。
 *
 * 第一阶段只有陪伴页占位与「我的」退出登录；信箱/片场页面在后续阶段逐页移植。
 * 选中态遵循视觉规范：半透明奶油鹅黄、暖棕前景、克制柔光。
 */
import { common } from '@kit.AbilityKit';
import { currentTokens, getMe, initApi, logout } from '../common/Api';
import { CompanionHome } from '../features/companion/CompanionHome';
import { CompanionChat } from '../features/companion/CompanionChat';
import { Dump } from '../features/dump/Dump';
import { MailboxHome } from '../features/mailbox/MailboxHome';
import {
  ColorTokens,
  fontSizes,
  fontWeights,
  radii,
  shadows,
  spacing,
  themeOf,
  MindTheme
} from '../common/Theme';

const TAB_TITLES: string[] = ['陪伴', '信箱', '片场', '我的'];

@Entry
@Component
struct IndexPage {
  @StorageProp('isNight') isNight: boolean = false;
  @StorageLink('sessionRevision') @Watch('onSessionRevision') sessionRevision: number = 0;
  @State ready: boolean = false;
  @State currentTab: number = 0;
  @State startupHint: string = '';
  @State chatOpen: boolean = false;
  @State chatConversationId: number | null = null;
  @State dumpOpen: boolean = false;
  @State mailboxRevision: number = 0;

  private getTheme(): MindTheme {
    return themeOf(this.isNight);
  }

  private openDump(): void {
    this.dumpOpen = true;
  }

  private closeDump(): void {
    this.dumpOpen = false;
  }

  /** 倾倒回执 → 信箱：切 Tab 并触发信箱刷新。 */
  private gotoMailbox(): void {
    this.dumpOpen = false;
    this.currentTab = 1;
    this.mailboxRevision += 1;
  }

  private colors(): ColorTokens {
    return this.getTheme().colors;
  }

  async aboutToAppear(): Promise<void> {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    await initApi(context);
    if (!currentTokens()) {
      await this.goToAuth();
      return;
    }
    try {
      await getMe();
      this.ready = true;
    } catch {
      if (!currentTokens()) {
        await this.goToAuth();
      } else {
        this.startupHint = '暂时连接不上喵灵，检查网络后再试一次';
      }
    }
  }

  private onSessionRevision(): void {
    if (!currentTokens()) {
      this.ready = false;
      void this.goToAuth();
    }
  }

  private async goToAuth(): Promise<void> {
    try {
      await this.getUIContext().getRouter().replaceUrl({ url: 'pages/Auth' });
    } catch {
      this.startupHint = '页面跳转失败，请重新打开应用';
    }
  }

  private async doLogout(): Promise<void> {
    await logout();
    await this.goToAuth();
  }

  private async retryStartup(): Promise<void> {
    this.startupHint = '';
    try {
      await getMe();
      this.ready = true;
    } catch {
      if (!currentTokens()) {
        await this.goToAuth();
      } else {
        this.startupHint = '还是没有连上，稍后再试试';
      }
    }
  }

  private openChat(conversationId: number | null): void {
    this.chatConversationId = conversationId;
    this.chatOpen = true;
  }

  private closeChat(): void {
    this.chatOpen = false;
    this.chatConversationId = null;
  }

  @Builder
  tabBuilder(title: string, index: number) {
    Column() {
      Text(title)
        .fontSize(fontSizes.label)
        .fontWeight(this.currentTab === index ? fontWeights.medium : fontWeights.regular)
        .fontColor(this.currentTab === index
          ? this.getTheme().colors.textPrimary
          : this.getTheme().colors.textMuted);
    }
    .width(64)
    .height(40)
    .borderRadius(radii.pill)
    .backgroundColor(this.currentTab === index
      ? this.getTheme().colors.accentSoft
      : 'rgba(0,0,0,0)')
    .justifyContent(FlexAlign.Center)
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  placeholderCard(title: string, desc: string) {
    Column({ space: spacing.s2 }) {
      Text(title)
        .fontSize(fontSizes.sectionTitle)
        .fontWeight(fontWeights.medium)
        .fontColor(this.getTheme().colors.textPrimary);
      Text(desc)
        .fontSize(fontSizes.body)
        .lineHeight(23)
        .fontColor(this.getTheme().colors.textSecondary)
        .textAlign(TextAlign.Center);
    }
    .padding(spacing.s6)
    .backgroundColor(this.getTheme().colors.surface)
    .borderRadius(radii.card)
    .shadow({
      radius: shadows.soft.radius,
      color: shadows.soft.color,
      offsetX: shadows.soft.offsetX,
      offsetY: shadows.soft.offsetY
    })
    .width('100%')
    .alignItems(HorizontalAlign.Center)
  }

  build() {
    if (!this.ready) {
      Column() {
        Image($r('app.media.miro_idle_v3'))
          .width(72)
          .height(72)
          .objectFit(ImageFit.Contain);
        Text(this.startupHint.length > 0 ? this.startupHint : '正在唤醒喵灵…')
          .fontSize(fontSizes.caption)
          .fontColor(this.colors().textMuted)
          .margin({ top: spacing.s3 });
        if (this.startupHint.length > 0) {
          Button('重新连接')
            .margin({ top: spacing.s4 })
            .height(40)
            .borderRadius(radii.pill)
            .backgroundColor(this.colors().accentSoft)
            .fontColor(this.colors().accent)
            .onClick(() => {
              void this.retryStartup();
            });
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.colors().background)
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
    } else {
      Tabs({ barPosition: BarPosition.End, index: this.currentTab }) {
        TabContent() {
          if (this.dumpOpen) {
            Dump({
              onBack: () => this.closeDump(),
              onGotoMailbox: () => this.gotoMailbox()
            })
          } else if (this.chatOpen) {
            CompanionChat({
              initialConversationId: this.chatConversationId,
              onBack: () => this.closeChat()
            })
          } else {
            CompanionHome({
              onStartChat: (conversationId: number | null) => this.openChat(conversationId),
              onStartDump: () => this.openDump()
            })
          }
        }
        .tabBar(this.tabBuilder(TAB_TITLES[0], 0))

        TabContent() {
          MailboxHome({
            revision: this.mailboxRevision,
            onReplyLetter: () => {
              this.currentTab = 0;
              this.openChat(null);
            }
          })
        }
        .tabBar(this.tabBuilder(TAB_TITLES[1], 1))

        TabContent() {
          Column() {
            this.placeholderCard('片场', '把没闭环的过去，在这里重演了结。')
          }
          .width('100%')
          .height('100%')
          .padding(spacing.s5)
          .backgroundColor(this.colors().background)
        }
        .tabBar(this.tabBuilder(TAB_TITLES[2], 2))

        TabContent() {
          Column({ space: spacing.s4 }) {
            this.placeholderCard('我的', '偏好与记忆管理稍后开放。')
            Button('退出登录')
              .height(44)
              .backgroundColor(this.colors().surface)
              .fontColor(this.colors().error)
              .fontSize(fontSizes.body)
              .borderRadius(radii.pill)
              .borderWidth(1)
              .borderColor(this.colors().border)
              .onClick(() => {
                void this.doLogout();
              });
          }
          .width('100%')
          .height('100%')
          .padding(spacing.s5)
          .backgroundColor(this.colors().background)
        }
        .tabBar(this.tabBuilder(TAB_TITLES[3], 3))
      }
      .barHeight(60)
      .barBackgroundColor(this.colors().surface)
      .onChange((index: number) => {
        this.currentTab = index;
        if (index === 1) {
          this.mailboxRevision += 1;
        }
      })
      .width('100%')
      .height('100%')
    }
  }
}
