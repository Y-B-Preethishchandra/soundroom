export type ThemeMode = 'dark' | 'light';

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceRaised: string;
  ink: string;
  primaryText: string;
  secondaryText: string;
  muted: string;
  accent: string;
  border: string;
  rowSurface: string;
  controlSurface: string;
  controlBorder: string;
  selectedSurface: string;
  selectedBorder: string;
  glassTint: string;
  glassHighlight: string;
  dock: string;
  dockBorder: string;
  dockText: string;
  dockSelectedText: string;
  sheet: string;
  backdrop: string;
  noticeText: string;
  artworkOrb: string;
  artworkNote: string;
  error: string;
};

export const THEME_COLORS: Record<ThemeMode, ThemeColors> = {
  dark: {
    background: '#10110F',
    surface: '#191A17',
    surfaceRaised: '#20211D',
    ink: '#11130D',
    primaryText: '#F3F4EC',
    secondaryText: '#A5A79D',
    muted: '#74766E',
    accent: '#D6F36A',
    border: '#2A2B26',
    rowSurface: 'rgba(255,255,255,0.018)',
    controlSurface: 'rgba(255,255,255,0.045)',
    controlBorder: 'rgba(255,255,255,0.1)',
    selectedSurface: 'rgba(214,243,106,0.14)',
    selectedBorder: 'rgba(214,243,106,0.52)',
    glassTint: 'rgba(22,24,20,0.34)',
    glassHighlight: 'rgba(255,255,255,0.42)',
    dock: 'rgba(13,15,13,0.48)',
    dockBorder: 'rgba(255,255,255,0.13)',
    dockText: '#A5A79D',
    dockSelectedText: '#D6F36A',
    sheet: '#191B17',
    backdrop: 'rgba(0,0,0,0.64)',
    noticeText: '#E4E9D1',
    artworkOrb: 'rgba(255,255,255,0.22)',
    artworkNote: 'rgba(20,22,17,0.82)',
    error: '#F08D7E',
  },
  light: {
    background: '#F5F5EF',
    surface: '#FFFFFF',
    surfaceRaised: '#E8E9E1',
    ink: '#212518',
    primaryText: '#20231B',
    secondaryText: '#56594F',
    muted: '#777A70',
    accent: '#63820D',
    border: '#D9DBD1',
    rowSurface: 'rgba(255,255,255,0.78)',
    controlSurface: 'rgba(32,35,27,0.045)',
    controlBorder: 'rgba(32,35,27,0.12)',
    selectedSurface: 'rgba(99,130,13,0.12)',
    selectedBorder: 'rgba(99,130,13,0.42)',
    glassTint: 'rgba(255,255,255,0.44)',
    glassHighlight: 'rgba(255,255,255,0.88)',
    dock: 'rgba(250,250,246,0.84)',
    dockBorder: 'rgba(32,35,27,0.12)',
    dockText: '#3E4137',
    dockSelectedText: '#405800',
    sheet: '#FFFFFF',
    backdrop: 'rgba(25,28,21,0.38)',
    noticeText: '#333A24',
    artworkOrb: 'rgba(255,255,255,0.38)',
    artworkNote: 'rgba(20,22,17,0.82)',
    error: '#B42318',
  },
};
