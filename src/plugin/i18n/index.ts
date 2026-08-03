import { moment } from 'obsidian';
import { en } from './en';
import { zhCn } from './zh-cn';
import { ru } from './ru';
import type { ZhCnStrings } from './zh-cn';

export function t(): ZhCnStrings {
    const locale = moment.locale();
    return locale.startsWith('zh') ? zhCn : locale.startsWith('ru') ? ru : en;
}
