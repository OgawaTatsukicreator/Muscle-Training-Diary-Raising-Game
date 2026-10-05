import terms from "@/lib/domain/name-filter-terms.json";

/**
 * 他のユーザーに見える名前(アカウントの表示名・マソ君の名前)の禁止ワード判定。
 *
 * 表記ゆれによるすり抜けを減らすため、判定前に次の「骨格」へ変換する:
 *   全角→半角(NFKC)・小文字化・カタカナ→ひらがな・簡単な数字置換(0→o 1→i 3→e 4→a 5→s @→a $→s)、
 *   そのうえで 英数字・ひらがな・長音・漢字 以外(空白・記号・絵文字)を取り除く。
 * 語彙は name-filter-terms.json。DB側は supabase/migrations/0005_name_filter.sql の
 * `is_name_allowed()` が同じ規則と語彙を持つ(単体テストで語彙の一致を確認している)。
 *
 * これは入口の対策であり、完全ではない。通報・非表示などの運用と併用すること。
 */
export const NAME_NOT_ALLOWED_MESSAGE =
  "この名前は使用できません。別の名前にしてください。";

type TermGroups = Record<string, string[]>;

function flatten(groups: TermGroups): string[] {
  return Object.values(groups).flat();
}

export const CONTAINS_TERMS: readonly string[] = flatten(terms.contains);
export const TOKEN_TERMS: readonly string[] = flatten(terms.tokens);

const LEET_FROM = "01345@$";
const LEET_TO = "oieasas";
/** SQL側の正規表現と同じ文字集合（英数字・ひらがな・長音・漢字）。 */
export const SKELETON_KEEP_CLASS =
  "a-z0-9\u3041-\u3096\u30fc\u3400-\u4dbf\u4e00-\u9fff";
const SKELETON_STRIP = new RegExp(`[^${SKELETON_KEEP_CLASS}]`, "g");

function katakanaToHiragana(text: string): string {
  let result = "";

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // ァ(U+30A1)〜ヶ(U+30F6) を ぁ(U+3041)〜ゖ(U+3096) へ
    result +=
      code >= 0x30a1 && code <= 0x30f6
        ? String.fromCodePoint(code - 0x60)
        : char;
  }

  return result;
}

function applyLeet(text: string): string {
  let result = "";

  for (const char of text) {
    const index = LEET_FROM.indexOf(char);
    result += index === -1 ? char : LEET_TO[index];
  }

  return result;
}

/** 空白・記号・絵文字を除いた判定用の文字列。 */
export function toSkeleton(input: string): string {
  return applyLeet(katakanaToHiragana(input.normalize("NFKC").toLowerCase()))
    .replace(SKELETON_STRIP, "");
}

/** 英単語単位の判定用に、区切りを残したまま小文字・数字置換した文字列。 */
function toWordText(input: string): string {
  return applyLeet(input.normalize("NFKC").toLowerCase());
}

export function isNameAllowed(name: string): boolean {
  const skeleton = toSkeleton(name);

  if (CONTAINS_TERMS.some((term) => skeleton.includes(term))) {
    return false;
  }

  const words = toWordText(name).split(/[^a-z0-9]+/);

  return !words.some((word) => TOKEN_TERMS.includes(word));
}
