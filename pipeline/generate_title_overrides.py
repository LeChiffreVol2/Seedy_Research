from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MARKDOWN_DIR = ROOT / "pipeline" / "data" / "markdown"
OUTPUT_FILE = ROOT / "web" / "lib" / "paper-title-overrides.json"
SUMMARY_OUTPUT_FILE = ROOT / "web" / "lib" / "paper-summary-overrides.ts"

THAI_MARK = r"[\u0E31\u0E33-\u0E3A\u0E47-\u0E4E]"
THAI_ANY = r"[\u0E00-\u0E7F]"

LEGACY_THAI_GLYPH_MAP = str.maketrans(
    {
        "\uf701": "ิ",
        "\uf702": "ี",
        "\uf703": "ึ",
        "\uf704": "ื",
        "\uf705": "่",
        "\uf706": "้",
        "\uf707": "๊",
        "\uf708": "๋",
        "\uf709": "์",
        "\uf70a": "่",
        "\uf70b": "้",
        "\uf70c": "๊",
        "\uf70e": "์",
        "\uf710": "ั",
        "\uf712": "็",
        "\uf713": "่",
        "\uf714": "้",
        "\uf715": "๊",
        "\uf71b": "ำ",
    }
)


def repair_legacy_thai_glyphs(value: str) -> str:
    text = value.translate(LEGACY_THAI_GLYPH_MAP)

    # NCCE29 includes another embedded-font encoding where ASCII glyphs
    # represent Thai tone/diacritic marks. Apply replacements only in Thai
    # contexts so English titles and formulas remain intact.
    text = re.sub(r"(?<=[\u0E00-\u0E7F])0(?=[\u0E00-\u0E7F])", "ั", text)
    text = re.sub(r"(?<=[\u0E00-\u0E7F])E(?=[\u0E00-\u0E7F])", "ั", text)
    text = re.sub(r"ปF(?=จ)", "ปั", text)
    text = re.sub(r"(?<=[\u0E00-\u0E7F])F(?=[\u0E00-\u0E7F])", "่", text)
    text = re.sub(r"(?<=ร)=(?=[\u0E00-\u0E7F]|\s|$)", "์", text)
    text = re.sub(r"(?<=[\u0E00-\u0E7F])=(?=[\u0E00-\u0E7F])", "้", text)
    text = re.sub(r"(?<=[\u0E00-\u0E7F])[eI3Tg6M](?=[\u0E00-\u0E7F]|\s|:|/|$)", "์", text)
    text = re.sub(r"(?<=[\u0E00-\u0E7F])8(?=\s|:|/|$)", "์", text)
    text = re.sub(r"(?<=[\u0E00-\u0E7F])[l;4HPO>](?=[\u0E00-\u0E7F])", "้", text)
    text = re.sub(r"(?<=[\u0E00-\u0E7F])L(?=[\u0E00-\u0E7F])", "่", text)
    text = re.sub(r"(?<=[\u0E00-\u0E7F])[2A8@'<](?=[\u0E00-\u0E7F])", "่", text)

    phrase_fixes = {
        "ปEจจัย": "ปัจจัย",
        "แผLน": "แผ่น",
        "แผL น": "แผ่น",
        "กลุLม": "กลุ่ม",
        "กลุL ม": "กลุ่ม",
        "ทL า": "ท่า",
        "ด์วย": "ด้วย",
        "ใช์งาน": "ใช้งาน",
        "ใช์": "ใช้",
        "รีดร์อน": "รีดร้อน",
        "วิเคราะห่": "วิเคราะห์",
        "วัตถุประสงค่": "วัตถุประสงค์",
        "กLอสร์าง": "ก่อสร้าง",
        "กLอสราง": "ก่อสร้าง",
        "ก่อสร์าง": "ก่อสร้าง",
        "สร์าง": "สร้าง",
        "เส์น": "เส้น",
        "ผลิตภัณฑ8": "ผลิตภัณฑ์",
        "แผ/น": "แผ่น",
        "ขี/": "ขี่",
        "ภัยแล/ง": "ภัยแล้ง",
        "โดยใช/": "โดยใช้",
        "ใช/": "ใช้",
        "ข/อมูล": "ข้อมูล",
        "สถาป�ตยกรรม": "สถาปัตยกรรม",
        "แอสฟ�ลท์": "แอสฟัลท์",
        "ป�จจัย": "ปัจจัย",
        "ครั้งที�": "ครั้งที่",
        "วันที�": "วันที่",
        "ที่�": "ที่",
    }
    for source, replacement in phrase_fixes.items():
        text = text.replace(source, replacement)

    # Presentation titles should not contain PDF math symbol glyphs.
    text = re.sub(r"[\uf8eb-\uf8fe]", "", text)
    return text


def repair_thai_text(value: str) -> str:
    text = unicodedata.normalize("NFC", repair_legacy_thai_glyphs(value))
    text = re.sub(rf"\s+({THAI_MARK})", r"\1", text)
    text = re.sub(r"([\u0E40-\u0E44])\s+([\u0E01-\u0E2E])", r"\1\2", text)
    text = re.sub(r"([\u0E01-\u0E2E])\s+(\u0E33)", r"\1\2", text)
    text = re.sub(r"([\u0E01-\u0E2E])\s+([\u0E30-\u0E32])", r"\1\2", text)
    for _ in range(8):
        next_text = re.sub(rf"({THAI_ANY})\s+({THAI_ANY})", r"\1\2", text)
        if next_text == text:
            break
        text = next_text
    return text


def strip_frontmatter(text: str) -> str:
    if not text.startswith("---"):
        return text
    parts = text.split("---", 2)
    return parts[2] if len(parts) == 3 else text


def clean_line(value: str) -> str:
    text = repair_thai_text(value)
    text = re.sub(r"^#{1,6}\s*", "", text)
    text = re.sub(r"^document\s*", "", text, flags=re.I)
    text = re.sub(r"^\d{6,7}\s*Civil Engineering Project\s*", "", text, flags=re.I)
    text = re.sub(r"\bthe\s+Civil Engineering Project\b", "", text, flags=re.I)
    text = re.sub(r"\bCIVIL ENGINEERING PROJECT\b", "", text, flags=re.I)
    text = re.sub(r"[!¡*•●○]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^[\\/:;,.|&\-\s]+|[\\/:;,.|&\-\s]+$", "", text)
    text = remove_author_suffix(text)
    return text


def remove_author_suffix(value: str) -> str:
    if " / " not in value:
        return value
    head, tail = value.rsplit(" / ", 1)
    looks_like_author_tail = bool(re.search(r"\d[.,*]?", tail)) and ("," in tail or "และ" in tail)
    looks_like_title_tail = bool(
        re.search(
            r"การศึกษา|การวิเคราะห์|การพัฒนา|การประเมิน|กรณีศึกษา|พื้นที่ศึกษา|study|analysis|assessment|evaluation|case|model|DPT|ITRF|TGM|GIS|RTK",
            tail,
            flags=re.I,
        )
    )
    if looks_like_author_tail and not looks_like_title_tail:
        return head.strip()
    return value


def is_abstract_marker(line: str) -> bool:
    return bool(re.match(r"^(abstract|บทคัดย่อ|บทคัดยอ|บพคัดย่อ|บทพคัดย่อ)\b", line, flags=re.I))


def is_author_or_affiliation(line: str) -> bool:
    if re.search(r"ภาควิชา|คณะวิศวกรรม|สาขาวิชา|อาจารย|author|email|e-mail|corresponding", line, flags=re.I):
        return True
    if re.search(r"ผศ\.|รศ\.|ดร\.|อ\.ดร\.", line):
        return True
    # Thai author rows often contain multiple names marked with numeric
    # affiliations. Avoid treating them as long Thai titles.
    if re.search(r"\d", line) and re.search(r"\sและ\s|,", line) and not re.search(
        r"การศึกษา|การวิเคราะห์|การพัฒนา|การพยากรณ์|model|analysis|study|forecast",
        line,
        flags=re.I,
    ):
        return True
    return False


def is_generic_course_line(line: str) -> bool:
    compact = re.sub(r"\s+", "", line)
    if re.match(r"^\d{6,7}\b.*Civil Engineering Project", line, flags=re.I):
        return True
    if re.match(r"^2101499\b", line, flags=re.I):
        return True
    if re.match(r"^(ปการศึกษา|ปีการศึกษา|วิชา)", line, flags=re.I):
        return True
    if re.search(r"โครงงานทางวิศวกรรมโยธา", compact):
        return True
    return False


def is_noisy_title(line: str) -> bool:
    compact = re.sub(r"\s+", "", line)
    if not line or len(line) < 8:
        return True
    if re.match(THAI_MARK, line):
        return True
    if re.search(r"การประชุมวิชาการวิศวกรรมโยธาแห่งชาติ|National Convention on Civil Engineering|Online Conference", line, flags=re.I):
        return True
    if re.match(r"^วันที่\b|^\d{1,2}-\d{1,2}\s+(May|June|July)\s+\d{4}", line, flags=re.I):
        return True
    if re.match(r"^(page|หน้า|references?|เอกสารอ้างอิง|introduction|บทนำ|keywords?|key words?|ค[ํำ]าส[ํำ]าคัญ|คำสำคัญ)\b", line, flags=re.I):
        return True
    if re.match(r"^(table|figure)\s*\d+", line, flags=re.I):
        return True
    if re.match(r"^(ตาราง|รูป)\s*ที่\s*\d+", line):
        return True
    if re.match(r"^2101499\b.*(civil engineering project|ปีการศึกษา|โครงงานทางวิศวกรรมโยธา)", line, flags=re.I):
        return True
    if re.match(r"^2101499\s*(civil engineering project)?$", line, flags=re.I):
        return True
    if re.match(r"^2101499โครงงานทางวิศวกรรมโยธา", compact):
        return True
    if re.match(r"^(บทความวิจัย|บ?ทความว|ปการศึกษา|ปีการศึกษา)", line, flags=re.I):
        return True
    if is_generic_course_line(line):
        return True
    if re.search(r"\.(pdf|md)$", line, flags=re.I):
        return True
    if re.match(r"^(Y\d{4}|NCCE\d{2})[_-]", line, flags=re.I):
        return True
    if is_author_or_affiliation(line):
        return True
    if re.search(r"วัตถุประสงค์|ผลการวิจัย|ผลการศึกษา|จากการศึกษา|การศึกษานี้|งานวิจัยนี้|โครงงานวิจัย|ในขั้นตอน|ปัจจุบัน|พบว่า", line):
        return True
    if re.search(r"the objective|this study|results?|research findings|findings suggest|project aims|aims to|aimed to|conducted|covers|nowadays", line, flags=re.I):
        return True
    return False


def is_noisy_markdown_heading(line: str) -> bool:
    """Generated paper-level H1 headings are usually the best title source.

    Keep this filter narrower than is_noisy_title() because several real NCCE
    titles include department/faculty names as part of the title/subtitle.
    """
    compact = re.sub(r"\s+", "", line)
    if not line or len(line) < 8:
        return True
    if re.search(r"การประชุมวิชาการวิศวกรรมโยธาแห่งชาติ|National Convention on Civil Engineering|Online Conference", line, flags=re.I):
        return True
    if re.match(r"^วันที่\b|^\d{1,2}-\d{1,2}\s+(May|June|July)\s+\d{4}", line, flags=re.I):
        return True
    if re.match(r"^(page|หน้า|abstract|บทคัดย่อ|บทคัดยอ|บพคัดย่อ|references?|เอกสารอ้างอิง|keywords?|key words?|ค[ํำ]าส[ํำ]าคัญ|คำสำคัญ)\b", line, flags=re.I):
        return True
    if re.match(r"^2101499\b.*(civil engineering project|ปีการศึกษา|โครงงานทางวิศวกรรมโยธา)", line, flags=re.I):
        return True
    if re.match(r"^2101499\s*(civil engineering project)?$", line, flags=re.I):
        return True
    if re.match(r"^2101499โครงงานทางวิศวกรรมโยธา", compact):
        return True
    if re.search(r"\.(pdf|md)$", line, flags=re.I):
        return True
    if re.match(r"^(Y\d{4}|NCCE\d{2})[_-]", line, flags=re.I):
        return True
    return False


def title_score(line: str, heading_level: int | None = None) -> int:
    if is_noisy_title(line):
        return -1000
    if len(line) > 180:
        return -500

    thai_chars = len(re.findall(THAI_ANY, line))
    latin_chars = len(re.findall(r"[A-Za-z]", line))
    words = len(re.findall(r"[A-Za-z0-9]+", line))
    score = min(len(line), 120)
    if heading_level == 1:
        score += 90
    elif heading_level == 2:
        score += 45
    if thai_chars >= 12:
        score += 35
    if latin_chars >= 12 and words >= 4:
        score += 32
    if re.search(r"การศึกษา|การวิเคราะห์|การพัฒนา|การพยากรณ์|ปัจจัย|ผลกระทบ|ประสิทธิภาพ|ความเป็นไปได้|พฤติกรรม|แบบจำลอง|study|analysis|evaluation|model|platform|feasibility|behavior|performance|development|assessment|system|forecast", line, flags=re.I):
        score += 75
    if re.search(r"road|traffic|transport|concrete|construction|flood|geotechnical|accident|mobility|travel|shuttle|bus|carbon|GIS", line, flags=re.I):
        score += 25
    if line.startswith("การ") or re.match(r"^(A|An|The)\s", line):
        score += 12
    if re.match(r"^(โดย|ผู้|ใน|และ|จาก|of|for|\()", line, flags=re.I):
        score -= 80
    if len(line) < 28:
        score -= 20
    return score


def duplicate_like_previous(previous: str, current: str) -> bool:
    prev = re.sub(r"[^A-Za-z0-9\u0E00-\u0E7F]", "", previous)
    curr = re.sub(r"[^A-Za-z0-9\u0E00-\u0E7F]", "", current)
    if not prev or not curr:
        return False
    if prev in curr or curr in prev:
        return True
    prefix = 0
    for a, b in zip(prev, curr):
        if a != b:
            break
        prefix += 1
    return prefix >= 24


def line_script_kind(line: str) -> str:
    thai_chars = len(re.findall(THAI_ANY, line))
    latin_chars = len(re.findall(r"[A-Za-z]", line))
    if thai_chars >= 8 and thai_chars >= latin_chars:
        return "thai"
    if latin_chars >= 8 and thai_chars < 8:
        return "latin"
    return "mixed"


def early_title_block_candidates(raw_lines: list[str]) -> list[tuple[str, int]]:
    title_lines: list[str] = []
    for raw in raw_lines[:80]:
        cleaned = clean_line(raw)
        if not cleaned:
            continue
        if is_abstract_marker(cleaned):
            break
        if is_generic_course_line(cleaned) or is_noisy_markdown_heading(cleaned):
            continue
        if is_author_or_affiliation(cleaned):
            if title_lines:
                break
            continue
        score = title_score(cleaned, None)
        if score > 0 or (title_lines and not is_noisy_title(cleaned) and len(cleaned) <= 90):
            if title_lines and duplicate_like_previous(title_lines[-1], cleaned):
                continue
            title_lines.append(cleaned)

    candidates: list[tuple[str, int]] = []
    for index, line in enumerate(title_lines):
        for width in range(1, 4):
            window = title_lines[index : index + width]
            if len(window) != width:
                continue
            kinds = [line_script_kind(item) for item in window]
            if len(set(kinds)) > 1 and "mixed" not in kinds:
                continue
            merged = clean_line(" ".join(window).strip())
            if not merged or len(merged) > 180:
                continue
            score = title_score(merged, None) + (width - 1) * 35 - index * 120
            if score > 0:
                candidates.append((merged, score))
    return candidates


def source_key(path: Path) -> str:
    return path.name


def extract_title(path: Path) -> str:
    text = strip_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
    raw_lines = [line.rstrip() for line in text.splitlines()]
    candidates: list[tuple[str, int]] = []
    before_abstract = True

    for raw in raw_lines[:40]:
        h1 = re.match(r"^#\s+(.+)$", raw.strip())
        if not h1:
            continue
        title = clean_line(h1.group(1))
        if title and not is_noisy_markdown_heading(title):
            return title[:180].strip()

    block_candidates = early_title_block_candidates(raw_lines)
    if block_candidates:
        return sorted(block_candidates, key=lambda item: item[1], reverse=True)[0][0][:180].strip()

    for raw in raw_lines[:120]:
        cleaned = clean_line(raw)
        if not cleaned:
            continue
        if is_abstract_marker(cleaned):
            before_abstract = False
            break
        if not before_abstract:
            break

        heading_match = re.match(r"^(#{1,6})\s+(.+)$", raw.strip())
        heading_level = len(heading_match.group(1)) if heading_match else None
        line = clean_line(heading_match.group(2) if heading_match else raw)
        score = title_score(line, heading_level)
        if score > 0:
            candidates.append((line, score))

    # Some CE PDFs do not preserve headings, but often preserve a clean English
    # title line before the author block.
    for index, raw in enumerate(raw_lines[:80]):
        line = clean_line(raw)
        if not line or is_abstract_marker(line):
            break
        if not re.search(r"[A-Za-z]", line):
            continue
        if is_noisy_title(line):
            continue
        merged = line
        for next_raw in raw_lines[index + 1 : index + 3]:
            next_line = clean_line(next_raw)
            if not next_line or is_abstract_marker(next_line) or is_noisy_title(next_line):
                break
            if re.search(r"[A-Za-z]", next_line) and len(next_line.split()) <= 9:
                merged = f"{merged} {next_line}"
        score = title_score(merged, None) + 10
        if score > 0:
            candidates.append((merged, score))

    if not candidates:
        return path.stem

    best = sorted(candidates, key=lambda item: item[1], reverse=True)[0][0]
    return best[:180].strip()


def thai_count(value: str) -> int:
    return len(re.findall(THAI_ANY, value))


def latin_count(value: str) -> int:
    return len(re.findall(r"[A-Za-z]", value))


def summary_segments(raw: str) -> list[str]:
    # Split before Thai glyph repair. The proceedings PDFs are two-column;
    # repairing Thai whitespace first can accidentally merge the left Thai
    # abstract with right-column English/intro text.
    raw_segments = [segment.strip() for segment in re.split(r"\s{3,}", raw.replace("\t", "    ")) if segment.strip()]
    segments = [repair_thai_text(segment).strip() for segment in raw_segments if segment.strip()]
    return segments or [repair_thai_text(raw).strip()]


def strip_summary_markers(value: str) -> str:
    text = value
    text = re.sub(r"^#{1,6}\s*", "", text).strip()
    text = re.sub(r"^(abstract|บทคัดย่อ|บทคัดยอ|บพคัดย่อ|บทพคัดย่อ)\s*:?", "", text, flags=re.I).strip()
    text = re.split(r"\b(?:keywords?|key words?)\b|คำสำคัญ|ค[ํำ]าส[ํำ]าคัญ", text, maxsplit=1, flags=re.I)[0]
    return clean_line(text)


def is_summary_stop_line(value: str) -> bool:
    raw = repair_thai_text(value).strip()
    raw = re.sub(r"^#{1,6}\s*", "", raw).strip()
    if re.match(r"^(abstract|บทคัดย่อ|บทคัดยอ|บพคัดย่อ|บทพคัดย่อ|keywords?|key words?|คำสำคัญ|ค[ํำ]าส[ํำ]าคัญ)\b", raw, flags=re.I):
        return True
    line = strip_summary_markers(value)
    if not line:
        return False
    if re.match(r"^(abstract|บทคัดย่อ|บทคัดยอ|บพคัดย่อ|บทพคัดย่อ)\b", line, flags=re.I):
        return True
    if re.match(r"^(keywords?|key words?|คำสำคัญ|ค[ํำ]าส[ํำ]าคัญ)\b", line, flags=re.I):
        return True
    if re.match(r"^(\d+(\.\d+)*)\s*(คำนำ|คานา|บทนำ|บทนา|introduction)\b", line, flags=re.I):
        return True
    if re.match(r"^(เอกสารอ้างอิง|references?)\b", line, flags=re.I):
        return True
    return False


def is_summary_noise(value: str, title: str) -> bool:
    line = strip_summary_markers(value)
    if not line:
        return True
    if len(line) < 24:
        return True
    if is_author_or_affiliation(line):
        return True
    if is_generic_course_line(line):
        return True
    if re.search(r"การประชุมวิชาการวิศวกรรมโยธาแห่งชาติ|National Convention on Civil Engineering|Online Conference", line, flags=re.I):
        return True
    if re.search(r"\bTHAILAND\b|จ\.ชลบุรี|จ\.เชียงใหม่|จ\.ภูเก็ต|July|May|June", line, flags=re.I):
        return True
    if re.search(r"\b[A-Z]{2,5}-?\d{1,3}-\d+\b", line):
        return True
    if re.match(r"^(page|หน้า)\s*\d+\b", line, flags=re.I):
        return True
    if re.match(r"^#|^[-_*]{3,}$", line):
        return True
    compact_line = re.sub(r"[^A-Za-z0-9\u0E00-\u0E7F]", "", line).lower()
    compact_title = re.sub(r"[^A-Za-z0-9\u0E00-\u0E7F]", "", title).lower()
    if compact_title and (compact_line in compact_title or compact_title in compact_line):
        return True
    return False


def choose_summary_segment(raw: str, title: str, prefer_thai: bool) -> str:
    candidates: list[str] = []
    for segment in summary_segments(raw):
        if is_summary_stop_line(segment):
            break
        cleaned = strip_summary_markers(segment)
        if is_summary_noise(cleaned, title):
            continue
        thai_chars = thai_count(cleaned)
        latin_chars = latin_count(cleaned)
        if prefer_thai:
            if thai_chars < 12 or latin_chars > thai_chars * 2:
                continue
        elif latin_chars < 24 and thai_chars < 12:
            continue
        candidates.append(cleaned)

    if not candidates:
        return ""

    if prefer_thai:
        return candidates[0]
    return sorted(candidates, key=lambda item: (latin_count(item), len(item)), reverse=True)[0]


def find_marker_index(lines: list[str], marker_pattern: str) -> int:
    for index, raw in enumerate(lines):
        for segment in summary_segments(raw):
            if re.search(marker_pattern, strip_summary_markers(segment), flags=re.I):
                return index
            if re.search(marker_pattern, repair_thai_text(segment), flags=re.I):
                return index
    return -1


def extract_summary_after_marker(lines: list[str], marker_index: int, title: str, prefer_thai: bool, max_chars: int) -> str:
    if marker_index < 0:
        return ""

    body: list[str] = []
    for offset, raw in enumerate(lines[marker_index : marker_index + 90]):
        repaired_raw = repair_thai_text(raw)
        if offset > 0 and re.search(r"\babstract\b|(\d+(\.\d+)*)\s*(คำนำ|คานา|บทนำ|บทนา|introduction)\b", repaired_raw, flags=re.I):
            return " ".join(body).strip()
        if offset == 0:
            marker_stripped = re.sub(
                r"^(.*?)(abstract|บทคัดย่อ|บทคัดยอ|บพคัดย่อ|บทพคัดย่อ)\s*:?",
                "",
                repaired_raw,
                flags=re.I,
            )
            candidates = [marker_stripped] if marker_stripped.strip() else []
        else:
            candidates = [raw]

        for candidate in candidates:
            if is_summary_stop_line(candidate) and offset > 0:
                return " ".join(body).strip()
            cleaned = choose_summary_segment(candidate, title, prefer_thai)
            if not cleaned:
                continue
            if duplicate_like_previous(" ".join(body[-1:]), cleaned):
                continue
            body.append(cleaned)
            if len(" ".join(body)) >= max_chars:
                return " ".join(body).strip()

    return " ".join(body).strip()


def clean_summary_output(value: str, max_chars: int = 520) -> str:
    text = repair_thai_text(value)
    text = re.sub(r"ด้วยเมือง\s*\(Urbanization\).*", "ด้วย", text, flags=re.I)
    text = re.sub(r"\b[A-Z]{2,5}-?\d{1,3}-\d+\s+\d+\b", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"(?:ด้วย|โดย|ของ|ทาง)$", "", text).strip()
    text = re.sub(r"^[\\/:;,.|&\-\s]+|[\\/:;,.|&\-\s]+$", "", text)
    if len(text) <= max_chars:
        return text
    clipped = text[:max_chars].rsplit(" ", 1)[0].strip()
    return f"{clipped}..."


def extract_summary(path: Path, title: str) -> str:
    text = strip_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
    raw_lines = [line.rstrip() for line in text.splitlines()]

    thai_marker = find_marker_index(raw_lines, r"(บทคัดย่อ|บทคัดยอ|บพคัดย่อ|บทพคัดย่อ)")
    summary = extract_summary_after_marker(raw_lines, thai_marker, title, True, 620)
    if thai_count(summary) >= 80:
        return clean_summary_output(summary)

    abstract_marker = find_marker_index(raw_lines, r"\babstract\b")
    summary = extract_summary_after_marker(raw_lines, abstract_marker, title, False, 620)
    if len(summary) >= 100:
        return clean_summary_output(summary)

    fallback: list[str] = []
    for raw in raw_lines[:140]:
        if is_summary_stop_line(raw):
            continue
        cleaned = choose_summary_segment(raw, title, True)
        if not cleaned:
            continue
        fallback.append(cleaned)
        if len(" ".join(fallback)) >= 520:
            break

    return clean_summary_output(" ".join(fallback)) or "ยังไม่มี summary ที่อ่านได้จากเอกสารนี้ แต่สามารถเปิดรายละเอียดเพื่อดู outline และ evidence ที่ index แล้วได้"


def main() -> None:
    titles = {source_key(path): extract_title(path) for path in sorted(MARKDOWN_DIR.glob("*.md"))}
    if OUTPUT_FILE.exists():
        previous_titles = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
        for source, title in titles.items():
            if is_noisy_title(title) and previous_titles.get(source):
                titles[source] = previous_titles[source]
    summaries = {source_key(path): extract_summary(path, titles[source_key(path)]) for path in sorted(MARKDOWN_DIR.glob("*.md"))}
    payload = json.dumps(titles, ensure_ascii=False, indent=2, sort_keys=True)
    OUTPUT_FILE.write_text(f"{payload}\n", encoding="utf-8")
    summary_payload = json.dumps(summaries, ensure_ascii=False, indent=2, sort_keys=True)
    SUMMARY_OUTPUT_FILE.write_text(
        "// Auto-generated by pipeline/generate_title_overrides.py. Do not edit manually.\n"
        "export const PAPER_SUMMARY_OVERRIDES: Record<string, string> = "
        f"{summary_payload};\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(titles)} titles to {OUTPUT_FILE}")
    print(f"Wrote {len(summaries)} summaries to {SUMMARY_OUTPUT_FILE}")


if __name__ == "__main__":
    main()
