import { Platform } from 'obsidian';

/**
 * Single source of truth for platform detection, backed by Obsidian's
 * {@link Platform} API.
 *
 * Mutable object — tests may override properties directly:
 * `platform.isMobile = true`.
 */
export const platform = {
    isMobile: Platform.isMobileApp,
    isPhone: Platform.isPhone,
    isTablet: Platform.isTablet,
    isDesktop: Platform.isDesktopApp,
};
