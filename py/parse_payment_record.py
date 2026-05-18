import json
import re
import sys
from urllib.parse import urlparse

from parse_address import parse_address


FIELD_SEPARATOR = " ---- "


def mask_card_number(card_number):
    digits = re.sub(r"\D", "", card_number)
    if len(digits) < 10:
        return "*" * len(digits)
    return f"{digits[:6]}******{digits[-4:]}"


def parse_expiry(expiry):
    match = re.fullmatch(r"\s*(\d{1,2})/(\d{2}|\d{4})\s*", expiry)
    if not match:
        raise ValueError("Expiry should look like MM/YY or MM/YYYY")

    month = int(match.group(1))
    if month < 1 or month > 12:
        raise ValueError("Expiry month should be between 1 and 12")

    year_text = match.group(2)
    year = int(year_text[-2:])

    return {
        "raw": expiry.strip(),
        "month": month,
        "year": year,
    }


def parse_us_phone(phone):
    normalized = re.sub(r"[^\d+]", "", phone.strip())
    match = re.fullmatch(r"\+1(\d{10})", normalized)
    if not match:
        return {
            "raw": phone.strip(),
            "country_code": None,
            "number": normalized,
        }

    return {
        "raw": phone.strip(),
        "country_code": "+1",
        "number": match.group(1),
    }


def parse_sms_url(url):
    parsed = urlparse(url.strip())
    return {
        "url": url.strip(),
        "host": parsed.netloc,
        "path": parsed.path,
        "note": "SMS/API link detected but not requested by this script.",
    }


def parse_record(raw_record):
    fields = [field.strip() for field in raw_record.split(FIELD_SEPARATOR)]
    if len(fields) != 7:
        raise ValueError(
            f"Expected 7 fields separated by {FIELD_SEPARATOR!r}, got {len(fields)}"
        )

    card_number, expiry, cvv, phone, sms_url, name, raw_address = fields

    return {
        "card": {
            "number_masked": mask_card_number(card_number),
            "last4": re.sub(r"\D", "", card_number)[-4:],
            "expiry": parse_expiry(expiry),
            "cvv_present": bool(cvv),
            "cvv_masked": "***" if cvv else "",
        },
        "phone": parse_us_phone(phone),
        "sms_api": parse_sms_url(sms_url),
        "name": name,
        "address_original": raw_address,
        "address": parse_address(raw_address),
    }


def main():
    if len(sys.argv) > 1:
        raw_record = " ".join(sys.argv[1:])
    else:
        raw_record = sys.stdin.read().strip()

    if not raw_record:
        raise SystemExit(
            "Usage: python .\\parse_payment_record.py \"CARD ---- MM/YY ---- CVV ---- +1PHONE ---- SMS_URL ---- NAME ---- ADDRESS\""
        )

    print(json.dumps(parse_record(raw_record), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
