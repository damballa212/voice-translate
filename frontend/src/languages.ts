/** languages.ts — Idiomas soportados por el motor OpenAI (origen y destino). */
import type { Language } from "./protocol";
import { t } from "./i18n";

interface LangDef {
  id: string;
  key: string;
  alias: string;
  flag: string;
  openai: boolean;
}

const LANG_DEFS: LangDef[] = [
  { id: "auto", key: "lang-auto", alias: "auto detect", flag: "🌐", openai: false },
  { id: "zh", key: "lang-zh", alias: "chinese zh 中文", flag: "🇨🇳", openai: true },
  { id: "en", key: "lang-en", alias: "english en", flag: "🇬🇧", openai: true },
  { id: "ja", key: "lang-ja", alias: "japanese ja 日本語", flag: "🇯🇵", openai: true },
  { id: "ko", key: "lang-ko", alias: "korean ko 한국어", flag: "🇰🇷", openai: true },
  { id: "es", key: "lang-es", alias: "spanish es español", flag: "🇪🇸", openai: true },
  { id: "fr", key: "lang-fr", alias: "french fr français", flag: "🇫🇷", openai: true },
  { id: "de", key: "lang-de", alias: "german de deutsch", flag: "🇩🇪", openai: true },
  { id: "it", key: "lang-it", alias: "italian it italiano", flag: "🇮🇹", openai: true },
  { id: "pt", key: "lang-pt", alias: "portuguese pt português", flag: "🇧🇷", openai: true },
  { id: "ru", key: "lang-ru", alias: "russian ru русский", flag: "🇷🇺", openai: true },
  { id: "ar", key: "lang-ar", alias: "arabic ar العربية", flag: "🇸🇦", openai: true },
  { id: "hi", key: "lang-hi", alias: "hindi hi हिन्दी", flag: "🇮🇳", openai: true },
  { id: "id", key: "lang-id", alias: "indonesian id bahasa", flag: "🇮🇩", openai: true },
  { id: "th", key: "lang-th", alias: "thai th ไทย", flag: "🇹🇭", openai: false },
  { id: "tr", key: "lang-tr", alias: "turkish tr türkçe", flag: "🇹🇷", openai: false },
  { id: "vi", key: "lang-vi", alias: "vietnamese vi tiếng việt", flag: "🇻🇳", openai: false },
  { id: "nl", key: "lang-nl", alias: "dutch nl nederlands", flag: "🇳🇱", openai: false },
  { id: "sv", key: "lang-sv", alias: "swedish sv svenska", flag: "🇸🇪", openai: false },
  { id: "da", key: "lang-da", alias: "danish da dansk", flag: "🇩🇰", openai: false },
  { id: "fi", key: "lang-fi", alias: "finnish fi suomi", flag: "🇫🇮", openai: false },
  { id: "pl", key: "lang-pl", alias: "polish pl polski", flag: "🇵🇱", openai: false },
  { id: "cs", key: "lang-cs", alias: "czech cs čeština", flag: "🇨🇿", openai: false },
  { id: "fil", key: "lang-fil", alias: "filipino fil tagalog", flag: "🇵🇭", openai: false },
  { id: "ms", key: "lang-ms", alias: "malay ms bahasa melayu", flag: "🇲🇾", openai: false },
  { id: "no", key: "lang-no", alias: "norwegian no norsk", flag: "🇳🇴", openai: false },
];

/** Returns the language list with labels translated to the current locale. */
export function getCommonLangs(): Language[] {
  return LANG_DEFS.map((d) => ({
    id: d.id,
    label: t(d.key),
    alias: d.alias,
    flag: d.flag,
    openai: d.openai,
  }));
}

/** Static reference for iteration — labels always in current locale. */
export const COMMON_LANGS: Language[] = LANG_DEFS.map((d) => ({
  id: d.id,
  get label() { return t(d.key); },
  alias: d.alias,
  flag: d.flag,
  openai: d.openai,
}));

export function langById(id: string): Language | undefined {
  return COMMON_LANGS.find((l) => l.id === id);
}
