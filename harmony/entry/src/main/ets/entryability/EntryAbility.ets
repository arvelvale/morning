import { AbilityConstant, Configuration, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

const TAG = 'MorningAbility';

export default class EntryAbility extends UIAbility {
  private syncColorMode(colorMode: ConfigurationConstant.ColorMode | undefined): void {
    const isNight = colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
    AppStorage.setOrCreate<boolean>('isNight', isNight);
  }

  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, TAG, 'Ability onCreate');
    // 日夜模式跟随系统，页面通过 AppStorage('isNight') 取主题。
    this.syncColorMode(this.context.config.colorMode);
    AppStorage.setOrCreate<number>('sessionRevision', 0);
  }

  onConfigurationUpdate(newConfig: Configuration): void {
    this.syncColorMode(newConfig.colorMode);
  }

  onDestroy(): void {
    hilog.info(0x0000, TAG, 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // 主页面：pages/Index 自行判断登录态决定停在登录页还是进入主框架。
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(0x0000, TAG, 'Failed to load content. Code: %{public}d', err.code);
        return;
      }
      hilog.info(0x0000, TAG, 'Succeeded in loading content.');
    });
  }
}
