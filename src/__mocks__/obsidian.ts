export const Platform = {
    isMobile: false,
    isMobileApp: false,
    isPhone: false,
    isTablet: false,
    isDesktop: true,
    isDesktopApp: true,
};

export class TFile {
    path = '';
    name = '';
    basename = '';
    extension = '';
    parent = null;
    vault = null;
    stat = { ctime: 0, mtime: 0, size: 0 };
}
