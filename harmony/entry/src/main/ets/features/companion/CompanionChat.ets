/** 流式文字聊天：创建/恢复会话、增量回复、取消和失败后安全恢复。 */
import { hilog } from '@kit.PerformanceAnalysisKit';
import {
  ConversationDetail,
  ConversationMessage,
  createConversation,
  getActivePet,
  getConversation
} from '../../common/Api';
import {
  ColorTokens,
  controlHeights,
  fontSizes,
  fontWeights,
  lineHeights,
  radii,
  spacing,
  themeOf,
  MindTheme
} from '../../common/Theme';
import { SseClient } from '../../core/network/SseClient';
import { SseEvent } from '../../core/network/SseParser';

const TAG = 'MorningChat';

interface ChatUiMessage {
  key: string;
  role: string;
  content: string;
}

interface SendMessageBody {
  text: string;
}

@Component
export struct CompanionChat {
  initialConversationId: number | null = null;
  onBack: () => void = (): void => {};

  @StorageProp('isNight') isNight: boolean = false;
  @State conversationId: number | null = null;
  @State messages: ChatUiMessage[] = [];
  @State inputText: string = '';
  @State loading: boolean = true;
  @State sending: boolean = false;
  @State errorText: string = '';
  @State petName: string = '喵灵';

  private streamClient: SseClient = new SseClient();
  private nextLocalId: number = -1;

  private getTheme(): MindTheme {
    return themeOf(this.isNight);
  }

  private colors(): ColorTokens {
    return this.getTheme().colors;
  }

  async aboutToAppear(): Promise<void> {
    this.conversationId = this.initialConversationId;
    await this.restoreConversation();
  }

  aboutToDisappear(): void {
    this.streamClient.cancel();
  }

  private uiMessage(message: ConversationMessage): ChatUiMessage {
    return { key: `server-${message.id}`, role: message.role, content: message.content };
  }

  private async restoreConversation(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    try {
      try {
        const pet = await getActivePet();
        this.petName = pet.name;
      } catch {
        this.petName = '喵灵';
      }
      if (this.conversationId !== null) {
        const detail: ConversationDetail = await getConversation(this.conversationId);
        const restored: ChatUiMessage[] = [];
        for (let index = 0; index < detail.messages.length; index++) {
          restored.push(this.uiMessage(detail.messages[index]));
        }
        this.messages = restored;
      }
    } catch {
      this.errorText = '这段聊天暂时没有取回来，再试一次吧';
    } finally {
      this.loading = false;
      this.sending = false;
    }
  }

  private localMessage(role: string, content: string): ChatUiMessage {
    const key = `local-${this.nextLocalId}`;
    this.nextLocalId -= 1;
    return { key: key, role: role, content: content };
  }

  private updateAssistant(index: number, content: string): void {
    if (index < 0 || index >= this.messages.length) {
      return;
    }
    const next = this.messages.slice();
    const current = next[index];
    next[index] = { key: current.key, role: 'assistant', content: content };
    this.messages = next;
  }

  private tokenFrom(event: SseEvent): string | null {
    if (!event.data) {
      return null;
    }
    const record = event.data as Record<string, Object>;
    const delta = record['delta'];
    return typeof delta === 'string' ? delta : null;
  }

  private doneContent(event: SseEvent): string | null {
    if (!event.data) {
      return null;
    }
    const record = event.data as Record<string, Object>;
    const content = record['content'];
    return typeof content === 'string' ? content : null;
  }

  private async ensureConversation(): Promise<number> {
    if (this.conversationId !== null) {
      return this.conversationId;
    }
    let petId: number | null = null;
    try {
      const pet = await getActivePet();
      petId = pet.id;
      this.petName = pet.name;
    } catch {
      petId = null;
    }
    const conversation = await createConversation(petId, 'free_chat');
    this.conversationId = conversation.id;
    return conversation.id;
  }

  private async send(): Promise<void> {
    const text = this.inputText.trim();
    if (this.sending || text.length === 0) {
      return;
    }
    this.errorText = '';
    this.sending = true;
    this.inputText = '';
    this.messages = this.messages.concat([this.localMessage('user', text)]);
    const assistantIndex = this.messages.length;
    this.messages = this.messages.concat([this.localMessage('assistant', '')]);

    const startedAt = Date.now();
    let firstTokenAt = 0;
    let reply = '';
    try {
      const id = await this.ensureConversation();
      const body: SendMessageBody = { text: text };
      await this.streamClient.post(
        `/api/v1/conversations/${id}/messages?stream=true`,
        body,
        {
          onEvent: (event: SseEvent) => {
            if (event.event === 'token') {
              const delta = this.tokenFrom(event);
              if (delta) {
                if (firstTokenAt === 0) {
                  firstTokenAt = Date.now();
                  hilog.info(0x0000, TAG, 'First token latency: %{public}d ms', firstTokenAt - startedAt);
                }
                reply += delta;
                this.updateAssistant(assistantIndex, reply);
              }
            } else if (event.event === 'done') {
              const complete = this.doneContent(event);
              if (complete !== null) {
                reply = complete;
                this.updateAssistant(assistantIndex, complete);
              }
            }
          }
        }
      );
      hilog.info(0x0000, TAG, 'Reply complete in %{public}d ms', Date.now() - startedAt);
    } catch (err) {
      const e = err as Error;
      this.errorText = e.message === '已停止回复'
        ? '已经停止生成，可重新载入这段对话'
        : '回复中断了，重新载入可检查服务端是否已经完成';
      if (reply.length === 0) {
        this.updateAssistant(assistantIndex, '…');
      }
    } finally {
      this.sending = false;
    }
  }

  private cancelReply(): void {
    if (!this.sending) {
      return;
    }
    this.streamClient.cancel();
  }

  @Builder
  messageBubble(message: ChatUiMessage) {
    Row() {
      Column() {
        Text(message.role === 'user' ? '你' : this.petName)
          .fontSize(fontSizes.label)
          .fontColor(message.role === 'user' ? this.colors().textMuted : this.colors().accent)
        Text(message.content.length > 0 ? message.content : '…')
          .fontSize(fontSizes.body)
          .lineHeight(lineHeights.body)
          .fontColor(this.colors().textPrimary)
          .margin({ top: spacing.s1 })
      }
      .alignItems(HorizontalAlign.Start)
      .padding({ left: spacing.s4, right: spacing.s4, top: spacing.s3, bottom: spacing.s3 })
      .constraintSize({ maxWidth: '84%' })
      .backgroundColor(message.role === 'user' ? this.colors().accentSoft : this.colors().surface)
      .borderRadius(radii.card)
    }
    .width('100%')
    .justifyContent(message.role === 'user' ? FlexAlign.End : FlexAlign.Start)
    .margin({ bottom: spacing.s3 })
  }

  build() {
    Column() {
      Row({ space: spacing.s3 }) {
        Button('‹')
          .width(42)
          .height(42)
          .fontSize(28)
          .fontColor(this.colors().textSecondary)
          .backgroundColor(this.colors().surface)
          .borderRadius(radii.pill)
          .onClick(() => this.onBack())
        Column({ space: spacing.s1 }) {
          Text(`和${this.petName}聊聊`)
            .fontSize(fontSizes.sectionTitle)
            .fontWeight(fontWeights.medium)
            .fontColor(this.colors().textPrimary)
          Text(this.sending ? '正在认真听，也在想怎么回你…' : '想说什么都可以')
            .fontSize(fontSizes.label)
            .fontColor(this.colors().textMuted)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        if (this.sending) {
          Button('停止')
            .height(38)
            .fontSize(fontSizes.caption)
            .fontColor(this.colors().error)
            .backgroundColor(this.colors().surface)
            .borderRadius(radii.pill)
            .onClick(() => this.cancelReply())
        }
      }
      .width('100%')
      .padding({ left: spacing.s5, right: spacing.s5, top: spacing.s4, bottom: spacing.s3 })

      if (this.loading) {
        Column({ space: spacing.s3 }) {
          LoadingProgress().width(28).height(28).color(this.colors().accent)
          Text('正在翻开这段往日…')
            .fontSize(fontSizes.caption)
            .fontColor(this.colors().textMuted)
        }
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        List() {
          if (this.messages.length === 0) {
            ListItem() {
              Column({ space: spacing.s2 }) {
                Image(this.petName === '波比' ? $r('app.media.bobi_avatar') : $r('app.media.miro_avatar'))
                  .width(76)
                  .height(76)
                  .objectFit(ImageFit.Contain)
                Text('我在呢，你慢慢说。')
                  .fontSize(fontSizes.bodyLarge)
                  .fontColor(this.colors().textSecondary)
              }
              .width('100%')
              .height(240)
              .justifyContent(FlexAlign.Center)
            }
          }
          ForEach(this.messages, (message: ChatUiMessage) => {
            ListItem() {
              this.messageBubble(message)
            }
          }, (message: ChatUiMessage) => message.key)
        }
        .layoutWeight(1)
        .width('100%')
        .padding({ left: spacing.s5, right: spacing.s5 })
        .scrollBar(BarState.Off)
        .edgeEffect(EdgeEffect.Spring)
      }

      if (this.errorText.length > 0) {
        Row() {
          Text(this.errorText)
            .fontSize(fontSizes.label)
            .fontColor(this.colors().warning)
            .layoutWeight(1)
          Text('重新载入')
            .fontSize(fontSizes.label)
            .fontWeight(fontWeights.medium)
            .fontColor(this.colors().accent)
            .onClick(() => {
              void this.restoreConversation();
            })
        }
        .width('100%')
        .padding({ left: spacing.s5, right: spacing.s5, top: spacing.s2, bottom: spacing.s2 })
      }

      Row({ space: spacing.s3 }) {
        TextInput({ text: this.inputText, placeholder: '说点什么…' })
          .height(controlHeights.large)
          .layoutWeight(1)
          .fontSize(fontSizes.body)
          .fontColor(this.colors().textPrimary)
          .placeholderColor(this.colors().placeholder)
          .backgroundColor(this.colors().surface)
          .borderRadius(radii.pill)
          .borderWidth(1)
          .borderColor(this.colors().border)
          .padding({ left: spacing.s5, right: spacing.s5 })
          .enabled(!this.sending)
          .onChange((value: string) => this.inputText = value)
          .onSubmit(() => {
            void this.send();
          })
        Button(this.sending ? '…' : '发送')
          .height(controlHeights.large)
          .fontSize(fontSizes.body)
          .fontWeight(fontWeights.medium)
          .fontColor(this.colors().textOnAccent)
          .backgroundColor(this.colors().accentSurface)
          .borderRadius(radii.pill)
          .enabled(!this.sending && this.inputText.trim().length > 0)
          .opacity(!this.sending && this.inputText.trim().length > 0 ? 1 : 0.55)
          .onClick(() => {
            void this.send();
          })
      }
      .width('100%')
      .padding({ left: spacing.s5, right: spacing.s5, top: spacing.s3, bottom: spacing.s4 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors().background)
  }
}
