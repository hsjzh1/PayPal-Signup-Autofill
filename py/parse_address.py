import json
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import urlopen


POSTAL_CODE_PATTERNS = {
    "US": re.compile(r"\b\d{5}(?:-\d{4})?\b"),
}

US_STATE_ABBREVIATIONS = {
    "AL",
    "AK",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "FL",
    "GA",
    "HI",
    "ID",
    "IL",
    "IN",
    "IA",
    "KS",
    "KY",
    "LA",
    "ME",
    "MD",
    "MA",
    "MI",
    "MN",
    "MS",
    "MO",
    "MT",
    "NE",
    "NV",
    "NH",
    "NJ",
    "NM",
    "NY",
    "NC",
    "ND",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VT",
    "VA",
    "WA",
    "WV",
    "WI",
    "WY",
    "DC",
}


def parse_raw_address(raw_address):
    parts = [part.strip() for part in raw_address.split(",") if part.strip()]
    if len(parts) < 3:
        raise ValueError("Address should look like: street, city postal_code, country")

    street = parts[0]
    country = parts[-1].upper()
    city_postal = ", ".join(parts[1:-1]).strip()

    postal_pattern = POSTAL_CODE_PATTERNS.get(country)
    if postal_pattern is None:
        raise ValueError(f"Unsupported country: {country}")

    postal_match = postal_pattern.search(city_postal)
    if not postal_match:
        raise ValueError(f"Postal code not found for country {country}")

    postal_code = postal_match.group(0)
    city_hint = (
        city_postal[: postal_match.start()] + city_postal[postal_match.end() :]
    ).strip(" ,")
    state_hint = None

    if country == "US":
        state_match = re.search(r"\b([A-Z]{2})\b$", city_hint, flags=re.IGNORECASE)
        if state_match:
            possible_state = state_match.group(1).upper()
            if possible_state in US_STATE_ABBREVIATIONS:
                state_hint = possible_state
                city_hint = city_hint[: state_match.start()].strip(" ,")

    return {
        "country": country,
        "city_hint": city_hint,
        "state_hint": state_hint,
        "street": street,
        "postal_code": postal_code,
    }


def lookup_postal_code(country, postal_code):
    url = f"https://api.zippopotam.us/{country.lower()}/{quote(postal_code)}"

    try:
        with urlopen(url, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise RuntimeError(f"Postal lookup failed: HTTP {exc.code}") from exc
    except URLError as exc:
        raise RuntimeError(f"Postal lookup failed: {exc.reason}") from exc


def choose_place(places, city_hint):
    if not places:
        raise ValueError("No places found for postal code")

    if city_hint:
        normalized_hint = city_hint.casefold()
        for place in places:
            if place.get("place name", "").casefold() == normalized_hint:
                return place

    return places[0]


def parse_address(raw_address):
    parsed = parse_raw_address(raw_address)
    postal_data = lookup_postal_code(parsed["country"], parsed["postal_code"])
    place = choose_place(postal_data.get("places", []), parsed["city_hint"])

    return {
        "country": postal_data.get("country abbreviation", parsed["country"]),
        "state": place.get("state"),
        "state abbreviation": place.get("state abbreviation"),
        "city": place.get("place name") or parsed["city_hint"],
        "street": parsed["street"],
        "postal_code": postal_data.get("post code", parsed["postal_code"]),
    }


def main():
    raw_address = (
        " ".join(sys.argv[1:])
        if len(sys.argv) > 1
        else "2448 S Canfield Niles Rd,Youngstown 44515,US"
    )

    result = parse_address(raw_address)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
