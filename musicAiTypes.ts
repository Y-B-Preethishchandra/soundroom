export type MusicAiCategory = 'genre' | 'mood' | 'theme';

export const MUSIC_AI_ANALYSIS_VERSION = 3;

export type MusicAiTag = {
  category: MusicAiCategory;
  label: string;
  score: number;
};

export const MUSIC_AI_CLASSES: {
  classIndex: number;
  category: MusicAiCategory;
  label: string;
}[] = [
  { classIndex: 211, category: 'genre', label: 'Pop' },
  { classIndex: 212, category: 'genre', label: 'Hip hop' },
  { classIndex: 214, category: 'genre', label: 'Rock' },
  { classIndex: 216, category: 'genre', label: 'Punk rock' },
  { classIndex: 218, category: 'genre', label: 'Progressive rock' },
  { classIndex: 219, category: 'genre', label: 'Rock and roll' },
  { classIndex: 220, category: 'genre', label: 'Psychedelic rock' },
  { classIndex: 222, category: 'genre', label: 'Soul' },
  { classIndex: 224, category: 'genre', label: 'Country' },
  { classIndex: 225, category: 'genre', label: 'Swing' },
  { classIndex: 226, category: 'genre', label: 'Bluegrass' },
  { classIndex: 227, category: 'genre', label: 'Funk' },
  { classIndex: 228, category: 'genre', label: 'Folk' },
  { classIndex: 229, category: 'genre', label: 'Middle Eastern' },
  { classIndex: 230, category: 'genre', label: 'Jazz' },
  { classIndex: 231, category: 'genre', label: 'Disco' },
  { classIndex: 232, category: 'genre', label: 'Classical' },
  { classIndex: 233, category: 'genre', label: 'Opera' },
  { classIndex: 234, category: 'genre', label: 'Electronic' },
  { classIndex: 235, category: 'genre', label: 'House' },
  { classIndex: 236, category: 'genre', label: 'Techno' },
  { classIndex: 237, category: 'genre', label: 'Dubstep' },
  { classIndex: 238, category: 'genre', label: 'Drum and bass' },
  { classIndex: 239, category: 'genre', label: 'Electronica' },
  { classIndex: 240, category: 'genre', label: 'Electronic dance' },
  { classIndex: 241, category: 'genre', label: 'Ambient' },
  { classIndex: 242, category: 'genre', label: 'Trance' },
  { classIndex: 243, category: 'genre', label: 'Latin' },
  { classIndex: 244, category: 'genre', label: 'Salsa' },
  { classIndex: 246, category: 'genre', label: 'Blues' },
  { classIndex: 247, category: 'genre', label: 'Children music' },
  { classIndex: 248, category: 'genre', label: 'New age' },
  { classIndex: 249, category: 'genre', label: 'Vocal' },
  { classIndex: 251, category: 'genre', label: 'African' },
  { classIndex: 252, category: 'genre', label: 'Afrobeat' },
  { classIndex: 253, category: 'genre', label: 'Christian' },
  { classIndex: 254, category: 'genre', label: 'Gospel' },
  { classIndex: 255, category: 'genre', label: 'Asian' },
  { classIndex: 256, category: 'genre', label: 'Carnatic' },
  { classIndex: 257, category: 'genre', label: 'Bollywood' },
  { classIndex: 259, category: 'genre', label: 'Traditional' },
  { classIndex: 260, category: 'genre', label: 'Independent' },
  { classIndex: 262, category: 'theme', label: 'Background music' },
  { classIndex: 263, category: 'theme', label: 'Theme music' },
  { classIndex: 265, category: 'theme', label: 'Soundtrack' },
  { classIndex: 267, category: 'theme', label: 'Video game music' },
  { classIndex: 268, category: 'theme', label: 'Christmas music' },
  { classIndex: 269, category: 'theme', label: 'Dance music' },
  { classIndex: 270, category: 'theme', label: 'Wedding music' },
  { classIndex: 271, category: 'mood', label: 'Happy' },
  { classIndex: 272, category: 'mood', label: 'Sad' },
  { classIndex: 273, category: 'mood', label: 'Tender' },
  { classIndex: 274, category: 'mood', label: 'Exciting' },
  { classIndex: 275, category: 'mood', label: 'Angry' },
  { classIndex: 276, category: 'mood', label: 'Scary' },
];
