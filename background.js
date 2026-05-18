function normalizeZip(zipCode) {
  return String(zipCode || "").replace(/\D/g, "").slice(0, 5);
}

async function lookupStateByZip(zipCode) {
  const zip = normalizeZip(zipCode);
  if (!zip || zip.length !== 5) {
    return "";
  }

  try {
    const response = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!response.ok) {
      return "";
    }

    const data = await response.json();
    const place = Array.isArray(data.places) ? data.places[0] : null;
    const abbr = place && place["state abbreviation"];
    return typeof abbr === "string" ? abbr.toUpperCase() : "";
  } catch {
    return "";
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "ZIP_TO_STATE") {
    return;
  }

  lookupStateByZip(message.zipCode).then((stateAbbr) => {
    sendResponse({ stateAbbr });
  });

  return true;
});
