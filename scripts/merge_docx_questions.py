"""Merge MCQ data from bank DOCX into public/sample-questions.json."""
import json
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

DOCX = Path(r"c:\Users\ahala\Downloads\CD20~1.DOC")
JSON_PATH = Path(__file__).resolve().parent.parent / "public" / "sample-questions.json"

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def extract_paragraphs_from_docx(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml")
    root = ET.fromstring(xml)
    paras: list[str] = []
    for para in root.findall(".//w:p", NS):
        parts = [x.text for x in para.findall(".//w:t", NS) if x.text]
        t = "".join(parts).strip()
        if t:
            paras.append(" ".join(t.replace("\xa0", " ").split()))
    return paras


def combine_question_paragraphs(paras: list[str]) -> list[str]:
    """Merge 'سN: question' line with next line when choices are split."""
    combined: list[str] = []
    i = 0
    q_prefix = re.compile(r"^س[0-9]+\s*:")
    while i < len(paras):
        line = paras[i]
        if (
            q_prefix.match(line)
            and "أ)" not in line
            and i + 1 < len(paras)
        ):
            line2 = paras[i + 1]
            if all(x in line2 for x in ("أ)", "ب)", "ج)", "د)")):
                combined.append(line + " " + line2)
                i += 2
                continue
        combined.append(line)
        i += 1
    return combined


def normalize_answer_letter(raw: str) -> str | None:
    """Map Arabic or Latin MCQ key to أ ب ج د."""
    ans = raw.strip()
    latin = {"a": "أ", "b": "ب", "c": "ج", "d": "د"}
    if ans.lower() in latin:
        return latin[ans.lower()]
    if ans in ("أ", "ب", "ج", "د"):
        return ans
    return None


def parse_mcq_block(s: str) -> dict | None:
    if not re.match(r"^س[0-9]+\s*:", s):
        return None
    if not all(x in s for x in ("أ)", "ب)", "ج)", "د)")) or "[الجواب:" not in s:
        return None
    try:
        q = s.split(":", 1)[1].split("أ)", 1)[0].strip()
        a = s.split("أ)", 1)[1].split("ب)", 1)[0].strip()
        b = s.split("ب)", 1)[1].split("ج)", 1)[0].strip()
        c = s.split("ج)", 1)[1].split("د)", 1)[0].strip()
        d = s.split("د)", 1)[1].split("[الجواب:", 1)[0].strip()
        ans_raw = s.split("[الجواب:", 1)[1].split("]", 1)[0].strip()
    except Exception:
        return None
    ans = normalize_answer_letter(ans_raw)
    if ans is None:
        return None
    idx = {"أ": 0, "ب": 1, "ج": 2, "د": 3}[ans]
    return {"question": q, "choices": [a, b, c, d], "correctIndex": idx}


def norm_key(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = (
        s.replace("\xa0", " ")
        .replace("\u200b", "")
        .replace("\u200c", "")
        .replace("\u200d", "")
        .replace("🔥", "")
    )
    # Typographic quotes (Word) vs plain text in JSON
    for ch in ('"', "'", "\u201c", "\u201d", "\u2018", "\u2019", "`"):
        s = s.replace(ch, "")
    # "[صعب]", "[🔥 صعب]", etc.
    s = re.sub(r"\[[^\]]*صعب[^\]]*\]", "", s)
    s = s.replace("[صعب]", "").replace("[ صعب ]", "")
    # Same stem, Word adds "التالية"
    s = s.replace("البيانات التالية (", "البيانات (")
    s = s.replace("^", "").replace("×", "x").replace("³", "3")
    s = s.replace("−", "-")
    # Word sometimes uses ة vs JSON ه (e.g. لونة / لونه)
    s = s.replace("ة", "ه")
    s = re.sub(r"\s+", "", s)
    # DOCX typo: extra "[" before question stem (e.g. "[مجموع انحرافات...")
    s = re.sub(r"^\[+", "", s)
    s = s.replace("؟", "").replace(":", "").replace("،", ",")
    return s.lower()


def question_lookup_keys(question: str) -> list[str]:
    """Normalized keys to match JSON questions to bank rows."""
    q = question.strip()
    keys = [norm_key(q)]
    # Bank sometimes moves "(0.5, -0.9, ...)" out of the stem into choices only
    if "(" in q:
        stripped = re.sub(r"\([^()]*\)\s*$", "", q).strip()
        if stripped and stripped != q:
            keys.append(norm_key(stripped))
    return keys


def main() -> None:
    paras = extract_paragraphs_from_docx(DOCX)
    combined = combine_question_paragraphs(paras)
    rows: list[dict] = []
    for block in combined:
        r = parse_mcq_block(block)
        if r:
            rows.append(r)

    with JSON_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)

    by_q = {norm_key(r["question"]): r for r in rows}
    matched = 0
    unmatched: list[str] = []
    for item in data:
        r = None
        for key in question_lookup_keys(item.get("question", "")):
            r = by_q.get(key)
            if r:
                break
        if r:
            item["choices"] = r["choices"]
            item["correctIndex"] = r["correctIndex"]
            matched += 1
        else:
            unmatched.append(item.get("question", ""))

    print("docx_paragraphs", len(paras))
    print("combined_blocks", len(combined))
    print("parsed_mcqs", len(rows))
    print("json_questions", len(data))
    print("matched", matched)
    print("unmatched", len(unmatched))
    if unmatched[:15]:
        print("sample_unmatched:")
        for u in unmatched[:15]:
            print(" -", (u[:80] + "...") if len(u) > 80 else u)

    expected = len(data)
    if matched != expected:
        print(
            "ERROR: Refusing to write JSON until all questions match "
            f"({matched}/{expected})."
        )
        return

    with JSON_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("Wrote", JSON_PATH)


if __name__ == "__main__":
    main()
