/**
 * 信箱：「来信 + 思绪」两层（对齐 RN 端 MailboxScreen 现行结构）。
 *
 * - 来信：最新一封走「信封 → 拆开 → 信纸」仪式；信纸含附件卡（场景邀请/音乐）、
 *   「收到啦」「回它一句」「把这封信留下」；往期来信点开直读并标已读；
 *   「我留下的」是来信页底部的安静入口。
 * - 思绪：办（待办，可来回勾完成/移除）/想（灵感）/情·景（临时思绪，可珍藏或放下），
 *   批注式单列 + 图例计数；没做决定的思绪保留一个月，到期后端轻轻放下。
 */
import {
  acceptSceneInvite,
  ackLetter,
  deleteEphemeral,
  deleteTodo,
  deleteTreasure,
  EphemeralItem,
  getActivePet,
  keepEphemeral,
  LetterItem,
  listEphemeral,
  listIdeas,
  listLetters,
  listTodos,
  listTreasures,
  markLetterRead,
  saveLetterTreasure,
  StoreItem,
  TreasureItem,
  updateTodoStatus
} from '../../common/Api';
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
} from '../../common/Theme';

type MailboxSection = 'letters' | 'thoughts';
type LetterState = 'waiting' | 'sealed' | 'opened' | 'saved';

/** 思绪类别 → 单字章（后端 kind 为中文枚举，防御英文旧值）。 */
function sealOf(kind: string): string {
  if (kind === '待办') {
    return '办';
  }
  if (kind === '灵感') {
    return '想';
  }
  if (kind === '情绪' || kind === 'emotion') {
    return '情';
  }
  return '景';
}

/** 临时思绪剩余保存期文案（对齐 RN remainText）。 */
function remainText(expiresAt: string | null): string {
  if (!expiresAt) {
    return '';
  }
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) {
    return '已到期';
  }
  const days = Math.floor(ms / 86400000);
  if (days >= 1) {
    return `${days}天后到期`;
  }
  return `${Math.max(1, Math.floor(ms / 3600000))}小时后到期`;
}

/** 待办时间文案：今天 / 今天 15:00 / 8月2日（对齐 RN dueText）。 */
function dueText(iso: string | null): string {
  if (!iso) {
    return '今天';
  }
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const time = hh === '00' && mm === '00' ? '' : ` ${hh}:${mm}`;
  if (sameDay) {
    return `今天${time}`;
  }
  const year = d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}年`;
  return `${year}${d.getMonth() + 1}月${d.getDate()}日${time}`;
}

/** ISO → 「M月D日」（往期来信行短日期）。 */
function shortDate(iso: string): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** ISO → 「M月D日 · 周X」（信纸抬头日期）。 */
function letterDate(iso: string): string {
  if (!iso) {
    return '';
  }
  const weekdays = '日一二三四五六';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 · 周${weekdays.charAt(d.getDay())}`;
}

/** 珍藏来源 → 中文标签（对齐 RN mapTreasure 的 source 映射）。 */
function treasureSource(sourceType: string): string {
  if (sourceType === 'summary') {
    return '今日小结';
  }
  if (sourceType === 'idea') {
    return '灵感收藏';
  }
  if (sourceType === 'memory') {
    return '记忆';
  }
  if (sourceType === 'scene') {
    return '场景结算';
  }
  if (sourceType === 'letter') {
    return '来信';
  }
  if (sourceType === 'ephemeral') {
    return '临时思绪';
  }
  return '珍藏';
}

function isSceneInvite(letter: LetterItem): boolean {
  return letter.type === 'scene_invite';
}

@Component
export struct MailboxHome {
  /** Index 在切到信箱 Tab 时递增，用来触发刷新（倾倒回执跳转会用到）。 */
  @Prop @Watch('onRevision') revision: number = 0;
  /** 「回它一句」：交给外层打开聊天。 */
  onReplyLetter: () => void = (): void => {};

  @StorageProp('isNight') isNight: boolean = false;
  @State section: MailboxSection = 'letters';
  @State loading: boolean = true;
  @State errorText: string = '';
  @State actionHint: string = '';
  @State petName: string = '喵灵';

  // 来信
  @State letters: LetterItem[] = [];
  @State activeLetterId: number = -1;
  @State letterState: LetterState = 'waiting';
  @State acking: boolean = false;
  @State ackedIds: Record<number, boolean> = {};
  @State savedLetterIds: Record<number, boolean> = {};

  // 思绪
  @State todos: StoreItem[] = [];
  @State ideas: StoreItem[] = [];
  @State ephemerals: EphemeralItem[] = [];

  // 我留下的
  @State treasures: TreasureItem[] = [];
  @State showKeepsakes: boolean = false;

  private getTheme(): MindTheme {
    return themeOf(this.isNight);
  }

  private colors(): ColorTokens {
    return this.getTheme().colors;
  }

  async aboutToAppear(): Promise<void> {
    await this.loadAll();
  }

  private onRevision(): void {
    void this.loadAll();
  }

  private async loadAll(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    try {
      this.letters = await listLetters();
      this.todos = await listTodos('');
      this.ideas = await listIdeas();
      this.ephemerals = await listEphemeral();
      this.treasures = await listTreasures();
      try {
        const pet = await getActivePet();
        this.petName = pet.name;
      } catch {
        /* 用默认名 */
      }
      const first = this.letters.length > 0 ? this.letters[0] : null;
      this.activeLetterId = first ? first.id : -1;
      this.letterState = !first ? 'waiting'
        : !first.is_read ? 'sealed'
        : this.savedLetterIds[first.id] ? 'saved' : 'opened';
    } catch {
      this.errorText = '信箱暂时没有送到，再试一次吧';
    } finally {
      this.loading = false;
    }
  }

  private activeLetter(): LetterItem | null {
    for (let i = 0; i < this.letters.length; i++) {
      if (this.letters[i].id === this.activeLetterId) {
        return this.letters[i];
      }
    }
    return this.letters.length > 0 ? this.letters[0] : null;
  }

  private pastLetters(): LetterItem[] {
    const active = this.activeLetter();
    return this.letters.filter((l: LetterItem) => active === null || l.id !== active.id);
  }

  private markReadLocal(letterId: number): void {
    const next: LetterItem[] = [];
    for (let i = 0; i < this.letters.length; i++) {
      const l = this.letters[i];
      next.push(l.id === letterId
        ? { id: l.id, type: l.type, title: l.title, body: l.body, pet_id: l.pet_id,
            ref_memory_id: l.ref_memory_id, is_read: true, created_at: l.created_at }
        : l);
    }
    this.letters = next;
  }

  // ─── 来信动作 ───

  /** 拆开最新一封（信封仪式：标已读 + 切到信纸）。 */
  private openActiveLetter(): void {
    const letter = this.activeLetter();
    if (!letter || this.letterState !== 'sealed') {
      return;
    }
    this.letterState = 'opened';
    this.markReadLocal(letter.id);
    markLetterRead(letter.id).catch(() => {});
  }

  /** 往期来信：点开直读（跳过信封仪式），顺手标已读。 */
  private selectPast(letter: LetterItem): void {
    this.activeLetterId = letter.id;
    this.letterState = this.savedLetterIds[letter.id] ? 'saved' : 'opened';
    this.showKeepsakes = false;
    if (!letter.is_read) {
      this.markReadLocal(letter.id);
      markLetterRead(letter.id).catch(() => {});
    }
  }

  private async ackActive(): Promise<void> {
    const letter = this.activeLetter();
    if (!letter || this.acking || this.ackedIds[letter.id]) {
      return;
    }
    this.acking = true;
    try {
      const result = await ackLetter(letter.id);
      const next: Record<number, boolean> = {};
      const keys = Object.keys(this.ackedIds);
      for (let i = 0; i < keys.length; i++) {
        next[Number(keys[i])] = this.ackedIds[Number(keys[i])];
      }
      next[letter.id] = true;
      this.ackedIds = next;
      this.markReadLocal(letter.id);
      this.actionHint = result.message ?? '它知道你收到了';
    } catch {
      this.actionHint = '它知道你收到了';
    } finally {
      this.acking = false;
    }
  }

  /** 「把这封信留下」→ 珍藏。 */
  private async saveActiveLetter(): Promise<void> {
    const letter = this.activeLetter();
    if (!letter || this.savedLetterIds[letter.id]) {
      return;
    }
    try {
      await saveLetterTreasure(letter.id, letter.title, letter.body);
      const next: Record<number, boolean> = {};
      const keys = Object.keys(this.savedLetterIds);
      for (let i = 0; i < keys.length; i++) {
        next[Number(keys[i])] = this.savedLetterIds[Number(keys[i])];
      }
      next[letter.id] = true;
      this.savedLetterIds = next;
      this.letterState = 'saved';
      this.treasures = await listTreasures();
      this.actionHint = '已替你收好 ✦';
    } catch {
      this.actionHint = '没存上，待会儿再试试';
    }
  }

  /** 场景邀请信：接受并建场景（片场页落地前先提示）。 */
  private async enterScene(letter: LetterItem): Promise<void> {
    try {
      await acceptSceneInvite(letter.id);
      this.markReadLocal(letter.id);
      this.actionHint = '场景已备好，片场功能正在接通';
    } catch {
      this.actionHint = '场景没布置好，待会儿再试试';
    }
  }

  // ─── 思绪动作 ───

  private async toggleTodo(item: StoreItem): Promise<void> {
    const done = item.status !== 'done';
    const next: StoreItem[] = [];
    for (let i = 0; i < this.todos.length; i++) {
      const t = this.todos[i];
      next.push(t.id === item.id
        ? { id: t.id, kind: t.kind, content: t.content, surface_text: t.surface_text,
            status: done ? 'done' : 'pending', due_date: t.due_date, created_at: t.created_at }
        : t);
    }
    this.todos = next;
    try {
      await updateTodoStatus(item.id, done);
    } catch {
      this.actionHint = '这条待办没有改成功，再试一次';
    }
  }

  private async removeTodo(item: StoreItem): Promise<void> {
    this.todos = this.todos.filter((t: StoreItem) => t.id !== item.id);
    try {
      await deleteTodo(item.id);
    } catch {
      this.actionHint = '这条待办没有删掉，再试一次';
    }
  }

  private async keepThought(item: EphemeralItem): Promise<void> {
    this.ephemerals = this.ephemerals.filter((e: EphemeralItem) => e.id !== item.id);
    try {
      await keepEphemeral(item.id);
      this.treasures = await listTreasures();
      this.actionHint = '已经替你留下了';
    } catch {
      this.actionHint = '这次没有存下来，再试一次';
    }
  }

  private async dropThought(item: EphemeralItem): Promise<void> {
    this.ephemerals = this.ephemerals.filter((e: EphemeralItem) => e.id !== item.id);
    try {
      await deleteEphemeral(item.id);
    } catch {
      this.actionHint = '这次没有放下，再试一次';
    }
  }

  private async dropTreasure(item: TreasureItem): Promise<void> {
    this.treasures = this.treasures.filter((t: TreasureItem) => t.id !== item.id);
    try {
      await deleteTreasure(item.id);
    } catch {
      this.actionHint = '这条珍藏没有删掉，再试一次';
    }
  }

  private thoughtsEmpty(): boolean {
    return this.todos.length === 0 && this.ideas.length === 0 && this.ephemerals.length === 0;
  }

  private unreadCount(): number {
    let n = 0;
    for (let i = 0; i < this.letters.length; i++) {
      if (!this.letters[i].is_read) {
        n += 1;
      }
    }
    return n;
  }

  private sealCount(seal: string): number {
    let n = 0;
    if (seal === '办') {
      n += this.todos.length;
    }
    if (seal === '想') {
      n += this.ideas.length;
    }
    for (let i = 0; i < this.ephemerals.length; i++) {
      const s = sealOf(this.ephemerals[i].kind);
      if (s === seal) {
        n += 1;
      }
    }
    return n;
  }

  // ─── UI：来信 ───

  @Builder
  waitingLetter() {
    Column({ space: spacing.s3 }) {
      Text('✉️').fontSize(28)
      Text('今天的信还在路上')
        .fontSize(fontSizes.body)
        .fontWeight(fontWeights.medium)
        .fontColor(this.colors().textPrimary)
      Text('有想告诉你的时候，它会送来。')
        .fontSize(fontSizes.caption)
        .fontColor(this.colors().textMuted)
    }
    .width('100%')
    .padding({ top: spacing.s8, bottom: spacing.s8 })
    .justifyContent(FlexAlign.Center)
  }

  @Builder
  sealedEnvelope(letter: LetterItem) {
    Column({ space: spacing.s3 }) {
      Column({ space: spacing.s2 }) {
        if (isSceneInvite(letter)) {
          Text('场景邀请')
            .fontSize(fontSizes.caption)
            .fontColor(this.colors().warning)
        }
        Text(letter.title)
          .fontSize(fontSizes.body)
          .fontWeight(fontWeights.medium)
          .fontColor(this.colors().textPrimary)
        Text(letterDate(letter.created_at))
          .fontSize(fontSizes.caption)
          .fontColor(this.colors().textMuted)
        Text(letter.body.length > 24 ? `${letter.body.slice(0, 24)}…` : letter.body)
          .fontSize(fontSizes.caption)
          .fontColor(this.colors().textSecondary)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding(spacing.s5)
      .backgroundColor(this.colors().surfaceElevated)
      .borderRadius(radii.card)
      .shadow({
        radius: shadows.soft.radius,
        color: shadows.soft.color,
        offsetX: shadows.soft.offsetX,
        offsetY: shadows.soft.offsetY
      })
      .onClick(() => this.openActiveLetter())
      Text('轻点拆开')
        .fontSize(fontSizes.caption)
        .fontColor(this.colors().textMuted)
    }
    .width('100%')
    .padding({ top: spacing.s5 })
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  letterPaper(letter: LetterItem) {
    Column({ space: spacing.s3 }) {
      Text(letterDate(letter.created_at))
        .fontSize(fontSizes.caption)
        .fontColor(this.colors().textMuted)
        .width('100%')
      Text(letter.title)
        .fontSize(fontSizes.sectionTitle)
        .fontWeight(fontWeights.medium)
        .fontColor(this.colors().textPrimary)
        .width('100%')
      Text(letter.body)
        .fontSize(fontSizes.body)
        .lineHeight(25)
        .fontColor(this.colors().textPrimary)
        .width('100%')

      if (isSceneInvite(letter)) {
        Column({ space: spacing.s2 }) {
          Text('为你备好了一个小场景')
            .fontSize(fontSizes.label)
            .fontColor(this.colors().warning)
          Text('进入场景')
            .fontSize(fontSizes.body)
            .fontWeight(fontWeights.medium)
            .fontColor(this.colors().accent)
            .padding({ top: spacing.s2, bottom: spacing.s2, left: spacing.s4, right: spacing.s4 })
            .onClick(() => {
              void this.enterScene(letter);
            })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(spacing.s4)
        .backgroundColor(this.colors().accentSoft)
        .borderRadius(radii.card)
      }

      Text(this.petName)
        .fontSize(fontSizes.body)
        .fontStyle(FontStyle.Italic)
        .fontColor(this.colors().textMuted)
        .width('100%')

      Row({ space: spacing.s3 }) {
        Button(this.ackedIds[letter.id] ? '✓ 已收到' : this.acking ? '正在告诉它…' : '收到啦')
          .height(controlHeights.standard)
          .layoutWeight(1)
          .fontSize(fontSizes.body)
          .fontColor(this.ackedIds[letter.id] ? this.colors().textMuted : this.colors().textOnAccent)
          .backgroundColor(this.ackedIds[letter.id] ? this.colors().surface : this.colors().accentSurface)
          .borderRadius(radii.pill)
          .enabled(!this.acking && !this.ackedIds[letter.id])
          .onClick(() => {
            void this.ackActive();
          })
        Button('回它一句')
          .height(controlHeights.standard)
          .layoutWeight(1)
          .fontSize(fontSizes.body)
          .fontColor(this.colors().textPrimary)
          .backgroundColor(this.colors().surface)
          .borderRadius(radii.pill)
          .onClick(() => this.onReplyLetter())
      }
      .width('100%')

      Button(this.letterState === 'saved' ? '✓ 已经替你收好' : '把这封信留下')
        .height(controlHeights.standard)
        .fontSize(fontSizes.body)
        .fontColor(this.letterState === 'saved' ? this.colors().textMuted : this.colors().textSecondary)
        .backgroundColor(this.colors().surface)
        .borderRadius(radii.pill)
        .enabled(this.letterState !== 'saved')
        .onClick(() => {
          void this.saveActiveLetter();
        })
      if (this.letterState !== 'saved') {
        Text('如果不留下，它会在明天的新信到达时离开。')
          .fontSize(fontSizes.caption)
          .fontColor(this.colors().textMuted)
          .width('100%')
          .textAlign(TextAlign.Center)
      } else {
        Text('去「我留下的」看看')
          .fontSize(fontSizes.caption)
          .fontColor(this.colors().accent)
          .padding({ top: spacing.s2, bottom: spacing.s2, left: spacing.s4, right: spacing.s4 })
          .onClick(() => {
            this.showKeepsakes = true;
          })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(spacing.s5)
    .backgroundColor(this.colors().surfaceElevated)
    .borderRadius(radii.card)
    .shadow({
      radius: shadows.soft.radius,
      color: shadows.soft.color,
      offsetX: shadows.soft.offsetX,
      offsetY: shadows.soft.offsetY
    })
  }

  @Builder
  lettersSection() {
    if (this.letterState === 'waiting') {
      this.waitingLetter()
    } else if (this.activeLetter() !== null && this.letterState === 'sealed') {
      this.sealedEnvelope(this.activeLetter()!)
    } else if (this.activeLetter() !== null) {
      this.letterPaper(this.activeLetter()!)
    }

    if (this.pastLetters().length > 0 && !this.showKeepsakes) {
      Text('往期来信')
        .fontSize(fontSizes.label)
        .fontColor(this.colors().textMuted)
        .width('100%')
        .margin({ top: spacing.s5, bottom: spacing.s1 })
      ForEach(this.pastLetters(), (letter: LetterItem) => {
        Row({ space: spacing.s3 }) {
          Text(shortDate(letter.created_at))
            .fontSize(fontSizes.caption)
            .fontColor(this.colors().textMuted)
            .width(52)
          Text(letter.title)
            .fontSize(fontSizes.body)
            .fontColor(this.colors().textPrimary)
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          if (!letter.is_read) {
            Circle({ width: 6, height: 6 }).fill(this.colors().accent)
          }
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
        .padding({ top: spacing.s3, bottom: spacing.s3 })
        .onClick(() => this.selectPast(letter))
      }, (letter: LetterItem) => `past-${letter.id}`)
    }

    Text(this.showKeepsakes
      ? '回到来信'
      : `我留下的${this.treasures.length > 0 ? `（${this.treasures.length}）` : ''}`)
      .fontSize(fontSizes.caption)
      .fontColor(this.colors().textMuted)
      .margin({ top: spacing.s5 })
      .padding({ top: spacing.s2, bottom: spacing.s2, left: spacing.s4, right: spacing.s4 })
      .onClick(() => {
        this.showKeepsakes = !this.showKeepsakes;
      })

    if (this.showKeepsakes) {
      if (this.treasures.length === 0) {
        Text('还没有留下什么。思绪页里的「珍藏」会收在这里。')
          .fontSize(fontSizes.caption)
          .fontColor(this.colors().textMuted)
          .margin({ top: spacing.s2 })
      } else {
        ForEach(this.treasures, (item: TreasureItem) => {
          Row({ space: spacing.s3 }) {
            Column({ space: spacing.s1 }) {
              Text(item.title.length > 0 ? item.title : item.content)
                .fontSize(fontSizes.body)
                .fontColor(this.colors().textPrimary)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(`${treasureSource(item.source_type)} · ${shortDate(item.created_at)}`)
                .fontSize(fontSizes.caption)
                .fontColor(this.colors().textMuted)
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
            Text('放下')
              .fontSize(fontSizes.caption)
              .fontColor(this.colors().textMuted)
              .padding({ top: spacing.s2, bottom: spacing.s2, left: spacing.s3, right: spacing.s3 })
              .onClick(() => {
                void this.dropTreasure(item);
              })
          }
          .width('100%')
          .padding({ top: spacing.s3, bottom: spacing.s3 })
        }, (item: TreasureItem) => `treasure-${item.id}`)
      }
    }
  }

  // ─── UI：思绪 ───

  @Builder
  sealChip(seal: string, label: string) {
    Row({ space: spacing.s2 }) {
      Text(seal)
        .fontSize(fontSizes.caption)
        .fontColor(this.colors().accent)
        .width(26)
        .height(26)
        .textAlign(TextAlign.Center)
        .borderRadius(radii.control)
        .borderWidth(1)
        .borderColor(this.colors().border)
      Text(`${label} · ${this.sealCount(seal)}`)
        .fontSize(fontSizes.caption)
        .fontColor(this.colors().textMuted)
    }
    .alignItems(VerticalAlign.Center)
    .margin({ right: spacing.s4 })
  }

  @Builder
  todoRow(item: StoreItem) {
    Row({ space: spacing.s3 }) {
      Text('办')
        .fontSize(fontSizes.label)
        .fontColor(this.colors().accent)
        .width(28)
        .height(28)
        .textAlign(TextAlign.Center)
        .borderRadius(radii.control)
        .borderWidth(1)
        .borderColor(this.colors().border)
      Column({ space: spacing.s1 }) {
        Text(item.surface_text.length > 0 ? item.surface_text : item.content)
          .fontSize(fontSizes.body)
          .lineHeight(lineHeights.body)
          .fontColor(item.status === 'done' ? this.colors().textMuted : this.colors().textPrimary)
          .decoration({ type: item.status === 'done' ? TextDecorationType.LineThrough : TextDecorationType.None })
        Text(dueText(item.due_date))
          .fontSize(fontSizes.caption)
          .fontColor(this.colors().textMuted)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      Text(item.status === 'done' ? '✓' : '')
        .fontSize(fontSizes.caption)
        .fontColor(this.colors().textOnAccent)
        .width(24)
        .height(24)
        .textAlign(TextAlign.Center)
        .borderRadius(radii.pill)
        .backgroundColor(item.status === 'done' ? this.colors().accentSurface : 'rgba(0,0,0,0)')
        .borderWidth(2)
        .borderColor(item.status === 'done' ? this.colors().accent : this.colors().border)
        .onClick(() => {
          void this.toggleTodo(item);
        })
      if (item.status === 'done') {
        Text('移除')
          .fontSize(fontSizes.caption)
          .fontColor(this.colors().textMuted)
          .padding({ top: spacing.s2, bottom: spacing.s2, left: spacing.s2, right: spacing.s2 })
          .onClick(() => {
            void this.removeTodo(item);
          })
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .padding({ top: spacing.s3, bottom: spacing.s3 })
  }

  @Builder
  thoughtsSection() {
    if (this.thoughtsEmpty()) {
      Column({ space: spacing.s2 }) {
        Text('思绪盒还空着')
          .fontSize(fontSizes.body)
          .fontColor(this.colors().textSecondary)
        Text('睡前倾倒的念头，整理后会来到这里。')
          .fontSize(fontSizes.caption)
          .fontColor(this.colors().textMuted)
      }
      .width('100%')
      .padding({ top: spacing.s8 })
      .justifyContent(FlexAlign.Center)
    } else {
      Row() {
        this.sealChip('办', '待办')
        this.sealChip('想', '灵感')
        this.sealChip('情', '情绪')
        this.sealChip('景', '片段')
      }
      .width('100%')
      .margin({ bottom: spacing.s3 })

      ForEach(this.todos, (item: StoreItem) => {
        this.todoRow(item)
      }, (item: StoreItem) => `todo-${item.id}`)

      ForEach(this.ideas, (item: StoreItem) => {
        Row({ space: spacing.s3 }) {
          Text('想')
            .fontSize(fontSizes.label)
            .fontColor(this.colors().accent)
            .width(28)
            .height(28)
            .textAlign(TextAlign.Center)
            .borderRadius(radii.control)
            .borderWidth(1)
            .borderColor(this.colors().border)
          Column({ space: spacing.s1 }) {
            Text(item.surface_text.length > 0 ? item.surface_text : item.content)
              .fontSize(fontSizes.body)
              .lineHeight(lineHeights.body)
              .fontColor(this.colors().textPrimary)
            Text('灵感')
              .fontSize(fontSizes.caption)
              .fontColor(this.colors().textMuted)
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
        }
        .width('100%')
        .padding({ top: spacing.s3, bottom: spacing.s3 })
      }, (item: StoreItem) => `idea-${item.id}`)

      ForEach(this.ephemerals, (item: EphemeralItem) => {
        Column({ space: spacing.s1 }) {
          Row({ space: spacing.s3 }) {
            Text(sealOf(item.kind))
              .fontSize(fontSizes.label)
              .fontColor(this.colors().accent)
              .width(28)
              .height(28)
              .textAlign(TextAlign.Center)
              .borderRadius(radii.control)
              .borderWidth(1)
              .borderColor(this.colors().border)
            Column({ space: spacing.s1 }) {
              Text(item.surface_text.length > 0 ? item.surface_text : item.content)
                .fontSize(fontSizes.body)
                .lineHeight(lineHeights.body)
                .fontColor(this.colors().textPrimary)
              Text(remainText(item.expires_at))
                .fontSize(fontSizes.caption)
                .fontColor(this.colors().textMuted)
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
          }
          .width('100%')
          Row({ space: spacing.s4 }) {
            Text('珍藏')
              .fontSize(fontSizes.caption)
              .fontColor(this.colors().accent)
              .padding({ top: spacing.s1, bottom: spacing.s1, left: spacing.s3, right: spacing.s3 })
              .onClick(() => {
                void this.keepThought(item);
              })
            Text('放下')
              .fontSize(fontSizes.caption)
              .fontColor(this.colors().textMuted)
              .padding({ top: spacing.s1, bottom: spacing.s1, left: spacing.s3, right: spacing.s3 })
              .onClick(() => {
                void this.dropThought(item);
              })
          }
          .padding({ left: 40 })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({ top: spacing.s2, bottom: spacing.s2 })
      }, (item: EphemeralItem) => `eph-${item.id}`)

      Text('没做决定的思绪会保留一个月，到期轻轻放下')
        .fontSize(fontSizes.caption)
        .fontColor(this.colors().textMuted)
        .margin({ top: spacing.s4 })
    }
  }

  build() {
    Column() {
      Row({ space: spacing.s3 }) {
        Text('信箱')
          .fontSize(fontSizes.pageTitle)
          .fontWeight(fontWeights.medium)
          .fontColor(this.colors().textPrimary)
          .layoutWeight(1)
        Text('刷新')
          .fontSize(fontSizes.caption)
          .fontColor(this.colors().accent)
          .padding({ top: spacing.s2, bottom: spacing.s2, left: spacing.s3, right: spacing.s3 })
          .onClick(() => {
            void this.loadAll();
          })
      }
      .width('100%')
      .padding({ left: spacing.s5, right: spacing.s5, top: spacing.s4 })
      .alignItems(VerticalAlign.Center)

      Row({ space: spacing.s2 }) {
        ForEach(['来信', '思绪'], (name: string, index: number) => {
          Text(index === 0 && this.unreadCount() > 0 ? `${name} · ${this.unreadCount()}` : name)
            .fontSize(fontSizes.body)
            .fontWeight(this.section === (index === 0 ? 'letters' : 'thoughts')
              ? fontWeights.medium : fontWeights.regular)
            .fontColor(this.section === (index === 0 ? 'letters' : 'thoughts')
              ? this.colors().textPrimary : this.colors().textMuted)
            .padding({ left: spacing.s4, right: spacing.s4, top: spacing.s2, bottom: spacing.s2 })
            .borderRadius(radii.pill)
            .backgroundColor(this.section === (index === 0 ? 'letters' : 'thoughts')
              ? this.colors().accentSoft : 'rgba(0,0,0,0)')
            .onClick(() => {
              this.section = index === 0 ? 'letters' : 'thoughts';
            })
        }, (name: string) => name)
      }
      .width('100%')
      .padding({ left: spacing.s5, right: spacing.s5, top: spacing.s2, bottom: spacing.s3 })

      if (this.loading) {
        Column({ space: spacing.s3 }) {
          LoadingProgress().width(28).height(28).color(this.colors().accent)
          Text('正在开信箱…')
            .fontSize(fontSizes.caption)
            .fontColor(this.colors().textMuted)
        }
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.errorText.length > 0) {
        Column({ space: spacing.s4 }) {
          Text(this.errorText)
            .fontSize(fontSizes.body)
            .fontColor(this.colors().textSecondary)
          Button('重新连接')
            .height(44)
            .borderRadius(radii.pill)
            .backgroundColor(this.colors().accentSoft)
            .fontColor(this.colors().accent)
            .onClick(() => {
              void this.loadAll();
            })
        }
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        Scroll() {
          Column() {
            if (this.section === 'letters') {
              this.lettersSection()
            } else {
              this.thoughtsSection()
            }
            if (this.actionHint.length > 0) {
              Text(this.actionHint)
                .fontSize(fontSizes.caption)
                .fontColor(this.colors().textMuted)
                .margin({ top: spacing.s4 })
            }
          }
          .width('100%')
          .padding({ left: spacing.s5, right: spacing.s5, bottom: spacing.s8 })
          .alignItems(this.section === 'letters' ? HorizontalAlign.Center : HorizontalAlign.Start)
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
        .edgeEffect(EdgeEffect.Spring)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors().background)
  }
}
