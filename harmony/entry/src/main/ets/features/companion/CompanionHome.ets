/**
 * 陪伴首页：真实伙伴状态、最近对话、轻量邀请与聊天入口。
 */
import {
  CompanionHomeResponse,
  ConversationSummary,
  getActivePet,
  getCompanionHome,
  listConversations,
  listPets,
  PetDetail
} from '../../common/Api';
import {
  ColorTokens,
  fontSizes,
  fontWeights,
  lineHeights,
  radii,
  shadows,
  spacing,
  themeOf,
  MindTheme
} from '../../common/Theme';

const MIRO_WAITING_FRAMES: ImageFrameInfo[] = [
  { src: $r('app.media.miro_waiting_00') },
  { src: $r('app.media.miro_waiting_01') },
  { src: $r('app.media.miro_waiting_02') },
  { src: $r('app.media.miro_waiting_03') },
  { src: $r('app.media.miro_waiting_04') },
  { src: $r('app.media.miro_waiting_05') },
  { src: $r('app.media.miro_waiting_06') },
  { src: $r('app.media.miro_waiting_07') }
];

@Component
export struct CompanionHome {
  onStartChat: (conversationId: number | null) => void = (_conversationId: number | null): void => {};
  onStartDump: () => void = (): void => {};
  @StorageProp('isNight') isNight: boolean = false;
  @State loading: boolean = true;
  @State errorText: string = '';
  @State home: CompanionHomeResponse | null = null;
  @State activePet: PetDetail | null = null;
  @State petCount: number = 0;
  @State conversations: ConversationSummary[] = [];
  @State actionHint: string = '';

  private getTheme(): MindTheme {
    return themeOf(this.isNight);
  }

  private colors(): ColorTokens {
    return this.getTheme().colors;
  }

  private petName(): string {
    return this.home?.pet?.name ?? this.activePet?.name ?? '喵灵';
  }

  private presetId(): string | null {
    return this.home?.pet?.preset_id ?? this.activePet?.preset_id ?? null;
  }

  private invitationText(): string {
    if (this.home?.invitation?.text) {
      return this.home.invitation.text;
    }
    if (this.conversations.length > 0) {
      return `上次你说「${this.shortTitle(this.conversations[0])}」`;
    }
    if (this.home?.behavior) {
      return `我正在${this.home.behavior}，要来坐一会儿吗？`;
    }
    return '今天过得怎么样？';
  }

  private shortTitle(conversation: ConversationSummary): string {
    const raw = conversation.title?.trim() || '自由聊聊';
    return raw.length > 18 ? `${raw.slice(0, 18)}…` : raw;
  }

  private dateLine(): string {
    const now = new Date();
    const weekdays = '日一二三四五六';
    return `${now.getMonth() + 1}月${now.getDate()}日 周${weekdays.charAt(now.getDay())}`;
  }

  async aboutToAppear(): Promise<void> {
    await this.loadHome();
  }

  private async loadHome(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    try {
      this.home = await getCompanionHome();
      this.conversations = await listConversations();
      const pets = await listPets();
      this.petCount = pets.length;
      try {
        this.activePet = await getActivePet();
      } catch {
        this.activePet = null;
      }
    } catch {
      this.errorText = '伙伴状态暂时没有送到，再试一次吧';
    } finally {
      this.loading = false;
    }
  }

  private showVoiceHint(): void {
    this.actionHint = '实时语音会在语音里程碑接通，现在可以先用文字聊聊';
  }

  @Builder
  petArtwork() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width(270)
        .height(270)
        .borderRadius(140)
        .backgroundColor(this.colors().accentSoft)
      if (this.presetId() === 'miro') {
        ImageAnimator()
          .images(MIRO_WAITING_FRAMES)
          .state(AnimationStatus.Running)
          .duration(667)
          .iterations(-1)
          .width(300)
          .height(300)
      } else if (this.presetId() === 'bobi') {
        Image($r('app.media.bobi_avatar'))
          .objectFit(ImageFit.Contain)
          .width(250)
          .height(250)
      } else {
        Image($r('app.media.miro_idle_v3'))
          .objectFit(ImageFit.Contain)
          .width(300)
          .height(300)
      }
    }
    .width('100%')
    .height(315)
  }

  @Builder
  errorState() {
    Column({ space: spacing.s4 }) {
      Text(this.errorText)
        .fontSize(fontSizes.body)
        .fontColor(this.colors().textSecondary)
        .textAlign(TextAlign.Center)
      Button('重新连接')
        .height(44)
        .borderRadius(radii.pill)
        .backgroundColor(this.colors().accentSoft)
        .fontColor(this.colors().accent)
        .onClick(() => {
          void this.loadHome();
        })
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
  }

  build() {
    if (this.loading) {
      Column({ space: spacing.s3 }) {
        LoadingProgress()
          .width(30)
          .height(30)
          .color(this.colors().accent)
        Text('正在听听它此刻的动静…')
          .fontSize(fontSizes.caption)
          .fontColor(this.colors().textMuted)
      }
      .width('100%')
      .height('100%')
      .justifyContent(FlexAlign.Center)
    } else if (this.errorText.length > 0) {
      this.errorState()
    } else {
      Scroll() {
        Column() {
          Row() {
            Column({ space: spacing.s1 }) {
              Text(`${this.dateLine()} · ${this.home?.status_text ?? '在等你'}`)
                .fontSize(fontSizes.label)
                .fontColor(this.colors().textMuted)
              Row({ space: spacing.s3 }) {
                Text(this.petName())
                  .fontSize(fontSizes.pageTitle)
                  .fontWeight(fontWeights.medium)
                  .fontColor(this.colors().textPrimary)
                if (this.conversations.length > 0) {
                  Text(`往日 ${this.conversations.length}`)
                    .fontSize(fontSizes.label)
                    .fontColor(this.colors().accent)
                    .padding({ left: spacing.s3, right: spacing.s3, top: spacing.s1, bottom: spacing.s1 })
                    .borderRadius(radii.pill)
                    .borderWidth(1)
                    .borderColor(this.colors().border)
                }
              }
              .alignItems(VerticalAlign.Center)
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Text(this.isNight ? '日间' : '夜间')
              .fontSize(fontSizes.label)
              .fontColor(this.colors().textSecondary)
              .padding({ left: spacing.s3, right: spacing.s3, top: spacing.s2, bottom: spacing.s2 })
              .borderRadius(radii.pill)
              .backgroundColor(this.colors().surface)
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)

          Column({ space: spacing.s1 }) {
            Text(this.invitationText())
              .fontSize(fontSizes.bodyLarge)
              .lineHeight(lineHeights.bodyLarge)
              .fontColor(this.colors().textPrimary)
            Text(this.conversations.length > 0 ? '接着聊  ›' : '我在呢，慢慢说')
              .fontSize(fontSizes.caption)
              .fontWeight(fontWeights.medium)
              .fontColor(this.colors().accent)
          }
          .width('88%')
          .alignItems(HorizontalAlign.Start)
          .padding({ left: spacing.s5, right: spacing.s5, top: spacing.s4, bottom: spacing.s4 })
          .margin({ top: spacing.s5 })
          .backgroundColor(this.colors().surfaceElevated)
          .borderRadius(radii.card)
          .shadow({
            radius: shadows.soft.radius,
            color: shadows.soft.color,
            offsetX: shadows.soft.offsetX,
            offsetY: shadows.soft.offsetY
          })
          .onClick(() => this.onStartChat(this.conversations.length > 0 ? this.conversations[0].id : null))

          this.petArtwork()

          Text(`轻触和${this.petName()}说话`)
            .fontSize(fontSizes.caption)
            .fontColor(this.colors().textMuted)
            .onClick(() => this.showVoiceHint())

          Row({ space: spacing.s3 }) {
            Row() {
              Text('说点什么…')
                .fontSize(fontSizes.body)
                .fontColor(this.colors().placeholder)
                .layoutWeight(1)
              Text('文字')
                .fontSize(fontSizes.caption)
                .fontColor(this.colors().accent)
            }
            .height(54)
            .layoutWeight(1)
            .padding({ left: spacing.s5, right: spacing.s4 })
            .borderRadius(radii.pill)
            .borderWidth(1)
            .borderColor(this.colors().border)
            .backgroundColor(this.colors().surface)
            .alignItems(VerticalAlign.Center)
            .onClick(() => this.onStartChat(null))

            Button('+')
              .width(54)
              .height(54)
              .fontSize(26)
              .fontColor(this.colors().accent)
              .backgroundColor(this.colors().accentSoft)
              .borderRadius(radii.control)
              .onClick(() => this.onStartDump())
          }
          .width('100%')

          if (this.actionHint.length > 0) {
            Text(this.actionHint)
              .fontSize(fontSizes.label)
              .fontColor(this.colors().textMuted)
              .textAlign(TextAlign.Center)
              .margin({ top: spacing.s3 })
          }

          Text(`已连接 ${this.petCount} 位伙伴`)
            .fontSize(fontSizes.label)
            .fontColor(this.colors().textMuted)
            .margin({ top: spacing.s4 })
        }
        .width('100%')
        .padding({ left: spacing.s5, right: spacing.s5, top: spacing.s5, bottom: spacing.s8 })
      }
      .width('100%')
      .height('100%')
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
    }
  }
}
