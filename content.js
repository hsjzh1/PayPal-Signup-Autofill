const PHONE_DEFAULT_KEY = "paypalAutofillDefaultPhone";
const PASSWORD_DEFAULT_KEY = "paypalAutofillDefaultPassword";
const WIDGET_MINIMIZED_KEY = "paypalAutofillWidgetMinimized";
const MAX_ATTEMPTS = 14;
const RETRY_DELAY_MS = 500;
const WIDGET_ID = "paypal-autofill-widget";
const WIDGET_STYLE_ID = "paypal-autofill-style";
const PAGE_OVERRIDE_STYLE_ID = "paypal-autofill-page-overrides";
const RECORD_SEPARATOR = " ---- ";

const US_STATE_ABBREVIATIONS = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"
]);

function parseRawAddress(rawAddress) {
  const parts = rawAddress.split(",").map(p => p.trim()).filter(p => p);
  if (parts.length < 3) {
    throw new Error("地址格式: street, city postal_code, country");
  }

  const street = parts[0];
  const country = parts[parts.length - 1].toUpperCase();
  const cityPostal = parts.slice(1, -1).join(", ").trim();

  const postalMatch = cityPostal.match(/\b\d{5}(?:-\d{4})?\b/);
  if (!postalMatch) {
    throw new Error("未找到邮编");
  }

  const postalCode = postalMatch[0];
  let cityHint = (
    cityPostal.slice(0, postalMatch.index) +
    cityPostal.slice(postalMatch.index + postalMatch[0].length)
  ).replace(/^[\s,]+|[\s,]+$/g, "");

  if (country === "US") {
    const stateMatch = cityHint.match(/\b([A-Z]{2})$/i);
    if (stateMatch && US_STATE_ABBREVIATIONS.has(stateMatch[1].toUpperCase())) {
      cityHint = cityHint.slice(0, stateMatch.index).replace(/^[\s,]+|[\s,]+$/g, "");
    }
  }

  return { street, cityHint, postalCode, country };
}

function parseRawRecord(raw) {
  const fields = raw.split(RECORD_SEPARATOR).map(f => f.trim());
  if (fields.length !== 7) {
    throw new Error(`需要 7 个字段（" ---- " 分隔），当前 ${fields.length} 个`);
  }

  const [cardNumber, expiry, cvv, phone, smsUrl, name, rawAddress] = fields;

  const expiryMatch = expiry.trim().match(/^(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!expiryMatch) {
    throw new Error("有效期格式应为 MM/YY 或 MM/YYYY");
  }

  const month = expiryMatch[1].padStart(2, "0");
  const year = expiryMatch[2].slice(-2);
  const address = parseRawAddress(rawAddress);

  return {
    cardNumber: cardNumber.trim(),
    expirationDate: `${month} / ${year}`,
    cvv: cvv.trim(),
    phone: phone.trim(),
    smsUrl: smsUrl.trim(),
    fullName: name.trim(),
    streetAddress: address.street,
    city: address.cityHint,
    zipCode: address.postalCode
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeZip(zipCode) {
  return String(zipCode || "").replace(/\D/g, "").slice(0, 5);
}

function parseFullName(fullName) {
  const raw = String(fullName || "").trim();
  if (!raw) {
    return { firstName: "", lastName: "" };
  }

  const parts = raw.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: parts[0] };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

function setNativeValue(element, value) {
  const descriptor = Object.getOwnPropertyDescriptor(element, "value");
  const prototype = Object.getPrototypeOf(element);
  const prototypeDescriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  if (prototypeDescriptor && descriptor && descriptor.set !== prototypeDescriptor.set) {
    prototypeDescriptor.set.call(element, value);
  } else if (prototypeDescriptor && prototypeDescriptor.set) {
    prototypeDescriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

function setInputValue(selector, value) {
  if (!value) {
    return false;
  }

  const input = document.querySelector(selector);
  if (!input) {
    return false;
  }

  setNativeValue(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
  return true;
}

function setSelectValue(selector, value) {
  if (!value) {
    return false;
  }

  const select = document.querySelector(selector);
  if (!select) {
    return false;
  }

  const option = Array.from(select.options).find((item) => item.value === value);
  if (!option) {
    return false;
  }

  select.value = value;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function getWidgetMinimized() {
  return new Promise((resolve) => {
    chrome.storage.local.get(WIDGET_MINIMIZED_KEY, (result) => {
      resolve(Boolean(result[WIDGET_MINIMIZED_KEY]));
    });
  });
}

function setWidgetMinimized(minimized) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [WIDGET_MINIMIZED_KEY]: Boolean(minimized) }, () => resolve());
  });
}

function getDefaultValues() {
  return new Promise((resolve) => {
    chrome.storage.local.get([PHONE_DEFAULT_KEY, PASSWORD_DEFAULT_KEY], (result) => {
      resolve({
        phone: result[PHONE_DEFAULT_KEY] || "",
        password: result[PASSWORD_DEFAULT_KEY] || ""
      });
    });
  });
}

function saveDefaultPhone(phone) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [PHONE_DEFAULT_KEY]: String(phone || "") }, () => resolve());
  });
}

function saveDefaultPassword(password) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [PASSWORD_DEFAULT_KEY]: String(password || "") }, () => resolve());
  });
}

function getStateByZip(zipCode) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "ZIP_TO_STATE", zipCode }, (response) => {
      if (chrome.runtime.lastError) {
        resolve("");
        return;
      }

      const stateAbbr = response && response.stateAbbr;
      resolve(typeof stateAbbr === "string" ? stateAbbr.toUpperCase() : "");
    });
  });
}

function getFieldPlan(profile, stateAbbr) {
  const { firstName, lastName } = parseFullName(profile.fullName);
  const zipCode = normalizeZip(profile.zipCode);

  return {
    stateAbbr,
    zipCode,
    fields: [
      { selector: "#phone", value: profile.phone },
      { selector: "#firstName", value: firstName },
      { selector: "#lastName", value: lastName },
      { selector: "#billingLine1", value: profile.streetAddress },
      { selector: "#billingCity", value: profile.city },
      { selector: "#billingPostalCode", value: zipCode },
      { selector: "#cardNumber", value: profile.cardNumber },
      { selector: "#cardExpiry", value: profile.expirationDate },
      { selector: "#cardCvv", value: profile.cvv },
      { selector: "#password", value: profile.password }
    ]
  };
}

function injectPageOverrideStyles() {
  if (document.getElementById(PAGE_OVERRIDE_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = PAGE_OVERRIDE_STYLE_ID;
  style.textContent = "#captcha-standalone,.captcha-overlay,.captcha-container,.AddressAutocomplete-results{display:none!important;height:0!important;overflow:hidden!important}";
  (document.head || document.documentElement).appendChild(style);
}

async function fillProfile(profile) {
  const zipCode = normalizeZip(profile.zipCode);
  const stateAbbr = zipCode ? await getStateByZip(zipCode) : "";
  const plan = getFieldPlan(profile, stateAbbr);

  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    for (const item of plan.fields) {
      setInputValue(item.selector, item.value);
    }

    setSelectValue("#billingState", plan.stateAbbr);

    const missingInput = plan.fields.some((item) => item.value && !document.querySelector(item.selector));
    const missingState = Boolean(plan.stateAbbr) && !document.querySelector("#billingState");

    if (!missingInput && !missingState) {
      break;
    }

    await sleep(RETRY_DELAY_MS);
  }

  return stateAbbr;
}

function injectWidgetStyles() {
  if (document.getElementById(WIDGET_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = WIDGET_STYLE_ID;
  style.textContent = `
    #${WIDGET_ID} {
      position: fixed;
      top: 84px;
      right: 16px;
      width: 340px;
      z-index: 2147483647;
      border: 1px solid #c9ced6;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
      background: #ffffff;
      font-family: Arial, sans-serif;
      color: #222;
    }

    #${WIDGET_ID}.minimized .paypal-autofill-body {
      display: none;
    }

    #${WIDGET_ID} .paypal-autofill-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f6f8fb;
      border-bottom: 1px solid #e3e7ee;
      padding: 8px 10px;
      border-radius: 10px 10px 0 0;
      font-size: 13px;
      font-weight: 700;
      cursor: default;
    }

    #${WIDGET_ID} .paypal-autofill-toggle {
      border: 1px solid #c8cdd6;
      background: #fff;
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 12px;
      cursor: pointer;
    }

    #${WIDGET_ID} .paypal-autofill-body {
      padding: 10px;
    }

    #${WIDGET_ID} label {
      display: block;
      margin: 6px 0 4px;
      font-size: 12px;
      line-height: 1.2;
      color: #374151;
    }

    #${WIDGET_ID} input {
      width: 100%;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 8px;
      font-size: 12px;
      color: #111;
      background: #fff;
    }

    #${WIDGET_ID} .paypal-autofill-inline {
      display: grid;
      grid-template-columns: 1fr 82px;
      gap: 6px;
    }

    #${WIDGET_ID} .paypal-autofill-inline button {
      border: 1px solid #c8cdd6;
      border-radius: 6px;
      background: #f9fafb;
      font-size: 12px;
      padding: 0 6px;
      cursor: pointer;
      white-space: nowrap;
    }

    #${WIDGET_ID} .paypal-autofill-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }

    #${WIDGET_ID} .paypal-autofill-actions button {
      flex: 1;
      border: 1px solid #c8cdd6;
      border-radius: 6px;
      background: #f9fafb;
      font-size: 12px;
      padding: 8px;
      cursor: pointer;
    }

    #${WIDGET_ID} .paypal-autofill-actions button:hover,
    #${WIDGET_ID} .paypal-autofill-inline button:hover {
      background: #f3f4f6;
    }

    #${WIDGET_ID} .paypal-autofill-status {
      min-height: 16px;
      margin-top: 8px;
      font-size: 12px;
      color: #0b7a2f;
    }

    #${WIDGET_ID} .paypal-autofill-hint {
      margin-top: 6px;
      font-size: 11px;
      color: #6b7280;
    }

    #${WIDGET_ID} textarea {
      width: 100%;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      padding: 8px;
      font-size: 11px;
      color: #111;
      background: #fff;
      resize: vertical;
      font-family: Consolas, monospace;
    }

    #${WIDGET_ID} .paypal-autofill-divider {
      border: none;
      border-top: 1px solid #e3e7ee;
      margin: 10px 0;
    }
  `;

  document.documentElement.appendChild(style);
}

function getWidgetElement() {
  return document.getElementById(WIDGET_ID);
}

function updateWidgetStatus(message, isError = false) {
  const widget = getWidgetElement();
  if (!widget) {
    return;
  }

  const statusEl = widget.querySelector(".paypal-autofill-status");
  if (!statusEl) {
    return;
  }

  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b42318" : "#0b7a2f";
}

function readWidgetProfile() {
  const widget = getWidgetElement();
  if (!widget) {
    return null;
  }

  const valueOf = (name) => {
    const el = widget.querySelector(`[data-field="${name}"]`);
    return el ? el.value.trim() : "";
  };

  return {
    fullName: valueOf("fullName"),
    phone: valueOf("phone"),
    streetAddress: valueOf("streetAddress"),
    city: valueOf("city"),
    zipCode: valueOf("zipCode"),
    cardNumber: valueOf("cardNumber"),
    expirationDate: valueOf("expirationDate"),
    cvv: valueOf("cvv"),
    password: valueOf("password")
  };
}

function writeWidgetDefaults(defaults) {
  const widget = getWidgetElement();
  if (!widget || !defaults) {
    return;
  }

  const setValue = (name, value) => {
    const el = widget.querySelector(`[data-field="${name}"]`);
    if (el) {
      el.value = value || "";
    }
  };

  setValue("phone", defaults.phone);
  setValue("password", defaults.password);
}

function setWidgetMinimizedClass(minimized) {
  const widget = getWidgetElement();
  if (!widget) {
    return;
  }

  widget.classList.toggle("minimized", minimized);
  const toggleBtn = widget.querySelector(".paypal-autofill-toggle");
  if (toggleBtn) {
    toggleBtn.textContent = minimized ? "展开" : "最小化";
  }
}

function createWidget() {
  if (getWidgetElement()) {
    return;
  }

  injectWidgetStyles();

  const wrapper = document.createElement("section");
  wrapper.id = WIDGET_ID;
  wrapper.innerHTML = `
    <div class="paypal-autofill-header">
      <span>PayPal 自动填充</span>
      <button type="button" class="paypal-autofill-toggle">最小化</button>
    </div>
    <div class="paypal-autofill-body">
      <label>快速填充（粘贴完整记录）</label>
      <textarea data-field="rawRecord" rows="2" placeholder="CARD ---- MM/YY ---- CVV ---- +1PHONE ---- SMS_URL ---- NAME ---- ADDRESS"></textarea>
      <div class="paypal-autofill-actions" style="margin-top:6px;">
        <button type="button" data-action="parse-record">解析并填充</button>
      </div>
      <hr class="paypal-autofill-divider" />

      <label>Full name（例如 KANSAS CITY）</label>
      <input type="text" data-field="fullName" placeholder="KANSAS CITY" />

      <label>电话号码</label>
      <div class="paypal-autofill-inline">
        <input type="text" data-field="phone" placeholder="(582) 822-6539" />
        <button type="button" data-action="save-phone-default">设为默认</button>
      </div>

      <label>Street address</label>
      <input type="text" data-field="streetAddress" placeholder="3721 BELLEFONTAINE AVE" />

      <label>City</label>
      <input type="text" data-field="city" placeholder="KANSAS CITY" />

      <label>ZIP code</label>
      <input type="text" data-field="zipCode" placeholder="64128" />

      <label>Card number</label>
      <input type="text" data-field="cardNumber" placeholder="4859 5401 6376 9994" />

      <label>Expiration date</label>
      <input type="text" data-field="expirationDate" placeholder="07 / 30" />

      <label>CVV</label>
      <input type="text" data-field="cvv" placeholder="976" />

      <label>Create password</label>
      <div class="paypal-autofill-inline">
        <input type="password" data-field="password" placeholder="至少 8 位" />
        <button type="button" data-action="save-password-default">设为默认</button>
      </div>

      <div class="paypal-autofill-actions">
        <button type="button" data-action="fill">填充页面</button>
      </div>

      <div class="paypal-autofill-status"></div>
      <div class="paypal-autofill-hint">仅电话号码与密码默认值会保存到本地；姓名规则：第一个词=First name，其余=Last name。</div>
    </div>
  `;

  document.documentElement.appendChild(wrapper);

  const toggleBtn = wrapper.querySelector(".paypal-autofill-toggle");
  const fillBtn = wrapper.querySelector('[data-action="fill"]');
  const savePhoneBtn = wrapper.querySelector('[data-action="save-phone-default"]');
  const savePasswordBtn = wrapper.querySelector('[data-action="save-password-default"]');
  const parseBtn = wrapper.querySelector('[data-action="parse-record"]');

  toggleBtn.addEventListener("click", async () => {
    const minimized = !wrapper.classList.contains("minimized");
    setWidgetMinimizedClass(minimized);
    await setWidgetMinimized(minimized);
  });

  savePhoneBtn.addEventListener("click", async () => {
    const profile = readWidgetProfile();
    if (!profile || !profile.phone) {
      updateWidgetStatus("电话号码为空，无法设为默认", true);
      return;
    }

    await saveDefaultPhone(profile.phone);
    updateWidgetStatus("电话号码已设为默认");
  });

  savePasswordBtn.addEventListener("click", async () => {
    const profile = readWidgetProfile();
    if (!profile || !profile.password) {
      updateWidgetStatus("密码为空，无法设为默认", true);
      return;
    }

    await saveDefaultPassword(profile.password);
    updateWidgetStatus("密码已设为默认");
  });

  parseBtn.addEventListener("click", async () => {
    const widget = getWidgetElement();
    const textarea = widget.querySelector('[data-field="rawRecord"]');
    const raw = textarea ? textarea.value.trim() : "";
    if (!raw) {
      updateWidgetStatus("请粘贴完整记录", true);
      return;
    }

    try {
      const parsed = parseRawRecord(raw);
      const defaults = await getDefaultValues();

      const setField = (name, value) => {
        const el = widget.querySelector(`[data-field="${name}"]`);
        if (el) el.value = value || "";
      };

      setField("fullName", parsed.fullName);
      setField("phone", defaults.phone);
      setField("streetAddress", parsed.streetAddress);
      setField("city", parsed.city);
      setField("zipCode", parsed.zipCode);
      setField("cardNumber", parsed.cardNumber);
      setField("expirationDate", parsed.expirationDate);
      setField("cvv", parsed.cvv);
      setField("password", defaults.password);

      const profile = readWidgetProfile();
      if (profile) {
        const stateAbbr = await fillProfile(profile);
        updateWidgetStatus(
          stateAbbr ? `解析成功，已填充，州: ${stateAbbr}` : "解析成功，已填充页面"
        );
      }
    } catch (e) {
      updateWidgetStatus(`解析失败: ${e.message}`, true);
    }
  });

  fillBtn.addEventListener("click", async () => {
    const profile = readWidgetProfile();
    if (!profile) {
      return;
    }

    const stateAbbr = await fillProfile(profile);
    updateWidgetStatus(
      stateAbbr ? `已填充，州自动匹配为 ${stateAbbr}` : "已填充（ZIP 未匹配到州）",
      !stateAbbr && Boolean(normalizeZip(profile.zipCode))
    );
  });
}

async function fillFromDefaults() {
  const defaults = await getDefaultValues();
  const hasAnyDefault = Boolean(defaults.phone || defaults.password);
  if (!hasAnyDefault) {
    return;
  }

  await fillProfile({
    fullName: "",
    phone: defaults.phone,
    streetAddress: "",
    city: "",
    zipCode: "",
    cardNumber: "",
    expirationDate: "",
    cvv: "",
    password: defaults.password
  });
}

async function initWidget() {
  createWidget();

  const [defaults, minimized] = await Promise.all([getDefaultValues(), getWidgetMinimized()]);
  writeWidgetDefaults(defaults);
  setWidgetMinimizedClass(minimized);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "PAYPAL_FILL_NOW") {
    return;
  }

  const profile = readWidgetProfile();
  if (!profile) {
    sendResponse({ ok: false });
    return;
  }

  fillProfile(profile).then(() => sendResponse({ ok: true }));
  return true;
});

injectPageOverrideStyles();
initWidget();
fillFromDefaults();
