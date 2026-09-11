/**
 * 引导选伙伴：首次进入或尚无主桌宠时展示。
 * 复用 miro_avatar / bobi_avatar 资源；确认后 PUT /pets/active。
 */
import { listPetPresets, PetPreset, setActivePet } from '../../common/Api';
import {
  ColorTokens,
  fontSizes,
  fontWeights,
  lineHeights,
  radii,
  spacing,
  themeOf,
  MindTheme
} from '../../common/Theme';

interface PetOption {
  id: string;
  name: string;
  summary: string;
  avatar: Resource;
}

const FALLBACK_PRESETS: PetOption[] = [
  {
    id: 'miro',
    name: '米露',
    summary: '情绪碎片收藏家：安静、敏锐、擅长倾听和承接情绪',
    avatar: $r('app.media.miro_avatar')
  },
  {
    id: 'bobi',
    name: '波比',
    summary: '晨光信使：温暖、热烈、有行动力，也尊重边界',
    avatar: $r('app.media.bobi_avatar')
  }
];

@Component
export struct OnboardPet {
  onDone: () => void = (): void => {};
  @StorageProp('isNight') isNight: boolean = false;
  @State options: PetOption[] = FALLBACK_PRESETS;
  @State selectedId: string = 'miro';
  @State loading: boolean = false;
  @State hint: string = '';

  private getTheme(): MindTheme {
    return themeOf(this.isNight);
  }

  private colors(): ColorTokens {
    return this.getTheme().colors;
  }

  aboutToAppear(): void {
    void this.loadPresets();
  }

  private avatarFor(presetId: string): Resource {
    return presetId === 'bobi' ? $r('app.media.bobi_avatar') : $r('app.media.miro_avatar');
  }

  private async loadPresets(): Promise<void> {
    try {
      const presets: PetPreset[] = await listPetPresets();
      if (presets.length > 0) {
        this.options = presets.map((p: PetPreset): PetOption => {
          return {
            id: p.id,
            name: p.name,
            summary: p.personality,
            avatar: this.avatarFor(p.id)
          };
        });
        if (!this.options.some((o: PetOption): boolean => o.id === this.selectedId)) {
          this.selectedId = this.options[0].id;
        }
      }
    } catch {
      // 离线/接口失败时保留内置两宠文案
    }
  }

  private async confirm(): Promise<void> {
    if (this.loading) {
      return;
    }
    this.hint = '';
    this.loading = true;
    try {
      await setActivePet(this.selectedId);
      this.onDone();
    } catch (err) {
      const e = err as Error;
      this.hint = e && e.message ? e.message : '选好了但没同步上，再试一次';
    } finally {
      this.loading = false;
    }
  }

  @Builder
  private petCard(option: PetOption) {
    Column({ space: spacing.s3 }) {
      Image(option.avatar)
        .width(72)
        .height(72)
        .borderRadius(36)
        .objectFit(ImageFit.Cover);
      Row({ space: spacing.s2 }) {
        Text(option.name)
          .fontSize(fontSizes.sectionTitle)
          .fontWeight(fontWeights.medium)
          .fontColor(this.colors().textPrimary);
        Text('陪伴伙伴')
          .fontSize(fontSizes.label)
          .fontColor(this.colors().accent)
          .padding({
            left: spacing.s2,
            right: spacing.s2,
            top: 2,
            bottom: 2
          })
          .backgroundColor(this.colors().accentSoft)
          .borderRadius(radii.pill);
      }
      .alignItems(VerticalAlign.Center);

      Text(option.summary)
        .fontSize(fontSizes.caption)
        .lineHeight(lineHeights.caption)
        .fontColor(this.colors().textSecondary)
        .textAlign(TextAlign.Start)
        .width('100%');
    }
    .width('100%')
    .padding(spacing.s5)
    .borderRadius(radii.card)
    .borderWidth(this.selectedId === option.id ? 2 : 1)
    .borderColor(this.selectedId === option.id ? this.colors().accent : this.colors().border)
    .backgroundColor(this.selectedId === option.id ? this.colors().accentSoft : this.colors().surface)
    .alignItems(HorizontalAlign.Start)
    .onClick(() => {
      this.selectedId = option.id;
      this.hint = '';
    });
  }

  build() {
    Scroll() {
      Column({ space: spacing.s5 }) {
        Text('选择你的伙伴')
          .fontSize(fontSizes.pageTitle)
          .fontWeight(fontWeights.medium)
          .fontColor(this.colors().textPrimary)
          .width('100%');
        Text('之后随时可以更换，记忆会妥善交接')
          .fontSize(fontSizes.body)
          .fontColor(this.colors().textSecondary)
          .width('100%');

        ForEach(this.options, (option: PetOption) => {
          this.petCard(option);
        }, (option: PetOption) => option.id);

        if (this.hint.length > 0) {
          Text(this.hint)
            .fontSize(fontSizes.caption)
            .fontColor(this.colors().warning)
            .width('100%');
        }

        Button(this.loading ? '正在选定…' : '就选它了')
          .width('100%')
          .height(48)
          .backgroundColor(this.colors().accent)
          .fontColor(this.colors().textOnAccent)
          .fontSize(fontSizes.bodyLarge)
          .fontWeight(fontWeights.medium)
          .borderRadius(radii.pill)
          .enabled(!this.loading)
          .opacity(this.loading ? 0.6 : 1)
          .margin({ bottom: spacing.s10 })
          .onClick(() => {
            void this.confirm();
          });
      }
      .width('100%')
      .constraintSize({ maxWidth: 480 })
      .padding({ left: spacing.s5, right: spacing.s5, top: spacing.s10, bottom: spacing.s6 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors().background)
    .scrollBar(BarState.Off)
    .align(Alignment.Top)
  }
}
