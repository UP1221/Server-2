import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import OpenAI from "openai";

const app = express();
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-admin-key"]
}));

app.options("*", cors());

app.use(express.json());
app.use(express.json());

const PORT = process.env.PORT || 5001;

// 🔐 ENV
const ADMIN_KEY = process.env.ADMIN_KEY || "change_this_secure_key";

// 🔐 OpenAI
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY missing");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000
});

// 📦 Upload
const upload = multer({ storage: multer.memoryStorage() });

// 📦 DB
const DB_FILE = "./db.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ licenses: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function generateKey() {
  return "MEESHO-" + Math.random().toString(36).substr(2, 8).toUpperCase();
}

// 🔐 LICENSE VALIDATION (CORE)
function validateLicenseCore(licenseKey, deviceId) {
  const db = loadDB();
  const key = db.licenses.find(k => k.key === licenseKey);

  if (!key) return { ok: false, error: "Invalid key" };

  if (key.deviceId && key.deviceId !== deviceId) {
    return { ok: false, error: "Used on another device" };
  }

  if (!key.deviceId) {
    key.deviceId = deviceId;
  }

  const now = new Date();
  const expiry = new Date(key.expiry);

  if (now > expiry) {
    return { ok: false, error: "Subscription expired" };
  }

  const remainingDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

  saveDB(db);

  return {
    ok: true,
    expiry: key.expiry,
    remainingDays
  };
}

// 🔐 MIDDLEWARE (PROTECT AI ROUTES)
function requireLicense(req, res, next) {
  const { licenseKey, deviceId } = req.body;

  if (!licenseKey || !deviceId) {
    return res.status(401).json({ success: false, error: "License required" });
  }

  const result = validateLicenseCore(licenseKey, deviceId);

  if (!result.ok) {
    return res.status(403).json({ success: false, error: result.error });
  }

  req.license = result;
  next();
}

// 🔐 ADMIN PROTECT
function requireAdmin(req, res, next) {
  if (req.headers["x-admin-key"] !== ADMIN_KEY) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
}

// 🔐 VALIDATE LICENSE (PUBLIC)
app.post("/validate-license", (req, res) => {
  const { licenseKey, deviceId } = req.body;

  if (!licenseKey || !deviceId) {
    return res.json({ success: false, valid: false, error: "Missing data" });
  }

  const result = validateLicenseCore(licenseKey, deviceId);

  if (!result.ok) {
    return res.json({ success: false, valid: false, error: result.error });
  }

  res.json({
    success: true,
    valid: true,
    expiry: result.expiry,
    remainingDays: result.remainingDays
  });
});

// 🔑 ADMIN: GENERATE KEY
app.post("/admin/generate-key", requireAdmin, (req, res) => {
  const { days = 30 } = req.body;

  const db = loadDB();

  const newKey = {
    key: generateKey(),
    plan: "monthly",
    expiry: new Date(Date.now() + days * 86400000).toISOString(),
    deviceId: null
  };

  db.licenses.push(newKey);
  saveDB(db);

  res.json({ success: true, key: newKey });
});

// 🧠 PROMPT
const TEXT_PROMPT = `
Return ONLY JSON:
{
  "product_name": "",
  "color": "",
  "meesho_price": "",
  "product_mrp": "",
  "inventory": "",
  "supplier_gst_percent": "",
  "hsn_code": "",
  "product_weight_in_gms": "",
  "category": "",
  "brand": "",
  "description": ""
}
`;

// ✅ TEXT (PROTECTED)
app.post("/generate-from-text", requireLicense, async (req, res) => {
  try {
    const { description } = req.body;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: TEXT_PROMPT },
        { role: "user", content: description }
      ]
    });

    let text = response.choices?.[0]?.message?.content || "";
    text = text.replace(/```json|```/g, "").trim();

    const parsed = JSON.parse(text);

    res.json({ success: true, fields: parsed });

  } catch {
    res.json({ success: false, error: "AI failed" });
  }
});

// 🧠 FORM (PROTECTED)
app.post("/generate-from-form", requireLicense, async (req, res) => {
  try {
    const { description, formFields } = req.body;

    const prompt = `
Fields: ${formFields.map(f => f.label).join(", ")}
Description: ${description}
Return JSON mapping field -> value
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    let text = response.choices?.[0]?.message?.content || "";
    text = text.replace(/```json|```/g, "").trim();

    const parsed = JSON.parse(text);

    const fields = formFields.map(f => ({
      selector: f.selector,
      value: parsed[f.label] || ""
    }));

    res.json({ success: true, fields });

  } catch {
    res.json({ success: false, error: "AI failed" });
  }
});

// 🖼 IMAGE (PROTECTED)
app.post("/generate", requireLicense, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.json({ success: false, error: "No image uploaded" });
    }

    const imageB64 = req.file.buffer.toString("base64");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe product and generate listing" },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageB64}`
              }
            }
          ]
        }
      ]
    });

    res.json({
      success: true,
      result: response.choices?.[0]?.message?.content || ""
    });

  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ❤️ HEALTH
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    openai: !!process.env.OPENAI_API_KEY
  });
});

// 🚀 START
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on ${PORT}`);
});
