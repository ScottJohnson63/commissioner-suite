export type NewsSource = 'espn' | 'yahoo' | 'pft' | 'cbs';

export interface NewsArticle {
  title:       string;
  description: string;
  link:        string;
  pubDate:     string;
  imageUrl:    string | null;
  source:      NewsSource;
  sourceLabel: string;
}
