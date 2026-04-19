import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import OpenAI from "openai";

const app = express();

/* ================== CORS ================== */
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-admin-key", "Authorization"]
}));
app.options("*", cors());
app.use(express.json());

const PORT = process.env.PORT || 5001;

/* ================== OPENAI ================== */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000
});

/* ================== MULTER ================== */
const upload = multer({ storage: multer.memoryStorage() });

/* ================== DB ================== */
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

/* ================== LICENSE ================== */
function validateLicenseCore(licenseKey, deviceId) {
  const db = loadDB();
  const key = db.licenses.find(k => k.key === licenseKey);

  if (!key) return { ok: false, error: "Invalid key" };

  if (!key.deviceId || key.deviceId !== deviceId) {
    key.deviceId = deviceId;
  }

  const now = new Date();
  const expiry = new Date(key.expiry);

  if (now > expiry) {
    return { ok: false, error: "Expired" };
  }

  saveDB(db);

  return {
    ok: true,
    expiry: key.expiry
  };
}

function requireLicense(req, res, next) {
  const { licenseKey, deviceId } = req.body;

  if (!licenseKey || !deviceId) {
    return res.status(401).json({ success: false });
  }

  const result = validateLicenseCore(licenseKey, deviceId);
  if (!result.ok) {
    return res.status(403).json({ success: false });
  }

  next();
}

/* ================== ADMIN ================== */
const ADMIN_KEY = process.env.ADMIN_KEY || "admin";

app.post("/admin/generate-key", (req, res) => {
  if (req.headers["x-admin-key"] !== ADMIN_KEY) {
    return res.status(401).json({ success: false });
  }

  const { days = 30 } = req.body;
  const db = loadDB();

  const newKey = {
    key: generateKey(),
    expiry: new Date(Date.now() + days * 86400000).toISOString(),
    deviceId: null
  };

  db.licenses.push(newKey);
  saveDB(db);

  res.json({ success: true, key: newKey });
});

/* ================== HELPERS ================== */
function enforceLength(text, len) {
  if (!text) return "";
  if (text.length >= len) return text.substring(0, len);
  while (text.length < len) text += " extra quality product";
  return text.substring(0, len);
}

/* ================== TEXT ================== */
app.post("/generate-from-text", requireLicense, async (req, res) => {
  try {
    const { description } = req.body;

    const prompt = `
Return ONLY JSON.

Fill ALL fields. Never leave empty.

{
 "product_name":"",
 "color":"",
 "meesho_price":"",
 "product_mrp":"",
 "inventory":"",
 "supplier_gst_percent":"",
 "hsn_code":"",
 "product_weight_in_gms":"",
 "category":"",
 "brand":"",
 "description":""
}

Description: ${description}
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });

    let text = response.choices[0].message.content
      .replace(/```json|```/g, "")
      .trim();

    let parsed = JSON.parse(text);

    parsed.product_name = enforceLength(parsed.product_name, 150);
    parsed.description = enforceLength(parsed.description, 600);

    res.json({ success: true, fields: parsed });

  } catch {
    res.json({ success: false });
  }
});

/* ================== FORM (BEST VERSION) ================== */
app.post("/generate-from-form", requireLicense, async (req, res) => {
  try {
    const { description, formFields } = req.body;

    const fieldList = formFields.map(f => f.label).join(", ");

    const prompt = `
You MUST fill ALL fields.

Fields:
${fieldList}

Rules:
- Never skip fields
- Always give value
- Numbers only for price/weight
- GST = 5

Return ONLY JSON
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt + description }]
    });

    let text = response.choices[0].message.content
      .replace(/```json|```/g, "")
      .trim();

    const parsed = JSON.parse(text);

    const fields = formFields.map(f => ({
      selector: f.selector,
      value: parsed[f.label] || "N/A"
    }));

    res.json({ success: true, fields });

  } catch {
    res.json({ success: false });
  }
});

/* ================== IMAGE ================== */
app.post("/generate", upload.single("image"), requireLicense, async (req, res) => {
  try {
    const imageB64 = req.file.buffer.toString("base64");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Describe product for ecommerce listing" },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageB64}` } }
        ]
      }]
    });

    res.json({
      success: true,
      result: response.choices[0].message.content
    });

  } catch {
    res.json({ success: false });
  }
});

/* ================== HEALTH ================== */
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

/* ================== START ================== */
app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server running on " + PORT);
});
