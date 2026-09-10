/**
 * 睡前倾倒：把今晚没闭环的事交给喵灵整理（对齐 RN 端 Dump 三屏）。
 *
 * 输入「今晚的念头」→ 处理中（SSE 逐条接住）→ 回执「已替你接住 N 个念头」。
 * 即使分类失败，原文也已在服务端安全保留（回执 fallback 时提示「先替你收着」）。
 * 语音输入在 M3 真机阶段补。
 */
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

export interface DumpReceiptItem {
  kind: string;
  content: string;
  memory_id: number;
}

export interface DumpReceipt {
  dump_id: number;
  total: number;
  kind_counts: Record<string, number>;
  /** true = 提取失败走兜底，原文已保留。 */
  fallback: boolean;
  error: string;
  items: DumpReceiptItem[];
}

interface DumpBody {
  text: string;
}

type DumpPhase = 'input' | 'processing' | 'receipt';

/** 回执四卡的固定语义（与 RN 端 KIND_META 一致；灵感合并「小结」）。 */
const KIND_META: KindMeta[] = [
  { icon: '📮', kind: '待办', label: '明天要接住', unit: '件事' },
  { icon: '💡', kind: '灵感', label: '值得留下的想法', unit: '条' },
  { icon: '🫧', kind: '情绪', label: '被听见的感受', unit: '个' },
  { icon: '🌙', kind: '片段', label: '今晚静静收着', unit: '个' }
];

interface KindMeta {
  icon: string;
  kind: string;
  label: string;
  unit: string;
}

@Component
export struct Dump {
  onBack: () => void = (): void => {};
  onGotoMailbox: () => void = (): void => {};

  @StorageProp('isNight') isNight: boolean = false;
  @State phase: DumpPhase = 'input';
  @State inputText: string = '';
  @State fragments: string[] = [];
  @State receipt: DumpReceipt | null = null;
  @State errorText: string = '';

  private streamClient: SseClient = new SseClient();

  private getTheme(): MindTheme {
    return themeOf(this.isNight);
  }

  private colors(): ColorTokens {
    return this.getTheme().colors;
  }

  aboutToDisappear(): void {
    this.streamClient.cancel();
  }

  private fragmentOf(event: SseEvent): string | null {
    if (!event.data) {
      return null;
    }
    const record = event.data as Record<string, Object>;
    const surface = record['surface_text'];
    const content = record['content'];
    const raw = typeof surface === 'string' && surface.length > 0 ? surface
      : typeof content === 'string' ? content : '';
    if (raw.length === 0) {
      return null;
    }
    return raw.length > 10 ? `${raw.slice(0, 10)}…` : raw;
  }

  private async submit(): Promise<void> {
    const text = this.inputText.trim();
    if (this.phase === 'processing' || text.length === 0) {
      return;
    }
    this.errorText = '';
    this.fragments = [];
    this.receipt = null;
    this.phase = 'processing';
    try {
      const body: DumpBody = { text: text };
      await this.streamClient.post('/api/v1/brain-dumps', body, {
        onEvent: (event: SseEvent) => {
          if (event.event === 'item.classified') {
            const fragment = this.fragmentOf(event);
            if (fragment) {
              this.fragments = this.fragments.concat([fragment]);
            }
          } else if (event.event === 'receipt') {
            this.receipt = event.data as DumpReceipt;
          }
        }
      });
      // 流正常结束即进回执（无回执时按 total 0 / fallback 兜底态展示）
      this.phase = 'receipt';
    } catch (err) {
      const e = err as Error;
      if (e.message === '已停止回复') {
        this.phase = this.receipt !== null ? 'receipt' : 'input';
      } else {
        this.errorText = '整理中断了。你说的话已经安全留下，稍后再来看看';
        this.phase = 'input';
      }
    }
  }

  private stopProcessing(): void {
    this.streamClient.cancel();
  }

  private countOf(kind: string): number {
    const counts = this.receipt?.kind_counts;
    if (!counts) {
      return 0;
    }
    const direct = counts[kind] ?? 0;
    // 灵感卡合并「小结」（与 RN 端一致）
    return kind === '灵感' ? direct + (counts['小结'] ?? 0) : direct;
  }

  private topTodo(): DumpReceiptItem | null {
    const items = this.receipt?.items;
    if (!items) {
      return null;
    }
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === '待办') {
        return items[i];
      }
    }
    return null;
  }

  @Builder
  header(title: string, subtitle: string) {
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
        Text(title)
          .fontSize(fontSizes.sectionTitle)
          .fontWeight(fontWeights.medium)
          .fontColor(this.colors().textPrimary)
        if (subtitle.length > 0) {
          Text(subtitle)
            .fontSize(fontSizes.label)
            .fontColor(this.colors().textMuted)
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .padding({ left: spacing.s5, right: spacing.s5, top: spacing.s4, bottom: spacing.s3 })
  }

  @Builder
  inputPhase() {
    Column() {
      this.header('今晚的念头', '')
      Scroll() {
        Column({ space: spacing.s4 }) {
          Text('计划、担心、灵感、情绪——什么都可以，混在一起说也没关系')
            .fontSize(fontSizes.body)
            .lineHeight(lineHeights.body)
            .fontColor(this.colors().textSecondary)
          TextArea({ text: this.inputText, placeholder: '今天想说的都在这里…\n\n整理是我的事，你只管说。' })
            .height(240)
            .fontSize(fontSizes.body)
            .fontColor(this.colors().textPrimary)
            .placeholderColor(this.colors().placeholder)
            .backgroundColor(this.colors().surface)
            .borderRadius(radii.card)
            .borderWidth(1)
            .borderColor(this.colors().border)
            .padding(spacing.s4)
            .onChange((value: string) => this.inputText = value)
          if (this.errorText.length > 0) {
            Text(this.errorText)
              .fontSize(fontSizes.label)
              .fontColor(this.colors().warning)
          }
        }
        .width('100%')
        .padding({ left: spacing.s5, right: spacing.s5, top: spacing.s2, bottom: spacing.s4 })
        .alignItems(HorizontalAlign.Start)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)

      Button('说完了，帮我整理')
        .height(controlHeights.large)
        .fontSize(fontSizes.body)
        .fontWeight(fontWeights.medium)
        .fontColor(this.colors().textOnAccent)
        .backgroundColor(this.colors().accentSurface)
        .borderRadius(radii.pill)
        .enabled(this.inputText.trim().length > 0)
        .opacity(this.inputText.trim().length > 0 ? 1 : 0.55)
        .margin({ left: spacing.s5, right: spacing.s5, bottom: spacing.s4 })
        .onClick(() => {
          void this.submit();
        })
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  processingPhase() {
    Column() {
      this.header('整理中', '')
      Column({ space: spacing.s3 }) {
        LoadingProgress().width(30).height(30).color(this.colors().accent)
        Text('正在接住你的念头…')
          .fontSize(fontSizes.body)
          .fontColor(this.colors().textSecondary)
        if (this.fragments.length > 0) {
          Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Center }) {
            ForEach(this.fragments, (fragment: string) => {
              Text(fragment)
                .fontSize(fontSizes.caption)
                .fontColor(this.colors().textSecondary)
                .padding({ left: spacing.s3, right: spacing.s3, top: spacing.s1, bottom: spacing.s1 })
                .margin({ right: spacing.s2, bottom: spacing.s2 })
                .borderRadius(radii.pill)
                .backgroundColor(this.colors().surfaceElevated)
            }, (fragment: string, index: number) => `${index}-${fragment}`)
          }
          .width('100%')
          .padding({ left: spacing.s5, right: spacing.s5, top: spacing.s4 })
        }
      }
      .layoutWeight(1)
      .justifyContent(FlexAlign.Center)

      Text('先到这里')
        .fontSize(fontSizes.label)
        .fontColor(this.colors().textSecondary)
        .padding({ top: spacing.s2, bottom: spacing.s2, left: spacing.s4, right: spacing.s4 })
        .margin({ bottom: spacing.s4 })
        .onClick(() => this.stopProcessing())
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  kindCard(meta: KindMeta) {
    Column({ space: spacing.s2 }) {
      Text(meta.icon).fontSize(23)
      Text(`${this.countOf(meta.kind)} ${meta.unit}`)
        .fontSize(fontSizes.sectionTitle)
        .fontColor(this.colors().textPrimary)
      Text(meta.label)
        .fontSize(fontSizes.caption)
        .fontColor(this.colors().textSecondary)
    }
    .alignItems(HorizontalAlign.Start)
    .padding(spacing.s4)
    .backgroundColor(this.colors().surface)
    .borderRadius(radii.card)
    .width('47%')
  }

  @Builder
  receiptPhase() {
    Column() {
      this.header('今晚', '')
      Scroll() {
        Column({ space: spacing.s4 }) {
          Text() {
            Span('已替你接住 ')
            Span(`${this.receipt?.total ?? 0} 个念头`)
              .fontColor(this.colors().accent)
          }
          .fontSize(fontSizes.pageTitle)
          .fontWeight(fontWeights.medium)
          .fontColor(this.colors().textPrimary)
          .width('100%')

          Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
            ForEach(KIND_META, (meta: KindMeta) => {
              this.kindCard(meta)
            }, (meta: KindMeta) => meta.kind)
          }
          .width('100%')

          if (this.topTodo()) {
            Column({ space: spacing.s2 }) {
              Text('明天最值得关注')
                .fontSize(fontSizes.label)
                .fontColor(this.colors().accent)
              Text(this.topTodo()!.content)
                .fontSize(fontSizes.body)
                .fontWeight(fontWeights.medium)
                .lineHeight(lineHeights.body)
                .fontColor(this.colors().textPrimary)
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .padding(spacing.s4)
            .backgroundColor(this.colors().accentSoft)
            .borderRadius(radii.card)
          }

          if (this.receipt?.fallback) {
            Text('今晚先替你收着了，明天再慢慢看。')
              .fontSize(fontSizes.caption)
              .fontColor(this.colors().textSecondary)
          }
        }
        .width('100%')
        .padding({ left: spacing.s5, right: spacing.s5, top: spacing.s2, bottom: spacing.s4 })
        .alignItems(HorizontalAlign.Start)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)

      Column({ space: spacing.s3 }) {
        Button('今晚到这里')
          .height(controlHeights.large)
          .fontSize(fontSizes.body)
          .fontWeight(fontWeights.medium)
          .fontColor(this.colors().textOnAccent)
          .backgroundColor(this.colors().accentSurface)
          .borderRadius(radii.pill)
          .onClick(() => this.onBack())
        Text('看看我替你放在哪里')
          .fontSize(fontSizes.caption)
          .fontColor(this.colors().accent)
          .padding({ top: spacing.s2, bottom: spacing.s2, left: spacing.s4, right: spacing.s4 })
          .onClick(() => this.onGotoMailbox())
      }
      .width('100%')
      .padding({ left: spacing.s5, right: spacing.s5, bottom: spacing.s4 })
    }
    .width('100%')
    .height('100%')
  }

  build() {
    Column() {
      if (this.phase === 'input') {
        this.inputPhase()
      } else if (this.phase === 'processing') {
        this.processingPhase()
      } else {
        this.receiptPhase()
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors().background)
  }
}
