import { App, PluginSettingTab, Setting } from 'obsidian';
import DragNDropPlugin from './main';

export type HandleVisibilityMode = 'always' | 'hover' | 'hidden';
export type HandleIconStyle = 'dot' | 'grip-dots' | 'grip-lines' | 'square';

export interface DragNDropSettings {
    // 抓取手柄颜色模式
    handleColorMode: 'theme' | 'custom';
    // 抓取手柄颜色（自定义时生效）
    handleColor: string;
    // 手柄显示模式
    handleVisibility: HandleVisibilityMode;
    // 手柄图标样式
    handleIcon: HandleIconStyle;
    // 手柄大小（像素）
    handleSize: number;
    // 定位栏颜色模式
    indicatorColorMode: 'theme' | 'custom';
    // 定位栏颜色（自定义时生效）
    indicatorColor: string;
    // 是否启用跨文件拖拽
    enableCrossFileDrag: boolean;
    // 是否启用多行选取拖拽
    enableMultiLineSelection: boolean;
    // 手柄横向偏移量（像素）
    handleHorizontalOffsetPx: number;
}

export const DEFAULT_SETTINGS: DragNDropSettings = {
    handleColorMode: 'theme',
    handleColor: '#8a8a8a',
    handleVisibility: 'hover',
    handleIcon: 'dot',
    handleSize: 16,
    indicatorColorMode: 'theme',
    indicatorColor: '#7a7a7a',
    enableCrossFileDrag: false,
    enableMultiLineSelection: true,
    handleHorizontalOffsetPx: 0,
};

export class DragNDropSettingTab extends PluginSettingTab {
    plugin: DragNDropPlugin;

    constructor(app: App, plugin: DragNDropPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Dragger 设置' });

        containerEl.createEl('h3', { text: '样式' });

        const colorSetting = new Setting(containerEl)
            .setName('抓取手柄颜色')
            .setDesc('可跟随主题色，或自定义颜色（选择自定义时生效）');

        colorSetting.addDropdown(dropdown => dropdown
            .addOption('theme', '跟随主题色')
            .addOption('custom', '自定义')
            .setValue(this.plugin.settings.handleColorMode)
            .onChange(async (value: 'theme' | 'custom') => {
                this.plugin.settings.handleColorMode = value;
                await this.plugin.saveSettings();
            }));

        colorSetting.addColorPicker(picker => picker
            .setValue(this.plugin.settings.handleColor)
            .onChange(async (value) => {
                this.plugin.settings.handleColor = value;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('手柄显示模式')
            .setDesc('控制拖拽手柄的显示方式')
            .addDropdown(dropdown => dropdown
                .addOption('hover', '悬停显示')
                .addOption('always', '一直显示')
                .addOption('hidden', '一直隐藏')
                .setValue(this.plugin.settings.handleVisibility)
                .onChange(async (value: HandleVisibilityMode) => {
                    this.plugin.settings.handleVisibility = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('手柄图标')
            .setDesc('选择拖拽手柄的图标样式')
            .addDropdown(dropdown => dropdown
                .addOption('dot', '● 圆点')
                .addOption('grip-dots', '⠿ 六点抓手')
                .addOption('grip-lines', '☰ 三横线')
                .addOption('square', '■ 方块')
                .setValue(this.plugin.settings.handleIcon)
                .onChange(async (value: HandleIconStyle) => {
                    this.plugin.settings.handleIcon = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('手柄大小')
            .setDesc('调整拖拽手柄的大小（像素）')
            .addSlider((slider) => slider
                .setLimits(12, 28, 2)
                .setDynamicTooltip()
                .setValue(this.plugin.settings.handleSize)
                .onChange(async (value) => {
                    this.plugin.settings.handleSize = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('手柄横向位置')
            .setDesc('向左为负值，向右为正值')
            .addSlider((slider) => slider
                .setLimits(-80, 80, 1)
                .setDynamicTooltip()
                .setValue(this.plugin.settings.handleHorizontalOffsetPx)
                .onChange(async (value) => {
                    this.plugin.settings.handleHorizontalOffsetPx = value;
                    await this.plugin.saveSettings();
                }));

        const indicatorSetting = new Setting(containerEl)
            .setName('定位栏颜色')
            .setDesc('可跟随主题色，或自定义颜色（选择自定义时生效）');

        indicatorSetting.addDropdown(dropdown => dropdown
            .addOption('theme', '跟随主题色')
            .addOption('custom', '自定义')
            .setValue(this.plugin.settings.indicatorColorMode)
            .onChange(async (value: 'theme' | 'custom') => {
                this.plugin.settings.indicatorColorMode = value;
                await this.plugin.saveSettings();
            }));

        indicatorSetting.addColorPicker(picker => picker
            .setValue(this.plugin.settings.indicatorColor)
            .onChange(async (value) => {
                this.plugin.settings.indicatorColor = value;
                await this.plugin.saveSettings();
            }));

        containerEl.createEl('h3', { text: '功能' });
        new Setting(containerEl)
            .setName('开启多行选取')
            .setDesc('关闭后仅保留单块拖拽，不进入多行选取流程')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableMultiLineSelection)
                .onChange(async (value) => {
                    this.plugin.settings.enableMultiLineSelection = value;
                    await this.plugin.saveSettings();
                }));

        // Cross-file drag remains disabled in this release.
        // Keep the persisted setting key for backward compatibility, but hide it from UI.
    }
}
