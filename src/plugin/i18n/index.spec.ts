import { describe, expect, it } from 'vitest';
import { en } from './en';
import { detectLanguage, selectTranslations } from './index';
import { ru } from './ru';
import { zhCn } from './zh-cn';

describe('i18n locale selection', () => {
    it('prefers and normalizes Obsidian getLanguage()', () => {
        const language = detectLanguage({
            getLanguage: () => ' zh-CN ',
            moment: {
                locale: () => {
                    throw new Error('legacy locale detection should not run');
                },
            },
        });

        expect(language).toBe('zh-cn');
    });

    it('falls back to moment.locale() when getLanguage is unavailable', () => {
        const language = detectLanguage({
            moment: {
                locale: () => 'RU',
            },
        });

        expect(language).toBe('ru');
    });

    it.each([
        ['zh', zhCn],
        ['zh-CN', zhCn],
        ['zh-cn', zhCn],
        ['zh-TW', zhCn],
        ['zh-HK', zhCn],
        ['en', en],
        ['en-US', en],
        ['ru-RU', ru],
        ['fr', en],
    ])('selects the expected dictionary for %s', (language, expected) => {
        expect(selectTranslations(language)).toBe(expected);
    });
});
