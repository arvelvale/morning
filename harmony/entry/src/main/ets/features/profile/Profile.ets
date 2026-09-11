/**
 * 「我的」：伙伴信息 + 关键偏好 + 退出登录。
 * 记忆管理/画像审阅留待后续阶段；夜间氛围跟随系统（EntryAbility 同步 isNight）。
 */
import {
  getActivePet,
  getPreferences,
  logout,
  PetDetail,
  Preferences,
  updatePreferences
} from '../../common/Api';
import {
  ColorTokens,
  fontSizes,
  fontWeights,
  radii,
  shadows,
  spacing,
  themeOf,
  MindTheme
} from '../../common/Theme';

/** PATCH 增量体：未传字段表示不改。 */
interface PreferencesPatch {
  proactive_enabled?: boolean;
  proactive_frequency?: string;
  sleep_reminder_time?: string;
  keep_raw_dump?: boolean;
  profile_learning_enabled?: boolean;
  ephemeral_ttl_days?: number;
  font_size?: string;
  companion_tone?: string;
  reduce_transparency?: boolean;
}

const FREQUENCIES: string[] = ['安静', '温和', '活跃'];
const FONT_SIZES: string[] = ['小', '标准', '大'];

@Component
export struct ProfilePage {
  onLogout: () => void = (): void => {};
  @StorageProp('isNight') isNight: boolean = false;
  @State loading: boolean = true;
  @State errorText: string = '';
  @State pet: PetDetail | null = null;
  @State prefs: Preferences | null = null;
  @State savingHint: string = '';

  private getTheme(): MindTheme {
    return themeOf(this.isNight);
  }

  private colors(): ColorTokens {
    return this.getTheme().colors;
  }

  aboutToAppear(): void {
    void this.reload();
  }

  private async reload(): Promise<void> {
    this.loading = true;
    this.errorText = '';
    try {
      const results = await Promise.all([
        getPreferences(),
        getActivePet().catch(() => null)
      ]);
      this.prefs = results[0] as Preferences;
      this.pet = results[1] as PetDetail | null;
    } catch (err) {
      const e = err as Error;
      this.errorText = e && e.message ? e.message : '暂时读不到设置，稍后再试';
    } finally {
      this.loading = false;
    }
  }

  private async patchPref(body: PreferencesPatch): Promise<void> {
    if (!this.prefs) {
      return;
    }
    const prev = this.prefs;
    const next: Preferences = {
      proactive_enabled: body.proactive_enabled ?? prev.proactive_enabled,
      proactive_frequency: body.proactive_frequency ?? prev.proactive_frequency,
      sleep_reminder_time: body.sleep_reminder_time ?? prev.sleep_reminder_time,
      keep_raw_dump: body.keep_raw_dump ?? prev.keep_raw_dump,
      profile_learning_enabled: body.profile_learning_enabled ?? prev.profile_learning_enabled,
      ephemeral_ttl_days: body.ephemeral_ttl_days ?? prev.ephemeral_ttl_days,
      font_size: body.font_size ?? prev.font_size,
      companion_tone: body.companion_tone ?? prev.companion_tone,
      reduce_transparency: body.reduce_transparency ?? prev.reduce_transparency
    };
    this.prefs = next;
    try {
      this.prefs = await updatePreferences(body as Object);
      this.savingHint = '已保存';
    } catch (err) {
      const e = err as Error;
      this.savingHint = e && e.message ? e.message : '保存失败，稍后再试';
      void this.reload();
    }
  }

  private petAvatar(): Resource {
    const preset = this.pet?.preset_id ?? '';
    if (preset === 'bobi') {
      return $r('app.media.bobi_avatar');
    }
    return $r('app.media.miro_avatar');
  }

  private cycleFrequency(): void {
    const cur = this.prefs?.proactive_frequency ?? '温和';
    const idx = FREQUENCIES.indexOf(cur);
    const next = FREQUENCIES[(idx + 1) % FREQUENCIES.length];
    void this.patchPref({ proactive_frequency: next });
  }

  private cycleFontSize(): void {
    const cur = this.prefs?.font_size ?? '标准';
    const idx = FONT_SIZES.indexOf(cur);
    const next = FONT_SIZES[(idx + 1) % FONT_SIZES.length];
    void this.patchPref({ font_size: next });
  }

  private cycleTtl(): void {
    const order = [7, 14, 30];
    const cur = this.prefs?.ephemeral_ttl_days ?? 30;
    const idx = order.indexOf(cur);
    const next = order[(idx + 1) % order.length];
    void this.patchPref({ ephemeral_ttl_days: next });
  }

  @Builder
  private row(label: string, value: string, onTap?: () => void) {
    Row() {
      Text(label)
        .fontSize(fontSizes.body)
        .fontColor(this.colors().textPrimary)
        .layoutWeight(1);
      Text(value)
        .fontSize(fontSizes.caption)
        .fontColor(this.colors().textSecondary);
    }
    .width('100%')
    .padding({ left: spacing.s4, right: spacing.s4, top: spacing.s4, bottom: spacing.s4 })
    .backgroundColor(this.colors().surface)
    .borderRadius(radii.card)
    .onClick(() => {
      if (onTap) {
        onTap();
      }
    });
  }

  @Builder
  private switchRow(label: string, on: boolean, onToggle: () => void) {
    Row() {
      Text(label)
        .fontSize(fontSizes.body)
        .fontColor(this.colors().textPrimary)
        .layoutWeight(1);
      Toggle({ type: ToggleType.Switch, isOn: on })
        .selectedColor(this.colors().accent)
        .onChange((_isOn: boolean) => {
          onToggle();
        });
    }
    .width('100%')
    .padding({ left: spacing.s4, right: spacing.s4, top: spacing.s3, bottom: spacing.s3 })
    .backgroundColor(this.colors().surface)
    .borderRadius(radii.card)
  }

  build() {
    Scroll() {
      Column({ space: spacing.s4 }) {
        Text('我的')
          .fontSize(fontSizes.pageTitle)
          .fontWeight(fontWeights.medium)
          .fontColor(this.colors().textPrimary)
          .width('100%');
        Text('管理陪伴方式与内容边界。记忆管理稍后开放。')
          .fontSize(fontSizes.caption)
          .fontColor(this.colors().textSecondary)
          .width('100%');

        if (this.loading) {
          Text('正在读取…')
            .fontSize(fontSizes.caption)
            .fontColor(this.colors().textMuted)
            .margin({ top: spacing.s8 });
        } else if (this.errorText.length > 0) {
          Text(this.errorText)
            .fontSize(fontSizes.body)
            .fontColor(this.colors().warning)
            .width('100%');
          Button('重新加载')
            .height(40)
            .backgroundColor(this.colors().accentSoft)
            .fontColor(this.colors().accent)
            .borderRadius(radii.pill)
            .onClick(() => {
              void this.reload();
            });
        } else {
          // 伙伴扉页
          Row({ space: spacing.s4 }) {
            Image(this.petAvatar())
              .width(64)
              .height(64)
              .borderRadius(32)
              .objectFit(ImageFit.Cover);
            Column({ space: 4 }) {
              Text(this.pet?.name ?? '还没有伙伴')
                .fontSize(fontSizes.sectionTitle)
                .fontWeight(fontWeights.medium)
                .fontColor(this.colors().textPrimary);
              Text(this.pet?.personality ?? '先去选一位陪伴伙伴吧')
                .fontSize(fontSizes.caption)
                .fontColor(this.colors().textSecondary);
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1);
          }
          .width('100%')
          .padding(spacing.s4)
          .backgroundColor(this.colors().surface)
          .borderRadius(radii.card)
          .shadow({
            radius: shadows.soft.radius,
            color: shadows.soft.color,
            offsetX: shadows.soft.offsetX,
            offsetY: shadows.soft.offsetY
          });

          Text('陪伴')
            .fontSize(fontSizes.label)
            .fontColor(this.colors().textMuted)
            .width('100%')
            .margin({ top: spacing.s2 });

          if (this.prefs) {
            this.switchRow('主动陪伴', this.prefs.proactive_enabled, () => {
              const next = !(this.prefs?.proactive_enabled ?? true);
              void this.patchPref({ proactive_enabled: next });
            });
            this.row('陪伴频率', this.prefs.proactive_frequency, () => {
              this.cycleFrequency();
            });
            this.row('睡前提醒', this.prefs.sleep_reminder_time, () => {
              // 5 分钟步进简易轮转，避免引入复杂滚轮组件
              const parts = (this.prefs?.sleep_reminder_time ?? '22:00').split(':');
              let h = parseInt(parts[0], 10);
              let m = parseInt(parts[1], 10);
              if (!Number.isFinite(h)) {
                h = 22;
              }
              if (!Number.isFinite(m)) {
                m = 0;
              }
              m += 5;
              if (m >= 60) {
                m = 0;
                h = (h + 1) % 24;
              }
              const next = `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
              void this.patchPref({ sleep_reminder_time: next });
            });

            Text('内容与隐私')
              .fontSize(fontSizes.label)
              .fontColor(this.colors().textMuted)
              .width('100%')
              .margin({ top: spacing.s2 });

            this.row('思绪保存期', `${this.prefs.ephemeral_ttl_days} 天`, () => {
              this.cycleTtl();
            });
            this.switchRow('保留原始倾倒', this.prefs.keep_raw_dump, () => {
              const next = !(this.prefs?.keep_raw_dump ?? false);
              void this.patchPref({ keep_raw_dump: next });
            });
            this.switchRow('允许画像学习', this.prefs.profile_learning_enabled, () => {
              const next = !(this.prefs?.profile_learning_enabled ?? false);
              void this.patchPref({ profile_learning_enabled: next });
            });

            Text('界面')
              .fontSize(fontSizes.label)
              .fontColor(this.colors().textMuted)
              .width('100%')
              .margin({ top: spacing.s2 });

            this.row('字体大小', this.prefs.font_size, () => {
              this.cycleFontSize();
            });
            this.row('夜间氛围', '跟随系统');

            if (this.savingHint.length > 0) {
              Text(this.savingHint)
                .fontSize(fontSizes.caption)
                .fontColor(this.colors().textMuted)
                .width('100%');
            }

            Button('退出登录')
              .width('100%')
              .height(44)
              .backgroundColor(this.colors().surface)
              .fontColor(this.colors().error)
              .fontSize(fontSizes.body)
              .borderRadius(radii.pill)
              .borderWidth(1)
              .borderColor(this.colors().border)
              .margin({ top: spacing.s4, bottom: spacing.s8 })
              .onClick(() => {
                void logout().then(() => {
                  this.onLogout();
                });
              });
          }
        }
      }
      .width('100%')
      .padding({ left: spacing.s5, right: spacing.s5, top: spacing.s6, bottom: spacing.s10 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors().background)
    .scrollBar(BarState.Off)
    .align(Alignment.Top)
  }
}
