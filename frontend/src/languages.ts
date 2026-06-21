/** languages.ts — Idiomas soportados por el motor OpenAI (origen y destino). */
import type { Language } from "./protocol";

export const COMMON_LANGS: Language[] = [
  { id: "auto", label: "Detectar idioma", alias: "auto detect", flag: "🌐", openai: false },
  { id: "zh", label: "Chino", alias: "chinese zh", flag: "🇨🇳", openai: true },
  { id: "en", label: "Inglés", alias: "english en", flag: "🇬🇧", openai: true },
  { id: "ja", label: "Japonés", alias: "japanese ja 日本語", flag: "🇯🇵", openai: true },
  { id: "ko", label: "Coreano", alias: "korean ko 한국어", flag: "🇰🇷", openai: true },
  { id: "es", label: "Español", alias: "spanish es español", flag: "🇪🇸", openai: true },
  { id: "fr", label: "Francés", alias: "french fr français", flag: "🇫🇷", openai: true },
  { id: "de", label: "Alemán", alias: "german de deutsch", flag: "🇩🇪", openai: true },
  { id: "it", label: "Italiano", alias: "italian it italiano", flag: "🇮🇹", openai: true },
  { id: "pt", label: "Portugués", alias: "portuguese pt português", flag: "🇧🇷", openai: true },
  { id: "ru", label: "Ruso", alias: "russian ru русский", flag: "🇷🇺", openai: true },
  { id: "ar", label: "Árabe", alias: "arabic ar العربية", flag: "🇸🇦", openai: true },
  { id: "hi", label: "Hindi", alias: "hindi hi हिन्दी", flag: "🇮🇳", openai: true },
  { id: "id", label: "Indonesio", alias: "indonesian id bahasa", flag: "🇮🇩", openai: true },
  { id: "th", label: "Tailandés", alias: "thai th ไทย", flag: "🇹🇭", openai: false },
  { id: "tr", label: "Turco", alias: "turkish tr türkçe", flag: "🇹🇷", openai: false },
  { id: "vi", label: "Vietnamita", alias: "vietnamese vi tiếng việt", flag: "🇻🇳", openai: false },
  { id: "nl", label: "Neerlandés", alias: "dutch nl nederlands", flag: "🇳🇱", openai: false },
  { id: "sv", label: "Sueco", alias: "swedish sv svenska", flag: "🇸🇪", openai: false },
  { id: "da", label: "Danés", alias: "danish da dansk", flag: "🇩🇰", openai: false },
  { id: "fi", label: "Finlandés", alias: "finnish fi suomi", flag: "🇫🇮", openai: false },
  { id: "pl", label: "Polaco", alias: "polish pl polski", flag: "🇵🇱", openai: false },
  { id: "cs", label: "Checo", alias: "czech cs čeština", flag: "🇨🇿", openai: false },
  { id: "fil", label: "Filipino", alias: "filipino fil tagalog", flag: "🇵🇭", openai: false },
  { id: "ms", label: "Malayo", alias: "malay ms bahasa melayu", flag: "🇲🇾", openai: false },
  { id: "no", label: "Noruego", alias: "norwegian no norsk", flag: "🇳🇴", openai: false },
];

export function langById(id: string): Language | undefined {
  return COMMON_LANGS.find((l) => l.id === id);
}
