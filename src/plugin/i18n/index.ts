import * as obsidian from 'obsidian';
import { en } from './en';
import { zhCn } from './zh-cn';
import { ru } from './ru';

export type I18nStrings = typeof zhCn;

type LanguageApi = {
    getLanguage?: () => string;
    moment: {
        locale(): string;
    };
};

const translationsByLocale: Record<string, I18nStrings> = {
    en,
    ru,
    zh: zhCn,
    'zh-cn': zhCn,
    'zh-hk': zhCn,
    'zh-tw': zhCn,
};

export function detectLanguage(api: LanguageApi): string {
    const language = typeof api.getLanguage === 'function'
        ? api.getLanguage()
        : api.moment.locale();
    return language.trim().toLowerCase();
}

export function selectTranslations(language: string): I18nStrings {
    const normalizedLanguage = language.trim().toLowerCase();
    return translationsByLocale[normalizedLanguage]
        ?? translationsByLocale[normalizedLanguage.split('-')[0]]
        ?? en;
}

export function t(): I18nStrings {
    return selectTranslations(detectLanguage(obsidian));
}
